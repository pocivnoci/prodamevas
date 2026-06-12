import { NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"

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

        // Media gating: reels only from the Růst tier up (admin bypass)
        let allowedMedia: string[] | undefined
        if (!isSuperAdmin) {
            const { getClientSubscription, canUseMedium } = await import("@/lib/subscription")
            const sub = await getClientSubscription(clientId)
            allowedMedia = sub?.features?.allowed_media
            if (body.medium === "reel" && !canUseMedium(sub?.features, "reel")) {
                return NextResponse.json(
                    { success: false, error: "Reels jsou dostupné od balíčku Růst.", featureBlocked: true, planRequired: "Růst" },
                    { status: 403 }
                )
            }
        }

        // Credit check + charge happen at job creation (not after generation) so two
        // parallel jobs can't both pass the check and spend the same credit.
        // ig-run-job refunds the charge if generation fails.
        let guard: Awaited<ReturnType<typeof import("@/app/actions/credit-guard").creditGuard>> | null = null
        if (!body.dryRun) {
            const { creditGuard } = await import("@/app/actions/credit-guard")
            guard = await creditGuard(body.configName, "post")
            if (!guard.ok) {
                return NextResponse.json(
                    { success: false, error: guard.error || "Nedostatek kreditů" },
                    { status: 402 }
                )
            }
        }

        const charged = body.dryRun ? "none" : (guard?.isPlanPost ? "plan" : "credits")

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
                    medium: body.medium,
                    customImageUrl: body.customImageUrl,
                    category: body.category,
                    campaignContext: body.campaignContext,
                    productId: body.productId,
                    charged,
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
