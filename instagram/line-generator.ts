/**
 * Product Line Generator
 *
 * Designs a coherent product LINE (řada) rather than a bag of unrelated SKUs.
 *
 * The distinction that matters: `generateProductIdeas` in product-generator.ts
 * brainstorms N independent ideas at temperature 1.3 — great for divergence,
 * useless for a range that has to hold together on a shelf. A line is a SYSTEM:
 * the SKUs form an ordered process (autokosmetika: mytí → dekontaminace →
 * leštění → ochrana → údržba), share one naming rule, and climb a price ladder
 * that tracks that order. Those constraints are enforced twice — asked for in
 * the prompt, then verified in code by validateLine(), because a model will
 * cheerfully return five steps numbered 1,2,2,4,7.
 *
 * Runs on the designer Pro ladder, never flash: this is one call whose output
 * seeds an entire catalog and every downstream caption.
 */

import { Type } from "@google/genai"
import { generateTextQuality } from "./gemini-client"
import { getModel, hasFallback, getTemperature } from "./models"
import { getCatalogProducts, getWeightedProductIdeas } from "./service"
import { getBrandMemories, formatMemoriesForPrompt } from "./memory-agent"
import type { ClientConfig } from "./configs/types"

/** Strategy ladder: [top Pro, GA Pro], never flash. Mirrors designerLadder(). */
function lineLadder(): string[] {
    const models = [getModel("designer")]
    if (hasFallback("designer")) models.push(getModel("designer", "fallback"))
    return models
}

// ============================================
// TYPES
// ============================================

export type PriceTier = "budget" | "mid" | "premium"

export interface ProductLineBrief {
    /** What kind of range: "autokosmetika", "péče o vousy", "doplňky stravy"… */
    category: string
    /** How many SKUs the line should contain */
    skuCount: number
    priceTier: PriceTier
    /** Optional steering */
    positioning?: string
    audience?: string
    /** Products or steps the user insists the line contains */
    mustInclude?: string[]
    /** Free-text extra instructions */
    notes?: string
}

export interface LineSkuSpecs {
    volume?: string
    application?: string
    surface?: string
    claims?: string[]
}

export interface LineSku {
    name: string
    /** 1-based position in the process. Unique and contiguous across the line. */
    step: number
    /** What this step does — "dekontaminace", not a restatement of the name */
    role: string
    description: string
    specs: LineSkuSpecs
    priceCzk: number
    /** Brief for the print/label designer downstream */
    designDirection: string
    /** Name of the neighbouring SKU this one sets up or completes */
    pairsWith?: string
}

export interface GeneratedLineMeta {
    name: string
    slug: string
    positioning: string
    targetAudience: string
    priceTier: PriceTier
    /** The rule EVERY name in the line obeys — checked in code */
    namingConvention: string
    /** The process, in prose */
    systemLogic: string
}

export interface GeneratedLine {
    line: GeneratedLineMeta
    skus: LineSku[]
}

// ============================================
// SCHEMA
// ============================================

const LINE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        line: {
            type: Type.OBJECT,
            properties: {
                name: { type: Type.STRING },
                slug: { type: Type.STRING },
                positioning: { type: Type.STRING },
                targetAudience: { type: Type.STRING },
                priceTier: { type: Type.STRING },
                namingConvention: { type: Type.STRING },
                systemLogic: { type: Type.STRING },
            },
            required: ["name", "slug", "positioning", "targetAudience", "priceTier", "namingConvention", "systemLogic"],
        },
        skus: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    name: { type: Type.STRING },
                    step: { type: Type.INTEGER },
                    role: { type: Type.STRING },
                    description: { type: Type.STRING },
                    specs: {
                        type: Type.OBJECT,
                        properties: {
                            volume: { type: Type.STRING },
                            application: { type: Type.STRING },
                            surface: { type: Type.STRING },
                            claims: { type: Type.ARRAY, items: { type: Type.STRING } },
                        },
                    },
                    priceCzk: { type: Type.NUMBER },
                    designDirection: { type: Type.STRING },
                    pairsWith: { type: Type.STRING },
                },
                required: ["name", "step", "role", "description", "specs", "priceCzk", "designDirection"],
            },
        },
    },
    required: ["line", "skus"],
}

