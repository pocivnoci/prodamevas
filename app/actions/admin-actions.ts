"use server"

import { REEL_MEDIA } from "@/lib/reel-media"
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
            .select("id, status, caption, image_url, media_type, created_at, scheduled_for, likes, comments, saves, reach, ig_post_types ( name, display_name, emoji )")
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
                media_type: p.media_type,
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

        const weekDays: { date: string; dayName: string; isToday: boolean; posts: { id: string; caption: string; image_url: string | null; media_type?: string | null; status: string; type_emoji: string }[] }[] = []
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
                media_type: p.media_type,
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
        // Filtr „reel" znamená obě velikosti — v UI je jeden štítek Reels.
        if (media) countQuery = media === "reel" ? countQuery.in("media_type", [...REEL_MEDIA]) : countQuery.eq("media_type", media)
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
                feedback, revision_of, image_style, edit_history, video_source,
                ig_post_types ( name, display_name, emoji )
            `)
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
            .range(from, to)

        if (statusFilter && statusFilter !== "all") {
            if (statusFilter === "draft") query = query.in("status", ["draft", "plan_draft"])
            else query = query.eq("status", statusFilter)
        }
        if (media) query = media === "reel" ? query.in("media_type", [...REEL_MEDIA]) : query.eq("media_type", media)

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
                .select("post_id, qa_status, fact_status, fact_flags, fact_sources, created_at")
                .in("post_id", posts.map(p => p.id))
                .order("created_at", { ascending: false })
            const qaByPost = new Map<string, string | null>()
            // Faktická brána jede stejnou cestou jako vizuální QA — jeden dotaz, dvě
            // varování na kartě: „obrázek neprošel" a „text si možná vymýšlí".
            const factByPost = new Map<string, { status: string | null; flags: string[] | null; sources: IGPost["fact_sources"] }>()
            for (const log of logs || []) {
                if (!qaByPost.has(log.post_id)) qaByPost.set(log.post_id, log.qa_status)
                if (!factByPost.has(log.post_id)) factByPost.set(log.post_id, { status: log.fact_status, flags: log.fact_flags, sources: log.fact_sources })
            }
            for (const post of posts) {
                post.qa_status = qaByPost.get(post.id) ?? null
                const fact = factByPost.get(post.id)
                post.fact_status = fact?.status ?? null
                post.fact_flags = fact?.flags ?? null
                post.fact_sources = fact?.sources ?? null
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

    // Admin/global view (no project): keep the deduped global set. Jen pro super
    // admina — bez slugu je to čtení přes VŠECHNY tenanty (názvy a AI popisy
    // cizích formátů), a přihlášení samo o sobě k tomu neopravňuje.
    if (!configName) {
        const { requireSuperAdmin } = await import("@/lib/auth-guard")
        try { await requireSuperAdmin() } catch { return [] }
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
export async function getAvailableIGClients(): Promise<{ id: string; clientId: string; name: string; icon: string; description: string }[]> {
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
                id, caption, image_url, media_type, status, likes, comments, saves,
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
        .select("id, client_id, subscription_id, amount, currency, provider, provider_ref, label, kind, credits_granted")
        .maybeSingle()

    if (!payment) {
        return { success: false, error: "Platba neexistuje, není zaplacená, nebo už byla vrácena." }
    }

    const steps: string[] = []

    // 1b. Dobití kreditů nemá subscription_id, takže krok 2 by ho minul: peníze zpět
    // A kredity by zůstaly. Storno je kladný řádek (spotřeba) proti zápornému
    // `credit_topup` z on-paid.ts; idempotentní přes index (action, reference_id).
    // Ledger klampuje `used` na ≥ 0, takže už utracené kredity se do mínusu nedostanou —
    // to je shovívavý směr a je vědomý.
    if (payment.kind === "credits" && Number(payment.credits_granted) > 0) {
        const { error } = await supabaseAdmin.from("credit_transactions").insert({
            client_id: payment.client_id,
            action: "credit_topup_refund",
            credits: Number(payment.credits_granted),
            description: `Storno dobití — platba ${payment.id} vrácena`,
            reference_id: payment.id,
        })
        if (error && error.code !== "23505") {
            steps.push(`⚠️ Odečíst ${payment.credits_granted} kreditů ručně — storno v ledgeru selhalo: ${error.message}`)
        } else {
            steps.push(`Kredity (${payment.credits_granted}) z tohoto dobití byly odečteny automaticky.`)
        }
    }

    // 1c. Zaplacená služba (nastavení značky): vrácené peníze = zrušená schůzka.
    // Řádek `consultations` z on-paid.ts jinak zůstane ve stavu 'paid' a brief ji
    // dál nabízí k zabookování. Zrušit jde jen dosud neproběhlou ('paid' / 'booked').
    if (payment.kind === "service") {
        const { data: cancelled } = await supabaseAdmin
            .from("consultations")
            .update({ status: "cancelled" })
            .eq("payment_id", payment.id)
            .in("status", ["entitled", "paid", "booked"])
            .select("id")
        if (cancelled?.length) steps.push("Schůzka k této platbě byla zrušena automaticky.")
    }

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

    // Formátování peněz má jediné místo (`formatCzk`) — ruční dělení stem se
    // pokaždé rozešlo se zbytkem aplikace v zaokrouhlení.
    const { formatCzkAmount } = await import("@/lib/pricing")
    const amountCzk = formatCzkAmount(payment.amount)

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

// ═══════════════════════════════════════════════════════════
// TARIF ZDARMA
// ═══════════════════════════════════════════════════════════

export interface GiftPlanResult {
    success: boolean
    error?: string
    message?: string
    /** Konec daru (ISO). */
    activeUntil?: string
}

/**
 * Placený tarif bez platby — obchod ho dává klientům na vyzkoušení. Jakýkoli
 * tarif z ceníku na jakékoli období z ceníku (1/3/6/12 měsíců).
 *
 * Dárek je předplatné s `provider='gift'`: nemá bránu, platbu ani doklad a nese
 * `cancel_at_period_end`, takže ho billing-worker na konci období ukončí stejně
 * jako výpověď — nikdy neupomíná a nikdy nestrhává (aserce 23.20). Kredity se
 * i u delšího daru obnovují měsíčně, stejně jako u předplaceného období.
 *
 * Aktivuje se toutéž cestou jako zaplacený tarif (`activatePaidPlan`): období,
 * kreditové okno, odemčení plánu i odstavení trialu. Druhá aktivační cesta by se
 * od první dřív nebo později rozešla.
 *
 * Nad živým předplatným se dárek nedává. `activatePaidPlan` odstavuje všechno
 * ostatní — u zaplaceného Stripe předplatného by zákazníkovi zrušil i to, co si
 * koupil, a druhý dárek by potichu smazal zbytek toho běžícího.
 */
export async function giftPlan(projectSlug: string, planId: string, termMonths: number): Promise<GiftPlanResult> {
    const { requireSuperAdmin } = await import("@/lib/auth-guard")
    let adminEmail: string
    try {
        adminEmail = (await requireSuperAdmin()).email
    } catch {
        return { success: false, error: "Tarif zdarma smí dát jen správce." }
    }

    const slug = projectSlug?.trim()
    if (!slug) return { success: false, error: "Chybí identifikace projektu." }

    // Období z ceníku, ne z vlastního výčtu: `term_months` má v DB CHECK na tytéž
    // hodnoty a cokoli jiného by spadlo až při zápisu.
    const { BILLING_TERMS } = await import("@/lib/pricing")
    const term = BILLING_TERMS.find(t => t.months === termMonths)
    if (!term) return { success: false, error: "Takové období v ceníku není." }

    const czDate = (iso: string) => new Date(iso).toLocaleDateString("cs-CZ", { timeZone: "Europe/Prague" })

    const { data: client } = await supabaseAdmin
        .from("clients")
        .select("id, name")
        .eq("slug", slug)
        .maybeSingle()
    if (!client) return { success: false, error: `Projekt „${slug}" neexistuje.` }

    const { data: plan } = await supabaseAdmin
        .from("subscription_plans")
        .select("id, name, price_czk")
        .eq("id", planId)
        .eq("is_active", true)
        .maybeSingle()
    // Jen placený tarif — trial se rozdává sám a dar z něj by nic neodemkl.
    if (!plan || !(plan.price_czk > 0)) return { success: false, error: "Takový placený tarif nenabízíme." }

    const { data: live } = await supabaseAdmin
        .from("subscriptions")
        .select("id, provider, current_period_end")
        .eq("client_id", client.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle()
    if (live) {
        const until = live.current_period_end ? ` do ${czDate(live.current_period_end)}` : ""
        return {
            success: false,
            error: live.provider === "gift"
                ? `${client.name} už tarif zdarma má${until}.`
                : `${client.name} má zaplacený tarif${until}. Zdarma jde dát až po jeho skončení.`,
        }
    }

    // Řádek vzniká jako `pending` a živým ho udělá až `activatePaidPlan` — stejně
    // jako u platby. Když aktivace selže, pending se před trial nepředřadí
    // (`pickLiveSubscription`), takže klient nepřijde o nic, co měl.
    const { data: gift, error: insertError } = await supabaseAdmin
        .from("subscriptions")
        .insert({
            client_id: client.id,
            plan_id: plan.id,
            status: "pending",
            provider: "gift",
            term_months: term.months,
            cancel_at_period_end: true,
        })
        .select("id")
        .single()
    if (insertError || !gift) {
        return { success: false, error: `Tarif zdarma se nepodařilo založit: ${insertError?.message || "neznámá chyba"}` }
    }

    try {
        const { activatePaidPlan } = await import("@/lib/subscription")
        await activatePaidPlan(client.id, plan.id, gift.id)
    } catch (err) {
        console.error(`🚨 giftPlan: aktivace selhala pro ${slug}: ${(err as Error)?.message}`)
    }

    // `activatePaidPlan` chyby zápisu nevyhazuje, takže o úspěchu rozhoduje řádek,
    // ne to, že funkce doběhla.
    const { data: activated } = await supabaseAdmin
        .from("subscriptions")
        .select("status, current_period_end")
        .eq("id", gift.id)
        .maybeSingle()
    if (activated?.status !== "active" || !activated.current_period_end) {
        const now = new Date().toISOString()
        await supabaseAdmin
            .from("subscriptions")
            .update({ status: "cancelled", cancelled_at: now, updated_at: now })
            .eq("id", gift.id)
            .eq("status", "pending")
        return { success: false, error: "Tarif se nepodařilo aktivovat. Nic se nezměnilo — zkus to prosím znovu." }
    }

    // Stopa, kdo co komu dal: dárek jsou peníze, které nepřišly.
    const { emit } = await import("@/lib/events")
    await emit("subscription.gifted", {
        clientId: client.id,
        payload: {
            subscriptionId: gift.id,
            planId: plan.id,
            termMonths: term.months,
            grantedBy: adminEmail,
            activeUntil: activated.current_period_end,
        },
    })

    console.log(`🎁 ${adminEmail} dal ${client.name} (${slug}) tarif ${plan.name} na ${term.months} měs. zdarma do ${activated.current_period_end}`)
    return {
        success: true,
        activeUntil: activated.current_period_end,
        message: `${client.name} má ${plan.name} zdarma do ${czDate(activated.current_period_end)}. Pak sám skončí — nic se nestrhne a klient si vybere, jestli pokračovat.`,
    }
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

/** Hrubá kontrola tvaru — překlep v adrese je tichá ztráta předání, ne chyba databáze. */
function looksLikeEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)
}

