/**
 * Media-weighted credit costs — client-safe module (no server imports).
 * Single source of truth; lib/subscription.ts re-exports these for the backend,
 * client components import directly for UI estimates.
 *
 * 1 credit ≈ $0.30 of AI COGS: a reel costs ~4× an image to produce, so a flat
 * 1-credit-per-post price sold reels below cost. See docs/UNIT_ECONOMICS_AND_PRICING.md §4.
 */

/**
 * The price of every medium the engine can produce — and, via `MediumType` below,
 * the DEFINITION of which media exist at all.
 *
 * Adding a key here is the ONE edit that opens a new medium: every exhaustive
 * switch over `MediumType` stops compiling until it is handled. The inversion is
 * deliberate — a medium the engine can render but nobody priced is not
 * representable, which is how `story` was almost shipped billing 1 credit through
 * `creditsForMedia`'s image fallback.
 */
export const MEDIA_CREDITS = {
    image: 1,
    story: 2,
    carousel: 3,
    reel: 5,
} as const

export type MediumType = keyof typeof MEDIA_CREDITS

/** Everything a plan with no `allowed_media` may use (legacy/trial = all). */
export const ALL_MEDIA = Object.keys(MEDIA_CREDITS) as MediumType[]

/** Narrowing guard for values arriving from the DB / job configs as bare strings. */
export function isMediumType(v: unknown): v is MediumType {
    return typeof v === "string" && v in MEDIA_CREDITS
}

/**
 * Credit cost of a post for a given medium; unknown/missing medium = image (cheapest).
 *
 * The fallback stays deliberately lenient: the input is `string | null` straight from
 * `ig_posts.media_type`, where every row predating 20260622 is NULL, and throwing here
 * would break the posts list. It is also safe by construction — `reconcileJobCharge`
 * only ever refunds DOWNWARD, so pricing an unknown medium as the cheapest yields the
 * maximum refund, never an overcharge. The "every medium is priced" guarantee comes
 * from `MediumType` being derived from this table, not from this runtime path.
 */
export function creditsForMedia(medium?: string | null): number {
    return MEDIA_CREDITS[medium as MediumType] ?? MEDIA_CREDITS.image
}
