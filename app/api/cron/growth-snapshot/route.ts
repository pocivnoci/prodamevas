import { NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"
import { fetchInstagramProfile } from "@/lib/ig-scraper"

export const maxDuration = 800 // Vercel Pro cap (Fluid Compute)

/**
 * GET /api/cron/growth-snapshot
 *
 * Weekly Vercel cron (Monday 06:00 UTC, see vercel.json): snapshots the
 * follower count of every client whose active plan includes growth_tracking
 * (Růst, Dominance) into ig_growth_snapshots. Powers the growth dashboard.
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

    // Active subscriptions + plan features + client config (for the IG handle)
    const { data: subs, error } = await supabaseAdmin
        .from("subscriptions")
        .select("client_id, subscription_plans(features), clients(slug, config)")
        .eq("status", "active")

    if (error) {
        console.error("growth-snapshot: subscriptions query failed:", error.message)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    let captured = 0
    let skipped = 0
    const seen = new Set<string>()

    for (const sub of subs || []) {
        const clientId = sub.client_id
        if (!clientId || seen.has(clientId)) continue
        seen.add(clientId)

        const features = (sub.subscription_plans as any)?.features
        if (!features?.growth_tracking) { skipped++; continue }

        const handle = (sub.clients as any)?.config?.instagram as string | undefined
        if (!handle) { skipped++; continue }

        try {
            // Profile only — no posts fetch needed for a follower snapshot
            const profile = await fetchInstagramProfile(handle, { includePosts: false })
            if (!profile || !profile.followerCount) { skipped++; continue }

            await supabaseAdmin.from("ig_growth_snapshots").insert({
                client_id: clientId,
                follower_count: profile.followerCount,
                following_count: profile.followingCount || null,
                media_count: profile.mediaCount || null,
            })
            captured++
        } catch (err) {
            // Fail-open per client — one broken handle must not kill the batch
            console.warn(`growth-snapshot: ${(sub.clients as any)?.slug || clientId} failed:`, (err as Error).message)
            skipped++
        }
    }

    console.log(`📈 Growth snapshot: ${captured} captured, ${skipped} skipped`)
    return NextResponse.json({ success: true, captured, skipped })
}