export interface ClientAccessRow {
    userId: string
    email: string
    role: string
    /** Ty sám — UI to musí umět odlišit, jinak si správce odpojí vlastní přístup naslepo. */
    isYou: boolean
}

export interface ClientPendingHandoff {
    id: string
    email: string
    createdAt: string
    /** Odkaz s kódem pozvánky. Když pošta selže, správce ho pošle sám. */
    inviteUrl: string | null
}

/**
 * Kdo dnes na značku vidí — vazby v `user_clients` plus sliby, které čekají na
 * první přihlášení. Bez toho by správce předával naslepo a nepoznal, že klient
 * má dva vlastníky nebo že pozvánka odešla už minulý týden.
 *
 * Super admin projekt vidí i bez vazby (`requireClientAccess`), takže „nikdo tu
 * není" je legitimní odpověď, ne chyba.
 */
export async function getClientAccess(projectSlug: string): Promise<{
    owners: ClientAccessRow[]
    pending: ClientPendingHandoff[]
    error?: string
}> {
    const { requireSuperAdmin } = await import("@/lib/auth-guard")
    let adminUserId: string
    try {
        adminUserId = (await requireSuperAdmin()).userId
    } catch {
        return { owners: [], pending: [], error: "Přístupy vidí jen správce." }
    }

    const slug = projectSlug?.trim()
    if (!slug) return { owners: [], pending: [], error: "Chybí identifikace projektu." }

    const { data: client } = await supabaseAdmin
        .from("clients")
        .select("id")
        .eq("slug", slug)
        .maybeSingle()
    if (!client) return { owners: [], pending: [], error: `Projekt „${slug}" neexistuje.` }

    const { data: links } = await supabaseAdmin
        .from("user_clients")
        .select("user_id, role")
        .eq("client_id", client.id)

    const owners: ClientAccessRow[] = []
    for (const link of links || []) {
        const { data } = await supabaseAdmin.auth.admin.getUserById(link.user_id)
        owners.push({
            userId: link.user_id,
            // Účet mohl být mezitím smazaný — vazba na osiřelé UUID je informace,
            // ne důvod řádek zamlčet.
            email: data?.user?.email || "(účet neexistuje)",
            role: link.role || "member",
            isYou: link.user_id === adminUserId,
        })
    }

    const { data: handoffs } = await supabaseAdmin
        .from("client_handoffs")
        .select("id, email, invite_code, created_at")
        .eq("client_id", client.id)
        .is("claimed_at", null)
        .is("cancelled_at", null)
        .order("created_at", { ascending: false })

    const { siteUrl } = await import("@/lib/mail/links")
    const pending: ClientPendingHandoff[] = (handoffs || []).map(h => ({
        id: h.id,
        email: h.email,
        createdAt: h.created_at,
        inviteUrl: handoffInviteUrl(siteUrl(), h.email, h.invite_code),
    }))

    return { owners, pending }
}

