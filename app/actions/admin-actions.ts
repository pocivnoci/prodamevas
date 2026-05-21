"use server"

import supabaseAdmin from "@/supabase/admin"

// ─── Instagram Actions ───────────────────────────────────────────────

// ─── Dashboard Stats (lightweight aggregate) ──────────────────────────

export async function getDashboardStats(projectSlug: string) {
    try {
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(projectSlug)

        // Post counts by status (last 200 for accurate totals)
        const { data: posts } = await supabaseAdmin
            .from("ig_posts")
            .select("id, status, caption, image_url, created_at, scheduled_for, ig_post_types ( name, display_name, emoji )")
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
        }
    } catch (err: any) {
        console.error("getDashboardStats error:", err?.message || err)
        return {
            totalPosts: 0, drafts: 0, ready: 0, posted: 0, ideas: 0,
            recentPosts: [], weekDays: [], activity: [], typeCounts: {},
            postsThisWeek: 0, postsThisMonth: 0,
        }
    }
}

export async function getIGPostsList(
    statusFilter?: string,
    projectSlug: string = "mobilnamiru",
    page: number = 0,
    pageSize: number = 15
): Promise<{ posts: any[]; total: number; hasMore: boolean }> {
    try {
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(projectSlug)

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
        const posts = data || []
        return { posts, total, hasMore: from + posts.length < total }
    } catch (err: any) {
        console.error("getIGPostsList exception:", err?.message || err)
        return { posts: [], total: 0, hasMore: false }
    }
}

