/**
 * GET /api/subscription?clientId=<uuid>
 * 
 * Returns the current subscription state for a client.
 * Used by the dashboard to display plan info, credits, etc.
 */

import { NextRequest, NextResponse } from "next/server"
import { getClientSubscription, deriveBillingState, type SubscriptionInfo } from "@/lib/subscription"
import { ALL_MEDIA } from "@/lib/credits"

export async function GET(req: NextRequest) {
    // The UI passes projectId = tenant SLUG. Resolve it to the real client UUID
    // and enforce membership in one step (getClientSubscription needs the UUID;
    // passing the slug as client_id silently matched nothing → no plan shown).
    const param = req.nextUrl.searchParams.get("clientId")
    if (!param) {
        return NextResponse.json({ error: "Missing clientId" }, { status: 400 })
    }

    let clientUuid: string
    try {
        const { requireProjectAccess } = await import("@/lib/auth-guard")
        clientUuid = (await requireProjectAccess(param)).clientId
    } catch {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    try {
        const sub = await getClientSubscription(clientUuid)

        if (!sub) {
            return NextResponse.json(null, { status: 200 })
        }

        // Return a client-safe subset
        return NextResponse.json({
            planId: sub.planId,
            planName: sub.planName,
            status: sub.status,
            creditsUsed: sub.creditsUsed,
            creditsTotal: sub.creditsTotal,
            creditsRemaining: sub.creditsRemaining,
            trialEndsAt: sub.trialEndsAt,
            currentPeriodEnd: sub.currentPeriodEnd,
            // Credits reset on the CREDIT window, not the paid period — on a yearly
            // plan those are eleven months apart.
            creditPeriodEnd: sub.creditPeriodEnd,
            allowedActions: sub.features.allowed_actions,
            analytics: sub.features.analytics,
            maxProjects: sub.features.max_projects,
            // v3 growth tiers: missing allowed_media = all media (legacy plans)
            allowedMedia: sub.features.allowed_media ?? ALL_MEDIA,
            // Global engine kill-switches, surfaced so the medium picker can't offer a
            // format the engine will clamp away. A "reel" that ships as a carousel is a
            // broken promise — the plan gate above answers "may this tenant", these
            // answer "can the engine at all".
            reelsEnabled: process.env.REELS_ENABLED === "1",
            storiesEnabled: process.env.STORIES_ENABLED === "1",
            growthTracking: sub.features.growth_tracking ?? false,
            // v2: plan tracking
            planPostsUnlocked: sub.planPostsUnlocked,
            planPostsLimit: sub.features.plan_posts_limit || 0,
            planPostsTotal: sub.features.plan_posts_total || 0,
            planGeneratedAt: sub.planGeneratedAt,
            isTrial: sub.isTrial,
            // Stav fakturace se odvozuje TADY, ne v Reactu: pravidla o penězích
            // musí mít jedno místo, jinak banner a sekce Předplatné začnou tvrdit
            // každý něco jiného.
            billingState: deriveBillingState(sub),
            billingFailures: sub.billingFailures,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        })
    } catch (err: any) {
        console.error("Subscription fetch error:", err?.message)
        return NextResponse.json({ error: "Failed to fetch subscription" }, { status: 500 })
    }
}
