"use server"

import supabaseAdmin from "@/supabase/admin"
import { requireProjectAccess, requireClientAccess } from "@/lib/auth-guard"
import type { IGPost, IGIdea, IGReview, IGPostType, IGGenerationLog } from "@/lib/types/database"

// ─── Instagram Actions ───────────────────────────────────────────────

// ─── Dashboard Stats (lightweight aggregate) ──────────────────────────

function computeQuickMetrics(posts: any[]) {
    const withMetrics = posts.filter(p => p.status === "posted" && (p.likes > 0 || p.comments > 0 || p.saves > 0))
    if (withMetrics.length < 2) return null
    const sum = (key: string) => withMetrics.reduce((acc, p) => acc + (p[key] || 0), 0)
    const avg = (key: string) => Math.round(sum(key) / withMetrics.length)
    const best = withMetrics.reduce((top, p) => {
        const eng = (p.likes || 0) + (p.comments || 0) * 3 + (p.saves || 0) * 2
        const topEng = (top.likes || 0) + (top.comments || 0) * 3 + (top.saves || 0) * 2
        return eng > topEng ? p : top
    }, withMetrics[0])
    return {
        postsWithMetrics: withMetrics.length,
        avgLikes: avg("likes"),
        avgComments: avg("comments"),
        avgSaves: avg("saves"),
        avgReach: avg("reach"),
        totalEngagement: sum("likes") + sum("comments") + sum("saves"),
        bestPostId: best.id,
        bestPostCaption: best.caption?.split("\n")[0]?.substring(0, 60) || "—",
    }
}

export async function getDashboardStats(projectSlug: string) {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        // Post counts by status (last 200 for accurate totals)
        const { data: posts } = await supabaseAdmin
            .from("ig_posts")
            .select("id, status, caption, image_url, created_at, scheduled_for, likes, comments, saves, reach, ig_post_types ( name, display_name, emoji )")
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
            .limit(200)

        const allPosts = posts || []
        const drafts = allPosts.filter(p => p.status === "draft").length
        const ready = allPosts.filter(p => p.status === "ready").length
        const posted = allPosts.filter(p => p.status === "posted").length

        // Idea count
        const { count: ideasCount } = await supabaseAdmin
            .from("ig_post_ideas")
            .select("id", { count: "exact", head: true })
            .eq("client_id", clientId)

        // Recent 6 posts with images
        const recentPosts = allPosts
            .filter(p => p.image_url)
            .slice(0, 6)
            .map(p => ({
                id: p.id,
                caption: p.caption?.split("\n")[0]?.substring(0, 80) || "—",
                image_url: p.image_url,
                status: p.status,
                created_at: p.created_at,
                type_name: (p.ig_post_types as any)?.display_name || "Post",
                type_emoji: (p.ig_post_types as any)?.emoji || "📸",
            }))

        // This week calendar (Mon-Sun)
        const now = new Date()
        const dayOfWeek = now.getDay() // 0=Sun
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
        const monday = new Date(now)
        monday.setDate(now.getDate() + mondayOffset)
        monday.setHours(0, 0, 0, 0)

        const weekDays: { date: string; dayName: string; isToday: boolean; posts: { id: string; caption: string; image_url: string | null; status: string; type_emoji: string }[] }[] = []
        const dayNames = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"]
        for (let i = 0; i < 7; i++) {
            const d = new Date(monday)
            d.setDate(monday.getDate() + i)
            const dateStr = d.toISOString().split("T")[0]
            const isToday = dateStr === now.toISOString().split("T")[0]
            // Match posts by scheduled_for or created_at date
            const dayPosts = allPosts.filter(p => {
                const postDate = (p.scheduled_for || p.created_at || "").split("T")[0]
                return postDate === dateStr
            }).slice(0, 2).map(p => ({
                id: p.id,
                caption: p.caption?.split("\n")[0]?.substring(0, 40) || "—",
                image_url: p.image_url,
                status: p.status,
                type_emoji: (p.ig_post_types as any)?.emoji || "📸",
            }))
            weekDays.push({ date: dateStr, dayName: dayNames[i], isToday, posts: dayPosts })
        }

        // Recent activity (last 5 events combining posts + gen logs)
        const { data: recentLogs } = await supabaseAdmin
            .from("ig_generation_log")
            .select("id, created_at, generation_time_ms, ig_posts ( caption, status )")
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
            .limit(5)

        const activity = (recentLogs || []).map(log => ({
            id: log.id,
            type: "generated" as const,
            caption: (log.ig_posts as any)?.caption?.split("\n")[0]?.substring(0, 60) || "Post",
            timeMs: log.generation_time_ms,
            created_at: log.created_at,
        }))

        // Post type distribution (for smart suggestions)
        const typeCounts: Record<string, { count: number; emoji: string; display_name: string }> = {}
        for (const p of allPosts) {
            const name = (p.ig_post_types as any)?.name || "unknown"
            if (!typeCounts[name]) {
                typeCounts[name] = {
                    count: 0,
                    emoji: (p.ig_post_types as any)?.emoji || "📸",
                    display_name: (p.ig_post_types as any)?.display_name || name,
                }
            }
            typeCounts[name].count++
        }

        // Posts this week / this month
        const weekStart = monday.toISOString()
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
        const postsThisWeek = allPosts.filter(p => p.created_at >= weekStart).length
        const postsThisMonth = allPosts.filter(p => p.created_at >= monthStart).length

        return {
            totalPosts: allPosts.length,
            drafts,
            ready,
            posted,
            ideas: ideasCount || 0,
            recentPosts,
            weekDays,
            activity,
            typeCounts,
            postsThisWeek,
            postsThisMonth,
            quickMetrics: computeQuickMetrics(allPosts),
        }
    } catch (err: any) {
        console.error("getDashboardStats error:", err?.message || err)
        return {
            totalPosts: 0, drafts: 0, ready: 0, posted: 0, ideas: 0,
            recentPosts: [], weekDays: [], activity: [], typeCounts: {},
            postsThisWeek: 0, postsThisMonth: 0,
            quickMetrics: null,
        }
    }
}

