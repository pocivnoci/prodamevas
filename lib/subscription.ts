/**
 * Subscription & Credit System v2
 * ================================
 * Monthly Plan + Credits for Extras model.
 * 
 * Plan posts (included in subscription) don't cost credits.
 * Extra posts (beyond plan) cost credits.
 * Trial = content-gated: 3 full posts + 27 locked.
 */

import { isSuperAdminEmail } from "@/lib/super-admins"
import supabaseAdmin from "@/supabase/admin"
import { createClient } from "@/supabase/server"
import { formatCzk } from "@/lib/pricing"

// ─── Admin bypass ────────────────────────────────────────────

async function isSuperAdmin(): Promise<boolean> {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user?.email) return false
        return isSuperAdminEmail(user.email)
    } catch {
        return false
    }
}

const ADMIN_BYPASS: CanPerformResult = {
    allowed: true,
    creditsRequired: 0,
    creditsRemaining: 999,
    isPlanPost: false,
}

// ─── Types ───────────────────────────────────────────────────

export type ActionType =
    | "post"
    | "post_edit"
    | "post_variant"
    | "idea_generate"
    | "product_ideas"
    | "product_visual"
    | "product_design"
    | "product_mockup"
    | "product_brief"
    | "product_line"

/** How many credits each action costs (for EXTRA posts, not plan posts) */
export const ACTION_CREDITS: Record<ActionType, number> = {
    post: 1,               // base = image; carousel/reel are weighted via creditsForMedia()
    post_edit: 1,          // targeted retouch = ONE image call — flat, never media-weighted
    post_variant: 1,       // base = image; weighted via creditsForMedia()
    idea_generate: 1,      // batch of ideas
    product_ideas: 2,      // 5 product ideas
    product_visual: 2,     // Imagen render
    product_design: 3,     // concept + render
    product_mockup: 2,     // photorealistic mockup
    product_brief: 5,      // full business analysis
    product_line: 8,       // whole line: Pro-ladder strategy + N SKUs + specs + repair round
}

/**
 * Media-weighted credit costs (COGS-aligned: 1 credit ≈ $0.30 of AI cost).
 * A reel costs ~4× an image to produce — flat 1-credit-per-post sold reels
 * below cost. Weighting the charge caps the worst case by construction.
 * Weights live in lib/credits.ts (client-safe) — re-exported here for the backend.
 */
export { MEDIA_CREDITS, creditsForMedia, ALL_MEDIA, isMediumType } from "@/lib/credits"
/** Priorita tarifu — čistá funkce v lib/pricing.ts, ať ji smí volat i klient. */
export { planPriority, PRIORITY } from "@/lib/pricing"
import { creditsForMedia as _creditsForMedia } from "@/lib/credits"

/** Weighted credit cost for an action: post/post_variant scale with medium, the rest are flat. */
export function creditsForAction(action: ActionType, medium?: string | null): number {
    if (action === "post" || action === "post_variant") return _creditsForMedia(medium)
    return ACTION_CREDITS[action]
}

/** Human-readable labels for actions */
export const ACTION_LABELS: Record<ActionType, string> = {
    post: "Příspěvek",
    post_edit: "Úprava příspěvku",
    post_variant: "Varianta příspěvku",
    idea_generate: "Generování nápadů",
    product_ideas: "Produktové nápady",
    product_visual: "Vizualizace produktu",
    product_design: "Design pro tisk",
    product_mockup: "Produktový mockup",
    product_brief: "Business Brief",
    product_line: "Produktová řada",
}

/** Derived from MEDIA_CREDITS — see lib/credits.ts. Re-exported so backend callers
 *  don't need a second import path; this is NOT a second definition. */
export type { MediumType } from "@/lib/credits"
import type { MediumType } from "@/lib/credits"

export interface PlanFeatures {
    credits_per_month: number
    max_projects: number
    extra_credit_price: number // haléře per credit
    allowed_actions: ActionType[]
    analytics: "basic" | "full"
    /**
     * Přednost ve frontě generování. **Číslo, ne boolean** — vyšší jde dřív.
     *   0 = Start/Růst · 10 = Dominance („prioritní generování") · 20 = Impérium
     *   („nejvyšší priorita ve frontě")
     *
     * Boolean tu byl do 8/2026 a měl dvě vady najednou: nikdo ho nečetl (fronta
     * jela FIFO, takže šlo o placený slib bez implementace) a i po implementaci by
     * Dominance s Impériem vyšly stejně, přestože Impérium inzeruje „nejvyšší".
     * Číslo řeší obojí — kopie obou tarifů je tím pádem pravdivá.
     *
     * Čte se přes `planPriority()`, ne přímo: v DB jsou i legacy tarify, kde je
     * pořád `true`/`false`.
     */
    priority: number | boolean
    label: string
    highlight: boolean
    // v2: plan post limits
    plan_posts_limit?: number  // how many plan posts are unlocked (3 for trial, 30 for paid)
    plan_posts_total?: number  // total plan posts generated (always 30)
    // v3 growth tiers
    allowed_media?: MediumType[]   // missing = all media allowed (legacy plans)
    growth_tracking?: boolean      // weekly follower snapshots + growth dashboard
    /**
     * Lidská část služby: obsah pravidelně prochází marketingový specialista a
     * dotazy se vyřizují přednostně. Dnes jen Impérium.
     *
     * Je to POLE, ne odrážka v kopii, ze stejného důvodu jako `priority`:
     * Impérium už dvakrát prodávalo slib, který nikde neexistoval
     * (`max_projects`, boolean `priority`). Chybějící klíč = `false`.
     * Plnění je lidské, takže ho kód nevynutí — ale nikdo ho nemůže slíbit
     * omylem na tarifu, kde neplatí (aserce 13.16 a 13.17).
     */
    human_support?: boolean
}

/**
 * Cena extra kreditu tak, jak ji vidí zákazník.
 *
 * Čte se z tarifu, ne z konstanty ve větě: „49 Kč" bylo natvrdo na dvou místech
 * tady a jinou hodnotu (15 Kč) slibovalo paywall modální okno. Cena kreditu je
 * v `features.extra_credit_price`, takže ji smí říkat jenom ta.
 */
