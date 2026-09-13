import { actionTranslator } from "@/lib/i18n/actions"
import { NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"
import { generateOnePost } from "@/instagram/autopilot"
import { RENDER_BUDGET_MS } from "@/lib/job-park"

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
        .select("config, client_id, status, result, retry_count")
        .eq("id", jobId)
        .single()

    if (!job) {
        return NextResponse.json({ success: false, error: "Job not found" }, { status: 404 })
    }

    // Checkpoint resume: re-POSTing a FAILED job that saved a caption checkpoint
    // re-runs only the visual phase (copywriter/critic/editorial are skipped).
    // The original failure already refunded the charge — no re-charge here.
    const resumeFrom = job.status === "failed" && (job.result as any)?.checkpoint?.stage === "caption"
        ? (job.result as any).checkpoint
        : undefined
    if (resumeFrom) console.log(`♻️ ig-run-job: resuming failed job ${jobId} from caption checkpoint`)

    // Ownership check: caller must have access to the client this job belongs to
    const { requireClientAccess } = await import("@/lib/auth-guard")
    try { await requireClientAccess(job.client_id) } catch { return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }) }

    const updateJob = async (update: Record<string, any>) => {
        await supabaseAdmin.from("ig_jobs").update(update).eq("id", jobId)
    }
    const t = await actionTranslator("api")

    const config = job.config as any

    // ── Druhý druh jobu: přerenderování titulků reelu ──
    // Jobs se rozlišují polem `config.kind` — chybějící hodnota je historická
    // generace příspěvku (`generateOnePost`). Rekompozice běží tudy, a ne přes
    // server action, protože ffmpeg u dvacetivteřinového reelu žere jednotky až
    // desítky sekund; server action má kratší strop než tahle routa (800 s).
    // Nestojí ŽÁDNÝ kredit: nevolá se Seedance, TTS ani jiný model, takže tu
    // není co účtovat, reconcilovat ani refundovat.
    if (config?.kind === "reel_recompose") {
        try {
            const { runReelRecompose } = await import("@/instagram/reel-recompose")
            const { imageUrl, cards } = await runReelRecompose(
                { clientId: job.client_id, postId: config.postId, cards: config.cards, subtitleStyle: config.subtitleStyle },
                async (progress, message) => { await updateJob({ status: "video", progress, agent_message: message }) },
            )
            await updateJob({
                status: "done", progress: 100, agent_message: t("job.subtitlesDone"), retry_after: null,
                result: { success: true, postId: config.postId, imageUrl, cards, cost: 0 },
            })
            return NextResponse.json({ success: true, jobId, postId: config.postId, imageUrl })
        } catch (err: any) {
            const msg = err?.message?.substring(0, 500) || "Unknown error"
            console.error("ig-run-job reel_recompose error:", msg)
            await updateJob({ status: "failed", agent_message: t("job.subtitlesFailed"), error: msg })
            return NextResponse.json({ success: false, error: msg }, { status: 500 })
        }
    }

    // Strop lambdy: reel podle něj krájí čekání na video a raději se zaparkuje,
    // než aby ho Vercel zabil uprostřed pollingu.
    const deadlineAt = Date.now() + RENDER_BUDGET_MS

    try {
        const result = await generateOnePost({
            configName: config.configName,
            type: config.type,
            topic: config.topic,
            ideaId: config.ideaId,
            dryRun: config.dryRun,
            aspectRatio: config.aspectRatio,
            medium: config.medium,
            customImageUrl: config.customImageUrl,
            productId: config.productId,
            category: config.category,
            campaignContext: config.campaignContext,
            allowedMedia: config.allowedMedia,
            chargedMedium: config.chargedMedium,
            jobId,
            resumeFrom,
            deadlineAt,
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

        // Credit was already charged in ig-create-job (referenced by jobId). If the
        // engine clamped the medium below what was billed (plan gating / kill-switch),
        // refund the difference — never bill a reel and deliver a carousel.
        try {
            const { reconcileJobCharge } = await import("@/lib/subscription")
            await reconcileJobCharge(job.client_id, jobId, config.charged, config.chargedCredits, result.mediaType)
        } catch (reconErr: any) {
            console.error("Job charge reconcile failed:", reconErr?.message)
        }

        await updateJob({
            status: "done",
            progress: 100,
            agent_message: t("job.done"),
            // Dokončený job už nikdy nesmí propadnout sweepu odložených zakázek.
            retry_after: null,
            result: {
                success: true,
                postId: result.id,
                caption: result.caption,
                imageUrl: result.imageUrl,
                cost: result.cost,
                // Médium, které skutečně vzniklo — UI podle něj vykreslí story jako
                // story a ne jako karusel (heuristika „víc URL = karusel" to nepozná).
                mediaType: result.mediaType,
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

        // Quality-unavailable = všechny Pro stupně vytížené. Vědomě NEDEGRADUJEME na
        // flash — místo toho se job ZAPARKUJE a dokončí se sám, až Pro uvolní.
        // Zadání znělo „radši zítra, ale v top kvalitě", takže tohle není selhání,
        // jen odklad: kredit zůstává (práce se dokončí) a `/api/cron/job-resume` job
        // zvedne z caption checkpointu, takže druhý pokus stojí jen render.
        const { isQualityUnavailable, isVideoPending } = await import("@/utils/retry")

        // Video u Seedance ještě renderuje a rozpočet lambdy došel. Není to selhání:
        // úloha běží a je zaplacená, job se zaparkuje na pár minut a job-resume ji
        // dopolluje z video checkpointu. Kredit zůstává, Sentry se neobtěžuje.
        if (isVideoPending(err)) {
            const { parkJobForVideo } = await import("@/lib/job-park")
            const parked = await parkJobForVideo(jobId)
            if (parked) {
                return NextResponse.json({
                    success: false, deferred: true, video: true, retryAfter: parked.retryAfter,
                    error: t("job.videoPending"),
                }, { status: 503 })
            }
        }

        const quality = isQualityUnavailable(err)

        if (quality) {
            const { parkJobForQuality } = await import("@/lib/job-park")
            const parked = await parkJobForQuality(jobId, (job as any).retry_count ?? 0)
            if (parked) {
                return NextResponse.json({ success: false, deferred: true, retryAfter: parked.retryAfter, error: msg }, { status: 503 })
            }
            // Strop pokusů vyčerpán — teprve teď je to opravdové selhání s vrácením kreditu.
        }

        try {
            const Sentry = await import("@sentry/nextjs")
            Sentry.captureException(err, { tags: { jobId, route: "ig-run-job", quality: String(quality) } })
        } catch { /* Sentry optional */ }

        await updateJob({
            status: "failed",
            agent_message: quality ? t("job.busy") : t("job.failed"),
            error: quality ? t("job.busyError") : msg,
        })

        // Refund the charge made at job creation (idempotent via unique index on action+reference_id)
        try {
            const { refundJobCharge } = await import("@/lib/subscription")
            await refundJobCharge(job.client_id, jobId, config.charged, config.chargedCredits)
        } catch (refundErr: any) {
            console.error("Job charge refund failed:", refundErr?.message)
        }

        return NextResponse.json({ success: false, error: msg }, { status: 500 })
    }
}
