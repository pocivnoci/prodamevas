import { NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"

export const maxDuration = 800 // stejný strop jako /api/ig-run-job — dokončuje tentýž render

/**
 * GET /api/cron/job-resume
 *
 * Zvedá zakázky zaparkované kvůli nedostupné kvalitě (`lib/job-park.ts`).
 *
 * Proč to existuje: parkované joby uměl doteď dotáhnout **jen kampaňový worker**
 * (`/api/cron/campaign-worker`). Jednorázová zakázka z Generate tabu se rozjela,
 * až na ni uživatel klikl znovu — což u zadání „radši zítra, ale v top kvalitě"
 * nestačí. Tenhle sweep dělá totéž pro samostatné joby.
 *
 * ZÁBĚR JE PODMÍNĚNÝ CLAIM, ne insert (invariant z CLAUDE.md): řádek se bere přes
 * `UPDATE … WHERE id=? AND status='failed' AND retry_after<=now()`. Když claim
 * nevrátí řádek, job mezitím zvedl někdo jiný — a to je konec, ne důvod ho spustit
 * podruhé. Bez toho by dva souběžné ticky vyrobily dva posty za jeden kredit.
 *
 * Kredit se nepřeúčtovává: zaparkovaný job si původní platbu nese s sebou a
 * `generateOnePost` navazuje z caption checkpointu, takže druhý pokus stojí jen render.
 *
 * Auth: CRON_SECRET bearer (v cronu není uživatelská session).
 */
export async function GET(req: Request) {
    const secret = process.env.CRON_SECRET
    const auth = req.headers.get("authorization")
    if (!secret || auth !== `Bearer ${secret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const nowIso = new Date().toISOString()

    // Jeden job na tick. Render může trvat minuty a lambda má strop — dávkovat by
    // znamenalo riskovat, že se druhý job utne uprostřed. Cron běží po minutě,
    // takže fronta odteče stejně rychle a každý job dostane celý rozpočet.
    const { data: due } = await supabaseAdmin
        .from("ig_jobs")
        .select("id, client_id, config, result, retry_count")
        .eq("status", "failed")
        .not("retry_after", "is", null)
        .lte("retry_after", nowIso)
        .order("retry_after", { ascending: true })
        .limit(1)

    const job = due?.[0]
    if (!job) return NextResponse.json({ ok: true, resumed: 0 })

    // Podmíněný claim — vynulování `retry_after` je zároveň zámek.
    const { data: claimed } = await supabaseAdmin
        .from("ig_jobs")
        .update({ retry_after: null, agent_message: "♻️ Navazuji tam, kde jsme skončili..." })
        .eq("id", job.id)
        .eq("status", "failed")
        .not("retry_after", "is", null)
        .select("id")

    if (!claimed || claimed.length === 0) {
        console.log(`   ⏭️ job ${job.id} už zvedl někdo jiný — nechávám být`)
        return NextResponse.json({ ok: true, resumed: 0, raced: true })
    }

    const config = (job.config ?? {}) as Record<string, any>
    const resumeFrom = (job.result as any)?.checkpoint?.stage === "caption"
        ? (job.result as any).checkpoint
        : undefined

    console.log(`♻️ job-resume: pokus ${(job.retry_count ?? 0) + 1} u jobu ${job.id}${resumeFrom ? " (z caption checkpointu)" : ""}`)

    const updateJob = async (update: Record<string, any>) => {
        await supabaseAdmin.from("ig_jobs").update(update).eq("id", job.id)
    }

    try {
        const { generateOnePost } = await import("@/instagram/autopilot")
        const result = await generateOnePost({
            configName: config.configName,
            type: config.type,
            topic: config.topic,
            ideaId: config.ideaId,
            aspectRatio: config.aspectRatio,
            medium: config.medium,
            customImageUrl: config.customImageUrl,
            productId: config.productId,
            category: config.category,
            campaignContext: config.campaignContext,
            allowedMedia: config.allowedMedia,
            chargedMedium: config.chargedMedium,
            jobId: job.id,
            resumeFrom,
            onProgress: async (stage, progress, message) => {
                await updateJob({ status: stage, progress, agent_message: message })
            },
        })

        try {
            const { reconcileJobCharge } = await import("@/lib/subscription")
            await reconcileJobCharge(job.client_id, job.id, config.charged, config.chargedCredits, result.mediaType)
        } catch (reconErr: any) {
            console.error("job-resume: reconcile selhal:", reconErr?.message)
        }

        await updateJob({
            status: "done",
            progress: 100,
            agent_message: "✅ Hotovo!",
            retry_after: null,
            result: { success: true, postId: result.id, caption: result.caption, imageUrl: result.imageUrl, cost: result.cost },
        })

        console.log(`   ✅ job ${job.id} dokončen po odkladu`)
        return NextResponse.json({ ok: true, resumed: 1, jobId: job.id, postId: result.id })

    } catch (err: any) {
        const msg = err?.message?.substring(0, 500) || "Unknown error"
        const { isQualityUnavailable } = await import("@/utils/retry")

        if (isQualityUnavailable(err)) {
            const { parkJobForQuality } = await import("@/lib/job-park")
            const parked = await parkJobForQuality(job.id, job.retry_count ?? 0)
            if (parked) return NextResponse.json({ ok: true, resumed: 0, deferred: true, jobId: job.id })
            // Strop vyčerpán — propadne dolů na skutečné selhání.
        }

        console.error(`job-resume: job ${job.id} selhal — ${msg}`)
        await updateJob({ status: "failed", retry_after: null, agent_message: "❌ Generování selhalo", error: msg })

        try {
            const { refundJobCharge } = await import("@/lib/subscription")
            await refundJobCharge(job.client_id, job.id, config.charged, config.chargedCredits)
        } catch (refundErr: any) {
            console.error("job-resume: vrácení kreditu selhalo:", refundErr?.message)
        }

        return NextResponse.json({ ok: false, error: msg }, { status: 500 })
    }
}
