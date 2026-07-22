"use server"

import supabaseAdmin from "@/supabase/admin"
import { requireProjectAccess } from "@/lib/auth-guard"
import { reconcileFormats } from "@/instagram/configs/reconcile"
import type { OverlayStyle } from "@/instagram/configs/types"

export async function getClientConfig(projectSlug: string): Promise<any> {
    try {
        await requireProjectAccess(projectSlug)
        const { loadConfig } = await import("@/instagram/configs")
        // Always fetch fresh from DB — Settings tab must show latest data
        const config = await loadConfig(projectSlug, true)
        return config
    } catch (err: any) {
        console.error("getClientConfig error:", err?.message || err)
        return null
    }
}

// ─── Client Config Editor ────────────────────────────────────────────────

export async function updateClientConfig(projectSlug: string, partialConfig: any): Promise<{ success: boolean; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

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

        // Reconcile format projections before persisting so the Témata (pillar)
        // editor's plain save can never leave a format orphaned by a deleted pillar.
        const reconciled = reconcileFormats(newConfig)

        const { error: updateErr } = await supabaseAdmin
            .from("clients")
            .update({ config: reconciled })
            .eq("id", clientId)

        if (updateErr) throw updateErr

        // Invalidate config cache so next loadConfig fetches fresh data
        const { invalidateConfigCache } = await import("@/instagram/configs")
        invalidateConfigCache(projectSlug)

        return { success: true }
    } catch (err: any) {
        console.error("updateClientConfig error:", err?.message || err)
        return { success: false, error: err?.message || String(err) }
    }
}


// ─── Post Format Management ──────────────────────────────────────────
//
// A format lives in FOUR places that must stay in sync (see scripts/
// audit-formats-pillars.ts): config.postTypes, config.postTypeDefs,
// config.postFormats + pillar membership, and the ig_post_types row.
// These actions are the ONLY safe way to add/edit/remove a single format —
// they update all four sources atomically and never regenerate the set
// (unlike onboarding's generateCustomFormats, which replaces everything).

export interface PostFormatInput {
    /** Existing format slug when editing; omit to create (derived from display_name) */
    name?: string
    display_name: string
    emoji: string
    description: string
    /** Content skeleton (carousel slide outline / reel scenes / caption arc) — binds the
     *  copywriter's structure for this format. Empty = generic medium skeleton. */
    structure?: string
    /** How posts of this format should LOOK — grounds the AI Designer brief. */
    visualStyle?: string
    /** Content pillar key (must exist in config.contentPillars) */
    pillar: string
    medium: "image" | "carousel" | "reel"
    aspectRatio: "1:1" | "4:5" | "3:4" | "9:16"
    uses_product: boolean
    /** true = only selectable manually in the Generate tab; excluded from autopilot
     *  rotation and content planning (giveaways, contests, limited drops) */
    manualOnly?: boolean
    /** Text overlay style for the render. Optional — falls back to a medium-derived
     *  default. Reels are always "none"; static media can never be "none". */
    overlayStyle?: OverlayStyle
    /** Reel length in seconds — 5–8 single clip, 16/24 premium multi-clip (higher
     *  credit price). Clamped to REEL_ALLOWED_DURATIONS on save. Reels only. */
    reelDuration?: number
}

function slugifyFormatName(input: string): string {
    return input.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
}

const STATIC_OVERLAY_STYLES: OverlayStyle[] =
    ["default", "cover", "top", "centered", "editorial", "split", "minimal", "full-typo", "step"]

/** Resolve the render overlay style, enforcing the hard rule: reels are text-free
 *  ("none"); a static image/carousel may NEVER be "none". Honors the user's choice
 *  when valid, else falls back to the medium-derived default. */
function resolveOverlayStyle(medium: "image" | "carousel" | "reel", chosen?: OverlayStyle): OverlayStyle {
    if (medium === "reel") return "none"
    if (chosen && STATIC_OVERLAY_STYLES.includes(chosen)) return chosen
    return medium === "carousel" ? "cover" : "default"
}

