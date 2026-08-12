/**
 * Credit window math — pure-function checks (no DB, no network).
 *   npx tsx scripts/test-credit-periods.ts
 *
 * The credit window is what decides how much AI a customer gets for their money.
 * It used to be the calendar month, which meant paying on the 25th bought six days
 * of one allowance and then a whole fresh one — and on a yearly plan, one payment
 * bought twelve resets. These assertions are the guard against that returning.
 */

import {
    addMonths,
    computeBillingPeriod,
    computeCreditWindow,
    monthsElapsed,
} from "../lib/billing-period"

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

const D = (s: string) => new Date(s)
const iso = (d: Date) => d.toISOString()
const win = (anchor: string, now: string) => {
    const w = computeCreditWindow({ now: D(now), anchor: D(anchor) })
    return [iso(w.start), iso(w.end)]
}

// ── months elapsed ──
console.log("\nmonthsElapsed:")
eq("same instant", monthsElapsed(D("2026-07-25T10:00:00.000Z"), D("2026-07-25T10:00:00.000Z")), 0)
eq("one day before the anniversary is still month 0", monthsElapsed(D("2026-07-25T10:00:00.000Z"), D("2026-08-24T10:00:00.000Z")), 0)
eq("the anniversary itself flips the window", monthsElapsed(D("2026-07-25T10:00:00.000Z"), D("2026-08-25T10:00:00.000Z")), 1)
// The old calendar-month logic reset here; the credit window must not.
eq("crossing the 1st does NOT count as a month", monthsElapsed(D("2026-07-25T10:00:00.000Z"), D("2026-08-01T00:00:00.000Z")), 0)
eq("eleven months in", monthsElapsed(D("2026-03-10T10:00:00.000Z"), D("2027-02-09T10:00:00.000Z")), 10)
eq("anchor in the future clamps to 0", monthsElapsed(D("2026-09-01T10:00:00.000Z"), D("2026-07-01T10:00:00.000Z")), 0)

// ── monthly plan ──
console.log("\nMonthly plan:")
eq("window is the paid period", win("2026-07-25T10:00:00.000Z", "2026-07-30T12:00:00.000Z"),
    ["2026-07-25T10:00:00.000Z", "2026-08-25T10:00:00.000Z"])
// THE regression: paid on the 25th, it is now the 3rd of the next month. The old
// code handed out a whole new allowance on the 1st — for Impérium that is 220
// credits (~66 USD of API cost) given away six days early, every month.
eq("crossing the calendar month does not reset", win("2026-07-25T10:00:00.000Z", "2026-08-03T09:00:00.000Z"),
    ["2026-07-25T10:00:00.000Z", "2026-08-25T10:00:00.000Z"])
eq("the anniversary does reset", win("2026-07-25T10:00:00.000Z", "2026-08-25T10:00:01.000Z"),
    ["2026-08-25T10:00:00.000Z", "2026-09-25T10:00:00.000Z"])

// ── month-end anchors ──
console.log("\nMonth-end anchor (31st):")
eq("Jan 31 anchor → Feb window clamps to Feb 28", win("2026-01-31T10:00:00.000Z", "2026-02-15T10:00:00.000Z"),
    ["2026-01-31T10:00:00.000Z", "2026-02-28T10:00:00.000Z"])
// Anchored, not chained: March must come back to the 31st rather than staying on
// the 28th forever (which would quietly hand out ~3 extra days of credits a year).
eq("March window returns to the 31st", win("2026-01-31T10:00:00.000Z", "2026-03-20T10:00:00.000Z"),
    ["2026-02-28T10:00:00.000Z", "2026-03-31T10:00:00.000Z"])

// ── yearly plan: one payment, twelve windows ──
console.log("\nYearly plan (one payment, twelve credit windows):")
{
    const anchor = D("2026-03-10T08:00:00.000Z")
    // Paid period runs a full year …
    const paid = computeBillingPeriod({ now: anchor, termMonths: 12 })
    eq("paid period ends in a year", iso(paid.end), "2027-03-10T08:00:00.000Z")

    // … while the credit window walks month by month underneath it.
    eq("month 1", win(iso(anchor), "2026-03-15T08:00:00.000Z"),
        ["2026-03-10T08:00:00.000Z", "2026-04-10T08:00:00.000Z"])
    eq("month 6", win(iso(anchor), "2026-09-01T08:00:00.000Z"),
        ["2026-08-10T08:00:00.000Z", "2026-09-10T08:00:00.000Z"])
    eq("month 12 (last before renewal)", win(iso(anchor), "2027-03-09T08:00:00.000Z"),
        ["2027-02-10T08:00:00.000Z", "2027-03-10T08:00:00.000Z"])

    // Exactly 12 distinct windows inside one paid year — not 13, not 11.
    const starts = new Set<string>()
    for (let d = new Date(anchor); d < paid.end; d = new Date(d.getTime() + 24 * 60 * 60 * 1000)) {
        starts.add(iso(computeCreditWindow({ now: d, anchor }).start))
    }
    eq("a paid year contains exactly 12 credit windows", starts.size, 12)
}

