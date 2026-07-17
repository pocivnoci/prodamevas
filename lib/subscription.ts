/**
 * Subscription & Credit System v2
 * ================================
 * Monthly Plan + Credits for Extras model.
 * 
 * Plan posts (included in subscription) don't cost credits.
 * Extra posts (beyond plan) cost credits.
 * Trial = content-gated: 3 full posts + 27 locked.
 */

import supabaseAdmin from "@/supabase/admin"
import { createClient } from "@/supabase/server"

// ─── Admin bypass ────────────────────────────────────────────

async function isSuperAdmin(): Promise<boolean> {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user?.email) return false
        const admins = (process.env.SUPER_ADMIN_EMAILS || "").split(",").map(e => e.trim()).filter(Boolean)
        return admins.includes(user.email)
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
    | "post_variant"
    | "idea_generate"
    | "product_ideas"
    | "product_visual"
    | "product_design"
    | "product_mockup"
    | "product_brief"

/** How many credits each action costs (for EXTRA posts, not plan posts) */
export const ACTION_CREDITS: Record<ActionType, number> = {
    post: 1,               // base = image; carousel/reel are weighted via creditsForMedia()
    post_variant: 1,       // base = image; weighted via creditsForMedia()
    idea_generate: 1,      // batch of ideas
    product_ideas: 2,      // 5 product ideas
    product_visual: 2,     // Imagen render
    product_design: 3,     // concept + render
    product_mockup: 2,     // photorealistic mockup
    product_brief: 5,      // full business analysis
}

/**
 * Media-weighted credit costs (COGS-aligned: 1 credit ≈ $0.30 of AI cost).
 * A reel costs ~4× an image to produce — flat 1-credit-per-post sold reels
 * below cost. Weighting the charge caps the worst case by construction.
 * Weights live in lib/credits.ts (client-safe) — re-exported here for the backend.
 */
export { MEDIA_CREDITS, creditsForMedia } from "@/lib/credits"
import { creditsForMedia as _creditsForMedia } from "@/lib/credits"

/** Weighted credit cost for an action: post/post_variant scale with medium, the rest are flat. */
export function creditsForAction(action: ActionType, medium?: string | null): number {
    if (action === "post" || action === "post_variant") return _creditsForMedia(medium)
    return ACTION_CREDITS[action]
}

/** Human-readable labels for actions */
export const ACTION_LABELS: Record<ActionType, string> = {
    post: "Příspěvek",
    post_variant: "Varianta příspěvku",
    idea_generate: "Generování nápadů",
    product_ideas: "Produktové nápady",
    product_visual: "Vizualizace produktu",
    product_design: "Design pro tisk",
    product_mockup: "Produktový mockup",
    product_brief: "Business Brief",
}

export type MediumType = "image" | "carousel" | "reel"

export interface PlanFeatures {
    credits_per_month: number
    max_projects: number
    extra_credit_price: number // haléře per credit
    allowed_actions: ActionType[]
    analytics: "basic" | "full"
    priority: boolean
    label: string
    highlight: boolean
    // v2: plan post limits
    plan_posts_limit?: number  // how many plan posts are unlocked (3 for trial, 30 for paid)
    plan_posts_total?: number  // total plan posts generated (always 30)
    // v3 growth tiers
    allowed_media?: MediumType[]   // missing = all media allowed (legacy plans)
    growth_tracking?: boolean      // weekly follower snapshots + growth dashboard
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
    creditsTotal: number
    creditsRemaining: number
    trialEndsAt: string | null
    currentPeriodEnd: string | null
    // v2: plan tracking
    planPostsUnlocked: number
    planGeneratedAt: string | null
    isTrial: boolean
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
 * Dunning window: after current_period_end passes, the sub stays usable for this
 * many days while the billing worker retries the renewal charge (one attempt/day).
 * After the window (or MAX_BILLING_FAILURES attempts) it is persisted as expired.
 */
export const BILLING_GRACE_DAYS = 3
export const MAX_BILLING_FAILURES = 3

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
        .select("id, plan_id, status, trial_ends_at, current_period_start, current_period_end, created_at, plan_generated_at, plan_posts_unlocked")
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
        .select("id, name, features")
        .eq("id", sub.plan_id)
        .single()

