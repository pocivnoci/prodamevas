/**
 * Subscription & Credit System
 * =============================
 * Central library for checking plans, credits, and enforcing limits.
 * Used by server actions and API routes before any AI operation.
 */

import supabaseAdmin from "@/supabase/admin"

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

/** How many credits each action costs */
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
}

export interface CanPerformResult {
    allowed: boolean
    reason?: string
    creditsRequired: number
    creditsRemaining: number
    featureBlocked?: boolean
    planRequired?: string
}

// ─── Main API ────────────────────────────────────────────────

/**
 * Get the active subscription + usage for a client.
 * Returns null if no subscription exists.
 */
export async function getClientSubscription(clientId: string): Promise<SubscriptionInfo | null> {
    // 1. Get active/trialing subscription
    const { data: sub } = await supabaseAdmin
        .from("subscriptions")
        .select("id, plan_id, status, trial_ends_at, current_period_start, current_period_end, created_at")
        .eq("client_id", clientId)
        .in("status", ["active", "trialing", "pending"])
        .order("created_at", { ascending: false })
        .limit(1)
        .single()

    if (!sub) return null

    // 2. Get plan details
    const { data: plan } = await supabaseAdmin
        .from("subscription_plans")
        .select("id, name, features")
        .eq("id", sub.plan_id)
        .single()

    if (!plan) return null

    const features = plan.features as PlanFeatures

    // 3. Check if trial is still active
    let status = sub.status as SubscriptionInfo["status"]
    if (status === "trialing" && sub.trial_ends_at) {
        const trialEnd = new Date(sub.trial_ends_at)
        if (trialEnd < new Date()) {
            // Trial expired — mark as expired
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
    }
}

/**
 * Count credits used by a client in the current calendar month.
 */
export async function getCreditsUsedThisMonth(clientId: string): Promise<number> {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

    const { data } = await supabaseAdmin
        .from("credit_transactions")
        .select("credits")
        .eq("client_id", clientId)
        .gte("created_at", monthStart)
        .gt("credits", 0) // only deductions

    if (!data || data.length === 0) return 0
    return data.reduce((sum, row) => sum + row.credits, 0)
}

/**
 * Check if a client can perform a specific action.
 * Returns { allowed, reason, creditsRequired, creditsRemaining }.
 */
export async function canPerformAction(
    clientId: string,
    action: ActionType,
): Promise<CanPerformResult> {
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
            reason: `Funkce "${ACTION_LABELS[action]}" není dostupná v plánu ${sub.planName}. Upgradujte na ${planSuggestion}.`,
            creditsRequired,
            creditsRemaining: sub.creditsRemaining,
            featureBlocked: true,
            planRequired: planSuggestion,
        }
    }

    // Not enough credits
    if (sub.creditsRemaining < creditsRequired) {
        return {
            allowed: false,
            reason: `Nedostatek kreditů. Potřebujete ${creditsRequired}, zbývá ${sub.creditsRemaining}. Dokupte kredity nebo upgradujte plán.`,
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
 * Deduct credits for a performed action.
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
 * Create a trial subscription for a newly registered client.
 * 7 days, 30 credits, full features unlocked.
 */
export async function createTrialSubscription(clientId: string): Promise<void> {
    const trialEnd = new Date()
    trialEnd.setDate(trialEnd.getDate() + 7) // 7-day trial

    // Use 'trial' plan for beta testing (30 credits — configured in subscription_plans DB table)
    await supabaseAdmin.from("subscriptions").insert({
        client_id: clientId,
        plan_id: "trial",
        status: "trialing",
        trial_ends_at: trialEnd.toISOString(),
        current_period_start: new Date().toISOString(),
        current_period_end: trialEnd.toISOString(),
    })
}

// ─── Helpers ─────────────────────────────────────────────────

function getPlanForAction(action: ActionType): string {
    switch (action) {
        case "post_variant":
        case "product_ideas":
            return "Creator"
        case "product_visual":
        case "product_design":
        case "product_mockup":
        case "product_brief":
            return "Business"
        default:
            return "Starter"
    }
}
