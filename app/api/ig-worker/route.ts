import { NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"
import { generateOnePost } from "@/instagram/autopilot"

export const maxDuration = 300 // Full 5 minutes for the heavy work

/**
 * POST /api/ig-worker
 * 
 * Processes a single generation job from the queue.
 * Updates job status/progress in real-time for the polling UI.
 */
export async function POST(req: Request) {
    let jobId: string | null = null

    try {
        const body = await req.json()
        jobId = body.jobId

        if (!jobId) {
            return NextResponse.json({ error: "Missing jobId" }, { status: 400 })
        }

        // Fetch the job
        const { data: job, error: fetchError } = await supabaseAdmin
            .from("ig_jobs")
            .select("*")
            .eq("id", jobId)
            .single()

        if (fetchError || !job) {
            return NextResponse.json({ error: "Job not found" }, { status: 404 })
        }

        // Skip if already processing or done
        if (job.status !== "pending") {
            return NextResponse.json({ message: "Job already processing", status: job.status })
        }

        // Mark as in-progress
        await updateJob(jobId, { status: "researcher", progress: 5, agent_message: "🔍 Researcher vybírá zdroje..." })

        // Run the full pipeline with progress callbacks
        const config = job.config as any
        const result = await generateOnePost({
            configName: config.configName,
            type: config.type,
            topic: config.topic,
            dryRun: config.dryRun,
            aspectRatio: config.aspectRatio,
            customImageUrl: config.customImageUrl,
            // Progress callback — autopilot will call this at each stage
            onProgress: async (stage: string, progress: number, message: string) => {
                await updateJob(jobId!, { status: stage, progress, agent_message: message })
            },
        })

        // Mark as done with result
        await updateJob(jobId, {
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

        return NextResponse.json({ success: true, jobId })
    } catch (err: any) {
        console.error("Worker error:", err?.message)

        if (jobId) {
            await updateJob(jobId, {
                status: "failed",
                progress: 0,
                agent_message: "❌ Generování selhalo",
                error: err?.message?.substring(0, 1000) || "Unknown error",
            })
        }

        return NextResponse.json({ error: err?.message }, { status: 500 })
    }
}

async function updateJob(jobId: string, update: Record<string, any>) {
    const { error } = await supabaseAdmin
        .from("ig_jobs")
        .update(update)
        .eq("id", jobId)

    if (error) {
        console.warn(`Failed to update job ${jobId}:`, error.message)
    }
}
