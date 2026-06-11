/**
 * Reel Orchestrator — Video generation pipeline
 * Veo 3.1 → TTS Voiceover → FFmpeg Post-Process → Cover Image → Upload
 *
 * Extracted from autopilot.ts for maintainability.
 */

import supabaseAdmin from "../../supabase/admin"
import { generateImage, generateVideo, generateVoiceover } from "../gemini-client"
import { refineVideoPrompt } from "../image-pipeline"
import { processReelVideo, scenesToSubtitles } from "../video-processor"
import { COSTS, getReelDuration } from "../caption-generator"
import type { RenderContext, RenderResult } from "./types"

export async function renderReel(ctx: RenderContext): Promise<RenderResult> {
    const { config, captionData, format, selectedType, report } = ctx
    let cost = 0
    let imageUrl: string | undefined

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

    // Step 2: Load brand reference images for Veo
    const videoRefImages: { buffer: Buffer; mimeType?: string }[] = []
    const { getConfigBrandImageObjects } = await import("../configs/types")
    const brandRefObjects = getConfigBrandImageObjects(config)

    if (brandRefObjects.length > 0) {
        console.log(`📸 Loading reference images for Veo (${brandRefObjects.length} available)...`)
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
    const videoTier = config.videoTier || "fast"
    await report("video", 50, `🎬 Veo 3.1 generuje ${duration}s video...`)
    console.log(`🎬 Generuji video (Veo 3.1 ${videoTier}, ${duration}s, 9:16)...`)
    let videoBuffer: Buffer | undefined
    try {
        videoBuffer = await generateVideo(refinedVideoPrompt, {
            duration,
            aspectRatio: "9:16",
            tier: videoTier,
            referenceImages: videoRefImages.length > 0 ? videoRefImages : undefined,
        })
        cost += COSTS.videoPerSecondByTier[videoTier] * duration
        console.log(`   ✓ Raw video (${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB, ${duration}s)`)
    } catch (vidErr) {
        console.error("   ⚠️ Video generation failed:", vidErr)
    }

    // Step 3b: Generate TTS voiceover from scene narrations
    let voiceoverBuffer: Buffer | undefined
    const narrationTexts = captionData.scenes
        ?.filter(s => s.narration)
        .map(s => s.narration!) || []

    if (narrationTexts.length > 0) {
        await report("video", 65, "🎙️ Generuji český voiceover...")
        console.log(`🎙️ Generuji voiceover (${narrationTexts.length} scén, Gemini TTS)...`)
        try {
            const fullNarration = narrationTexts.join(". ")
            // Expressive delivery: derive audio tags from scene moods (Gemini 3.1 TTS supports 200+)
            const sceneMoods = [...new Set(
                (captionData.scenes || []).map(s => s.mood).filter(Boolean).slice(0, 2)
            )]
            voiceoverBuffer = await generateVoiceover(fullNarration, {
                voice: config.ttsVoice || "Kore",
                mood: "professional",
                audioTags: sceneMoods,
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
            let coverBuffer: Buffer | undefined

            // Native engine: designed cover with the hook rendered in the image + logo
            if (config.visualEngine !== "overlay") {
                try {
                    coverBuffer = await renderNativeReelCover(ctx, coverScene)
                    cost += COSTS.designerBrief + COSTS.imageQA
                } catch (nativeErr: any) {
                    console.warn(`   ⚠️ Native cover failed: ${nativeErr?.message?.substring(0, 80)} — fallback na text-free cover`)
                }
            }

            if (!coverBuffer) {
                const coverPrompt = `Instagram Reel cover image, 9:16 vertical. Scene: ${coverScene}. Style: ${config.feedAesthetic?.feel || "modern, professional"}. NO TEXT in image.`
                coverBuffer = await generateImage(coverPrompt, { aspectRatio: "9:16" })
            }

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
                    imageUrl = `${imageUrl}|${coverUrl.publicUrl}`
                    console.log(`   ✓ Cover: ${coverUrl.publicUrl}`)
                }
            }
            cost += COSTS.imageGeneration
        } catch (coverErr) {
            console.warn("   ⚠️ Cover generation failed:", coverErr)
        }
    }

    return { imageUrl, cost }
}

/**
 * Native reel cover: AI Designer mini-brief → Nano Banana Pro renders the cover
 * with the Czech hook + logo → one vision QA pass + one corrective edit.
 * Throws / returns undefined on failure — caller falls back to the text-free cover.
 */
async function renderNativeReelCover(ctx: RenderContext, coverScene: string): Promise<Buffer | undefined> {
    const { config, captionData, selectedType } = ctx
    const {
        generateDesignBrief,
        buildNativeImagePrompt,
        verifyNativeImage,
    } = await import("../image-pipeline")
    const { generateImageWithReferences, editExistingImage } = await import("../gemini-client")
    const { loadLogo } = await import("../logo-loader")

    console.log("🎨 AI Designer — native reel cover...")
    const brief = await generateDesignBrief({
        config,
        clientId: ctx.clientUuid,
        captionData: {
            hook: captionData.hook,
            imagePrompt: coverScene,
        },
        postType: selectedType.name,
        recentBriefs: ctx.recentBriefs ?? [],
        bannedArchetypes: ctx.recentArchetypes ?? [],
    })

    const prompt = `${buildNativeImagePrompt(brief, config)}

## FORMAT:
This is an Instagram REEL COVER — 9:16 vertical, bold and readable even as a small feed thumbnail.`

    const refs: { buffer: Buffer; mimeType?: string; label?: string }[] = []
    if (config.logoFile) {
        const logo = await loadLogo(config.logoFile)
        if (logo) {
            refs.push({
                buffer: logo,
                mimeType: "image/png",
                label: "brand logo — reproduce faithfully with exact shapes and colors, do not redraw",
            })
        }
    }

    let coverBuffer = await generateImageWithReferences(prompt, refs, { aspectRatio: "9:16", resolution: "2K" })

    const qaExpectation = {
        headline: captionData.hook,
        logoExpected: refs.length > 0,
    }
    const qa = await verifyNativeImage(coverBuffer, qaExpectation)
    if (!qa.ok) {
        console.log(`   ⚠️ Cover QA: ${qa.issues.join("; ")} → korektivní edit`)
        const fixed = await editExistingImage(coverBuffer, `Fix ONLY the text and logo problems — keep composition, photo, style and layout EXACTLY the same.
Render the headline as this EXACT Czech text, character-for-character including diacritics: "${captionData.hook}"
${qa.fixHint ? `Specific fix: ${qa.fixHint}` : ""}`, {
            mimeType: "image/png",
            aspectRatio: "9:16",
            resolution: "2K",
        })
        const qa2 = await verifyNativeImage(fixed, qaExpectation)
        if (!qa2.ok) {
            console.log(`   ❌ Cover neprošel QA ani po opravě`)
            return undefined
        }
        coverBuffer = fixed
    }
    console.log(`   ✅ Native cover OK (${(coverBuffer.length / 1024).toFixed(0)} KB)`)
    return coverBuffer
}
