/**
 * Instagram Autopilot — Closed-Loop Content Engine (Orchestrator)
 * ==============================================================
 *
 * This is the main orchestrator. Business logic is split into:
 *   📊 performance.ts  — analyzePerformance, PerformanceInsight
 *   🚫 dedup.ts         — isHookSimilar, isBodySimilar
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
import { generateText, generateImage, generateImageWithReferences, generateVideo } from "./gemini-client"
import { overlayText } from "./text-overlay"
import {
    getActivePostTypes,
    getAvailableIdeas,
    getApprovedReviews,
    getRecentPosts,
    createPost,
    markIdeaAsUsed,
    markReviewAsUsed,
    logGeneration,
    batchInsertIdeas,
    setActiveProject,
    getActiveProject,
    ensurePostTypes,
    getWeightedIdeas,
    getWeightedReviews,
    propagateMetricsToSources,
} from "./service"
import { runProductIdeas, runDesignConcept } from "./product-generator"
import { loadConfig } from "./configs"
import type { ClientConfig } from "./configs/types"
import type { PostType, PostIdea, Review } from "./types"

// Module imports (refactored from monolith)
import { isHookSimilar, isBodySimilar, createPillarMapper } from "./service"
import { analyzePerformance, type PerformanceInsight } from "./performance"
import {
    COSTS,
    IDEA_COOLDOWN_DAYS,
    getPostFormat,
    getReelDuration,

    buildCaptionSchema,
    buildVideoSchema,
    buildCarouselSchema,
    buildSmartWeekPlan,
    buildMegaPrompt,
    scorePost,
} from "./caption-generator"
import { refineImagePrompt, refineCarouselPrompts, refineVideoPrompt } from "./image-pipeline"
import { getBrandMemories, formatMemoriesForPrompt } from "./memory-agent"

// Active client config (set from --config flag or ensureConfig)
let CLIENT_CONFIG: ClientConfig | null = null

/**
 * Smart config loader — ensures CLIENT_CONFIG is set before generation.
 * Called automatically by generateOnePost/generateBatch when invoked from server actions.
 * No-op if config is already loaded for the same client.
 */
