import { NextResponse } from "next/server"
import { setActiveProject, propagateMetricsToSources } from "@/instagram/service"
import { analyzeAndLearn } from "@/instagram/memory-agent"
import supabaseAdmin from "@/supabase/admin"

export const maxDuration = 60

/**
 * POST /api/ig-learn
 *
 * Triggers the full feedback loop:
 * 1. Propagate metrics → idea/review performance scores
 * 2. Run Memory Agent analyzeAndLearn() on posts with metrics
 * 
 * This is the "brain update" — call after entering post metrics.
 */
export async function POST(req: Request) {
    try {
        const body = await req.json()
        if (!body.configName) {
            return NextResponse.json({ success: false, error: "Missing configName" }, { status: 400 })
        }

        const { requireProjectAccess } = await import("@/lib/auth-guard")
        const { clientId } = await requireProjectAccess(body.configName)
        setActiveProject(clientId)

        // Step 1: Propagate metrics to ideas/reviews (Idea Ranker + Review Ranker)
        const { ideasUpdated, reviewsUpdated } = await propagateMetricsToSources()
        console.log(`📊 Metrics propagated: ${ideasUpdated} ideas, ${reviewsUpdated} reviews`)

        // Step 2: Get posts with metrics for Memory Agent
        const { data: posts } = await supabaseAdmin
            .from("ig_posts")
            .select("id, caption, post_type_id, likes, comments, saves, reach, shares, link_clicks")
            .eq("client_id", clientId)
            .eq("status", "posted")
            .not("likes", "is", null)
            .order("created_at", { ascending: false })
            .limit(20)

        let memoriesCreated = 0
        let memoriesUpdated = 0

        if (posts && posts.length >= 3) {
            // Resolve post type names
            const typeIds = [...new Set(posts.map(p => p.post_type_id).filter(Boolean))]
            const typeMap: Record<string, string> = {}
            if (typeIds.length > 0) {
                const { data: types } = await supabaseAdmin
                    .from("ig_post_types")
                    .select("id, name")
                    .in("id", typeIds)
                for (const t of types || []) typeMap[t.id] = t.name
            }

            const postsForLearning = posts.map(p => ({
                id: p.id,
                caption: p.caption || "",
                post_type_name: typeMap[p.post_type_id] || undefined,
                likes: p.likes || 0,
                comments: p.comments || 0,
                saves: p.saves || 0,
                reach: p.reach || 0,
                shares: p.shares || 0,
                link_clicks: p.link_clicks || 0,
            }))

            const result = await analyzeAndLearn(postsForLearning)
            memoriesCreated = result.memoriesCreated
            memoriesUpdated = result.memoriesUpdated
        }

        return NextResponse.json({
            success: true,
            feedback: {
                ideasUpdated,
                reviewsUpdated,
                memoriesCreated,
                memoriesUpdated,
                postsAnalyzed: posts?.length || 0,
            },
        })

    } catch (err: any) {
        console.error("ig-learn error:", err?.message)
        return NextResponse.json({ success: false, error: err?.message }, { status: 500 })
    }
}
