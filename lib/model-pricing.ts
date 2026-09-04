/**
 * Ceník modelů — převod naměřených tokenů na peníze
 * =================================================
 * Doplněk k `instagram/usage-meter.ts`: ten měří spotřebu (tvrdá data, nikdy
 * nezastarají), tenhle soubor ji překládá na dolary (měkká data, zastarají do měsíce).
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
 *
 * ⚠️ Všechny sazby níž jsou z ai.google.dev/gemini-api/docs/pricing, **ověřeno
 *    2026-08-10** (placený tier, standard — ne batch). Google ceny mění; když se
 *    naměřené náklady rozejdou s fakturou, začni tady.
 */

/** USD za milion tokenů. Google účtuje jinak nad 200k tokenů promptu. */
interface TokenPrice {
    in: number
    out: number
    /** Sazba za cachovanou část promptu. U Gemini je to shodně 10 % vstupní sazby. */
    cachedIn: number
    /** Sazby pro prompty > 200 000 tokenů, pokud je model rozlišuje. */
    longContext?: { in: number; out: number; cachedIn: number }
    source: string
}

const GOOGLE = "ai.google.dev/gemini-api/docs/pricing, ověřeno 2026-08-10"

const PRICES: Record<string, TokenPrice> = {
    // ── Flash tiery ────────────────────────────────────────────────────────────
    "gemini-3.6-flash": { in: 1.50, out: 7.50, cachedIn: 0.15, source: GOOGLE },
    "gemini-3.5-flash": { in: 1.50, out: 9.00, cachedIn: 0.15, source: GOOGLE },
    // Flash-Lite 3.5 cachování nepodporuje — cachedIn je tu jen pro tvar typu.
    "gemini-3.5-flash-lite": { in: 0.30, out: 2.50, cachedIn: 0.30, source: `${GOOGLE} (bez context caching)` },
    "gemini-3.1-flash-lite": { in: 0.25, out: 1.50, cachedIn: 0.025, source: GOOGLE },
    "gemini-2.5-flash": { in: 0.30, out: 2.50, cachedIn: 0.03, source: GOOGLE },

    // ── Pro tiery ──────────────────────────────────────────────────────────────
    "gemini-3.1-pro-preview": {
        in: 2.00, out: 12.00, cachedIn: 0.20,
        longContext: { in: 4.00, out: 18.00, cachedIn: 0.40 },
        source: GOOGLE,
    },
    "gemini-2.5-pro": {
        in: 1.25, out: 10.00, cachedIn: 0.125,
        longContext: { in: 2.50, out: 15.00, cachedIn: 0.25 },
        source: GOOGLE,
    },

    // ── Embeddingy ─────────────────────────────────────────────────────────────
    // Běží u každého postu (consistency score + retrieval brand memory), takže bez
    // nich by cost_usd zůstalo NULL prakticky vždycky. Výstup se neúčtuje.
    "gemini-embedding-2": { in: 0.20, out: 0, cachedIn: 0.20, source: GOOGLE },
    "gemini-embedding-001": { in: 0.15, out: 0, cachedIn: 0.15, source: GOOGLE },

    // ── TTS ────────────────────────────────────────────────────────────────────
    "gemini-3.1-flash-tts-preview": { in: 1.00, out: 20.00, cachedIn: 0.10, source: GOOGLE },
    "gemini-2.5-flash-preview-tts": { in: 0.50, out: 10.00, cachedIn: 0.05, source: GOOGLE },

    // ── Cross-family judge ─────────────────────────────────────────────────────
    // Žádný skok nebude: $2/$10 byla vypsaná jako úvodní cena do 2026-08-31, ale
    // Anthropic ji k tomu datu udělal STANDARDNÍ a plánované zdražení na $3/$15
    // od 2026-09-01 zrušil. cachedIn 0.20 = řádek „Cache Hits & Refreshes".
    "claude-sonnet-5": { in: 2, out: 10, cachedIn: 0.20, source: "platform.claude.com/docs/en/about-claude/pricing, ověřeno 2026-08-31 (standardní sazba)" },
}

