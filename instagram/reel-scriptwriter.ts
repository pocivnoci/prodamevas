/**
 * Scenárista reelů — specialista na video mezi copywriterem a kritikem.
 * =====================================================================
 * Do 9/2026 psal narraci reelu copywriter v tomtéž mega promptu jako feedové
 * posty, kostrou HOOK → VALUE → CTA. Scénář byl tím pádem vedlejší produkt
 * textového postu: žádný hook systém, žádná zpětná vazba z výkonu reelů, a
 * z toho, co o klientovi víme, se do videa dostal zlomek
 * (docs/DESIGN_reels-v2_2026-09-12.md, diagnóza „Scénář" a „Data o klientovi").
 *
 * Reel má JEDINÝ úkol: zastavit palec a udržet pozornost do CTA. Proto:
 *
 *  - Běží na **Claude Opus 5** (`models.ts` → `reelScript`), jiná rodina než
 *    copywriter — druhý pohled bez sebepreference, stejný důvod jako u soudce.
 *    Žebřík: Opus 5 → Sonnet 5 → Gemini `textPro` Pro ladder se STEJNÝM JSON
 *    schématem. Flash sem nesmí; `QualityUnavailableError` z ladderu prochází
 *    beze změny (job se zaparkuje, nedegraduje).
 *  - Dostane **všechno, co o klientovi víme**: ověřená fakta, živý katalog
 *    produktů, popisy brandových fotek (co reálně existuje k natočení), ukázky
 *    hlasu, recenze, oborový vizuální profil, rizikovou rodinu oboru, signály
 *    (svátky/počasí) a **výkon vlastních reelů**.
 *  - Vybírá z pojmenované palety **hook vzorů** (`lib/hook-patterns.ts`), která
 *    se váží podle naměřeného výkonu u téhle značky a vylučuje vzory posledních
 *    reelů. Zvolený vzor se ukládá k postu, takže smyčka pokračuje.
 *
 * Co scenárista NEDĚLÁ: nepíše caption ani hashtagy (ty zůstávají copywriterovi)
 * a jeho narrace **není výjimka z bran** — autopilot ji vkládá PŘED kritika,
 * redakci i faktickou bránu, takže prochází přesně tím, čím procházel copywriter.
 */

import { Type } from "@google/genai"
import type { ClientConfig, PostTypeDef } from "./configs/types"
import type { CtaPolicy } from "./cta-policy"
import type { SelectedProduct } from "./orchestrators/types"
import { generateTextQuality } from "./gemini-client"
import { getModel, hasFallback, getTemperature } from "./models"
import { writeWithClaude } from "./anthropic-client"
import { buildFactsSection } from "./caption-generator"
import {
    HOOK_PATTERNS, formatHookPatterns, hookPatternStats, isHookPatternId, pickHookPatterns,
    type HookPattern, type HookPatternStat, type ScoredReel,
} from "@/lib/hook-patterns"
import { engagementScore } from "@/lib/engagement"
import { industryRiskFamily, type IndustryRiskFamily } from "@/lib/industry-risk"
import { clampReelModes, plannedNarrationSentences, plannedNarrationWords, type ReelMedium, type ReelMode } from "@/lib/reel-media"

// ─── Typy ───────────────────────────────────────────────────────────────────

export type { ReelMode }

export interface ReelBeat {
    /** Mluvené slovo (režim `voiceover`). */
    narration?: string
    /** Textová karta (režim `text`) — orchestrátor z ní staví osu bez TTS. */
    card?: string
    /** Co je v záběru — anglicky, konkrétně. */
    visual: string
    camera: string
    mood: string
    sfx?: string
}

export interface ReelScript {
    /** ID vzoru z `lib/hook-patterns.ts` — ukládá se k postu a váží příští výběr. */
    hookPattern: string
    /** Mluvený hook (první věta). */
    hook: string
    mode: ReelMode
    beats: ReelBeat[]
    cta: string
    /** Hook vypálený do obrazu v první 1,5 s — titulková karta, ≤ 2 řádky × 18 znaků. */
    onScreenHook: string
}

/** Popis jedné brandové fotky — jen to, co scenárista potřebuje ke „co jde natočit". */
export interface ReelPhotoHint {
    description: string
    tags?: string[]
}

