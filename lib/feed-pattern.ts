/**
 * Feed pattern — the visual rhythm of the Instagram profile grid.
 * ===============================================================
 * Pure, dependency-free (client + server safe).
 *
 * Individually good posts still make a messy profile: the grid is what a visitor judges in
 * the two seconds before they decide to follow. A feed pattern assigns each upcoming post a
 * VISUAL MODE (photo / typography / graphic) by its position in the grid, so the profile
 * reads as a deliberate composition instead of a pile.
 *
 * How it plugs into the engine: a mode maps onto a GROUP of the AI Designer's existing
 * LAYOUT_ARCHETYPES (instagram/image-pipeline.ts). The designer keeps its anti-repetition
 * rules — it just picks from the slot's group instead of all eight. Cohesion comes from the
 * pattern, variety from the divergence rules, and the two stop fighting each other.
 *
 * Drift is expected, not prevented. Intents are recomputed from the live post count at every
 * plan/generation, and they only ever bias an archetype choice — they are never a publish
 * gate. A deleted or out-of-order post shifts a grid-aligned pattern by a cell until the next
 * post re-anchors it; `checkerboard` can't drift visibly at all (see below).
 */

export type FeedPatternId = "none" | "checkerboard" | "rows" | "columns" | "diagonal"
export type VisualMode = "photo" | "typography" | "graphic"

export interface SlotIntent {
    patternId: FeedPatternId
    /** Chronological index in the feed (0 = oldest). Recorded for debugging//traceability. */
    seqIndex: number
    visualMode: VisualMode
    /** Lean hard into the brand accent colour — used by the diagonal pattern's punctuation cells. */
    accent?: boolean
}

/**
 * Visual modes → the designer's layout archetypes. Every LAYOUT_ARCHETYPES value appears
 * exactly once; if that list ever changes, this mapping must be updated with it (the engine
 * asserts membership, so an unmapped archetype simply never gets picked by a pattern).
 */
export const ARCHETYPE_GROUPS: Record<VisualMode, readonly string[]> = {
    photo: ["full-bleed-photo", "candid-lifestyle", "editorial-magazine", "product-hero"],
    typography: ["poster-typography", "type-driven"],
    graphic: ["color-block-graphic", "split-layout"],
}

export const VISUAL_MODE_LABELS: Record<VisualMode, { label: string; icon: string }> = {
    photo: { label: "Fotka", icon: "📷" },
    typography: { label: "Typo", icon: "🔤" },
    graphic: { label: "Grafika", icon: "🎨" },
}

export interface FeedPatternDef {
    id: FeedPatternId
    label: string
    description: string
    /** True when the shape only reads correctly if posts land in whole rows of three. */
    gridAligned: boolean
}

export const FEED_PATTERNS: FeedPatternDef[] = [
    {
        id: "none",
        label: "Bez vzoru",
        description: "Každý post se rozhoduje sám za sebe. Maximální rozmanitost, žádný rytmus v mřížce.",
        gridAligned: false,
    },
    {
        id: "checkerboard",
        label: "Šachovnice",
        description: "Střídá fotku a typografický post. V mřížce o třech sloupcích vznikne šachovnice — drží tvar i když posty ubydou.",
        gridAligned: false,
    },
    {
        id: "rows",
        label: "Řádky",
        description: "Celý řádek fotek, celý řádek typografie. Klidný, redakční feed.",
        gridAligned: true,
    },
    {
        id: "columns",
        label: "Sloupce",
        description: "Prostřední sloupec typografický, krajní fotografické. Vytvoří svislou páteř profilu.",
        gridAligned: true,
    },
    {
        id: "diagonal",
        label: "Diagonála",
        description: "Každý čtvrtý post je grafický akcent v barvě značky — v mřížce vznikne diagonální rytmus.",
        gridAligned: true,
    },
]

export const VALID_PATTERNS: FeedPatternId[] = FEED_PATTERNS.map(p => p.id)

export function isFeedPattern(v: unknown): v is FeedPatternId {
    return typeof v === "string" && (VALID_PATTERNS as string[]).includes(v)
}

export function getPatternDef(id: FeedPatternId): FeedPatternDef {
    return FEED_PATTERNS.find(p => p.id === id) || FEED_PATTERNS[0]
}

/** Grid columns on an Instagram profile. */
const COLS = 3

/**
 * Reading position (0 = top-left, newest) of a post given its chronological index.
 * Instagram shows newest first, so the newest of `total` posts sits at position 0.
 */