/**
 * Turn a short keyword the user types ("soutěž", "giveaway", "zákulisí") into a
 * ready-to-review format draft grounded in THIS brand — so adding a format is
 * "write a word, tweak, save" instead of filling nine fields by hand. Returns a
 * PostFormatInput the UI pre-fills; the user still saves through upsertPostFormat
 * unchanged (nothing is persisted here). Contests / giveaways / limited drops are
 * forced manualOnly — real brand commitments the autopilot must never invent (the
 * manualOnly hard rule).
 */
export async function suggestPostFormat(
    projectSlug: string,
    keyword: string
): Promise<{ success: boolean; draft?: PostFormatInput; error?: string }> {
    try {
        await requireProjectAccess(projectSlug)
        const kw = (keyword || "").trim()
        if (!kw) return { success: false, error: "Napiš, jaký formát chceš (např. soutěž)" }

        const { loadConfig } = await import("@/instagram/configs")
        const config = await loadConfig(projectSlug, true)
        const pillars: Record<string, any> = config.contentPillars || {}
        const pillarKeys = Object.keys(pillars)
        if (pillarKeys.length === 0) return { success: false, error: "Nejdřív vytvoř aspoň jedno téma (pilíř)." }

        const pillarList = pillarKeys
            .map(k => `- ${k} = ${pillars[k]?.label || k}${pillars[k]?.description ? ` (${pillars[k].description})` : ""}`)
            .join("\n")
        const productNames = (config.products || []).map((p: any) => p?.name).filter(Boolean).slice(0, 8).join(", ")

        const prompt = `Jsi Instagram stratég. Uživatel chce PŘIDAT jeden formát příspěvku (šablonu) a napsal jen klíčové slovo. Navrhni ho ušitý na míru téhle značce.

Klíčové slovo od uživatele: "${kw}"

Firma: ${config.name || projectSlug}${config.industry ? ` (${config.industry})` : ""}
${productNames ? `Produkty/služby: ${productNames}` : "Bez katalogu produktů"}
Pilíře obsahu (POVOLENÉ klíče — vyber přesně jeden):
${pillarList}

Vrať POUZE JSON objekt (bez markdownu):
{
  "display_name": "krátký název formátu, česky",
  "emoji": "1 emoji vystihující formát",
  "description": "2-3 věty česky: CO post ukazuje a PROČ funguje pro tuhle značku. U soutěže/giveaway napiš KONKRÉTNÍ mechaniku (dej like, sleduj profil, označ kámoše, co je výhra).",
  "structure": "kostra obsahu, česky. Pro carousel: osnova slide po slidu (Slide 1 COVER: ..., Slide 2: ..., poslední slide: CTA). Pro reel: osnova scén. Pro obrázek: stavba caption (hook → ... → CTA).",
  "visual_style": "1-2 věty česky: jak mají posty tohohle formátu VYPADAT — kompozice, nálada, rekvizity, práce s textem. Řídí se tím AI designer.",
  "pillar": "přesně jeden z povolených klíčů pilířů výše",
  "medium": "image | carousel | reel",
  "aspectRatio": "1:1 | 4:5 | 3:4 | 9:16",
  "uses_product": true/false,
  "manual_only": true/false
}

Pravidla: konkrétní pro tuhle značku, ne generické. "uses_product" = true jen když formát ukazuje konkrétní produkt. "manual_only" = true pro soutěže, giveawaye, limitky a časově omezené akce (reálné závazky značky — AI je nesmí generovat sama). aspectRatio "9:16" jen pro reel.`

        // Same resilient pattern as onboarding's generateCustomFormats: ask for JSON,
        // extract the object, retry once on a transient AI/parse failure.
        let parsed: any = null
        for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
            try {
                const { generateText } = await import("@/instagram/gemini-client")
                const { getModel } = await import("@/instagram/models")
                const raw = await generateText(prompt, {
                    temperature: 0.7,
                    model: getModel("textPro"),
                    fallbackModel: getModel("textPro", "fallback"),
                })
                const match = raw.match(/\{[\s\S]*\}/)
                if (match) parsed = JSON.parse(match[0])
            } catch (e: any) {
                console.warn(`suggestPostFormat parse failed (${attempt}/2): ${e?.message}`)
            }
        }
        if (!parsed?.display_name || !parsed?.description) {
            return { success: false, error: "AI návrh se nepovedl — zkus jiné slovo nebo vyplň ručně." }
        }

        const medium = (["image", "carousel", "reel"].includes(parsed.medium) ? parsed.medium : "image") as PostFormatInput["medium"]
        const aspectRatio = (medium === "reel"
            ? "9:16"
            : (["1:1", "4:5", "3:4"].includes(parsed.aspectRatio) ? parsed.aspectRatio : "4:5")) as PostFormatInput["aspectRatio"]
        // Safety net for the manualOnly rule: a giveaway must never fall into autopilot
        // even if the model forgets the flag or the keyword itself screams "contest".
        const contestish = /sout[eě]ž|giveaw|contest|limitk|limited|drop/.test(kw.toLowerCase())

        const draft: PostFormatInput = {
            display_name: String(parsed.display_name).slice(0, 60),
            emoji: parsed.emoji || "🎁",
            description: String(parsed.description).slice(0, 400),
            structure: parsed.structure ? String(parsed.structure).slice(0, 600) : undefined,
            visualStyle: parsed.visual_style ? String(parsed.visual_style).slice(0, 400) : undefined,
            pillar: pillarKeys.includes(parsed.pillar) ? parsed.pillar : pillarKeys[0],
            medium,
            aspectRatio,
            uses_product: Boolean(parsed.uses_product),
            manualOnly: Boolean(parsed.manual_only) || contestish,
        }
        return { success: true, draft }
    } catch (err: any) {
        console.error("suggestPostFormat error:", err?.message || err)
        return { success: false, error: err?.message || "Nepodařilo se navrhnout formát" }
    }
}