export async function getIGPostsList(
    statusFilter: string | undefined,
    projectSlug: string,
    page: number = 0,
    pageSize: number = 15
): Promise<{ posts: IGPost[]; total: number; hasMore: boolean }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        // Count total for pagination
        let countQuery = supabaseAdmin
            .from("ig_posts")
            .select("id", { count: "exact", head: true })
            .eq("client_id", clientId)
        if (statusFilter && statusFilter !== "all") {
            countQuery = countQuery.eq("status", statusFilter)
        }
        const { count } = await countQuery
        const total = count || 0

        // Fetch page
        const from = page * pageSize
        const to = from + pageSize - 1

        let query = supabaseAdmin
            .from("ig_posts")
            .select(`
                id, caption, hashtags, call_to_action, image_url, image_prompt,
                scheduled_for, time_slot, status, posted_at, likes, comments, saves,
                reach, shares, profile_visits, link_clicks, content_pillar,
                created_at, updated_at, client_id,
                media_type, ig_media_id, permalink, publish_error,
                feedback, revision_of,
                ig_post_types ( name, display_name, emoji )
            `)
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
            .range(from, to)

        if (statusFilter && statusFilter !== "all") {
            query = query.eq("status", statusFilter)
        }

        const { data, error } = await query
        if (error) {
            console.error("getIGPostsList error:", error.message)
            return { posts: [], total: 0, hasMore: false }
        }
        const posts = (data || []) as unknown as IGPost[]
        return { posts, total, hasMore: from + posts.length < total }
    } catch (err: any) {
        console.error("getIGPostsList exception:", err?.message || err)
        return { posts: [], total: 0, hasMore: false }
    }
}

/**
 * Profile chrome for the Instagram preview (FeedTab): real @handle, logo avatar,
 * and follower count, so the grid reads like the actual IG profile.
 */
export async function getProfilePreview(projectSlug: string): Promise<{
    handle: string | null
    avatarUrl: string | null
    followerCount: number | null
    postCount: number
}> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        // Handle: prefer the connected IG account, fall back to the configured handle.
        const { getConnectionMeta } = await import("@/instagram/ig-connection")
        const conn = await getConnectionMeta(clientId).catch(() => null)
        const { loadConfig } = await import("@/instagram/configs")
        const config = await loadConfig(projectSlug).catch(() => null)
        const handle = conn?.igUsername || config?.instagram || null

        // Avatar: brand logo in storage (FeedTab falls back to a post image on 404).
        const { data: logo } = supabaseAdmin.storage
            .from("audit-screenshots")
            .getPublicUrl(`client-assets/${projectSlug}/logo.png`)
        const avatarUrl = logo?.publicUrl || null

        // Follower count: latest growth snapshot, else onboarding baseline.
        const { data: snap } = await supabaseAdmin
            .from("ig_growth_snapshots")
            .select("follower_count")
            .eq("client_id", clientId)
            .order("captured_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        const followerCount = snap?.follower_count ?? config?.igBaseline?.followerCount ?? null

        const { count } = await supabaseAdmin
            .from("ig_posts")
            .select("id", { count: "exact", head: true })
            .eq("client_id", clientId)
            .not("image_url", "is", null)

        return { handle, avatarUrl, followerCount, postCount: count || 0 }
    } catch (err) {
        console.error("getProfilePreview error:", (err as Error)?.message || err)
        return { handle: null, avatarUrl: null, followerCount: null, postCount: 0 }
    }
}