async function ensureConfig(configName?: string): Promise<void> {
    const name = configName || "mobilnamiru"
    if (CLIENT_CONFIG && CLIENT_CONFIG.id === name) return // already loaded
    CLIENT_CONFIG = await loadConfig(name)

    // Resolve slug → uuid and set the active client for all service queries
    const { resolveClientId } = await import("./configs")
    const clientUuid = await resolveClientId(name)
    setActiveProject(clientUuid)
    console.log(`🏢 Config loaded: ${CLIENT_CONFIG.name} (${name} → ${clientUuid.substring(0, 8)}...)`)

    // Auto-create any missing post types in DB for this client
    await ensurePostTypes(CLIENT_CONFIG, clientUuid)
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
    customImageUrl?: string
    onProgress?: (stage: string, progress: number, message: string) => Promise<void>
}): Promise<{ id?: string; caption: string; imageUrl?: string; cost: number }> {
    const report = options.onProgress || (async () => {}) // no-op if not provided
    await ensureConfig(options.configName)
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
        const weighted = postTypes.flatMap(type =>
            Array(type.frequency === "daily" ? 3 : type.frequency === "weekly" ? 2 : 1).fill(type)
        )
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

    // 3. Get recent captions for dedup
    const recentPosts = await getRecentPosts(30)
    const recentHooks = recentPosts
        .map(p => p.caption?.split("\n")[0]?.substring(0, 80) || "")
        .filter(Boolean)

    // 4. Get performance data
    const _getPillarForType = createPillarMapper(config)
    const performance = options.performance || await analyzePerformance(config, _getPillarForType)

    // 4b. Pre-select product for coherence (same product for caption + image)
    const productTypes = ["product_drop", "limitka", "outfit_inspo", "produkt", "recenze", "meme", "customer_content", "lifestyle", "behind_the_scenes", "collab"]
    let selectedProduct: typeof config.products extends (infer T)[] | undefined ? T : never = undefined as any
    if (productTypes.includes(selectedType.name) && config.products?.length) {
        selectedProduct = config.products[Math.floor(Math.random() * config.products.length)]
        console.log(`   🛍️ Pre-selected product: "${selectedProduct.name}"`)
    }

    // 5. Generate caption / video script / carousel
    const format = getPostFormat(config, selectedType.name)
    // User override: if aspectRatio is provided, use it
    if (options.aspectRatio) {
        format.aspectRatio = options.aspectRatio as any
        console.log(`   📐 Formát přepsán uživatelem: ${options.aspectRatio}`)
    }
    const isReel = format.medium === "reel"
    const isCarousel = format.medium === "carousel"
    const postFormat = isReel ? "video script" : isCarousel ? "carousel" : "caption"
    await report("copywriter", 25, `✍️ Copywriter generuje ${postFormat}...`)
    console.log(`✍️  Generuji ${postFormat} (Gemini 2.5 Pro)...`)
    let megaPrompt = buildMegaPrompt(config, selectedType, idea, review, recentHooks, performance, options.topic, selectedProduct)

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

    const schema = isReel ? buildVideoSchema(config) : isCarousel ? buildCarouselSchema(config) : buildCaptionSchema(config)
    const rawText = await generateText(megaPrompt, { responseSchema: schema, model: "gemini-2.5-pro" })
    cost += COSTS.textGeneration

    let captionData: {
        hook: string
        body?: string
        cta: string
        hashtags: string[]
        imagePrompt?: string
        imageSubtext?: string
        videoScript?: string
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

    // 6b. Quality gate — auto-score before proceeding
    await report("critic", 45, "🔍 Kritik hodnotí kvalitu obsahu...")
    console.log("🔍 Quality gate (Gemini 2.5 Pro scoring)...")
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

    if (score < 7 && detail?.feedback.fix.length) {
        await report("critic", 50, `🔧 Copywriter opravuje: ${detail.feedback.fix[0]}...`)
        console.log("   ⚠️ Low quality — cílená oprava (dialog Kritik → Copywriter)...")

        // Targeted repair: tell Copywriter exactly what to keep and what to fix
        const keepInstructions = detail.feedback.keep.length > 0
            ? `\n## ✅ ZACHOVEJ BEZE ZMĚNY (Kritik schválil):\n${detail.feedback.keep.map(k => `- ${k}`).join("\n")}\n- Hook: "${captionData.hook}"${detail.hookScore >= 2 ? " ← NESMÍŠ MĚNIT" : ""}\n- ${detail.bodyScore >= 2 ? `Body zachovej nebo jen mírně uprav` : ""}`
            : ""

        const fixInstructions = `\n## 🔧 OPRAV POUZE TOTO (Kritik odmítl):\n${detail.feedback.fix.map(f => `- ${f}`).join("\n")}\n${detail.ctaScore < 1 ? `- CTA MUSÍ obsahovat ${config.website}` : ""}`

        const improvePrompt = megaPrompt + `\n\n${keepInstructions}\n${fixInstructions}\n\nVrať kompletní JSON se VŠEMI poli (i těmi co se nemění).`
        const improvedText = await generateText(improvePrompt, { responseSchema: schema })
        cost += COSTS.textGeneration
        try {
            const jsonMatch = improvedText.match(/\{[\s\S]*\}/)
            const improved = JSON.parse(jsonMatch?.[0] || improvedText)
            if (isReel && improved.caption) improved.body = improved.caption
            captionData = improved

            const { score: newScore, feedback: newFeedback } = await scorePost(config, captionData as { hook: string; body?: string; cta: string; hashtags: string[] })
            cost += COSTS.textGeneration
            const newEmoji = newScore >= 8 ? "🟢" : newScore >= 6 ? "🟡" : "🔴"
            console.log(`   ${newEmoji} Re-score: ${newScore}/10 — ${newFeedback}`)
        } catch {
            console.log("   ⚠️ Targeted repair failed — pokračuji s originálem")
        }
    }

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
        if (isReel && captionData.videoScript) {
            // VIDEO GENERATION PATH (Veo 3.1)
            const duration = getReelDuration(selectedType.name)

            console.log("🧠 Vylepšuji video prompt (Veo 3.1 pipeline)...")
            const refinedVideoPrompt = await refineVideoPrompt(config, captionData as { hook: string; videoScript: string }, selectedType.name, duration)
            cost += COSTS.promptRefinement
            console.log(`   ✓ Video prompt refined`)

            console.log(`🎬 Generuji video (Veo 3.1 Fast, ${duration}s, 9:16)...`)
            try {
                const videoBuffer = await generateVideo(refinedVideoPrompt, {
                    duration,
                    aspectRatio: "9:16",
                    fast: true,
                })
                cost += COSTS.videoPerSecond * duration
                console.log(`   ✓ Video (${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB, ${duration}s)`)

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
                    console.log(`   ✓ URL: ${imageUrl}`)
                }
            } catch (vidErr) {
                console.error("   ⚠️ Video generation failed:", vidErr)
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

            for (let i = 0; i < allSlides.length; i++) {
                const slide = allSlides[i]
                const label = i === 0 ? "COVER" : `Slide ${i}`
                console.log(`\n   📄 ${label}: "${slide.headline}"`)

                try {
                    const refinedPrompt = refinedPrompts[i] || slide.imagePrompt

                    const imageBuffer = await generateImage(refinedPrompt, { aspectRatio: format.aspectRatio as any })
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
                            gradientColors: config.overlayGradient,
                            logoFile: config.logoFile,
                            fontFamily: config.feedAesthetic?.fontOverride,
                        })
                        console.log(`   ✓ Text overlay ${i + 1}`)
                    }

                    console.log("🗜️ Komprimuji obrázek před uploadem (PNG -> WebP)...")
                    const compressedImage = await sharp(finalImage)
                        .webp({ quality: 90, effort: 6 })
                        .toBuffer()

                    const timestamp = Date.now()
                    const filename = `ig-carousel/${timestamp}-slide${i}.webp`

                    const { error: uploadError } = await supabaseAdmin.storage
                        .from("audit-screenshots")
                        .upload(filename, compressedImage, {
                            contentType: "image/webp",
                            cacheControl: "31536000",
                        })

                    if (uploadError) {
                        console.error(`   ⚠️ Upload slide ${i} failed:`, uploadError.message)
                    } else {
                        const { data: publicUrlData } = supabaseAdmin.storage
                            .from("audit-screenshots")
                            .getPublicUrl(filename)
                        uploadedUrls.push(publicUrlData.publicUrl)
                        console.log(`   ✓ Uploaded`)
                    }
                } catch (slideErr) {
                    console.error(`   ⚠️ Slide ${i} failed:`, slideErr)
                }
            }

            if (uploadedUrls.length > 0) {
                imageUrl = uploadedUrls.join("|")
                console.log(`\n   ✓ Carousel: ${uploadedUrls.length}/${slideCount} slidů nahráno`)
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
                bodySnippet
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
                const brandRefUrls = config.brandReferenceImages || config.characterReferenceImages || []

                if (brandRefUrls.length > 0) {
                    // Dynamic label based on what the brand actually is
                    const industry = (config as any).industry || ''
                    const isLocation = /ubytov|hotel|penzion|apartm|restaurac|kavárn|bar\b|wellness|spa/i.test(industry)
                        || /ubytov|hotel|penzion|apartm/i.test(config.name || '')
                    const isProduct = /e-?shop|obchod|product|merch|fashion|oblečen/i.test(industry)

                    const refLabel = isLocation
                        ? "brand environment reference — use this EXACT location, interior, and atmosphere in your image"
                        : isProduct
                            ? "brand product reference — maintain this exact visual style, colors, and product aesthetic"
                            : "brand visual reference — maintain this exact visual style, colors, and aesthetic atmosphere"

                    // Pick up to 3 reference images per post (more = slower + noisier)
                    const selectedRefs = brandRefUrls.length <= 3
                        ? brandRefUrls
                        : brandRefUrls.sort(() => Math.random() - 0.5).slice(0, 3)

                    for (const refUrl of selectedRefs) {
                        try {
                            const resp = await fetch(refUrl)
                            if (resp.ok) {
                                const arrayBuf = await resp.arrayBuffer()
                                refImages.push({
                                    buffer: Buffer.from(arrayBuf),
                                    mimeType: refUrl.endsWith(".png") ? "image/png" : "image/jpeg",
                                    label: refLabel,
                                })
                                console.log(`   📸 Loaded brand ref: ${refUrl.split("/").pop()?.substring(0, 40)}`)
                            }
                        } catch (err) {
                            console.warn(`   ⚠️ Brand ref error: ${(err as Error).message?.substring(0, 60)}`)
                        }
                    }
                }

                // Load product photos — use the SAME product that was pre-selected for caption
                if (selectedProduct?.slug && config.products?.length) {
                    const randomProduct = selectedProduct

                    let productImageLoaded = false
                    if (randomProduct.slug) {
                        // Strategy 1: Supabase storage (works on Vercel + local)
                        try {
                            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://nyvbxpjkwhcuugwevobu.supabase.co'
                            // List matching files in Supabase bucket
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

                        // Strategy 2: Local filesystem fallback (dev only)
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
                    }

                    if (productImageLoaded) {
                        refinedPrompt = `CRITICAL INSTRUCTION: One of the attached reference images shows the EXACT product "${randomProduct.name}". You MUST reproduce this product's design FAITHFULLY — same colors, same logo placement, same print/pattern. Do NOT invent new designs. The product must look IDENTICAL to the reference photo. ABSOLUTELY NEVER misspell, abbreviate, or distort any text visible on the product. If the product says "Zero Fucks Given", it MUST say exactly "Zero Fucks Given" — not "ZFKG", not "Zgarj", not any creative reinterpretation. Treat every letter on the reference as sacred ground truth. Show this exact product in the scene described below.\n\n${refinedPrompt}`
                        console.log(`   📌 Product constraint: "${randomProduct.name}" — exact design enforced`)
                    }
                }

                if (refImages.length > 0) {
                    try {
                        await report("rendering", 65, `🖼️ Generuji obrázek (${refImages.length} referencí)...`)
                        console.log(`🎨 Generuji obrázek (Nano Banana Pro + ${refImages.length} ref images, 2K)...`)
                        imageBuffer = await generateImageWithReferences(
                            refinedPrompt,
                            refImages,
                            { aspectRatio: format.aspectRatio, resolution: "2K" }
                        )
                    } catch (refErr: any) {
                        console.warn(`   ⚠️ Gemini ref image failed: ${refErr.message?.substring(0, 100)}`)
                        console.log("🎨 Fallback → Imagen 4 Ultra (bez referencí)...")
                        imageBuffer = await generateImage(refinedPrompt, { aspectRatio: format.aspectRatio as any })
                    }
                } else {
                    console.log("🎨 Generuji obrázek (Imagen 4 Ultra, 2K)...")
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
                        gradientColors: config.overlayGradient,
                        logoFile: config.logoFile,
                        fontFamily: config.feedAesthetic?.fontOverride,
                    })
                    console.log(`   ✓ Text overlay (${(finalImage.length / 1024).toFixed(0)} KB)`)
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
            caption: fullCaption,
            hashtags: finalHashtags,
            call_to_action: captionData.cta,
            image_prompt: captionData.imagePrompt,
            image_url: imageUrl,
            image_style: "gemini-pro",
            status: "draft",
        })

        postId = post.id
        if (idea) await markIdeaAsUsed(idea.id)
        if (review) await markReviewAsUsed(review.id)

        await logGeneration({
            postId: post.id,
            promptUsed: megaPrompt.substring(0, 500),
            modelUsed: "gemini-3.1-pro-preview + imagen-4.0-ultra",
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
    console.log("📅 AUTOPILOT — BATCH GENEROVÁNÍ")
    console.log("═".repeat(60))
    console.log(`   📊 Postů: ${count}`)
    console.log(`   💰 Odhadovaná cena: ~$${estimatedCost.toFixed(2)} (${(estimatedCost * 24).toFixed(0)} Kč)`)
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
    const typesToUse = buildSmartWeekPlan(config, performance, options.count)

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
    console.log(`   💰 Celkem: $${totalCost.toFixed(3)} (${(totalCost * 24).toFixed(0)} Kč)`)
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
        .select("*")
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
        .select("*")
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
    console.log(`   Cena za post: ~$${COSTS.perPost.toFixed(3)} (${(COSTS.perPost * 24).toFixed(0)} Kč)`)
    console.log(`   Týden (${weekCount} postů): ~$${(COSTS.perPost * weekCount).toFixed(2)} (${(COSTS.perPost * weekCount * 24).toFixed(0)} Kč)`)
    console.log(`   Měsíc (${weekCount * 4} postů): ~$${(COSTS.perPost * weekCount * 4).toFixed(2)} (${(COSTS.perPost * weekCount * 4 * 24).toFixed(0)} Kč)`)

    console.log("\n" + "═".repeat(60) + "\n")
}

// ============================================
// AUTO-IDEA GENERATION
// ============================================

function buildIdeasSchema(): object {
    const config = CLIENT_CONFIG!
    const categories = Object.keys(config.contentPillars).join(", ")

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
                        subcategory: { type: "string", description: "Sub-topic or platform, e.g. 'general'" },
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

## PRAVIDLA:
1. Všechny nápady MUSÍ odpovídat brand voice a tématu značky "${config.name}"
2. Piš česky, moderní hovorovou češtinou
3. Každý nápad musí být originální a relevantní pro cílovou skupinu
4. NEDUPLIKUJ tyto existující nápady: ${existingTitles || "žádné"}
5. CTA musí směřovat na ${config.website}

Generuj PŘESNĚ ${count} nápadů.
Každý nápad musí mít: title (krátký název), content (text nápadu/caption), category, keywords.`

    try {
        const result = await generateText(prompt, {
            responseSchema: buildIdeasSchema(),
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

Dostupné konfigurace: mobilnamiru, hanzfans
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