/** Jeden z posledních reelů klienta — anti-repeat a měření vzorů. */
export interface PastReel {
    hook: string
    hookPattern?: string | null
    /** `engagementScore()`; `null` = nenaměřeno. */
    score?: number | null
}

export interface ReelScriptInput {
    config: ClientConfig
    medium: ReelMedium
    durationSeconds: number
    postType: string
    typeDef?: PostTypeDef
    ctaPolicy: CtaPolicy
    /** Úhel, hook a caption z copywritera — námět, ze kterého se scénář odvíjí. */
    angle?: string
    copywriterHook?: string
    caption?: string
    selectedProduct?: SelectedProduct
    /** Živý katalog (`getCatalogProducts`), ne zmražený onboarding snapshot. */
    catalogProducts?: { name: string; type?: string; price?: string; description?: string }[]
    brandPhotos?: ReelPhotoHint[]
    reviews?: { quote: string; author?: string }[]
    /** Blok kontextového agenta (svátky, počasí, sezóna). */
    signals?: string
    /** Posledních ~8 reelů (nejnovější první) — anti-repeat hooků i vzorů. */
    pastReels?: PastReel[]
    /** Vzory nabídnuté scenáristovi. Když chybí, builder si je zváží sám. */
    offeredPatterns?: HookPattern[]
    /** Kolik vzorů posledních reelů je zakázaných (default 3). */
    antiRepeatCount?: number
    /** Override povolených režimů; jinak platí `config.reelModes`. */
    allowedModes?: ReelMode[]
}

/** Kill switch — scénář se dá vypnout bez deploye, pipeline pak jede po staru. */
export function reelScriptwriterEnabled(): boolean {
    return process.env.REEL_SCRIPTWRITER !== "off"
}

/** Vzory zakázané kvůli opakování: posledních `n` reelů klienta. */
export function bannedHookPatterns(pastReels: PastReel[] | undefined, n = 3): string[] {
    return [...new Set(
        (pastReels ?? [])
            .slice(0, n)
            .map(r => r.hookPattern)
            .filter(isHookPatternId),
    )]
}

/** Režimy, ze kterých smí scenárista vybírat: nastavení značky, jinak obojí. */
export function allowedReelModes(input: { config: ClientConfig; allowedModes?: ReelMode[] }): ReelMode[] {
    return clampReelModes(input.allowedModes ?? input.config.reelModes)
}

/** Statistika vzorů z reelů klienta — vstup pro vážený výběr. */
export function statsFromReels(pastReels: PastReel[] | undefined): HookPatternStat[] {
    const rows: ScoredReel[] = (pastReels ?? []).map(r => ({ hookPattern: r.hookPattern, score: r.score }))
    return hookPatternStats(rows)
}

// ─── Prompt (čistá funkce — hlídá ji scripts/test-prompt-assembly.ts) ────────

function safeFacts(config: ClientConfig): string {
    try { return buildFactsSection(config) } catch { return "" }
}

const RISK_RULES: Record<IndustryRiskFamily, string> = {
    finance: "Obor je FINANČNÍ: v narraci nesmí zaznít výnos, zhodnocení, garance, jistota ani slib návratnosti — ani jako přirovnání.",
    health: "Obor je ZDRAVOTNICKÝ/ESTETICKÝ: narrace nesmí slibovat léčebný účinek, výsledek zákroku ani „vyléčí\" — mluv o péči a zkušenosti, ne o účinku.",
    technical: "Obor je TECHNICKÝ/ŘEMESLNÝ: každý parametr vlastní práce (tloušťka, tlak, únosnost, životnost, záruka) je závazek a reklamační podklad — použij jen ten, který stojí v ověřených faktech výš.",
}

/**
 * Prompt scenáristy. Čistý — žádná síť, žádná DB, takže se dá držet aserkami
 * nad fixture configem (`npm run guard`).
 */