/** Fetch editorial board conversation log for a post (stored in ig_jobs) */
export async function getEditorialLog(postId: string): Promise<{ role: string; action: string; summary: string }[]> {
    try {
        const { data } = await supabaseAdmin
            .from("ig_jobs")
            .select("editorial_log, client_id")
            .filter("result->>postId", "eq", postId)
            .order("created_at", { ascending: false })
            .limit(1)
            .single()
        if (!data) return []
        await requireClientAccess(data.client_id)
        return (data.editorial_log as any[]) || []
    } catch {
        return []
    }
}

export async function getIGIdeasList(projectSlug: string): Promise<IGIdea[]> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        const { data, error } = await supabaseAdmin
            .from("ig_post_ideas")
            .select("*")
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
            .limit(100)
        if (error) {
            console.error("getIGIdeasList error:", error.message)
            return []
        }
        return data || []
    } catch (err: any) {
        console.error("getIGIdeasList exception:", err?.message || err)
        return []
    }
}

export async function getIGReviewsList(projectSlug: string): Promise<IGReview[]> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        const { data, error } = await supabaseAdmin
            .from("ig_reviews")
            .select("*")
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
            .limit(100)
        if (error) {
            console.error("getIGReviewsList error:", error.message)
            return []
        }
        return data || []
    } catch (err: any) {
        console.error("getIGReviewsList exception:", err?.message || err)
        return []
    }
}

export async function updateIGReviewApproval(id: string, approved: boolean): Promise<{ success: boolean }> {
    try {
        const { data: review } = await supabaseAdmin
            .from("ig_reviews")
            .select("client_id")
            .eq("id", id)
            .single()
        if (!review) return { success: false }
        await requireClientAccess(review.client_id)

        const { error } = await supabaseAdmin
            .from("ig_reviews")
            .update({ is_approved: approved })
            .eq("id", id)
        return { success: !error }
    } catch {
        return { success: false }
    }
}

export async function getIGPostTypes(configName?: string): Promise<(IGPostType & { pillarId?: string | null })[]> {
    const dedupeByName = (rows: any[]) =>
        rows.filter((pt, i, self) => self.findIndex(t => t.name === pt.name) === i)

    // Admin/global view (no project): keep the deduped global set
    if (!configName) {
        const { requireAuth } = await import("@/lib/auth-guard")
        try { await requireAuth() } catch { return [] }
        const { data } = await supabaseAdmin.from("ig_post_types").select("*").order("name")
        return dedupeByName(data || [])
    }

    let clientId: string
    try { ({ clientId } = await requireProjectAccess(configName)) } catch { return [] }

    // Client-scoped rows = this brand's own (custom) formats. Filtering by
    // client_id stops cross-tenant bleed and surfaces brand-specific descriptions.
    const fetchClientRows = async () =>
        (await supabaseAdmin
            .from("ig_post_types").select("*").eq("client_id", clientId).order("name")).data || []

    let rows = await fetchClientRows()

    try {
        const { loadConfig, getPillarForPostType } = await import("@/instagram/configs")
        const config = await loadConfig(configName)

        if (rows.length === 0) {
            // Self-heal per-client from config — the SAME primitive the engine runs at
            // generation time (autopilot → ensurePostTypes). Never fall back to an
            // unfiltered/global ig_post_types query: that leaked other tenants' formats
            // into this brand's selector ("every client shows the same formats").
            const { ensurePostTypes } = await import("@/instagram/service")
            await ensurePostTypes(config, clientId)
            rows = await fetchClientRows()
        }

        if (config.postTypes && config.postTypes.length > 0) {
            rows = rows.filter(pt => config.postTypes!.includes(pt.name))
        }
        return rows.map(pt => ({ ...pt, pillarId: getPillarForPostType(config, pt.name) }))
    } catch (e) {
        console.error("Failed to load config for post type filtering:", e)
        return rows
    }
}

/**
 * Check if the current user is a super admin (SUPER_ADMIN_EMAILS).
 */
export async function checkIsAdmin(): Promise<boolean> {
    try {
        const { requireSuperAdmin } = await import("@/lib/auth-guard")
        await requireSuperAdmin()
        return true
    } catch {
        return false
    }
}

