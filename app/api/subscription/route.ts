/**
 * GET /api/subscription?clientId=<uuid>
 * 
 * Returns the current subscription state for a client.
 * Used by the dashboard to display plan info, credits, etc.
 */

import { NextRequest, NextResponse } from "next/server"
import { getClientSubscription, type SubscriptionInfo } from "@/lib/subscription"

export async function GET(req: NextRequest) {
    const clientId = req.nextUrl.searchParams.get("clientId")

    if (!clientId) {
        return NextResponse.json({ error: "Missing clientId" }, { status: 400 })
    }

    try {
        const sub = await getClientSubscription(clientId)

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
        })
    } catch (err: any) {
        console.error("Subscription fetch error:", err?.message)
        return NextResponse.json({ error: "Failed to fetch subscription" }, { status: 500 })
    }
}