export function buildReelScriptPrompt(input: ReelScriptInput): string {
    const { config, durationSeconds, ctaPolicy } = input
    const sentences = plannedNarrationSentences(durationSeconds)
    const wordBudget = plannedNarrationWords(durationSeconds)
    const patterns = input.offeredPatterns ?? pickHookPatterns({
        stats: statsFromReels(input.pastReels),
        exclude: bannedHookPatterns(input.pastReels, input.antiRepeatCount ?? 3),
        count: 4,
    })
    const banned = bannedHookPatterns(input.pastReels, input.antiRepeatCount ?? 3)
    const facts = safeFacts(config)
    const risk = industryRiskFamily(config.industry)
    const iv = config.industryVisual

    const photos = input.brandPhotos?.length
        ? input.brandPhotos.map((p, i) => `${i + 1}. ${p.description || "(bez popisu)"}${p.tags?.length ? ` [${p.tags.join(", ")}]` : ""}`).join("\n")
        : "(značka nemá nahrané vlastní fotky — scénu je nutné popsat, ne se opřít o reálný snímek)"

    const voiceExamples = (config.brandVoiceExamples ?? []).slice(0, 3)
        .map(e => `- „${String(e.caption).slice(0, 180)}"`).join("\n")

    const reviewsText = input.reviews?.length
        ? input.reviews.slice(0, 3).map(r => `- „${r.quote.slice(0, 200)}"${r.author ? ` — ${r.author}` : ""}`).join("\n")
        : "(žádné schválené recenze)"

    const productText = input.selectedProduct
        ? `Reel je o produktu: ${input.selectedProduct.name} (${input.selectedProduct.type})${input.selectedProduct.description ? ` — ${input.selectedProduct.description.slice(0, 240)}` : ""}.`
        : input.catalogProducts?.length
            ? `Katalog značky (živý, ne snímek z onboardingu):\n${input.catalogProducts.slice(0, 8).map(p => `- ${p.name} (${p.type || "produkt"})${p.price ? `, ${p.price}` : ""}`).join("\n")}`
            : "Konkrétní produkt není zadaný — hrdinou je samotná značka a její práce."

    const pastText = input.pastReels?.length
        ? input.pastReels.slice(0, 8).map((r, i) => `${i + 1}. „${r.hook}"${r.hookPattern ? ` [vzor: ${r.hookPattern}]` : ""}${r.score != null ? ` (síla ${Math.round(r.score)})` : ""}`).join("\n")
        : "(zatím žádné reely — první scénář značky)"

    // Povolené režimy jsou nastavení ZNAČKY, ne volba modelu: když klient hlas chce
    // vždycky, nemá smysl textový režim vůbec nabízet — model si ho jinak vybere
    // sám a validátor by scénář zahodil až po zaplaceném kole Opusu.
    const modes = allowedReelModes(input)
    const modeLines: string[] = []
    if (modes.includes("voiceover")) modeLines.push(`- "voiceover" — beaty nesou "narration" (mluvené slovo). Výchozí volba.`)
    if (modes.includes("text")) modeLines.push(`- "text" — beaty nesou "card" (krátká textová karta na obraze), hlas žádný, nese to hudba a obraz. Vyber ho, když je téma vizuální a mluvené slovo by překáželo (móda, gastro, interiéry, proměna).`)
    const modeRules = modes.length > 1
        ? `${modeLines.join("\n")}\nZvol jedno a drž ho ve všech beatech; nemíchej "narration" a "card".`
        : `${modeLines.join("\n")}\n**Značka povoluje jen režim "${modes[0]}" — do pole "mode" napiš přesně "${modes[0]}" a drž ho ve všech beatech.**`

    const ctaRule = ctaPolicy.allowWebsite
        ? `Poslední beat MUSÍ vyzvat na ${config.website}.`
        : `Poslední beat MUSÍ být engagement výzva (otázka / ulož si / pošli dál) — BEZ webu, BEZ URL, BEZ adresy.`

    return `Jsi SCENÁRISTA krátkých videí pro Instagram. Píšeš česky, pro značku „${config.name}" (${config.industry || "—"}${config.city ? `, ${config.city}` : ""}).

Reel má jediný cíl: **zastavit palec v první vteřině a udržet diváka až do výzvy na konci.** Všechno ostatní — obraz, hlas, střih — je až prostředek. Píšeš hook, beaty a narraci; caption a hashtagy NEPÍŠEŠ, ty už existují.

## NÁMĚT (od copywritera — drž se ho)
- Úhel: ${input.angle || "—"}
- Návrh hooku: ${input.copywriterHook || "—"}
- Typ postu: ${input.postType}${input.typeDef?.structure ? `\n- Rytmus formátu (tempo, ne obsah): ${input.typeDef.structure}` : ""}
${input.caption ? `- Caption (jde pod video, neopakuj ho doslova):\n"""${input.caption.slice(0, 700)}"""` : ""}

## HLAS ZNAČKY
- Persona: ${config.brandVoice?.persona || "—"}
- Zaměření obsahu: ${config.contentFocus || "—"}
${voiceExamples ? `- Takhle značka zní (ukázky):\n${voiceExamples}` : ""}

## OVĚŘENÁ FAKTA O ZNAČCE
${facts || "(žádná ověřená fakta — nepiš ŽÁDNÁ konkrétní čísla, ceny, procenta ani záruky)"}

⛔ **ŽÁDNÁ NOVÁ ČÍSLA.** Číslo, cenu, procento, letopočet, jméno ani záruku smíš vyslovit JEN tehdy, když doslova stojí ve faktech výš nebo v zadání námětu. Nic nedopočítávej, nic nezaokrouhluj, nic si nedomýšlej — narraci po tobě čte faktická brána a vymyšlený údaj shodí celý reel.
${risk ? `⛔ ${RISK_RULES[risk]}` : ""}

## PRODUKT
${productText}

## CO REÁLNĚ EXISTUJE K NATOČENÍ (brandové fotky)
${photos}
Scénu stav přednostně z toho, co je výš — vymyšlený záběr, ke kterému značka nemá nic podobného, dopadne jako stock.

## RECENZE (hlas zákazníka — doslovná zásoba formulací)
${reviewsText}

## OBOROVÝ VIZUÁL
${iv ? `- Žánr: ${iv.photographicGenre}\n- Světlo: ${iv.lightingBrief}${iv.palettePrinciple ? `\n- Paleta: ${iv.palettePrinciple}` : ""}` : "(oborový profil není — drž se estetiky značky)"}
${config.videoFocus ? `- Video styl značky: ${config.videoFocus}` : ""}

${input.signals ? `## SIGNÁLY (svátky, počasí, sezóna)\n${input.signals}\n` : ""}
## POSLEDNÍ REELY ZNAČKY (anti-repeat)
${pastText}
Nesmíš zopakovat hook ani jeho figuru z žádného reelu výš.${banned.length ? ` **Zakázané vzory (poslední reely): ${banned.join(", ")}.**` : ""}

## HOOK VZORY — vyber PRÁVĚ JEDEN
Nabídka je vážená podle toho, co téhle značce měřitelně funguje. Vyber ten, který nejlíp sedí na námět, a zapiš jeho \`id\` do pole "hookPattern".
${formatHookPatterns(patterns)}

## ROZPOČET (tvrdé meze)
- Video má ${durationSeconds} s. Česky se namluví ~2,2 slova za vteřinu a část stopáže sežere nádech, mezery a dojezd.
- **Narrace VŠECH beatů dohromady má NEJVÝŠ ${wordBudget} slov.** Delší text engine po namluvení zkracuje — piš rovnou krátce.
- Beatů napiš ${sentences}${durationSeconds >= 10 ? "–6" : "–4"}. Každý beat = jedna až dvě krátké mluvené věty, žádné závorky ani výčty.
- Hook musí zaznít v první 1,5 s a zároveň být vidět: "onScreenHook" je titulková karta, **nejvýš 2 řádky po 18 znacích** (tedy ≤ 36 znaků včetně mezer).
- ${ctaRule}

## REŽIM
${modeRules}

## VÝSTUP — vrať POUZE validní JSON, bez markdownu:
{
  "hookPattern": "id vybraného vzoru",
  "hook": "mluvený hook — první věta, česky, 2–8 slov",
  "mode": "${modes[0]}",
  "beats": [
    {
      "narration": "Česká věta pro voiceover (v režimu text místo toho \\"card\\").",
      "visual": "English, concrete description of the shot",
      "camera": "dolly in / slow pan / static close-up / handheld tracking …",
      "mood": "lighting and mood in English",
      "sfx": "ambient sound or effect"
    }
  ],
  "cta": "Poslední výzva česky${ctaPolicy.allowWebsite ? ` — musí obsahovat ${config.website}` : " — BEZ webu a BEZ URL"}",
  "onScreenHook": "Hook do obrazu (≤ 36 znaků)"
}`
}

