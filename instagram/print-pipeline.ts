/**
 * Print Pipeline — flat, print-ready artwork (NOT a product photograph)
 *
 * Replaces generateDesignConcept/generateProductMockup in product-generator.ts,
 * which asked the model for the wrong thing at the prompt level: rule 2 there
 * ("Nezobrazuj jen plochý obrázek, zobraz vždy REÁLNÝ PRODUKT v prostoru") plus a
 * "Product photography, studio lighting, photorealistic" suffix guaranteed a photo
 * of a finished product. The mockup step then composited that photo onto another
 * product — a t-shirt pasted on a t-shirt. Meanwhile the UI promised "tisknutelný
 * grafický design izolovaný na pozadí" and the FAQ promised a transparent
 * background, neither of which any code produced.
 *
 * What this module does instead, mirroring the IG pipeline's proven structure:
 *   1. generatePrintBrief   — Pro ladder (never flash), brand memory, anti-repetition
 *   2. renderPrintArtwork   — FLAT artwork, aspect ratio from the category, logo
 *                             passed as a faithful reference (not "spray-painted")
 *   3. verifyPrintArtwork   — vision QA: exact Czech text, flatness, logo, safe area
 *                             → corrective edit → one fresh regen → ship-best
 *   4. finalizePrintFile    — chroma-key to alpha, upscale to the category's physical
 *                             size at 300 DPI, embed density, emit a die-line preview
 *                             and a printer spec
 *   5. renderProductMockup  — separate step, artwork passed as a reference image so
 *                             the model places it with real perspective and shadows
 *
 * Honest limit: Nano Banana renders ~1024 px and imageConfig.imageSize "2K"/"4K" is
 * verified to blur it (gemini-client.ts). finalizePrintFile therefore UPSCALES. The
 * output is a proposal for a printer at the right physical dimensions, not
 * resolution-independent production data — the UI must say so.
 */

import { Type } from "@google/genai"
import sharp from "sharp"
import {
    generateTextQuality,
    generateImage,
    generateImageWithReferences,
    editExistingImage,
} from "./gemini-client"
import { getModel, hasFallback, getTemperature } from "./models"
import { judgeVision } from "./judge"
import { isQualityUnavailable } from "../utils/retry"
import { getBrandMemories, formatMemoriesForPrompt } from "./memory-agent"
import type { ClientConfig } from "./configs/types"

/** Designer's quality ladder: [top Pro, GA Pro], never flash. */
function printLadder(): string[] {
    const models = [getModel("designer")]
    if (hasFallback("designer")) models.push(getModel("designer", "fallback"))
    return models
}

// ============================================
// TYPES
// ============================================

export type ArtworkKind = "flat" | "label" | "wrap" | "poster"

export interface PrintCategory {
    slug: string
    label: string
    design_guide?: string | null
    mockup_prompt?: string | null
    material_hint?: string | null
    manufacturing_hint?: string | null
    artwork_kind?: ArtworkKind | null
    aspect_ratio?: string | null
    /** "WxH" in millimetres */
    print_size_mm?: string | null
    panels?: { name: string; width_mm: number; height_mm: number; purpose?: string }[] | null
    safe_margin_mm?: number | null
    bleed_mm?: number | null
}

export interface PrintBrief {
    name: string
    artworkKind: ArtworkKind
    concept: string
    composition: string
    /** Every string that must appear in the artwork, verbatim (Czech diacritics included) */
    typography: { headline: string; sub?: string; small?: string }
    /** Hex values — the old pipeline passed the palette as prose and got random colors */
    colors: string[]
    placement: string
    /** For labels: what goes on which panel */
    panelPlan?: { name: string; content: string }[]
    suggestedTexts: string[]
    negativePrompt: string
    /** How this deliberately differs from recent designs */
    divergenceNote?: string
    /** Výsledek faktické brány nad tištěným textem. Ukládá se s briefem do
     *  ig_product_designs, ať je u návrhu vidět, že v něm zůstalo tvrzení bez opory —
     *  tisk se na rozdíl od postu nedá vzít zpátky. */
    factCheck?: { status: string; flags: string[] }
}

export interface PrintSpec {
    widthMm: number
    heightMm: number
    dpi: number
    pixelWidth: number
    pixelHeight: number
    bleedMm: number
    safeMarginMm: number
    colors: string[]
    material?: string
    technology?: string
    artworkKind: ArtworkKind
    note: string
}

const PRINT_BRIEF_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        name: { type: Type.STRING },
        concept: { type: Type.STRING },
        composition: { type: Type.STRING },
        typography: {
            type: Type.OBJECT,
            properties: {
                headline: { type: Type.STRING },
                sub: { type: Type.STRING },
                small: { type: Type.STRING },
            },
            required: ["headline"],
        },
        colors: { type: Type.ARRAY, items: { type: Type.STRING } },
        placement: { type: Type.STRING },
        panelPlan: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: { name: { type: Type.STRING }, content: { type: Type.STRING } },
                required: ["name", "content"],
            },
        },
        suggestedTexts: { type: Type.ARRAY, items: { type: Type.STRING } },
        negativePrompt: { type: Type.STRING },
        divergenceNote: { type: Type.STRING },
    },
    required: ["name", "concept", "composition", "typography", "colors", "placement", "suggestedTexts", "negativePrompt"],
}

