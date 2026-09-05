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
        // plan_draft = legacy showcase-post status, treated as a normal draft
        const drafts = allPosts.filter(p => p.status === "draft" || p.status === "plan_draft").length
        const ready = allPosts.filter(p => p.status === "ready").length
        const posted = allPosts.filter(p => p.status === "posted").length

        // Idea count (active only — inactive ideas never enter selection)
        const { count: ideasCount } = await supabaseAdmin
            .from("ig_post_ideas")
            .select("id", { count: "exact", head: true })
            .eq("client_id", clientId)
            .eq("is_active", true)

        // Ideas actually available to the engine right now — mirrors the
        // getWeightedIdeas pool (active + out of each idea's cooldown window)
        const { data: ideaCooldowns } = await supabaseAdmin
            .from("ig_post_ideas")
            .select("last_used_at, cooldown_days")
            .eq("client_id", clientId)
            .eq("is_active", true)
        const nowMs = Date.now()
        const ideasAvailable = (ideaCooldowns || []).filter(i => {
            if (!i.last_used_at) return true
            return nowMs - new Date(i.last_used_at).getTime() > (i.cooldown_days ?? 90) * 86_400_000
        }).length

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
            ideasAvailable: ideasAvailable || 0,
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
            totalPosts: 0, drafts: 0, ready: 0, posted: 0, ideas: 0, ideasAvailable: 0,
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
    pageSize: number = 15,
    /** Filter by ig_posts.media_type ("story", "carousel"…). Applied server-side and to
     *  the count — filtering a 15-row page in the browser would drop most matches and
     *  look broken. Legacy rows have a NULL media_type and match nothing but "all". */
    mediaFilter?: string,
): Promise<{ posts: IGPost[]; total: number; hasMore: boolean }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const media = mediaFilter && mediaFilter !== "all" ? mediaFilter : undefined

        // Count total for pagination
        let countQuery = supabaseAdmin
            .from("ig_posts")
            .select("id", { count: "exact", head: true })
            .eq("client_id", clientId)
        if (statusFilter && statusFilter !== "all") {
            // Legacy plan_draft rows count as drafts
            if (statusFilter === "draft") countQuery = countQuery.in("status", ["draft", "plan_draft"])
            else countQuery = countQuery.eq("status", statusFilter)
        }
        if (media) countQuery = countQuery.eq("media_type", media)
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
                reach, shares, profile_visits, views, link_clicks, content_pillar,
                created_at, updated_at, client_id,
                media_type, ig_media_id, permalink, publish_error,
                feedback, revision_of, image_style, edit_history,
                ig_post_types ( name, display_name, emoji )
            `)
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
            .range(from, to)

        if (statusFilter && statusFilter !== "all") {
            if (statusFilter === "draft") query = query.in("status", ["draft", "plan_draft"])
            else query = query.eq("status", statusFilter)
        }
        if (media) query = query.eq("media_type", media)

        const { data, error } = await query
        if (error) {
            console.error("getIGPostsList error:", error.message)
            return { posts: [], total: 0, hasMore: false }
        }
        const posts = (data || []) as unknown as IGPost[]

        // Attach the native image QA outcome so the dashboard can flag a post whose image
        // never passed vision QA cleanly (diacritics/garbled text) before it gets published.
        // Separate query (not an embed) — ig_generation_log has no unique FK direction
        // guarantee worth risking on the hot list query; this is a cheap indexed lookup.
        if (posts.length > 0) {
            const { data: logs } = await supabaseAdmin
                .from("ig_generation_log")
                .select("post_id, qa_status, fact_status, fact_flags, created_at")
                .in("post_id", posts.map(p => p.id))
                .order("created_at", { ascending: false })
            const qaByPost = new Map<string, string | null>()
            // Faktická brána jede stejnou cestou jako vizuální QA — jeden dotaz, dvě
            // varování na kartě: „obrázek neprošel" a „text si možná vymýšlí".
            const factByPost = new Map<string, { status: string | null; flags: string[] | null }>()
            for (const log of logs || []) {
                if (!qaByPost.has(log.post_id)) qaByPost.set(log.post_id, log.qa_status)
                if (!factByPost.has(log.post_id)) factByPost.set(log.post_id, { status: log.fact_status, flags: log.fact_flags })
            }
            for (const post of posts) {
                post.qa_status = qaByPost.get(post.id) ?? null
                const fact = factByPost.get(post.id)
                post.fact_status = fact?.status ?? null
                post.fact_flags = fact?.flags ?? null
            }
        }

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
    const { isSuperAdminEmail } = await import("@/lib/super-admins")
    return isSuperAdminEmail(user.email)
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
    // Ownership check needs the post's client_id; the write + the (sacred) learning
    // trigger live in the session-less core, shared with the metrics-sync cron so
    // both the UI and the automatic sync fire the identical loop.
    const { data: post } = await supabaseAdmin
        .from("ig_posts")
        .select("client_id")
        .eq("id", postId)
        .single()
    if (!post) return { success: false }
    try {
        await requireClientAccess(post.client_id)
    } catch {
        return { success: false }
    }

    const { writeIGPostMetrics, fireMetricsLearning } = await import("@/instagram/metrics-sync")
    const w = await writeIGPostMetrics(postId, metrics)
    if (w.significant && w.clientId) await fireMetricsLearning(w.clientId)
    return { success: w.ok }
}

/**
 * On-demand: pull fresh metrics from the connected Instagram account for this
 * project and feed the learning loop. Session entry point with ownership check;
 * the daily cron calls syncPostMetrics(clientId) directly instead.
 */
export async function syncMetricsAction(
    projectSlug: string,
): Promise<{ success: boolean; synced?: number; matched?: number; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const { syncPostMetrics } = await import("@/instagram/metrics-sync")
        const r = await syncPostMetrics(clientId)
        return { success: true, synced: r.synced, matched: r.matched }
    } catch (err: any) {
        return { success: false, error: err?.message || "Synchronizace metrik selhala" }
    }
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

        // Ořez podle tarifu. Děje se to TEĎ a TADY — až za enginem: `analyzePerformance`
        // dodává tytéž závěry copywriterovi, a ořezat je i jemu by znamenalo horší
        // obsah pro levnější tarif. Tarif rozhoduje o tom, co zákazník vidí, ne o tom,
        // jak dobře se mu generuje (lib/analytics-depth.ts).
        const { getClientSubscription } = await import("@/lib/subscription")
        const { normalizeDepth, trimInsightsForDepth } = await import("@/lib/analytics-depth")
        const sub = await getClientSubscription(clientId)
        const depth = normalizeDepth(sub?.features?.analytics)
        const visibleInsights = trimInsightsForDepth(insights as unknown as Record<string, unknown>, depth)

        // Fetch posted/ready posts with metrics for the manual input table
        const { data: posts } = await supabaseAdmin
            .from("ig_posts")
            .select(`
                id, caption, image_url, status, likes, comments, saves,
                reach, shares, profile_visits, views, link_clicks, content_pillar,
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

        return { insights: visibleInsights, posts: posts || [], pillarLabels, analyticsDepth: depth }
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
            // Když se stav tarifu nepodařilo přečíst, nepředstírej plnou analytiku:
            // zamčená karta je pravdivější než prázdné závěry tvářící se jako měření.
            analyticsDepth: "basic" as const,
        }
    }
}