function readingPos(seqIndex: number, projectedTotal: number): number {
    return Math.max(0, projectedTotal - 1 - seqIndex)
}

/**
 * The visual mode for one slot, or null when the pattern imposes nothing.
 *
 * `projectedTotal` is how many posts the feed is expected to hold once the batch lands —
 * grid-aligned patterns need it to know which row/column a post falls in. `checkerboard`
 * ignores it entirely, which is exactly why it's the robust default: it keys off the
 * chronological index's parity, and with an ODD column count strict alternation renders as a
 * true checkerboard for any total. A wrong count merely inverts the colours of the board.
 */
export function computeSlotIntent(
    pattern: FeedPatternId,
    seqIndex: number,
    projectedTotal: number,
): SlotIntent | null {
    if (pattern === "none" || !isFeedPattern(pattern)) return null
    const base = { patternId: pattern, seqIndex }

    switch (pattern) {
        case "checkerboard":
            return { ...base, visualMode: seqIndex % 2 === 0 ? "photo" : "typography" }

        case "rows": {
            const row = Math.floor(readingPos(seqIndex, projectedTotal) / COLS)
            return { ...base, visualMode: row % 2 === 0 ? "photo" : "typography" }
        }

        case "columns": {
            const col = readingPos(seqIndex, projectedTotal) % COLS
            return { ...base, visualMode: col === 1 ? "typography" : "photo" }
        }

        case "diagonal": {
            const pos = readingPos(seqIndex, projectedTotal)
            // Every 4th cell in a 3-wide grid steps one column left each row → a diagonal.
            return pos % 4 === 0
                ? { ...base, visualMode: "graphic", accent: true }
                : { ...base, visualMode: "photo" }
        }

        default:
            return null
    }
}

/**
 * Slot intents for a whole batch appended to a feed that already holds `seqBase` posts.
 */
export function computeSlotIntents(
    pattern: FeedPatternId,
    seqBase: number,
    batchCount: number,
): (SlotIntent | null)[] {
    const projectedTotal = seqBase + batchCount
    return Array.from({ length: batchCount }, (_, i) =>
        computeSlotIntent(pattern, seqBase + i, projectedTotal),
    )
}

/**
 * The modes of the next `upcoming` posts, newest-first — i.e. in the order FeedTab renders
 * ghost cells above the real grid ("this is how the feed will continue").
 */
export function ghostRolesForPreview(
    pattern: FeedPatternId,
    existingCount: number,
    upcoming: number,
): VisualMode[] {
    const intents = computeSlotIntents(pattern, existingCount, upcoming)
    return intents
        .map(i => i?.visualMode)
        .filter((m): m is VisualMode => !!m)
        .reverse() // newest post first, matching the grid's top-left origin
}

/**
 * Recommend a starting pattern from what the brand's real feed already does (feed-vision's
 * dominantArchetypes). Deterministic — no extra model call.
 *
 * This recommends what the feed SHOULD become, not what it already is. An earlier version
 * returned "none" for a photo-only feed, reasoning that forcing typography onto a photography
 * brand would override a working identity. Measured against real client accounts, that was
 * wrong twice over:
 *
 *  1. `dominantArchetypes` reports the feed's MOST COMMON archetypes, not its only ones — a
 *     feed of 80% photos and 20% off-brand memes reports as photo-only. Dominance is not
 *     identity-by-choice, and the heuristic can't tell a deliberate photography brand from a
 *     feed nobody ever art-directed.
 *  2. Every real account tested came back photo-only, so the rule recommended "none" to
 *     everyone — while the same vision pass was separately telling those very brands to
 *     "unify typography for text posts". Preserving an undesigned grid is the opposite of
 *     what a customer buys this for.
 *
 * So: "none" means "no data to go on", never "your feed is fine". `checkerboard` is the
 * default because it's the order-invariant one (a wrong seqBase can only invert it) and it
 * gives a photo feed the typographic punctuation that makes a grid read as designed. The user
 * can always override in Settings — this is a suggestion, not a lock.
 */
export function recommendPattern(profile: { dominantArchetypes?: string[] } | null | undefined): FeedPatternId {
    const archetypes = profile?.dominantArchetypes || []
    if (archetypes.length === 0) return "none"

    // Already leaning on colour blocks / split layouts → punctuate with them rather than
    // introducing a typographic axis the brand hasn't shown any appetite for.
    const hasGraphic = archetypes.some(a => ARCHETYPE_GROUPS.graphic.includes(a))
    if (hasGraphic) return "diagonal"

    return "checkerboard"
}
