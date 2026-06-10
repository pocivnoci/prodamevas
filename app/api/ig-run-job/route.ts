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
    const { jobId } = await req.json()

    if (!jobId) {
        return NextResponse.json({ success: false, error: "Missing jobId" }, { status: 400 })
    }

    // Fetch job config from DB
    const { data: job } = await supabaseAdmin
        .from("ig_jobs")
        .select("config, client_id")
        .eq("id", jobId)
        .single()

    if (!job) {
        return NextResponse.json({ success: false, error: "Job not found" }, { status: 404 })
    }

    // Ownership check: caller must have access to the client this job belongs to
    const { requireClientAccess } = await import("@/lib/auth-guard")
    try { await requireClientAccess(job.client_id) } catch { return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }) }

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
            onProgress: async (stage: string, progress: number, message: string, editorialLog?: any[]) => {
                const update: Record<string, any> = { status: stage, progress, agent_message: message }
                if (editorialLog && editorialLog.length > 0) {
                    // Store editorial conversation for UI display
                    update.editorial_log = editorialLog.map(m => ({
                        role: m.role,
                        action: m.action,
                        summary: m.summary || m.content?.substring(0, 150),
                    }))
                }
                await updateJob(update)
            },
        })

        // Credit was already charged in ig-create-job (referenced by jobId).
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

        // Refund the charge made at job creation (idempotent via unique index on action+reference_id)
        if (config.charged === "plan") {
            try {
                const { decrementPlanPostCount } = await import("@/lib/subscription")
                await decrementPlanPostCount(job.client_id)
            } catch (refundErr: any) {
                console.error("Plan post refund failed:", refundErr?.message)
            }
        } else if (config.charged === "credits") {
            try {
                const { ACTION_CREDITS } = await import("@/lib/subscription")
                await supabaseAdmin.from("credit_transactions").insert({
                    client_id: job.client_id,
                    action: "post_refund",
                    credits: -ACTION_CREDITS.post,
                    description: "Refund: generování selhalo",
                    reference_id: jobId,
                })
            } catch (refundErr: any) {
                console.error("Credit refund failed:", refundErr?.message)
            }
        }

        return NextResponse.json({ success: false, error: msg }, { status: 500 })
    }
}