// ═══════════════════════════════════════════════════════════
// GARANCE VRÁCENÍ PENĚZ
// ═══════════════════════════════════════════════════════════

export interface RefundResult {
    success: boolean
    error?: string
    /** Kroky, které musí zakladatel dodělat ručně v portálech. */
    manualSteps?: string[]
}

/**
 * Zaznamená vrácení peněz podle garance 30 dnů (článek 9 obchodních podmínek).
 *
 * **Peníze tahle akce nevrací** — pohyb se dělá ručně v portálu brány a dobropis
 * ve Fakturoidu. Při dnešním objemu je poctivější ruční krok než napůl hotová
 * automatika, která by refundovala špatnou částku. Co ale ruční být NESMÍ, je
 * stav v naší databázi: kdyby platba zůstala PAID a předplatné aktivní, zákazník
 * má peníze zpátky a službu dál, a pozdní callback by mu ji ještě jednou aktivoval.
 *
 * Proto se tady dělá právě to, co ruční krok udělat neumí:
 *   1. podmíněný claim `PAID → REFUNDED` (dvojklik ani dva adminové nesmí
 *      vyrobit dvě vrácení),
 *   2. okamžité ukončení předplatného — na rozdíl od výpovědi, která nechává
 *      období doběhnout; tady se vrací celá částka, takže přístup končí hned,
 *   3. u Stripe zrušení předplatného i u brány, aby nefakturovala dál,
 *   4. připomínka se skutečnými kroky, ať se na dobropis nezapomene.
 *
 * Claim v `lib/payments/on-paid.ts` stav REFUNDED vylučuje stejně jako PAID —
 * bez toho by reconciler nebo opakovaný webhook platbu vzkřísil zpátky.
 */
