/**
 * Idea-bank replenishment math — pure-function checks (no DB, no network).
 *   npx tsx scripts/test-idea-replenish.ts
 *
 * A regression here doesn't crash anything — the bank just quietly stops
 * refilling (the exact silent-starvation bug the agent exists to kill) or
 * starts overgenerating on every daily tick. So the math gets asserted.
 */

import {
    computeReplenishPlan,
    RUNWAY_WEEKS,
    MIN_TARGET,
    MIN_REFILL,
    MAX_BATCH,
    MAX_BATCHES_PER_RUN,
    type PillarState,
} from "../lib/agents/idea-replenish"

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

const pillars = (spec: Array<[string, number, number]>): PillarState[] =>
    spec.map(([id, ratio, available]) => ({ id, ratio, available }))

console.log("\n— Full bank no-ops —")
{
    // 4/wk → target max(10, 8) = 10; 12 available → no refill.
    const plan = computeReplenishPlan(4, pillars([["a", 50, 6], ["b", 50, 6]]))
    eq("target is runway floor", plan.target, MIN_TARGET)
    eq("no batches when above target", plan.batches, [])
    eq("need clamps to 0", plan.need, 0)
}

console.log("\n— 2×/day starved bank refills —")
{
    // 14/wk → target 28; 3 available → need 25 → capped at 2 batches × 8.
    const plan = computeReplenishPlan(14, pillars([["a", 40, 1], ["b", 30, 1], ["c", 30, 1]]))
    eq("target scales with cadence", plan.target, 14 * RUNWAY_WEEKS)
    eq("batch count capped", plan.batches.length, MAX_BATCHES_PER_RUN)
    check("every batch capped at MAX_BATCH", plan.batches.every(b => b.count <= MAX_BATCH))
    eq("most starved pillar first", plan.batches[0].pillarId, "a")
}

console.log("\n— Dribbles are skipped —")
{
    // Need 3 (< MIN_REFILL) → wait for a meaningful refill instead of daily crumbs.
    const plan = computeReplenishPlan(4, pillars([["a", 100, MIN_TARGET - (MIN_REFILL - 1)]]))
    eq("small need produces no batches", plan.batches, [])
    check("need still reported", plan.need === MIN_REFILL - 1)
}

console.log("\n— Starvation is ratio-fair —")
{
    // Same absolute counts, but a's fair share (50 % of 10 = 5) is hungrier than
    // b's (10 % of 10 = 1): the 2-idea 50 % pillar must win over the 2-idea 10 %.
    const plan = computeReplenishPlan(1, pillars([["b", 10, 2], ["a", 50, 2]]))
    eq("high-ratio pillar refills first", plan.batches[0]?.pillarId, "a")
}

console.log("\n— Zero/unset ratios fall back to equal shares —")
{
    const plan = computeReplenishPlan(7, pillars([["a", 0, 0], ["b", 0, 4]]))
    eq("emptier pillar wins under equal shares", plan.batches[0]?.pillarId, "a")
    check("refill never exceeds need", plan.batches.reduce((s, b) => s + b.count, 0) <= plan.need)
}

console.log("\n— Retired-pillar ideas count toward the runway —")
{
    // 8 orphans + 4 in-pillar = 12 available ≥ target 10 → no refill even though
    // the config pillar itself looks starved.
    const plan = computeReplenishPlan(4, pillars([["a", 100, 4]]), 8)
    eq("orphans included in available", plan.available, 12)
    eq("orphans can satisfy the runway", plan.batches, [])
}

console.log("\n— No pillars → nothing to generate —")
{
    const plan = computeReplenishPlan(14, [])
    eq("empty pillar list is a no-op", plan.batches, [])
}

console.log("\n— Garbage cadence clamps —")
{
    // 0 → default 4, 99 → clamp to 14: target stays in [MIN_TARGET, 28].
    eq("cadence 0 defaults", computeReplenishPlan(0, pillars([["a", 100, 0]])).target, MIN_TARGET)
    eq("cadence 99 clamps to 2×/day", computeReplenishPlan(99, pillars([["a", 100, 0]])).target, 14 * RUNWAY_WEEKS)
}

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