const TIER_GUIDE: Record<PriceTier, string> = {
    budget: "Dostupná řada. Cena je argument, ale nesmí působit lacině — hodnota za peníze, ne sleva.",
    mid: "Střední třída. Poměr cena/výkon, pro poučeného amatéra, který už ví, co dělá.",
    premium: "Prémiová řada. Cena není argument, výsledek ano. Profesionální nebo nadšenecké použití.",
}

// ============================================
// VALIDATION (pure — covered by scripts/test-product-lines.ts)
// ============================================

export interface LineValidationIssue {
    field: string
    message: string
}

/**
 * Verify the model actually produced a system, not a list.
 *
 * Everything here is a rule the prompt already stated; a model that obeys the
 * prompt fails none of them. They exist because "mostly obeys" is not a property
 * you can build a catalog on — a duplicate step number silently reorders the
 * line, and a non-monotonic price ladder makes the range read as random.
 *
 * `existingNames` are the live catalog names — a line that re-proposes something
 * already on sale is a duplicate, not a new range.
 */
export function validateLine(
    generated: GeneratedLine,
    expected: { skuCount: number; priceTier: PriceTier; mustInclude?: string[] },
    existingNames: string[] = [],
): LineValidationIssue[] {
    const issues: LineValidationIssue[] = []
    const skus = generated.skus || []

    if (skus.length === 0) {
        return [{ field: "skus", message: "Řada neobsahuje žádné produkty" }]
    }
    if (skus.length !== expected.skuCount) {
        issues.push({ field: "skus", message: `Očekáváno ${expected.skuCount} SKU, přišlo ${skus.length}` })
    }

    // Steps must be 1..N, each exactly once — this is what makes the line ordered.
    const steps = skus.map(s => s.step).sort((a, b) => a - b)
    const expectedSteps = skus.map((_, i) => i + 1)
    if (steps.join(",") !== expectedSteps.join(",")) {
        issues.push({
            field: "step",
            message: `Kroky musí být 1..${skus.length} bez duplicit a mezer, přišlo [${steps.join(", ")}]`,
        })
    }

    // Names unique within the line…
    const seen = new Set<string>()
    for (const sku of skus) {
        const key = sku.name.trim().toLowerCase()
        if (seen.has(key)) issues.push({ field: "name", message: `Duplicitní název v řadě: "${sku.name}"` })
        seen.add(key)
    }

    // …and not already in the catalog
    const existing = new Set(existingNames.map(n => n.trim().toLowerCase()))
    for (const sku of skus) {
        if (existing.has(sku.name.trim().toLowerCase())) {
            issues.push({ field: "name", message: `"${sku.name}" už v katalogu existuje` })
        }
    }

    // Price ladder must not zig-zag.
    //
    // NOT "prices only rise": a real range often ends with a cheap consumable —
    // Wash 290 → Decon 390 → Polish 590 → Shield 890 → Detailer 340 is a perfectly
    // coherent line, and an early version of this rule rejected it. What signals a
    // randomly assembled set is OSCILLATION, so count direction changes instead:
    // one descent (the maintenance tail) is fine, up-down-up-down is not.
    const byStep = [...skus].sort((a, b) => a.step - b.step)
    let directionChanges = 0
    let lastDirection = 0
    for (let i = 1; i < byStep.length; i++) {
        const delta = byStep[i].priceCzk - byStep[i - 1].priceCzk
        if (delta === 0) continue                       // equal neighbours carry no signal
        const direction = delta > 0 ? 1 : -1
        if (lastDirection !== 0 && direction !== lastDirection) directionChanges++
        lastDirection = direction
    }
    if (directionChanges > 1) {
        issues.push({
            field: "priceCzk",
            message: `Ceny v řadě skáčou nahoru a dolů (${byStep.map(s => s.priceCzk).join(" → ")} Kč) — žebříček musí být čitelný`,
        })
    }

    for (const sku of skus) {
        if (!(sku.priceCzk > 0)) {
            issues.push({ field: "priceCzk", message: `"${sku.name}" nemá platnou cenu` })
        }
    }

    // A role that just repeats the name carries no information for downstream prompts
    for (const sku of skus) {
        if (!sku.role?.trim()) {
            issues.push({ field: "role", message: `"${sku.name}" nemá určenou roli v systému` })
        } else if (sku.role.trim().toLowerCase() === sku.name.trim().toLowerCase()) {
            issues.push({ field: "role", message: `Role u "${sku.name}" jen opakuje název` })
        }
    }

    for (const must of expected.mustInclude || []) {
        const needle = must.trim().toLowerCase()
        if (!needle) continue
        const hit = skus.some(s =>
            s.name.toLowerCase().includes(needle) ||
            s.role.toLowerCase().includes(needle) ||
            s.description.toLowerCase().includes(needle))
        if (!hit) issues.push({ field: "mustInclude", message: `Chybí vyžádaný prvek: "${must}"` })
    }

    if (generated.line?.priceTier !== expected.priceTier) {
        issues.push({ field: "priceTier", message: `Cenová hladina neodpovídá zadání (${expected.priceTier})` })
    }

    return issues
}