// ─── Schéma, parser, validátor ──────────────────────────────────────────────

/** Gemini responseSchema — stejný tvar, jaký si prompt říká od Claude. */
export function buildReelScriptSchema() {
    return {
        type: Type.OBJECT,
        properties: {
            hookPattern: { type: Type.STRING },
            hook: { type: Type.STRING },
            mode: { type: Type.STRING },
            beats: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        narration: { type: Type.STRING },
                        card: { type: Type.STRING },
                        visual: { type: Type.STRING },
                        camera: { type: Type.STRING },
                        mood: { type: Type.STRING },
                        sfx: { type: Type.STRING },
                    },
                    required: ["visual", "camera", "mood"],
                },
            },
            cta: { type: Type.STRING },
            onScreenHook: { type: Type.STRING },
        },
        required: ["hookPattern", "hook", "mode", "beats", "cta", "onScreenHook"],
        propertyOrdering: ["hookPattern", "hook", "mode", "beats", "cta", "onScreenHook"],
    }
}

/** Vytáhne JSON z odpovědi — stejný postup jako `parseStoryboard` (Claude obaluje ```json). */
export function parseReelScript(raw: string): ReelScript {
    let text = raw.trim()
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fence) text = fence[1].trim()
    const first = text.indexOf("{")
    const last = text.lastIndexOf("}")
    if (first < 0 || last <= first) throw new Error("scénář: odpověď neobsahuje JSON objekt")
    const obj = JSON.parse(text.slice(first, last + 1)) as Record<string, unknown>

    const beatsRaw = Array.isArray(obj.beats) ? obj.beats : []
    const beats: ReelBeat[] = beatsRaw.map((r: unknown) => {
        const b = (r ?? {}) as Record<string, unknown>
        const narration = typeof b.narration === "string" ? b.narration.trim() : undefined
        const card = typeof b.card === "string" ? b.card.trim() : undefined
        return {
            narration: narration || undefined,
            card: card || undefined,
            visual: String(b.visual ?? "").trim(),
            camera: String(b.camera ?? "").trim(),
            mood: String(b.mood ?? "").trim(),
            sfx: typeof b.sfx === "string" && b.sfx.trim() ? b.sfx.trim() : undefined,
        }
    })

    return {
        hookPattern: String(obj.hookPattern ?? "").trim(),
        hook: String(obj.hook ?? "").trim(),
        mode: obj.mode === "text" ? "text" : "voiceover",
        beats,
        cta: String(obj.cta ?? "").trim(),
        onScreenHook: String(obj.onScreenHook ?? "").trim(),
    }
}

