"use server"

import supabaseAdmin from "@/supabase/admin"

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
        const refs = currentConfig.brandReferenceImages || currentConfig.characterReferenceImages || []
        refs.push(publicUrl)

        await supabaseAdmin
            .from("clients")
            .update({ config: { ...currentConfig, brandReferenceImages: refs } })
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
        const refs = (currentConfig.brandReferenceImages || currentConfig.characterReferenceImages || [])
            .filter((url: string) => url !== imageUrl)

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
