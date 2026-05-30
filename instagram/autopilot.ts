/**
 * Instagram Autopilot — Closed-Loop Content Engine (Orchestrator)
 * ==============================================================
 *
 * This is the main orchestrator. Business logic is split into:
 *   📊 performance.ts  — analyzePerformance, PerformanceInsight
 *   🚫 service.ts       — isHookSimilar, isBodySimilar (dedup)
 *   ✍️ caption-generator.ts — schemas, mega prompt, quality gate, helpers
 *   🎨 image-pipeline.ts — prompt refinement (image, carousel, video)
 *
 * Usage:
 *   npx tsx instagram/autopilot.ts                         # 1 post
 *   npx tsx instagram/autopilot.ts --week                  # 7 posts
 *   npx tsx instagram/autopilot.ts --budget=5              # max 5 posts
 *   npx tsx instagram/autopilot.ts --type=meme             # specific type
 *   npx tsx instagram/autopilot.ts --dry-run               # preview only
 *   npx tsx instagram/autopilot.ts --feedback              # record performance
 *   npx tsx instagram/autopilot.ts --stats                 # show what works
 */

import supabaseAdmin from "../supabase/admin"
import sharp from "sharp"
import { generateText, generateImage, generateImageWithReferences, generateVideo, generateVoiceover } from "./gemini-client"
import { overlayText } from "./text-overlay"
import {
    getActivePostTypes,
    getAvailableIdeas,
    getRecentPosts,
    createPost,
    markIdeaAsUsed,
    markReviewAsUsed,
    logGeneration,
    batchInsertIdeas,
    setActiveProject,
    getActiveProject,
    withActiveProject,
    ensurePostTypes,
    getWeightedIdeas,
    getWeightedReviews,
    propagateMetricsToSources,
} from "./service"
import { runProductIdeas, runDesignConcept } from "./product-generator"
import { loadConfig } from "./configs"
import type { ClientConfig } from "./configs/types"
// getConfigBrandImageObjects is imported dynamically where needed
import type { PostType, PostIdea, Review } from "./types"

// Module imports (refactored from monolith)
import { isHookSimilar, isBodySimilar, createPillarMapper } from "./service"
import { analyzePerformance, type PerformanceInsight } from "./performance"
import {
    COSTS,
    IDEA_COOLDOWN_DAYS,
    getPostFormat,
    getReelDuration,
    selectOverlayVariant,

    buildCaptionSchema,
    buildVideoSchema,
    buildCarouselSchema,
    buildSmartWeekPlan,
    buildMegaPrompt,
    scorePost,
} from "./caption-generator"
import { refineImagePrompt, refineCarouselPrompts, refineVideoPrompt } from "./image-pipeline"
import { processReelVideo, scenesToSubtitles } from "./video-processor"
import { getBrandMemories, formatMemoriesForPrompt } from "./memory-agent"
import { reviewPost, reviewContentPlan, reviewOverlayComposition } from "./editorial-board"
import type { EditorialMessage } from "./types"

// Active client config (set from --config flag or ensureConfig)
let CLIENT_CONFIG: ClientConfig | null = null

/**
 * Smart config loader — ensures CLIENT_CONFIG is set before generation.
 * Called automatically by generateOnePost/generateBatch when invoked from server actions.
 * No-op if config is already loaded for the same client.
 */
async function ensureConfig(configName?: string): Promise<string> {
    const name = configName || "mobilnamiru"
    if (CLIENT_CONFIG && CLIENT_CONFIG.id === name) {
        return getActiveProject() // already loaded, return current clientId
    }
    CLIENT_CONFIG = await loadConfig(name)

    // Resolve slug → uuid and set the active client for all service queries
    const { resolveClientId } = await import("./configs")
    const clientUuid = await resolveClientId(name)
    setActiveProject(clientUuid) // fallback for legacy code paths
    console.log(`🏢 Config loaded: ${CLIENT_CONFIG.name} (${name} → ${clientUuid.substring(0, 8)}...)`)

    // Auto-create any missing post types in DB for this client
    await ensurePostTypes(CLIENT_CONFIG, clientUuid)
    return clientUuid
}

// ============================================
// USED IDEA IDS (DB query)
// ============================================

async function getUsedIdeaIds(): Promise<Set<string>> {
    const { data } = await supabaseAdmin
        .from("ig_posts")
        .select("idea_id")
        .eq("client_id", getActiveProject())
        .not("idea_id", "is", null)

    return new Set((data || []).map(p => p.idea_id).filter((id): id is string => id !== null))
}

// ============================================
// SINGLE POST GENERATION
// ============================================

