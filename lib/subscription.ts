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
    post: 1,
    post_variant: 1,
    idea_generate: 1,      // batch of ideas
    product_ideas: 2,      // 5 product ideas
    product_visual: 2,     // Imagen render
    product_design: 3,     // concept + render
    product_mockup: 2,     // photorealistic mockup
    product_brief: 5,      // full business analysis
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
export async function getClientSubscription(clientId: string): Promise<SubscriptionInfo | null> {
    // 1. Get active/trialing subscription (with v2 columns, fallback to legacy)
    let sub: any = null
    const { data: subV2, error: v2Error } = await supabaseAdmin
        .from("subscriptions")
        .select("id, plan_id, status, trial_ends_at, current_period_start, current_period_end, created_at, plan_generated_at, plan_posts_unlocked")
        .eq("client_id", clientId)
        .in("status", ["active", "trialing", "pending"])
        .order("created_at", { ascending: false })
        .limit(1)
        .single()

    if (subV2 && !v2Error) {
        sub = subV2
    } else {
        // Fallback: v2 columns don't exist yet (migration not run)
        const { data: subLegacy } = await supabaseAdmin
            .from("subscriptions")
            .select("id, plan_id, status, trial_ends_at, current_period_start, current_period_end, created_at")
            .eq("client_id", clientId)
            .in("status", ["active", "trialing", "pending"])
            .order("created_at", { ascending: false })
            .limit(1)
            .single()
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

    // 4. Check if paid period ended
    if (status === "active" && sub.current_period_end) {
        const periodEnd = new Date(sub.current_period_end)
        if (periodEnd < new Date()) {
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
): Promise<CanPerformResult> {
    // Super admin bypasses all checks
    if (await isSuperAdmin()) return ADMIN_BYPASS

    const creditsRequired = ACTION_CREDITS[action]
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
            reason: `Nedostatek kreditů. Potřebujete ${creditsRequired}, zbývá ${sub.creditsRemaining}. Dobijte si kredity za 15 Kč/ks.`,
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
): Promise<void> {
    const credits = ACTION_CREDITS[action]

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
): Promise<void> {
    if (charged === "plan") {
        await decrementPlanPostCount(clientId)
    } else if (charged === "credits") {
        await supabaseAdmin.from("credit_transactions").insert({
            client_id: clientId,
            action: "post_refund",
            credits: -ACTION_CREDITS.post,
            description: "Refund: generování selhalo",
            reference_id: jobId,
        })
    }
}

/**
 * Check if a client can perform a batch of actions (e.g. 7 posts at once).
 * Validates total credits needed upfront to avoid partial failures.
 */
export async function canPerformBatchAction(
    clientId: string,
    action: ActionType,
    count: number,
): Promise<CanPerformResult> {
    // Super admin bypasses all checks
    if (await isSuperAdmin()) return ADMIN_BYPASS

    const creditsRequired = ACTION_CREDITS[action] * count
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
            reason: `Nedostatek kreditů pro ${count}× ${ACTION_LABELS[action]}. Potřebujete ${creditsRequired}, zbývá ${sub.creditsRemaining}. Dobijte si kredity za 15 Kč/ks.`,
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
 * Upgrade a trial subscription to paid (after successful payment).
 * Called by payment callback.
 */
export async function upgradeTrialToPaid(clientId: string): Promise<void> {
    const now = new Date()
    const periodEnd = new Date(now)
    periodEnd.setMonth(periodEnd.getMonth() + 1)

    // Find active trial
    const { data: sub } = await supabaseAdmin
        .from("subscriptions")
        .select("id")
        .eq("client_id", clientId)
        .in("status", ["trialing", "pending"])
        .order("created_at", { ascending: false })
        .limit(1)
        .single()

    if (sub) {
        // Upgrade existing trial
        await supabaseAdmin
            .from("subscriptions")
            .update({
                plan_id: "chrlit",
                status: "active",
                current_period_start: now.toISOString(),
                current_period_end: periodEnd.toISOString(),
                plan_posts_unlocked: 30, // unlock all plan posts
                updated_at: now.toISOString(),
            })
            .eq("id", sub.id)
    }

    // Unlock all plan_locked posts for this client
    await supabaseAdmin
        .from("ig_posts")
        .update({ status: "draft" })
        .eq("client_id", clientId)
        .eq("status", "plan_locked")
}

// ─── Helpers ─────────────────────────────────────────────────

function getPlanForAction(action: ActionType): string {
    return "Chrlit"
}
