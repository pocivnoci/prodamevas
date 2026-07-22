/**
 * Media-weighted credit costs — client-safe module (no server imports).
 * Single source of truth; lib/subscription.ts re-exports these for the backend,
 * client components import directly for UI estimates.
 *
 * 1 credit ≈ $0.30 of AI COGS: a reel costs ~4× an image to produce, so a flat
 * 1-credit-per-post price sold reels below cost. Reels are additionally priced
 * by duration (see creditsForReel). See docs/UNIT_ECONOMICS_AND_PRICING.md §4.
 */

export type MediumType = "image" | "carousel" | "reel"

export const MEDIA_CREDITS: Record<MediumType, number> = {
    image: 1,
    carousel: 3,
    reel: 5, // base price for a single-clip reel (≤8s); longer reels via creditsForReel
}

/** Veo generates ≤8s per clip; longer reels are stitched from 8s blocks. */
export const REEL_BASE_SECONDS = 8

/** Durations the config clamp allows: 5–8s single clip, 16/24s premium multi-clip. */
export const REEL_ALLOWED_DURATIONS = [5, 6, 7, 8, 16, 24] as const

/** Clamp any configured reel duration to the nearest allowed value; garbage → 8. */
export function clampReelDuration(durationSec?: number | null): number {
    if (!durationSec || !Number.isFinite(durationSec)) return 8
    return REEL_ALLOWED_DURATIONS.reduce((best, d) =>
        Math.abs(d - durationSec) < Math.abs(best - durationSec) ? d : best, 8 as number)
}

/**
 * Duration-aware reel price: 5 credits for the first 8s block + 4 credits per
 * additional started 8s block (Veo fast ≈ $1.20/8s ≈ 4 credits at $0.30/credit,
 * keeping the price-floor multiple of the 8s reel constant across durations).
 * 5–8s → 5, 16s → 9, 24s → 13. Unknown/garbage duration = base price.
 */
export function creditsForReel(durationSec?: number | null): number {
    const base = MEDIA_CREDITS.reel
    if (!durationSec || !Number.isFinite(durationSec) || durationSec <= REEL_BASE_SECONDS) {
        return base
    }
    const extraBlocks = Math.ceil(durationSec / REEL_BASE_SECONDS) - 1
    return base + extraBlocks * 4
}

/**
 * Credit cost of a post for a given medium; unknown/missing medium = image (cheapest).
 * For reels, pass the reel duration to get the duration-aware price — without it
 * the base (8s) reel price is returned, which keeps legacy call sites unchanged.
 */
export function creditsForMedia(medium?: string | null, reelDurationSec?: number | null): number {
    if (medium === "reel") return creditsForReel(reelDurationSec)
    return MEDIA_CREDITS[medium as MediumType] ?? MEDIA_CREDITS.image
}
