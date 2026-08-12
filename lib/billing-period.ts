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
 *                               1, 3, 6 or 12 months, per subscriptions.term_months.
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
 * How many months one paid period lasts.
 *
 * Two inputs, one answer, on purpose. `subscriptions.term_months` is what the
 * customer bought (1/3/6/12 — see lib/pricing.ts). `subscription_plans.interval`
 * is the unit `price_czk` is quoted in, and every live plan quotes a MONTH.
 * Should a yearly-quoted plan ever be seeded, its price already covers a year,
 * so multiplying it by the term as well would hand out twelve years for one —
 * the interval therefore wins and the term is ignored.
 */
export function resolveTermMonths(
    planInterval: string | null | undefined,
    termMonths: number | null | undefined,
): number {
    if (normalizeInterval(planInterval) === "year") return 12
    const n = Number(termMonths)
    return n === 3 || n === 6 || n === 12 ? n : 1
}

/**
 * How many days before the renewal charge the customer gets a heads-up.
 *
 * Three days is fine for 990 Kč. Announcing a 19 900 Kč charge three days out is
 * an invitation to a chargeback — a yearly customer has long forgotten the sign-up
 * and needs time to cancel deliberately rather than by disputing the payment.
 */
export function renewalNoticeDays(termMonths: number): number {
    return termMonths > 1 ? 30 : EXPIRING_SOON_DAYS
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
    /** Length of the paid period in months — 1, 3, 6 or 12 (see resolveTermMonths). */
    termMonths: number
    /**
     * current_period_end of the subscription being renewed. ONLY a renewal of the
     * same live plan passes this — a first payment and a tier change both start at
     * `now` (no proration: the tier change forfeits the rest of the old period).
     *
     * A TERM change on the same plan passes it too, and that is deliberate: the
     * early-renewal branch below starts the new (longer) period where the paid one
     * ends, so switching from monthly to yearly mid-month adds the year on top
     * instead of burning the days already paid for.
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
    const { now } = input
    const termMonths = input.termMonths > 0 ? input.termMonths : 1
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

    let end = addMonths(start, termMonths)
    // Defensive: a chained period must still end in the future (only reachable if
    // chainGraceDays is configured longer than the term itself).
    if (end.getTime() <= now.getTime()) {
        start = now
        end = addMonths(start, termMonths)
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

// ─── Stav fakturace pro UI ──────────────────────────────────────────────────

/**
 * Jediný stav, ze kterého se odvozuje in-app banner. Politika patří na server:
 * klient jen renderuje, aby se pravidla o penězích nedublovala v Reactu.
 */
export type BillingState = "ok" | "expiring_soon" | "dunning" | "grace" | "cancelled" | "expired"

/** Do kolika dnů dopředu se hlásí „plán brzy končí". Shodné s oknem T-3 oznámení. */
export const EXPIRING_SOON_DAYS = 3

/**
 * Pořadí je záměrné a jde od nejzávažnějšího: co už se stalo, bije to, co teprve
 * hrozí. `dunning` předbíhá `grace`, protože „selhala vám karta" je akce, kdežto
 * „běžíte v odkladu" je jen důsledek téhož.
 */
export function deriveBillingState(
    input: {
        status: string
        cancelAtPeriodEnd?: boolean
        billingFailures?: number
        currentPeriodEnd?: string | null
        /** Delší období hlásí konec s měsíčním předstihem — viz renewalNoticeDays. */
        termMonths?: number
    },
    now: Date = new Date(),
): BillingState {
    if (input.status === "expired") return "expired"
    if ((input.billingFailures || 0) > 0) return "dunning"
    if (input.cancelAtPeriodEnd) return "cancelled"

    if (!input.currentPeriodEnd) return "ok"
    const end = new Date(input.currentPeriodEnd).getTime()
    if (Number.isNaN(end)) return "ok"

    const msLeft = end - now.getTime()
    if (msLeft <= 0) return "grace"
    if (msLeft <= renewalNoticeDays(input.termMonths ?? 1) * DAY_MS) return "expiring_soon"
    return "ok"
}