export function extraCreditPriceLabel(features: PlanFeatures | null | undefined): string {
    return formatCzk(features?.extra_credit_price ?? 4900)
}

/** Media gating: plans without allowed_media (trial_v2, legacy chrlit) allow everything. */
export function canUseMedium(features: PlanFeatures | null | undefined, medium: MediumType): boolean {
    if (!features?.allowed_media) return true
    return features.allowed_media.includes(medium)
}

export interface SubscriptionInfo {
    planId: string
    planName: string
    status: "active" | "trialing" | "cancelled" | "expired" | "pending"
    features: PlanFeatures
    creditsUsed: number
    /** Měsíční příděl tarifu + dokoupené kredity v tomhle okně. */
    creditsTotal: number
    creditsRemaining: number
    /** Kolik kreditů si klient v tomhle okně dokoupil (0 = žádné). */
    creditsPurchased: number
    trialEndsAt: string | null
    /** End of the PAID period (month or year) — when the renewal is charged. */
    currentPeriodEnd: string | null
    /** End of the CREDIT window (always monthly) — when credits reset. */
    creditPeriodEnd: string | null
    // v2: plan tracking
    planPostsUnlocked: number
    planGeneratedAt: string | null
    isTrial: boolean
    /**
     * Zákazník vypověděl — běží do `currentPeriodEnd` a pak skončí. Status
     * zůstává `active`, protože zaplacené období se odebrat nesmí.
     */
    cancelAtPeriodEnd: boolean
    /** Kolikátý pokus dunningu (0 = v pořádku). Živí in-app banner. */
    billingFailures: number
    /** Délka zaplaceného období v měsících (1/3/6/12) — viz lib/pricing.ts. */
    termMonths: number
    /** Brána, která předplatné pohání. Stripe si obnovu účtuje sám. */
    provider: "comgate" | "stripe"
}

export interface CanPerformResult {
    allowed: boolean
    reason?: string
    creditsRequired: number
    creditsRemaining: number
    featureBlocked?: boolean
    planRequired?: string
    /** True if this action is a plan post (no credit cost) */
    isPlanPost?: boolean
}

// ─── Main API ────────────────────────────────────────────────

/**
 * Get the active subscription + usage for a client.
 * Returns null if no subscription exists.
 */
/**
 * Dunning window + period math live in lib/billing-period.ts (pure, DB-free so
 * scripts/test-billing-periods.ts can assert them). Re-exported here because
 * every existing call site imports them from "@/lib/subscription".
 */
export {
    BILLING_GRACE_DAYS,
    MAX_BILLING_FAILURES,
    PERIOD_CHAIN_GRACE_DAYS,
    computeBillingPeriod,
    computeCreditWindow,
    normalizeInterval,
    resolveTermMonths,
    renewalNoticeDays,
    addInterval,
    addMonths,
    deriveBillingState,
    EXPIRING_SOON_DAYS,
    type BillingInterval,
    type BillingState,
} from "@/lib/billing-period"
import {
    BILLING_GRACE_DAYS,
    addMonths,
    computeBillingPeriod,
    computeCreditWindow,
    resolveTermMonths,
} from "@/lib/billing-period"

/** active beats trialing beats pending — a freshly initiated (unpaid) upgrade
 *  must never mask the customer's live plan. Expired comes last: only shown
 *  when nothing live exists (drives the "Obnovit plán" UI). */
function pickLiveSubscription<T extends { status: string }>(rows: T[] | null): T | null {
    if (!rows || rows.length === 0) return null
    const priority: Record<string, number> = { active: 0, trialing: 1, pending: 2, expired: 3 }
    return [...rows].sort((a, b) => (priority[a.status] ?? 9) - (priority[b.status] ?? 9))[0]
}

export async function getClientSubscription(clientId: string): Promise<SubscriptionInfo | null> {
    // 1. Get active/trialing subscription (with v2 columns, fallback to legacy)
    let sub: any = null
    const { data: subsV2, error: v2Error } = await supabaseAdmin
        .from("subscriptions")
        .select("id, plan_id, status, trial_ends_at, current_period_start, current_period_end, credit_period_start, credit_period_end, created_at, plan_generated_at, plan_posts_unlocked, cancel_at_period_end, billing_failures, term_months, provider")
        .eq("client_id", clientId)
        .in("status", ["active", "trialing", "pending", "expired"])
        .order("created_at", { ascending: false })
        .limit(5)

    if (subsV2 && !v2Error) {
        sub = pickLiveSubscription(subsV2)
    } else {
        // Fallback: v2 columns don't exist yet (migration not run)
        const { data: subsLegacy } = await supabaseAdmin
            .from("subscriptions")
            .select("id, plan_id, status, trial_ends_at, current_period_start, current_period_end, created_at")
            .eq("client_id", clientId)
            .in("status", ["active", "trialing", "pending", "expired"])
            .order("created_at", { ascending: false })
            .limit(5)
        const subLegacy = pickLiveSubscription(subsLegacy)
        sub = subLegacy ? { ...subLegacy, plan_generated_at: null, plan_posts_unlocked: 0 } : null
    }

    if (!sub) return null

    // 2. Get plan details
    const { data: plan } = await supabaseAdmin
        .from("subscription_plans")
        .select("id, name, features, interval")
        .eq("id", sub.plan_id)
        .single()

    if (!plan) return null

    const features = plan.features as PlanFeatures
    const termMonths = resolveTermMonths(plan.interval, sub.term_months)

    // 3. Check if old-style trial is still active (legacy)
    let status = sub.status as SubscriptionInfo["status"]
    if (status === "trialing" && sub.trial_ends_at) {
        const trialEnd = new Date(sub.trial_ends_at)
        if (trialEnd < new Date()) {
            await supabaseAdmin
                .from("subscriptions")
                .update({ status: "expired", updated_at: new Date().toISOString() })
                .eq("id", sub.id)
            status = "expired"
        }
    }

    // 4. Check if paid period ended. Within the grace window the sub stays active
    // (the billing worker is retrying the renewal charge — dunning). Past it, the
    // expiry is PERSISTED, not just computed at read time: state must be real for
    // the renewal UI and the billing worker alike.
    if (status === "active" && sub.current_period_end) {
        const periodEnd = new Date(sub.current_period_end)
        const graceEnd = new Date(periodEnd.getTime() + BILLING_GRACE_DAYS * 24 * 60 * 60 * 1000)
        if (graceEnd < new Date()) {
            await supabaseAdmin
                .from("subscriptions")
                .update({ status: "expired", updated_at: new Date().toISOString() })
                .eq("id", sub.id)
                .eq("status", "active")
            status = "expired"
        }
    }

    // 5. Credits used in the CURRENT CREDIT WINDOW (never the calendar month).
    // The window is derived from the stored anchor rather than read verbatim, so a
    // late cron tick can't show a customer a stale (already-spent) window — the
    // billing worker persists the same value on its next run.
    const creditWindow = resolveCreditWindow(sub)
    const { used: creditsUsed, purchased: creditsPurchased } = await getCreditLedger(clientId, creditWindow)
    // Dokoupené kredity se PŘIČÍTAJÍ k přídělu, neodečítají od spotřeby — jinak
    // by se přebytek nad měsíční příděl ztratil na ořezu v getCreditLedger.
    const creditsTotal = features.credits_per_month + creditsPurchased
    const creditsRemaining = Math.max(0, creditsTotal - creditsUsed)

    const isTrial = sub.plan_id === "trial_v2"

    return {
        planId: plan.id,
        planName: plan.name,
        status,
        features,
        creditsUsed,
        creditsTotal,
        creditsRemaining,
        trialEndsAt: sub.trial_ends_at,
        currentPeriodEnd: sub.current_period_end,
        creditPeriodEnd: creditWindow.end.toISOString(),
        planPostsUnlocked: sub.plan_posts_unlocked || 0,
        planGeneratedAt: sub.plan_generated_at,
        isTrial,
        cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
        billingFailures: sub.billing_failures || 0,
        creditsPurchased,
        termMonths,
        provider: sub.provider === "stripe" ? "stripe" : "comgate",
    }
}

