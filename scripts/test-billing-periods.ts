/**
 * Billing period math — pure-function checks (no DB, no network).
 *   npx tsx scripts/test-billing-periods.ts
 *
 * These are the two failure modes that are invisible in production until a
 * customer complains months later: a yearly plan billed like a monthly one, and
 * a renewal date that walks forward a few days every cycle because dunning took
 * a day or two and the period restarted at `now` instead of chaining.
 */

import {
    addInterval,
    addMonths,
    computeBillingPeriod,
    normalizeInterval,
    renewalNoticeDays,
    resolveTermMonths,
    PERIOD_CHAIN_GRACE_DAYS,
    type BillingInterval,
} from "../lib/billing-period"
import {
    BILLING_TERMS,
    FALLBACK_PLANS,
    monthlyEquivalent,
    normalizeTermMonths,
    termPrice,
    termSavings,
} from "../lib/pricing"

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

const iso = (d: Date) => d.toISOString()
const D = (s: string) => new Date(s)
const DAY_MS = 24 * 60 * 60 * 1000

// ── interval parsing ──
console.log("\nnormalizeInterval:")
eq("'month' → month", normalizeInterval("month"), "month" as BillingInterval)
eq("'year' → year", normalizeInterval("year"), "year" as BillingInterval)
eq("'YEARLY' → year", normalizeInterval("YEARLY"), "year" as BillingInterval)
eq("'annual' → year", normalizeInterval("annual"), "year" as BillingInterval)
// Unknown/missing must fall back to the CHEAPER period — a mis-typed interval
// that silently became "year" would hand out 12 months for one month's price.
eq("null → month", normalizeInterval(null), "month" as BillingInterval)
eq("garbage → month", normalizeInterval("kvartál"), "month" as BillingInterval)

// ── calendar math ──
console.log("\naddMonths / addInterval:")
eq("plain month", iso(addMonths(D("2026-03-10T08:00:00.000Z"), 1)), "2026-04-10T08:00:00.000Z")
// The old periodEnd.setMonth(+1) turned Jan 31 into Mar 3 — three free days.
eq("Jan 31 + 1M clamps to Feb 28", iso(addMonths(D("2026-01-31T12:00:00.000Z"), 1)), "2026-02-28T12:00:00.000Z")
eq("Jan 31 + 1M clamps to Feb 29 in a leap year", iso(addMonths(D("2028-01-31T12:00:00.000Z"), 1)), "2028-02-29T12:00:00.000Z")
eq("May 31 + 1M clamps to Jun 30", iso(addMonths(D("2026-05-31T12:00:00.000Z"), 1)), "2026-06-30T12:00:00.000Z")
eq("year rollover", iso(addMonths(D("2026-12-15T12:00:00.000Z"), 1)), "2027-01-15T12:00:00.000Z")
eq("month interval = +1 month", iso(addInterval(D("2026-07-27T09:30:00.000Z"), "month")), "2026-08-27T09:30:00.000Z")
eq("year interval = +12 months", iso(addInterval(D("2026-07-27T09:30:00.000Z"), "year")), "2027-07-27T09:30:00.000Z")
eq("Feb 29 + 1 year clamps to Feb 28", iso(addInterval(D("2028-02-29T12:00:00.000Z"), "year")), "2029-02-28T12:00:00.000Z")

// ── first payment ──
console.log("\nFirst payment (no previous period):")
{
    const now = D("2026-07-27T10:00:00.000Z")
    const m = computeBillingPeriod({ now, termMonths: 1 })
    eq("monthly starts now", iso(m.start), iso(now))
    eq("monthly ends +1 month", iso(m.end), "2026-08-27T10:00:00.000Z")

    const y = computeBillingPeriod({ now, termMonths: 12 })
    eq("yearly starts now", iso(y.start), iso(now))
    // The whole point of reading plan.interval: a yearly plan must NOT come back
    // for another charge in 30 days.
    eq("yearly ends +1 year", iso(y.end), "2027-07-27T10:00:00.000Z")
}

// ── renewal chaining ──
console.log("\nRenewal chaining:")
{
    const prevEnd = D("2026-07-27T10:00:00.000Z")
    // Worker charges the same minute the period lapses.
    const onTime = computeBillingPeriod({ now: prevEnd, termMonths: 1, previousPeriodEnd: prevEnd })
    eq("on-time renewal starts at the old end", iso(onTime.start), iso(prevEnd))
    eq("on-time renewal ends +1 month", iso(onTime.end), "2026-08-27T10:00:00.000Z")

    // Dunning: the retry succeeds two days late. The customer keeps access during
    // the grace window, so those days are paid for — the period must not shrink.
    const late = computeBillingPeriod({
        now: new Date(prevEnd.getTime() + 2 * DAY_MS),
        termMonths: 1,
        previousPeriodEnd: prevEnd,
    })
    eq("2-day-late renewal still starts at the old end", iso(late.start), iso(prevEnd))
    eq("2-day-late renewal keeps the anniversary", iso(late.end), "2026-08-27T10:00:00.000Z")

    // Early renewal (customer pays before the period runs out) must never truncate
    // the period they already paid for.
    const early = computeBillingPeriod({
        now: new Date(prevEnd.getTime() - 5 * DAY_MS),
        termMonths: 1,
        previousPeriodEnd: prevEnd,
    })
    eq("early renewal starts at the old end", iso(early.start), iso(prevEnd))
    eq("early renewal ends +1 month from the old end", iso(early.end), "2026-08-27T10:00:00.000Z")

    // Yearly renewal chains identically.
    const yearly = computeBillingPeriod({
        now: new Date(prevEnd.getTime() + DAY_MS),
        termMonths: 12,
        previousPeriodEnd: prevEnd,
    })
    eq("yearly renewal chains", iso(yearly.start), iso(prevEnd))
    eq("yearly renewal ends +1 year", iso(yearly.end), "2027-07-27T10:00:00.000Z")
}

