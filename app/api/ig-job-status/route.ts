import { NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"

export const maxDuration = 5 // Ultra-lightweight polling

/** Job statuses that mean the job is finished (no reaping needed) */
const TERMINAL_STATUSES = ["done", "failed"]

/** A running job silent for this long is considered dead. Must exceed run-job
 *  maxDuration (800s on Vercel Pro) so a slow-but-alive job isn't falsely reaped. */
const STUCK_AFTER_MS = 15 * 60 * 1000

/**
 * GET /api/ig-job-status?id=<jobId>
 *
 * Returns the current status of a generation job.
 * Called by the UI every 2 seconds for real-time progress.
 * Also acts as the stuck-job reaper: a non-terminal job whose last
 * update is older than STUCK_AFTER_MS is marked failed + refunded.
 */
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url)
    const jobId = searchParams.get("id")

    if (!jobId) {
        return NextResponse.json({ error: "Missing id parameter" }, { status: 400 })
    }

    const { data: job, error } = await supabaseAdmin
        .from("ig_jobs")
        .select("id, client_id, config, status, progress, agent_message, result, error, editorial_log, created_at, updated_at")
        .eq("id", jobId)
        .single()

    if (error || !job) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 })
    }

    const { requireClientAccess } = await import("@/lib/auth-guard")
    try { await requireClientAccess(job.client_id) } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }

    // Stuck-job reaper: lambda died mid-generation → fail the job + refund the charge
    if (!TERMINAL_STATUSES.includes(job.status)) {
        const lastActivity = new Date(job.updated_at || job.created_at).getTime()
        if (Date.now() - lastActivity > STUCK_AFTER_MS) {
            const timeoutMsg = "Generování vypršelo (timeout) — zkuste to prosím znovu."
            await supabaseAdmin
                .from("ig_jobs")
                .update({ status: "failed", agent_message: "⏱️ Timeout", error: timeoutMsg })
                .eq("id", jobId)
                .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`) // don't clobber a concurrent finish

            try {
                const { refundJobCharge } = await import("@/lib/subscription")
                await refundJobCharge(job.client_id, job.id, (job.config as any)?.charged)
            } catch (refundErr: any) {
                console.error("Stuck-job refund failed:", refundErr?.message)
            }

            job.status = "failed"
            job.error = timeoutMsg
            job.agent_message = "⏱️ Timeout"
        }
    }

    return NextResponse.json({
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        agentMessage: job.agent_message,
        result: job.result,
        error: job.error,
        editorialLog: job.editorial_log || [],
        elapsed: Math.round((Date.now() - new Date(job.created_at).getTime()) / 1000),
    })
}
