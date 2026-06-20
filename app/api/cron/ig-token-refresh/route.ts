import { NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"
import { refreshConnection } from "@/instagram/ig-connection"

export const maxDuration = 800 // Vercel Pro cap (Fluid Compute)

/**
 * GET /api/cron/ig-token-refresh
 *
 * Daily Vercel cron (see vercel.json): IG long-lived tokens (~60 days) do NOT
 * auto-refresh, so we renew every connected tenant whose token expires within 7
 * days. Fail-open per tenant — one bad token must not kill the batch.
 *
 * Auth: CRON_SECRET bearer token (Vercel sends it automatically), not
 * requireAuth() — there is no user session in a cron invocation.
 */
export async function GET(req: Request) {
    const secret = process.env.CRON_SECRET
    const auth = req.headers.get("authorization")
    if (!secret || auth !== `Bearer ${secret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const cutoff = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: rows, error } = await supabaseAdmin
        .from("ig_connections")
        .select("client_id")
        .eq("provider", "instagram")
        .eq("status", "connected")
        .lt("token_expires_at", cutoff)

    if (error) {
        console.error("ig-token-refresh: query failed:", error.message)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    let refreshed = 0
    let failed = 0
    for (const row of rows || []) {
        try {
            const result = await refreshConnection(row.client_id)
            if (result.refreshed) refreshed++
            else failed++
        } catch (err) {
            console.warn(`ig-token-refresh: ${row.client_id} threw:`, (err as Error).message)
            failed++
        }
    }

    console.log(`🔁 IG token refresh: ${refreshed} refreshed, ${failed} failed`)
    return NextResponse.json({ success: true, refreshed, failed })
}