export async function refundPayment(paymentId: string, reason?: string): Promise<RefundResult> {
    const { requireSuperAdmin } = await import("@/lib/auth-guard")
    let adminEmail: string
    try {
        adminEmail = (await requireSuperAdmin()).email
    } catch {
        return { success: false, error: "Vrácení peněz smí zadat jen správce." }
    }

    const now = new Date().toISOString()

    // 1. Podmíněný claim — vrátit se dá jen zaplacená platba, a jen jednou.
    const { data: payment } = await supabaseAdmin
        .from("payments")
        .update({
            status: "REFUNDED",
            refunded_at: now,
            refund_reason: reason?.slice(0, 500) || "Garance vrácení peněz do 30 dnů",
            updated_at: now,
        })
        .eq("id", paymentId)
        .eq("status", "PAID")
        .select("id, client_id, subscription_id, amount, currency, provider, provider_ref, label")
        .maybeSingle()

    if (!payment) {
        return { success: false, error: "Platba neexistuje, není zaplacená, nebo už byla vrácena." }
    }

    const steps: string[] = []

    // 2. Předplatné končí OKAMŽITĚ — peníze se vrací celé, ne poměrnou částí.
    let stripeRef: string | null = null
    if (payment.subscription_id) {
        const { data: sub } = await supabaseAdmin
            .from("subscriptions")
            .update({ status: "cancelled", cancelled_at: now, updated_at: now })
            .eq("id", payment.subscription_id)
            .in("status", ["active", "trialing", "pending"])
            .select("provider, provider_ref")
            .maybeSingle()
        stripeRef = sub?.provider === "stripe" ? sub.provider_ref : null
    }

    // 3. Stripe musí přestat fakturovat i na své straně.
    if (stripeRef) {
        try {
            const { getStripe } = await import("@/lib/payments/stripe")
            await getStripe().subscriptions.cancel(stripeRef)
        } catch (err: any) {
            // Stav u nás je správný, ale brána o tom neví — musí to vidět člověk.
            steps.push(`⚠️ Zrušit předplatné ${stripeRef} ručně v portálu brány (automaticky selhalo: ${err?.message})`)
        }
    }

    const amountCzk = Math.round(payment.amount / 100).toLocaleString("cs-CZ")

    // 3b. Peníze zpátky. U Stripu to jde přes API, takže se to nemá dělat ručně —
    // ruční krok znamená prodlevu a riziko, že se na něj zapomene, zatímco
    // předplatné už je ukončené a zákazník bez služby.
    //
    // ComGate se tudy neřeší: brána se opouští a poloviční automatika na cestě,
    // která má zmizet, je horší než jasný ruční krok.
    let refunded = false
    if (payment.provider === "stripe" && payment.provider_ref) {
        try {
            const { refundStripePayment } = await import("@/lib/payments/stripe-billing")
            const refundId = await refundStripePayment(payment.provider_ref, payment.amount)
            refunded = true
            console.log(`💸 Stripe refundace ${refundId} k platbě ${paymentId} (${amountCzk} Kč)`)
        } catch (err: any) {
            steps.push(
                `⚠️ Vrátit ${amountCzk} ${payment.currency || "CZK"} ručně v portálu Stripu ` +
                `(ref ${payment.provider_ref}) — automaticky selhalo: ${err?.message}`,
            )
        }
    } else {
        steps.push(
            `Vrátit ${amountCzk} ${payment.currency || "CZK"} v portálu brány (${payment.provider}, ref ${payment.provider_ref || paymentId})`,
        )
    }

    // Dobropis zůstává ruční záměrně: je to nevratný účetní doklad v číselné řadě
    // a jeho API se tu nikdy neověřilo. Špatně vystavený dobropis se opravuje hůř
    // než ten, který zatím není. Odkaz je konkrétní, aby se nehledal.
    const { data: doklad } = await supabaseAdmin
        .from("invoices")
        .select("number, public_url")
        .eq("payment_id", paymentId)
        .eq("status", "issued")
        .maybeSingle()
    steps.push(
        doklad?.number
            ? `Vystavit dobropis ve Fakturoidu k dokladu č. ${doklad.number}${doklad.public_url ? ` (${doklad.public_url})` : ""}`
            : `Vystavit dobropis ve Fakturoidu k dokladu za „${payment.label || "předplatné"}"`,
    )

    // 4. Připomínka s konkrétními kroky. Bez ní se na dobropis zapomene a
    // v účetnictví zůstane příjem, který na účtu není.
    try {
        const { sendNotification, siteUrl } = await import("@/lib/notifications")
        // Píše se tomu, kdo vrácení zadal — ten ty kroky taky dodělá.
        if (adminEmail) {
            await sendNotification({
                to: adminEmail,
                kind: "transactional",
                subject: refunded
                    ? `Vrácení peněz: ${amountCzk} Kč odesláno — zbývá dobropis`
                    : `Vrácení peněz: ${amountCzk} Kč — zbývají ruční kroky`,
                body: `Platba <strong>${paymentId}</strong> je v systému označená jako vrácená a předplatné je ukončené.${refunded ? `\n\n<strong>Peníze už jsou na cestě zpět</strong> — refundace u Stripu proběhla automaticky.` : ""}

Zbývá dodělat ručně:
${steps.map(s => `• ${s}`).join("\n")}

Důvod: ${reason || "garance vrácení peněz do 30 dnů"}

<a href="${siteUrl()}/dashboard/instagram">Otevřít studio →</a>`,
            })
        }
    } catch (err: any) {
        console.warn(`refundPayment: připomínka se neodeslala: ${err?.message}`)
    }

    console.log(
        `💸 Platba ${paymentId} vrácena (${amountCzk} Kč) — ` +
        `${refunded ? "peníze odeslány automaticky, zbývá dobropis" : "zbývají ruční kroky v bráně a ve Fakturoidu"}`,
    )
    return { success: true, manualSteps: steps }
}