export async function generateOnePost(options: {
    configName?: string
    type?: string
    topic?: string
    dryRun?: boolean
    performance?: PerformanceInsight
    aspectRatio?: string
    medium?: "image" | "carousel" | "reel"
    customImageUrl?: string
    /** Explicit product ID from ig_products — overrides random product selection */
    productId?: string
    campaignContext?: { postNumber: number; totalPosts: number; previousPosts: { hook: string; topic: string }[] }
    onProgress?: (stage: string, progress: number, message: string, editorialLog?: EditorialMessage[]) => Promise<void>
}): Promise<{ id?: string; caption: string; imageUrl?: string; cost: number }> {
    const report = options.onProgress || (async () => { }) // no-op if not provided
    const clientUuid = await ensureConfig(options.configName)

    // Wrap entire generation in request-scoped context to prevent race conditions
    return withActiveProject(clientUuid, async () => {
    const config = CLIENT_CONFIG!
    const startTime = Date.now()
    let cost = 0

    // 1. Select post type
    await report("researcher", 5, "🔍 Researcher vybírá typ postu...")
    console.log("\n📋 Vybírám typ postu...")
    const postTypes = await getActivePostTypes(config.postTypes)
    if (postTypes.length === 0) {
        throw new Error(`Žádné aktivní typy postů pro "${config.id}". Zkontroluj konfiguraci a tabulku ig_post_types.`)
    }
    let selectedType: PostType

    if (options.type) {
        const found = postTypes.find(pt => pt.name === options.type)
        if (!found) throw new Error(`Post type "${options.type}" not found. Available: ${postTypes.map(t => t.name).join(", ")}`)
        selectedType = found
    } else {
        // Memory-informed post type weighting
        let postTypeBoosts: Record<string, number> = {}
        try {
            const { getPostTypeBoosts } = await import("./memory-agent")
            postTypeBoosts = await getPostTypeBoosts(postTypes.map(t => t.name))
            const boostedTypes = Object.entries(postTypeBoosts).filter(([, v]) => v !== 0)
            if (boostedTypes.length > 0) {
                console.log(`   🧠 Memory boosts: ${boostedTypes.map(([k, v]) => `${k}=${v > 0 ? "+" : ""}${v.toFixed(2)}`).join(", ")}`)
            }
        } catch {
            // Non-fatal — continue with base weights
        }

        const weighted = postTypes.flatMap(type => {
            const baseWeight = type.frequency === "daily" ? 3 : type.frequency === "weekly" ? 2 : 1
            const boost = postTypeBoosts[type.name] || 0
            const finalWeight = Math.max(1, Math.round(baseWeight * (1 + boost)))
            return Array(finalWeight).fill(type)
        })
        selectedType = weighted[Math.floor(Math.random() * weighted.length)]
    }
    console.log(`   ✓ ${selectedType.emoji} ${selectedType.display_name}`)

    // 2. Get source material (90-day cooldown deduplikace)
    await report("researcher", 15, `🔍 Researcher hledá zdroje pro ${selectedType.display_name}...`)
    console.log("📚 Hledám zdroje (cooldown: 90 dní)...")
    let idea: PostIdea | null = null
    let review: Review | null = null

    if (selectedType.name === "recenze") {
        const reviews = await getWeightedReviews(3)
        if (reviews.length > 0) {
            review = reviews[0]
            console.log(`   ✓ Recenze (weighted): "${review.quote.substring(0, 40)}..." (score: ${review.performance_score || 'N/A'})`)
        }
    } else {
        const ideas = await getWeightedIdeas(3)
        if (ideas.length > 0) {
            idea = ideas[0]
            console.log(`   ✓ Nápad (weighted): "${idea.title}" (score: ${idea.performance_score || 'N/A'}, ${ideas.length} dostupných)`)
        } else {
            console.log(`   ℹ️ Všechny nápady v cooldownu — Gemini vymyslí vlastní`)
        }
    }

    // 3. Get recent captions for dedup — include hook + body summary (not just hooks!)
    const recentPosts = await getRecentPosts(30)
    const recentHooks = recentPosts
        .map(p => {
            if (!p.caption) return ""
            const lines = p.caption.split("\n").filter(Boolean)
            const hook = lines[0]?.substring(0, 80) || ""
            const body = lines.slice(1).join(" ").substring(0, 120)
            return body ? `${hook} — ${body}` : hook
        })
        .filter(Boolean)

    // 4. Get performance data
    const _getPillarForType = createPillarMapper(config)
    const performance = options.performance || await analyzePerformance(config, _getPillarForType)

    // 4b. Smart product selection — cooldown-based from ig_products
    let selectedProduct: { name: string; type: string; slug: string; price?: string; description?: string; imageUrls?: string[] } | undefined = undefined
    let linkedProductId: string | undefined = undefined

    if (options.productId) {
        // Explicit product from ig_products DB table (user picked via @ mention)
        const { data: dbProduct } = await supabaseAdmin
            .from("ig_products")
            .select("id, name, type, slug, price, description, image_urls")
            .eq("id", options.productId)
            .single()
        if (dbProduct) {
            selectedProduct = {
                name: dbProduct.name,
                type: dbProduct.type || "product",
                slug: dbProduct.slug,
                price: dbProduct.price || undefined,
                description: dbProduct.description || undefined,
                imageUrls: dbProduct.image_urls || undefined,
            }
            linkedProductId = dbProduct.id
            console.log(`   🛍️ Explicit product (from DB): "${selectedProduct.name}"`)
        }
    } else if (selectedType.uses_product) {
        // Smart: cooldown-based selection from ig_products
        const cooldownDays = config.productCooldownDays ?? 14
        const cooldownDate = new Date()
        cooldownDate.setDate(cooldownDate.getDate() - cooldownDays)

        const { data: candidates } = await supabaseAdmin
            .from("ig_products")
            .select("id, name, type, slug, price, description, image_urls")
            .eq("client_id", clientUuid)
            .or(`last_used_at.is.null,last_used_at.lt.${cooldownDate.toISOString()}`)
            .order("last_used_at", { ascending: true, nullsFirst: true })
            .limit(5)

        if (candidates && candidates.length > 0) {
            // Pick from top 3 least-recently-used (slight randomness to avoid predictability)
            const pick = candidates[Math.floor(Math.random() * Math.min(3, candidates.length))]
            selectedProduct = {
                name: pick.name,
                type: pick.type || "product",
                slug: pick.slug,
                price: pick.price || undefined,
                description: pick.description || undefined,
                imageUrls: pick.image_urls || undefined,
            }
            linkedProductId = pick.id
            console.log(`   🛍️ Smart product (cooldown ${cooldownDays}d): "${selectedProduct.name}"`)
        } else {
            console.log(`   ℹ️ All products in cooldown (${cooldownDays}d) — generating without product`)
        }
    }

    // 5. Generate caption / video script / carousel
    const format = getPostFormat(config, selectedType.name)

    // Category format override — preferences from pillar category config
    const _pillarKey = _getPillarForType(selectedType.name)
    const _pillarCfg = config.contentPillars[_pillarKey]
    const _category = idea?.subcategory
        ? _pillarCfg?.categories?.find((c: any) => c.id === idea.subcategory)
        : undefined

    if (_category?.medium && _category.medium !== "auto") {
        format.medium = _category.medium
        if (_category.medium === "carousel" && format.overlayStyle === "none") {
            format.overlayStyle = "cover"
        }
        console.log(`   📁 Kategorie "${_category.label}" → medium: ${_category.medium}`)
    }
    if (_category?.overlayStyle && _category.overlayStyle !== "auto") {
        format.overlayStyle = _category.overlayStyle
        console.log(`   🎨 Kategorie "${_category.label}" → overlay: ${_category.overlayStyle}`)
    }
    if (_category?.aspectRatio && _category.aspectRatio !== "auto") {
        format.aspectRatio = _category.aspectRatio as any
        console.log(`   📐 Kategorie "${_category.label}" → ratio: ${_category.aspectRatio}`)
    }

    // User override: if aspectRatio is provided, use it (highest priority)
    if (options.aspectRatio) {
        format.aspectRatio = options.aspectRatio as any
        console.log(`   📐 Formát přepsán uživatelem: ${options.aspectRatio}`)
    }
    // User override: force medium (image/carousel/reel)
    if (options.medium) {
        format.medium = options.medium
        if (options.medium === "carousel" && format.overlayStyle === "none") {
            format.overlayStyle = "cover"
        }
        console.log(`   📐 Médium přepsáno uživatelem: ${options.medium}`)
    }

    // Smart overlay rotation — for image posts only, auto-select layout variant
    if (format.medium === "image" && format.overlayStyle === "default") {
        // Extract recent overlay styles from recent posts' image_style field
        // If no history, just vary based on post type
        const recentStyles = recentPosts
            .filter(p => p.image_style && p.image_style.startsWith("overlay:"))
            .slice(0, 3)
            .map(p => p.image_style.replace("overlay:", ""))
        const smartOverlay = selectOverlayVariant(selectedType.name, recentStyles)
        format.overlayStyle = smartOverlay
        console.log(`   🎨 Smart overlay: "${smartOverlay}" (${recentStyles.length ? `avoided: ${recentStyles.join(", ")}` : "no history"})`)
    }

    const isReel = format.medium === "reel"
    const isCarousel = format.medium === "carousel"
    const postFormat = isReel ? "video script" : isCarousel ? "carousel" : "caption"
    await report("copywriter", 25, `✍️ Copywriter generuje ${postFormat}...`)
    console.log(`✍️  Generuji ${postFormat} (Gemini 3.5 Flash)...`)
    let megaPrompt = buildMegaPrompt(config, selectedType, idea, review, recentHooks, performance, options.topic, selectedProduct, format)

    // Inject brand memories (long-term learning from past performance)
    try {
        const memories = await getBrandMemories(8)
        if (memories.length > 0) {
            megaPrompt += formatMemoriesForPrompt(memories)
            console.log(`   🧠 Brand memory: ${memories.length} vzorců načteno`)
        }
    } catch {
        // Non-fatal — continue without memories
    }

    // Inject real-world context (season, industry trends, local relevance)
    await report("copywriter", 30, "🌍 Context Agent sbírá sezónní a oborový kontext...")
    try {
        const { gatherContext, formatContextForPrompt } = await import("./context-agent")
        const context = await gatherContext(config, "single", selectedType.name)
        megaPrompt += formatContextForPrompt(context)
        const holidayInfo = context.holidays.length > 0 ? ` | 📅 ${context.holidays[0]}` : ""
        console.log(`   🌍 Context: ${context.season}${holidayInfo} | ${context.pulse.length} signálů`)
        cost += COSTS.contextAgent
    } catch (err: any) {
        console.warn(`   ⚠️ Context agent skipped: ${err?.message?.substring(0, 60)}`)
    }

    // Inject campaign continuity context
    if (options.campaignContext && options.campaignContext.previousPosts.length > 0) {
        const cc = options.campaignContext
        const prevSummary = cc.previousPosts.map((p, i) => `  ${i + 1}. Hook: "${p.hook}" | Téma: ${p.topic}`).join("\n")
        megaPrompt += `\n\n## 🎯 KAMPAŇ — NÁVAZNOST PŘÍSPĚVKŮ (KRITICKÉ!)\nToto je příspěvek **${cc.postNumber}/${cc.totalPosts}** v rámci koherentní kampaně.\n\n### Předchozí příspěvky v kampani:\n${prevSummary}\n\n### INSTRUKCE PRO NÁVAZNOST:\n- Tento post MUSÍ tematicky navazovat na předchozí — buduj na nich, prohlubuj téma, přidej nový úhel\n- NEOPAKUJ stejný hook ani stejný argument — posuň příběh dál\n- Zachovej konzistentní tón a vizuální styl napříč celou kampaní\n- Pokud je zadané hlavní téma kampaně, drž se ho ale z jiného úhlu než předchozí posty\n- Série by měla fungovat jako storytelling: každý post přidává novou vrstvu\n`
        console.log(`   🎯 Campaign context: post ${cc.postNumber}/${cc.totalPosts} (${cc.previousPosts.length} previous)`)
    }

    const schema = isReel ? buildVideoSchema(config) : isCarousel ? buildCarouselSchema(config) : buildCaptionSchema(config)
    const rawText = await generateText(megaPrompt, { responseSchema: schema, model: "gemini-3.5-flash" })
    cost += COSTS.textGeneration

    let captionData: {
        hook: string
        body?: string
        cta: string
        hashtags: string[]
        imagePrompt?: string
        imageSubtext?: string
        accentWords?: string[]
        videoScript?: string
        scenes?: { timeRange: string; visual: string; camera: string; mood: string; narration?: string; soundEffect?: string }[]
        caption?: string
        slides?: { headline: string; subtext: string; imagePrompt: string }[]
        visualTheme?: string
    }

    try {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/)
        captionData = JSON.parse(jsonMatch?.[0] || rawText)
    } catch (e) {
        console.error("   ⚠️ JSON parse failed, raw:", rawText.substring(0, 200))
        throw new Error(`Caption generation failed: ${e}`)
    }

    // For reels: caption field replaces body
    if (isReel && captionData.caption) {
        captionData.body = captionData.caption
    }

    // 6. Dedup check — hook similarity + body keyword overlap
    const hookDuplicate = recentHooks.some(h => isHookSimilar(captionData.hook, h, 0.5))
    const recentBodies = recentPosts
        .map(p => p.caption?.split("\n").slice(1).join(" ") || "")
        .filter(b => b.length > 20)
    const bodyDuplicate = captionData.body ? isBodySimilar(captionData.body, recentBodies, 0.4) : false
    const isDuplicate = hookDuplicate || bodyDuplicate

    if (isDuplicate) {
        const reason = hookDuplicate ? "hook" : "téma/body"
        console.log(`   ⚠️ Duplicitní ${reason} detekován — regeneruji...`)
        const retryPrompt = megaPrompt + `\n\nDŮLEŽITÉ: Předchozí verze měla duplicitní ${reason}!\nOdmítnutý hook: "${captionData.hook}"\n${bodyDuplicate ? `Odmítnuté body: "${captionData.body?.substring(0, 100)}..."\n` : ""}Vymysli ÚPLNĚ jiný úhel pohledu, jiný hook, jiné argumenty.`
        const retryText = await generateText(retryPrompt, { responseSchema: schema })
        cost += COSTS.textGeneration
        try {
            const jsonMatch = retryText.match(/\{[\s\S]*\}/)
            captionData = JSON.parse(jsonMatch?.[0] || retryText)
            if (isReel && captionData.caption) captionData.body = captionData.caption
            console.log(`   ✓ Nový hook: "${captionData.hook.substring(0, 50)}..."`)
        } catch {
            console.log("   ⚠️ Regeneration parse failed — pokračuji s originálem")
        }
    }

    // 6b. Quality gate — Critic + Chief Editor multi-round review
    await report("critic", 45, "🔍 Kritik hodnotí kvalitu obsahu...")
    console.log("🔍 Quality gate (Critic + Šéfredaktor review)...")
    const { score, feedback, detail } = await scorePost(
        config,
        captionData as { hook: string; body?: string; cta: string; hashtags: string[]; slides?: { headline: string; subtext: string }[] },
        selectedType.name
    )
    cost += COSTS.textGeneration
    const scoreEmoji = score >= 8 ? "🟢" : score >= 6 ? "🟡" : "🔴"
    console.log(`   ${scoreEmoji} Score: ${score}/10 — ${feedback}`)
    if (detail) {
        console.log(`   📊 Hook: ${detail.hookScore}/3 | Body: ${detail.bodyScore}/3 | CTA: ${detail.ctaScore}/2 | Orig: ${detail.originalityScore}/2`)
        if (detail.feedback.keep.length > 0) console.log(`   ✅ Zachovat: ${detail.feedback.keep.join(", ")}`)
        if (detail.feedback.fix.length > 0) console.log(`   🔧 Opravit: ${detail.feedback.fix.join(", ")}`)
    }

    // Editorial Board — multi-round review by Chief Editor
    const editorialResult = await reviewPost(
        config,
        captionData,
        selectedType.name,
        { score, feedback, detail },
        megaPrompt,
        report,
    )
    captionData = editorialResult.captionData
    cost += editorialResult.totalTokenCost
    if (isReel && captionData.caption) captionData.body = captionData.caption

    const editorialRounds = editorialResult.rounds.length
    console.log(`   🎖️ Editorial: ${editorialResult.approved ? "✅ schváleno" : "⏰ max kol"} po ${editorialRounds} ${editorialRounds === 1 ? "kole" : "kolech"} ($${editorialResult.totalTokenCost.toFixed(3)})`)

    // Use client-specific hashtags
    let finalHashtags: string[]
    if (config.hashtagPools) {
        const pools = config.hashtagPools
        const hashtags = new Set<string>()
        pools.core.forEach(tag => hashtags.add(tag))
        captionData.hashtags?.slice(0, 4).forEach(tag => {
            const formatted = tag.startsWith("#") ? tag : `#${tag}`
            hashtags.add(formatted.toLowerCase())
        })
        const fillTags = [...(pools.niche || []), ...(pools.broad || [])].sort(() => Math.random() - 0.5)
        for (const tag of fillTags) {
            if (hashtags.size >= 10) break
            hashtags.add(tag)
        }
        if (hashtags.size < 10 && pools.trending?.length) {
            hashtags.add(pools.trending[Math.floor(Math.random() * pools.trending.length)])
        }
        finalHashtags = Array.from(hashtags).slice(0, 10)
    } else {
        finalHashtags = (captionData.hashtags || []).slice(0, 10).map(tag =>
            tag.startsWith("#") ? tag : `#${tag}`
        )
    }
    const fullCaption = `${captionData.hook}\n\n${captionData.body || ""}\n\n${captionData.cta}\n\n${finalHashtags.join(" ")}`
    console.log(`   ✓ Caption (${fullCaption.length} znaků)`)

    // 7. Generate media (VIDEO or IMAGE)
    let imageUrl: string | undefined

    if (!options.dryRun) {
        if (isReel && (captionData.scenes?.length || captionData.videoScript)) {
            // ══════════════════════════════════════════════
            // VIDEO GENERATION PATH (Full Production Pipeline)
            // Veo 3.1 → TTS Voiceover → FFmpeg Post-Process → Cover Image
            // ══════════════════════════════════════════════
            const duration = getReelDuration(selectedType.name, config)

            // Step 1: Refine video prompt from structured scenes
            await report("video", 40, "🧠 Video Director vylepšuje scénář...")
            console.log("🧠 Vylepšuji video prompt (structured scenes → Veo 3.1)...")
            const refinedVideoPrompt = await refineVideoPrompt(
                config,
                { hook: captionData.hook, scenes: captionData.scenes, videoScript: captionData.videoScript },
                selectedType.name,
                duration
            )
            cost += COSTS.promptRefinement
            console.log(`   ✓ Video prompt refined (${refinedVideoPrompt.length} chars)`)

            // Step 2: Load brand reference images for Veo (spaces, products, interiors)
            const videoRefImages: { buffer: Buffer; mimeType?: string }[] = []
            const { getConfigBrandImageObjects } = await import("./configs/types")
            const brandRefObjects = getConfigBrandImageObjects(config)

            if (brandRefObjects.length > 0) {
                console.log(`📸 Loading reference images for Veo (${brandRefObjects.length} available)...`)
                // Smart selection: match brand photos to video scene context
                const videoContext = [
                    captionData.hook,
                    captionData.scenes?.map(s => s.visual).join(" ") || "",
                    captionData.videoScript || "",
                ].join(" ").toLowerCase()

                const scored = brandRefObjects.map(img => {
                    let score = 0
                    for (const tag of img.tags) {
                        if (videoContext.includes(tag)) score += 3
                    }
                    if (img.description) {
                        for (const word of img.description.toLowerCase().split(/\s+/)) {
                            if (word.length > 3 && videoContext.includes(word)) score += 1
                        }
                    }
                    return { ...img, score }
                })

                scored.sort((a, b) => b.score - a.score)
                const topPicks = scored[0]?.score > 0
                    ? scored.filter(s => s.score > 0).slice(0, 3)
                    : scored.sort(() => Math.random() - 0.5).slice(0, 3)

                for (const ref of topPicks) {
                    try {
                        const resp = await fetch(ref.url)
                        if (resp.ok) {
                            const arrayBuf = await resp.arrayBuffer()
                            videoRefImages.push({
                                buffer: Buffer.from(arrayBuf),
                                mimeType: ref.url.endsWith(".png") ? "image/png" : "image/jpeg",
                            })
                            console.log(`   📸 Loaded: ${ref.url.split("/").pop()?.substring(0, 30)} [${ref.tags.join(",")}]`)
                        }
                    } catch {
                        // Non-fatal
                    }
                }
                if (videoRefImages.length > 0) {
                    console.log(`   ✓ ${videoRefImages.length} reference images for Veo`)
                }
            }

            // Step 3: Generate raw video (Veo 3.1 with native audio + reference images)
            await report("video", 50, `🎬 Veo 3.1 generuje ${duration}s video...`)
            console.log(`🎬 Generuji video (Veo 3.1 Fast, ${duration}s, 9:16)...`)
            let videoBuffer: Buffer | undefined
            try {
                videoBuffer = await generateVideo(refinedVideoPrompt, {
                    duration,
                    aspectRatio: "9:16",
                    fast: true,
                    referenceImages: videoRefImages.length > 0 ? videoRefImages : undefined,
                })
                cost += COSTS.videoPerSecond * duration
                console.log(`   ✓ Raw video (${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB, ${duration}s)`)
            } catch (vidErr) {
                console.error("   ⚠️ Video generation failed:", vidErr)
            }

            // Step 3: Generate TTS voiceover from scene narrations
            let voiceoverBuffer: Buffer | undefined
            const narrationTexts = captionData.scenes
                ?.filter(s => s.narration)
                .map(s => s.narration!) || []

            if (narrationTexts.length > 0) {
                await report("video", 65, "🎙️ Generuji český voiceover...")
                console.log(`🎙️ Generuji voiceover (${narrationTexts.length} scén, Gemini TTS)...`)
                try {
                    const fullNarration = narrationTexts.join(". ")
                    voiceoverBuffer = await generateVoiceover(fullNarration, {
                        voice: config.ttsVoice || "Kore",
                        mood: "professional",
                    })
                    cost += COSTS.ttsVoiceover
                    console.log(`   ✓ Voiceover (${(voiceoverBuffer.length / 1024).toFixed(0)} KB)`)
                } catch (ttsErr) {
                    console.warn("   ⚠️ TTS voiceover failed (continuing without):", ttsErr)
                }
            }

            // Step 4: FFmpeg post-processing (merge audio + burn subtitles)
            if (videoBuffer && (voiceoverBuffer || (captionData.scenes?.length && captionData.scenes.some(s => s.narration)))) {
                await report("video", 75, "🎞️ Post-processing video (audio mix + titulky)...")
                console.log("🎞️ FFmpeg post-processing...")
                try {
                    const subtitles = captionData.scenes ? scenesToSubtitles(captionData.scenes) : []
                    const processedBuffer = await processReelVideo({
                        videoBuffer,
                        voiceoverBuffer,
                        subtitles: subtitles.length > 0 ? subtitles : undefined,
                        voiceoverMix: 0.7,
                    })
                    videoBuffer = processedBuffer
                    console.log(`   ✓ Post-processed (${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB)`)
                } catch (ffErr) {
                    console.warn("   ⚠️ FFmpeg post-processing failed (using raw video):", ffErr)
                    // Continue with raw Veo video — still usable
                }
            }

            // Step 5: Upload final video
            if (videoBuffer) {
                await report("video", 85, "📤 Nahrávám video...")
                console.log("📤 Nahrávám video do Supabase...")
                const timestamp = Date.now()
                const filename = `ig-reels/${timestamp}.mp4`

                const { error: uploadError } = await supabaseAdmin.storage
                    .from("audit-screenshots")
                    .upload(filename, videoBuffer, {
                        contentType: "video/mp4",
                        cacheControl: "31536000",
                    })

                if (uploadError) {
                    console.error("   ⚠️ Upload failed:", uploadError.message)
                } else {
                    const { data: publicUrlData } = supabaseAdmin.storage
                        .from("audit-screenshots")
                        .getPublicUrl(filename)
                    imageUrl = publicUrlData.publicUrl
                    console.log(`   ✓ Video URL: ${imageUrl}`)
                }

                // Step 6: Generate cover image for feed grid
                await report("video", 90, "🖼️ Generuji cover image...")
                console.log("🖼️ Generuji cover image pro feed...")
                try {
                    const coverScene = captionData.scenes?.[0]?.visual || captionData.hook
                    const coverPrompt = `Instagram Reel cover image, 9:16 vertical. Scene: ${coverScene}. Style: ${config.feedAesthetic?.feel || "modern, professional"}. NO TEXT in image.`
                    const coverBuffer = await generateImage(coverPrompt, { aspectRatio: "9:16" })

                    if (coverBuffer) {
                        const coverFilename = `ig-reels/${timestamp}-cover.webp`
                        const { error: coverUploadErr } = await supabaseAdmin.storage
                            .from("audit-screenshots")
                            .upload(coverFilename, coverBuffer, {
                                contentType: "image/webp",
                                cacheControl: "31536000",
                            })
                        if (!coverUploadErr) {
                            const { data: coverUrl } = supabaseAdmin.storage
                                .from("audit-screenshots")
                                .getPublicUrl(coverFilename)
                            // Append cover URL with pipe separator (carousel convention)
                            imageUrl = `${imageUrl}|${coverUrl.publicUrl}`
                            console.log(`   ✓ Cover: ${coverUrl.publicUrl}`)
                        }
                    }
                    cost += COSTS.imageGeneration
                } catch (coverErr) {
                    console.warn("   ⚠️ Cover generation failed:", coverErr)
                }
            }
        } else if (options.customImageUrl) {
            // CUSTOM IMAGE GENERATION PATH
            console.log("📸 Používám vlastní obrázek od uživatele...")
            imageUrl = options.customImageUrl
            console.log(`   ✓ URL: ${imageUrl}`)
        } else if (isCarousel && captionData.slides) {
            // CAROUSEL GENERATION PATH (4 images)
            const slideCount = captionData.slides.length + 1
            console.log(`📸 Generuji carousel (${slideCount} slidů)...`)

            const allSlides = [
                { headline: captionData.hook, subtext: captionData.imageSubtext || "", imagePrompt: captionData.imagePrompt || "" },
                ...captionData.slides,
            ]

            console.log("🧠 Unified carousel prompt refinement...")
            const refinedPrompts = await refineCarouselPrompts(
                config,
                allSlides,
                captionData.visualTheme || "",
                selectedType.name
            )
            cost += COSTS.promptRefinement

            const uploadedUrls: string[] = []
            const bucketName = config.storageBucket || "audit-screenshots"

            for (let i = 0; i < allSlides.length; i++) {
                const slide = allSlides[i]
                const label = i === 0 ? "COVER" : `Slide ${i}`
                console.log(`\n   📄 ${label}: "${slide.headline}"`)

                // Retry once on failure (rate limiting, transient errors)
                for (let attempt = 0; attempt < 2; attempt++) {
                    try {
                        if (attempt > 0) {
                            console.log(`   🔄 Retry ${label} (attempt ${attempt + 1})...`)
                            await new Promise(r => setTimeout(r, 3000))
                        }

                        const refinedPrompt = refinedPrompts[i] || slide.imagePrompt
                        // Hard enforce: Imagen must NEVER render text in carousel backgrounds
                        const noTextPrompt = refinedPrompt.trim() + " IMPORTANT: NO TEXT, NO WORDS, NO LETTERS, NO SIGNS anywhere in the image. Pure background photo only."

                        const imageBuffer = await generateImage(noTextPrompt, { aspectRatio: format.aspectRatio as any })
                        cost += COSTS.imageGeneration
                        console.log(`   ✓ Obrázek ${i + 1} (${(imageBuffer.length / 1024).toFixed(0)} KB)`)

                        let finalImage: Buffer
                        if (format.overlayStyle === "none") {
                            finalImage = imageBuffer
                        } else {
                            finalImage = await overlayText(imageBuffer, {
                                headline: slide.headline,
                                subtext: slide.subtext,
                                slideInfo: { current: i + 1, total: allSlides.length },
                                variant: i === 0 ? "cover" : "step",
                                textAlign: config.feedAesthetic?.textAlign,
                                headlineScale: config.feedAesthetic?.headlineScale,
                                gradientColors: config.overlayGradient,
                                logoFile: config.logoFile,
                                fontFamily: config.feedAesthetic?.fontOverride,
                                accentColor: config.feedAesthetic?.accentColor,
                                accentWords: i === 0 ? captionData.accentWords : undefined,
                            })
                            console.log(`   ✓ Text overlay ${i + 1}`)

                            // Vision check on COVER slide only (saves cost)
                            if (i === 0) {
                                const coverCheck = await reviewOverlayComposition(finalImage, "cover", slide.headline)
                                cost += COSTS.textGeneration
                                if (!coverCheck.ok && coverCheck.issues.length > 0) {
                                    console.log(`   ⚠️ Cover overlay: ${coverCheck.issues.join(", ")}`)
                                    try {
                                        const fixHint = coverCheck.compositionHint ? `\nCOMPOSITION: ${coverCheck.compositionHint}. Leave BOTTOM area clear for text.` : ""
                                        const coverRetry = await generateImage((refinedPrompts[0] || slide.imagePrompt) + fixHint + " NO TEXT.", { aspectRatio: format.aspectRatio as any })
                                        cost += COSTS.imageGeneration
                                        finalImage = await overlayText(coverRetry, {
                                            headline: slide.headline, subtext: slide.subtext,
                                            slideInfo: { current: 1, total: allSlides.length },
                                            variant: "cover",
                                            textAlign: config.feedAesthetic?.textAlign,
                                            headlineScale: config.feedAesthetic?.headlineScale,
                                            gradientColors: config.overlayGradient,
                                            logoFile: config.logoFile,
                                            fontFamily: config.feedAesthetic?.fontOverride,
                                            accentColor: config.feedAesthetic?.accentColor,
                                            accentWords: captionData.accentWords,
                                        })
                                        console.log(`   ✓ Cover retry OK`)
                                    } catch (retryErr: any) {
                                        console.warn(`   ⚠️ Cover retry failed: ${retryErr?.message?.substring(0, 60)}`)
                                    }
                                } else {
                                    console.log(`   ✅ Cover kompozice OK`)
                                }
                            }
                        }

                        console.log("🗜️ Komprimuji obrázek před uploadem (PNG -> WebP)...")
                        const compressedImage = await sharp(finalImage)
                            .webp({ quality: 90, effort: 6 })
                            .toBuffer()

                        const timestamp = Date.now()
                        const filename = `ig-carousel/${timestamp}-slide${i}.webp`

                        const { error: uploadError } = await supabaseAdmin.storage
                            .from(bucketName)
                            .upload(filename, compressedImage, {
                                contentType: "image/webp",
                                cacheControl: "31536000",
                            })

                        if (uploadError) {
                            console.error(`   ⚠️ Upload slide ${i} failed:`, uploadError.message)
                        } else {
                            const { data: publicUrlData } = supabaseAdmin.storage
                                .from(bucketName)
                                .getPublicUrl(filename)
                            uploadedUrls.push(publicUrlData.publicUrl)
                            console.log(`   ✓ Uploaded`)
                        }
                        break // success — exit retry loop
                    } catch (slideErr: any) {
                        console.error(`   ⚠️ ${label} failed (attempt ${attempt + 1}):`, slideErr?.message?.substring(0, 150))
                        if (attempt === 1) {
                            console.error(`   ❌ ${label} SKIPPED after 2 attempts`)
                        }
                    }
                }

                // Rate limit protection: 2s delay between slides (Imagen API)
                if (i < allSlides.length - 1) {
                    await new Promise(r => setTimeout(r, 2000))
                }

                // Progress report per slide
                const slideProgress = 55 + Math.round((i + 1) / allSlides.length * 30)
                await report("rendering", slideProgress, `📄 Slide ${i + 1}/${allSlides.length} hotový`)
            }

            if (uploadedUrls.length > 0) {
                imageUrl = uploadedUrls.join("|")
                console.log(`\n   ✓ Carousel: ${uploadedUrls.length}/${slideCount} slidů nahráno`)
                if (uploadedUrls.length < slideCount) {
                    console.warn(`   ⚠️ Carousel incomplete: only ${uploadedUrls.length}/${slideCount} slides succeeded`)
                }
            }
        } else {
            // IMAGE GENERATION PATH
            await report("art_director", 55, "🎨 Art Director vylepšuje image prompt...")
            console.log("🧠 Vylepšuji image prompt (2-step pipeline)...")
            const bodySnippet = captionData.body ? captionData.body.substring(0, 150) : undefined
            let refinedPrompt = await refineImagePrompt(
                config,
                captionData as { imagePrompt: string; hook: string; imageSubtext?: string },
                selectedType.name,
                bodySnippet,
                undefined,
                format.overlayStyle, // overlay variant → Art Director composes for negative space
            )
            cost += COSTS.promptRefinement
            // Hard enforce: Imagen/Gemini must NEVER render text in the background image
            // Text is added programmatically via Satori overlay — double rendering = broken UI
            refinedPrompt = refinedPrompt.trim() + " IMPORTANT: NO TEXT, NO WORDS, NO LETTERS, NO SIGNS anywhere in the image. Pure background photo only."
            console.log(`   ✓ Prompt refined`)

            try {
                let imageBuffer: Buffer

                // Load reference images
                const refImages: { buffer: Buffer; mimeType?: string; label?: string }[] = []

                // Load brand reference images (scraped or uploaded)
                const { getConfigBrandImageObjects } = await import("./configs/types")
                const brandRefObjects = getConfigBrandImageObjects(config)

                if (brandRefObjects.length > 0) {
                    // Dynamic label based on what the brand actually is
                    const industry = config.industry || ''
                    const isLocation = /ubytov|hotel|penzion|apartm|restaurac|kavárn|bar\b|wellness|spa/i.test(industry)
                        || /ubytov|hotel|penzion|apartm/i.test(config.name || '')
                    const isProduct = /e-?shop|obchod|product|merch|fashion|oblečen/i.test(industry)

                    const refLabel = isLocation
                        ? "brand environment reference — use this EXACT location, interior, and atmosphere in your image"
                        : isProduct
                            ? "brand product reference — maintain this exact visual style, colors, and product aesthetic"
                            : "brand visual reference — maintain this exact visual style, colors, and aesthetic atmosphere"

                    // Smart selection: match photos to post context using tags
                    let selectedRefs: { url: string; tags: string[]; description: string }[]

                    const hasTaggedImages = brandRefObjects.some(img => img.tags.length > 0)

                    if (hasTaggedImages && brandRefObjects.length > 3) {
                        // Build context string from post content
                        const postContext = [
                            selectedType?.name || '',
                            captionData?.hook || '',
                            (captionData as any)?.body?.substring(0, 100) || '',
                            (captionData as any)?.imagePrompt || '',
                        ].join(' ').toLowerCase()

                        // Score each image based on tag/description match to post context
                        const scored = brandRefObjects.map(img => {
                            let score = 0
                            // Tag matching
                            for (const tag of img.tags) {
                                if (postContext.includes(tag)) score += 3
                            }
                            // Description keyword matching
                            if (img.description) {
                                const descWords = img.description.toLowerCase().split(/\s+/)
                                for (const word of descWords) {
                                    if (word.length > 3 && postContext.includes(word)) score += 1
                                }
                            }
                            return { ...img, score }
                        })

                        // Sort by relevance, then add randomness for variety
                        scored.sort((a, b) => b.score - a.score)

                        // Take top-scored images, with some randomness among equal scores
                        const topScore = scored[0]?.score || 0
                        if (topScore > 0) {
                            // At least some matches found — pick best
                            const relevant = scored.filter(s => s.score > 0)
                            const topPicks = relevant.slice(0, 3)
                            console.log(`   🎯 Smart selection: picked ${topPicks.length} tagged images (scores: ${topPicks.map(s => s.score).join(',')})`)
                            selectedRefs = topPicks
                        } else {
                            // No tag matches — fall back to random
                            selectedRefs = brandRefObjects.sort(() => Math.random() - 0.5).slice(0, 3)
                            console.log(`   🎲 No tag matches — random ${selectedRefs.length} images`)
                        }
                    } else {
                        // No tagged images or too few — random selection (backward compat)
                        selectedRefs = brandRefObjects.length <= 3
                            ? brandRefObjects
                            : brandRefObjects.sort(() => Math.random() - 0.5).slice(0, 3)
                    }

                    for (const ref of selectedRefs) {
                        try {
                            const resp = await fetch(ref.url)
                            if (resp.ok) {
                                const arrayBuf = await resp.arrayBuffer()
                                // Build label from tag data if available
                                const contextLabel = ref.description
                                    ? `${refLabel} — ${ref.description}`
                                    : refLabel
                                refImages.push({
                                    buffer: Buffer.from(arrayBuf),
                                    mimeType: ref.url.endsWith(".png") ? "image/png" : "image/jpeg",
                                    label: contextLabel,
                                })
                                const tagInfo = ref.tags.length > 0 ? ` [${ref.tags.join(',')}]` : ''
                                console.log(`   📸 Loaded brand ref: ${ref.url.split("/").pop()?.substring(0, 30)}${tagInfo}`)
                            }
                        } catch (err) {
                            console.warn(`   ⚠️ Brand ref error: ${(err as Error).message?.substring(0, 60)}`)
                        }
                    }
                }

                // Load product photos — use the SAME product that was pre-selected for caption
                if (selectedProduct?.slug) {
                    const randomProduct = selectedProduct

                    let productImageLoaded = false

                    // Priority 0: Use product's own image_urls from ig_products DB
                    if (!productImageLoaded && selectedProduct.imageUrls?.length) {
                        try {
                            const imageUrl = selectedProduct.imageUrls[0]
                            const resp = await fetch(imageUrl)
                            if (resp.ok) {
                                const arrayBuf = await resp.arrayBuffer()
                                const mimeType = imageUrl.endsWith(".png") ? "image/png" : "image/jpeg"
                                refImages.push({
                                    buffer: Buffer.from(arrayBuf),
                                    mimeType,
                                    label: `EXACT product photo: ${randomProduct.name}`,
                                })
                                productImageLoaded = true
                                console.log(`   🛍️ Loaded product image from DB image_urls: ${imageUrl.substring(0, 80)}...`)
                            }
                        } catch (err) {
                            console.warn(`   ⚠️ DB image_url fetch failed, trying storage...`)
                        }
                    }

                    // Priority 1: Supabase storage (works on Vercel + local)
                    if (!productImageLoaded && randomProduct.slug) {
                        try {
                            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
                            if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL not set')
                            const { default: supabaseAdmin } = await import("../supabase/admin")
                            const { data: files } = await supabaseAdmin.storage
                                .from('product-images')
                                .list(config.id, { search: randomProduct.slug })

                            const matchingFiles = (files || [])
                                .filter(f => f.name.startsWith(randomProduct.slug) && /\.(jpg|jpeg|png|webp)$/i.test(f.name))
                                .sort((a, b) => a.name.localeCompare(b.name))

                            if (matchingFiles.length > 0) {
                                const mainFile = matchingFiles[0].name
                                const publicUrl = `${supabaseUrl}/storage/v1/object/public/product-images/${config.id}/${mainFile}`
                                const resp = await fetch(publicUrl)
                                if (resp.ok) {
                                    const arrayBuf = await resp.arrayBuffer()
                                    const mimeType = mainFile.endsWith(".png") ? "image/png" : "image/jpeg"
                                    refImages.push({
                                        buffer: Buffer.from(arrayBuf),
                                        mimeType,
                                        label: `EXACT product photo: ${randomProduct.name}`,
                                    })
                                    productImageLoaded = true
                                    console.log(`   🛍️ Loaded product image from Supabase: ${mainFile}`)
                                }
                            }
                        } catch (err) {
                            // Supabase not available, try local
                        }
                    }

                    // Priority 2: Local filesystem fallback (dev only)
                    if (!productImageLoaded) {
                        try {
                            const { readdir, readFile } = await import("fs/promises")
                            const { join, dirname } = await import("path")
                            const { fileURLToPath } = await import("url")
                            const baseDir = dirname(fileURLToPath(import.meta.url))
                            const productDir = join(baseDir, "product-images", config.id)

                            const localFiles = await readdir(productDir).catch(() => [] as string[])
                            const productFiles = localFiles
                                .filter(f => f.startsWith(randomProduct.slug) && /\.(jpg|jpeg|png|webp)$/i.test(f))
                                .sort()

                            if (productFiles.length > 0) {
                                const mainFile = productFiles[0]
                                const imgBuffer = await readFile(join(productDir, mainFile))
                                const mimeType = mainFile.endsWith(".png") ? "image/png" : "image/jpeg"
                                refImages.push({
                                    buffer: imgBuffer,
                                    mimeType,
                                    label: `EXACT product photo: ${randomProduct.name}`,
                                })
                                productImageLoaded = true
                                console.log(`   🛍️ Loaded local product image: ${mainFile}`)
                            }
                        } catch (err) {
                            // Local files not available
                        }
                    }

                    if (productImageLoaded) {
                        refinedPrompt = `CRITICAL INSTRUCTION: One of the attached reference images shows the EXACT product "${randomProduct.name}". You MUST reproduce this product's design FAITHFULLY — same colors, same logo placement, same print/pattern. Do NOT invent new designs. The product must look IDENTICAL to the reference photo. ABSOLUTELY NEVER misspell, abbreviate, or distort any text visible on the product. If the product says "Zero Fucks Given", it MUST say exactly "Zero Fucks Given" — not "ZFKG", not "Zgarj", not any creative reinterpretation. Treat every letter on the reference as sacred ground truth. Show this exact product in the scene described below.\n\n${refinedPrompt}`
                        console.log(`   📌 Product constraint: "${randomProduct.name}" — exact design enforced`)
                    }
                }
                // ─── IMAGE STRATEGY: Real photos first, generation as fallback ───
                // If brand has reference photos → ALWAYS edit a real one
                // Never generate fake scenes when real photos exist

                if (refImages.length > 0) {
                    try {
                        // Pick the best matching real photo (already smart-selected above)
                        const bestRef = refImages[0]

                        await report("rendering", 65, `🖼️ Edituji reálnou fotku...`)
                        console.log(`📸 Editing REAL brand photo (not generating fake scene)`)
                        console.log(`   📎 Using: ${bestRef.label?.substring(0, 80) || 'brand photo'}`)

                        // Build edit prompt: preserve the real scene, enhance creatively
                        const editPrompt = `Edit this real photograph to match the following creative direction:

${refinedPrompt}

CRITICAL RULES:
- This is a REAL photograph from the brand. PRESERVE the authentic environment, space, and atmosphere.
- You may add creative elements (people, animals, objects, mood lighting) but the REAL location/product/food must remain recognizable.
- Make any additions look natural and photorealistic — as if they were really there when the photo was taken.
- DO NOT replace the entire scene. The original photo IS the scene.
- DO NOT change the core subject (the room, the food, the product, the building).
- ABSOLUTELY NO TEXT, NO WORDS, NO LETTERS anywhere in the image.
- If the creative direction doesn't require adding anything, simply enhance the photo (better lighting, color grading, professional touch) while keeping it 100% authentic.`

                        const { editExistingImage } = await import("./gemini-client")
                        imageBuffer = await editExistingImage(
                            bestRef.buffer,
                            editPrompt,
                            {
                                mimeType: bestRef.mimeType,
                                aspectRatio: format.aspectRatio,
                                resolution: "2K",
                            }
                        )
                        console.log(`   ✓ Real photo edited (${(imageBuffer.length / 1024).toFixed(0)} KB)`)
                    } catch (editErr: any) {
                        console.warn(`   ⚠️ Photo editing failed: ${editErr.message?.substring(0, 100)}`)
                        console.log(`   🔄 Fallback → generating with references...`)
                        try {
                            imageBuffer = await generateImageWithReferences(
                                refinedPrompt, refImages,
                                { aspectRatio: format.aspectRatio, resolution: "2K" }
                            )
                        } catch (refErr: any) {
                            console.warn(`   ⚠️ Ref generation also failed: ${refErr.message?.substring(0, 100)}`)
                            console.log("🎨 Final fallback → Nano Banana Pro (no refs)...")
                            imageBuffer = await generateImage(refinedPrompt, { aspectRatio: format.aspectRatio as any })
                        }
                    }
                }
                // No reference photos at all → pure generation (only fallback)
                else {
                    console.log("🎨 No brand photos available → Nano Banana Pro (2K)...")
                    imageBuffer = await generateImage(refinedPrompt, { aspectRatio: format.aspectRatio as any })
                }
                cost += COSTS.imageGeneration
                console.log(`   ✓ Obrázek (${(imageBuffer.length / 1024).toFixed(0)} KB, 2K resolution)`)

                // Step 3: Overlay text
                let finalImage: Buffer
                if (format.overlayStyle === "none") {
                    console.log(`🎭 ${selectedType.name} — overlay: none (raw image)`)
                    finalImage = imageBuffer
                } else {
                    console.log("✏️  Přidávám text (programaticky — bez chyb)...")
                    finalImage = await overlayText(imageBuffer, {
                        headline: captionData.hook,
                        subtext: captionData.imageSubtext,
                        variant: (format.overlayStyle || "default") as any,
                        textAlign: config.feedAesthetic?.textAlign,
                        headlineScale: config.feedAesthetic?.headlineScale,
                        gradientColors: config.overlayGradient,
                        logoFile: config.logoFile,
                        fontFamily: config.feedAesthetic?.fontOverride,
                        accentColor: config.feedAesthetic?.accentColor,
                        accentWords: captionData.accentWords,
                    })
                    console.log(`   ✓ Text overlay (${(finalImage.length / 1024).toFixed(0)} KB)`)

                    // Step 3b: Vision check — does text cover face/product?
                    await report("chief_editor", 75, "👁️ Šéfredaktor kontroluje kompozici obrázku...")
                    console.log("👁️ Vision check — kontrola overlay kompozice...")
                    const overlayCheck = await reviewOverlayComposition(
                        finalImage,
                        format.overlayStyle || "default",
                        captionData.hook,
                    )
                    cost += COSTS.textGeneration // vision check cost

                    if (!overlayCheck.ok && overlayCheck.issues.length > 0) {
                        console.log(`   ⚠️ Overlay problém: ${overlayCheck.issues.join(", ")}`)
                        console.log(`   🔄 Regeneruji obrázek s lepší kompozicí...`)

                        // Retry: add composition hint to prompt and regenerate
                        const compositionFix = overlayCheck.compositionHint
                            ? `\nCOMPOSITION FIX: ${overlayCheck.compositionHint}. Leave the ${format.overlayStyle === "top" || format.overlayStyle === "editorial" ? "top" : "bottom"} area COMPLETELY CLEAR for text overlay.`
                            : ""
                        const fixedPrompt = refinedPrompt + compositionFix

                        try {
                            const retryBuffer = await generateImage(fixedPrompt, { aspectRatio: format.aspectRatio as any })
                            cost += COSTS.imageGeneration
                            console.log(`   ✓ Retry obrázek (${(retryBuffer.length / 1024).toFixed(0)} KB)`)

                            // Re-apply overlay on new image
                            finalImage = await overlayText(retryBuffer, {
                                headline: captionData.hook,
                                subtext: captionData.imageSubtext,
                                variant: (format.overlayStyle || "default") as any,
                                textAlign: config.feedAesthetic?.textAlign,
                                headlineScale: config.feedAesthetic?.headlineScale,
                                gradientColors: config.overlayGradient,
                                logoFile: config.logoFile,
                                fontFamily: config.feedAesthetic?.fontOverride,
                                accentColor: config.feedAesthetic?.accentColor,
                                accentWords: captionData.accentWords,
                            })
                            console.log(`   ✓ Retry overlay (${(finalImage.length / 1024).toFixed(0)} KB)`)
                        } catch (retryErr: any) {
                            console.warn(`   ⚠️ Retry failed: ${retryErr?.message?.substring(0, 80)} — using original`)
                        }
                    } else {
                        console.log(`   ✅ Overlay kompozice OK`)
                    }
                }

                console.log("🗜️ Komprimuji obrázek před uploadem (PNG -> WebP)...")
                const compressedImage = await sharp(finalImage)
                    .webp({ quality: 90, effort: 6 })
                    .toBuffer()

                console.log(`   ✓ WebP size: ${(compressedImage.length / 1024).toFixed(0)} KB`)

                await report("uploading", 85, "📤 Nahrávám do Supabase...")
                console.log("📤 Nahrávám do Supabase...")
                const timestamp = Date.now()
                const filename = `ig-posts/${timestamp}.webp`
                const bucketName = config.storageBucket || "audit-screenshots"

                const { error: uploadError } = await supabaseAdmin.storage
                    .from(bucketName)
                    .upload(filename, compressedImage, {
                        contentType: "image/webp",
                        cacheControl: "31536000",
                    })

                if (uploadError) {
                    console.error("   ⚠️ Upload failed:", uploadError.message)
                } else {
                    const { data: publicUrlData } = supabaseAdmin.storage
                        .from(bucketName)
                        .getPublicUrl(filename)
                    imageUrl = publicUrlData.publicUrl
                    console.log(`   ✓ URL: ${imageUrl}`)
                }
            } catch (imgErr) {
                console.error("   ⚠️ Image failed:", imgErr)
            }
        }
    } else {
        console.log(`🎨 [DRY-RUN] Přeskakuji ${isReel ? "video" : isCarousel ? "carousel" : "obrázek"}`)
    }

    // 8. Save to database
    let postId: string | undefined

    if (!options.dryRun) {
        await report("uploading", 90, "💾 Ukládám do databáze...")
        console.log("💾 Ukládám...")
        const post = await createPost({
            post_type_id: selectedType.id,
            idea_id: idea?.id,
            review_id: review?.id,
            product_id: linkedProductId || undefined,
            caption: fullCaption,
            hashtags: finalHashtags,
            call_to_action: captionData.cta,
            image_prompt: captionData.imagePrompt,
            image_url: imageUrl,
            image_style: isReel ? "veo-3.1" : `overlay:${format.overlayStyle || "default"}`,
            status: "draft",
        })

        postId = post.id
        if (idea) await markIdeaAsUsed(idea.id)
        if (review) await markReviewAsUsed(review.id)

        // Track product usage for cooldown rotation
        if (linkedProductId) {
            await supabaseAdmin
                .from("ig_products")
                .update({
                    last_used_at: new Date().toISOString(),
                    times_used: (await supabaseAdmin.from("ig_products").select("times_used").eq("id", linkedProductId).single()).data?.times_used + 1 || 1,
                })
                .eq("id", linkedProductId)
            console.log(`   📌 Product "${selectedProduct?.name}" marked as used`)
        }

        await logGeneration({
            postId: post.id,
            promptUsed: megaPrompt.substring(0, 500),
            modelUsed: "gemini-3.5-flash + gemini-3-pro-image-preview",
            generationTimeMs: Date.now() - startTime,
            criticScore: score,
            criticKeep: detail?.feedback.keep,
            criticFix: detail?.feedback.fix,
        })

        console.log(`   ✓ ID: ${post.id}`)
    }

    // 9. Summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

    console.log("\n" + "═".repeat(60))
    console.log("📱 POST")
    console.log("═".repeat(60))
    console.log(`\n${fullCaption}`)
    console.log("\n" + "─".repeat(60))
    console.log(`🎨 ${imageUrl || "Bez obrázku"}`)
    console.log(`⏱️  ${elapsed}s | 💰 ~$${cost.toFixed(3)}`)
    console.log("═".repeat(60) + "\n")

    return { id: postId, caption: fullCaption, imageUrl, cost }
    }) // end withActiveProject
}

