/**
 * Media-weighted credit costs — client-safe module (no server imports).
 * Single source of truth; lib/subscription.ts re-exports these for the backend,
 * client components import directly for UI estimates.
 *
 * 1 credit ≈ $0.30 of AI COGS: a reel costs ~4× an image to produce, so a flat
 * 1-credit-per-post price sold reels below cost. See docs/UNIT_ECONOMICS_AND_PRICING.md §4.
 */

export type MediumType = "image" | "carousel" | "reel"

export const MEDIA_CREDITS: Record<MediumType, number> = {
    image: 1,
    carousel: 3,
    reel: 5,
}

/** Credit cost of a post for a given medium; unknown/missing medium = image (cheapest). */
export function creditsForMedia(medium?: string | null): number {
    return MEDIA_CREDITS[medium as MediumType] ?? MEDIA_CREDITS.image
}
