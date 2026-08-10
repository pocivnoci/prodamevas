/**
 * Ceník modelů — převod naměřených tokenů na peníze
 * =================================================
 * Doplněk k `instagram/usage-meter.ts`: ten měří tokeny (tvrdá data, nikdy nezastarají),
 * tenhle soubor je překládá na dolary (měkká data, zastarají do měsíce).
 *
 * Dvě pravidla, na kterých to stojí:
 *
 * 1. **Neznámý model nemá cenu `0`, ale `null`.** Vymyšlená nula vypadá v databázi
 *    jako „levné" a je k nerozeznání od skutečně levného volání. Stejný důvod, proč
 *    `scorePost` loguje `critic_score: null` místo ploché sedmičky.
 * 2. **Chybějící sazba se ohlásí.** Jednou za běh procesu, ne u každého volání —
 *    tichá mezera v účtování je horší než hlučná.
 *
 * Sazby přepíšeš bez deploye přes env: `MODEL_PRICE_<MODEL>_IN` a `_OUT` v USD za
 * milion tokenů (model se normalizuje na velká písmena s podtržítky, např.
 * `MODEL_PRICE_GEMINI_PRO_LATEST_IN=1.25`).
 */

/** USD za milion tokenů. `cachedIn` je sazba za část promptu obslouženou z cache. */
interface TokenPrice {
    in: number
    out: number
    cachedIn?: number
    /** Odkud sazba je — bez zdroje se sem nic nepřidává. */
    source: string
}

/**
 * Sazby ověřené k datu uvedenému u položky.
 *
 * ⚠️ Textové Gemini modely tu **schválně nejsou**. V repozitáři pro ně žádná ověřená
 * sazba není (`docs/pricing/ASSUMPTIONS.md` má ověřené jen ceny za obrázek a vteřinu
 * videa; agentický základ ~$0,20/post je označený `[ODHAD]`). Radši ať se cena spočítá
 * jako `null` a bude vidět, že chybí, než aby se do faktury dostalo číslo z hlavy.
 * Doplň je sem s datem a zdrojem — nebo dočasně přes env.
 */
const PRICES: Record<string, TokenPrice> = {
    // models.ts: „intro pricing $2/$10 per MTok through 2026-08-31"
    "claude-sonnet-5": { in: 2, out: 10, source: "instagram/models.ts, intro pricing do 2026-08-31" },
}

/**
 * Jednotkové sazby v USD — modely, které se neúčtují za tokeny.
 * Zdroj: `docs/pricing/ASSUMPTIONS.md`, řádky označené jako ověřené (2026-07-15).
 */
const UNIT_PRICES: Record<string, { perSecond?: number; perImage?: number; source: string }> = {
    "veo-3.1-fast-generate-preview": { perSecond: 0.15, source: "ASSUMPTIONS.md — techjacksolutions.com" },
    "veo-3.1-generate-preview": { perSecond: 0.40, source: "ASSUMPTIONS.md — techjacksolutions.com" },
    // Lite nemá ověřenou sazbu; schválně chybí, ať se ozve místo tichého odhadu.
    "gemini-3-pro-image": { perImage: 0.134, source: "ASSUMPTIONS.md — pricepertoken.com (Nano Banana Pro 2K)" },
}

const warned = new Set<string>()

function envKey(model: string): string {
    return model.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase()
}

/** Jednou za běh procesu, ne u každého volání — ale ozvat se musí. */
function warnMissing(model: string, what: string): void {
    const key = `${model}:${what}`
    if (warned.has(key)) return
    warned.add(key)
    console.warn(
        `⚠️ model-pricing: pro "${model}" chybí ${what} — spotřeba se změří, cena zůstane null. ` +
        `Doplň ji do lib/model-pricing.ts (se zdrojem a datem) nebo přes MODEL_PRICE_${envKey(model)}_IN/_OUT.`,
    )
}

function priceFor(model: string): TokenPrice | null {
    const key = envKey(model)
    const envIn = Number(process.env[`MODEL_PRICE_${key}_IN`])
    const envOut = Number(process.env[`MODEL_PRICE_${key}_OUT`])
    if (Number.isFinite(envIn) && Number.isFinite(envOut)) {
        return { in: envIn, out: envOut, source: "env override" }
    }
    return PRICES[model] ?? null
}

export interface PricedUsage {
    promptTokens: number
    outputTokens: number
    thoughtTokens: number
    cachedTokens: number
    units?: { kind: "seconds" | "images"; n: number }
}

/**
 * Cena jednoho volání v USD, nebo `null`, když pro model není ověřená sazba.
 * Thinking tokeny se účtují sazbou výstupu.
 */
export function costUsdForCall(model: string, u: PricedUsage): number | null {
    // Netokenové volání (video za vteřiny, obrázek za kus) má vlastní sazebník.
    if (u.units) {
        const up = UNIT_PRICES[model]
        const rate = u.units.kind === "seconds" ? up?.perSecond : up?.perImage
        if (rate === undefined) {
            warnMissing(model, `jednotková sazba (${u.units.kind})`)
            return null
        }
        return rate * u.units.n
    }

    const p = priceFor(model)
    if (!p) {
        warnMissing(model, "tokenová sazba")
        return null
    }
    const fresh = Math.max(0, u.promptTokens - u.cachedTokens)
    const cachedRate = p.cachedIn ?? p.in * 0.25 // cache se běžně účtuje zlomkem vstupu
    return (
        (fresh * p.in + u.cachedTokens * cachedRate + (u.outputTokens + u.thoughtTokens) * p.out) / 1_000_000
    )
}

/**
 * Cena celé generace. Vrací `null`, jakmile **kterýkoli** krok cenu nemá — částečný
 * součet by tvrdil, že příspěvek stál míň, než ve skutečnosti stál.
 */
export function costUsdForBreakdown(calls: { model: string; promptTokens: number; outputTokens: number; thoughtTokens: number; cachedTokens: number }[]): number | null {
    let sum = 0
    for (const c of calls) {
        const cost = costUsdForCall(c.model, c)
        if (cost === null) return null
        sum += cost
    }
    return sum
}

/** Kurz pro reporting v korunách. Zdroj: docs/pricing/cost-model.ts (ověřeno 2026-07-15). */
export const USD_TO_CZK = Number(process.env.USD_CZK_RATE) || 21.2

export function usdToCzk(usd: number): number {
    return usd * USD_TO_CZK
}