// ============================================
// BUDGET-CONTROLLED BATCH
// ============================================

export async function generateBatch(options: {
    configName?: string
    count: number
    dryRun: boolean
    topic?: string
}) {
    await ensureConfig(options.configName)
    const config = CLIENT_CONFIG!
    const { count, dryRun } = options
    const estimatedCost = count * COSTS.perPost

    console.log("\n" + "═".repeat(60))
    console.log("📅 AUTOPILOT — BATCH GENEROVÁNÍ (s Editorial Review)")
    console.log("═".repeat(60))
    console.log(`   📊 Postů: ${count}`)
    const USD_TO_CZK = 23
    console.log(`   💰 Odhadovaná cena: ~$${estimatedCost.toFixed(2)} (${(estimatedCost * USD_TO_CZK).toFixed(0)} Kč) + editorial review`)
    console.log(`   ${dryRun ? "🔍 MODE: DRY-RUN" : "🚀 MODE: PRODUKCE"}`)
    console.log("═".repeat(60))

    console.log("\n📊 Analyzuji výkon minulých postů...")
    const _getPillarForType = createPillarMapper(config)
    const performance = await analyzePerformance(config, _getPillarForType)
    if (performance.topPatterns.length > 0) {
        console.log(`   ✓ Naučené vzorce: ${performance.topPatterns.join(", ")}`)
    } else {
        console.log("   ℹ️ Zatím žádná data o výkonu — generuji bez feedbacku")
    }

    const results: Array<{ type: string; success: boolean; id?: string; cost: number }> = []
    let totalCost = 0
    let typesToUse = buildSmartWeekPlan(config, performance, options.count)

    // ═══════════════════════════════════════════════════════
    // EDITORIAL REVIEW — Chief Editor reviews the content plan
    // ═══════════════════════════════════════════════════════
    console.log("\n🎖️ ŠÉFREDAKTOR — Review content plánu...")
    console.log("─".repeat(60))

    // Build a plan structure for editorial review
    const startDate = new Date()
    const planSlots = typesToUse.map((type, i) => {
        const postDate = new Date(startDate)
        postDate.setDate(postDate.getDate() + Math.floor(i * 7 / typesToUse.length))
        const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
        return {
            day: dayNames[postDate.getDay()],
            date: postDate.toISOString().split("T")[0],
            time: "17:00",
            postType: type,
            topic: options.topic || `Auto-generated ${type} post`,
            reason: "Algoritmicky vybraný typ",
            weatherContext: null,
            calendarContext: null,
            source: "planned" as const,
        }
    })

    try {
        const editorialPlanResult = await reviewContentPlan(config, planSlots)
        totalCost += editorialPlanResult.totalTokenCost

        if (editorialPlanResult.approved) {
            console.log(`\n   ✅ Content plan schválen po ${editorialPlanResult.rounds.length} kolech`)
        } else {
            console.log(`\n   ⏰ Content plan po max kolech — používám poslední verzi`)
        }

        // Extract post types from approved plan
        const approvedPlan = editorialPlanResult.plan
        if (Array.isArray(approvedPlan) && approvedPlan.length > 0) {
            typesToUse = approvedPlan.map((s: any) => s.postType).filter(Boolean)
            // If editorial changed the count, respect it
            if (typesToUse.length === 0) {
                typesToUse = buildSmartWeekPlan(config, performance, options.count)
            }
        }

        console.log(`   📋 Final plan: ${typesToUse.join(", ")}`)
        console.log(`   💰 Editorial review cost: $${editorialPlanResult.totalTokenCost.toFixed(3)}`)
    } catch (editorialErr: any) {
        console.warn(`   ⚠️ Editorial review failed: ${editorialErr?.message?.substring(0, 100)}`)
        console.log(`   📋 Using original plan: ${typesToUse.join(", ")}`)
    }

    console.log("─".repeat(60))

    for (let i = 0; i < typesToUse.length; i++) {
        const type = typesToUse[i]

        console.log(`\n${"─".repeat(60)}`)
        console.log(`📌 [${i + 1}/${typesToUse.length}] ${type}`)
        console.log("─".repeat(60))

        try {
            const result = await generateOnePost({ configName: options.configName, type, dryRun, performance })
            totalCost += result.cost
            results.push({ type, success: true, id: result.id, cost: result.cost })

            if (i < typesToUse.length - 1) {
                console.log("⏳ Pauza 15s (API rate limiting)...")
                await new Promise(resolve => setTimeout(resolve, 15000))
            }
        } catch (error) {
            console.error(`❌ ${type}: ${error}`)
            results.push({ type, success: false, cost: 0 })
        }
    }

    const successCount = results.filter(r => r.success).length
    console.log("\n" + "═".repeat(60))
    console.log("📊 SOUHRN")
    console.log("═".repeat(60))
    results.forEach((r) => {
        console.log(`   ${r.success ? "✅" : "❌"} ${r.type.padEnd(15)} $${r.cost.toFixed(3)} ${r.id ? `(${r.id.substring(0, 8)}...)` : ""}`)
    })
    console.log("─".repeat(60))
    console.log(`   ✅ ${successCount}/${results.length} postů`)
    console.log(`   💰 Celkem: $${totalCost.toFixed(3)} (${(totalCost * 23).toFixed(0)} Kč)`)
    console.log("═".repeat(60) + "\n")
}