// ── renewal after dunning ──
console.log("\nRenewal after dunning:")
{
    // Monthly sub, period ended Jul 25, the retry succeeds 2 days late. The paid
    // period chains (phase 1) and the credit window must follow the SAME anchor —
    // otherwise the credit reset and the charge drift apart month by month.
    const prevEnd = D("2026-07-25T10:00:00.000Z")
    const renewedAt = D("2026-07-27T06:00:00.000Z")
    const period = computeBillingPeriod({ now: renewedAt, termMonths: 1, previousPeriodEnd: prevEnd })
    eq("paid period chains off the old end", iso(period.start), iso(prevEnd))

    // activatePaidPlan sets credit_period_start = paid period start.
    const creditStart = period.start
    eq("credit window follows the paid period", [iso(creditStart), iso(addMonths(creditStart, 1))],
        ["2026-07-25T10:00:00.000Z", "2026-08-25T10:00:00.000Z"])
    // The two days spent in dunning are inside the window the customer just paid
    // for — they are not a free extra window.
    eq("during dunning the reader is already in the new window", win(iso(creditStart), iso(renewedAt)),
        ["2026-07-25T10:00:00.000Z", "2026-08-25T10:00:00.000Z"])
}

// ── worker/reader agreement ──
console.log("\nIdempotence (worker write == reader derive):")
{
    const anchor = D("2026-01-31T10:00:00.000Z")
    const now = D("2026-06-05T10:00:00.000Z")
    const first = computeCreditWindow({ now, anchor })
    eq("month-end anchor stays on the anchor day", [iso(first.start), iso(first.end)],
        ["2026-05-31T10:00:00.000Z", "2026-06-30T10:00:00.000Z"])

    // The worker and the reader must derive the window from the SAME anchor
    // (current_period_start), never from the last window they wrote. Re-anchoring
    // on a clamped start is exactly how a Jan-31 customer would drift to the 28th
    // and stay there — this asserts the difference is real, so the anchor choice in
    // resolveCreditWindow can't be "simplified" away later.
    let reAnchored = anchor
    for (let i = 0; i < 4; i++) reAnchored = computeCreditWindow({ now: addMonths(reAnchored, 1), anchor: reAnchored }).start
    check("re-anchoring on the persisted start DOES drift (why we anchor on current_period_start)",
        iso(reAnchored) !== iso(first.start),
        `re-anchored ${iso(reAnchored)} vs stable ${iso(first.start)}`)

    // The worker's real cadence: each run lands on/after the window end and rolls to
    // the next one. Stepping like that from the stable anchor must reach exactly the
    // window a single jump gives — otherwise a long-down worker and a live one would
    // disagree about how many credits a customer has.
    let stepped = anchor
    for (let i = 0; i < 4; i++) stepped = computeCreditWindow({ now: stepped, anchor }).end
    eq("stepping window by window == jumping", iso(stepped), iso(first.start))

    // And a mid-window read is a no-op relative to the window boundary read.
    const midWindow = computeCreditWindow({ now: D("2026-06-20T10:00:00.000Z"), anchor })
    eq("any instant inside a window yields that window", [iso(midWindow.start), iso(midWindow.end)],
        [iso(first.start), iso(first.end)])
}

// ── a lapsed sub nobody touched ──
console.log("\nLong-lapsed window (worker was down / legacy row):")
eq("jumps straight to the window containing now", win("2025-11-15T10:00:00.000Z", "2026-07-28T10:00:00.000Z"),
    ["2026-07-15T10:00:00.000Z", "2026-08-15T10:00:00.000Z"])
check("window always contains now",
    (() => {
        const now = D("2026-07-28T10:00:00.000Z")
        const w = computeCreditWindow({ now, anchor: D("2024-02-29T23:59:00.000Z") })
        return w.start <= now && now < w.end
    })(), "start <= now < end")

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
