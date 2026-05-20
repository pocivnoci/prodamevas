import { NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"
import { generateOnePost } from "@/instagram/autopilot"

export const maxDuration = 300

/**
 * POST /api/ig-generate
 *
 * Synchronous generation with real-time job progress updates.
 * Blocks until done (max 300s on Vercel).
 * UI polls /api/ig-job-status for live progress display.
 */
export async function POST(req: Request) {
    let jobId: string | null = null

    try {
        const { requireAuth } = await import("@/lib/auth-guard")
        await requireAuth()

        const body = await req.json()

        // Resolve client UUID
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(body.configName || "mobilnamiru")

        // Create job record for progress tracking
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
                status: "researcher",
                progress: 5,
                agent_message: "🔍 Researcher vybírá zdroje...",
            })
            .select("id")
            .single()

        if (error || !job) {
            throw new Error(`Failed to create job: ${error?.message}`)
        }

        jobId = job.id

        // Helper to update progress in real-time
        const updateJob = async (update: Record<string, any>) => {
            await supabaseAdmin.from("ig_jobs").update(update).eq("id", jobId!)
        }

        // Run full generation synchronously — Vercel gives us 300s
        const result = await generateOnePost({
            configName: body.configName,
            type: body.type,
            topic: body.topic,
            dryRun: body.dryRun,
            aspectRatio: body.aspectRatio,
            customImageUrl: body.customImageUrl,
            onProgress: async (stage: string, progress: number, message: string) => {
                await updateJob({ status: stage, progress, agent_message: message })
            },
        })

        // Mark done with result
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
        console.error("IG generate API error:", msg)

        if (jobId) {
            await supabaseAdmin.from("ig_jobs").update({
                status: "failed",
                agent_message: "❌ Generování selhalo",
                error: msg,
            }).eq("id", jobId)
        }

        return NextResponse.json({ success: false, error: msg }, { status: 500 })
    }
}
