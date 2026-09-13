import { actionTranslator } from "@/lib/i18n/actions"
import { NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"
import { isStuck, isCampaignJob, reapStuckJob } from "@/lib/job-reaper"

export const maxDuration = 5 // Ultra-lightweight polling

/**
 * GET /api/ig-job-status?id=<jobId>
 *
 * Returns the current status of a generation job.
 * Called by the UI every 2 seconds for real-time progress.
 * Also acts as the stuck-job reaper for the job being watched: a non-terminal
 * job silent longer than STUCK_AFTER_MS is marked failed + refunded. The same
 * logic runs as a sweep in /api/cron/job-resume for jobs nobody is polling —
 * both go through `lib/job-reaper.ts`, so the threshold and the claim-then-refund
 * order can't drift apart.
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

    // Stuck-job reaper: lambda died mid-generation → fail the job + refund the charge.
    // Campaign jobs are the campaign-worker's to resume (it keeps their charge on
    // purpose), so the UI poll must not fail them either.
    if (isStuck(job) && !isCampaignJob(job)) {
        await reapStuckJob(job)
        // Whether this call or a concurrent sweep claimed it, the job is failed now.
        const t = await actionTranslator("api")
        job.status = "failed"
        job.error = t("job.stuck")
        job.agent_message = t("job.timeout")
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