// ─── Předání klienta zákazníkovi ──────────────────────────────────────

/**
 * Uživatel podle e-mailu.
 *
 * `listUsers` je stránkované a Supabase Admin API dotaz „podle e-mailu" nemá.
 * Tentýž průchod je i v `scripts/reset-password.ts` a `cleanup-orphan-links.ts` —
 * až přibude třetí volající v `app/`, patří to do sdíleného modulu, ne do
 * čtvrté kopie.
 */
async function findUserIdByEmail(email: string): Promise<string | null> {
    const needle = email.trim().toLowerCase()
    if (!needle) return null
    for (let page = 1; page <= 20; page++) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 })
        if (error || !data) return null
        const hit = data.users.find(u => u.email?.toLowerCase() === needle)
        if (hit) return hit.id
        if (data.users.length < 1000) return null
    }
    return null
}

/**
 * Předá onboardovanou značku jejímu skutečnému majiteli.
 *
 * Onboarding zapisuje `user_clients` s `user_id` toho, kdo průvodce spustil
 * (`app/onboarding/core.ts`). Když značku založí správce za zákazníka, patří
 * tím pádem správci — a zákazník ji ve svém dashboardu nevidí. Do 9/2026 na to
 * neexistovalo žádné UI a jediná cesta byl ruční INSERT do databáze.
 *
 * Přidání řádku zároveň otevře betu: `enforceInviteGate` razítkuje `LEGACY`
 * každému, kdo má vazbu na klienta, takže zákazník nepotřebuje kód pozvánky.
 *
 * Účet musí existovat — účty se zakládají registrací, ne odsud. Když e-mail
 * nikoho nenajde, je to konec a řekne se to nahlas; tiché založení účtu by
 * obešlo potvrzení adresy i souhlasy.
 */
export async function transferClientToUser(
    clientSlug: string,
    email: string,
    opts?: { releaseAdminAccess?: boolean },
): Promise<{ success: boolean; error?: string; message?: string }> {
    const { requireSuperAdmin } = await import("@/lib/auth-guard")
    let adminUserId: string
    try {
        adminUserId = (await requireSuperAdmin()).userId
    } catch {
        return { success: false, error: "Předat klienta smí jen správce." }
    }

    const slug = clientSlug?.trim()
    if (!slug) return { success: false, error: "Chybí identifikace projektu." }

    const { data: client } = await supabaseAdmin
        .from("clients")
        .select("id, name")
        .eq("slug", slug)
        .maybeSingle()
    if (!client) return { success: false, error: `Projekt „${slug}" neexistuje.` }

    const userId = await findUserIdByEmail(email)
    if (!userId) {
        return {
            success: false,
            error: `Účet ${email} neexistuje. Nejdřív mu pošli pozvánku a nech ho zaregistrovat, pak předej znovu.`,
        }
    }

    if (userId === adminUserId) {
        return { success: false, error: "Tenhle účet projekt už vlastní — to je tvůj vlastní." }
    }

    const { error: linkError } = await supabaseAdmin
        .from("user_clients")
        .upsert({ user_id: userId, client_id: client.id, role: "owner" }, { onConflict: "user_id,client_id" })
    if (linkError) {
        return { success: false, error: `Předání selhalo: ${linkError.message}` }
    }

    // Vazba správce se ruší AŽ POTOM a jen na výslovné přání. Kdyby se mazala
    // dřív a upsert selhal, zůstal by klient bez jediného vlastníka.
    let released = false
    if (opts?.releaseAdminAccess) {
        const { error } = await supabaseAdmin
            .from("user_clients")
            .delete()
            .eq("user_id", adminUserId)
            .eq("client_id", client.id)
        if (error) console.warn(`transferClientToUser: vazbu správce se nepodařilo zrušit: ${error.message}`)
        else released = true
    }

    console.log(`🤝 Projekt ${slug} předán uživateli ${email}${released ? " (správce se odpojil)" : ""}`)
    return {
        success: true,
        message: released
            ? `${client.name} je teď ${email}. Ty už v seznamu projektů nejsi — jako správce se tam ale dostaneš dál.`
            : `${client.name} je teď i pod ${email}. Zůstáváš připojený taky.`,
    }
}