export async function getIGIdeasList(projectSlug: string = "mobilnamiru"): Promise<any[]> {
    try {
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(projectSlug)

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

export async function getIGReviewsList(projectSlug: string = "mobilnamiru"): Promise<any[]> {
    try {
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(projectSlug)

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
    const { error } = await supabaseAdmin
        .from("ig_reviews")
        .update({ is_approved: approved })
        .eq("id", id)
    return { success: !error }
}

export async function getIGPostTypes(configName?: string): Promise<any[]> {
    const { data } = await supabaseAdmin
        .from("ig_post_types")
        .select("*")
        .order("name")
    const allTypes = (data || []).filter(
        (pt: any, index: number, self: any[]) => self.findIndex((t: any) => t.name === pt.name) === index
    )

    // Filter by client's postTypes if config specified
    if (configName) {
        try {
            const { loadConfig, getPillarForPostType } = await import("@/instagram/configs")
            const config = await loadConfig(configName)
            if (config.postTypes && config.postTypes.length > 0) {
                return allTypes
                    .filter(pt => config.postTypes!.includes(pt.name))
                    .map(pt => ({
                        ...pt,
                        pillarId: getPillarForPostType(config, pt.name)
                    }))
            }
        } catch (e) {
            console.error("Failed to load config for post type filtering:", e)
        }
    }

    return allTypes
}

/**
 * Get available clients from config registry (for dashboard project selector)
 */
export async function getAvailableIGClients(): Promise<{ id: string; name: string; icon: string; description: string }[]> {
    const { getAvailableClients } = await import("@/instagram/configs")
    return getAvailableClients()
}

/**
 * Get post format specs for a client (aspect ratio, medium, overlay style per post type)
 */
export async function getIGPostFormats(configName: string): Promise<Record<string, { aspectRatio: string; medium: string; overlayStyle: string }>> {
    try {
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
export async function getIGCategories(configName: string): Promise<{ id: string; emoji: string; label: string }[]> {
    try {
        const { loadConfig } = await import("@/instagram/configs")
        const config = await loadConfig(configName)
        if (!config.contentPillars) return []
        return Object.entries(config.contentPillars).map(([id, pillar]: [string, any]) => ({
            id,
            emoji: pillar.emoji || "📦",
            label: pillar.label || id,
        }))
    } catch {
        return []
    }
}




export async function getIGGenerationLogs(limit = 50, projectSlug: string = "mobilnamiru"): Promise<any[]> {
    try {
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(projectSlug)

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
        return data || []
    } catch (err: any) {
        console.error("getIGGenerationLogs exception:", err?.message || err)
        return []
    }
}

export async function getIGCalendar(startDate: string, endDate: string): Promise<any[]> {
    try {
        const { data } = await supabaseAdmin
            .from("ig_content_calendar")
            .select(`
                id, date, time_slot, notes, created_at,
                ig_posts ( id, caption, status, image_url ),
                ig_post_types ( name, display_name, emoji )
            `)
            .gte("date", startDate)
            .lte("date", endDate)
            .order("date", { ascending: true })
        return data || []
    } catch (err: any) {
        console.error("getIGCalendar error:", err?.message)
        return []
    }
}

export async function updateIGPostStatus(postId: string, status: string): Promise<{ success: boolean }> {
    try {
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
    const { error } = await supabaseAdmin
        .from("ig_posts")
        .update({
            ...metrics,
            updated_at: new Date().toISOString(),
        })
        .eq("id", postId)

    if (error) return { success: false }

    // ─── LEARNING TRIGGER ─────────────────────────────
    // After saving metrics, check if we have enough data to learn from.
    // If 3+ posted posts have metrics, trigger the memory agent to analyze
    // patterns and write to ig_brand_memory for future post generation.
    try {
        // Get client_id from the post we just updated
        const { data: post } = await supabaseAdmin
            .from("ig_posts")
            .select("client_id")
            .eq("id", postId)
            .single()

        if (post?.client_id) {
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
                // Fire and forget — don't block the metrics save response
                const { setActiveProject } = await import("@/instagram/service")
                const { analyzeAndLearn } = await import("@/instagram/memory-agent")
                setActiveProject(post.client_id)

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

                analyzeAndLearn(learnData).then(result => {
                    if (result.memoriesCreated > 0 || result.memoriesUpdated > 0) {
                        console.log(`🧠 Learning triggered: ${result.memoriesCreated} new memories, ${result.memoriesUpdated} updated`)
                    }
                }).catch(err => {
                    console.warn("⚠️ Learning trigger failed (non-fatal):", err?.message)
                })
            }
        }
    } catch (learnErr: any) {
        // Non-fatal — metrics were already saved successfully
        console.warn("⚠️ Learning check failed:", learnErr?.message)
    }

    return { success: true }
}

// ─── Performance Insights (Neural Brand Engine MVP) ──────────────────

export async function getPerformanceInsights(projectSlug: string = "mobilnamiru") {
    try {
        const { resolveClientId, loadConfig } = await import("@/instagram/configs")
        const config = await loadConfig(projectSlug)
        const clientId = await resolveClientId(projectSlug)

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

export async function getClientConfig(projectSlug: string): Promise<any> {
    try {
        const { loadConfig } = await import("@/instagram/configs")
        const config = await loadConfig(projectSlug)
        return config
    } catch (err: any) {
        console.error("getClientConfig error:", err?.message || err)
        return null
    }
}

// ─── Client Config Editor ────────────────────────────────────────────────

export async function updateClientConfig(projectSlug: string, partialConfig: any): Promise<{ success: boolean; error?: string }> {
    try {
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(projectSlug)

        // Fetch current config from DB directly
        const { data: client, error: fetchErr } = await supabaseAdmin
            .from("clients")
            .select("config")
            .eq("id", clientId)
            .single()
            
        if (fetchErr || !client) {
            throw new Error(`Failed to fetch client for update: ${fetchErr?.message}`)
        }

        const currentConfig = client.config || {}
        
        // Merge top-level config fields
        const newConfig = {
            ...currentConfig,
            ...partialConfig,
        }

        // Specifically merge nested objects if they are partially passed
        if (partialConfig.brandVoice && currentConfig.brandVoice) {
            newConfig.brandVoice = { ...currentConfig.brandVoice, ...partialConfig.brandVoice }
        }
        if (partialConfig.feedAesthetic && currentConfig.feedAesthetic) {
            newConfig.feedAesthetic = { ...currentConfig.feedAesthetic, ...partialConfig.feedAesthetic }
        }
        if (partialConfig.overlayGradient && currentConfig.overlayGradient) {
            newConfig.overlayGradient = { ...currentConfig.overlayGradient, ...partialConfig.overlayGradient }
        }
        if (partialConfig.defaultFormat && currentConfig.defaultFormat) {
            newConfig.defaultFormat = { ...currentConfig.defaultFormat, ...partialConfig.defaultFormat }
        }

        const { error: updateErr } = await supabaseAdmin
            .from("clients")
            .update({ config: newConfig })
            .eq("id", clientId)

        if (updateErr) throw updateErr

        return { success: true }
    } catch (err: any) {
        console.error("updateClientConfig error:", err?.message || err)
        return { success: false, error: err?.message || String(err) }
    }
}


// ─── Brand Image Management ─────────────────────────────────────────

/**
 * Upload a client logo to Supabase storage.
 * Saves as client-assets/{slug}/logo.png and updates config.logoFile.
 */
export async function uploadClientLogo(
    projectSlug: string,
    formData: FormData
): Promise<{ success: boolean; error?: string }> {
    try {
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(projectSlug)

        const file = formData.get("file") as File
        if (!file || !file.type.startsWith("image/")) {
            return { success: false, error: "Neplatný soubor — nahraj PNG nebo JPG" }
        }
        if (file.size > 5_000_000) {
            return { success: false, error: "Logo je příliš velké (max 5 MB)" }
        }

        const buffer = Buffer.from(await file.arrayBuffer())

        // Always save as logo.png (canonical path used by logo-loader.ts)
        const filename = `client-assets/${projectSlug}/logo.png`
        const { error: uploadError } = await supabaseAdmin.storage
            .from("audit-screenshots")
            .upload(filename, buffer, {
                contentType: "image/png",
                cacheControl: "31536000",
                upsert: true, // replace existing
            })

        if (uploadError) throw uploadError

        // Update config.logoFile to canonical filename
        const { data: client } = await supabaseAdmin
            .from("clients")
            .select("config")
            .eq("id", clientId)
            .single()

        const currentConfig = client?.config || {}
        await supabaseAdmin
            .from("clients")
            .update({ config: { ...currentConfig, logoFile: `logo-${projectSlug}.png` } })
            .eq("id", clientId)

        console.log(`✅ Logo uploaded: ${filename}`)
        return { success: true }
    } catch (err: any) {
        console.error("uploadClientLogo error:", err?.message || err)
        return { success: false, error: err?.message || String(err) }
    }
}

// ─── Re-scan Website ─────────────────────────────────────────────────

/**
 * Re-scrape client website for new brand images (without resetting config).
 */
export async function rescanClientWebsite(
    projectSlug: string
): Promise<{ success: boolean; newImages: number; existingImages: number; foundUrls: number; error?: string }> {
    try {
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(projectSlug)

        // Get current config
        const { data: client } = await supabaseAdmin
            .from("clients")
            .select("config")
            .eq("id", clientId)
            .single()

        const currentConfig = client?.config || {}
        const websiteUrl = currentConfig.website
        if (!websiteUrl) {
            return { success: false, newImages: 0, existingImages: 0, foundUrls: 0, error: "Klient nemá nastavenou URL webu" }
        }

        // Fetch website and extract images
        const baseUrl = websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`
        console.log(`🔍 Rescan: fetching ${baseUrl}...`)

        const resp = await fetch(baseUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
            signal: AbortSignal.timeout(15000),
        })
        if (!resp.ok) throw new Error(`Web vrátil ${resp.status}`)
        const html = await resp.text()

        // Extract image URLs from HTML
        const imageUrls = new Set<string>()
        const imgRegex = /<img[^>]+(?:src|data-src)="([^"]+)"[^>]*>/gi
        const srcsetRegex = /(?:srcset|data-srcset)="([^"]+)"/gi
        const bgRegex = /background-image:\s*url\(['"]?([^'")\s]+)['"]?\)/gi
        const dataSrcRegex = /data-src="([^"]+)"/gi
        let match

        function addUrl(raw: string) {
            let url = raw.trim()
            if (!url || url.length > 500) return
            if (url.endsWith('.svg') || url.endsWith('.ico') || url.includes('data:image')
                || url.includes('pixel') || url.includes('tracking') || url.includes('facebook.com')
                || url.includes('google') || url.includes('analytics') || url.includes('gravatar')
                || url.includes('emoji') || url.includes('spinner') || url.includes('widget')
            ) return
            if (url.startsWith('//')) url = `https:${url}`
            else if (url.startsWith('/')) url = `${baseUrl}${url}`
            else if (!url.startsWith('http')) return
            imageUrls.add(url)
        }

        while ((match = imgRegex.exec(html)) !== null) addUrl(match[1])
        while ((match = srcsetRegex.exec(html)) !== null) {
            const parts = match[1].split(',')
            const largest = parts[parts.length - 1]?.trim().split(/\s+/)[0]
            if (largest) addUrl(largest)
        }
        while ((match = bgRegex.exec(html)) !== null) addUrl(match[1])
        while ((match = dataSrcRegex.exec(html)) !== null) addUrl(match[1])

        // Also scan subpages
        const linkRegex = /href="([^"]+)"/gi
        const subpageUrls: string[] = []
        while ((match = linkRegex.exec(html)) !== null) {
            const href = match[1]
            if (href.startsWith('/') && !href.startsWith('//') && href.length > 1
                && !href.match(/\.(js|css|png|jpg|svg|ico|webp|gif|pdf|xml|json)/i)
                && !href.includes('#') && !href.includes('?')
            ) {
                subpageUrls.push(`${baseUrl}${href}`)
            }
        }
        // Prioritize gallery/rooms/product pages
        const priorityKeywords = /galeri|pokoje|apart|rooms|suite|product|nabid|sluzb|služb|photo|foto|ubytov|akce|cenik|ceník|menu/i
        const uniqueSubpages = [...new Set(subpageUrls)].sort((a, b) => {
            const ap = priorityKeywords.test(a) ? 0 : 1
            const bp = priorityKeywords.test(b) ? 0 : 1
            return ap - bp
        })
        for (const subUrl of uniqueSubpages.slice(0, 8)) {
            try {
                const subResp = await fetch(subUrl, {
                    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
                    signal: AbortSignal.timeout(8000),
                })
                if (subResp.ok) {
                    const subHtml = await subResp.text()
                    const subImgRegex = /<img[^>]+(?:src|data-src)="([^"]+)"[^>]*>/gi
                    while ((match = subImgRegex.exec(subHtml)) !== null) addUrl(match[1])
                }
            } catch { /* skip */ }
        }

        console.log(`🔍 Rescan: found ${imageUrls.size} image URLs on ${baseUrl}`)

        // Existing brand images — preserve full objects if present
        const { getConfigBrandImageObjects } = await import("@/instagram/configs/types")
        const existingObjects = getConfigBrandImageObjects(currentConfig)
        const existingUrls = new Set<string>(existingObjects.map(img => img.url))

        // Download new images
        const sharp = (await import("sharp")).default
        const newImages: { url: string; buffer: Buffer; mimeType: string }[] = []
        let uploadIndex = existingUrls.size

        for (const url of Array.from(imageUrls).slice(0, 50)) {
            if (newImages.length >= 20) break
            // Skip if we already have this exact URL stored
            if (existingUrls.has(url)) continue
            try {
                const imgResp = await fetch(url, {
                    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
                    signal: AbortSignal.timeout(8000),
                })
                if (!imgResp.ok) continue
                const ct = imgResp.headers.get("content-type") || ""
                if (!ct.startsWith("image/")) continue

                const buffer = Buffer.from(await imgResp.arrayBuffer())
                if (buffer.length < 5000 || buffer.length > 10_000_000) continue

                const meta = await sharp(buffer).metadata().catch(() => null)
                if (!meta || (meta.width || 0) < 300 || (meta.height || 0) < 300) continue

                const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg"
                const filename = `client-assets/${projectSlug}/brand-rescan-${String(uploadIndex).padStart(2, '0')}.${ext}`

                const { error: upErr } = await supabaseAdmin.storage
                    .from("audit-screenshots")
                    .upload(filename, buffer, { contentType: ct, cacheControl: "31536000", upsert: true })
                if (upErr) continue

                const { data: pubUrl } = supabaseAdmin.storage
                    .from("audit-screenshots")
                    .getPublicUrl(filename)

                newImages.push({ url: pubUrl.publicUrl, buffer, mimeType: ct })
                uploadIndex++
                console.log(`   📸 Rescan image ${newImages.length}: ${(buffer.length / 1024).toFixed(0)}KB`)
            } catch { continue }
        }

        // Tag new images with AI
        let taggedNew: any[] = []
        if (newImages.length > 0) {
            try {
                const { tagBrandImages } = await import("@/instagram/brand-tagger")
                taggedNew = await tagBrandImages(
                    newImages.map(img => ({ url: img.url, buffer: img.buffer, mimeType: img.mimeType })),
                    currentConfig.name || projectSlug,
                )
            } catch (tagErr) {
                console.warn(`⚠️ Tagging failed: ${(tagErr as Error).message}`)
                taggedNew = newImages.map(img => ({ url: img.url, tags: [], description: '' }))
            }
        }

        // Merge: keep existing objects + add tagged new ones
        const allRefs = [...existingObjects, ...taggedNew]
        await supabaseAdmin
            .from("clients")
            .update({ config: { ...currentConfig, brandReferenceImages: allRefs } })
            .eq("id", clientId)

        console.log(`✅ Rescan done: ${existingObjects.length} existing + ${taggedNew.length} new = ${allRefs.length} total`)

        return {
            success: true,
            newImages: taggedNew.length,
            existingImages: existingObjects.length,
            foundUrls: imageUrls.size,
        }
    } catch (err: any) {
        console.error("rescanClientWebsite error:", err?.message || err)
        return { success: false, newImages: 0, existingImages: 0, foundUrls: 0, error: err?.message || String(err) }
    }
}

// ─── Delete IG Post ──────────────────────────────────────────────────

export async function deleteIGPost(
    postId: string,
    projectSlug: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(projectSlug)

        // Get post to find image URL for cleanup
        const { data: post } = await supabaseAdmin
            .from("ig_posts")
            .select("image_url, client_id")
            .eq("id", postId)
            .single()

        if (!post || post.client_id !== clientId) {
            return { success: false, error: "Příspěvek nenalezen" }
        }

        // Delete images from storage
        if (post.image_url) {
            const urls = post.image_url.split("|")
            for (const url of urls) {
                const path = url.split("/storage/v1/object/public/audit-screenshots/")[1]
                    || url.split("/storage/v1/object/public/")[1]?.split("/").slice(1).join("/")
                if (path) {
                    const bucket = url.includes("audit-screenshots") ? "audit-screenshots" : url.split("/storage/v1/object/public/")[1]?.split("/")[0]
                    if (bucket) {
                        await supabaseAdmin.storage.from(bucket).remove([path]).catch(() => {})
                    }
                }
            }
        }

        // Delete from DB
        const { error } = await supabaseAdmin
            .from("ig_posts")
            .delete()
            .eq("id", postId)

        if (error) throw error
        return { success: true }
    } catch (err: any) {
        console.error("deleteIGPost error:", err?.message || err)
        return { success: false, error: err?.message || String(err) }
    }
}

export async function deleteIGPosts(
    postIds: string[],
    projectSlug: string
): Promise<{ success: boolean; deleted: number; error?: string }> {
    try {
        if (!postIds.length) return { success: true, deleted: 0 }
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(projectSlug)

        // Get posts for image cleanup
        const { data: posts } = await supabaseAdmin
            .from("ig_posts")
            .select("id, image_url")
            .eq("client_id", clientId)
            .in("id", postIds)

        // Delete images from storage
        if (posts) {
            for (const post of posts) {
                if (!post.image_url) continue
                const urls = post.image_url.split("|")
                for (const url of urls) {
                    const path = url.split("/storage/v1/object/public/audit-screenshots/")[1]
                        || url.split("/storage/v1/object/public/")[1]?.split("/").slice(1).join("/")
                    if (path) {
                        const bucket = url.includes("audit-screenshots") ? "audit-screenshots" : url.split("/storage/v1/object/public/")[1]?.split("/")[0]
                        if (bucket) {
                            await supabaseAdmin.storage.from(bucket).remove([path]).catch(() => {})
                        }
                    }
                }
            }
        }

        // Bulk delete from DB
        const { error, count } = await supabaseAdmin
            .from("ig_posts")
            .delete({ count: "exact" })
            .eq("client_id", clientId)
            .in("id", postIds)

        if (error) throw error
        return { success: true, deleted: count || postIds.length }
    } catch (err: any) {
        console.error("deleteIGPosts error:", err?.message || err)
        return { success: false, deleted: 0, error: err?.message || String(err) }
    }
}

// ─── Delete Client ───────────────────────────────────────────────────

export async function deleteClient(
    projectSlug: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(projectSlug)

        // 1. Delete all IG posts for this client
        await supabaseAdmin
            .from("ig_posts")
            .delete()
            .eq("client_id", clientId)

        // 2. Delete user_clients links
        await supabaseAdmin
            .from("user_clients")
            .delete()
            .eq("client_id", clientId)

        // 3. Delete storage assets
        const { data: files } = await supabaseAdmin.storage
            .from("audit-screenshots")
            .list(`client-assets/${projectSlug}`)
        if (files && files.length > 0) {
            await supabaseAdmin.storage
                .from("audit-screenshots")
                .remove(files.map(f => `client-assets/${projectSlug}/${f.name}`))
        }

        // 4. Delete client record
        const { error } = await supabaseAdmin
            .from("clients")
            .delete()
            .eq("id", clientId)

        if (error) throw error
        return { success: true }
    } catch (err: any) {
        console.error("deleteClient error:", err?.message || err)
        return { success: false, error: err?.message || String(err) }
    }
}

// ─── Post Revision ───────────────────────────────────────────

/**
 * Revise a post based on user feedback.
 * Creates a new draft post with revised caption/hashtags.
 * Original post is preserved unchanged.
 */
export async function revisePost(
    postId: string,
    feedback: string,
    projectSlug: string
): Promise<{ success: boolean; newPostId?: string; error?: string }> {
    try {
        // 1. Load original post
        const { data: original, error: fetchErr } = await supabaseAdmin
            .from("ig_posts")
            .select("*, ig_post_types(name, display_name)")
            .eq("id", postId)
            .single()

        if (fetchErr || !original) throw new Error("Post nenalezen")

        // 2. Load client config for brand voice
        const { resolveClientId } = await import("@/instagram/configs")
        const { ai } = await import("@/instagram/gemini-client")
        const clientId = await resolveClientId(projectSlug)

        const { data: clientData } = await supabaseAdmin
            .from("clients")
            .select("config")
            .eq("id", clientId)
            .single()

        const config = clientData?.config || {}
        const bv = config.brandVoice || {}
        const brandName = config.name || projectSlug
        const postTypeName = original.ig_post_types?.display_name || "Instagram příspěvek"
        const postTypeSlug = original.ig_post_types?.name || ""

        // Resolve linked product if any
        let productSection = ""
        if (original.product_id) {
            const { data: product } = await supabaseAdmin
                .from("ig_products")
                .select("name, slug, price, description")
                .eq("id", original.product_id)
                .single()
            if (product) {
                productSection = `\n## PRODUKT V PŘÍSPĚVKU\nNázev: ${product.name}\nCena: ${product.price || "neuvedena"}\nPopis: ${product.description || ""}\nURL: ${config.website}/p/${product.slug}\n⚠️ Pokud feedback nemění produkt, zachovej odkaz na ${config.website}/p/${product.slug} v CTA.\n`
            }
        }

        // Hashtag pool instructions
        const hashtagSection = config.hashtagPools
            ? `\n## HASHTAG POOLS (vyber z těchto):\n- Core: ${config.hashtagPools.core?.join(", ") || ""}\n- Niche: ${config.hashtagPools.niche?.slice(0, 5).join(", ") || ""}\n- Broad: ${config.hashtagPools.broad?.slice(0, 4).join(", ") || ""}\nPoužij 8-10 hashtagů, mix core + niche + relevantní z originálu.\n`
            : ""

        // 3. Build revision prompt
        const prompt = `Jsi senior copywriter pro značku "${brandName}" (${config.website || ""}).

## BRAND PERSONA
${bv.persona || "Profesionální a přátelský tón."}

## VOICE TRAITS
${(bv.voiceTraits || []).map((t: string) => `- ${t}`).join("\n") || "- Autentický a přirozený"}

## ZAKÁZÁNO (NIKDY NEPOUŽÍVEJ)
${(bv.antiPatterns || []).map((p: string) => `- ${p}`).join("\n") || "- Generické fráze, emoji spam"}

## TYP PŘÍSPĚVKU: ${postTypeName}
${productSection}
## PŮVODNÍ CAPTION:
${original.caption}

## PŮVODNÍ HASHTAGY: ${(original.hashtags || []).join(" ")}
${hashtagSection}
## FEEDBACK OD KLIENTA:
"${feedback}"

## INSTRUKCE:
1. Přepiš caption PŘESNĚ podle feedbacku — ale zachovej brand voice a styl
2. Hook (první řádek) musí stále zastavit scrollování — max 15 slov, bez emoji
3. CTA musí směřovat na ${config.website || "web značky"}
4. Zachovej strukturu: hook → body → CTA → hashtags
5. Pokud feedback říká "zkrátit" — zkrať. Pokud "přidat humor" — přidej. Buď DOSLOVNÝ.
6. NIKDY nepřekládej anglické názvy produktů/kolekcí do češtiny

## VÝSTUP — vrať POUZE validní JSON:
{
  "caption": "kompletní nový text příspěvku (hook + body + CTA)",
  "hashtags": ["#hashtag1", "#hashtag2", "..."]
}`

        const response = await ai.models.generateContent({
            model: "gemini-3.5-flash",
            contents: prompt,
            config: { responseMimeType: "application/json" },
        })

        const text = response.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text || ""
        let parsed: { caption: string; hashtags: string[] }
        try {
            parsed = JSON.parse(text.replace(/```json|```/g, "").trim())
        } catch {
            throw new Error("AI vrátilo neplatný JSON")
        }

        // 4. Save as new draft (non-destructive)
        const { data: newPost, error: insertErr } = await supabaseAdmin
            .from("ig_posts")
            .insert({
                client_id: clientId,
                caption: parsed.caption,
                hashtags: parsed.hashtags,
                image_url: original.image_url,   // reuse existing image
                image_prompt: original.image_prompt,
                image_style: original.image_style,
                post_type_id: original.post_type_id,
                content_pillar: original.content_pillar,
                status: "draft",
                feedback: feedback,
                revision_of: postId,
            })
            .select("id")
            .single()

        if (insertErr) throw insertErr

        console.log(`✅ Post revised: ${postId} → ${newPost.id}`)
        return { success: true, newPostId: newPost.id }
    } catch (err: any) {
        console.error("revisePost error:", err?.message || err)
        return { success: false, error: err?.message || String(err) }
    }
}

// ─── Post Variant Generation ─────────────────────────────────
/**
 * Generate a variant of an existing post — same topic, different angle/hook/image.
 * Creates a new draft post linked to the original via variant_of field.
 */
export async function generatePostVariant(
    postId: string,
    projectSlug: string
): Promise<{ success: boolean; newPostId?: string; error?: string }> {
    try {
        // 1. Load original post
        const { data: original, error: fetchErr } = await supabaseAdmin
            .from("ig_posts")
            .select("*, ig_post_types(name, display_name)")
            .eq("id", postId)
            .single()

        if (fetchErr || !original) throw new Error("Post nenalezen")

        // 2. Extract topic from caption (hook + first paragraph)
        const captionLines = (original.caption || "").split("\n").filter(Boolean)
        const hook = captionLines[0] || ""
        const body = captionLines.slice(1, 3).join(" ").substring(0, 200)
        const topicSummary = body ? `${hook} — ${body}` : hook

        // 3. Build a topic instruction that tells AI "same topic, different everything else"
        const variantTopic = `VARIANTA existujícího příspěvku. Stejné TÉMA ale ÚPLNĚ jiný úhel, hook a vizuál.

PŮVODNÍ PŘÍSPĚVEK (NEOPAKUJ!):
"${topicSummary}"

PRAVIDLA PRO VARIANTU:
- Stejné téma/produkt jako originál
- ÚPLNĚ jiný hook (jiná emoce, jiný formát)
- Jiný vizuální styl pro obrázek
- Jiné CTA
- Můžeš rozvinout jiný aspekt toho samého tématu`

        const postTypeName = original.ig_post_types?.name || undefined

        // 4. Generate via autopilot
        const { generateOnePost } = await import("@/instagram/autopilot")
        const { setActiveProject } = await import("@/instagram/service")
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(projectSlug)
        setActiveProject(clientId)

        const result = await generateOnePost({
            configName: projectSlug,
            topic: variantTopic,
            type: postTypeName,
        })

        if (result.id) {
            // Mark as variant
            await supabaseAdmin
                .from("ig_posts")
                .update({ revision_of: postId })
                .eq("id", result.id)
        }

        console.log(`✅ Varianta vygenerována: ${postId} → ${result.id}`)
        return { success: true, newPostId: result.id }
    } catch (err: any) {
        console.error("generatePostVariant error:", err?.message || err)
        return { success: false, error: err?.message || String(err) }
    }
}

// ─── Content Plan Preview (cheap text-only plan before expensive generation) ──

export interface ContentPlanItem {
    id: string
    postType: string
    postTypeEmoji: string
    postTypeLabel: string
    pillar: string
    pillarEmoji: string
    hookPreview: string
    angle: string
    topic: string
    week?: number
    day?: number
    /** Linked product from ig_products */
    productId?: string
    productName?: string
    productImage?: string
}

export async function generateContentPlan(
    projectSlug: string,
    count: number,
    userTopic?: string,
    category?: string
): Promise<{ success: boolean; plan?: ContentPlanItem[]; error?: string }> {
    try {
        const { resolveClientId } = await import("@/instagram/configs")
        const { loadConfig } = await import("@/instagram/configs")
        const { buildSmartWeekPlan } = await import("@/instagram/caption-generator")
        const { analyzePerformance } = await import("@/instagram/performance")
        const { setActiveProject, createPillarMapper, getPillarForType } = await import("@/instagram/service")

        const config = await loadConfig(projectSlug)
        const clientId = await resolveClientId(projectSlug)
        setActiveProject(clientId)

        // Get strategic post type sequence
        const _getPillarForType = createPillarMapper(config)
        const performance = await analyzePerformance(config, _getPillarForType)
        const typeSequence = buildSmartWeekPlan(config, performance, count)

        // Get post type metadata from DB
        const { data: dbPostTypes } = await supabaseAdmin
            .from("ig_post_types")
            .select("name, display_name, emoji, description")
            .eq("client_id", clientId)
            .eq("is_active", true)

        const ptMap = new Map((dbPostTypes || []).map(pt => [pt.name, pt]))

        // Build context for Gemini
        const typeList = typeSequence.map((typeName, i) => {
            const pt = ptMap.get(typeName)
            const pillar = getPillarForType(config, typeName)
            const pillarCfg = config.contentPillars[pillar]
            return `${i + 1}. Typ: "${typeName}" (${pt?.display_name || typeName}) | Pilíř: ${pillarCfg?.label || pillar} | Popis: ${pt?.description || pillarCfg?.description || ""}`
        }).join("\n")

        const topicInstruction = userTopic
            ? `\n## 🎯 HLAVNÍ TÉMA KAMPANĚ: "${userTopic}"\nVšechny posty MUSÍ souviset s tímto tématem, ale každý z jiného úhlu.`
            : ""

        const prompt = `Jsi strategický content planner pro značku "${config.name}" (${config.website}).

## ÚKOL
Vytvoř content plan na ${count} postů. Pro každý post napiš:
- hookPreview: český hook (první věta postu, max 12 slov, poutavá, BEZ emoji)
- angle: 1 věta popisující úhel/přístup k tématu (česky)
- topic: krátké téma v 3-5 slovech (česky)

## BRAND VOICE
${config.brandVoice.persona}
Tón: ${config.brandVoice.voiceTraits?.join(", ")}

## ANTI-PATTERNS (NEPOUŽÍVEJ)
${config.brandVoice.antiPatterns?.join(", ")}

${config.products?.length ? `## PRODUKTY ZNAČKY (${config.products.length})\n${config.products.slice(0, 10).map(p => `- **${p.name}** (${p.type})${p.price ? ` — ${p.price}` : ""}${p.description ? `: ${p.description.substring(0, 60)}` : ""}`).join("\n")}\n⚠️ Pro posty typu product_drop/produkt MUSÍŠ zmínit KONKRÉTNÍ produkt z tohoto seznamu v hooku!\n` : ""}
${config.audiencePersonas?.length ? `## CÍLOVÉ PERSONY\n${config.audiencePersonas.map(p => `- **${p.label}** (${p.ageRange} let): Pain points: ${p.painPoints.slice(0, 2).join(", ")}`).join("\n")}\n` : ""}
${topicInstruction}

## SEKVENCE POSTŮ (strategicky sestavená):
${typeList}

## PRAVIDLA
- Každý hook MUSÍ být unikátní — žádné opakování vzorců
- Hooky musí zastavit scrollování — provokativní, překvapivé, kontroverzní
- Posty v sérii na sebe NAVAZUJÍ — budují příběh, ne náhodné izolované posty
- ${count > 14 ? "Rozděl do týdnů — každý týden má vlastní mini-téma" : "Posty by měly mít logický flow"}
- Pro product posty: hook MUSÍ zmínit konkrétní produkt/službu
- Piš česky, moderní hovorovou češtinou

## VÝSTUP
Vrať POUZE validní JSON pole:
[
  { "hookPreview": "...", "angle": "...", "topic": "..." },
  ...
]
Pole musí mít PŘESNĚ ${count} položek.`

        const { generateText } = await import("@/instagram/gemini-client")
        const raw = await generateText(prompt, { model: "gemini-3.5-flash" })

        // Parse response
        const jsonMatch = raw.match(/\[[\s\S]*\]/)
        if (!jsonMatch) {
            throw new Error("AI nevrátila validní JSON pole")
        }
        const concepts: { hookPreview: string; angle: string; topic: string }[] = JSON.parse(jsonMatch[0])

        // Build plan items with metadata
        const plan: ContentPlanItem[] = typeSequence.slice(0, count).map((typeName, i) => {
            const pt = ptMap.get(typeName)
            const pillar = getPillarForType(config, typeName)
            const pillarCfg = config.contentPillars[pillar]
            const concept = concepts[i] || { hookPreview: "", angle: "", topic: "" }

            return {
                id: `plan_${Date.now()}_${i}`,
                postType: typeName,
                postTypeEmoji: pt?.emoji || "📝",
                postTypeLabel: pt?.display_name || typeName,
                pillar,
                pillarEmoji: pillarCfg?.emoji || "📋",
                hookPreview: concept.hookPreview,
                angle: concept.angle,
                topic: concept.topic,
                week: count > 14 ? Math.floor(i / 7) + 1 : undefined,
                day: i + 1,
            }
        })

        return { success: true, plan }
    } catch (err: any) {
        console.error("generateContentPlan error:", err?.message || err)
        return { success: false, error: err?.message || String(err) }
    }
}

export async function regeneratePlanItem(
    projectSlug: string,
    postType: string,
    existingHooks: string[],
    userTopic?: string
): Promise<{ success: boolean; item?: { hookPreview: string; angle: string; topic: string }; error?: string }> {
    try {
        const { loadConfig } = await import("@/instagram/configs")
        const { getPillarForType } = await import("@/instagram/service")
        const config = await loadConfig(projectSlug)

        // Build pillar context for this post type
        const pillar = getPillarForType(config, postType)
        const pillarCfg = config.contentPillars[pillar]
        const pillarSection = pillarCfg
            ? `## PILÍŘ: ${pillarCfg.emoji} ${pillarCfg.label}\n${pillarCfg.description || ""}\nCíl: ${pillarCfg.ctaStrategy === "hard" ? "PRODEJ" : pillarCfg.ctaStrategy === "medium" ? "HODNOTA" : pillarCfg.ctaStrategy === "soft" ? "DOSAH" : "KOMUNITA"}\n`
            : ""

        const productsSection = config.products?.length
            ? `## PRODUKTY (${config.products.length})\n${config.products.slice(0, 6).map(p => `- ${p.name} (${p.type})${p.price ? ` — ${p.price}` : ""}`).join("\n")}\n`
            : ""

        const prompt = `Jsi content stratég pro "${config.name}" (${config.website}).

## BRAND PERSONA
${config.brandVoice.persona || ""}

## VOICE TRAITS
${config.brandVoice.voiceTraits?.map((t: string) => `- ${t}`).join("\n") || ""}

## ZAKÁZÁNO
${config.brandVoice.antiPatterns?.slice(0, 5).map((p: string) => `- ${p}`).join("\n") || ""}

${productsSection}
${pillarSection}
## ÚKOL
Vygeneruj JEDEN nový koncept pro post typu "${postType}".
${userTopic ? `Téma kampaně: "${userTopic}" — hook MUSÍ souviset s tímto tématem.` : ""}

## NESMÍŠ OPAKOVAT tyto hooky:
${existingHooks.map(h => `- "${h}"`).join("\n")}

## PRAVIDLA:
- Hook musí zastavit scrollování — provokativní, překvapivý, specifický pro "${config.name}"
- ŽÁDNÉ emoji v hooku
- Hook max 12 slov, česky
- Angle musí být konkrétní — ne "zajímavý pohled" ale "srovnání cen s konkurencí"
- Topic: 3-5 slov shrnující o čem post bude

Vrať POUZE validní JSON:
{ "hookPreview": "český hook max 12 slov BEZ emoji", "angle": "1 věta o přístupu", "topic": "3-5 slov" }`

        const { generateText } = await import("@/instagram/gemini-client")
        const raw = await generateText(prompt, { model: "gemini-3.5-flash" })
        const jsonMatch = raw.match(/\{[\s\S]*\}/)
        if (!jsonMatch) throw new Error("Invalid JSON response")
        const item = JSON.parse(jsonMatch[0])

        return { success: true, item }
    } catch (err: any) {
        return { success: false, error: err?.message || String(err) }
    }
}

// ─── Product Catalog (ig_products) ───────────────────────────────────

export async function getProducts(projectSlug: string): Promise<any[]> {
    try {
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(projectSlug)

        const { data, error } = await supabaseAdmin
            .from("ig_products")
            .select("*")
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })

        if (error) {
            console.error("getProducts error:", error.message)
            return []
        }
        return data || []
    } catch (err: any) {
        console.error("getProducts exception:", err?.message || err)
        return []
    }
}

export async function createProduct(
    projectSlug: string,
    product: { name: string; type?: string; slug: string; price?: string; description?: string; variants?: number }
): Promise<{ success: boolean; product?: any; error?: string }> {
    try {
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(projectSlug)

        const { data, error } = await supabaseAdmin
            .from("ig_products")
            .insert({
                client_id: clientId,
                name: product.name,
                type: product.type || null,
                slug: product.slug,
                price: product.price || null,
                description: product.description || null,
                variants: product.variants || null,
                image_urls: [],
            })
            .select()
            .single()

        if (error) throw error
        return { success: true, product: data }
    } catch (err: any) {
        console.error("createProduct error:", err?.message || err)
        return { success: false, error: err?.message || String(err) }
    }
}

export async function updateProduct(
    productId: string,
    projectSlug: string,
    updates: { name?: string; type?: string; slug?: string; price?: string; description?: string; variants?: number }
): Promise<{ success: boolean; error?: string }> {
    try {
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(projectSlug)

        const { error } = await supabaseAdmin
            .from("ig_products")
            .update({
                ...updates,
                updated_at: new Date().toISOString(),
            })
            .eq("id", productId)
            .eq("client_id", clientId)

        if (error) throw error
        return { success: true }
    } catch (err: any) {
        console.error("updateProduct error:", err?.message || err)
        return { success: false, error: err?.message || String(err) }
    }
}

export async function deleteProduct(
    productId: string,
    projectSlug: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(projectSlug)

        // Delete product images from storage
        const { data: product } = await supabaseAdmin
            .from("ig_products")
            .select("image_urls, slug")
            .eq("id", productId)
            .eq("client_id", clientId)
            .single()

        if (product?.slug) {
            const { data: files } = await supabaseAdmin.storage
                .from("product-images")
                .list(clientId, { search: product.slug })
            if (files && files.length > 0) {
                await supabaseAdmin.storage
                    .from("product-images")
                    .remove(files.map(f => `${clientId}/${f.name}`))
            }
        }

        const { error } = await supabaseAdmin
            .from("ig_products")
            .delete()
            .eq("id", productId)
            .eq("client_id", clientId)

        if (error) throw error
        return { success: true }
    } catch (err: any) {
        console.error("deleteProduct error:", err?.message || err)
        return { success: false, error: err?.message || String(err) }
    }
}

export async function deleteProducts(
    productIds: string[],
    projectSlug: string
): Promise<{ success: boolean; deleted: number; error?: string }> {
    try {
        if (!productIds.length) return { success: true, deleted: 0 }
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(projectSlug)

        // Get slugs for storage cleanup
        const { data: products } = await supabaseAdmin
            .from("ig_products")
            .select("id, slug")
            .eq("client_id", clientId)
            .in("id", productIds)

        // Delete images from storage
        if (products && products.length > 0) {
            for (const p of products) {
                try {
                    const { data: files } = await supabaseAdmin.storage
                        .from("product-images")
                        .list(clientId, { search: p.slug })
                    if (files && files.length > 0) {
                        await supabaseAdmin.storage
                            .from("product-images")
                            .remove(files.map(f => `${clientId}/${f.name}`))
                    }
                } catch { /* non-critical */ }
            }
        }

        // Bulk delete from DB
        const { error, count } = await supabaseAdmin
            .from("ig_products")
            .delete({ count: "exact" })
            .eq("client_id", clientId)
            .in("id", productIds)

        if (error) throw error
        return { success: true, deleted: count || productIds.length }
    } catch (err: any) {
        console.error("deleteProducts error:", err?.message || err)
        return { success: false, deleted: 0, error: err?.message || String(err) }
    }
}

export async function uploadProductImage(
    projectSlug: string,
    productId: string,
    formData: FormData
): Promise<{ success: boolean; publicUrl?: string; error?: string }> {
    try {
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(projectSlug)

        const file = formData.get("file") as File
        if (!file || !file.type.startsWith("image/")) {
            return { success: false, error: "Neplatný soubor — nahraj PNG, JPG nebo WebP" }
        }
        if (file.size > 10_000_000) {
            return { success: false, error: "Obrázek je příliš velký (max 10 MB)" }
        }

        // Get product slug for filename
        const { data: product } = await supabaseAdmin
            .from("ig_products")
            .select("slug, image_urls")
            .eq("id", productId)
            .eq("client_id", clientId)
            .single()

        if (!product) return { success: false, error: "Produkt nenalezen" }

        const buffer = Buffer.from(await file.arrayBuffer())
        const ext = file.type.includes("png") ? "png" : file.type.includes("webp") ? "webp" : "jpg"
        const existingCount = (product.image_urls || []).length
        const filename = `${clientId}/${product.slug}-${existingCount}.${ext}`

        const { error: uploadError } = await supabaseAdmin.storage
            .from("product-images")
            .upload(filename, buffer, {
                contentType: file.type,
                cacheControl: "31536000",
                upsert: true,
            })

        if (uploadError) throw uploadError

        const { data: pubUrl } = supabaseAdmin.storage
            .from("product-images")
            .getPublicUrl(filename)

        // Append URL to product's image_urls array
        const updatedUrls = [...(product.image_urls || []), pubUrl.publicUrl]
        await supabaseAdmin
            .from("ig_products")
            .update({ image_urls: updatedUrls, updated_at: new Date().toISOString() })
            .eq("id", productId)

        return { success: true, publicUrl: pubUrl.publicUrl }
    } catch (err: any) {
        console.error("uploadProductImage error:", err?.message || err)
        return { success: false, error: err?.message || String(err) }
    }
}

/**
 * One-shot migration: sync config.products JSONB → ig_products table
 * for all active clients. Safe to run multiple times (dedup by slug).
 */
export async function syncConfigProductsToDb(): Promise<{ success: boolean; synced: number; skipped: number; error?: string }> {
    try {
        const { data: clients, error } = await supabaseAdmin
            .from("clients")
            .select("id, slug, config")
            .eq("is_active", true)

        if (error) throw error
        if (!clients || clients.length === 0) return { success: true, synced: 0, skipped: 0 }

        let totalSynced = 0
        let totalSkipped = 0

        for (const client of clients) {
            const config = client.config as any
            const products = config?.products
            if (!products || !Array.isArray(products) || products.length === 0) continue

            // Get existing slugs to avoid duplicates
            const { data: existing } = await supabaseAdmin
                .from("ig_products")
                .select("slug")
                .eq("client_id", client.id)

            const existingSlugs = new Set((existing || []).map((p: any) => p.slug))

            const toInsert = products
                .filter((p: any) => p.slug && !existingSlugs.has(p.slug))
                .map((p: any) => ({
                    client_id: client.id,
                    name: p.name,
                    type: p.type || "product",
                    slug: p.slug,
                    price: p.price || null,
                    description: p.description || null,
                    image_urls: [],
                }))

            if (toInsert.length === 0) {
                totalSkipped += products.length
                continue
            }

            const { error: insertError } = await supabaseAdmin
                .from("ig_products")
                .insert(toInsert)

            if (insertError) {
                console.warn(`⚠️ Sync failed for ${client.slug}:`, insertError.message)
            } else {
                totalSynced += toInsert.length
                totalSkipped += products.length - toInsert.length
                console.log(`✅ ${client.slug}: ${toInsert.length} products synced`)
            }
        }

        return { success: true, synced: totalSynced, skipped: totalSkipped }
    } catch (err: any) {
        console.error("syncConfigProductsToDb error:", err?.message || err)
        return { success: false, synced: 0, skipped: 0, error: err?.message || String(err) }
    }
}

// ─── Scrape Products from Website ────────────────────────────────────

/**
 * Scrape client's website, extract products/services via AI, insert into ig_products.
 * Also downloads product images and uploads to Supabase storage.
 * Max 30 products. Dedup by slug — safe to run multiple times.
 */
export async function scrapeProductsFromWebsite(
    projectSlug: string
): Promise<{ success: boolean; found: number; inserted: number; images: number; error?: string }> {
    try {
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(projectSlug)

        // Get website URL from config
        const config = await getClientConfig(projectSlug)
        const website = config?.website
        if (!website) {
            return { success: false, found: 0, inserted: 0, images: 0, error: "Klient nemá nastavený web" }
        }

        const baseUrl = website.startsWith("http") ? website : `https://${website}`
        const origin = new URL(baseUrl).origin

        // --- Lightweight scraper ---
        const fetchWithTimeout = async (url: string, ms = 8000): Promise<string> => {
            const ctrl = new AbortController()
            const t = setTimeout(() => ctrl.abort(), ms)
            try {
                const r = await fetch(url, {
                    signal: ctrl.signal,
                    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
                })
                if (!r.ok) throw new Error(`HTTP ${r.status}`)
                return await r.text()
            } finally { clearTimeout(t) }
        }

        // Preserve <img> tags as [IMG: url] markers so AI can map images to products
        const stripHtml = (html: string, pageBaseUrl: string): string => {
            return html
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
                .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
                .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
                .replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gi, (_, lvl, c) => `\n[H${lvl}] ${c.replace(/<[^>]+>/g, "").trim()}\n`)
                .replace(/<img[^>]+(?:src|data-src)="([^"]+)"[^>]*>/gi, (_, src) => {
                    // Skip tiny icons, trackers, SVGs
                    if (src.endsWith('.svg') || src.endsWith('.ico') || src.includes('data:image')
                        || src.includes('pixel') || src.includes('tracking') || src.includes('placeholder')
                        || src.includes('spinner') || src.includes('loading') || src.includes('avatar')
                        || src.includes('emoji') || src.includes('widget') || /\b(1x1|2x2|spacer)\b/i.test(src)) return ""
                    let url = src
                    if (url.startsWith("//")) url = `https:${url}`
                    else if (url.startsWith("/")) url = `${pageBaseUrl}${url}`
                    return ` [IMG: ${url}] `
                })
                .replace(/<li[^>]*>(.*?)<\/li>/gi, (_, c) => `• ${c.replace(/<[^>]+>/g, "").trim()}\n`)
                .replace(/(\d[\d\s]*(?:Kč|CZK|,-|€|\$))/gi, " [CENA: $1] ")
                .replace(/<[^>]+>/g, " ")
                .replace(/&nbsp;/gi, " ")
                .replace(/&amp;/gi, "&")
                .replace(/\s+/g, " ")
                .trim()
        }

        // Scrape homepage
        console.log(`🔍 Scraping products from ${baseUrl}...`)
        let homepageHtml: string
        try {
            homepageHtml = await fetchWithTimeout(baseUrl)
        } catch (e: any) {
            return { success: false, found: 0, inserted: 0, images: 0, error: `Web se nepodařilo načíst: ${e.message}` }
        }
        const homepageText = stripHtml(homepageHtml, origin).substring(0, 6000)

        // Discover subpages from <a href>
        const subUrls = new Set<string>()
        const linkRegex = /href="([^"]+)"/gi
        let m: RegExpExecArray | null
        while ((m = linkRegex.exec(homepageHtml)) !== null) {
            const href = m[1]
            if (href.startsWith("/") && !href.startsWith("//") && href.length > 1 && !href.match(/\.(js|css|png|jpg|svg|ico|webp|gif|pdf|xml|json)/i) && !href.includes("#")) {
                subUrls.add(`${origin}${href}`)
            }
        }

        // Prioritize product/service/pricing pages
        const priority = /produk|sluzb|služb|cenik|ceník|nabid|shop|store|menu|katalog|balic|balíč|price|offer|obchod/i
        const sortedSubs = Array.from(subUrls)
            .sort((a, b) => (priority.test(a) ? 0 : 1) - (priority.test(b) ? 0 : 1))
            .slice(0, 10)

        // Scrape subpages (keep raw HTML for image extraction)
        const subTexts: string[] = []
        for (const url of sortedSubs) {
            try {
                const html = await fetchWithTimeout(url)
                subTexts.push(`### ${url}\n${stripHtml(html, origin).substring(0, 2000)}`)
            } catch { /* skip */ }
        }

        // --- AI extraction (with image URLs) ---
        const { generateText } = await import("@/instagram/gemini-client")

        const prompt = `Analyzuj obsah tohoto webu a extrahuj VŠECHNY produkty, služby, balíčky, nabídky a cenové položky.

Obsah obsahuje značky [IMG: url] označující obrázky nalezené na stránce.

## HOMEPAGE
${homepageText}

## PODSTRÁNKY (${sortedSubs.length})
${subTexts.join("\n\n")}

## ÚKOL
Extrahuj pole produktů/služeb. Pro KAŽDÝ nalezený produkt/službu vrať:
- name: název produktu/služby (česky)
- type: kategorie (produkt, služba, balíček, menu, pokoj, kurz, atd.)
- slug: URL-friendly verze názvu (lowercase, bez diakritiky, pomlčky místo mezer)
- price: cena pokud nalezena (např. "990 Kč", "od 1500 Kč/hod") nebo null
- description: stručný popis (1-2 věty) nebo null
- imageUrl: URL obrázku produktu z nejbližší [IMG: url] značky, nebo null

PRAVIDLA:
- Maximálně 30 položek
- Zahrň i služby, balíčky, kategorie menu, typy pokojů atd.
- Nezahrnuj navigační položky, stránky, nebo interní odkazy
- Slug: bez diakritiky, lowercase, max 40 znaků
- imageUrl: vyber obrázek který nejlépe odpovídá danému produktu (nejbližší [IMG:] tag). Pokud žádný vhodný není, nastav null
- Pokud na webu žádné produkty/služby nejsou, vrať prázdné pole

Vrať POUZE platný JSON pole objektů.`

        const productSchema = {
            type: "object",
            properties: {
                products: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            name: { type: "string" },
                            type: { type: "string" },
                            slug: { type: "string" },
                            price: { type: "string" },
                            description: { type: "string" },
                            imageUrl: { type: "string" },
                        },
                        required: ["name", "type", "slug"],
                    },
                },
            },
            required: ["products"],
        }

        const raw = await generateText(prompt, { model: "gemini-3.5-flash", responseSchema: productSchema })
        let products: any[] = []

        // Parse — handle both {products: [...]} and bare [...]
        const jsonObjMatch = raw.match(/\{[\s\S]*\}/)
        const jsonArrMatch = raw.match(/\[[\s\S]*\]/)
        if (jsonObjMatch) {
            const parsed = JSON.parse(jsonObjMatch[0])
            products = parsed.products || parsed
        } else if (jsonArrMatch) {
            products = JSON.parse(jsonArrMatch[0])
        }

        if (!Array.isArray(products)) products = []
        products = products.slice(0, 30) // enforce limit

        if (products.length === 0) {
            return { success: true, found: 0, inserted: 0, images: 0 }
        }

        // --- Dedup + insert ---
        const { data: existing } = await supabaseAdmin
            .from("ig_products")
            .select("id, slug, image_urls")
            .eq("client_id", clientId)

        const existingBySlug = new Map((existing || []).map((p: any) => [p.slug, p]))

        const newProducts = products.filter(p => p.slug && !existingBySlug.has(p.slug))

        let insertedRows: any[] = []
        if (newProducts.length > 0) {
            const toInsert = newProducts.map(p => ({
                client_id: clientId,
                name: p.name,
                type: p.type || "product",
                slug: p.slug.substring(0, 40),
                price: p.price || null,
                description: p.description || null,
                image_urls: [],
            }))

            const { data, error: insertError } = await supabaseAdmin
                .from("ig_products")
                .insert(toInsert)
                .select("id, slug")

            if (insertError) throw insertError
            insertedRows = data || []
        }

        // --- Download and upload product images ---
        // Build map of products that need images (newly inserted + existing without images)
        let totalImages = 0
        const sharp = (await import("sharp")).default

        const slugToData = new Map<string, { id: string; imageUrl: string }>()
        for (const p of products) {
            if (!p.imageUrl || typeof p.imageUrl !== "string" || !p.imageUrl.startsWith("http")) continue
            const slug = p.slug.substring(0, 40)

            // Check if this is a newly inserted product
            const newRow = insertedRows.find((r: any) => r.slug === slug)
            if (newRow) {
                slugToData.set(slug, { id: newRow.id, imageUrl: p.imageUrl })
                continue
            }

            // Check if this is an existing product WITHOUT images
            const existingProduct = existingBySlug.get(slug)
            if (existingProduct && (!existingProduct.image_urls || existingProduct.image_urls.length === 0)) {
                slugToData.set(slug, { id: existingProduct.id, imageUrl: p.imageUrl })
            }
        }

        if (slugToData.size > 0) {
            console.log(`📷 Downloading images for ${slugToData.size} products...`)

            for (const [slug, { id: productId, imageUrl }] of slugToData) {
                try {
                    const ctrl = new AbortController()
                    const t = setTimeout(() => ctrl.abort(), 8000)
                    const resp = await fetch(imageUrl, {
                        signal: ctrl.signal,
                        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
                    })
                    clearTimeout(t)

                    if (!resp.ok) continue

                    const contentType = resp.headers.get("content-type") || "image/jpeg"
                    if (!contentType.startsWith("image/")) continue

                    const buffer = Buffer.from(await resp.arrayBuffer())

                    // Skip tiny (<5KB) and huge (>10MB)
                    if (buffer.length < 5000 || buffer.length > 10_000_000) continue

                    // Validate dimensions — skip icons/badges
                    try {
                        const metadata = await sharp(buffer).metadata()
                        if ((metadata.width || 0) < 200 || (metadata.height || 0) < 200) continue
                    } catch { continue }

                    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg"
                    const filename = `${clientId}/${slug}-0.${ext}`

                    const { error: uploadError } = await supabaseAdmin.storage
                        .from("product-images")
                        .upload(filename, buffer, {
                            contentType,
                            cacheControl: "31536000",
                            upsert: true,
                        })

                    if (uploadError) {
                        console.warn(`   ⚠️ Upload failed for ${slug}: ${uploadError.message}`)
                        continue
                    }

                    const { data: pubUrl } = supabaseAdmin.storage
                        .from("product-images")
                        .getPublicUrl(filename)

                    // Update product record with image URL
                    await supabaseAdmin
                        .from("ig_products")
                        .update({ image_urls: [pubUrl.publicUrl], updated_at: new Date().toISOString() })
                        .eq("id", productId)

                    totalImages++
                    console.log(`   📸 ${slug}: ${(buffer.length / 1024).toFixed(0)}KB ✓`)
                } catch {
                    // Skip failed image downloads silently
                }
            }
        }

        console.log(`✅ ${newProducts.length} products + ${totalImages} images scraped for ${projectSlug}`)
        return { success: true, found: products.length, inserted: newProducts.length, images: totalImages }
    } catch (err: any) {
        console.error("scrapeProductsFromWebsite error:", err?.message || err)
        return { success: false, found: 0, inserted: 0, images: 0, error: err?.message || String(err) }
    }
}

