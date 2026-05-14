import { NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"
import { waitUntil } from "@vercel/functions"

export const maxDuration = 300 // Full 5 min — worker runs here via waitUntil

/**
 * POST /api/ig-generate
 * 
 * Creates a job, returns jobId immediately, then runs the worker
 * in the background using Vercel's waitUntil() (correct async pattern).
 */
export async function POST(req: Request) {
    try {
        const body = await req.json()

        // Resolve client UUID
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(body.configName || "mobilnamiru")

        // Create job in queue
        const { data: job, error } = await supabaseAdmin
            .from("ig_jobs")
            .insert({
                client_id: clientId,
                config: {
                    configName: body.configName,
                    type: body.type,
                    topic: body.topic,
                    dryRun: body.dryRun,
                    aspectRatio: body.aspectRatio,
                    customImageUrl: body.customImageUrl,
                    category: body.category,
                },
                status: "pending",
                progress: 0,
                agent_message: "Čekám ve frontě...",
            })
            .select("id")
            .single()

        if (error || !job) {
            throw new Error(`Failed to create job: ${error?.message}`)
        }

        const jobId = job.id

        // Run the heavy work AFTER responding — Vercel keeps the function alive
        waitUntil(runWorker(jobId))

        return NextResponse.json({ success: true, jobId })

    } catch (err: any) {
        console.error("IG generate API error:", err?.message)
        return NextResponse.json({
            success: false,
            error: err?.message?.substring(0, 500) || "Unknown error",
        }, { status: 500 })
    }
}

async function runWorker(jobId: string) {
    const { generateOnePost } = await import("@/instagram/autopilot")

    // Helper to update job status in real-time
    const updateJob = async (update: Record<string, any>) => {
        await supabaseAdmin.from("ig_jobs").update(update).eq("id", jobId)
    }

    try {
        // Fetch job config
        const { data: job } = await supabaseAdmin
            .from("ig_jobs")
            .select("config")
            .eq("id", jobId)
            .single()

        if (!job) throw new Error("Job not found")

        const config = job.config as any

        const result = await generateOnePost({
            configName: config.configName,
            type: config.type,
            topic: config.topic,
            dryRun: config.dryRun,
            aspectRatio: config.aspectRatio,
            customImageUrl: config.customImageUrl,
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

    } catch (err: any) {
        console.error("Worker error:", err?.message)
        await supabaseAdmin.from("ig_jobs").update({
            status: "failed",
            agent_message: "❌ Generování selhalo",
            error: err?.message?.substring(0, 1000) || "Unknown error",
        }).eq("id", jobId)
    }
}
