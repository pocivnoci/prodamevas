"use server"

import supabaseAdmin from "@/supabase/admin"
import { getConfigBrandImageObjects } from "@/instagram/configs/types"

// ─── Instagram Actions ───────────────────────────────────────────────

export async function getIGPostsList(statusFilter?: string, projectSlug: string = "mobilnamiru"): Promise<any[]> {
    try {
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(projectSlug)

        let query = supabaseAdmin
            .from("ig_posts")
            .select(`
                id, caption, hashtags, call_to_action, image_url, image_prompt,
                scheduled_for, time_slot, status, posted_at, likes, comments, saves,
                reach, shares, profile_visits, link_clicks, content_pillar,
                created_at, updated_at, client_id,
                ig_post_types ( name, display_name, emoji )
            `)
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
            .limit(15)

        if (statusFilter && statusFilter !== "all") {
            query = query.eq("status", statusFilter)
        }

        const { data, error } = await query
        if (error) {
            console.error("getIGPostsList error:", error.message)
            return []
        }
        return data || []
    } catch (err: any) {
        console.error("getIGPostsList exception:", err?.message || err)
        return []
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

/**
 * Sync eshop product images — scrapes and downloads product photos from the client's eshop
 */
export async function syncEshopProducts(configName: string): Promise<{ success: boolean; message: string; imageCount: number }> {
    try {
        const { loadConfig } = await import("@/instagram/configs")
        const { scrapeAllProducts } = await import("@/instagram/eshop-scraper")
        const config = await loadConfig(configName)
        const results = await scrapeAllProducts(config)
        const totalImages = results.reduce((sum, r) => sum + r.localPaths.length, 0)
        return {
            success: true,
            message: `Synced ${results.length} products, ${totalImages} images downloaded`,
            imageCount: totalImages,
        }
    } catch (err: any) {
        return { success: false, message: err.message || "Sync failed", imageCount: 0 }
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
}

export async function updateIGPostStatus(postId: string, status: string): Promise<{ success: boolean }> {
    const { error } = await supabaseAdmin
        .from("ig_posts")
        .update({
            status,
            ...(status === "posted" ? { posted_at: new Date().toISOString() } : {}),
            updated_at: new Date().toISOString(),
        })
        .eq("id", postId)
    return { success: !error }
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
    return { success: !error }
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

/**
 * Upload a brand reference image to Supabase storage and add its URL to config.
 */
export async function uploadBrandImage(
    projectSlug: string,
    formData: FormData
): Promise<{ success: boolean; url?: string; error?: string }> {
    try {
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(projectSlug)

        const file = formData.get("file") as File
        if (!file || !file.type.startsWith("image/")) {
            return { success: false, error: "Neplatný soubor — nahraj obrázek (JPG, PNG, WebP)" }
        }
        if (file.size > 10_000_000) {
            return { success: false, error: "Soubor je příliš velký (max 10 MB)" }
        }

        const buffer = Buffer.from(await file.arrayBuffer())
        const ext = file.type.includes("png") ? "png" : file.type.includes("webp") ? "webp" : "jpg"
        const timestamp = Date.now()
        const filename = `client-assets/${projectSlug}/brand-upload-${timestamp}.${ext}`

        const { error: uploadError } = await supabaseAdmin.storage
            .from("audit-screenshots")
            .upload(filename, buffer, {
                contentType: file.type,
                cacheControl: "31536000",
                upsert: true,
            })

        if (uploadError) throw uploadError

        const { data: publicUrlData } = supabaseAdmin.storage
            .from("audit-screenshots")
            .getPublicUrl(filename)

        const publicUrl = publicUrlData.publicUrl

        // Add URL to config.brandReferenceImages
        const { data: client } = await supabaseAdmin
            .from("clients")
            .select("config")
            .eq("id", clientId)
            .single()

        const currentConfig = client?.config || {}
        const existingRefs = [...getConfigBrandImageObjects(currentConfig)]

        // Tag the uploaded image
        let newEntry: any = publicUrl
        try {
            const { tagBrandImage } = await import("@/instagram/brand-tagger")
            const { tags, description } = await tagBrandImage(buffer, file.type, currentConfig.name)
            if (tags.length > 0 || description) {
                newEntry = { url: publicUrl, tags, description }
            }
        } catch { /* tagging failed */ }

        existingRefs.push(newEntry)

        await supabaseAdmin
            .from("clients")
            .update({ config: { ...currentConfig, brandReferenceImages: existingRefs } })
            .eq("id", clientId)

        return { success: true, url: publicUrl }
    } catch (err: any) {
        console.error("uploadBrandImage error:", err?.message || err)
        return { success: false, error: err?.message || String(err) }
    }
}

/**
 * Delete a brand reference image from storage and config.
 */
export async function deleteBrandImage(
    projectSlug: string,
    imageUrl: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(projectSlug)

        // Remove from storage
        const storagePath = imageUrl.split("/storage/v1/object/public/audit-screenshots/")[1]
        if (storagePath) {
            await supabaseAdmin.storage
                .from("audit-screenshots")
                .remove([storagePath])
        }

        // Remove from config
        const { data: client } = await supabaseAdmin
            .from("clients")
            .select("config")
            .eq("id", clientId)
            .single()

        const currentConfig = client?.config || {}
        const refs = getConfigBrandImageObjects(currentConfig)
            .filter(img => img.url !== imageUrl)

        await supabaseAdmin
            .from("clients")
            .update({ config: { ...currentConfig, brandReferenceImages: refs } })
            .eq("id", clientId)

        return { success: true }
    } catch (err: any) {
        console.error("deleteBrandImage error:", err?.message || err)
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