/** A row shaped enough to derive its credit window from. */
type CreditWindowSource = {
    credit_period_start?: string | null
    credit_period_end?: string | null
    current_period_start?: string | null
    created_at?: string | null
}

/**
 * The credit window a subscription row is currently in.
 *
 * Anchored on `current_period_start` — the paid period's start is the STABLE cycle
 * anchor. Anchoring on `credit_period_start` (the window we last persisted) would
 * re-anchor on a clamped date and walk a month-end subscriber backwards: a yearly
 * plan paid on Jan 31 would go Feb 28 → Mar 28 → Apr 28 and never return to the
 * 31st. From a fixed anchor it correctly reads Feb 28 → Mar 31 → Apr 30.
 * `credit_period_start` is only the fallback for rows with no paid period.
 *
 * Always rolled forward to the window containing `now`, which makes this
 * self-healing: a legacy row (pre-migration), a row the worker hasn't touched yet,
 * and a freshly written one all resolve identically.
 */
function resolveCreditWindow(row: CreditWindowSource, now: Date = new Date()): { start: Date; end: Date } {
    const anchorRaw = row.current_period_start || row.credit_period_start || row.created_at
    const anchor = anchorRaw ? new Date(anchorRaw) : now
    if (isNaN(anchor.getTime())) return computeCreditWindow({ now, anchor: now })
    return computeCreditWindow({ now, anchor })
}

/**
 * Count credits used by a client in the current CREDIT PERIOD.
 *
 * NOT the calendar month: billing runs from the payment date, so a customer who
 * paid on the 25th used to get a full fresh allowance on the 1st — six days later.
 * On a yearly plan that meant one payment and twelve calendar resets.
 *
 * Sums deductions (positive) AND refunds (negative) so a refunded failed
 * generation frees the credit again. Unused credits do NOT carry over: the window
 * simply moves and whatever was left is gone.
 */
export async function getCreditsUsedThisPeriod(
    clientId: string,
    /** Pass the window when the caller already has the subscription row (saves a query). */
    window?: { start: Date; end: Date },
): Promise<number> {
    return (await getCreditLedger(clientId, window)).used
}

/**
 * Kreditové okno klienta — stejná cesta, jakou si ho dopočítává `getCreditLedger`.
 *
 * Vytažené zvlášť, aby rezervace i kniha četly TÝŽ interval. Kdyby se rozešly,
 * kontrola zůstatku by se dělala nad jiným obdobím, než ve kterém se účtuje.
 */
