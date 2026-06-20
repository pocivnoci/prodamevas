import { NextResponse } from "next/server"
import "@/lib/agents/handlers" // side-effect: registers all task handlers
import { drainTasks } from "@/lib/agent-runner"

export const maxDuration = 800 // Vercel Pro cap (Fluid Compute)

/**
 * GET /api/cron/agent-worker
 *
 * Durable drainer for agent_tasks (core hardening Fáze 2). Each tick claims
 * runnable tasks via a lease and runs them through their registered handlers
 * within the time budget; failures retry with backoff up to max_attempts. New
 * agent types plug in via registerHandler — no new cron needed.
 *
 * Auth: CRON_SECRET bearer token (Vercel sends it automatically) — no user
 * session in a cron invocation.
 */
export async function GET(req: Request) {
    const secret = process.env.CRON_SECRET
    const auth = req.headers.get("authorization")
    if (!secret || auth !== `Bearer ${secret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Leave headroom under the 800s cap for the in-flight task to finish cleanly.
    const summary = await drainTasks(700_000)
    if (summary.ran > 0) {
        console.log(`🤖 agent-worker: ran ${summary.ran} (done ${summary.done}, retried ${summary.retried}, failed ${summary.failed})`)
    }
    return NextResponse.json({ success: true, ...summary })
}
