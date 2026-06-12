"use server"

import supabaseAdmin from "@/supabase/admin"
import { requireProjectAccess } from "@/lib/auth-guard"

export interface GrowthPoint {
    date: string // ISO
    followers: number
}

export interface GrowthData {
    /** Starting point from the onboarding scrape (igBaseline), if available */
    baseline: GrowthPoint | null
    /** Weekly cron snapshots, oldest first */
    snapshots: GrowthPoint[]
    /** Followers gained since baseline (or since first snapshot) */
    deltaSinceStart: number | null
    currentFollowers: number | null
}

/**
 * Growth dashboard data: igBaseline starting point + weekly ig_growth_snapshots.
 * Whether the user's plan includes the dashboard is decided in the UI
 * (subscription.growthTracking) — this just returns the data.
 */
export async function getGrowthData(projectSlug: string): Promise<{
    success: boolean
    data?: GrowthData
    error?: string
}> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        const { loadConfig } = await import("@/instagram/configs")
        const config = await loadConfig(projectSlug)
        const baseline: GrowthPoint | null = config.igBaseline?.followerCount
            ? { date: config.igBaseline.scrapedAt, followers: config.igBaseline.followerCount }
            : null

        const { data: rows, error } = await supabaseAdmin
            .from("ig_growth_snapshots")
            .select("follower_count, captured_at")
            .eq("client_id", clientId)
            .order("captured_at", { ascending: true })
            .limit(104) // ~2 years of weekly snapshots

        if (error) throw error

        const snapshots: GrowthPoint[] = (rows || []).map(r => ({
            date: r.captured_at,
            followers: r.follower_count,
        }))

        const current = snapshots.length > 0 ? snapshots[snapshots.length - 1].followers : null
        const start = baseline?.followers ?? (snapshots.length > 0 ? snapshots[0].followers : null)
        const deltaSinceStart = current !== null && start !== null ? current - start : null

        return {
            success: true,
            data: { baseline, snapshots, deltaSinceStart, currentFollowers: current },
        }
    } catch (err: any) {
        console.error("getGrowthData error:", err?.message)
        return { success: false, error: err?.message || "Failed to load growth data" }
    }
}
