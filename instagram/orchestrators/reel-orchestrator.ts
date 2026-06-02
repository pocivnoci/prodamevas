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