// ============================================
// FEEDBACK COMMAND
// ============================================

async function recordFeedback() {
    console.log("\n" + "═".repeat(60))
    console.log("📊 FEEDBACK — Zaznamenat výkon postů")
    console.log("═".repeat(60))

    const { data: posts } = await supabaseAdmin
        .from("ig_posts")
        .select("id, caption, posted_at, created_at, likes, comments, saves")
        .eq("status", "posted")
        .eq("client_id", getActiveProject())
        .is("likes", null)
        .order("posted_at", { ascending: false })
        .limit(10)

    if (!posts || posts.length === 0) {
        console.log("\n   ℹ️ Žádné posty bez metrik.")
        console.log("   Tip: Změň status postu na 'posted' a pak spusť --feedback znovu.")
        console.log("═".repeat(60) + "\n")
        return
    }

    console.log(`\n   Nalezeno ${posts.length} postů bez metrik.`)
    console.log("   Pro záznam metrik aktualizuj v Supabase dashboardu:")
    console.log("   Tabulka: ig_posts → sloupce: likes, comments, saves\n")

    for (const post of posts) {
        const hook = post.caption?.split("\n")[0] || "Unknown"
        console.log(`   📱 ${post.id.substring(0, 8)}... | "${hook.substring(0, 50)}..."`)
        console.log(`      Datum: ${post.posted_at || post.created_at}`)
        console.log(`      Lajky: ${post.likes ?? "❓"} | Komentáře: ${post.comments ?? "❓"} | Uložení: ${post.saves ?? "❓"}`)
        console.log("")
    }

    console.log("═".repeat(60) + "\n")
}