// ── lapsed beyond the grace window ──
console.log("\nLapsed subscription (comeback):")
{
    const prevEnd = D("2026-04-01T10:00:00.000Z")
    const now = D("2026-07-27T10:00:00.000Z") // ~4 months later, sub long expired
    const back = computeBillingPeriod({ now, termMonths: 1, previousPeriodEnd: prevEnd })
    // Chaining here would sell a period that ended in the past.
    eq("comeback starts now, not at the dead end", iso(back.start), iso(now))
    eq("comeback ends +1 month from now", iso(back.end), "2026-08-27T10:00:00.000Z")

    // Just outside the chaining window: expired, no access → fresh period.
    const justOutside = computeBillingPeriod({
        now: new Date(prevEnd.getTime() + (PERIOD_CHAIN_GRACE_DAYS * DAY_MS) + 60_000),
        termMonths: 1,
        previousPeriodEnd: prevEnd,
    })
    check("renewal past the grace window restarts at now",
        justOutside.start.getTime() > prevEnd.getTime(),
        `start ${iso(justOutside.start)} should be after ${iso(prevEnd)}`)

    // Exactly at the edge still chains.
    const atEdge = computeBillingPeriod({
        now: new Date(prevEnd.getTime() + PERIOD_CHAIN_GRACE_DAYS * DAY_MS),
        termMonths: 1,
        previousPeriodEnd: prevEnd,
    })
    eq("renewal exactly at the grace edge still chains", iso(atEdge.start), iso(prevEnd))
}

// ── tier change: no proration ──
console.log("\nTier change (no proration):")
{
    const now = D("2026-07-10T10:00:00.000Z")
    // activatePaidPlan passes previousPeriodEnd=null for a tier change — the new
    // plan starts now and the remainder of the old period is forfeited.
    const upgraded = computeBillingPeriod({ now, termMonths: 1, previousPeriodEnd: null })
    eq("tier change starts now", iso(upgraded.start), iso(now))
    eq("tier change ends +1 month from now", iso(upgraded.end), "2026-08-10T10:00:00.000Z")
}

// ── multi-month terms ──
console.log("\nPředplacená období (3 / 6 / 12 měsíců):")
{
    const now = D("2026-08-12T10:00:00.000Z")
    eq("3 měsíce končí +3 měsíce", iso(computeBillingPeriod({ now, termMonths: 3 }).end), "2026-11-12T10:00:00.000Z")
    eq("6 měsíců končí +6 měsíců", iso(computeBillingPeriod({ now, termMonths: 6 }).end), "2027-02-12T10:00:00.000Z")
    eq("12 měsíců končí +12 měsíců", iso(computeBillingPeriod({ now, termMonths: 12 }).end), "2027-08-12T10:00:00.000Z")

    // Konec měsíce se svírá stejně jako u měsíčního období — 31. 8. + 6 měsíců
    // je 28. 2., ne 3. 3.
    eq("konec měsíce se svírá i u půlročního období",
        iso(computeBillingPeriod({ now: D("2026-08-31T10:00:00.000Z"), termMonths: 6 }).end),
        "2027-02-28T10:00:00.000Z")

    // Nesmyslné období (0, NaN, podvržená hodnota z requestu) nesmí vyrobit
    // období nulové délky — to by šlo obnovovat donekonečna zadarmo.
    eq("nesmyslné období spadne na měsíc", iso(computeBillingPeriod({ now, termMonths: 0 }).end), "2026-09-12T10:00:00.000Z")
}

// ── term change on the same tier ──
console.log("\nZměna období u téhož tarifu:")
{
    // Zákazník platí měsíčně do 12. 9. a 20. 8. přejde na roční. Nesmí přijít
    // o zbytek zaplaceného měsíce — roční období se má NAVÁZAT na jeho konec.
    const monthlyEnd = D("2026-09-12T10:00:00.000Z")
    const switched = computeBillingPeriod({
        now: D("2026-08-20T10:00:00.000Z"),
        termMonths: 12,
        previousPeriodEnd: monthlyEnd,
    })
    eq("přechod na roční začíná koncem zaplaceného měsíce", iso(switched.start), iso(monthlyEnd))
    eq("přechod na roční končí rok po něm", iso(switched.end), "2027-09-12T10:00:00.000Z")
}

