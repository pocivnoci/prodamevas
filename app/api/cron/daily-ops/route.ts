import { NextResponse } from "next/server"
import { requestAction } from "@/lib/agent-safety"

export const maxDuration = 60

/**
 * GET /api/cron/daily-ops
 *
 * Daily Vercel cron (05:30 UTC, vercel.json). Like weekly-report it does no work
 * itself — it dispatches through the agent stack (audit row + task), and
 * /api/cron/agent-worker runs the handlers within the minute:
 *
 *   health_check    → alert e-mail to the founder ONLY when something is wrong
 *   lifecycle_scan  → proposes outbound lifecycle e-mails (approval-gated) and
 *                     e-mails the founder one digest with one-click links
 *
 * Both dispatches are 'internal' risk (the scan itself sends nothing to
 * customers — every actual customer e-mail is its own 'outbound' proposal).
 *
 * Auth: CRON_SECRET bearer (no user session in cron).
 */
export async function GET(req: Request) {
    const secret = process.env.CRON_SECRET
    const auth = req.headers.get("authorization")
    if (!secret || auth !== `Bearer ${secret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const health = await requestAction({
        agentType: "ops",
        action: "Denní health check",
        riskTier: "internal",
        taskType: "health_check",
        clientId: null,
        payload: {},
    })

    const lifecycle = await requestAction({
        agentType: "lifecycle",
        action: "Denní lifecycle scan",
        riskTier: "internal",
        taskType: "lifecycle_scan",
        clientId: null,
        payload: {},
    })

    return NextResponse.json({ success: true, health, lifecycle })
}
