import { NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"
import { isMediumType, type MediumType } from "@/lib/credits"

export const maxDuration = 10 // Fast — just creates a job record

/**
 * POST /api/ig-create-job
 *
 * Step 1 of 2: Creates a job record in DB and returns jobId immediately.
 * UI uses this jobId to start polling for progress.
 * Then calls /api/ig-run-job to actually run the generation.
 */
export async function POST(req: Request) {
    try {
        const body = await req.json()
        if (!body.configName) {
            return NextResponse.json({ success: false, error: "Missing configName" }, { status: 400 })
        }

        const { requireProjectAccess } = await import("@/lib/auth-guard")
        const { clientId, isSuperAdmin } = await requireProjectAccess(body.configName)

        // Rate limit: max 10 jobs per hour per client (admin bypass)
        const RATE_LIMIT_PER_HOUR = 10
        if (!isSuperAdmin) {
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
            const { count } = await supabaseAdmin
                .from("ig_jobs")
                .select("id", { count: "exact", head: true })
                .eq("client_id", clientId)
                .gte("created_at", oneHourAgo)

            if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
                return NextResponse.json(
                    { success: false, error: `Dosáhli jste limitu ${RATE_LIMIT_PER_HOUR} generování za hodinu. Zkuste to později.` },
                    { status: 429 }
                )
            }
        }

        // Explicitly picked idea must belong to this client — validated before any
        // credit charge so a stale/foreign id can't burn a credit.
        if (body.ideaId) {
            const { data: idea } = await supabaseAdmin
                .from("ig_post_ideas")
                .select("client_id")
                .eq("id", body.ideaId)
                .maybeSingle()
            if (!idea || idea.client_id !== clientId) {
                return NextResponse.json({ success: false, error: "Nápad nenalezen" }, { status: 400 })
            }
        }

        // Effective medium for billing: explicit request wins; otherwise the post type's
        // configured format. The engine can only clamp DOWN from this (chargedMedium cap
        // in generateOnePost), so the charge is always >= the delivered medium's cost —
        // any downward clamp is refunded via reconcileJobCharge in ig-run-job.
        let chargedMedium: MediumType = "image"
        if (isMediumType(body.medium)) {
            chargedMedium = body.medium
        } else if (body.type) {
            try {
                const { loadConfig } = await import("@/instagram/configs")
                const { getPostFormat } = await import("@/instagram/caption-generator")
                const config = await loadConfig(body.configName)
                chargedMedium = getPostFormat(config, body.type).medium
            } catch { /* keep image (cheapest) — engine will clamp to it */ }
        }
        // Kill-switches: never bill a medium the engine is globally forbidden to make.
        // The fallbacks must mirror applyFormatClamps in instagram/format-clamps.ts —
        // a mismatch charges for one medium and delivers another.
        if (process.env.REELS_ENABLED !== "1" && chargedMedium === "reel") chargedMedium = "carousel"
        if (process.env.STORIES_ENABLED !== "1" && chargedMedium === "story") chargedMedium = "image"

        // Media gating: reels only from the Růst tier up (admin bypass)
        let allowedMedia: string[] | undefined
        if (!isSuperAdmin) {
            const { getClientSubscription, canUseMedium } = await import("@/lib/subscription")
            const sub = await getClientSubscription(clientId)
            allowedMedia = sub?.features?.allowed_media
            if ((body.medium === "reel" || chargedMedium === "reel") && !canUseMedium(sub?.features, "reel")) {
                if (body.medium === "reel") {
                    return NextResponse.json(
                        { success: false, error: "Reels jsou dostupné od balíčku Růst.", featureBlocked: true, planRequired: "Růst" },
                        { status: 403 }
                    )
                }
                // Implicit reel (from post type) on a plan without reels — engine clamps
                // to carousel, so bill the carousel.
                chargedMedium = "carousel"
            }
            if ((body.medium === "story" || chargedMedium === "story") && !canUseMedium(sub?.features, "story")) {
                if (body.medium === "story") {
                    return NextResponse.json(
                        { success: false, error: "Stories nejsou v tomto balíčku dostupné.", featureBlocked: true, planRequired: "Start" },
                        { status: 403 }
                    )
                }
                // Implicit story (from post type) on a plan without stories — the engine
                // clamps to a single image, so bill the image.
                chargedMedium = "image"
            }
        }

        // Credit check + charge happen at job creation (not after generation) so two
        // parallel jobs can't both pass the check and spend the same credit.
        // ig-run-job refunds the charge if generation fails.
        let guard: Awaited<ReturnType<typeof import("@/app/actions/credit-guard").creditGuard>> | null = null
        if (!body.dryRun) {
            const { creditGuard } = await import("@/app/actions/credit-guard")
            guard = await creditGuard(body.configName, "post", undefined, chargedMedium)
            if (!guard.ok) {
                return NextResponse.json(
                    { success: false, error: guard.error || "Nedostatek kreditů" },
                    { status: 402 }
                )
            }
        }

        const charged = body.dryRun ? "none" : (guard?.isPlanPost ? "plan" : "credits")
        const chargedCredits = guard?.creditsRequired ?? 0

        const { data: job, error } = await supabaseAdmin
            .from("ig_jobs")
            .insert({
                client_id: clientId,
                config: {
                    configName: body.configName,
                    type: body.type,
                    topic: body.topic,
                    ideaId: body.ideaId,
                    dryRun: body.dryRun,
                    aspectRatio: body.aspectRatio,
                    medium: body.medium,
                    customImageUrl: body.customImageUrl,
                    category: body.category,
                    campaignContext: body.campaignContext,
                    productId: body.productId,
                    charged,
                    chargedCredits,
                    chargedMedium,
                    allowedMedia,
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

        // Charge now (plan counter or credits), referenced by jobId for idempotency
        if (guard) {
            try {
                await guard.commit(`Post (job ${job.id})`, job.id)
            } catch (chargeErr: any) {
                await supabaseAdmin.from("ig_jobs").delete().eq("id", job.id)
                console.error("ig-create-job charge failed:", chargeErr?.message)
                return NextResponse.json(
                    { success: false, error: "Nepodařilo se odečíst kredit. Zkuste to znovu." },
                    { status: 500 }
                )
            }
        }

        return NextResponse.json({ success: true, jobId: job.id })


    } catch (err: any) {
        const msg = err?.message?.substring(0, 500) || "Unknown error"
        console.error("ig-create-job error:", msg)
        return NextResponse.json({ success: false, error: msg }, { status: 500 })
    }
}