// ============================================
// STATS COMMAND
// ============================================

async function showStats() {
    console.log("\n" + "═".repeat(60))
    console.log("📈 STATISTIKY — Co funguje?")
    console.log("═".repeat(60))

    const { data: allPosts } = await supabaseAdmin
        .from("ig_posts")
        .select("id, status, caption, posted_at, created_at, likes, comments, saves")
        .eq("client_id", getActiveProject())
        .order("created_at", { ascending: false })

    const posts = allPosts || []
    const posted = posts.filter(p => p.status === "posted")
    const withMetrics = posted.filter(p => p.likes !== null)

    console.log(`\n   📊 Celkem postů: ${posts.length}`)
    console.log(`   📤 Publikováno: ${posted.length}`)
    console.log(`   📏 S metrikami: ${withMetrics.length}`)
    console.log(`   📝 Drafty: ${posts.filter(p => p.status === "draft").length}`)

    const config = CLIENT_CONFIG!
    const _getPillarForType = createPillarMapper(config)
    const performance = await analyzePerformance(config, _getPillarForType)

    if (withMetrics.length > 0) {
        console.log("\n" + "─".repeat(60))
        console.log("🏆 TOP VZORCE (co systém učí)")
        console.log("─".repeat(60))

        if (performance.topPatterns.length > 0) {
            performance.topPatterns.forEach(p => console.log(`   ✓ ${p}`))
        } else {
            console.log("   Zatím žádné detekované vzorce")
        }

        if (performance.bestHooks.length > 0) {
            console.log("\n   🎯 Nejlepší hooky:")
            performance.bestHooks.forEach(h => console.log(`     "${h}"`))
        }

        console.log(`\n   📊 Průměrný engagement: ${performance.avgEngagement.toFixed(0)} bodů`)
        console.log(`   ⏰ Nejlepší časy: ${performance.bestTimeSlots.join(", ") || "N/A"}`)
    } else {
        console.log("\n   ℹ️ Potřebuji metriky pro analýzu!")
        console.log("   1. Postni drafty na Instagram")
        console.log("   2. Zapiš likes/comments/saves do Supabase")
        console.log("   3. Spusť `--stats` znovu")
    }

    const usedIdeaIds = await getUsedIdeaIds()
    const allIdeas = await getAvailableIdeas()
    const freshIdeas = allIdeas.filter(i => !usedIdeaIds.has(i.id))

    console.log("\n" + "─".repeat(60))
    console.log("🗂️  BANKA NÁPADŮ")
    console.log("─".repeat(60))
    console.log(`   Celkem: ${allIdeas.length + usedIdeaIds.size}`)
    console.log(`   Použité: ${usedIdeaIds.size}`)
    console.log(`   Zbývá čerstvých: ${freshIdeas.length}`)

    if (freshIdeas.length < 5) {
        console.log("   ⚠️ Dochází nápady! Spusť --generate-ideas pro auto-refill.")
    }

    if (withMetrics.length > 0 && performance.pillarPerformance) {
        const pp = performance.pillarPerformance
        console.log("\n" + "─".repeat(60))
        console.log("📊 VÝKON PODLE PILÍŘE")
        console.log("─".repeat(60))
        for (const [key, perf] of Object.entries(pp)) {
            const pillarCfg = config.contentPillars[key]
            const emoji = pillarCfg?.emoji || "📌"
            const label = (pillarCfg?.label || key).toUpperCase().padEnd(8)
            console.log(`   ${emoji} ${label} avg ${perf.avgScore.toFixed(0)} bodů ${perf.topPatterns.length > 0 ? `(${perf.topPatterns.join(", ")})` : ""}`)
        }
        if (performance.conversionRate > 0) {
            console.log(`\n   📈 Conversion rate: ${(performance.conversionRate * 100).toFixed(2)}%`)
        }
    }

    const weekCount = config.weekPlan.length
    console.log("\n" + "─".repeat(60))
    console.log("💰 BUDGET")
    console.log("─".repeat(60))
    const USD_TO_CZK = 23
    console.log(`   Cena za post: ~$${COSTS.perPost.toFixed(3)} (${(COSTS.perPost * USD_TO_CZK).toFixed(0)} Kč)`)
    console.log(`   Týden (${weekCount} postů): ~$${(COSTS.perPost * weekCount).toFixed(2)} (${(COSTS.perPost * weekCount * USD_TO_CZK).toFixed(0)} Kč)`)
    console.log(`   Měsíc (${weekCount * 4} postů): ~$${(COSTS.perPost * weekCount * 4).toFixed(2)} (${(COSTS.perPost * weekCount * 4 * USD_TO_CZK).toFixed(0)} Kč)`)

    console.log("\n" + "═".repeat(60) + "\n")
}