/**
 * Get available clients from config registry (for dashboard project selector)
 */
export async function getAvailableIGClients(): Promise<{ id: string; name: string; icon: string; description: string }[]> {
    const { getAvailableClients } = await import("@/instagram/configs")
    return getAvailableClients()
}

/**
 * Whether the logged-in user is a super admin (SUPER_ADMIN_EMAILS).
 * Used to gate admin-only UI (onboarding/waitlist nav). Defaults to false.
 */
export async function isCurrentUserSuperAdmin(): Promise<boolean> {
    const { createClient } = await import("@/supabase/server")
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) return false
    const admins = (process.env.SUPER_ADMIN_EMAILS || "").split(",").map(e => e.trim()).filter(Boolean)
    return admins.includes(user.email)
}

/**
 * Get post format specs for a client (aspect ratio, medium, overlay style per post type)
 */
export async function getIGPostFormats(configName: string): Promise<Record<string, { aspectRatio: string; medium: string; overlayStyle: string }>> {
    try {
        await requireProjectAccess(configName)
        const { loadConfig } = await import("@/instagram/configs")
        const { getPostFormat } = await import("@/instagram/caption-generator")
        const config = await loadConfig(configName)
        const formats: Record<string, { aspectRatio: string; medium: string; overlayStyle: string }> = {}

        for (const name of (config.postTypes || [])) {
            formats[name] = getPostFormat(config, name)
        }
        return formats
    } catch {
        return {}
    }
}

/**
 * Get content pillar categories for a client (used in Generate tab dropdown)
 */
export async function getIGCategories(configName: string): Promise<{ id: string; emoji: string; label: string; categories?: { id: string; emoji: string; label: string }[] }[]> {
    try {
        await requireProjectAccess(configName)
        const { loadConfig } = await import("@/instagram/configs")
        const config = await loadConfig(configName)
        if (!config.contentPillars) return []
        return Object.entries(config.contentPillars).map(([id, pillar]: [string, any]) => ({
            id,
            emoji: pillar.emoji || "📦",
            label: pillar.label || id,
            categories: pillar.categories?.map((c: any) => ({
                id: c.id,
                emoji: c.emoji || "📌",
                label: c.label || c.id,
            })) || [],
        }))
    } catch {
        return []
    }
}




export async function getIGGenerationLogs(limit = 50, projectSlug: string): Promise<IGGenerationLog[]> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        const { data, error } = await supabaseAdmin
            .from("ig_generation_log")
            .select(`
                id, prompt_used, model_used, tokens_used, generation_time_ms, error, created_at,
                ig_posts ( caption, status )
            `)
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
            .limit(limit)
        if (error) {
            console.error("getIGGenerationLogs error:", error.message)
            return []
        }
        // Partial select — client_id/post_id intentionally omitted
        return (data || []) as unknown as IGGenerationLog[]
    } catch (err: any) {
        console.error("getIGGenerationLogs exception:", err?.message || err)
        return []
    }
}

export async function updateIGPostStatus(postId: string, status: string): Promise<{ success: boolean }> {
    try {
        const { data: post } = await supabaseAdmin
            .from("ig_posts")
            .select("client_id")
            .eq("id", postId)
            .single()
        if (!post) return { success: false }
        await requireClientAccess(post.client_id)

        const { error } = await supabaseAdmin
            .from("ig_posts")
            .update({
                status,
                ...(status === "posted" ? { posted_at: new Date().toISOString() } : {}),
                updated_at: new Date().toISOString(),
            })
            .eq("id", postId)
        return { success: !error }
    } catch (err: any) {
        console.error("updateIGPostStatus error:", err?.message)
        return { success: false }
    }
}

