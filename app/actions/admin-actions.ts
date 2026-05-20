"use server"

import supabaseAdmin from "@/supabase/admin"

// ─── Instagram Actions ───────────────────────────────────────────────

// ─── Dashboard Stats (lightweight aggregate) ──────────────────────────

export async function getDashboardStats(projectSlug: string) {
    try {
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(projectSlug)

        // Post counts by status
        const { data: posts } = await supabaseAdmin
            .from("ig_posts")
            .select("id, status, caption, image_url, created_at, ig_post_types ( display_name, emoji )")
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
            .limit(50)

        const allPosts = posts || []
        const drafts = allPosts.filter(p => p.status === "draft").length
        const ready = allPosts.filter(p => p.status === "ready").length
        const posted = allPosts.filter(p => p.status === "posted").length

        // Idea count
        const { count: ideasCount } = await supabaseAdmin
            .from("ig_post_ideas")
            .select("id", { count: "exact", head: true })
            .eq("client_id", clientId)

        // Recent 3 posts with images
        const recentPosts = allPosts
            .filter(p => p.image_url)
            .slice(0, 3)
            .map(p => ({
                id: p.id,
                caption: p.caption?.split("\n")[0]?.substring(0, 80) || "—",
                image_url: p.image_url,
                status: p.status,
                created_at: p.created_at,
                type_name: (p.ig_post_types as any)?.display_name || "Post",
                type_emoji: (p.ig_post_types as any)?.emoji || "📸",
            }))

        return {
            totalPosts: allPosts.length,
            drafts,
            ready,
            posted,
            ideas: ideasCount || 0,
            recentPosts,
        }
    } catch (err: any) {
        console.error("getDashboardStats error:", err?.message || err)
        return { totalPosts: 0, drafts: 0, ready: 0, posted: 0, ideas: 0, recentPosts: [] }
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
        const config = await loadConfig(configName)
        const formats: Record<string, { aspectRatio: string; medium: string; overlayStyle: string }> = {}
        const defaultFmt = config.defaultFormat || { aspectRatio: "4:5", medium: "image", overlayStyle: "default" }

        // Build format map for all post types
        for (const name of (config.postTypes || [])) {
            formats[name] = config.postFormats?.[name] || defaultFmt
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
        const brandVoice = config.brandVoice || ""
        const brandName = config.name || projectSlug
        const postTypeName = original.ig_post_types?.display_name || "Instagram příspěvek"

        // 3. Build revision prompt
        const prompt = `Jsi copywriter pro značku "${brandName}".

Tón značky: ${brandVoice}
Typ příspěvku: ${postTypeName}

PŮVODNÍ CAPTION:
${original.caption}

HASHTAGY: ${(original.hashtags || []).join(" ")}

FEEDBACK OD KLIENTA:
"${feedback}"

Přepiš caption a hashtags podle feedbacku. Zachovej tón a styl značky.
Vrať PŘESNĚ tento JSON (nic jiného):
{
  "caption": "nový text příspěvku",
  "hashtags": ["hashtag1", "hashtag2", ...]
}`

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-lite",
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
${topicInstruction}

## SEKVENCE POSTŮ (strategicky sestavená):
${typeList}

## PRAVIDLA
- Každý hook MUSÍ být unikátní — žádné opakování vzorců
- Hooky musí zastavit scrollování — provokativní, překvapivé, kontroverzní
- Posty v sérii na sebe NAVAZUJÍ — budují příběh, ne náhodné izolované posty
- ${count > 14 ? "Rozděl do týdnů — každý týden má vlastní mini-téma" : "Posty by měly mít logický flow"}
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
        const config = await loadConfig(projectSlug)

        const prompt = `Jsi content planner pro "${config.name}" (${config.website}).

Vygeneruj JEDEN nový koncept pro post typu "${postType}".
${userTopic ? `Téma kampaně: "${userTopic}"` : ""}

## NESMÍŠ OPAKOVAT tyto hooky:
${existingHooks.map(h => `- "${h}"`).join("\n")}

Brand voice: ${config.brandVoice.voiceTraits?.join(", ")}

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