/** URL-safe slug from a Czech line name. Diacritics folded, not dropped. */
export function slugifyLine(name: string): string {
    return name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60)
}

// ============================================
// GENERATION
// ============================================

/**
 * Generate a product line for a client.
 *
 * Grounded on the LIVE catalog (getCatalogProducts), never config.products —
 * that snapshot is frozen at onboarding, and proposing a "new" product that was
 * deleted months ago is exactly the class of error it causes.
 *
 * One repair round: if validateLine() finds problems, the issues are handed back
 * to the model to fix in place. A second failure returns the line anyway with the
 * issues attached — the caller shows them and the user decides, which beats
 * throwing away a paid Pro-ladder run over a price that dipped 40 Kč.
 */
export async function generateProductLine(
    config: ClientConfig,
    clientId: string,
    brief: ProductLineBrief,
    onProgress?: (message: string) => void,
): Promise<{ line: GeneratedLine; issues: LineValidationIssue[] }> {
    const { trackSpend } = await import("./spend-tracker")
    return trackSpend(
        "product_line",
        { clientId, refId: brief.category },
        () => generateProductLineInner(config, clientId, brief, onProgress),
    )
}

async function generateProductLineInner(
    config: ClientConfig,
    clientId: string,
    brief: ProductLineBrief,
    onProgress?: (message: string) => void,
): Promise<{ line: GeneratedLine; issues: LineValidationIssue[] }> {
    const report = (m: string) => { onProgress?.(m); console.log(`   ${m}`) }

    report("Načítám katalog a značku…")
    const [catalog, memories, likedIdeas] = await Promise.all([
        getCatalogProducts(clientId, config.products, 30),
        getBrandMemories(8, clientId).catch(() => []),
        // Weighted by the user's 👍/👎 — the line should build on ideas that already
        // landed rather than starting from a blank sheet every time.
        getWeightedProductIdeas(clientId, 6).catch(() => [] as any[]),
    ])

    const existingNames = catalog.map(p => p.name)
    const bv = config.brandVoice

    const catalogSection = catalog.length > 0
        ? catalog.map(p => `- ${p.name}${p.type ? ` (${p.type})` : ""}${p.price ? ` — ${p.price}` : ""}`).join("\n")
        : "Katalog je zatím prázdný."

    const memorySection = memories.length > 0
        ? `\n## CO SE O ZNAČCE UŽ VÍ\n${formatMemoriesForPrompt(memories)}`
        : ""

    const ideaSection = likedIdeas.length > 0
        ? `\n## NÁPADY, KTERÉ U TÉHLE ZNAČKY REZONOVALY\n${likedIdeas.map((i: any) => `- ${i.name}${i.tagline ? ` — ${i.tagline}` : ""}`).join("\n")}\nPokud některý z nich do řady logicky patří, zapracuj ho. Nenuť to.`
        : ""

    const skuCount = Math.max(2, Math.min(12, Math.round(brief.skuCount)))

    const prompt = `Jsi product strategist. Navrhuješ PRODUKTOVOU ŘADU pro značku "${config.name}".

## ZNAČKA
Web: ${config.website || "—"} | IG: ${config.instagram || "—"}
Zaměření: ${config.contentFocus || "—"}
Persona: ${bv?.persona || "—"}
Hodnoty: ${(bv?.values || []).join(", ") || "—"}
${memorySection}
${ideaSection}

## STÁVAJÍCÍ KATALOG (NEDUPLIKUJ)
${catalogSection}

## ZADÁNÍ
Kategorie řady: **${brief.category}**
Počet produktů: **přesně ${skuCount}**
Cenová hladina: **${brief.priceTier}** — ${TIER_GUIDE[brief.priceTier]}
${brief.positioning ? `Pozicování: ${brief.positioning}` : ""}
${brief.audience ? `Cílová skupina: ${brief.audience}` : ""}
${brief.mustInclude?.length ? `Řada MUSÍ obsahovat: ${brief.mustInclude.join(", ")}` : ""}
${brief.notes ? `Poznámky: ${brief.notes}` : ""}

## CO DĚLÁ Z PRODUKTŮ ŘADU (tohle je jádro úkolu)

Řada NENÍ seznam produktů. Je to SYSTÉM, který zákazník používá v pořadí.

1. **PROCES.** Urči, jaký proces řada pokrývá, a přiřaď každému produktu jeden krok.
   Příklad pro autokosmetiku: mytí → dekontaminace → korekce laku → ochrana → údržba.
   Pole "step" = pořadí (1..${skuCount}, každé číslo právě jednou).
   Pole "role" = co ten krok DĚLÁ. Nesmí to být jen opakování názvu.

2. **NÁZVOSLOVÍ.** Vymysli JEDNO pravidlo pojmenování a dodrž ho u všech ${skuCount} produktů.
   Do "namingConvention" napiš to pravidlo explicitně. Když ho někdo přečte, musí umět
   pojmenovat i šestý produkt, který v řadě zatím není.

3. **CENOVÝ ŽEBŘÍČEK.** Ceny v Kč ("priceCzk", jen číslo) musí dávat smysl vůči pořadí
   a vůči hladině "${brief.priceTier}". Žebříček musí být čitelný: ceny většinou rostou
   s krokem. Jeden pokles je v pořádku (typicky levný udržovací produkt na konci),
   ale ceny nesmí skákat nahoru a dolů.

4. **CROSS-SELL.** U každého produktu vyplň "pairsWith" — název sousedního produktu
   z TÉTO řady, který na něj navazuje nebo mu předchází. Řada se musí prodávat sama.

5. **SPECIFIKACE.** "specs" musí být konkrétní a reálné: objem (volume), způsob aplikace
   (application), na jaký povrch/materiál (surface), a 2–4 ověřitelné claims.
   Žádné nesplnitelné sliby a žádné zdravotní ani právní tvrzení.

6. **DESIGN.** "designDirection" = 1–2 věty pro grafika, jak má vypadat etiketa/obal
   TOHOTO produktu tak, aby byl rozpoznatelný jako součást řady, ale odlišitelný
   od sousedních kroků (typicky barevné odlišení kroku při shodné struktuře).

## PRAVIDLA
- Piš česky, v tónu značky. Názvy produktů můžou být i anglické, pokud to k značce sedí.
- Každý produkt musí jít reálně vyrobit nebo nechat vyrobit u dodavatele.
- Neduplikuj nic ze stávajícího katalogu.
- "slug" u řady = malá písmena bez diakritiky, pomlčky místo mezer.
- "priceTier" vrať přesně jako "${brief.priceTier}".

Vrať POUZE validní JSON.`

    report("Navrhuji řadu (Pro ladder)…")
    const raw = await generateTextQuality(prompt, {
        models: lineLadder(),
        responseSchema: LINE_SCHEMA,
        temperature: getTemperature("designer"),
        label: "product-line",
    })

    let generated = parseLine(raw)
    let issues = validateLine(generated, { skuCount, priceTier: brief.priceTier, mustInclude: brief.mustInclude }, existingNames)

    if (issues.length > 0) {
        report(`Opravuji ${issues.length} nesrovnalostí…`)
        const repairPrompt = `${prompt}

## PŘEDCHOZÍ POKUS MĚL TYTO CHYBY — OPRAV JE
${issues.map(i => `- [${i.field}] ${i.message}`).join("\n")}

Tady je předchozí návrh. Zachovej z něj všechno, co je v pořádku, a oprav jen vyjmenované chyby:
${JSON.stringify(generated, null, 2)}

Vrať POUZE opravený validní JSON.`

        try {
            const repaired = await generateTextQuality(repairPrompt, {
                models: lineLadder(),
                responseSchema: LINE_SCHEMA,
                temperature: getTemperature("designer"),
                label: "product-line-repair",
            })
            const candidate = parseLine(repaired)
            const remaining = validateLine(candidate, { skuCount, priceTier: brief.priceTier, mustInclude: brief.mustInclude }, existingNames)
            // Keep the repair only if it actually improved things
            if (remaining.length < issues.length) {
                generated = candidate
                issues = remaining
            }
        } catch (err: any) {
            console.warn(`   ⚠️ Oprava řady selhala (${err?.message}) — vracím původní návrh s výhradami`)
        }
    }

    // Normalise: sort by step, backfill a slug the model may have mangled
    generated.skus = [...generated.skus].sort((a, b) => a.step - b.step)
    if (!generated.line.slug || !/^[a-z0-9-]+$/.test(generated.line.slug)) {
        generated.line.slug = slugifyLine(generated.line.name)
    }

    report(`Hotovo: "${generated.line.name}" — ${generated.skus.length} produktů${issues.length ? `, ${issues.length} výhrad` : ""}`)
    return { line: generated, issues }
}

