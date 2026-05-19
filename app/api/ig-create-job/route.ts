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

        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(body.configName || "mobilnamiru")

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
                    campaignContext: body.campaignContext,
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