// ── resolveTermMonths ──
console.log("\nresolveTermMonths (interval tarifu vs. období předplatného):")
{
    eq("měsíční tarif + 12 = 12", String(resolveTermMonths("month", 12)), "12")
    eq("měsíční tarif + 3 = 3", String(resolveTermMonths("month", 3)), "3")
    eq("chybějící období = 1", String(resolveTermMonths("month", null)), "1")
    eq("nepovolená hodnota = 1", String(resolveTermMonths("month", 24)), "1")
    // Kdyby někdo naseedoval tarif s roční cenou, období ho nesmí násobit —
    // jinak by jedna roční platba koupila dvanáct let.
    eq("roční tarif ignoruje období", String(resolveTermMonths("year", 12)), "12")
    eq("roční tarif ignoruje i měsíční období", String(resolveTermMonths("year", 1)), "12")
}

// ── renewal notice lead time ──
console.log("\nPředstih oznámení o obnově:")
{
    eq("měsíční = 3 dny", String(renewalNoticeDays(1)), "3")
    // Oznámit strh 19 900 Kč tři dny předem je pozvánka na chargeback.
    eq("čtvrtletní = 30 dní", String(renewalNoticeDays(3)), "30")
    eq("roční = 30 dní", String(renewalNoticeDays(12)), "30")
}

// ── ceník: žebřík období ──
console.log("\nCeník — žebřík období:")
{
    for (const plan of FALLBACK_PLANS) {
        let prevPerMonth = Infinity
        for (const t of BILLING_TERMS) {
            const total = termPrice(plan.monthlyHaleru, t.months)
            const perMonth = monthlyEquivalent(plan.monthlyHaleru, t.months)
            check(`${plan.name} / ${t.months} měs.: cena je celých 10 Kč`,
                total % 1000 === 0, `${total} haléřů není násobek 1000`)
            check(`${plan.name} / ${t.months} měs.: delší období nevyjde dráž`,
                perMonth <= prevPerMonth, `${perMonth} > ${prevPerMonth} haléřů/měs`)
            check(`${plan.name} / ${t.months} měs.: sleva není nižší než slibovaná`,
                termSavings(plan.monthlyHaleru, t.months) >= 0, "záporná úspora")
            prevPerMonth = perMonth
        }
    }
    // Konkrétní čísla z ceníku — kdyby se žebřík posunul, musí to spadnout tady,
    // ne až v tom, že zákazník zaplatí jinou částku, než jakou viděl.
    eq("Start / rok = 9 900 Kč", String(termPrice(99000, 12)), "990000")
    eq("Růst / rok = 19 900 Kč", String(termPrice(199000, 12)), "1990000")
    eq("Růst / 3 měsíce = 5 670 Kč", String(termPrice(199000, 3)), "567000")
    eq("Růst / 6 měsíců = 10 740 Kč", String(termPrice(199000, 6)), "1074000")
    eq("Impérium / rok = 79 900 Kč", String(termPrice(799000, 12)), "7990000")
    // Roční cena musí být PŘESNĚ desetinásobek měsíční — na tom stojí celý slib
    // „dva měsíce zdarma" a zákazník si to ověří z hlavy.
    for (const plan of FALLBACK_PLANS) {
        eq(`${plan.name}: rok = 10× měsíc`,
            String(termPrice(plan.monthlyHaleru, 12)), String(plan.monthlyHaleru * 10))
    }
    // Podvržené období z requestu nesmí koupit rok za měsíční cenu.
    eq("normalizeTermMonths(24) = 1", String(normalizeTermMonths(24)), "1")
    eq("normalizeTermMonths(\"12\") = 12", String(normalizeTermMonths("12")), "12")
    eq("normalizeTermMonths(undefined) = 1", String(normalizeTermMonths(undefined)), "1")
}

// ── drift regression: 12 late cycles must not move the anniversary ──
console.log("\nDunning drift over a year:")
{
    let periodEnd = D("2026-01-15T10:00:00.000Z")
    for (let cycle = 0; cycle < 12; cycle++) {
        // Every cycle the renewal lands 2 days late (worker retry + grace).
        const now = new Date(periodEnd.getTime() + 2 * DAY_MS)
        periodEnd = computeBillingPeriod({ now, termMonths: 1, previousPeriodEnd: periodEnd }).end
    }
    // Old behaviour (start = now) would land on 2027-02-09 — 24 days of paid
    // service silently taken back over one year.
    eq("12 late monthly renewals keep the 15th", iso(periodEnd), "2027-01-15T10:00:00.000Z")

    let yearEnd = D("2026-01-15T10:00:00.000Z")
    for (let cycle = 0; cycle < 3; cycle++) {
        const now = new Date(yearEnd.getTime() + 3 * DAY_MS)
        yearEnd = computeBillingPeriod({ now, termMonths: 12, previousPeriodEnd: yearEnd }).end
    }
    eq("3 late yearly renewals keep the anniversary", iso(yearEnd), "2029-01-15T10:00:00.000Z")
}

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
