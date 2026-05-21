import { NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"
import { generateOnePost } from "@/instagram/autopilot"

export const maxDuration = 300 // Full 5 min for generation

/**
 * POST /api/ig-run-job
 *
 * Step 2 of 2: Runs actual generation for an existing jobId.
 * Called by UI after ig-create-job returns the jobId.
 * Blocks synchronously, updates job progress in DB throughout.
 */
export async function POST(req: Request) {
    const { requireAuth } = await import("@/lib/auth-guard")
    try { await requireAuth() } catch { return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }) }

    const { jobId } = await req.json()

    if (!jobId) {
        return NextResponse.json({ success: false, error: "Missing jobId" }, { status: 400 })
    }

    // Fetch job config from DB
    const { data: job } = await supabaseAdmin
        .from("ig_jobs")
        .select("config")
        .eq("id", jobId)
        .single()

    if (!job) {
        return NextResponse.json({ success: false, error: "Job not found" }, { status: 404 })
    }

    const updateJob = async (update: Record<string, any>) => {
        await supabaseAdmin.from("ig_jobs").update(update).eq("id", jobId)
    }

    const config = job.config as any

    try {
        const result = await generateOnePost({
            configName: config.configName,
            type: config.type,
            topic: config.topic,
            dryRun: config.dryRun,
            aspectRatio: config.aspectRatio,
            medium: config.medium,
            customImageUrl: config.customImageUrl,
            productId: config.productId,
            campaignContext: config.campaignContext,
            onProgress: async (stage: string, progress: number, message: string) => {
                await updateJob({ status: stage, progress, agent_message: message })
            },
        })

        await updateJob({
            status: "done",
            progress: 100,
            agent_message: "✅ Hotovo!",
            result: {
                success: true,
                postId: result.id,
                caption: result.caption,
                imageUrl: result.imageUrl,
                cost: result.cost,
            },
        })

        return NextResponse.json({
            success: true,
            jobId,
            postId: result.id,
            caption: result.caption,
            imageUrl: result.imageUrl,
        })

    } catch (err: any) {
        const msg = err?.message?.substring(0, 500) || "Unknown error"
        console.error("ig-run-job error:", msg)

        await updateJob({
            status: "failed",
            agent_message: "❌ Generování selhalo",
            error: msg,
        })

        return NextResponse.json({ success: false, error: msg }, { status: 500 })
    }
}