/** Registrace s předvyplněným e-mailem i kódem — jeden klik místo přepisování. */
function handoffInviteUrl(site: string, email: string, code: string | null): string | null {
    if (!code) return null
    return `${site}/register?code=${encodeURIComponent(code)}&email=${encodeURIComponent(email)}`
}

/**
 * Předá značku jejímu skutečnému majiteli — i když ještě nemá účet.
 *
 * Onboarding zapisuje `user_clients` s `user_id` toho, kdo průvodce spustil
 * (`app/onboarding/core.ts`). Když značku založí správce za zákazníka, patří
 * tím pádem správci — a zákazník ji ve svém dashboardu nevidí.
 *
 * Dvě cesty podle toho, jestli účet existuje:
 *  - **existuje** → vazba `user_clients` vznikne hned;
 *  - **neexistuje** → uloží se slib do `client_handoffs` a zákazníkovi odejde
 *    pozvánka s jednorázovým kódem. Vazba vznikne při jeho prvním přihlášení
 *    (`lib/handoff.ts`). Účet **nezakládáme** — obešlo by to potvrzení adresy
 *    i souhlasy.
 *
 * Vazba zároveň otevře betu: `enforceInviteGate` razítkuje `LEGACY` každému,
 * kdo má vazbu na klienta, a `HANDOFF` tomu, na koho čeká slib.
 */