/** Titulková karta: 2 řádky × 18 znaků (`reel-subtitles.ts`). */
export const ON_SCREEN_HOOK_MAX = 36

export interface ReelScriptContext {
    durationSeconds: number
    allowWebsite: boolean
    website?: string
    /** Zakázané vzory (poslední reely). */
    bannedPatterns?: string[]
    /** Režimy povolené značkou; prázdné = obojí. */
    allowedModes?: ReelMode[]
}

/** Seznam problémů; prázdný = v pořádku. Čisté — drží to guard. */
export function validateReelScript(s: ReelScript, ctx: ReelScriptContext): string[] {
    const problems: string[] = []
    if (!isHookPatternId(s.hookPattern)) {
        problems.push(`hookPattern "${s.hookPattern}" není ze známé palety (${HOOK_PATTERNS.map(p => p.id).join(", ")})`)
    } else if (ctx.bannedPatterns?.includes(s.hookPattern)) {
        problems.push(`hookPattern "${s.hookPattern}" použily poslední reely — vyber jiný`)
    }
    if (ctx.allowedModes?.length && !ctx.allowedModes.includes(s.mode)) {
        problems.push(`režim "${s.mode}" značka nepovoluje (smí ${ctx.allowedModes.join(", ")})`)
    }
    if (!s.hook) problems.push("chybí hook")
    if (!s.cta) problems.push("chybí CTA")
    if (!s.onScreenHook) problems.push("chybí onScreenHook")
    else if (s.onScreenHook.length > ON_SCREEN_HOOK_MAX) {
        problems.push(`onScreenHook má ${s.onScreenHook.length} znaků, vejde se ${ON_SCREEN_HOOK_MAX} (2 řádky × 18)`)
    }
    if (s.beats.length < 2) problems.push(`jen ${s.beats.length} beatů — reel potřebuje aspoň 2`)
    if (s.beats.length > 7) problems.push(`${s.beats.length} beatů je na ${ctx.durationSeconds}s moc (max 7)`)

    const textField = (b: ReelBeat) => (s.mode === "text" ? b.card : b.narration)
    for (const [i, b] of s.beats.entries()) {
        if (!textField(b)) problems.push(`beat ${i + 1}: chybí ${s.mode === "text" ? "card" : "narration"}`)
        if (!b.visual) problems.push(`beat ${i + 1}: prázdný visual`)
        if (!b.camera) problems.push(`beat ${i + 1}: prázdná camera`)
    }

    const spoken = s.beats.map(textField).filter(Boolean).join(" ")
    const words = spoken.split(/\s+/).filter(Boolean).length
    const budget = plannedNarrationWords(ctx.durationSeconds)
    // 20% tolerance: engine narraci po namluvení stejně zkracuje (`condenseNarration`),
    // takže mírný přestřelek není důvod platit další kolo Opusu.
    if (words > Math.round(budget * 1.2)) problems.push(`narrace má ${words} slov, rozpočet je ${budget}`)

    const URL_RE = /https?:\/\/|www\.|\b[a-z0-9-]+\.(cz|com|sk|eu|net|io|shop)\b/i
    const all = [s.hook, s.cta, spoken].join(" ")
    if (!ctx.allowWebsite && URL_RE.test(all)) {
        problems.push("politika CTA zakazuje web, ale scénář obsahuje URL/doménu")
    }
    if (ctx.allowWebsite && ctx.website && !s.cta.toLowerCase().includes(String(ctx.website).replace(/^https?:\/\//, "").toLowerCase())) {
        problems.push("CTA má odkázat na web, ale web v něm není")
    }
    return problems
}

// ─── Volání modelu (Opus 5 → Sonnet 5 → Gemini Pro ladder) ───────────────────

export type ReelScriptVia = "opus" | "sonnet" | "gemini"

async function callScriptwriter(prompt: string, label: string): Promise<{ text: string; via: ReelScriptVia }> {
    if (process.env.ANTHROPIC_API_KEY) {
        const tiers: { tier: "primary" | "fallback"; via: ReelScriptVia }[] = [{ tier: "primary", via: "opus" }]
        if (hasFallback("reelScript")) tiers.push({ tier: "fallback", via: "sonnet" })
        for (const { tier, via } of tiers) {
            try {
                const text = await writeWithClaude(prompt, {
                    model: getModel("reelScript", tier),
                    label: `${label}:${via}`,
                    maxTokens: 4096,
                    effort: "high",
                })
                return { text, via }
            } catch (err) {
                // Hlasitě: druhý Pro je pořád Pro, ale zákazník musí mít v logu vidět,
                // že scénář nepsal ten model, za který se platí.
                console.warn(`   ⚠️ Scenárista (${via}) selhal — padám o tier níž: ${String((err as Error)?.message || err).slice(0, 140)}`)
            }
        }
    }
    const models = [getModel("textPro")]
    if (hasFallback("textPro")) models.push(getModel("textPro", "fallback"))
    const text = await generateTextQuality(prompt, {
        models,
        responseSchema: buildReelScriptSchema(),
        temperature: getTemperature("copywriter"),
        label,
    })
    return { text, via: "gemini" }
}

/**
 * Scénář reelu s jedním opravným kolem — tvarově shodné s `directReel()`:
 * nevalidní výstup se vrátí modelu s výčtem problémů, a když neprojde ani
 * podruhé, je to tvrdá chyba. `QualityUnavailableError` z Gemini ladderu
 * probublá beze změny (job se zaparkuje, nikdy nespadne na flash).
 */
export async function writeReelScript(input: ReelScriptInput): Promise<{ script: ReelScript; via: ReelScriptVia }> {
    const banned = bannedHookPatterns(input.pastReels, input.antiRepeatCount ?? 3)
    const patterns = input.offeredPatterns ?? pickHookPatterns({
        stats: statsFromReels(input.pastReels),
        exclude: banned,
        count: 4,
    })
    const basePrompt = buildReelScriptPrompt({ ...input, offeredPatterns: patterns })
    const ctx: ReelScriptContext = {
        durationSeconds: input.durationSeconds,
        allowWebsite: input.ctaPolicy.allowWebsite,
        website: input.config.website,
        bannedPatterns: banned,
        allowedModes: allowedReelModes(input),
    }

    let attemptPrompt = basePrompt
    let lastProblems: string[] = []
    for (let round = 0; round < 2; round++) {
        const { text, via } = await callScriptwriter(attemptPrompt, round === 0 ? "reel-script" : "reel-script:repair")
        let script: ReelScript
        try {
            script = parseReelScript(text)
        } catch (err) {
            lastProblems = [`nevalidní JSON: ${String((err as Error)?.message || err).slice(0, 100)}`]
            attemptPrompt = `${basePrompt}\n\n## PŘEDCHOZÍ ODPOVĚĎ BYLA ODMÍTNUTA\n- ${lastProblems.join("\n- ")}\nVrať POUZE opravený JSON objekt.`
            continue
        }
        lastProblems = validateReelScript(script, ctx)
        if (lastProblems.length === 0) {
            console.log(`   🎞️ Scénář (${via}): vzor "${script.hookPattern}", režim ${script.mode}, ${script.beats.length} beatů`)
            return { script, via }
        }
        console.log(`   ↩️ Scénář neprošel (${lastProblems.length}): ${lastProblems.slice(0, 3).join("; ")} — opravné kolo`)
        attemptPrompt = `${basePrompt}\n\n## PŘEDCHOZÍ ODPOVĚĎ BYLA ODMÍTNUTA — oprav tohle a vrať POUZE opravený JSON\n- ${lastProblems.join("\n- ")}\n\nPředchozí odpověď:\n${text.slice(0, 3000)}`
    }
    throw new Error(`Scénář reelu neprošel validací ani po opravě: ${lastProblems.join("; ").slice(0, 300)}`)
}

// ─── Napojení na `captionData` ──────────────────────────────────────────────

/** Scéna v tom tvaru, v jakém ji zbytek pipeline (TTS, režisér, orchestrátor) čte. */
export interface CaptionScene {
    timeRange: string
    visual: string
    camera: string
    mood: string
    narration?: string
    soundEffect?: string
    /** Textový režim: `narration` je text KARTY, ne replika k namluvení. */
    textOnly?: boolean
}

/**
 * Beaty scenáristy → `captionData.scenes`. Časy jsou rovnoměrné a jen orientační:
 * skutečnou osu staví `buildTimeline` z NAMĚŘENÉ řeči (audio-first), u textového
 * reelu `buildTextTimeline` ze čtecího tempa; tohle je popisek pro režiséra a
 * fallback pro dry-run.
 *
 * `card` zůstává v poli `narration` i v textovém režimu ZÁMĚRNĚ: je to táž věta,
 * která projde kritikem, redakcí i faktickou bránou — jen ji divák čte, místo aby
 * ji slyšel. Rozlišuje se příznakem `textOnly`, ne druhým polem, aby žádná brána
 * nemohla textový reel omylem přeskočit.
 */
export function scriptToScenes(script: ReelScript, durationSeconds: number): CaptionScene[] {
    const n = Math.max(1, script.beats.length)
    const step = durationSeconds / n
    const textOnly = script.mode === "text"
    return script.beats.map((b, i) => ({
        timeRange: `${(i * step).toFixed(1)}-${((i + 1) * step).toFixed(1)}s`,
        visual: b.visual,
        camera: b.camera,
        mood: b.mood,
        narration: textOnly ? (b.card || b.narration) : (b.narration || b.card),
        soundEffect: b.sfx,
        ...(textOnly ? { textOnly: true } : {}),
    }))
}

/** Skóre reelu pro vážení vzorů — jediný vzorec, přes `lib/engagement.ts`. */
export function reelScore(post: { likes?: number | null; comments?: number | null; saves?: number | null }): number | null {
    if (post.likes == null && post.comments == null && post.saves == null) return null
    return engagementScore(post)
}