// ============================================
// AUTO-IDEA GENERATION
// ============================================

function buildIdeasSchema(pillarKey?: string): object {
    const config = CLIENT_CONFIG!
    const categories = Object.keys(config.contentPillars).join(", ")

    // If pillar has sub-categories, use them for subcategory enum
    const pillarCfg = pillarKey ? config.contentPillars[pillarKey] : undefined
    const subCatDesc = pillarCfg?.categories?.length
        ? `Sub-category: ${pillarCfg.categories.map(c => c.id).join(", ")}`
        : "Sub-topic or platform, e.g. 'general'"

    return {
        type: "object",
        properties: {
            ideas: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        title: { type: "string", description: "Short title (3-6 words, Czech)" },
                        content: { type: "string", description: "Detailed description of the idea (2-3 sentences, Czech)" },
                        category: { type: "string", description: `Category: ${categories}` },
                        subcategory: { type: "string", description: subCatDesc },
                        keywords: { type: "array", items: { type: "string" }, description: "3-5 relevant keywords" },
                    },
                    required: ["title", "content", "category", "subcategory", "keywords"],
                },
            },
        },
        required: ["ideas"],
    }
}

async function generateIdeas(
    pillar: string,
    count: number,
    performance: PerformanceInsight,
    existingIdeas: PostIdea[]
): Promise<any[]> {
    const existingTitles = existingIdeas.map(i => i.title).join(", ")
    const config = CLIENT_CONFIG!
    const bv = config.brandVoice
    const pillarInfo = config.contentPillars[pillar]

    const prompt = `Jsi expert na Instagram content strategii pro brand "${config.name}".
Web: ${config.website} | IG: ${config.instagram}

## BRAND PERSONA
${bv.persona}

## BRAND VOICE
${bv.voiceTraits.map(t => `- ${t}`).join("\n")}

## ZAKÁZÁNO
${bv.antiPatterns.map(p => p).join("\n")}

${config.products ? `## PRODUKTY
${config.products.map(p => `- ${p.name} (${p.type}): ${p.description || p.price || ""}`).join("\n")}
` : ""}

## PILÍŘ: ${pillarInfo?.label || pillar.toUpperCase()}
${pillarInfo?.description || ""}
Typy postů: ${pillarInfo?.postTypes.join(", ") || "meme, product_drop"}
${pillarInfo?.categories?.length ? `
## KATEGORIE V TOMTO PILÍŘI:
${pillarInfo.categories.map(c => `- ${c.emoji} **${c.label}** (id: "${c.id}")${c.prompt ? `: ${c.prompt}` : ""}`).join("\n")}
Každý nápad MUSÍ mít subcategory nastavený na jedno z těchto ID. Rozděl nápady rovnoměrně.
` : ""}
## PRAVIDLA:
1. Všechny nápady MUSÍ odpovídat brand voice a tématu značky "${config.name}"
2. Piš česky, moderní hovorovou češtinou
3. Každý nápad musí být originální a relevantní pro cílovou skupinu
4. NEDUPLIKUJ tyto existující nápady: ${existingTitles || "žádné"}
5. CTA musí směřovat na ${config.website}

Generuj PŘESNĚ ${count} nápadů.
Každý nápad musí mít: title (krátký název), content (text nápadu/caption), category, subcategory, keywords.`

    try {
        const result = await generateText(prompt, {
            responseSchema: buildIdeasSchema(pillar),
            temperature: 0.9,
        })

        const parsed = JSON.parse(result)
        const ideas: any[] = parsed.ideas.map((idea: any) => ({
            title: idea.title,
            content: idea.content,
            category: idea.category || pillar,
            subcategory: idea.subcategory || "general",
            keywords: idea.keywords || [],
            cooldown_days: 60,
            is_active: true,
        }))

        return ideas
    } catch (err) {
        console.error("❌ AI idea generation failed:", err)
        return []
    }
}