    if (!plan) return null

    const features = plan.features as PlanFeatures

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

    // 5. Get credits used this month
    const creditsUsed = await getCreditsUsedThisMonth(clientId)
    const creditsTotal = features.credits_per_month
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
        planPostsUnlocked: sub.plan_posts_unlocked || 0,
        planGeneratedAt: sub.plan_generated_at,
        isTrial,
    }
}

/**
 * Count credits used by a client in the current calendar month.
 * Sums deductions (positive) AND refunds (negative) so a refunded
 * failed generation frees the credit again.
 */
export async function getCreditsUsedThisMonth(clientId: string): Promise<number> {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

    const { data } = await supabaseAdmin
        .from("credit_transactions")
        .select("credits")
        .eq("client_id", clientId)
        .gte("created_at", monthStart)

    if (!data || data.length === 0) return 0
    return Math.max(0, data.reduce((sum, row) => sum + row.credits, 0))
}

/**
 * Check if a client can perform a specific action.
 * For "post" actions: checks if it's a plan post (free) or extra post (costs credits).
 */
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
            reason: `Nedostatek kreditů. Potřebujete ${creditsRequired}, zbývá ${sub.creditsRemaining}. Dobijte si kredity za 49 Kč/ks.`,
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
            reason: `Nedostatek kreditů pro ${count}× ${ACTION_LABELS[action]}. Potřebujete ${creditsRequired}, zbývá ${sub.creditsRemaining}. Dobijte si kredity za 49 Kč/ks.`,
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
    await supabaseAdmin.from("subscriptions").insert({
        client_id: clientId,
        plan_id: "trial_v2",
        status: "trialing",
        current_period_start: new Date().toISOString(),
        // No trial_ends_at — content-gated, not time-gated
        // No current_period_end — unlimited until they pay
        plan_posts_unlocked: 0,
    })
}

/**
 * Activate a paid plan after a successful payment (payment callback).
 * Works for trial → paid AND tier changes (Start → Růst → Dominance):
 * activates the paid subscription on the given plan and cancels any other
 * non-cancelled subscription of the client, so exactly one stays active.
 */
export async function activatePaidPlan(clientId: string, planId: string, subscriptionId?: string): Promise<void> {
    const now = new Date()
    const periodEnd = new Date(now)
    periodEnd.setMonth(periodEnd.getMonth() + 1)

    // The subscription to activate: the one linked to the payment, or the
    // latest live one (pending created at payment init / trial)
    let sub: { id: string } | null = subscriptionId ? { id: subscriptionId } : null
    if (!sub) {
        const { data } = await supabaseAdmin
            .from("subscriptions")
            .select("id")
            .eq("client_id", clientId)
            .in("status", ["trialing", "pending", "active"])
            .order("created_at", { ascending: false })
            .limit(1)
            .single()
        sub = data
    }

    if (sub) {
        await supabaseAdmin
            .from("subscriptions")
            .update({
                plan_id: planId,
                status: "active",
                current_period_start: now.toISOString(),
                current_period_end: periodEnd.toISOString(),
                plan_posts_unlocked: 30, // unlock all plan posts
                updated_at: now.toISOString(),
            })
            .eq("id", sub.id)

        // Exactly one live subscription per client
        await supabaseAdmin
            .from("subscriptions")
            .update({ status: "cancelled", cancelled_at: now.toISOString(), updated_at: now.toISOString() })
            .eq("client_id", clientId)
            .neq("id", sub.id)
            .in("status", ["trialing", "pending", "active"])
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
}

/** @deprecated Use activatePaidPlan(clientId, planId) — kept for old call sites */
export async function upgradeTrialToPaid(clientId: string): Promise<void> {
    return activatePaidPlan(clientId, "chrlit")
}

// ─── Helpers ─────────────────────────────────────────────────

/** Which tier unlocks a given action — used in upgrade-nudge messages */
function getPlanForAction(action: ActionType): string {
    if (action.startsWith("product_")) return "Dominance"
    if (action === "post_variant") return "Růst"
    return "Start"
}
