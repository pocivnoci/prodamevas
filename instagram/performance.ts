import supabase from "../supabase/admin"
import { getActiveProject } from "./service"
import type { ClientConfig } from "./configs/types"
import { engagementScore } from "../lib/engagement"

// ============================================
// TYPES
// ============================================

export interface PillarPerformance {
    avgScore: number
    bestPosts: string[]  // top hook excerpts
    topPatterns: string[]
}

export interface PerformanceInsight {
    bestPostTypes: string[]
    bestHooks: string[]
    bestTimeSlots: string[]
    avgEngagement: number
    topPatterns: string[]
    pillarPerformance?: Record<string, PillarPerformance>
    /** Measured engagement per FORMAT, keyed by ig_post_types.name (bestPostTypes are
     *  uuids — unusable against config format names, which is why nothing ever consumed
     *  them). Feeds the weighted format rotation in buildSmartWeekPlan. */
    typePerformance?: Record<string, { avgScore: number; posts: number }>
    conversionRate: number
    bestConvertingTypes: string[]
}

// ============================================
// HELPERS
// ============================================

/** Extract common patterns from captions */
export function extractPatterns(captions: string[]): string[] {
    const combined = captions.join(" ")
    const patterns: string[] = []
    if (combined.includes("POV:")) patterns.push("POV format")
    if (combined.includes("?")) patterns.push("Questions")
    if (combined.match(/\d+%/)) patterns.push("Percentages")
    if (combined.match(/\d+ hodin|\d+ minut/)) patterns.push("Time stats")
    if (combined.includes("Znáš ten pocit") || combined.includes("Taky")) patterns.push("Relatable")
    if (combined.includes("😅") || combined.includes("🫠")) patterns.push("Humor")
    return patterns
}

// ============================================
// MAIN ANALYZER
// ============================================