export async function upsertPostFormat(
    projectSlug: string,
    input: PostFormatInput
): Promise<{ success: boolean; name?: string; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        const name = slugifyFormatName(input.name || input.display_name)
        if (!name) return { success: false, error: "Neplatný název formátu" }
        if (!input.display_name?.trim() || !input.description?.trim()) {
            return { success: false, error: "Název a popis formátu jsou povinné" }
        }

        const { data: client, error: fetchErr } = await supabaseAdmin
            .from("clients")
            .select("config")
            .eq("id", clientId)
            .single()
        if (fetchErr || !client) throw new Error(`Failed to fetch client: ${fetchErr?.message}`)

        const config = client.config || {}
        if (!config.contentPillars?.[input.pillar]) {
            return { success: false, error: `Téma "${input.pillar}" v konfiguraci neexistuje` }
        }

        // Reels are 9:16 only; feed media must use a feed-legal ratio.
        const aspectRatio = input.medium === "reel"
            ? "9:16"
            : (["1:1", "4:5", "3:4"].includes(input.aspectRatio) ? input.aspectRatio : "4:5")

        const def = {
            name,
            display_name: input.display_name.trim().slice(0, 60),
            emoji: input.emoji || "📝",
            description: input.description.trim().slice(0, 400),
            structure: input.structure?.trim() ? input.structure.trim().slice(0, 600) : undefined,
            visualStyle: input.visualStyle?.trim() ? input.visualStyle.trim().slice(0, 400) : undefined,
            pillar: input.pillar,
            medium: input.medium,
            aspectRatio,
            uses_product: Boolean(input.uses_product),
            manualOnly: Boolean(input.manualOnly),
        }

        // postTypeDefs is the SOURCE OF TRUTH — replace by name or append.
        const defs: any[] = Array.isArray(config.postTypeDefs) ? [...config.postTypeDefs] : []
        const defIdx = defs.findIndex(d => d?.name === name)
        if (defIdx >= 0) defs[defIdx] = def
        else defs.push(def)
        config.postTypeDefs = defs

        // Set this format's render entry explicitly (honors the chosen overlayStyle;
        // reconcile won't overwrite an existing postFormats entry).
        const { clampReelDuration } = await import("@/lib/credits")
        config.postFormats = config.postFormats || {}
        config.postFormats[name] = {
            aspectRatio,
            medium: input.medium,
            overlayStyle: resolveOverlayStyle(input.medium, input.overlayStyle),
            ...(input.medium === "reel" && input.reelDuration
                ? { reelDuration: clampReelDuration(input.reelDuration) }
                : {}),
        }

        // postTypes + pillar membership are projections — reconcile rebuilds them
        // from postTypeDefs so the four sources can't drift.
        const reconciled = reconcileFormats(config)

        const { error: updateErr } = await supabaseAdmin
            .from("clients")
            .update({ config: reconciled })
            .eq("id", clientId)
        if (updateErr) throw updateErr

        // 5) ig_post_types row — update in place or insert (same shape as ensurePostTypes)
        const { data: existingRow } = await supabaseAdmin
            .from("ig_post_types")
            .select("id")
            .eq("client_id", clientId)
            .eq("name", name)
            .maybeSingle()

        const rowData = {
            display_name: def.emoji ? `${def.emoji} ${def.display_name}` : def.display_name,
            emoji: def.emoji,
            description: def.description,
            uses_product: def.uses_product,
            is_active: true,
        }
        if (existingRow) {
            const { error } = await supabaseAdmin
                .from("ig_post_types").update(rowData).eq("id", existingRow.id)
            if (error) throw error
        } else {
            const { error } = await supabaseAdmin
                .from("ig_post_types")
                .insert({ client_id: clientId, name, frequency: "weekly", ...rowData })
            if (error) throw error
        }

        const { invalidateConfigCache } = await import("@/instagram/configs")
        invalidateConfigCache(projectSlug)
        return { success: true, name }
    } catch (err: any) {
        console.error("upsertPostFormat error:", err?.message || err)
        return { success: false, error: err?.message || String(err) }
    }
}