async function runGenerateIdeas() {
    const args = process.argv.slice(2)
    const countArg = args.find(a => a.startsWith("--count="))
    const count = countArg ? parseInt(countArg.split("=")[1]) : 15
    const pillarArg = args.find(a => a.startsWith("--pillar="))
    const pillar = pillarArg?.split("=")[1] || "all"

    const config = CLIENT_CONFIG!

    console.log("\n" + "═".repeat(60))
    console.log(`🧠 AUTO-GENERACE NÁPADŮ — ${config.name}`)
    console.log("═".repeat(60))

    const _getPillarForType = createPillarMapper(config)
    const performance = await analyzePerformance(config, _getPillarForType)
    const existingIdeas = await getAvailableIdeas()

    console.log(`   📊 Existujících nápadů: ${existingIdeas.length}`)
    console.log(`   🎯 Generuji: ${count} per pillar`)
    console.log("")

    const clientPillars = Object.keys(config.contentPillars)
    const pillarsToGenerate: string[] = pillar === "all"
        ? clientPillars
        : [pillar]

    let totalGenerated = 0

    for (const p of pillarsToGenerate) {
        const pillarConfig = config.contentPillars[p]
        const emoji = pillarConfig?.emoji || "📌"
        console.log(`\n${emoji} Generuji ${(pillarConfig?.label || p).toUpperCase()} nápady (${count})...`)

        const ideas = await generateIdeas(p, count, performance, existingIdeas)

        if (ideas.length > 0) {
            const inserted = await batchInsertIdeas(ideas)
            totalGenerated += inserted
            console.log(`   ✓ Vloženo ${inserted} nápadů`)
            ideas.forEach(i => console.log(`     - ${i.title}: ${(i.content as string).substring(0, 60)}...`))
        } else {
            console.log(`   ⚠️ Žádné nápady vygenerovány`)
        }

        if (pillarsToGenerate.indexOf(p) < pillarsToGenerate.length - 1) {
            console.log("   ⏳ Pauza 5s...")
            await new Promise(r => setTimeout(r, 5000))
        }
    }

    console.log(`\n${"═".repeat(60)}`)
    console.log(`✅ Celkem vygenerováno: ${totalGenerated} nápadů`)
    console.log(`${"═".repeat(60)}\n`)
}

