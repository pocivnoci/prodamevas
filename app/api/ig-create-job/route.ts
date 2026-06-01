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
        const { requireAuth } = await import("@/lib/auth-guard")
        await requireAuth()

        const body = await req.json()

        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(body.configName || "mobilnamiru")

        // Rate limit: max 10 jobs per hour per client (admin bypass)
        const RATE_LIMIT_PER_HOUR = 10
        const { createClient } = await import("@/supabase/server")
        const supabaseUser = await createClient()
        const { data: { user } } = await supabaseUser.auth.getUser()
        const adminEmails = (process.env.SUPER_ADMIN_EMAILS || "").split(",").map(e => e.trim()).filter(Boolean)
        const isAdmin = adminEmails.includes(user?.email || "")

        if (!isAdmin) {
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

        // Credit check before creating job — don't waste resources if no credits
        if (!body.dryRun) {
            const { creditGuard } = await import("@/app/actions/credit-guard")
            const guard = await creditGuard(body.configName || "mobilnamiru", "post")
            if (!guard.ok) {
                return NextResponse.json(
                    { success: false, error: guard.error || "Nedostatek kreditů" },
                    { status: 402 }
                )
            }
        }

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

        return NextResponse.json({ success: true, jobId: job.id })


    } catch (err: any) {
        const msg = err?.message?.substring(0, 500) || "Unknown error"
        console.error("ig-create-job error:", msg)
        return NextResponse.json({ success: false, error: msg }, { status: 500 })
    }
}