export async function removePostFormat(
    projectSlug: string,
    name: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        const { data: client, error: fetchErr } = await supabaseAdmin
            .from("clients")
            .select("config")
            .eq("id", clientId)
            .single()
        if (fetchErr || !client) throw new Error(`Failed to fetch client: ${fetchErr?.message}`)

        const config = client.config || {}
        const postTypes: string[] = Array.isArray(config.postTypes) ? config.postTypes : []
        if (!postTypes.includes(name)) return { success: false, error: "Formát neexistuje" }
        if (postTypes.length <= 1) return { success: false, error: "Poslední formát nelze smazat" }

        // Remove from the source of truth (postTypeDefs) + active list + render map.
        config.postTypes = postTypes.filter(n => n !== name)
        config.postTypeDefs = (config.postTypeDefs || []).filter((d: any) => d?.name !== name)
        if (config.postFormats?.[name]) delete config.postFormats[name]
        // weekPlan must never reference a removed format — refill emptied slots
        // from the remaining active set so the plan length stays intact.
        if (Array.isArray(config.weekPlan) && config.weekPlan.includes(name)) {
            const remaining: string[] = config.postTypes
            config.weekPlan = config.weekPlan.map((n: string, i: number) =>
                n === name ? remaining[i % remaining.length] : n)
        }

        // reconcile drops the removed name from every pillar's membership.
        const reconciled = reconcileFormats(config)

        const { error: updateErr } = await supabaseAdmin
            .from("clients")
            .update({ config: reconciled })
            .eq("id", clientId)
        if (updateErr) throw updateErr

        // Deactivate (not delete) the row — historical posts keep their FK + display name.
        await supabaseAdmin
            .from("ig_post_types")
            .update({ is_active: false })
            .eq("client_id", clientId)
            .eq("name", name)

        const { invalidateConfigCache } = await import("@/instagram/configs")
        invalidateConfigCache(projectSlug)
        return { success: true }
    } catch (err: any) {
        console.error("removePostFormat error:", err?.message || err)
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
        const { clientId } = await requireProjectAccess(projectSlug)

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
        // Invalidate config cache
        const { invalidateConfigCache } = await import('@/instagram/configs')
        invalidateConfigCache(projectSlug)
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
/**
 * Look at the brand's REAL Instagram and suggest a feed pattern for it.
 *
 * Deliberately READ-ONLY — it returns a recommendation and writes nothing. The caller drops
 * it into the Settings form and the user saves it through the normal config path. That's not
 * squeamishness: re-running the onboarding feed-vision and letting it write would also
 * re-derive typographyStyle / accentColor / customInstructions, silently overwriting tuning
 * the user has done since onboarding (the same "never replace a real value" rule that the
 * re-onboarding audit fix exists for). Suggesting one field can't do that.
 *
 * Why scrape rather than read our own posts: `ig_posts.design_brief.layoutArchetype` is an
 * artifact of the designer's own archetype ROTATION (measured: near-uniform across all 8 for
 * every client), so it describes our randomiser, not the brand. The client's real feed is the
 * only honest signal for what their identity already looks like.
 */
export async function recommendFeedPattern(projectSlug: string): Promise<{
    success: boolean
    patternId?: string
    label?: string
    /** What the vision pass saw the real feed already doing — shown as the "why". */
    archetypes?: string[]
    summary?: string
    error?: string
}> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const { data: client } = await supabaseAdmin
            .from("clients")
            .select("config")
            .eq("id", clientId)
            .single()

        const cfg = client?.config || {}
        // Handles are stored with the leading "@" (and a few clients have a bare "@").
        const handle = String(cfg.instagram || "").replace(/^@+/, "").trim()
        if (!handle) {
            return { success: false, error: "Klient nemá vyplněný Instagram účet — doplňte ho v Základních údajích." }
        }

        const { fetchInstagramProfile } = await import("@/lib/ig-scraper")
        const profile = await fetchInstagramProfile(handle, { includePosts: true })
        if (!profile) {
            return { success: false, error: `Účet @${handle} se nepodařilo načíst (soukromý účet, překlep, nebo je scraper dočasně nedostupný).` }
        }
        if (!profile.recentPosts?.length) {
            return { success: false, error: `Na účtu @${handle} nejsou žádné příspěvky k analýze.` }
        }

        const { analyzeFeedVisuals } = await import("@/instagram/feed-vision")
        const visuals = await analyzeFeedVisuals(profile.recentPosts, cfg.name || projectSlug)
        if (!visuals) {
            return { success: false, error: "Vizuální analýza feedu selhala — zkuste to prosím znovu." }
        }

        const { recommendPattern, getPatternDef } = await import("@/lib/feed-pattern")
        const patternId = recommendPattern(visuals)
        console.log(`🔲 [recommend-pattern] ${projectSlug} @${handle}: ${visuals.dominantArchetypes.join(", ")} → ${patternId}`)

        return {
            success: true,
            patternId,
            label: getPatternDef(patternId).label,
            archetypes: visuals.dominantArchetypes,
            summary: visuals.visualStyleSummary,
        }
    } catch (err: any) {
        return { success: false, error: err?.message || String(err) }
    }
}

export async function rescanClientWebsite(
    projectSlug: string
): Promise<{ success: boolean; newImages: number; existingImages: number; foundUrls: number; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

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

        // Invalidate config cache
        const { invalidateConfigCache } = await import('@/instagram/configs')
        invalidateConfigCache(projectSlug)

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

// ─── Delete Client ───────────────────────────────────────────────────

export async function deleteClient(
    projectSlug: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

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