export async function updateIGPostMetrics(
    postId: string,
    metrics: {
        likes: number
        comments: number
        saves: number
        reach: number
        shares: number
        profile_visits: number
        link_clicks: number
    }
): Promise<{ success: boolean }> {
    // Read client_id + previous metrics BEFORE the update — needed for the
    // ownership check and so the significance deltas compare old vs new values.
    const { data: post } = await supabaseAdmin
        .from("ig_posts")
        .select("client_id, likes, saves, comments")
        .eq("id", postId)
        .single()

    if (!post) return { success: false }
    try {
        await requireClientAccess(post.client_id)
    } catch {
        return { success: false }
    }

    const { error } = await supabaseAdmin
        .from("ig_posts")
        .update({
            ...metrics,
            updated_at: new Date().toISOString(),
        })
        .eq("id", postId)

    if (error) return { success: false }

    // ─── LEARNING TRIGGER ─────────────────────────────
    // After saving metrics, check if metrics changed significantly before triggering learning.
    // This prevents pointless re-analysis on trivial metric updates.
    try {
        // Only learn if metrics changed significantly
        const prevLikes = post?.likes || 0
        const prevSaves = post?.saves || 0
        const prevComments = post?.comments || 0
        const likesDelta = Math.abs(metrics.likes - prevLikes)
        const savesDelta = Math.abs(metrics.saves - prevSaves)
        const commentsDelta = Math.abs(metrics.comments - prevComments)
        const isSignificant = likesDelta >= 5 || savesDelta >= 2 || commentsDelta >= 3

        if (post?.client_id && isSignificant) {
            // Fetch all posted posts with metrics for this client
            const { data: postsWithMetrics } = await supabaseAdmin
                .from("ig_posts")
                .select("id, caption, likes, comments, saves, reach, shares, link_clicks, post_type_id, ig_post_types(name)")
                .eq("client_id", post.client_id)
                .eq("status", "posted")
                .not("likes", "is", null)
                .gt("likes", 0)
                .order("created_at", { ascending: false })
                .limit(30)

            if (postsWithMetrics && postsWithMetrics.length >= 3) {
                // Fire and forget — don't block the metrics save response.
                const learnData = postsWithMetrics.map(p => ({
                    id: p.id,
                    caption: p.caption || "",
                    post_type_name: (p.ig_post_types as any)?.name,
                    likes: p.likes || 0,
                    comments: p.comments || 0,
                    saves: p.saves || 0,
                    reach: p.reach || 0,
                    shares: p.shares || 0,
                    link_clicks: p.link_clicks || 0,
                }))

                // Emit the metrics.updated domain event — its subscriber runs the
                // SAME propagate + learn the metrics path used to call directly
                // (Fáze 4 event seam). Importing subscribers guarantees the handler
                // is registered before emit; waitUntil keeps the lambda alive for it.
                const { waitUntil } = await import("@vercel/functions")
                await import("@/lib/events/subscribers")
                const { emit } = await import("@/lib/events")
                waitUntil(
                    emit("metrics.updated", {
                        clientId: post.client_id,
                        payload: { learnData },
                    }).catch(err => console.warn("⚠️ metrics.updated emit failed (non-fatal):", err?.message)),
                )
            }
        }
    } catch (learnErr: any) {
        // Non-fatal — metrics were already saved successfully
        console.warn("⚠️ Learning check failed:", learnErr?.message)
    }

    return { success: true }
}

// ─── Performance Insights (Neural Brand Engine MVP) ──────────────────

export async function getPerformanceInsights(projectSlug: string) {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const { loadConfig } = await import("@/instagram/configs")
        const config = await loadConfig(projectSlug)

        // Set active project for performance.ts queries
        const { setActiveProject } = await import("@/instagram/service")
        setActiveProject(clientId)
        const { analyzePerformance } = await import("@/instagram/performance")

        // Map post type name → pillar key
        const getPillarForType = (typeName: string): string => {
            if (!config.contentPillars) return "unknown"
            for (const [key, pillar] of Object.entries(config.contentPillars)) {
                if ((pillar as any).postTypes?.includes(typeName)) return key
            }
            return "unknown"
        }

        const insights = await analyzePerformance(config, getPillarForType)

        // Fetch posted/ready posts with metrics for the manual input table
        const { data: posts } = await supabaseAdmin
            .from("ig_posts")
            .select(`
                id, caption, image_url, status, likes, comments, saves,
                reach, shares, profile_visits, link_clicks, content_pillar,
                posted_at, created_at,
                ig_post_types ( name, display_name, emoji )
            `)
            .eq("client_id", clientId)
            .in("status", ["posted", "ready"])
            .order("created_at", { ascending: false })
            .limit(30)

        // Pillar labels for UI
        const pillarLabels: Record<string, { emoji: string; label: string }> = {}
        if (config.contentPillars) {
            for (const [key, pillar] of Object.entries(config.contentPillars)) {
                pillarLabels[key] = { emoji: (pillar as any).emoji || "📊", label: (pillar as any).label || key }
            }
        }

        return { insights, posts: posts || [], pillarLabels }
    } catch (err: any) {
        console.error("getPerformanceInsights error:", err?.message || err)
        return {
            insights: {
                bestPostTypes: [],
                bestHooks: [],
                bestTimeSlots: [],
                avgEngagement: 0,
                topPatterns: [],
                conversionRate: 0,
                bestConvertingTypes: [],
            },
            posts: [],
            pillarLabels: {},
        }
    }
}