export async function transferClientToUser(
    clientSlug: string,
    email: string,
    opts?: { releaseAdminAccess?: boolean; replaceOwners?: boolean },
): Promise<{ success: boolean; error?: string; message?: string; pending?: boolean; inviteUrl?: string | null }> {
    const { requireSuperAdmin } = await import("@/lib/auth-guard")
    let adminUserId: string
    try {
        adminUserId = (await requireSuperAdmin()).userId
    } catch {
        return { success: false, error: "Předat klienta smí jen správce." }
    }

    const slug = clientSlug?.trim()
    if (!slug) return { success: false, error: "Chybí identifikace projektu." }

    const targetEmail = (email || "").trim().toLowerCase()
    if (!looksLikeEmail(targetEmail)) return { success: false, error: "To nevypadá jako e-mailová adresa." }

    const { data: client } = await supabaseAdmin
        .from("clients")
        .select("id, name")
        .eq("slug", slug)
        .maybeSingle()
    if (!client) return { success: false, error: `Projekt „${slug}" neexistuje.` }

    const userId = await findUserIdByEmail(targetEmail)

    // ── Účet neexistuje → slíbíme předání a pošleme pozvánku ────────────────
    if (!userId) {
        const { stageHandoff } = await import("@/lib/handoff")
        const staged = await stageHandoff({ clientId: client.id, email: targetEmail, invitedBy: adminUserId })
        if (!staged.handoff) return { success: false, error: `Slib předání selhal: ${staged.error}` }

        const { siteUrl } = await import("@/lib/mail/links")
        const inviteUrl = handoffInviteUrl(siteUrl(), targetEmail, staged.handoff.invite_code)
        const sent = await sendHandoffInvite({
            to: targetEmail,
            brandName: client.name,
            inviteUrl,
            code: staged.handoff.invite_code,
        })

        console.log(`🤝 Projekt ${slug} slíben ${targetEmail} (účet zatím neexistuje, pozvánka ${sent ? "odeslána" : "NEODESLÁNA"})`)
        return {
            success: true,
            pending: true,
            inviteUrl,
            message: sent
                ? `${targetEmail} zatím nemá účet, tak jsme mu poslali pozvánku. ${client.name} mu přiletí do dashboardu, jakmile se poprvé přihlásí.`
                : `${targetEmail} zatím nemá účet a pozvánku se nepodařilo odeslat — pošli mu odkaz níž sám. ${client.name} mu přiletí do dashboardu při prvním přihlášení.`,
        }
    }

    if (userId === adminUserId) {
        return { success: false, error: "To je tvůj vlastní účet — předat jde jen na někoho jiného." }
    }

    const { error: linkError } = await supabaseAdmin
        .from("user_clients")
        .upsert({ user_id: userId, client_id: client.id, role: "owner" }, { onConflict: "user_id,client_id" })
    if (linkError) {
        return { success: false, error: `Předání selhalo: ${linkError.message}` }
    }

    // Staré sliby na tentýž projekt už nemají co plnit — jinak by se značka
    // podruhé „předala" komukoli, kdo se dostane ke starému e-mailu.
    await supabaseAdmin
        .from("client_handoffs")
        .update({ cancelled_at: new Date().toISOString() })
        .eq("client_id", client.id)
        .eq("email", targetEmail)
        .is("claimed_at", null)
        .is("cancelled_at", null)

    // Odpojení AŽ POTOM a jen na výslovné přání. Kdyby se mazalo dřív a upsert
    // selhal, zůstal by klient bez jediného vlastníka.
    let releasedNote = ""
    if (opts?.replaceOwners) {
        const { error } = await supabaseAdmin
            .from("user_clients")
            .delete()
            .eq("client_id", client.id)
            .neq("user_id", userId)
        if (error) console.warn(`transferClientToUser: dosavadní vlastníky se nepodařilo odpojit: ${error.message}`)
        else releasedNote = " Dosavadní vlastníci byli odpojení."
    } else if (opts?.releaseAdminAccess) {
        const { error } = await supabaseAdmin
            .from("user_clients")
            .delete()
            .eq("user_id", adminUserId)
            .eq("client_id", client.id)
        if (error) console.warn(`transferClientToUser: vazbu správce se nepodařilo zrušit: ${error.message}`)
        else releasedNote = " Ty už v seznamu projektů nejsi — jako správce se tam ale dostaneš dál."
    }

    await sendHandoffDone({ to: targetEmail, brandName: client.name })

    console.log(`🤝 Projekt ${slug} předán uživateli ${targetEmail}${releasedNote}`)
    return {
        success: true,
        message: `${client.name} je teď pod ${targetEmail}.${releasedNote}`,
    }
}