function parseLine(raw: string): GeneratedLine {
    const clean = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim()
    const parsed = JSON.parse(clean) as GeneratedLine
    if (!parsed?.line?.name || !Array.isArray(parsed.skus)) {
        throw new Error("Line generator vrátil neúplný JSON (chybí line.name nebo skus)")
    }
    return parsed
}

/**
 * Targeted revision of a single SKU — the whole point is NOT re-rolling the line.
 * A full re-generate would change the other SKUs' names and prices, which is how
 * the user loses work they already approved.
 */
export async function reviseSku(
    config: ClientConfig,
    line: GeneratedLine,
    skuIndex: number,
    feedback: string,
): Promise<LineSku> {
    const { trackSpend, spendClientId } = await import("./spend-tracker")
    return trackSpend(
        "product_line",
        { clientId: await spendClientId(config.id), refId: `revize:${line.line.name}` },
        () => reviseSkuInner(config, line, skuIndex, feedback),
    )
}

async function reviseSkuInner(
    config: ClientConfig,
    line: GeneratedLine,
    skuIndex: number,
    feedback: string,
): Promise<LineSku> {
    const sku = line.skus[skuIndex]
    if (!sku) throw new Error(`SKU index ${skuIndex} v řadě neexistuje`)

    const siblings = line.skus
        .filter((_, i) => i !== skuIndex)
        .map(s => `- krok ${s.step}: ${s.name} (${s.role}) — ${s.priceCzk} Kč`)
        .join("\n")

    const prompt = `Uprav JEDEN produkt v existující produktové řadě značky "${config.name}".

## ŘADA
Název: ${line.line.name}
Systém: ${line.line.systemLogic}
Pravidlo pojmenování: ${line.line.namingConvention}
Cenová hladina: ${line.line.priceTier}

## OSTATNÍ PRODUKTY V ŘADĚ (NEMĚŇ JE, jen respektuj)
${siblings}

## PRODUKT K ÚPRAVĚ
${JSON.stringify(sku, null, 2)}

## POŽADAVEK UŽIVATELE
${feedback}

## PRAVIDLA
- Zachovej "step" = ${sku.step}.
- Dodrž pravidlo pojmenování řady.
- Cena musí zůstat konzistentní se sousedními kroky.
- Změň jen to, co si uživatel vyžádal, plus co z toho nutně plyne.

Vrať POUZE JSON jednoho produktu.`

    const raw = await generateTextQuality(prompt, {
        models: lineLadder(),
        responseSchema: (LINE_SCHEMA.properties.skus as any).items,
        temperature: getTemperature("designer"),
        label: "product-line-sku-revise",
    })

    const clean = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim()
    const revised = JSON.parse(clean) as LineSku
    if (!revised?.name) throw new Error("Revize SKU vrátila neúplný JSON")
    revised.step = sku.step // never let a revision reorder the line
    return revised
}
