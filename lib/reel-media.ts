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