/**
 * Zruší slib, který ještě nikdo nevyzvedl. Kód pozvánky se zneplatní spolu s ním —
 * pozvánka, kterou správce vzal zpátky, nesmí dál otevírat betu.
 */
export async function cancelClientHandoff(projectSlug: string, handoffId: string): Promise<{ success: boolean; error?: string }> {
    const { requireSuperAdmin } = await import("@/lib/auth-guard")
    try {
        await requireSuperAdmin()
    } catch {
        return { success: false, error: "Rušit předání smí jen správce." }
    }
    if (!projectSlug?.trim() || !handoffId) return { success: false, error: "Chybí identifikace předání." }

    const { data: client } = await supabaseAdmin
        .from("clients")
        .select("id")
        .eq("slug", projectSlug.trim())
        .maybeSingle()
    if (!client) return { success: false, error: "Projekt neexistuje." }

    // Podmíněný claim i tady: mezi načtením seznamu a kliknutím se slib mohl
    // vyzvednout. Zrušit vyzvednuté předání by znamenalo tvrdit něco, co už neplatí.
    const { data: cancelled } = await supabaseAdmin
        .from("client_handoffs")
        .update({ cancelled_at: new Date().toISOString() })
        .eq("id", handoffId)
        .eq("client_id", client.id)
        .is("claimed_at", null)
        .is("cancelled_at", null)
        .select("invite_code")

    if (!cancelled?.length) return { success: false, error: "Předání už bylo vyzvednuté nebo zrušené." }

    const code = cancelled[0].invite_code
    if (code) await supabaseAdmin.from("invite_codes").update({ is_active: false }).eq("code", code)

    return { success: true }
}

