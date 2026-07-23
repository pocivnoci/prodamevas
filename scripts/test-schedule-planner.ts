/**
 * Schedule planner math — pure-function checks (no DB, no network).
 *   npx tsx scripts/test-schedule-planner.ts
 *
 * The weekly spread is what makes a "Měsíc" plan actually span a month. A regression here
 * doesn't crash anything — the calendar just quietly compresses back into consecutive days,
 * which is exactly the bug this replaced. So the math gets asserted.
 */

import { distributeSchedule, toScheduledFor } from "../lib/schedule-planner"

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

/** A start date safely in the future so the tomorrow-clamp never interferes. */
function futureStart(): Date {
    const d = new Date()
    d.setDate(d.getDate() + 10)
    d.setHours(0, 0, 0, 0)
    return d
}

/** Day offset of slot's date from the given start (whole days, DST-safe via UTC noon). */
function dayOffset(start: Date, dateStr: string): number {
    const [y, m, d] = dateStr.split("-").map(Number)
    const a = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())
    const b = Date.UTC(y, m - 1, d)
    return Math.round((b - a) / 86_400_000)
}

console.log("\n📅 SCHEDULE PLANNER\n")

const start = futureStart()

// ── Weekly day offsets: even spacing, never more than one post per day ──
console.log("Day offsets per cadence:")
{
    const offsetsFor = (perWeek: number) =>
        distributeSchedule(perWeek, { startDate: start, postsPerWeek: perWeek }).map(s => dayOffset(start, s.date))
    eq("cadence 2 → days [0,3]", offsetsFor(2), [0, 3])
    eq("cadence 3 → days [0,2,4]", offsetsFor(3), [0, 2, 4])
    eq("cadence 4 → days [0,1,3,5]", offsetsFor(4), [0, 1, 3, 5])
    eq("cadence 5 → days [0,1,2,4,5]", offsetsFor(5), [0, 1, 2, 4, 5])
    eq("cadence 7 → every day", offsetsFor(7), [0, 1, 2, 3, 4, 5, 6])
}

// ── The headline claim: a month plan spans a month ──
console.log("\nMonth span:")
{
    const slots = distributeSchedule(16, { startDate: start, postsPerWeek: 4 })
    eq("16 posts @ 4/week → 16 slots", slots.length, 16)
    eq("first post on the start day", dayOffset(start, slots[0].date), 0)
    eq("last post lands on day 26 (start of week 4 + offset 5)", dayOffset(start, slots[15].date), 26)
}

// ── Structural invariants across counts and cadences ──
console.log("\nInvariants:")
{
    let countOk = true, uniqueOk = true, monotonicOk = true
    for (const perWeek of [1, 2, 3, 4, 5, 6, 7]) {
        for (const count of [1, 3, 8, 16, 30]) {
            const slots = distributeSchedule(count, { startDate: start, postsPerWeek: perWeek })
            if (slots.length !== count) countOk = false
            const dates = slots.map(s => s.date)
            if (new Set(dates).size !== dates.length) uniqueOk = false
            const offsets = dates.map(d => dayOffset(start, d))
            for (let i = 1; i < offsets.length; i++) if (offsets[i] <= offsets[i - 1]) monotonicOk = false
        }
    }
    check("count is always preserved", countOk)
    check("no two posts share a date (cadence ≤ 7 → max 1/day)", uniqueOk)
    check("dates are strictly increasing", monotonicOk)
}

// ── Clamps ──
console.log("\nClamps:")
{
    const past = new Date(2020, 0, 1)
    const slots = distributeSchedule(2, { startDate: past, postsPerWeek: 2 })
    const tomorrow = new Date()
    tomorrow.setHours(0, 0, 0, 0)
    tomorrow.setDate(tomorrow.getDate() + 1)
    eq("past start clamps to tomorrow", dayOffset(tomorrow, slots[0].date), 0)

    eq("cadence 0 clamps to 1 (one post per week)",
        distributeSchedule(2, { startDate: start, postsPerWeek: 0 }).map(s => dayOffset(start, s.date)),
        [0, 7])
    eq("cadence 7 → daily (one per day)",
        distributeSchedule(8, { startDate: start, postsPerWeek: 7 }).map(s => dayOffset(start, s.date)),
        [0, 1, 2, 3, 4, 5, 6, 7])
    eq("cadence 20 clamps to 14 (2×/day)",
        distributeSchedule(8, { startDate: start, postsPerWeek: 20 }).map(s => dayOffset(start, s.date)),
        [0, 0, 1, 1, 2, 2, 3, 3])
    eq("count 0 → empty", distributeSchedule(0, { startDate: start, postsPerWeek: 4 }), [])
}

// ── 2× per day (cadence 14) ──
console.log("\n2×/day (cadence 14):")
{
    const slots = distributeSchedule(14, { startDate: start, postsPerWeek: 14 })
    eq("14 posts → 2 per day across 7 days",
        slots.map(s => dayOffset(start, s.date)),
        [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6])
    eq("first day uses two distinct default slots", slots.slice(0, 2).map(s => s.time), ["09:00", "17:00"])
    const byDay: Record<number, string[]> = {}
    for (const s of slots) { const o = dayOffset(start, s.date); (byDay[o] ??= []).push(s.time) }
    check("each of 7 days gets exactly 2 posts", Object.values(byDay).every(t => t.length === 2))
    check("same-day posts never share a time", Object.values(byDay).every(t => new Set(t).size === t.length))
}

// ── Times ──
console.log("\nTimes:")
{
    const slots = distributeSchedule(8, { startDate: start, postsPerWeek: 4 })
    eq("times rotate through the default slots by week position",
        slots.map(s => s.time),
        ["09:00", "17:00", "19:00", "09:00", "09:00", "17:00", "19:00", "09:00"])
    check("rotation is stable week over week",
        slots.slice(0, 4).every((s, i) => s.time === slots[4 + i].time))
    eq("custom slots are sorted chronologically before use",
        distributeSchedule(2, { startDate: start, postsPerWeek: 2, timeSlots: ["18:00", "08:00"] }).map(s => s.time),
        ["08:00", "18:00"])
}

// ── DB shape helper: Prague local wall time → UTC instant (DST-aware) ──
console.log("\nscheduled_for (Prague → UTC):")
eq("summer 09:00 Prague (CEST, +2) → 07:00Z", toScheduledFor("2026-08-01", "09:00"), "2026-08-01T07:00:00.000Z")
eq("winter 09:00 Prague (CET, +1) → 08:00Z", toScheduledFor("2026-01-15", "09:00"), "2026-01-15T08:00:00.000Z")
check("stored as UTC ISO (Z suffix)", toScheduledFor("2026-08-01", "17:00").endsWith("Z"))

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