export async function analyzePerformance(
    config: ClientConfig,
    getPillarForType: (typeName: string) => string
): Promise<PerformanceInsight> {
    const { data: posts } = await supabase
        .from("ig_posts")
        .select("*")
        .eq("status", "posted")
        .eq("client_id", getActiveProject())
        .order("created_at", { ascending: false })
        .limit(50)

    const postedPosts = posts || []

    if (postedPosts.length === 0) {
        return {
            bestPostTypes: [],
            bestHooks: [],
            bestTimeSlots: [],
            avgEngagement: 0,
            topPatterns: [],
            conversionRate: 0,
            bestConvertingTypes: [],
        }
    }

    // Pre-fetch post type names for ID resolution
    const typeIds = [...new Set(postedPosts.map(p => p.post_type_id).filter(Boolean))]
    const postTypeNameMap: Record<string, string> = {}
    if (typeIds.length > 0) {
        const { data: postTypes } = await supabase
            .from("ig_post_types")
            .select("id, name")
            .in("id", typeIds)
        for (const pt of postTypes || []) {
            postTypeNameMap[pt.id] = pt.name
        }
    }

    // Calculate engagement + reach + conversion scores per post
    const scored = postedPosts.map(p => {
        const engagement = engagementScore(p)
        const reachScore = (p.saves || 0) * 5 + (p.shares || 0) * 8 + (p.reach || 0) * 0.01 + (p.comments || 0) * 2
        const conversionScore = (p.link_clicks || 0) * 10 + (p.profile_visits || 0) * 3 + (p.saves || 0)
        return { ...p, engagement, reachScore, conversionScore }
    })

    scored.sort((a, b) => b.engagement - a.engagement)

    // Find best post types
    const typeScores: Record<string, number[]> = {}
    for (const p of scored) {
        const typeId = p.post_type_id || "unknown"
        if (!typeScores[typeId]) typeScores[typeId] = []
        typeScores[typeId].push(p.engagement)
    }

    const typeAvgs = Object.entries(typeScores)
        .map(([id, scores]) => ({
            id,
            avg: scores.reduce((s, v) => s + v, 0) / scores.length,
        }))
        .sort((a, b) => b.avg - a.avg)

    // Extract hooks from top posts
    const topPosts = scored.slice(0, 5)
    const bestHooks = topPosts
        .map(p => p.caption?.split("\n")[0] || "")
        .filter(Boolean)

    // Best time slots
    const timeSlotScores: Record<string, number[]> = {}
    for (const p of scored) {
        const slot = p.time_slot || "afternoon"
        if (!timeSlotScores[slot]) timeSlotScores[slot] = []
        timeSlotScores[slot].push(p.engagement)
    }

    const bestTimeSlots = Object.entries(timeSlotScores)
        .map(([slot, scores]) => ({
            slot,
            avg: scores.reduce((s, v) => s + v, 0) / scores.length,
        }))
        .sort((a, b) => b.avg - a.avg)
        .slice(0, 2)
        .map(s => s.slot)

    // Detect patterns in top posts
    const patterns: string[] = []
    const topCaptions = topPosts.map(p => p.caption || "").join(" ")
    if (topCaptions.includes("POV:")) patterns.push("POV format")
    if (topCaptions.includes("?")) patterns.push("Questions in hook")
    if (topCaptions.includes("😅") || topCaptions.includes("🫠")) patterns.push("Self-deprecating humor")
    if (topCaptions.match(/\d+/)) patterns.push("Numbers/statistics")
    if (topCaptions.includes("Znáš ten pocit")) patterns.push("Relatable opening")

    // Per-pillar analysis
    const pillarData: Record<string, typeof scored> = Object.fromEntries(Object.keys(config.contentPillars).map(k => [k, []]))
    for (const p of scored) {
        const pillar = p.content_pillar || getPillarForType(postTypeNameMap[p.post_type_id] || "unknown")
        if (pillarData[pillar]) pillarData[pillar].push(p)
    }

    const buildPillarPerf = (posts: typeof scored): PillarPerformance => ({
        avgScore: posts.length > 0 ? posts.reduce((s, p) => s + p.engagement, 0) / posts.length : 0,
        bestPosts: posts.slice(0, 3).map(p => p.caption?.split("\n")[0]?.substring(0, 60) || ""),
        topPatterns: extractPatterns(posts.map(p => p.caption || "")),
    })

    // Conversion tracking
    const totalReach = scored.reduce((s, p) => s + (p.reach || 0), 0)
    const totalClicks = scored.reduce((s, p) => s + (p.link_clicks || 0), 0)
    const conversionRate = totalReach > 0 ? totalClicks / totalReach : 0

    // Best converting types
    const convertScoresByType: Record<string, number[]> = {}
    for (const p of scored) {
        const typeId = p.post_type_id || "unknown"
        if (!convertScoresByType[typeId]) convertScoresByType[typeId] = []
        convertScoresByType[typeId].push(p.conversionScore)
    }
    const bestConvertingTypes = Object.entries(convertScoresByType)
        .map(([id, scores]) => ({ id, avg: scores.reduce((s, v) => s + v, 0) / scores.length }))
        .sort((a, b) => b.avg - a.avg)
        .slice(0, 3)
        .map(t => t.id)

    return {
        bestPostTypes: typeAvgs.slice(0, 3).map(t => t.id),
        bestHooks,
        bestTimeSlots,
        avgEngagement: scored.reduce((s, p) => s + p.engagement, 0) / scored.length,
        topPatterns: patterns,
        pillarPerformance: Object.fromEntries(
            Object.keys(pillarData).map(k => [k, buildPillarPerf(pillarData[k])])
        ) as Record<string, PillarPerformance>,
        typePerformance: Object.fromEntries(
            typeAvgs
                .filter(t => postTypeNameMap[t.id])
                .map(t => [postTypeNameMap[t.id], { avgScore: t.avg, posts: typeScores[t.id].length }])
        ),
        conversionRate,
        bestConvertingTypes,
    }
}
