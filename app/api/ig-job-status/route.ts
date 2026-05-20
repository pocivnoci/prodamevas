import { NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"

export const maxDuration = 5 // Ultra-lightweight polling

/**
 * GET /api/ig-job-status?id=<jobId>
 * 
 * Returns the current status of a generation job.
 * Called by the UI every 2 seconds for real-time progress.
 */
export async function GET(req: Request) {
    const { requireAuth } = await import("@/lib/auth-guard")
    try { await requireAuth() } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }

    const { searchParams } = new URL(req.url)
    const jobId = searchParams.get("id")

    if (!jobId) {
        return NextResponse.json({ error: "Missing id parameter" }, { status: 400 })
    }

    const { data: job, error } = await supabaseAdmin
        .from("ig_jobs")
        .select("id, status, progress, agent_message, result, error, created_at, updated_at")
        .eq("id", jobId)
        .single()

    if (error || !job) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 })
    }

    return NextResponse.json({
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        agentMessage: job.agent_message,
        result: job.result,
        error: job.error,
        elapsed: Math.round((Date.now() - new Date(job.created_at).getTime()) / 1000),
    })
}
