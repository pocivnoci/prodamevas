/**
 * Feed pattern math — pure-function checks (no DB, no network).
 *   npx tsx scripts/test-feed-pattern.ts
 *
 * The grid math is the part that's easy to get subtly wrong and impossible to eyeball later
 * (a drifted pattern just looks like "the AI is being random again"), so it gets asserted.
 */

import {
    computeSlotIntent,
    computeSlotIntents,
    ghostRolesForPreview,
    recommendPattern,
    isFeedPattern,
    ARCHETYPE_GROUPS,
    FEED_PATTERNS,
    VALID_PATTERNS,
    type FeedPatternId,
    type VisualMode,
} from "../lib/feed-pattern"
import { LAYOUT_ARCHETYPES } from "../instagram/image-pipeline"

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail?: string) {
    if (cond) { passed++; console.log(`  ✅ ${name}`) }
    else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`) }
}

function eq<T>(name: string, actual: T, expected: T) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    check(name, a === e, `expected ${e}, got ${a}`)
}

/** Render the grid the way Instagram does: newest first, 3 per row, as mode initials. */
function renderGrid(pattern: FeedPatternId, total: number): string[] {
    const modes: string[] = []
    for (let seq = 0; seq < total; seq++) {
        modes[total - 1 - seq] = computeSlotIntent(pattern, seq, total)?.visualMode?.[0] ?? "-"
    }
    const rows: string[] = []
    for (let i = 0; i < modes.length; i += 3) rows.push(modes.slice(i, i + 3).join(""))
    return rows
}

console.log("\n🔲 FEED PATTERN\n")

// ── Archetype groups must exactly partition the designer's archetype list ──
console.log("Archetype groups:")
{
    const grouped = Object.values(ARCHETYPE_GROUPS).flat()
    const all = [...LAYOUT_ARCHETYPES] as string[]
    check("every archetype is mapped to a visual mode",
        all.every(a => grouped.includes(a)),
        `unmapped: ${all.filter(a => !grouped.includes(a)).join(", ")}`)
    check("no archetype is mapped twice",
        new Set(grouped).size === grouped.length)
    check("no group references a non-existent archetype",
        grouped.every(a => all.includes(a)),
        `unknown: ${grouped.filter(a => !all.includes(a)).join(", ")}`)
    check("every group is non-empty (an empty group would make its slot unrenderable)",
        Object.values(ARCHETYPE_GROUPS).every(g => g.length > 0))
}

// ── "none" and garbage impose nothing ──
console.log("\nNo-pattern handling:")
check("'none' yields no intent", computeSlotIntent("none", 0, 10) === null)
check("garbage pattern yields no intent", computeSlotIntent("bogus" as FeedPatternId, 0, 10) === null)
check("isFeedPattern rejects garbage", !isFeedPattern("bogus"))
check("isFeedPattern accepts every registered pattern", VALID_PATTERNS.every(isFeedPattern))
check("registry and validator agree", FEED_PATTERNS.length === VALID_PATTERNS.length)

// ── Checkerboard: the robustness claim that makes it the default ──
console.log("\nCheckerboard:")
eq("alternates by chronological parity",
    [0, 1, 2, 3].map(i => computeSlotIntent("checkerboard", i, 4)!.visualMode),
    ["photo", "typography", "photo", "typography"])
{
    // The whole point: with 3 columns, strict parity alternation is a true checkerboard at ANY
    // total — so a miscounted seqBase can only invert the board, never break the pattern.
    let ok = true
    for (let total = 3; total <= 30; total++) {
        for (let seq = 0; seq < total; seq++) {
            const pos = total - 1 - seq
            const mode = computeSlotIntent("checkerboard", seq, total)!.visualMode
            // Neighbours in reading order must always differ.
            if (pos + 1 < total) {
                const right = computeSlotIntent("checkerboard", total - 1 - (pos + 1), total)!.visualMode
                if (mode === right) { ok = false }
            }
        }
    }
    check("adjacent cells always differ, for every total 3..30", ok)

    const a = computeSlotIntent("checkerboard", 7, 8)!.visualMode
    const b = computeSlotIntent("checkerboard", 7, 99)!.visualMode
    check("total is irrelevant (immune to a wrong seqBase)", a === b)
}

// ── Rows: whole rows of one mode ──
console.log("\nRows:")
eq("6 posts → two uniform rows", renderGrid("rows", 6), ["ppp", "ttt"])
eq("9 posts → alternating rows", renderGrid("rows", 9), ["ppp", "ttt", "ppp"])

// ── Columns: middle column is the spine ──
console.log("\nColumns:")
eq("9 posts → typography spine down the middle", renderGrid("columns", 9), ["ptp", "ptp", "ptp"])

// ── Diagonal: accent cells step across ──
console.log("\nDiagonal:")
eq("12 posts → every 4th cell is a graphic accent", renderGrid("diagonal", 12), ["gpp", "pgp", "ppg", "ppp"])
check("accent flag rides the graphic cells only", (() => {
    for (let seq = 0; seq < 12; seq++) {
        const it = computeSlotIntent("diagonal", seq, 12)!
        if ((it.visualMode === "graphic") !== (it.accent === true)) return false
    }
    return true
})())

// ── Batch + preview helpers ──
console.log("\nBatch / preview:")
{
    const intents = computeSlotIntents("checkerboard", 5, 4)
    eq("batch continues the existing feed's parity",
        intents.map(i => i!.visualMode),
        ["typography", "photo", "typography", "photo"])
    eq("seqIndex is absolute, not batch-relative", intents.map(i => i!.seqIndex), [5, 6, 7, 8])
    eq("'none' batch yields all nulls", computeSlotIntents("none", 0, 3), [null, null, null])
    eq("empty batch is empty", computeSlotIntents("checkerboard", 0, 0), [])

    // Ghosts render newest-first (top-left), the reverse of chronological order.
    const ghosts = ghostRolesForPreview("checkerboard", 4, 3)
    eq("ghost roles are newest-first", ghosts, ["photo", "typography", "photo"])
    eq("'none' has no ghosts", ghostRolesForPreview("none", 4, 3), [] as VisualMode[])
}

// ── recommendPattern ──
console.log("\nRecommendation:")
eq("mixed photo+typography feed → checkerboard",
    recommendPattern({ dominantArchetypes: ["full-bleed-photo", "poster-typography"] }), "checkerboard")
eq("graphic-leaning feed → diagonal",
    recommendPattern({ dominantArchetypes: ["color-block-graphic", "candid-lifestyle"] }), "diagonal")
// Regression: this returned "none" and made the recommendation a no-op for every real client
// (all measured accounts are photo-dominant). dominantArchetypes reports the most common
// archetypes, not the only ones — it cannot prove a feed is deliberately photographic.
eq("photo-only feed → checkerboard (give an undesigned grid a rhythm, don't preserve it)",
    recommendPattern({ dominantArchetypes: ["full-bleed-photo", "candid-lifestyle"] }), "checkerboard")
eq("real muj-jogurt archetypes → checkerboard",
    recommendPattern({ dominantArchetypes: ["product-hero", "candid-lifestyle"] }), "checkerboard")
// "none" means "nothing to go on" — never "your feed is fine".
eq("no data → none", recommendPattern({ dominantArchetypes: [] }), "none")
eq("null profile → none", recommendPattern(null), "none")
eq("unknown archetypes don't crash (unmapped → no graphic signal → default)",
    recommendPattern({ dominantArchetypes: ["something-invented"] }), "checkerboard")

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