export async function resolveClientCreditWindow(clientId: string): Promise<{ start: Date; end: Date }> {
    const { data: row } = await supabaseAdmin
        .from("subscriptions")
        .select("credit_period_start, credit_period_end, current_period_start, created_at")
        .eq("client_id", clientId)
        .in("status", ["active", "trialing", "pending", "expired"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    return resolveCreditWindow(row || {})
}

/** Akce, pod kterou se do knihy zapisuje DOBITÍ (záporný řádek). */
export const TOPUP_ACTION = "credit_topup"

/**
 * Spotřeba a dobití za aktuální kreditové okno — **oddělně**.
 *
 * Oddělit je nutné kvůli tomu ořezání na nule výš. Kdyby se dobití počítalo
 * jako záporná spotřeba, součet by se u nevyčerpaného přídělu ořízl na nulu
 * a **koupené kredity nad měsíční příděl by tiše zmizely** — zákazník zaplatí
 * za 50 kreditů a dostane jen doplnění do svého tarifu. Ořez přitom musí
 * zůstat: brání tomu, aby refundace vyrobila zápornou spotřebu.
 *
 * Dobité kredity platí do konce kreditového období (obchodní podmínky, čl. 7),
 * takže stejné okno platí pro obojí a nic se nepřenáší.
 */
export async function getCreditLedger(
    clientId: string,
    window?: { start: Date; end: Date },
): Promise<{ used: number; purchased: number }> {
    let period = window
    if (!period) {
        const { data: row } = await supabaseAdmin
            .from("subscriptions")
            .select("credit_period_start, credit_period_end, current_period_start, created_at")
            .eq("client_id", clientId)
            .in("status", ["active", "trialing", "pending", "expired"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        period = resolveCreditWindow(row || {})
    }

    const { data } = await supabaseAdmin
        .from("credit_transactions")
        .select("credits, action")
        .eq("client_id", clientId)
        .gte("created_at", period.start.toISOString())
        .lt("created_at", period.end.toISOString())

    if (!data || data.length === 0) return { used: 0, purchased: 0 }

    let used = 0
    let purchased = 0
    for (const row of data) {
        if (row.action === TOPUP_ACTION) purchased += -row.credits // zápisuje se záporně
        else used += row.credits
    }
    return { used: Math.max(0, used), purchased: Math.max(0, purchased) }
}

/**
 * Persist the credit window of every ACTIVE subscription whose window has lapsed
 * (or was never set). Called by the billing worker on every run — independent of
 * whether a renewal is due, because on a yearly plan this is the ONLY thing that
 * resets credits.
 *
 * Readers derive the window anyway (resolveCreditWindow), so this doesn't change
 * what a customer sees — it keeps the stored state true, the same reason the
 * dunning expiry is persisted instead of computed at read time.
 */
export async function rollLapsedCreditWindows(limit = 200): Promise<number> {
    const now = new Date()
    const { data, error } = await supabaseAdmin
        .from("subscriptions")
        .select("id, credit_period_start, credit_period_end, current_period_start, created_at")
        .eq("status", "active")
        // `.lt` alone drops NULL rows — exactly the legacy/never-set case we must fix.
        .or(`credit_period_end.is.null,credit_period_end.lt.${now.toISOString()}`)
        .limit(limit)

    if (error) throw new Error(`rollLapsedCreditWindows: ${error.message}`)

    let rolled = 0
    for (const row of data || []) {
        const { start, end } = resolveCreditWindow(row, now)
        if (row.credit_period_start === start.toISOString() && row.credit_period_end === end.toISOString()) continue

        // Conditional claim on the window we read: an activation racing this write
        // (payment callback mid-run) must win, not be silently rolled back.
        let q = supabaseAdmin
            .from("subscriptions")
            .update({
                credit_period_start: start.toISOString(),
                credit_period_end: end.toISOString(),
                updated_at: now.toISOString(),
            })
            .eq("id", row.id)
        q = row.credit_period_end
            ? q.eq("credit_period_end", row.credit_period_end)
            : q.is("credit_period_end", null)

        const { data: updated } = await q.select("id").maybeSingle()
        if (updated) rolled++
    }
    return rolled
}

/**
 * Check if a client can perform a specific action.
 * For "post" actions: checks if it's a plan post (free) or extra post (costs credits).
 */
// ════════════════════════════════════════════════════════════════════════════
// Strop tempa — pojistka nezávislá na kreditech
// ════════════════════════════════════════════════════════════════════════════
//
// Kontrola kreditů je `check-then-act`: `canPerformAction` zůstatek jen PŘEČTE
// a `deductCredits` zapisuje až po dokončení AI operace. Mezi tím není zámek,
// takže N souběžných požadavků přečte týž zůstatek a všechny projdou. Zákazník
// s jedním kreditem tak umí spustit padesát paralelních generování.
//
// Skutečná oprava je atomická rezervace na straně databáze (jeden příkaz, který
// pod zámkem ověří zůstatek a rovnou zapíše odpočet) — ta potřebuje migraci
// s Postgres funkcí, viz `docs/audit-stav-projektu.md`.
//
// Do té doby tohle: strop na POČET zpoplatněných akcí za okno, počítaný z už
// existující knihy `credit_transactions`. Závod tím nezmizí — dva požadavky ve
// stejné milisekundě napočítají totéž — ale trvalé pálení kreditů skriptem
// zastaví po prvním okně, a to je rozdíl mezi „účet za tisíce" a „účet za pár
// korun". Je to strop TEMPA, ne náhrada účtování.
const BURST_WINDOW_MS = 60_000
/** Kolik zpoplatněných akcí smí klient spustit za minutu. */
const MAX_ACTIONS_PER_MINUTE = Number(process.env.CREDIT_BURST_PER_MINUTE) || 12
/** Denní strop jako druhá pojistka — chrání i před pomalým, vytrvalým skriptem. */
const MAX_ACTIONS_PER_DAY = Number(process.env.CREDIT_ACTIONS_PER_DAY) || 400

/**
 * Kolik zpoplatněných akcí klient provedl od `since`.
 *
 * Dobití (`TOPUP_ACTION`) se nepočítá — je to přírůstek, ne spotřeba, a zákazník,
 * který si právě koupil kredity, nesmí být za nákup potrestaný zpomalením.
 */
async function chargedActionsSince(clientId: string, since: Date): Promise<number> {
    const { count } = await supabaseAdmin
        .from("credit_transactions")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId)
        .neq("action", TOPUP_ACTION)
        .gt("credits", 0)
        .gte("created_at", since.toISOString())
    return count || 0
}

/** `null` = smí pokračovat; jinak důvod k zablokování. */
async function rateLimitReason(clientId: string): Promise<string | null> {
    const now = Date.now()
    const [burst, daily] = await Promise.all([
        chargedActionsSince(clientId, new Date(now - BURST_WINDOW_MS)),
        chargedActionsSince(clientId, new Date(now - 24 * 60 * 60 * 1000)),
    ])
    if (burst >= MAX_ACTIONS_PER_MINUTE) {
        return `Příliš mnoho požadavků za sebou (${burst}/min). Počkejte chvíli a zkuste to znovu.`
    }
    if (daily >= MAX_ACTIONS_PER_DAY) {
        return `Vyčerpán denní limit generování (${MAX_ACTIONS_PER_DAY}/den). Ozvěte se nám, pokud potřebujete víc.`
    }
    return null
}

export async function canPerformAction(
    clientId: string,
    action: ActionType,
    /** If true, this is an extra post (not part of monthly plan) — always costs credits */
    isExtraPost?: boolean,
    /** Post medium (image/carousel/reel) — weights the credit cost for post actions */
    medium?: string | null,
): Promise<CanPerformResult> {
    // Super admin bypasses all checks
    if (await isSuperAdmin()) return ADMIN_BYPASS

    const creditsRequired = creditsForAction(action, medium)

    // Strop tempa se kontroluje PŘED předplatným: je to ochrana našeho účtu
    // u AI providera, ne součást produktu, a platí i pro klienta s kredity.
    // Selhání téhle kontroly nesmí zablokovat prodej ani práci — při chybě
    // dotazu se pokračuje dál a rozhoduje účtování jako dřív.
    try {
        const limited = await rateLimitReason(clientId)
        if (limited) {
            const sub = await getClientSubscription(clientId)
            return {
                allowed: false,
                reason: limited,
                creditsRequired,
                creditsRemaining: sub?.creditsRemaining ?? 0,
            }
        }
    } catch (err: any) {
        console.warn(`canPerformAction: kontrola tempa selhala (pokračuji): ${err?.message}`)
    }

    const sub = await getClientSubscription(clientId)

    // No subscription at all
    if (!sub) {
        return {
            allowed: false,
            reason: "Nemáte aktivní předplatné. Vyberte si plán pro pokračování.",
            creditsRequired,
            creditsRemaining: 0,
        }
    }

    // Subscription expired
    if (sub.status === "expired") {
        return {
            allowed: false,
            reason: sub.trialEndsAt
                ? "Váš trial vypršel. Vyberte si plán pro pokračování."
                : "Vaše předplatné vypršelo. Obnovte ho pro pokračování.",
            creditsRequired,
            creditsRemaining: 0,
        }
    }

    // Feature gating — action not allowed on this plan
    if (!sub.features.allowed_actions.includes(action)) {
        const planSuggestion = getPlanForAction(action)
        return {
            allowed: false,
            reason: `Funkce "${ACTION_LABELS[action]}" vyžaduje předplatné Chrlit.`,
            creditsRequired,
            creditsRemaining: sub.creditsRemaining,
            featureBlocked: true,
            planRequired: planSuggestion,
        }
    }

    // Plan post check: if action is "post" and not explicitly extra, check plan capacity
    if (action === "post" && !isExtraPost) {
        const planLimit = sub.features.plan_posts_limit || 0
        if (sub.planPostsUnlocked < planLimit) {
            // Plan post — no credit cost
            return {
                allowed: true,
                creditsRequired: 0,
                creditsRemaining: sub.creditsRemaining,
                isPlanPost: true,
            }
        }
    }

    // Extra post / non-post action — costs credits
    if (sub.creditsRemaining < creditsRequired) {
        return {
            allowed: false,
            reason: `Nedostatek kreditů. Potřebujete ${creditsRequired}, zbývá ${sub.creditsRemaining}. Dobijte si kredity za ${extraCreditPriceLabel(sub.features)}/ks.`,
            creditsRequired,
            creditsRemaining: sub.creditsRemaining,
        }
    }

    return {
        allowed: true,
        creditsRequired,
        creditsRemaining: sub.creditsRemaining,
        isPlanPost: false,
    }
}

/**
 * Deduct credits for a performed action (extra posts only).
 * Call this AFTER the AI operation succeeds.
 */
export async function deductCredits(
    clientId: string,
    action: ActionType,
    description?: string,
    referenceId?: string,
    /** Explicit credit amount (media-weighted) — defaults to the flat action cost */
    credits?: number,
): Promise<void> {
    if (credits === undefined) credits = ACTION_CREDITS[action]

    await supabaseAdmin.from("credit_transactions").insert({
        client_id: clientId,
        action,
        credits,
        description: description || ACTION_LABELS[action],
        reference_id: referenceId,
    })
}

// ════════════════════════════════════════════════════════════════════════════
// Atomická rezervace — kontrola a odpočet jako JEDNA operace
// ════════════════════════════════════════════════════════════════════════════

export interface CreditReservation {
    reserved: boolean
    /** Zůstatek po rezervaci; -1 znamená „nepočítáno" (idempotentní zásah). */
    remaining: number
    /** Řádek k případnému vrácení. `null` = nic se nevložilo, není co vracet. */
    reservationId: string | null
    /** false = běželo se náhradní cestou bez zámku (migrace ještě nedoběhla). */
    atomic: boolean
}

/** Hlásí se jednou za běh procesu, ne u každého volání. */
let warnedMissingRpc = false

/**
 * Zarezervuje kredity PŘED prací — kontrola zůstatku a zápis odpočtu proběhnou
 * pod zámkem na klienta jako jedna operace (`reserve_credits`, migrace
 * `20260902_atomicka_rezervace_kreditu.sql`).
 *
 * Tím padá závod, kvůli kterému souběžné požadavky přečetly týž zůstatek
 * a prošly všechny. Cena za to je, že se kredity strhávají dopředu — proto
 * `releaseCredits()` a automatické vrácení v `creditGuard`, když práce selže.
 *
 * **Degraduje bezpečně.** Když funkce v databázi ještě není (kód se nasazuje
 * dřív než migrace), spadne to na dnešní chování: přečti a zapiš. To je pořád
 * lepší než tvrdá chyba, ale závod v té chvíli trvá — proto se to hlásí do logu
 * a `atomic: false` propaguje ven, aby to šlo změřit.
 */
export async function reserveCredits(input: {
    clientId: string
    action: ActionType
    credits: number
    /** Měsíční příděl z tarifu — počítá aplikace, ne SQL (viz komentář v migraci). */
    monthly: number
    /** Nepovinné — bez něj se okno dopočítá stejně jako v `getCreditLedger`. */
    window?: { start: Date; end: Date }
    description?: string
    referenceId?: string | null
}): Promise<CreditReservation> {
    const window = input.window ?? (await resolveClientCreditWindow(input.clientId))
    const { data, error } = await supabaseAdmin.rpc("reserve_credits", {
        p_client_id: input.clientId,
        p_action: input.action,
        p_credits: input.credits,
        p_monthly: input.monthly,
        p_window_start: window.start.toISOString(),
        p_window_end: window.end.toISOString(),
        p_description: input.description ?? ACTION_LABELS[input.action],
        p_reference_id: input.referenceId ?? null,
    })

    if (!error) {
        const row = Array.isArray(data) ? data[0] : data
        return {
            reserved: Boolean(row?.reserved),
            remaining: Number(row?.remaining ?? 0),
            reservationId: row?.reservation_id ?? null,
            atomic: true,
        }
    }

    // 42883 = funkce neexistuje, PGRST202 = PostgREST ji nenašel ve schématu.
    const missing = error.code === "42883" || error.code === "PGRST202"
    if (!missing) {
        console.error(`🚨 reserve_credits selhalo (${error.code}): ${error.message}`)
        return { reserved: false, remaining: 0, reservationId: null, atomic: true }
    }

    if (!warnedMissingRpc) {
        warnedMissingRpc = true
        console.warn(
            "⚠️ Funkce reserve_credits v databázi není — kredity se účtují bez zámku a souběžné " +
            "požadavky můžou přečíst týž zůstatek. Spusť migraci 20260902_atomicka_rezervace_kreditu.sql.",
        )
    }

    // Náhradní cesta: přečti a zapiš. Odpočet jde pořád DOPŘEDU, takže se aspoň
    // nečeká na dokončení práce; chybí jen serializace mezi souběžnými běhy.
    const { used, purchased } = await getCreditLedger(input.clientId, window)
    const remaining = Math.max(0, input.monthly + purchased - used)
    if (remaining < input.credits) {
        return { reserved: false, remaining, reservationId: null, atomic: false }
    }
    const { data: inserted } = await supabaseAdmin
        .from("credit_transactions")
        .insert({
            client_id: input.clientId,
            action: input.action,
            credits: input.credits,
            description: input.description || ACTION_LABELS[input.action],
            reference_id: input.referenceId ?? null,
        })
        .select("id")
        .maybeSingle()

    return {
        reserved: true,
        remaining: remaining - input.credits,
        reservationId: inserted?.id ?? null,
        atomic: false,
    }
}

/**
 * Vrátí nevyčerpanou rezervaci — řádek se SMAŽE, ne kompenzuje protizápisem.
 *
 * Nevyčerpaná rezervace není obchodní událost: zákazník nic nedostal a nic
 * nezaplatil. Dva řádky (odpočet + vrácení) by z každé selhané generace udělaly
 * záznam v knize, který nic neznamená a jen ztěžuje čtení. U skutečné refundace
 * po DODANÉ práci to platí naopak — tam je protizápis správně (`refundJobCharge`).
 */
export async function releaseCredits(reservationId: string | null): Promise<void> {
    if (!reservationId) return
    const { error } = await supabaseAdmin.from("credit_transactions").delete().eq("id", reservationId)
    if (error) console.warn(`releaseCredits: rezervaci ${reservationId} se nepodařilo vrátit: ${error.message}`)
}

/**
 * Sníží rezervaci na skutečně spotřebovanou částku — pro dávky, kde se dopředu
 * rezervuje celý běh a teprve po něm se ví, kolik položek prošlo.
 *
 * Jen SNIŽUJE. Kdyby dávka doručila víc, než na kolik má klient kredity,
 * dodatečné zvýšení by obešlo kontrolu zůstatku — a to je přesně ta díra,
 * kterou rezervace zavírá. Nula znamená „nic neprošlo" → rezervace se maže.
 */
export async function shrinkReservation(reservationId: string | null, credits: number): Promise<void> {
    if (!reservationId) return
    if (credits <= 0) return releaseCredits(reservationId)
    const { error } = await supabaseAdmin
        .from("credit_transactions")
        .update({ credits })
        .eq("id", reservationId)
        .gte("credits", credits) // pojistka proti zvýšení
    if (error) console.warn(`shrinkReservation: ${error.message}`)
}

/**
 * Dopíše k rezervaci popis a odkaz na výsledek práce.
 *
 * Odkaz (`referenceId`) je typicky id řádku, který při rezervaci ještě
 * neexistoval — proto se doplňuje až tady. Kolize na `ux_credit_transactions_action_ref`
 * znamená, že za tutéž práci se už jednou účtovalo: pak se rezervace **smaže**,
 * což je přesně to, co dřív dělal idempotentní insert (druhý pokus nic nestrhl).
 */
export async function settleReservation(
    reservationId: string | null,
    description: string,
    referenceId?: string | null,
): Promise<void> {
    if (!reservationId) return
    const patch: Record<string, unknown> = { description }
    if (referenceId) patch.reference_id = referenceId

    const { error } = await supabaseAdmin.from("credit_transactions").update(patch).eq("id", reservationId)
    if (error?.code === "23505") {
        await releaseCredits(reservationId)
        return
    }
    if (error) console.warn(`settleReservation: ${error.message}`)
}

/**
 * Increment plan_posts_unlocked counter for a plan post.
 * Call this AFTER a plan post is generated successfully.
 */
export async function incrementPlanPostCount(clientId: string): Promise<void> {
    // Get current subscription
    const { data: sub } = await supabaseAdmin
        .from("subscriptions")
        .select("id, plan_posts_unlocked")
        .eq("client_id", clientId)
        .in("status", ["active", "trialing"])
        .order("created_at", { ascending: false })
        .limit(1)
        .single()

    if (!sub) return

    await supabaseAdmin
        .from("subscriptions")
        .update({
            plan_posts_unlocked: (sub.plan_posts_unlocked || 0) + 1,
            updated_at: new Date().toISOString(),
        })
        .eq("id", sub.id)
}

/**
 * Decrement plan_posts_unlocked counter — inverse of incrementPlanPostCount.
 * Used to refund a plan post when its generation job fails after the charge.
 */
export async function decrementPlanPostCount(clientId: string): Promise<void> {
    const { data: sub } = await supabaseAdmin
        .from("subscriptions")
        .select("id, plan_posts_unlocked")
        .eq("client_id", clientId)
        .in("status", ["active", "trialing"])
        .order("created_at", { ascending: false })
        .limit(1)
        .single()

    if (!sub) return

    await supabaseAdmin
        .from("subscriptions")
        .update({
            plan_posts_unlocked: Math.max(0, (sub.plan_posts_unlocked || 0) - 1),
            updated_at: new Date().toISOString(),
        })
        .eq("id", sub.id)
}

/**
 * Refund the charge made at job creation when the job fails or times out.
 * Idempotent: credit refunds are blocked from duplication by the unique
 * index on credit_transactions(action, reference_id).
 */
export async function refundJobCharge(
    clientId: string,
    jobId: string,
    charged: "plan" | "credits" | "none" | undefined,
    /** Exact credits charged at job creation (media-weighted). Legacy jobs without it refund the flat post cost. */
    chargedCredits?: number,
): Promise<void> {
    if (charged === "plan") {
        await decrementPlanPostCount(clientId)
    } else if (charged === "credits") {
        await supabaseAdmin.from("credit_transactions").insert({
            client_id: clientId,
            action: "post_refund",
            credits: -(chargedCredits ?? ACTION_CREDITS.post),
            description: "Refund: generování selhalo",
            reference_id: jobId,
        })
    }
}

/**
 * Refund the price difference when a post was charged for an expensive medium
 * but the engine delivered a cheaper one (e.g. requested reel clamped to carousel
 * by the plan/kill-switch). Never charges extra — only refunds downward.
 * Idempotent via the unique index on credit_transactions(action, reference_id).
 */
export async function reconcileJobCharge(
    clientId: string,
    jobId: string,
    charged: "plan" | "credits" | "none" | undefined,
    chargedCredits: number | undefined,
    actualMedium: string | undefined,
): Promise<void> {
    if (charged !== "credits" || !chargedCredits || !actualMedium) return
    const actualCredits = _creditsForMedia(actualMedium)
    const delta = chargedCredits - actualCredits
    if (delta <= 0) return
    await supabaseAdmin.from("credit_transactions").insert({
        client_id: clientId,
        action: "post_adjust",
        credits: -delta,
        description: `Dorovnání: účtováno ${chargedCredits}, vygenerováno ${actualMedium} (${actualCredits})`,
        reference_id: jobId,
    })
}

/**
 * Check if a client can perform a batch of actions (e.g. 7 posts at once).
 * Validates total credits needed upfront to avoid partial failures.
 */
export async function canPerformBatchAction(
    clientId: string,
    action: ActionType,
    count: number,
    /** Media-weighted total for the batch (Σ creditsForMedia per item) — overrides the flat count × cost */
    totalCredits?: number,
): Promise<CanPerformResult> {
    // Super admin bypasses all checks
    if (await isSuperAdmin()) return ADMIN_BYPASS

    const creditsRequired = totalCredits ?? ACTION_CREDITS[action] * count
    const sub = await getClientSubscription(clientId)

    if (!sub) {
        return {
            allowed: false,
            reason: "Nemáte aktivní předplatné. Vyberte si plán pro pokračování.",
            creditsRequired,
            creditsRemaining: 0,
        }
    }

    if (sub.status === "expired") {
        return {
            allowed: false,
            reason: sub.trialEndsAt
                ? "Váš trial vypršel. Vyberte si plán pro pokračování."
                : "Vaše předplatné vypršelo. Obnovte ho pro pokračování.",
            creditsRequired,
            creditsRemaining: 0,
        }
    }

    if (!sub.features.allowed_actions.includes(action)) {
        const planSuggestion = getPlanForAction(action)
        return {
            allowed: false,
            reason: `Funkce "${ACTION_LABELS[action]}" vyžaduje předplatné Chrlit.`,
            creditsRequired,
            creditsRemaining: sub.creditsRemaining,
            featureBlocked: true,
            planRequired: planSuggestion,
        }
    }

    if (sub.creditsRemaining < creditsRequired) {
        return {
            allowed: false,
            reason: `Nedostatek kreditů pro ${count}× ${ACTION_LABELS[action]}. Potřebujete ${creditsRequired}, zbývá ${sub.creditsRemaining}. Dobijte si kredity za ${extraCreditPriceLabel(sub.features)}/ks.`,
            creditsRequired,
            creditsRemaining: sub.creditsRemaining,
        }
    }

    return {
        allowed: true,
        creditsRequired,
        creditsRemaining: sub.creditsRemaining,
    }
}

/**
 * Create a content-gated trial subscription (v2).
 * No expiration — trial is limited by content gating, not time.
 * User sees 3 full posts + 27 locked posts.
 */
export async function createTrialSubscription(clientId: string): Promise<void> {
    const now = new Date()
    await supabaseAdmin.from("subscriptions").insert({
        client_id: clientId,
        plan_id: "trial_v2",
        status: "trialing",
        current_period_start: now.toISOString(),
        // No trial_ends_at — content-gated, not time-gated
        // No current_period_end — unlimited until they pay
        // Credit window starts anyway: trial_v2 has credits_per_month=0, but legacy
        // trial plans don't, and an unanchored row would fall back to created_at.
        credit_period_start: now.toISOString(),
        credit_period_end: addMonths(now, 1).toISOString(),
        plan_posts_unlocked: 0,
    })
}

/**
 * Activate a paid plan after a successful payment (payment callback).
 * Works for trial → paid AND tier changes (Start → Růst → Dominance):
 * activates the paid subscription on the given plan and cancels any other
 * non-cancelled subscription of the client, so exactly one stays active.
 *
 * Period length comes from the SUBSCRIPTION (`subscriptions.term_months`, written
 * when the payment was initiated) — a yearly customer gets a year, not a month.
 * Hardcoding +1 month meant they would pay the annual price and be re-charged it
 * 30 days later. `subscription_plans.interval` still wins if a plan is ever quoted
 * per year, so the term can't multiply an already-yearly price (resolveTermMonths).
 *
 * Renewals of the same plan CHAIN off the previous current_period_end instead of
 * restarting at now (see computeBillingPeriod). A tier change and the first paid
 * activation start at now — no proration, the rest of the old period is forfeited.
 *
 * Returns the period it wrote, so the caller can put real dates on the doklad —
 * on a prepaid year that is what the accountant needs for časové rozlišení.
 */
export async function activatePaidPlan(
    clientId: string,
    planId: string,
    subscriptionId?: string,
): Promise<{ start: Date; end: Date; termMonths: number } | null> {
    const now = new Date()

    const { data: plan } = await supabaseAdmin
        .from("subscription_plans")
        .select("id, interval")
        .eq("id", planId)
        .maybeSingle()

    // The subscription to activate: the one linked to the payment, or the
    // latest live one (pending created at payment init / trial). Its own
    // plan/status/period/term decide whether this is a renewal (chain) or a
    // switch (start now), so the row is always read, never assumed.
    type SubRow = {
        id: string
        plan_id: string | null
        status: string | null
        current_period_end: string | null
        term_months: number | null
    }
    let sub: SubRow | null = null
    if (subscriptionId) {
        const { data } = await supabaseAdmin
            .from("subscriptions")
            .select("id, plan_id, status, current_period_end, term_months")
            .eq("id", subscriptionId)
            .eq("client_id", clientId) // never activate another tenant's row
            .maybeSingle()
        sub = data
    }
    if (!sub) {
        const { data } = await supabaseAdmin
            .from("subscriptions")
            .select("id, plan_id, status, current_period_end, term_months")
            .eq("client_id", clientId)
            .in("status", ["trialing", "pending", "active"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        sub = data
    }

    let period: { start: Date; end: Date; termMonths: number } | null = null

    if (sub) {
        const termMonths = resolveTermMonths(plan?.interval, sub.term_months)
        // Renewal = same plan, already live. Anything else (trial → paid, tier
        // change, comeback after expiry) is a fresh period starting now.
        //
        // The term deliberately does NOT enter this test: a customer moving from
        // monthly to yearly on the same tier chains off the end of the month they
        // already paid for, so the year is added on top instead of burning it.
        const isRenewal = sub.status === "active" && sub.plan_id === planId
        const { start, end } = computeBillingPeriod({
            now,
            termMonths,
            previousPeriodEnd: isRenewal && sub.current_period_end ? new Date(sub.current_period_end) : null,
        })
        period = { start, end, termMonths }

        // The credit window restarts with the paid period and is ALWAYS monthly —
        // on a yearly plan this is window 1 of 12, and the billing worker rolls the
        // remaining eleven. Unused credits don't carry over.
        await supabaseAdmin
            .from("subscriptions")
            .update({
                plan_id: planId,
                status: "active",
                current_period_start: start.toISOString(),
                current_period_end: end.toISOString(),
                credit_period_start: start.toISOString(),
                credit_period_end: addMonths(start, 1).toISOString(),
                plan_posts_unlocked: 30, // unlock all plan posts
                updated_at: now.toISOString(),
            })
            .eq("id", sub.id)

        // Exactly one live subscription per client.
        //
        // `select()` je tu kvůli tomu, co následuje: potřebujeme vědět, KTERÁ
        // předplatná jsme právě odstavili, abychom je uměli zrušit i u brány.
        const { data: superseded } = await supabaseAdmin
            .from("subscriptions")
            .update({ status: "cancelled", cancelled_at: now.toISOString(), updated_at: now.toISOString() })
            .eq("client_id", clientId)
            .neq("id", sub.id)
            .in("status", ["trialing", "pending", "active"])
            .select("id, provider, provider_ref")

        // Zrušení odstavených předplatných U BRÁNY.
        //
        // Bez tohohle kroku byl náš řádek `cancelled`, ale Stripe o tom nevěděl
        // a fakturoval dál — zákazník, který přešel ze Startu na Dominanci,
        // platil OBOJE a přišlo se na to až třicátý den. Lokální zrušení
        // a zrušení u brány jsou dvě různé věci a musí se dít spolu.
        //
        // ComGate se tudy neřeší schválně: jeho obnovy strhává náš cron podle
        // `status='active'`, takže odstavený řádek se přestane účtovat sám.
        // U Stripu je iniciátorem brána, a ta se musí dozvědět explicitně.
        //
        // Selhání NIKDY neshodí aktivaci: zákazník právě zaplatil a musí
        // dostat, co si koupil. Křičí se do logu i do Sentry, protože je to
        // chyba, která stojí peníze a nespraví se sama.
        for (const old of superseded || []) {
            if (old.provider !== "stripe" || !old.provider_ref) continue
            try {
                const { cancelStripeSubscriptionNow } = await import("@/lib/payments/stripe-billing")
                await cancelStripeSubscriptionNow(old.provider_ref)
                console.log(`💳 Staré Stripe předplatné ${old.provider_ref} zrušeno u brány (přechod na ${planId})`)
            } catch (err: any) {
                console.error(
                    `🚨 Staré Stripe předplatné ${old.provider_ref} (klient ${clientId}) se NEPODAŘILO zrušit u brány — ` +
                    `hrozí dvojí účtování, zruš ho ručně v dashboardu Stripu: ${err?.message}`,
                )
                try {
                    const Sentry = await import("@sentry/nextjs")
                    Sentry.captureException(err, {
                        tags: { area: "payments", provider: "stripe" },
                        extra: { clientId, staleSubscriptionId: old.id, stripeRef: old.provider_ref, newPlanId: planId },
                    })
                } catch { /* Sentry je volitelný */ }
            }
        }
    }

    // plan_locked rows are onboarding TEASER PLACEHOLDERS (fake hooks from
    // PLACEHOLDER_HOOKS, generic body, no image — generateMonthlyPlan is their only
    // creator; the real content plan never writes ig_posts rows). Converting them to
    // "draft" dumped 27 garbage captions into the client's real draft pool on every
    // activation, indistinguishable from genuine drafts. They served their locked-teaser
    // purpose — delete them.
    await supabaseAdmin
        .from("ig_posts")
        .delete()
        .eq("client_id", clientId)
        .eq("status", "plan_locked")

    return period
}

/** @deprecated Use activatePaidPlan(clientId, planId) — kept for old call sites */
export async function upgradeTrialToPaid(clientId: string): Promise<void> {
    await activatePaidPlan(clientId, "chrlit")
}

// ─── Helpers ─────────────────────────────────────────────────

/** Which tier unlocks a given action — used in upgrade-nudge messages */
function getPlanForAction(action: ActionType): string {
    if (action.startsWith("product_")) return "Dominance"
    if (action === "post_variant") return "Růst"
    // post_edit deliberately falls through to Start — fixing a post you already paid to
    // generate is table stakes on every plan, not an upsell.
    return "Start"
}
