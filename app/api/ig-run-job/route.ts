import { NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"
import { generateOnePost } from "@/instagram/autopilot"

export const maxDuration = 800 // Vercel Pro cap (Fluid Compute). Full budget for the all-Pro generation pipeline.

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
            allowedMedia: config.allowedMedia,
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

        // Quality-unavailable = both Pro tiers overloaded. We deliberately did NOT degrade
        // to flash, so the post failed clean. Surface a retry-friendly message (no silent
        // low-quality post); the user can re-run when Pro frees up.
        const { isQualityUnavailable } = await import("@/utils/retry")
        const quality = isQualityUnavailable(err)

        try {
            const Sentry = await import("@sentry/nextjs")
            Sentry.captureException(err, { tags: { jobId, route: "ig-run-job", quality: String(quality) } })
        } catch { /* Sentry optional */ }

        await updateJob({
            status: "failed",
            agent_message: quality ? "⏸️ Pro enginy přetížené — zkuste to za chvíli" : "❌ Generování selhalo",
            error: quality ? "Pro enginy (gemini-pro-latest / gemini-2.5-pro) jsou momentálně přetížené. Kvalitní post se nevygeneroval — zkuste to prosím za pár minut." : msg,
        })

        // Refund the charge made at job creation (idempotent via unique index on action+reference_id)
        try {
            const { refundJobCharge } = await import("@/lib/subscription")
            await refundJobCharge(job.client_id, jobId, config.charged)
        } catch (refundErr: any) {
            console.error("Job charge refund failed:", refundErr?.message)
        }

        return NextResponse.json({ success: false, error: msg }, { status: 500 })
    }
}