/**
 * Pozvánka pro zákazníka bez účtu.
 *
 * Posílá se `sendEmail`, ne `sendNotification`: ta nikdy nevyhodí, takže by
 * správci hlásila „odesláno" i na neexistující klíč nebo neověřenou doménu —
 * a on by čekal na e-mail, který nikdy nevyjel. Tady se výsledek musí poznat,
 * protože podle něj UI nabízí odkaz ke zkopírování.
 */
async function sendHandoffInvite(opts: {
    to: string
    brandName: string
    inviteUrl: string | null
    code: string | null
}): Promise<boolean> {
    try {
        const { getTemplate } = await import("@/lib/mail/registry")
        const { siteUrl } = await import("@/lib/mail/links")
        const template = getTemplate("client_handoff")
        if (!template) throw new Error("šablona client_handoff chybí v registru")

        const { subject, html, text } = template.render({
            brandName: opts.brandName,
            code: opts.code || "",
            ctaUrl: opts.inviteUrl || `${siteUrl()}/register`,
        })
        const { sendEmail } = await import("@/lib/email")
        await sendEmail({ to: opts.to, subject, html, text })
        return true
    } catch (err) {
        console.warn(`handoff: pozvánku pro ${opts.to} se nepodařilo odeslat: ${(err as Error)?.message}`)
        return false
    }
}

/** Zákazník účet má — jen se mu v něm objevila značka. Ať ví proč. */
async function sendHandoffDone(opts: { to: string; brandName: string }): Promise<void> {
    try {
        const { getTemplate } = await import("@/lib/mail/registry")
        const { siteUrl } = await import("@/lib/mail/links")
        const template = getTemplate("client_handoff_done")
        if (!template) throw new Error("šablona client_handoff_done chybí v registru")

        const { subject, html, text } = template.render({
            brandName: opts.brandName,
            ctaUrl: `${siteUrl()}/dashboard/instagram`,
        })
        const { sendEmail } = await import("@/lib/email")
        await sendEmail({ to: opts.to, subject, html, text })
    } catch (err) {
        console.warn(`handoff: potvrzení pro ${opts.to} se nepodařilo odeslat: ${(err as Error)?.message}`)
    }
}