// ============================================
// CLI
// ============================================

async function main() {
    const args = process.argv.slice(2)

    const configArg = args.find(a => a.startsWith("--config="))
    const configName = configArg?.split("=")[1] || "mobilnamiru"
    CLIENT_CONFIG = await loadConfig(configName)
    const { resolveClientId } = await import("./configs")
    const clientUuid = await resolveClientId(configName)
    setActiveProject(clientUuid)

    console.log(`🏢 Klient: ${CLIENT_CONFIG.name} (${CLIENT_CONFIG.id})`)
    console.log(`🌐 Web: ${CLIENT_CONFIG.website}`)
    console.log("")

    if (args.includes("--help") || args.includes("-h")) {
        console.log(`
📱 Instagram Autopilot — Multi-Client Content Engine

Klient: ${CLIENT_CONFIG.name} (${CLIENT_CONFIG.id})

Generování:
  npx tsx instagram/autopilot.ts --config=${configName}                    1 náhodný post
  npx tsx instagram/autopilot.ts --config=${configName} --week             Smart week plan
  npx tsx instagram/autopilot.ts --config=${configName} --count=5          Konkrétní počet
  npx tsx instagram/autopilot.ts --config=${configName} --type=meme        Konkrétní typ
  npx tsx instagram/autopilot.ts --config=${configName} --dry-run          Jen náhled

Growth Engine:
  npx tsx instagram/autopilot.ts --config=${configName} --generate-ideas   Auto-generace nápadů
  npx tsx instagram/autopilot.ts --config=${configName} --generate-ideas --pillar=reach --count=20
  npx tsx instagram/autopilot.ts --config=${configName} --feedback         Zaznamenat výkon
  npx tsx instagram/autopilot.ts --config=${configName} --stats            Statistiky

Product & Design:
  npx tsx instagram/autopilot.ts --config=${configName} --product-idea             Nápady na produkty
  npx tsx instagram/autopilot.ts --config=${configName} --product-idea --count=5 --theme="summer"
  npx tsx instagram/autopilot.ts --config=${configName} --design --theme="neon"     Design koncept + obrázek
  npx tsx instagram/autopilot.ts --config=${configName} --design --product=triko --theme="summer vibes"

Dostupné konfigurace: mobilnamiru (a klientské UUIDs z DB)
(bez --config se použije mobilnamiru)
`)
        return
    }

    // Special commands
    if (args.includes("--feedback")) return recordFeedback()
    if (args.includes("--stats")) return showStats()
    if (args.includes("--generate-ideas")) return runGenerateIdeas()
    if (args.includes("--product-idea")) return runProductIdeas(CLIENT_CONFIG!)
    if (args.includes("--design")) return runDesignConcept(CLIENT_CONFIG!)

    // Parse options
    const dryRun = args.includes("--dry-run")
    const isWeek = args.includes("--week")
    const typeArg = args.find(a => a.startsWith("--type="))
    const type = typeArg?.split("=")[1]
    const countArg = args.find(a => a.startsWith("--count="))
    const count = countArg ? parseInt(countArg.split("=")[1]) : undefined

    if (isWeek || count) {
        await generateBatch({
            count: count || CLIENT_CONFIG!.weekPlan.length,
            dryRun,
        })
    } else {
        await generateOnePost({ type, dryRun })
    }
}

// Only run main() when executed directly from CLI (npx tsx autopilot.ts)
// NOT when imported as a module by server actions
const isDirectExecution = process.argv[1]?.includes("autopilot")

if (isDirectExecution) {
    main().catch(err => {
        console.error("💥 Autopilot selhal:", err)
        process.exit(1)
    })
}
