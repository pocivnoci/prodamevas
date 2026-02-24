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

import supabase from "../supabase/client"
import supabaseAdmin from "../supabase/admin"
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
} from "./service"
import { runProductIdeas, runDesignConcept } from "./product-generator"
import { loadConfig } from "./configs"
import type { ClientConfig } from "./configs/types"
import type { PostType, PostIdea, Review } from "./types"

// Module imports (refactored from monolith)
import { isHookSimilar, isBodySimilar } from "./dedup"
import { analyzePerformance, type PerformanceInsight } from "./performance"
import {
    COSTS,
    IDEA_COOLDOWN_DAYS,
    getPostFormat,
    getReelDuration,
    getPillarForType,
    buildCaptionSchema,
    buildVideoSchema,
    buildCarouselSchema,
    buildSmartWeekPlan,
    buildMegaPrompt,
    scorePost,
} from "./caption-generator"
import { refineImagePrompt, refineCarouselPrompts, refineVideoPrompt } from "./image-pipeline"

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
    const { data } = await supabase
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
}): Promise<{ id?: string; caption: string; imageUrl?: string; cost: number }> {
    await ensureConfig(options.configName)
    const config = CLIENT_CONFIG!
    const startTime = Date.now()
    let cost = 0

    // 1. Select post type
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
    console.log("📚 Hledám zdroje (cooldown: 90 dní)...")
    let idea: PostIdea | null = null
    let review: Review | null = null

    if (selectedType.name === "recenze") {
        const reviews = await getApprovedReviews()
        if (reviews.length > 0) {
            review = reviews[Math.floor(Math.random() * reviews.length)]
            console.log(`   ✓ Recenze: "${review.quote.substring(0, 40)}..."`)
        }
    } else {
        const ideas = await getAvailableIdeas()
        if (ideas.length > 0) {
            idea = ideas[Math.floor(Math.random() * Math.min(ideas.length, 3))]
            console.log(`   ✓ Nápad: "${idea.title}" (${ideas.length} dostupných, cooldown ${IDEA_COOLDOWN_DAYS} dní)`)
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
    const _getPillarForType = (t: string) => getPillarForType(config, t)
    const performance = options.performance || await analyzePerformance(config, _getPillarForType)

    // 5. Generate caption / video script / carousel
    const format = getPostFormat(config, selectedType.name)
    const isReel = format.medium === "reel"
    const isCarousel = format.medium === "carousel"
    const postFormat = isReel ? "video script" : isCarousel ? "carousel" : "caption"
    console.log(`✍️  Generuji ${postFormat} (Gemini 3.1 Pro)...`)
    const megaPrompt = buildMegaPrompt(config, selectedType, idea, review, recentHooks, performance, options.topic)
    const schema = isReel ? buildVideoSchema(config) : isCarousel ? buildCarouselSchema(config) : buildCaptionSchema(config)
    const rawText = await generateText(megaPrompt, { responseSchema: schema })
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
    console.log("🔍 Quality gate (Gemini 3.1 Pro scoring)...")
    const { score, feedback } = await scorePost(
        config,
        captionData as { hook: string; body?: string; cta: string; hashtags: string[]; slides?: { headline: string; subtext: string }[] },
        selectedType.name
    )
    cost += COSTS.textGeneration
    const scoreEmoji = score >= 8 ? "🟢" : score >= 6 ? "🟡" : "🔴"
    console.log(`   ${scoreEmoji} Score: ${score}/10 — ${feedback}`)

    if (score < 7) {
        console.log("   ⚠️ Low quality — regeneruji s feedbackem...")
        const improvePrompt = megaPrompt + `\n\nDŮLEŽITÉ: Předchozí verze dostala ${score}/10. Feedback: "${feedback}". VYLEPŠI TO!`
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
            console.log("   ⚠️ Regeneration failed — pokračuji s originálem")
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

                    const timestamp = Date.now()
                    const filename = `ig-carousel/${timestamp}-slide${i}.png`

                    const { error: uploadError } = await supabaseAdmin.storage
                        .from("audit-screenshots")
                        .upload(filename, finalImage, {
                            contentType: "image/png",
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
            console.log("🧠 Vylepšuji image prompt (2-step pipeline)...")
            const bodySnippet = captionData.body ? captionData.body.substring(0, 150) : undefined
            let refinedPrompt = await refineImagePrompt(
                config,
                captionData as { imagePrompt: string; hook: string; imageSubtext?: string },
                selectedType.name,
                bodySnippet
            )
            cost += COSTS.promptRefinement
            console.log(`   ✓ Prompt refined`)

            try {
                let imageBuffer: Buffer

                // Load reference images
                const refImages: { buffer: Buffer; mimeType?: string; label?: string }[] = []

                // Strategy 1: Local reference images
                try {
                    const { readdir, readFile } = await import("fs/promises")
                    const { join, dirname } = await import("path")
                    const { fileURLToPath } = await import("url")
                    const baseDir = dirname(fileURLToPath(import.meta.url))
                    const refDir = join(baseDir, "reference-images", config.id)

                    const files = await readdir(refDir).catch(() => [] as string[])
                    const imageFiles = files
                        .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
                        .sort()

                    for (const file of imageFiles) {
                        const imgBuffer = await readFile(join(refDir, file))
                        const mimeType = file.endsWith(".png") ? "image/png" : "image/jpeg"
                        refImages.push({
                            buffer: imgBuffer,
                            mimeType,
                            label: "brand character reference — preserve this person's EXACT face and likeness",
                        })
                        console.log(`   📸 Loaded local ref: ${file}`)
                    }
                } catch {
                    // Local files not available (e.g. Vercel)
                }

                // Strategy 2: Remote reference images from config URLs
                if (config.characterReferenceImages?.length) {
                    for (const refUrl of config.characterReferenceImages) {
                        try {
                            const resp = await fetch(refUrl)
                            if (resp.ok) {
                                const arrayBuf = await resp.arrayBuffer()
                                refImages.push({
                                    buffer: Buffer.from(arrayBuf),
                                    mimeType: refUrl.endsWith(".png") ? "image/png" : "image/jpeg",
                                    label: "brand character reference — preserve this person's EXACT face and likeness",
                                })
                                console.log(`   📸 Loaded remote ref: ${refUrl.split("/").pop()?.substring(0, 40)}`)
                            } else {
                                console.warn(`   ⚠️ Ref image fetch failed (${resp.status}): ${refUrl.substring(0, 60)}`)
                            }
                        } catch (err) {
                            console.warn(`   ⚠️ Ref image error: ${(err as Error).message?.substring(0, 60)}`)
                        }
                    }
                }

                // For product posts, load REAL product photos
                const productTypes = ["product_drop", "limitka", "outfit_inspo", "produkt", "recenze"]
                if (productTypes.includes(selectedType.name) && config.products?.length) {
                    const products = config.products
                    const randomProduct = products[Math.floor(Math.random() * products.length)]

                    let productImageLoaded = false
                    if (randomProduct.slug) {
                        try {
                            const { readdir, readFile } = await import("fs/promises")
                            const { join, dirname } = await import("path")
                            const { fileURLToPath } = await import("url")
                            const baseDir = dirname(fileURLToPath(import.meta.url))
                            const productDir = join(baseDir, "product-images", config.id)

                            const files = await readdir(productDir).catch(() => [] as string[])
                            const productFiles = files
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

                    // Fallback to live og:image scraping
                    if (!productImageLoaded && randomProduct.slug && config.website) {
                        try {
                            const productUrl = `${config.website}/p/${randomProduct.slug}`
                            const pageResp = await fetch(productUrl)
                            if (pageResp.ok) {
                                const html = await pageResp.text()
                                const ogMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)
                                if (ogMatch?.[1]) {
                                    const imgResp = await fetch(ogMatch[1])
                                    if (imgResp.ok) {
                                        const arrayBuf = await imgResp.arrayBuffer()
                                        refImages.push({
                                            buffer: Buffer.from(arrayBuf),
                                            mimeType: "image/jpeg",
                                            label: `EXACT product photo: ${randomProduct.name}`,
                                        })
                                        productImageLoaded = true
                                        console.log(`   🛍️ Loaded remote product image: ${randomProduct.name}`)
                                    }
                                }
                            }
                        } catch (err) {
                            console.warn(`   ⚠️ Product ref error: ${(err as Error).message?.substring(0, 60)}`)
                        }
                    }

                    if (productImageLoaded) {
                        refinedPrompt = `CRITICAL INSTRUCTION: One of the attached reference images shows the EXACT product "${randomProduct.name}". You MUST reproduce this product's design FAITHFULLY — same colors, same logo placement, same print/pattern. Do NOT invent new designs. The product must look IDENTICAL to the reference photo. Show this exact product in the scene described below.\n\n${refinedPrompt}`
                        console.log(`   📌 Product constraint: "${randomProduct.name}" — exact design enforced`)
                    }
                }

                if (refImages.length > 0) {
                    console.log(`🎨 Generuji obrázek (Gemini 3.1 Pro + ${refImages.length} ref images, 2K)...`)
                    imageBuffer = await generateImageWithReferences(
                        refinedPrompt,
                        refImages,
                        { aspectRatio: format.aspectRatio, resolution: "2K" }
                    )
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

                console.log("📤 Nahrávám do Supabase...")
                const timestamp = Date.now()
                const filename = `ig-posts/${timestamp}.png`
                const bucketName = config.storageBucket || "audit-screenshots"

                const { error: uploadError } = await supabaseAdmin.storage
                    .from(bucketName)
                    .upload(filename, finalImage, {
                        contentType: "image/png",
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
    const _getPillarForType = (t: string) => getPillarForType(config, t)
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

    const { data: posts } = await supabase
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

    const { data: allPosts } = await supabase
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
    const _getPillarForType = (t: string) => getPillarForType(config, t)
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

    const _getPillarForType = (t: string) => getPillarForType(config, t)
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