/**
 * Aliasy → skutečný model. Telemetrie zaznamenává řetězec, který jsme POSLALI, a to
 * je u Pro tieru alias. Bez tohohle by každé Pro volání zůstalo neoceněné.
 *
 * ⚠️ Alias se sám otáčí na aktuální GA Pro (to je důvod, proč ho používáme —
 *    nepinnutý preview ID nás už jednou shodil na 404). Když se otočí, **překontroluj
 *    tenhle řádek**: cena se změní pod rukama, aniž by se změnil kód.
 *    Stav k 2026-08-10: gemini-3.5 Pro ještě není GA (testuje se s partnery),
 *    takže alias míří na gemini-3.1-pro-preview.
 */
const ALIASES: Record<string, string> = {
    "gemini-pro-latest": "gemini-3.1-pro-preview",
}

/**
 * Jednotkové sazby — modely, které se neúčtují za tokeny.
 * Obraz per kus, video per vteřinu. Rozlišení bereme to, které engine skutečně
 * renderuje: video `resolution: "1080p"` (gemini-client.ts), obraz bez `imageSize`
 * (= 1K; „2K"/„4K" rozmazává gemini-3-pro-image, viz komentář tamtéž).
 */
const UNIT_PRICES: Record<string, { perSecond?: number; perImage?: number; source: string }> = {
    // Veo 3.1 @ 1080p
    "veo-3.1-generate-preview": { perSecond: 0.40, source: GOOGLE },
    "veo-3.1-fast-generate-preview": { perSecond: 0.12, source: `${GOOGLE} (1080p; 720p je 0,10)` },
    "veo-3.1-lite-generate-preview": { perSecond: 0.08, source: `${GOOGLE} (1080p; 720p je 0,05)` },
    // Nano Banana Pro / 2 @ 1K
    "gemini-3-pro-image": { perImage: 0.134, source: `${GOOGLE} (1K/2K)` },
    "gemini-3.1-flash-image": { perImage: 0.067, source: `${GOOGLE} (1K)` },
}

/**
 * Jednotková sazba modelu, nebo `null`, když ji neznáme.
 *
 * Existuje proto, aby engine nemusel držet vlastní kopii cen. Do 9/2026 měl
 * `instagram/caption-generator.ts` v `COSTS` druhý sazebník za video a ten se
 * s tímhle souborem ROZEŠEL (Veo Fast 0,15 vs 0,12 USD/s, Lite 0,06 vs 0,08).
 * Dvě pravdy o ceně znamenají, že žádný výpočet marže nesedí — a rozhoduje
 * ta, která má zdroj a datum, tedy tenhle soubor.
 */
export function unitRate(model: string, kind: "seconds" | "images"): number | null {
    const up = UNIT_PRICES[resolveModelAlias(model)]
    const rate = kind === "seconds" ? up?.perSecond : up?.perImage
    return rate ?? null
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

/** Alias na skutečný model; ostatní vrací beze změny. */
export function resolveModelAlias(model: string): string {
    return ALIASES[model] ?? model
}

function priceFor(model: string): TokenPrice | null {
    const key = envKey(model)
    const envIn = Number(process.env[`MODEL_PRICE_${key}_IN`])
    const envOut = Number(process.env[`MODEL_PRICE_${key}_OUT`])
    if (Number.isFinite(envIn) && Number.isFinite(envOut)) {
        return { in: envIn, out: envOut, cachedIn: envIn * 0.1, source: "env override" }
    }
    return PRICES[resolveModelAlias(model)] ?? null
}

/** Nad tímhle počtem tokenů promptu účtuje Google vyšší sazbou. */
const LONG_CONTEXT_THRESHOLD = 200_000

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
        const up = UNIT_PRICES[resolveModelAlias(model)]
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

    const tier = u.promptTokens > LONG_CONTEXT_THRESHOLD && p.longContext ? p.longContext : p
    const fresh = Math.max(0, u.promptTokens - u.cachedTokens)
    return (
        (fresh * tier.in + u.cachedTokens * tier.cachedIn + (u.outputTokens + u.thoughtTokens) * tier.out) /
        1_000_000
    )
}

/**
 * Cena celé generace. Vrací `null`, jakmile **kterýkoli** krok cenu nemá — částečný
 * součet by tvrdil, že příspěvek stál míň, než ve skutečnosti stál.
 */
export function costUsdForBreakdown(calls: { model: string; promptTokens: number; outputTokens: number; thoughtTokens: number; cachedTokens: number; units?: { kind: "seconds" | "images"; n: number } }[]): number | null {
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
