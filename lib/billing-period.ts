/**
 * Billing period math — pure, DB-free, unit-testable.
 * ====================================================
 * Lives apart from lib/subscription.ts on purpose: no Supabase import, so the
 * date arithmetic can be asserted by `npx tsx scripts/test-billing-periods.ts`
 * without env vars or a database.
 *
 * A subscription carries TWO different periods. They are not the same thing and
 * must never be collapsed back into one:
 *
 *   current_period_start/end  = the PAID period. Drives renewal charging.
 *                               Monthly OR yearly, per subscription_plans.interval.
 *   credit_period_start/end   = the CREDIT window. ALWAYS monthly, even on a
 *                               yearly plan. Drives the credits_per_month reset.
 *                               (added in the credit-period migration)
 *
 * All math is UTC — timestamps are stored as timestamptz/ISO, and doing it in
 * local time would shift a period by an hour twice a year.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Dunning window: after current_period_end passes, the sub stays usable for this
 * many days while the billing worker retries the renewal charge (one attempt/day).
 * After the window (or MAX_BILLING_FAILURES attempts) it is persisted as expired.
 */
export const BILLING_GRACE_DAYS = 3
export const MAX_BILLING_FAILURES = 3

/**
 * How long after current_period_end a successful renewal still CHAINS off the old
 * period end instead of restarting at `now`. Deliberately equal to the dunning
 * window: inside it the customer kept full access, so those days are paid for and
 * the anniversary must not drift. Past it the sub was expired (no access) — a
 * comeback payment starts a fresh period at `now`.
 */
export const PERIOD_CHAIN_GRACE_DAYS = BILLING_GRACE_DAYS

export type BillingInterval = "month" | "year"

/** subscription_plans.interval is free-form text — normalize it, never trust it raw. */
export function normalizeInterval(raw: string | null | undefined): BillingInterval {
    const v = (raw || "").trim().toLowerCase()
    return v === "year" || v === "yearly" || v === "annual" || v === "annually" ? "year" : "month"
}

/**
 * Add calendar months, clamping to the end of the target month.
 * Jan 31 + 1 month = Feb 28 (not Mar 3, which is what Date.setMonth does and what
 * the old `periodEnd.setMonth(+1)` shipped — it silently gave away 3 days a year
 * to every customer who happened to pay on the 29th–31st).
 */
export function addMonths(from: Date, months: number): Date {
    const d = new Date(from.getTime())
    const day = d.getUTCDate()
    d.setUTCDate(1)
    d.setUTCMonth(d.getUTCMonth() + months)
    const daysInTarget = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
    d.setUTCDate(Math.min(day, daysInTarget))
    return d
}

/** One billing interval forward. A year = 12 clamped months (29 Feb → 28 Feb). */
export function addInterval(from: Date, interval: BillingInterval): Date {
    return addMonths(from, interval === "year" ? 12 : 1)
}

export interface BillingPeriodInput {
    now: Date
    interval: BillingInterval
    /**
     * current_period_end of the subscription being renewed. ONLY a renewal of the
     * same live plan passes this — a first payment and a tier change both start at
     * `now` (no proration: the tier change forfeits the rest of the old period).
     */
    previousPeriodEnd?: Date | null
    /** Override for tests; defaults to PERIOD_CHAIN_GRACE_DAYS. */
    chainGraceDays?: number
}

/**
 * Compute the next paid period.
 *
 * Renewals CHAIN (start = previous end), they don't reset to `now`. Resetting is
 * what made the anniversary walk forward 1–3 days every cycle: the worker charges
 * a day or more after the period lapsed, and the customer paid for a full month
 * but got a month minus the dunning delay, every single time.
 */
export function computeBillingPeriod(input: BillingPeriodInput): { start: Date; end: Date } {
    const { now, interval } = input
    const graceMs = (input.chainGraceDays ?? PERIOD_CHAIN_GRACE_DAYS) * DAY_MS
    const prev = input.previousPeriodEnd ?? null

    let start = now
    if (prev) {
        if (prev.getTime() > now.getTime()) {
            // Early renewal — the paid period hasn't run out yet. Never shorten it.
            start = prev
        } else if (now.getTime() - prev.getTime() <= graceMs) {
            // Renewal inside the dunning window → chain, so the days the retry took
            // are not deducted from the period the customer just paid for.
            start = prev
        }
        // Lapsed beyond the grace window: the sub was expired → fresh start at now.
    }

    let end = addInterval(start, interval)
    // Defensive: a chained period must still end in the future (only reachable if
    // chainGraceDays is configured longer than the interval itself).
    if (end.getTime() <= now.getTime()) {
        start = now
        end = addInterval(start, interval)
    }
    return { start, end }
}

// ─── Credit window ───────────────────────────────────────────

/**
 * Whole months elapsed between `anchor` and `now` (never negative).
 * Calendar months, not 30-day blocks: the anchor's day-of-month is the boundary.
 */
export function monthsElapsed(anchor: Date, now: Date): number {
    let n = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (now.getUTCMonth() - anchor.getUTCMonth())
    if (n < 0) return 0
    // Correct for the day-of-month (and the end-of-month clamp): the raw month
    // difference is off by one whenever `now` hasn't reached the anniversary day.
    while (n > 0 && addMonths(anchor, n).getTime() > now.getTime()) n--
    while (addMonths(anchor, n + 1).getTime() <= now.getTime()) n++
    return n
}

/**
 * The credit window containing `now`, anchored on the subscription's credit
 * anniversary. ALWAYS one month long — a yearly plan is paid once but resets
 * credits twelve times, so this is deliberately independent of BillingInterval.
 *
 * Anchored, not chained: every window is `anchor + n months … anchor + (n+1)
 * months`, so a 31st-of-the-month anchor gives Feb 28 and then Mar 31 again
 * instead of walking backwards a few days a year.
 *
 * Pure + idempotent: feeding a computed `start` back in as the anchor returns the
 * same window, which is what lets the reader derive it and the worker persist it
 * without the two disagreeing.
 */
export function computeCreditWindow(input: { now: Date; anchor: Date }): { start: Date; end: Date } {
    const { now, anchor } = input
    const n = monthsElapsed(anchor, now)
    return { start: addMonths(anchor, n), end: addMonths(anchor, n + 1) }
}
