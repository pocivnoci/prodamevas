import { NextResponse } from "next/server"
import { requestAction } from "@/lib/agent-safety"

export const maxDuration = 60

/**
 * GET /api/cron/weekly-report
 *
 * Weekly Vercel cron (Monday 06:00 UTC, vercel.json). Doesn't do the work itself —
 * it goes through the agent stack: requestAction records an audit row in
 * agent_actions and (since the report is 'internal' risk → auto-approved)
 * dispatches a `weekly_report` agent_task, which /api/cron/agent-worker runs:
 * gather stats → e-mail the founder. This is the first real ops agent, end to end.
 *
 * Auth: CRON_SECRET bearer (no user session in cron).
 */
export async function GET(req: Request) {
    const secret = process.env.CRON_SECRET
    const auth = req.headers.get("authorization")
    if (!secret || auth !== `Bearer ${secret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const outcome = await requestAction({
        agentType: "ops",
        action: "Týdenní report",
        riskTier: "internal", // founder's own report — auto-run, no approval
        taskType: "weekly_report",
        clientId: null,
        payload: {},
    })

    return NextResponse.json({ success: true, outcome })
}
