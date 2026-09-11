/**
 * Reel sizes — client-safe module (no server imports).
 * =====================================================
 * Dva reelové formáty jsou dvě MÉDIA v kreditové tabulce (`lib/credits.ts`), ne
 * jedno médium s příznakem délky. Důvod je účetní: `reconcileJobCharge` vrací
 * rozdíl mezi účtovaným a dodaným médiem podle `ig_posts.media_type`, takže
 * dlouhý reel uložený jako `"reel"` by se tiše zúčtoval jako krátký. Jedno slovo
 * na řádku = jedna pravda o ceně.
 *
 * Všechno, co se ptá „je to reel?", se ptá TADY (`isReelMedium`), ne na literál
 * `=== "reel"` — ten by druhou velikost přehlédl a přesně tak se přehlédla story.
 */

import { MEDIA_CREDITS, type MediumType } from "./credits"

export const REEL_MEDIA = ["reel", "reel_long"] as const satisfies readonly MediumType[]
export type ReelMedium = (typeof REEL_MEDIA)[number]
export type ReelSize = "short" | "long"

export function isReelMedium(m: unknown): m is ReelMedium {
    return typeof m === "string" && (REEL_MEDIA as readonly string[]).includes(m)
}

/**
 * Délkové meze podle velikosti. Video se generuje na Seedance po celých vteřinách
 * a délku určuje NAMLUVENÝ text (audio-first), tyhle meze ho jen ohraničují.
 * Strop je zároveň to, za co zákazník platí — 5 kreditů ≤ 8 s, 10 kreditů ≤ 20 s.
 */
export const REEL_LIMITS: Record<ReelMedium, { size: ReelSize; minSeconds: number; maxSeconds: number; defaultSeconds: number }> = {
    reel: { size: "short", minSeconds: 4, maxSeconds: 8, defaultSeconds: 8 },
    reel_long: { size: "long", minSeconds: 10, maxSeconds: 20, defaultSeconds: 15 },
}

/** Vyžádaná délka sražená do mezí velikosti; bez požadavku výchozí délka. */
export function clampReelDuration(medium: ReelMedium, requested?: number | null): number {
    const lim = REEL_LIMITS[medium]
    if (!requested || !Number.isFinite(requested)) return lim.defaultSeconds
    return Math.min(lim.maxSeconds, Math.max(lim.minSeconds, Math.round(requested)))
}

/** Popisky do UI — „reels" zůstává nesklonné, tak se ta funkce jmenuje na Instagramu. */
export const REEL_LABELS: Record<ReelMedium, string> = {
    reel: "Reel",
    reel_long: "Dlouhý reel",
}

/** Kolik kreditů stojí která velikost — čte se z tabulky, nikdy se nepíše ručně. */
export function reelCredits(medium: ReelMedium): number {
    return MEDIA_CREDITS[medium]
}

/**
 * Časová osa narrace — čas, který z délky reelu ubírá nájezd, mezery a dojezd.
 * Jediné místo s těmi čísly: `buildTimeline` (instagram/reel-audio.ts) z nich skládá
 * osu a rozpočty slov níž je musí odečítat, jinak slibují víc řeči, než se do videa vejde.
 */
export const REEL_TIMELINE = {
    leadInSeconds: 0.5,
    gapSeconds: 0.35,
    tailSeconds: 1.0,
    maxTempo: 1.15,
    /** Tolerance při kontrole už ZKRÁCENÉ narrace — o kus volnější než první pokus. */
    condensedMaxTempo: 1.3,
}

/**
 * Plánovací tempo české řeči — kolik slov se namluví za vteřinu ČISTÉ řeči, DŘÍV než
 * existuje zvuk (prompt copywritera). Změřeno 11. 9. 2026 na Gemini TTS (hlas Kore):
 * 2,17–2,37 slova/s po oříznutí ticha. Bez ořezu (`trimSilence` v reel-audio.ts) vycházelo
 * 1,55–1,93, protože každý klip nese ~0,7 s ticha — a to se do krátkého reelu nevešlo.
 */
export const SPOKEN_WORDS_PER_SECOND = 2.2

/** Kolik scén (= vět narrace) čeká prompt copywritera pro danou délku reelu. */
export function plannedNarrationSentences(seconds: number): number {
    return seconds >= 10 ? 5 : 3
}

/** Čas mimo řeč: nájezd + mezery mezi větami + dojezd. */
export function narrationFixedSeconds(sentences: number): number {
    return REEL_TIMELINE.leadInSeconds + REEL_TIMELINE.gapSeconds * Math.max(0, sentences - 1) + REEL_TIMELINE.tailSeconds
}

/**
 * Strop slov narrace pro copywritera: čas na řeč v PŘIROZENÉM tempu × plánovací tempo.
 * Zrychlení do `maxTempo` se tu schválně nepočítá — je to rezerva pro copywritera,
 * který strop přetáhne, ne cíl.
 */
export function plannedNarrationWords(seconds: number): number {
    const sentences = plannedNarrationSentences(seconds)
    return Math.max(sentences, Math.floor((seconds - narrationFixedSeconds(sentences)) * SPOKEN_WORDS_PER_SECOND))
}

/**
 * Cíl zkrácení z NAMĚŘENÉ řeči: tempo tohohle hlasu (slova / sekundy řeči) × čas, který
 * na řeč opravdu zbude při `maxTempo`, s 10% rezervou na rozptyl TTS mezi voláními.
 * Vrací aspoň slovo na větu a vždy méně slov, než narrace měla.
 */
export function narrationWordBudget(input: { words: number; speechSeconds: number; sentences: number; maxSeconds: number }): number {
    const { words, speechSeconds, sentences, maxSeconds } = input
    if (!(speechSeconds > 0) || words <= 0) return sentences
    const rate = words / speechSeconds
    const available = Math.max(0, maxSeconds * REEL_TIMELINE.maxTempo - narrationFixedSeconds(sentences))
    return Math.max(sentences, Math.min(words - 1, Math.floor(rate * available * 0.9)))
}
