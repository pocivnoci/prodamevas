/**
 * GET /api/subscription?clientId=<uuid>
 * 
 * Returns the current subscription state for a client.
 * Used by the dashboard to display plan info, credits, etc.
 */

import { NextRequest, NextResponse } from "next/server"
import { getClientSubscription, type SubscriptionInfo } from "@/lib/subscription"

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
            allowedActions: sub.features.allowed_actions,
            analytics: sub.features.analytics,
            maxProjects: sub.features.max_projects,
            // v3 growth tiers: missing allowed_media = all media (legacy plans)
            allowedMedia: sub.features.allowed_media ?? ["image", "carousel", "reel"],
            growthTracking: sub.features.growth_tracking ?? false,
            // v2: plan tracking
            planPostsUnlocked: sub.planPostsUnlocked,
            planPostsLimit: sub.features.plan_posts_limit || 0,
            planPostsTotal: sub.features.plan_posts_total || 0,
            planGeneratedAt: sub.planGeneratedAt,
            isTrial: sub.isTrial,
            // Global reel kill-switch state — the UI must not offer reels the engine
            // would clamp to carousel anyway (read-only; flipping it is an env change).
            reelsEnabled: process.env.REELS_ENABLED === "1",
        })
    } catch (err: any) {
        console.error("Subscription fetch error:", err?.message)
        return NextResponse.json({ error: "Failed to fetch subscription" }, { status: 500 })
    }
}
