import { NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"

export const maxDuration = 10 // Fast — just creates a job

/**
 * POST /api/ig-generate
 * 
 * Creates an async generation job and self-triggers the worker.
 * Returns immediately with a jobId for the client to poll.
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

        // Self-trigger worker (fire-and-forget)
        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL
            || process.env.VERCEL_URL
                ? `https://${process.env.VERCEL_URL}`
                : "http://localhost:3000"

        fetch(`${baseUrl}/api/ig-worker`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId: job.id }),
        }).catch(err => {
            // Non-fatal — worker can also be triggered by cron
            console.warn("Self-trigger failed (non-fatal):", err.message)
        })

        return NextResponse.json({
            success: true,
            jobId: job.id,
        })
    } catch (err: any) {
        console.error("IG generate API error:", err?.message)
        return NextResponse.json({
            success: false,
            error: err?.message?.substring(0, 500) || "Unknown error",
        }, { status: 500 })
    }
}
