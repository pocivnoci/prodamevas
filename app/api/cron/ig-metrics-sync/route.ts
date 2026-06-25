import { NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"
import { syncPostMetrics } from "@/instagram/metrics-sync"

export const maxDuration = 800 // Vercel Pro cap (Fluid Compute)

/**
 * GET /api/cron/ig-metrics-sync
 *
 * Daily Vercel cron (see vercel.json): for every connected Instagram account, pull
 * fresh post insights and feed the metrics→learning loop (roadmap step 3). Fail-open
 * per tenant — one bad connection must not kill the batch. The manual
 * MetricsInputForm remains the fallback for unconnected accounts.
 *
 * Auth: CRON_SECRET bearer token (Vercel sends it automatically), not requireAuth()
 * — there is no user session in a cron invocation.
 */
export async function GET(req: Request) {
    const secret = process.env.CRON_SECRET
    const auth = req.headers.get("authorization")
    if (!secret || auth !== `Bearer ${secret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: rows, error } = await supabaseAdmin
        .from("ig_connections")
        .select("client_id")
        .eq("provider", "instagram")
        .eq("status", "connected")

    if (error) {
        console.error("ig-metrics-sync: query failed:", error.message)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    let synced = 0
    let matched = 0
    let clients = 0
    for (const row of rows || []) {
        try {
            const r = await syncPostMetrics(row.client_id)
            synced += r.synced
            matched += r.matched
            clients++
        } catch (err) {
            console.warn(`ig-metrics-sync: ${row.client_id} threw:`, (err as Error).message)
        }
    }

    console.log(`📊 IG metrics sync: ${clients} clients, ${synced} posts synced, ${matched} linked`)
    return NextResponse.json({ success: true, clients, synced, matched })
}