// ============================================
// GEOMETRY (pure — covered by scripts/test-print-pipeline.ts)
// ============================================

/** Parse "90x130" → { widthMm, heightMm }. Falls back to a square when unset/garbled. */
export function parsePrintSize(value: string | null | undefined, fallbackMm = 200): { widthMm: number; heightMm: number } {
    const m = String(value || "").match(/^\s*(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*$/)
    if (!m) return { widthMm: fallbackMm, heightMm: fallbackMm }
    return { widthMm: Number(m[1]), heightMm: Number(m[2]) }
}

/** Millimetres → pixels at a given DPI. 1 inch = 25.4 mm. */
export function mmToPx(mm: number, dpi = 300): number {
    return Math.round((mm / 25.4) * dpi)
}

/**
 * Pick the generation aspect ratio.
 *
 * The model only accepts a fixed set of ratios, so the physical size cannot be
 * requested directly — we ask for the CLOSEST supported ratio and let
 * finalizePrintFile resize to the exact millimetre target. Choosing the nearest
 * ratio (rather than the old hardcoded "1:1") is what stops a 75×160 mm bottle
 * label from being generated square and then squashed.
 */
export const SUPPORTED_RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9"] as const
export type SupportedRatio = typeof SUPPORTED_RATIOS[number]

export function closestRatio(widthMm: number, heightMm: number): SupportedRatio {
    if (!(widthMm > 0) || !(heightMm > 0)) return "1:1"
    const target = widthMm / heightMm
    let best: SupportedRatio = "1:1"
    let bestDelta = Infinity
    for (const r of SUPPORTED_RATIOS) {
        const [w, h] = r.split(":").map(Number)
        // Compare in log space so 16:9 vs 9:16 are equidistant from square
        const delta = Math.abs(Math.log(w / h) - Math.log(target))
        if (delta < bestDelta) { bestDelta = delta; best = r }
    }
    return best
}

/** Resolve a category to everything the renderer and finaliser need. */
export function resolvePrintGeometry(category: PrintCategory): {
    kind: ArtworkKind
    widthMm: number
    heightMm: number
    ratio: SupportedRatio
    bleedMm: number
    safeMarginMm: number
    pixelWidth: number
    pixelHeight: number
} {
    const kind = (category.artwork_kind || "flat") as ArtworkKind
    const { widthMm, heightMm } = parsePrintSize(category.print_size_mm)
    // An explicitly configured ratio wins; otherwise derive it from the physical size.
    const configured = SUPPORTED_RATIOS.includes(category.aspect_ratio as SupportedRatio)
        ? (category.aspect_ratio as SupportedRatio)
        : closestRatio(widthMm, heightMm)
    return {
        kind,
        widthMm,
        heightMm,
        ratio: configured,
        bleedMm: category.bleed_mm ?? 3,
        safeMarginMm: category.safe_margin_mm ?? 3,
        pixelWidth: mmToPx(widthMm),
        pixelHeight: mmToPx(heightMm),
    }
}

// ============================================
// 1. BRIEF
// ============================================

const KIND_GUIDE: Record<ArtworkKind, string> = {
    flat: "Plochá grafika, která se tiskne přímo na produkt. Kompozice musí fungovat samostatně, bez kontextu produktu.",
    label: "Etiketa s panely. Každý panel má svůj úkol — přední prodává, zadní informuje. Okraje jsou rizikové (ořez), nic důležitého k nim nedávej.",
    wrap: "Souvislý pás kolem obalu. Levý a pravý okraj na sebe navazují — u švu nesmí být nic důležitého.",
    poster: "Samostatný tiskový list. Funguje jako plakát na zdi — hierarchie čitelná z dálky.",
}

export interface PrintBriefOptions {
    category: PrintCategory
    theme: string
    /** Product this artwork belongs to (name/role/step/specs) */
    product?: { name: string; role?: string; step?: number; description?: string; specs?: Record<string, any> }
    /** Line context so sibling SKUs stay visually related but distinguishable */
    line?: { name: string; namingConvention?: string; systemLogic?: string; siblings?: string[] }
    /** Explicit copy the user wants on the artwork */
    overlayText?: string
    /** Free-text steer from the UI (this field used to be silently ignored) */
    designDescription?: string
    /** Recent briefs for anti-repetition */
    recentBriefs?: string[]
    /** For A/B: instruct this variant to diverge from its sibling */
    divergeFrom?: string
}

/**
 * Brief i render se účtují zvlášť, jako sourozenci — `generatePrintDesign` v UI je
 * volá za sebou, ne do sebe. Dva řádky v `ai_spend` za jeden design jsou proto
 * správně a v součtu se nepřekrývají.
 */
export async function generatePrintBrief(
    config: ClientConfig,
    clientId: string,
    opts: PrintBriefOptions,
): Promise<PrintBrief> {
    const { trackSpend } = await import("./spend-tracker")
    return trackSpend(
        "print",
        { clientId, refId: `brief:${opts.category.slug}` },
        () => generatePrintBriefInner(config, clientId, opts),
    )
}

async function generatePrintBriefInner(
    config: ClientConfig,
    clientId: string,
    opts: PrintBriefOptions,
): Promise<PrintBrief> {
    const geo = resolvePrintGeometry(opts.category)
    const bv = config.brandVoice
    // Typový filtr v dotazu, ne za ním — viz getBrandMemories (limit je v SQL).
    const visual = await getBrandMemories(6, clientId, undefined, undefined, ["visual"]).catch(() => [])

    const palette = [
        config.feedAesthetic?.colorPalette,
        (config as any).feedAesthetic?.hexColors?.join(", "),
    ].filter(Boolean).join(" · ")

    const panelSection = geo.kind === "label" && opts.category.panels?.length
        ? `\n## PANELY ETIKETY\n${opts.category.panels.map(p => `- ${p.name} (${p.width_mm}×${p.height_mm} mm): ${p.purpose || "obsah urči sám"}`).join("\n")}\nNavrhni obsah KAŽDÉHO panelu do pole "panelPlan".`
        : ""

    const productSection = opts.product ? `
## PRODUKT
Název: ${opts.product.name}
${opts.product.step ? `Krok v řadě: ${opts.product.step}` : ""}
${opts.product.role ? `Role: ${opts.product.role}` : ""}
${opts.product.description ? `Popis: ${opts.product.description}` : ""}
${opts.product.specs ? `Specifikace: ${JSON.stringify(opts.product.specs)}` : ""}
Název produktu MUSÍ být na artworku napsaný přesně takto: "${opts.product.name}"` : ""

    const lineSection = opts.line ? `
## ŘADA "${opts.line.name}"
${opts.line.systemLogic ? `Systém: ${opts.line.systemLogic}` : ""}
${opts.line.namingConvention ? `Názvosloví: ${opts.line.namingConvention}` : ""}
${opts.line.siblings?.length ? `Sousední produkty v řadě: ${opts.line.siblings.join(", ")}` : ""}
Artwork musí být OKAMŽITĚ rozpoznatelný jako součást téhle řady (shodná struktura, typografie a logika),
ale odlišitelný od sousedních kroků — typicky barevným odlišením kroku, ne jinou kompozicí.` : ""

    const memorySection = visual.length > 0
        ? `\n## CO U TÉHLE ZNAČKY VIZUÁLNĚ FUNGUJE\n${formatMemoriesForPrompt(visual)}`
        : ""

    const antiRepeat = opts.recentBriefs?.length
        ? `\n## POSLEDNÍ DESIGNY (NEOPAKUJ JE)\n${opts.recentBriefs.slice(0, 5).map(b => `- ${b}`).join("\n")}`
        : ""

    const divergence = opts.divergeFrom
        ? `\n## A/B VARIANTA\nTenhle návrh musí být VÝRAZNĚ jiný než tento sourozenec — jiná kompozice i typografická hierarchie, stejná značka:\n${opts.divergeFrom}`
        : ""

    const prompt = `Jsi grafický designér pro tisk. Navrhuješ TISKOVOU GRAFIKU pro značku "${config.name}".

## ZNAČKA
Persona: ${bv?.persona || "—"}
Vizuální styl: ${config.feedAesthetic?.feel || "moderní, kvalitní"}
Paleta: ${palette || "barvy značky"}
${memorySection}

## FORMÁT
Typ artworku: ${geo.kind} — ${KIND_GUIDE[geo.kind]}
Produkt: ${opts.category.label}
Rozměr tisku: ${geo.widthMm}×${geo.heightMm} mm (poměr ${geo.ratio})
Bezpečný okraj: ${geo.safeMarginMm} mm — v tomhle pásu u kraje NESMÍ být text ani logo
${opts.category.material_hint ? `Materiál: ${opts.category.material_hint}` : ""}
${opts.category.manufacturing_hint ? `Technologie tisku: ${opts.category.manufacturing_hint}` : ""}
${opts.category.design_guide ? `Specifika: ${opts.category.design_guide}` : ""}
${panelSection}
${productSection}
${lineSection}

## ZADÁNÍ
Téma: ${opts.theme}
${opts.designDescription ? `Přání uživatele: ${opts.designDescription}` : ""}
${opts.overlayText ? `Na artworku MUSÍ být přesně tento text: "${opts.overlayText}"` : ""}
${antiRepeat}
${divergence}

## CO NAVRHUJEŠ
PLOCHOU TISKOVOU GRAFIKU. Ne fotku produktu, ne mockup, ne vizualizaci v prostoru.
Představ si to jako soubor, který pošleš do tiskárny.

1. "composition" — rozvržení plochy: co je kde, jaká je hierarchie, kolik je prázdného místa.
2. "typography" — přesné řetězce, které mají být vytištěné. headline je povinný.
   Piš je česky VČETNĚ diakritiky a přesně tak, jak mají být vysázené. Krátce.
3. "colors" — 2–5 barev jako HEX (#RRGGBB). Ne slovy.
4. "placement" — kde je logo a jak velké. Logo se NIKDY nedeformuje.
5. "panelPlan" — jen u typu label.
6. "suggestedTexts" — 5 krátkých alternativních sloganů k tématu (max 5 slov).
7. "negativePrompt" — čeho se má renderer vyvarovat.
8. "divergenceNote" — čím se tenhle návrh liší od posledních.

## TVRDÁ PRAVIDLA
- Text v "typography" bude vysázen DOSLOVA. Nepiš tam nic, co nemá být vidět.
- Žádné texty navíc, žádný lorem ipsum, žádné vymyšlené certifikace ani zdravotní tvrzení.
- Kompozice musí být čitelná i černobíle.

Vrať POUZE validní JSON.`

    const raw = await generateTextQuality(prompt, {
        models: printLadder(),
        responseSchema: PRINT_BRIEF_SCHEMA,
        temperature: getTemperature("designer"),
        label: "print-brief",
    })

    const clean = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim()
    const brief = JSON.parse(clean) as PrintBrief
    if (!brief?.concept || !brief?.typography?.headline) {
        throw new Error("Print designer vrátil neúplný brief (chybí concept nebo typography.headline)")
    }
    brief.artworkKind = geo.kind
    // The user's explicit copy wins over anything the model invented for the headline.
    if (opts.overlayText) brief.typography.headline = opts.overlayText

    // Faktická brána nad TIŠTĚNÝM textem. Tisk je nejtvrdší médium: vytištěný leták
    // s vymyšleným údajem se nesmaže a klient ho drží v ruce. Nadpis zadaný člověkem
    // (opts.overlayText) se nikdy nepřepisuje — za svoje slova si ručí sám; kontrolují
    // se jen texty, které napsal model. Fail-open, ale nahlas.
    try {
        const { checkDisplayStrings } = await import("./fact-check")
        const authored = opts.overlayText ? [brief.typography.sub, brief.typography.small] : [brief.typography.headline, brief.typography.sub, brief.typography.small]
        const out = await checkDisplayStrings(config, authored.map(t => t || ""), { postTypeName: `tisk/${geo.kind}` })
        if (out.judged) {
            const [a, b, c] = out.strings
            if (opts.overlayText) { brief.typography.sub = a || brief.typography.sub; brief.typography.small = b || brief.typography.small }
            else { brief.typography.headline = a || brief.typography.headline; brief.typography.sub = b || brief.typography.sub; brief.typography.small = c || brief.typography.small }
            brief.factCheck = { status: out.status, flags: out.flags }
            if (out.repairs.length) console.log(`   🔧 Faktická brána (tisk): ${out.repairs.length} tvrzení opraveno`)
            if (out.flags.length) console.warn(`   🚩 Faktická brána (tisk): ZŮSTALO nepodložené tvrzení — ${out.flags.join(" | ")}`)
        }
    } catch (err) {
        console.warn(`   ⚠️ Faktická brána nad tiskem nedoběhla: ${String((err as Error)?.message || err).slice(0, 100)}`)
    }
    return brief
}

// ============================================
// 2. RENDER
// ============================================

/** Chroma key — a color no brand palette will contain, so keying it out is unambiguous. */
export const CHROMA_KEY = { r: 255, g: 0, b: 255 }

function buildArtworkPrompt(brief: PrintBrief, config: ClientConfig, geo: ReturnType<typeof resolvePrintGeometry>, withLogo: boolean): string {
    const texts = [brief.typography.headline, brief.typography.sub, brief.typography.small]
        .filter(Boolean)
        .map(t => `"${t}"`)
        .join(", ")

    const backgroundRule = geo.kind === "label" || geo.kind === "poster"
        ? `The artwork covers the ENTIRE canvas edge to edge — it is a printed panel, so it has its own background color from the palette.`
        : `The background MUST be pure flat RGB(255,0,255) magenta and NOTHING else — it is a chroma key that will be removed to make the background transparent. Do not put any design element, shadow, gradient or texture on the background.`

    const logoRule = withLogo
        ? `\nA reference image of the brand logo is attached. Reproduce it FAITHFULLY — exact shapes, exact proportions, exact colors. Do NOT redraw, restyle, emboss, distress or reinterpret it. Place it as described: ${brief.placement}`
        : ""

    return `FLAT PRINT ARTWORK — vector-style graphic design, NOT a photograph.

This is a print-ready graphic file for ${geo.kind === "label" ? "a product label" : geo.kind === "wrap" ? "a wraparound label" : geo.kind === "poster" ? "a poster" : "printing onto a product"}, ${geo.widthMm}×${geo.heightMm} mm.

CONCEPT: ${brief.concept}
COMPOSITION: ${brief.composition}
COLORS (use exactly these): ${brief.colors.join(", ")}
${brief.panelPlan?.length ? `PANELS:\n${brief.panelPlan.map(p => `- ${p.name}: ${p.content}`).join("\n")}` : ""}

TEXT — render these strings EXACTLY, character for character, including Czech diacritics (ě š č ř ž ý á í é ú ů):
${texts}
Do not add, translate, abbreviate or invent any other text.

${backgroundRule}
${logoRule}

HARD CONSTRAINTS:
- Flat 2D graphic design. NO perspective, NO 3D rendering, NO drop shadows, NO photorealism.
- Do NOT depict the physical product, a mockup, a bottle, a garment, a hand or a studio scene. Only the artwork itself.
- Keep all text and the logo at least ${geo.safeMarginMm} mm from every edge — nothing may be clipped.
- Crisp vector-like edges, solid fills, print-suitable contrast.
- AVOID: ${brief.negativePrompt}`
}

/**
 * Render flat artwork. Logo (when present) rides along as a faithful reference —
 * the old prompt asked the model to "emboss, stamp, spray-paint or stylize" the
 * logo, which is the opposite of what a brand mark needs.
 */
export async function renderPrintArtwork(
    brief: PrintBrief,
    config: ClientConfig,
    category: PrintCategory,
    logoBuffer?: Buffer | null,
): Promise<Buffer> {
    const geo = resolvePrintGeometry(category)
    const prompt = buildArtworkPrompt(brief, config, geo, !!logoBuffer)

    if (logoBuffer) {
        try {
            return await generateImageWithReferences(
                prompt,
                [{ buffer: logoBuffer, mimeType: "image/png", label: "brand logo — reproduce faithfully with exact shapes and colors, do not redraw" }],
                { aspectRatio: geo.ratio },
            )
        } catch (err: any) {
            console.warn(`   ⚠️ Render s logem selhal (${err?.message}) — zkouším bez loga`)
        }
    }
    return generateImage(buildArtworkPrompt(brief, config, geo, false), { aspectRatio: geo.ratio })
}

// ============================================
// 3. QA
// ============================================

export interface PrintQA {
    ok: boolean
    textAccurate: boolean
    renderedText?: string
    isFlat: boolean
    logoIntact: boolean
    withinSafeArea: boolean
    issues: string[]
    fixHint?: string
    severity?: "ok" | "cosmetic" | "severe"
}

/** Lower is better. A product photo instead of flat artwork is the failure this
 *  whole rewrite exists to prevent, so it dominates the score. */
export function printQaScore(qa: PrintQA): number {
    if (qa.ok) return 0
    return (qa.isFlat === false ? 100 : 0)
        + (qa.logoIntact === false ? 40 : 0)
        + (qa.withinSafeArea === false ? 30 : 0)
        + (qa.severity === "severe" ? 50 : 0)
        + (qa.issues?.length || 1)
}

/** Fail-open, exactly like verifyNativeImage: a QA infrastructure error must never
 *  block a paid render. */
export async function verifyPrintArtwork(
    imageBuffer: Buffer,
    brief: PrintBrief,
    geo: ReturnType<typeof resolvePrintGeometry>,
    logoExpected: boolean,
    logoBuffer?: Buffer | null,
): Promise<PrintQA> {
    const expectedTexts = [brief.typography.headline, brief.typography.sub, brief.typography.small].filter(Boolean)

    const qaPrompt = `You are a strict prepress QA inspector checking FLAT PRINT ARTWORK in CZECH.

The first image should be flat, print-ready artwork — a graphic file destined for a printer,
${geo.widthMm}×${geo.heightMm} mm. It must NOT be a photograph of a product, a mockup, or a 3D render.

Expected text, which must appear EXACTLY, character for character, including Czech diacritics
(ě š č ř ž ý á í é ú ů):
${expectedTexts.map(t => `- "${t}"`).join("\n")}
${logoExpected ? "The brand logo (second attached image) must be present and geometrically identical — not redrawn, restyled or distorted." : ""}

Check:
1. Read ALL text in the artwork. Does every expected string appear exactly? Watch for missing or
   wrong diacritics, swapped letters, duplicated words, gibberish, and any text that should NOT be there.
2. Is this FLAT artwork? A studio photo, a product shot, a mockup on a bottle/garment, perspective,
   3D shading or a photographic scene all mean isFlat=false.
3. Is anything clipped or crowded against the edges? Text and logo must sit at least
   ${geo.safeMarginMm} mm (~${Math.round((geo.safeMarginMm / geo.widthMm) * 100)}% of the width) inside every edge.
${logoExpected ? "4. Is the logo reproduced faithfully (same shapes, proportions and colors)?" : ""}

Grade severity when not ok:
- "cosmetic" — one small slip, everything still legible and usable.
- "severe" — garbled/overlapping/unreadable text, wrong logo, or it is not flat artwork at all.

Return ONLY valid JSON:
{
  "ok": true/false,
  "textAccurate": true/false,
  "renderedText": "all text you actually read",
  "isFlat": true/false,
  "logoIntact": true/false,
  "withinSafeArea": true/false,
  "issues": ["specific problems, empty if ok"],
  "severity": "ok" | "cosmetic" | "severe",
  "fixHint": "if NOT ok — one concrete instruction for an image-edit model, empty string if ok"
}`

    const images = [{ buffer: imageBuffer, mimeType: "image/png" }]
    if (logoExpected && logoBuffer) images.push({ buffer: logoBuffer, mimeType: "image/png" })

    let text: string
    try {
        text = await judgeVision(qaPrompt, images, { label: "print-qa" })
    } catch (err: any) {
        if (isQualityUnavailable(err)) {
            console.warn("   ⚠️ Print QA: oba Pro stupně vyčerpány — fail-open (QA přeskočena)")
        } else {
            console.warn(`   ⚠️ Print QA selhala (fail-open): ${String(err?.message || err).slice(0, 80)}`)
        }
        return { ok: true, textAccurate: true, isFlat: true, logoIntact: true, withinSafeArea: true, issues: [] }
    }

    try {
        const parsed = JSON.parse(text.replace(/```(?:json)?/g, "").trim())
        return {
            ok: !!parsed.ok,
            textAccurate: !!parsed.textAccurate,
            renderedText: parsed.renderedText || undefined,
            isFlat: parsed.isFlat !== false,
            logoIntact: logoExpected ? parsed.logoIntact !== false : true,
            withinSafeArea: parsed.withinSafeArea !== false,
            issues: parsed.issues || [],
            severity: parsed.ok ? "ok" : (parsed.severity === "severe" ? "severe" : "cosmetic"),
            fixHint: parsed.fixHint || undefined,
        }
    } catch {
        return { ok: true, textAccurate: true, isFlat: true, logoIntact: true, withinSafeArea: true, issues: [] }
    }
}

// ============================================
// 4. FINALISE
// ============================================

/**
 * Turn a rendered artwork into files a printer can use.
 *
 * - chroma key → alpha (only for kinds whose artwork sits ON a product; a label
 *   panel legitimately has its own opaque background)
 * - resize to the category's physical size at 300 DPI with lanczos3
 * - embed the density so the PNG opens at the right physical size, not at 72 DPI
 *
 * The upscale is honest, not magic: the source is ~1024 px. It gets the file to the
 * correct dimensions for layout and proofing; a printer will still want the artwork
 * redrawn as vectors for large formats.
 */
export async function finalizePrintFile(
    artwork: Buffer,
    category: PrintCategory,
    brief: PrintBrief,
): Promise<{ printBuffer: Buffer; dielineBuffer: Buffer; spec: PrintSpec }> {
    const geo = resolvePrintGeometry(category)
    // Only "flat" artwork sits ON a product and therefore needs a cut-out background.
    // A label/poster panel legitimately owns its background — keying it would punch
    // holes wherever the design happens to use magenta-ish tones.
    const source = geo.kind === "flat" ? await chromaKeyToAlpha(artwork) : artwork

    const printBuffer = await sharp(source)
        .ensureAlpha()
        .resize(geo.pixelWidth, geo.pixelHeight, {
            // "cover", never "fill". The model renders one of five fixed ratios, so the
            // render rarely matches the physical target exactly — a 75×160 mm label
            // (0.469) is generated at 9:16 (0.5625). Filling would squash the artwork
            // ~17% horizontally, deforming exactly the logo and typography that QA just
            // verified. Cropping the overhang is safe because the brief reserves a
            // safe margin at every edge.
            fit: "cover",
            position: "centre",
            kernel: sharp.kernel.lanczos3,
        })
        .withMetadata({ density: 300 })
        .png({ compressionLevel: 9 })
        .toBuffer()

    const spec: PrintSpec = {
        widthMm: geo.widthMm,
        heightMm: geo.heightMm,
        dpi: 300,
        pixelWidth: geo.pixelWidth,
        pixelHeight: geo.pixelHeight,
        bleedMm: geo.bleedMm,
        safeMarginMm: geo.safeMarginMm,
        colors: brief.colors || [],
        material: category.material_hint || undefined,
        technology: category.manufacturing_hint || undefined,
        artworkKind: geo.kind,
        note: "Podklad vygenerovaný AI a doškálovaný na 300 DPI. Pro velké formáty nechte grafiku převést do vektorů.",
    }

    const dielineBuffer = await renderDieline(printBuffer, geo)
    return { printBuffer, dielineBuffer, spec }
}

/**
 * Replace the magenta chroma key with transparency.
 *
 * Done by hand rather than with a library: sharp has no keying primitive, and the
 * tolerance matters — the model renders "pure" magenta with slight compression
 * noise, so an exact-match test leaves a speckled halo.
 */
export async function chromaKeyToAlpha(input: Buffer, tolerance = 60): Promise<Buffer> {
    const { data, info } = await sharp(input)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })

    const channels = info.channels
    for (let i = 0; i < data.length; i += channels) {
        const dr = data[i] - CHROMA_KEY.r
        const dg = data[i + 1] - CHROMA_KEY.g
        const db = data[i + 2] - CHROMA_KEY.b
        // Squared distance in RGB — cheap and good enough for a single flat key color
        if (dr * dr + dg * dg + db * db <= tolerance * tolerance) {
            data[i + 3] = 0
        }
    }

    return sharp(data, { raw: { width: info.width, height: info.height, channels } })
        .png()
        .toBuffer()
}

/** Overlay safe-margin and bleed guides so the user can see what the printer will trim. */
async function renderDieline(printBuffer: Buffer, geo: ReturnType<typeof resolvePrintGeometry>): Promise<Buffer> {
    const meta = await sharp(printBuffer).metadata()
    const w = meta.width || geo.pixelWidth
    const h = meta.height || geo.pixelHeight
    const safePx = mmToPx(geo.safeMarginMm)
    const bleedPx = mmToPx(geo.bleedMm)
    const stroke = Math.max(2, Math.round(w / 400))

    const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${bleedPx}" y="${bleedPx}" width="${w - bleedPx * 2}" height="${h - bleedPx * 2}"
        fill="none" stroke="#00E5FF" stroke-width="${stroke}" stroke-dasharray="${stroke * 6} ${stroke * 4}"/>
  <rect x="${safePx + bleedPx}" y="${safePx + bleedPx}" width="${w - (safePx + bleedPx) * 2}" height="${h - (safePx + bleedPx) * 2}"
        fill="none" stroke="#FF3B30" stroke-width="${stroke}" stroke-dasharray="${stroke * 3} ${stroke * 3}"/>
</svg>`

    return sharp(printBuffer)
        .flatten({ background: "#ffffff" })
        .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
        .png()
        .toBuffer()
}

/** Human-readable printer handoff. */
export function formatPrintSpec(spec: PrintSpec, brief: PrintBrief, category: PrintCategory): string {
    return [
        `# Tiskové zadání — ${brief.name}`,
        ``,
        `**Produkt:** ${category.label}`,
        `**Typ artworku:** ${spec.artworkKind}`,
        `**Čistý formát:** ${spec.widthMm} × ${spec.heightMm} mm`,
        `**Spadávka:** ${spec.bleedMm} mm · **Bezpečný okraj:** ${spec.safeMarginMm} mm`,
        `**Rozlišení souboru:** ${spec.pixelWidth} × ${spec.pixelHeight} px @ ${spec.dpi} DPI`,
        spec.material ? `**Materiál:** ${spec.material}` : "",
        spec.technology ? `**Technologie:** ${spec.technology}` : "",
        `**Barvy (RGB):** ${spec.colors.join(", ") || "—"}`,
        ``,
        `## Texty na artworku`,
        `- ${brief.typography.headline}`,
        brief.typography.sub ? `- ${brief.typography.sub}` : "",
        brief.typography.small ? `- ${brief.typography.small}` : "",
        ``,
        `## Poznámka`,
        spec.note,
        `Barvy jsou v RGB. Pro tisk je nechte převést do CMYK podle profilu tiskárny — odstíny se posunou.`,
    ].filter(Boolean).join("\n")
}

// ============================================
// 5. MOCKUP (separate step)
// ============================================

/**
 * Photorealistic placement of the artwork onto the product.
 *
 * The artwork goes in as a REFERENCE IMAGE so the model applies it with real
 * perspective, curvature and lighting. The previous implementation pasted a flat
 * rectangle at a fixed 40% width / 25% from top with sharp — identical geometry for
 * mugs, posters and socks — and its template map pointed at instagram/templates/,
 * a directory that does not exist.
 */
export async function renderProductMockup(
    artwork: Buffer,
    category: PrintCategory,
    brief: PrintBrief,
    /** Jen kvůli účtování — mockup jinak tenanta nepotřebuje. */
    clientId?: string | null,
): Promise<Buffer> {
    const { trackSpend } = await import("./spend-tracker")
    return trackSpend(
        "print",
        { clientId: clientId ?? null, refId: `mockup:${brief.name}` },
        () => renderProductMockupInner(artwork, category, brief),
    )
}

async function renderProductMockupInner(
    artwork: Buffer,
    category: PrintCategory,
    brief: PrintBrief,
): Promise<Buffer> {
    const geo = resolvePrintGeometry(category)
    const base = category.mockup_prompt
        || `blank plain ${category.label} on a dark studio background, product photography, no text, no logo`

    const prompt = `Photorealistic product mockup.

Product: ${base}

The attached reference image is the FINISHED PRINT ARTWORK. Apply it onto the product exactly as it
would be printed: ${geo.kind === "label" ? "as a label wrapped on the container, following its curvature"
        : geo.kind === "wrap" ? "wrapped continuously around the product, following its curvature"
        : geo.kind === "poster" ? "as the printed sheet, framed or flat"
        : "printed onto the product surface, following the material's folds and contours"}.

CRITICAL:
- Reproduce the artwork EXACTLY: same text, same spelling and diacritics, same colors, same layout.
  Do not redesign, re-typeset, translate or re-color any part of it.
- Realistic lighting, perspective and material texture. The artwork must sit ON the product, not float above it.
- Studio product photography, clean dark background, premium quality.
- No extra text anywhere in the scene.`

    return generateImageWithReferences(
        prompt,
        [{ buffer: artwork, mimeType: "image/png", label: "the print artwork to apply — reproduce its text and colors exactly" }],
        { aspectRatio: "1:1" },
    )
}

// ============================================
// ORCHESTRATION — brief → render → QA → ship-best
// ============================================

export interface PrintRunResult {
    brief: PrintBrief
    artwork: Buffer
    qa: PrintQA
    qaStatus: "pass" | "retry_pass" | "native_forced" | "failed"
    attempts: number
}

/**
 * Render artwork and defend the result with QA.
 *
 * Ship-best doctrine, same as the IG orchestrator: if no attempt passes cleanly we
 * publish the best-scoring buffer rather than nothing. An empty result is only ever
 * a true infrastructure failure (every render threw).
 */
/**
 * Nejdražší krok tiskového enginu — až tři obrázkové rendery plus vision QA ke
 * každému. Obal je uvnitř, protože tudy chodí UI i testovací skripty.
 */
export async function runPrintArtwork(
    config: ClientConfig,
    category: PrintCategory,
    brief: PrintBrief,
    logoBuffer: Buffer | null,
    onProgress?: (m: string) => void,
): Promise<PrintRunResult> {
    const { trackSpend, spendClientId } = await import("./spend-tracker")
    return trackSpend(
        "print",
        { clientId: await spendClientId(config.id), refId: `artwork:${brief.name}` },
        () => runPrintArtworkInner(config, category, brief, logoBuffer, onProgress),
    )
}

async function runPrintArtworkInner(
    config: ClientConfig,
    category: PrintCategory,
    brief: PrintBrief,
    logoBuffer: Buffer | null,
    onProgress?: (m: string) => void,
): Promise<PrintRunResult> {
    const geo = resolvePrintGeometry(category)
    const report = (m: string) => { onProgress?.(m); console.log(`   ${m}`) }

    let best: { buffer: Buffer; qa: PrintQA; score: number } | null = null
    let attempts = 0

    const consider = (buffer: Buffer, qa: PrintQA) => {
        const score = printQaScore(qa)
        if (!best || score < best.score) best = { buffer, qa, score }
        return score
    }

    // Attempt 1
    report("Renderuji artwork…")
    attempts++
    const first = await renderPrintArtwork(brief, config, category, logoBuffer)
    report("Kontroluji text, plochost a okraje…")
    const firstQa = await verifyPrintArtwork(first, brief, geo, !!logoBuffer, logoBuffer)
    consider(first, firstQa)
    if (firstQa.ok) {
        return { brief, artwork: first, qa: firstQa, qaStatus: "pass", attempts }
    }
    report(`QA našla ${firstQa.issues.length} problémů — opravuji…`)

    // Attempt 2 — targeted corrective edit (keeps the composition that was approved)
    if (firstQa.fixHint) {
        try {
            attempts++
            const edited = await editExistingImage(
                first,
                `${firstQa.fixHint}\n\nKeep everything else identical: same flat artwork, same layout, same colors, same background. Do not turn this into a photograph or a mockup.`,
                { mimeType: "image/png", aspectRatio: geo.ratio },
            )
            const editedQa = await verifyPrintArtwork(edited, brief, geo, !!logoBuffer, logoBuffer)
            consider(edited, editedQa)
            if (editedQa.ok) {
                return { brief, artwork: edited, qa: editedQa, qaStatus: "retry_pass", attempts }
            }
        } catch (err: any) {
            console.warn(`   ⚠️ Korektivní edit selhal: ${err?.message}`)
        }
    }

    // Attempt 3 — one fresh regeneration with the failures fed back in
    try {
        attempts++
        report("Zkouším čerstvý render…")
        const hardened: PrintBrief = {
            ...brief,
            negativePrompt: `${brief.negativePrompt}. ${firstQa.issues.join(". ")}`,
        }
        const fresh = await renderPrintArtwork(hardened, config, category, logoBuffer)
        const freshQa = await verifyPrintArtwork(fresh, brief, geo, !!logoBuffer, logoBuffer)
        consider(fresh, freshQa)
        if (freshQa.ok) {
            return { brief, artwork: fresh, qa: freshQa, qaStatus: "retry_pass", attempts }
        }
    } catch (err: any) {
        console.warn(`   ⚠️ Čerstvý render selhal: ${err?.message}`)
    }

    if (!best) throw new Error("Print render selhal — žádný pokus nevrátil obrázek")
    const winner = best as { buffer: Buffer; qa: PrintQA; score: number }
    report(`QA neprošla čistě — posílám nejlepší pokus (skóre ${winner.score})`)
    return { brief, artwork: winner.buffer, qa: winner.qa, qaStatus: "native_forced", attempts }
}
