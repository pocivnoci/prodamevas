/**
 * Reel Orchestrator — Video generation pipeline
 * Per-clip Veo 3.1 (parallel for multi-clip) → frame QA (+1 bounded regen)
 * → TTS voiceover → FFmpeg assembly (concat + audio mix + burned subtitles)
 * → cover image → upload.
 *
 * Failure policy: a Veo hard failure (after 1 same-tier retry) THROWS — the job
 * fails and the existing refund flow returns the charge. Never a silent post
 * with an empty video, never a tier degradation.
 */

import supabaseAdmin from "../../supabase/admin"
import { generateImage, generateVideo, generateVoiceover } from "../gemini-client"
import { refineVideoPrompt, verifyReelClip, type ReelClipQA } from "../image-pipeline"
import {
    processReelVideo,
    concatWavs,
    wavDurationSec,
    extractFrames,
    planClips,
    groupScenesIntoClips,
    type ClipGroup,
} from "../video-processor"
import { COSTS, getPostTypeDef, getReelDuration, resolveCtaPolicyForPost } from "../caption-generator"
import { clampReelDuration } from "../../lib/credits"
import { loadProductPhoto } from "./media-refs"
import type { RenderContext, RenderResult } from "./types"

type ReelScene = NonNullable<RenderContext["captionData"]["scenes"]>[number]

/** QA-triggered clip regeneration only runs while enough of the 800s job budget
 *  remains for another Veo round + ffmpeg + cover (~330s elapsed cutoff). */
const REGEN_BUDGET_MS = 330_000

export async function renderReel(ctx: RenderContext): Promise<RenderResult> {
    const { config, captionData, selectedType, report, selectedProduct } = ctx
    const renderStart = Date.now()
    let cost = 0

    const scenes: ReelScene[] = captionData.scenes ?? []
    // format.reelDuration wins — applySafetyClamps caps it to the charged duration;
    // reading the config directly would bypass that billing clamp.
    let duration = ctx.format.reelDuration
        ? clampReelDuration(ctx.format.reelDuration)
        : getReelDuration(selectedType.name, config)
    // Multi-clip needs scene timing to split the timeline; a legacy script-only
    // caption renders as a single ≤8s clip.
    if (scenes.length === 0 && duration > 8) duration = 8
    const clipPlan = planClips(duration)
    const multiClip = clipPlan.length > 1
    const videoTier = config.videoTier || "fast"

    // ── Grounding references: product photo takes Veo's first slot, brand refs fill to 3
    const videoRefImages: { buffer: Buffer; mimeType?: string }[] = []
    const productPhoto = selectedProduct ? await loadProductPhoto(selectedProduct, config, ctx.clientUuid) : null
    if (productPhoto) videoRefImages.push(productPhoto)

    const { getConfigBrandImageObjects } = await import("../configs/types")
    const brandRefObjects = getConfigBrandImageObjects(config)
    const brandSlots = 3 - videoRefImages.length
    if (brandRefObjects.length > 0 && brandSlots > 0) {
        console.log(`📸 Loading reference images for Veo (${brandRefObjects.length} available)...`)
        const videoContext = [
            captionData.hook,
            scenes.map(s => s.visual).join(" "),
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
            ? scored.filter(s => s.score > 0).slice(0, brandSlots)
            : scored.sort(() => Math.random() - 0.5).slice(0, brandSlots)

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
    }

    // ── Per-clip prompt refinement (Pro ladder video director)
    await report("video", 40, "🧠 Video Director vylepšuje scénář...")
    console.log(`🧠 Vylepšuji video prompt (${clipPlan.length} klip${clipPlan.length > 1 ? "y" : ""}, Pro ladder)...`)

    const policy = resolveCtaPolicyForPost(config, selectedType.name, selectedProduct)
    const productOpt = selectedProduct
        ? { name: selectedProduct.name, description: selectedProduct.description, price: selectedProduct.price }
        : undefined

    const groups: ClipGroup<ReelScene>[] = groupScenesIntoClips(scenes, clipPlan)
    const continuityAnchor = scenes[0]
        ? `${scenes[0].visual} — mood: ${scenes[0].mood}`.substring(0, 400)
        : captionData.videoScript?.substring(0, 400) || captionData.hook

    const clipPrompts = await Promise.all(groups.map((group, i) =>
        refineVideoPrompt(
            config,
            {
                hook: captionData.hook,
                scenes: group.scenes.length > 0 ? group.scenes : undefined,
                videoScript: captionData.videoScript,
            },
            selectedType.name,
            duration,
            {
                product: productOpt,
                allowWebsiteBranding: policy.allowWebsite,
                ...(multiClip ? {
                    clip: {
                        index: i,
                        count: groups.length,
                        startSec: group.startSec,
                        durationSec: group.durationSec,
                        continuityAnchor,
                    },
                } : {}),
            }
        )
    ))
    cost += COSTS.promptRefinement * clipPrompts.length
    console.log(`   ✓ ${clipPrompts.length}× video prompt refined`)

    // ── Veo generation — clips in PARALLEL (each fits one Veo wall-clock of 2–5 min)
    const generateClip = async (prompt: string, clipDur: number, label: string): Promise<Buffer> => {
        const attempt = () => generateVideo(prompt, {
            duration: clipDur,
            aspectRatio: "9:16",
            tier: videoTier,
            referenceImages: videoRefImages.length > 0 ? videoRefImages : undefined,
        })
        try {
            const buf = await attempt()
            cost += COSTS.videoPerSecondByTier[videoTier] * clipDur
            return buf
        } catch (err) {
            console.warn(`   ⚠️ Veo ${label} selhalo — 1 retry (stejný tier ${videoTier}):`, err)
            const buf = await attempt()   // second failure propagates → job fails → refund
            cost += COSTS.videoPerSecondByTier[videoTier] * clipDur
            return buf
        }
    }

    await report("video", 50, `🎬 Veo 3.1 generuje ${duration}s video (${clipPlan.length} klip${clipPlan.length > 1 ? "y paralelně" : ""})...`)
    console.log(`🎬 Generuji video (Veo 3.1 ${videoTier}, ${duration}s = ${clipPlan.join("+")}s, 9:16)...`)
    const clipBuffers = await Promise.all(
        groups.map((g, i) => generateClip(clipPrompts[i], g.durationSec, `klip ${i + 1}/${groups.length}`))
    )
    clipBuffers.forEach((buf, i) =>
        console.log(`   ✓ Klip ${i + 1}: ${(buf.length / 1024 / 1024).toFixed(1)} MB, ${groups[i].durationSec}s`))

    // ── Frame QA per clip (judgeVision Pro ladder, fail-open) + one bounded regeneration
    await report("video", 60, "🔍 Kontroluji kvalitu videa (frame QA)...")
    const qaClip = async (buf: Buffer, group: ClipGroup<ReelScene>): Promise<ReelClipQA> => {
        const frames = await extractFrames(buf, [0.25, 0.5, 0.85].map(f => f * group.durationSec))
        cost += COSTS.frameQA
        return verifyReelClip(
            frames.map(b => ({ buffer: b, mimeType: "image/jpeg" })),
            {
                sceneDescriptions: group.scenes.length > 0
                    ? group.scenes.map(s => s.visual)
                    : [captionData.videoScript || captionData.hook],
                productRef: productPhoto && selectedProduct
                    ? { ...productPhoto, name: selectedProduct.name }
                    : undefined,
                brandNote: `${config.name} — ${config.contentFocus || ""}`.substring(0, 200),
            }
        )
    }

    let qaResults = await Promise.all(clipBuffers.map((buf, i) => qaClip(buf, groups[i])))
    qaResults.forEach((qa, i) => {
        if (!qa.ok) console.log(`   ⚠️ Klip ${i + 1} QA: ${qa.severity} — ${qa.issues.join("; ")}`)
    })

    let qaStatus: "pass" | "retry_pass" | "native_forced" = "pass"
    const severeIdx = qaResults.map((qa, i) => (qa.severity === "severe" ? i : -1)).filter(i => i >= 0)
    if (severeIdx.length > 0) {
        const elapsed = Date.now() - renderStart
        if (elapsed < REGEN_BUDGET_MS) {
            await report("video", 65, `🔄 Regeneruji ${severeIdx.length} vadný klip...`)
            console.log(`🔄 Frame QA severe u klipů [${severeIdx.map(i => i + 1).join(",")}] — 1 regenerace...`)
            await Promise.all(severeIdx.map(async i => {
                const qa = qaResults[i]
                const retryPrompt = `${clipPrompts[i]}

## QUALITY RETRY:
The previous generation failed quality control: ${qa.issues.join("; ")}.
${qa.fixHint || "Avoid these defects — clean anatomy, no rendered text, faithful subjects."}`
                clipBuffers[i] = await generateClip(retryPrompt, groups[i].durationSec, `regen klip ${i + 1}`)
                qaResults[i] = await qaClip(clipBuffers[i], groups[i])
            }))
            qaStatus = qaResults.some(q => q.severity === "severe") ? "native_forced" : "retry_pass"
            if (qaStatus === "native_forced") {
                console.log(`   ⚠️ Klip stále severe po regeneraci — ship-best (native_forced)`)
            }
        } else {
            qaStatus = "native_forced"
            console.log(`   ⏱️ Rozpočet vyčerpán (${Math.round(elapsed / 1000)}s) — přeskakuji regeneraci, ship-best`)
        }
    }

    // ── TTS voiceover — generated PER SCENE so each segment's MEASURED duration gives
    // EXACT subtitle timing (aligned to the real audio, not the scripted timeRange —
    // which was what produced overlapping, garbled captions). The clips are concatenated
    // into one voiceover track with a short natural gap between them.
    let voiceoverBuffer: Buffer | undefined
    let subtitles: { startTime: number; endTime: number; text: string }[] = []
    const narratedScenes = scenes.filter(s => s.narration?.trim())
    if (narratedScenes.length > 0) {
        await report("video", 70, "🎙️ Generuji český voiceover...")
        console.log(`🎙️ Generuji voiceover (${narratedScenes.length} scén, Gemini TTS, hlas ${config.ttsVoice || "Kore"})...`)
        try {
            const GAP_SEC = 0.12
            const wavs: Buffer[] = []
            let cursor = 0
            for (const s of narratedScenes) {
                // Clean read — no style directive (an English mood/bracket tag risked
                // being spoken aloud). The Kore voice reads Czech naturally on its own.
                const wav = await generateVoiceover(s.narration!.trim(), {
                    voice: config.ttsVoice || "Kore",
                })
                cost += COSTS.ttsVoiceover
                const dur = wavDurationSec(wav)
                subtitles.push({ startTime: cursor, endTime: cursor + dur, text: s.narration!.trim() })
                cursor += dur + GAP_SEC
                wavs.push(wav)
            }
            voiceoverBuffer = concatWavs(wavs, GAP_SEC * 1000)
            console.log(`   ✓ Voiceover ${(voiceoverBuffer.length / 1024).toFixed(0)} KB, ${cursor.toFixed(1)}s, ${subtitles.length} titulků zarovnaných na zvuk`)
        } catch (ttsErr) {
            console.warn("   ⚠️ TTS voiceover failed (continuing without):", ttsErr)
            voiceoverBuffer = undefined
            subtitles = []
        }
    }

    // ── FFmpeg assembly — ALWAYS runs: concat (multi-clip), voiceover mix, burned
    // subtitles, and a normalized IG-spec MP4 that publishing depends on.
    await report("video", 75, "🎞️ Post-processing video (střih + audio mix + titulky)...")
    console.log("🎞️ FFmpeg assembly...")
    let finalVideo: Buffer
    try {
        finalVideo = await processReelVideo({
            clipBuffers,
            voiceoverWav: voiceoverBuffer,
            subtitles: subtitles.length > 0 ? subtitles : undefined,
            voiceoverMix: 0.7,
            targetDurationSec: duration,
        })
        console.log(`   ✓ Final video (${(finalVideo.length / 1024 / 1024).toFixed(1)} MB)`)
    } catch (ffErr) {
        if (multiClip) {
            // An unstitched multi-clip reel is unshippable — fail the job (refund flow).
            throw new Error(`FFmpeg stitch failed for multi-clip reel: ${(ffErr as Error).message}`)
        }
        console.warn("   ⚠️ FFmpeg post-processing failed — shipping raw Veo clip:", ffErr)
        finalVideo = clipBuffers[0]
    }

    // ── Upload final video
    await report("video", 85, "📤 Nahrávám video...")
    console.log("📤 Nahrávám video do Supabase...")
    const timestamp = Date.now()
    // Bucket stays audit-screenshots: per-client buckets allow only image MIME types.
    const filename = `ig-reels/${ctx.clientUuid}/${timestamp}.mp4`
    const { error: uploadError } = await supabaseAdmin.storage
        .from("audit-screenshots")
        .upload(filename, finalVideo, {
            contentType: "video/mp4",
            cacheControl: "31536000",
        })
    if (uploadError) {
        // A reel post without a video is a broken draft — fail the job (refund flow).
        throw new Error(`Reel video upload failed: ${uploadError.message}`)
    }
    const { data: publicUrlData } = supabaseAdmin.storage
        .from("audit-screenshots")
        .getPublicUrl(filename)
    let imageUrl = publicUrlData.publicUrl
    console.log(`   ✓ Video URL: ${imageUrl}`)

    // ── Cover image for the feed grid (best-effort — a reel may ship coverless)
    await report("video", 90, "🖼️ Generuji cover image...")
    console.log("🖼️ Generuji cover image pro feed...")
    try {
        const coverScene = scenes[0]?.visual || captionData.hook
        let coverBuffer: Buffer | undefined

        // Native cover: designed cover with the hook rendered in the image + logo.
        try {
            coverBuffer = await renderNativeReelCover(ctx, coverScene, productPhoto)
            cost += COSTS.designerBrief + COSTS.imageQA
        } catch (nativeErr: any) {
            console.warn(`   ⚠️ Native cover failed: ${nativeErr?.message?.substring(0, 80)} — fallback na text-free cover`)
        }

        if (!coverBuffer) {
            const coverPrompt = `Instagram Reel cover image, 9:16 vertical. Scene: ${coverScene}. Style: ${config.feedAesthetic?.feel || "modern, professional"}. NO TEXT in image.`
            coverBuffer = await generateImage(coverPrompt, { aspectRatio: "9:16" })
        }

        if (coverBuffer) {
            const coverFilename = `ig-reels/${ctx.clientUuid}/${timestamp}-cover.webp`
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
        // Coverless reel is fine — parsePostMedia tolerates a missing cover.
        console.warn("   ⚠️ Cover generation failed:", coverErr)
    }

    return { imageUrl, cost, qaStatus, reelDuration: duration }
}

/**
 * Native reel cover: AI Designer mini-brief → Nano Banana Pro renders the cover
 * with the Czech hook + logo (+ product grounding when the reel is product-led)
 * → one vision QA pass + one corrective edit.
 * Throws / returns undefined on failure — caller falls back to the text-free cover.
 */
async function renderNativeReelCover(
    ctx: RenderContext,
    coverScene: string,
    productPhoto: { buffer: Buffer; mimeType: string } | null
): Promise<Buffer | undefined> {
    const { config, captionData, selectedType, selectedProduct } = ctx
    const {
        generateDesignBrief,
        buildNativeImagePrompt,
        verifyNativeImage,
    } = await import("../image-pipeline")
    const { generateImageWithReferences, editExistingImage } = await import("../gemini-client")
    const { loadLogo } = await import("../logo-loader")

    console.log("🎨 AI Designer — native reel cover...")
    const typeDef = getPostTypeDef(config, selectedType.name)
    const brief = await generateDesignBrief({
        config,
        clientId: ctx.clientUuid,
        captionData: {
            hook: captionData.hook,
            imagePrompt: coverScene,
        },
        postType: selectedType.name,
        formatBrief: typeDef ? { description: typeDef.description, visualStyle: typeDef.visualStyle } : undefined,
        recentBriefs: ctx.recentBriefs ?? [],
        bannedArchetypes: ctx.recentArchetypes ?? [],
        product: selectedProduct ? {
            name: selectedProduct.name,
            type: selectedProduct.type,
            description: selectedProduct.description,
            hasReferencePhoto: Boolean(productPhoto),
        } : undefined,
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
    if (productPhoto && selectedProduct) {
        refs.push({
            ...productPhoto,
            label: `EXACT product photo: ${selectedProduct.name}`,
        })
    }

    let coverBuffer = await generateImageWithReferences(prompt, refs, { aspectRatio: "9:16", resolution: "2K" })

    const qaExpectation = {
        headline: captionData.hook,
        logoExpected: refs.some(r => r.label?.includes("logo")),
    }
    const qaProductRef = productPhoto && selectedProduct
        ? { buffer: productPhoto.buffer, mimeType: productPhoto.mimeType, name: selectedProduct.name, mode: "if-present" as const }
        : undefined
    const qa = await verifyNativeImage(coverBuffer, qaExpectation, qaProductRef)
    if (!qa.ok) {
        console.log(`   ⚠️ Cover QA: ${qa.issues.join("; ")} → korektivní edit`)
        const fixed = await editExistingImage(coverBuffer, `Fix ONLY the text and logo problems — keep composition, photo, style and layout EXACTLY the same.
Render the headline as this EXACT Czech text, character-for-character including diacritics: "${captionData.hook}"
${qa.fixHint ? `Specific fix: ${qa.fixHint}` : ""}`, {
            mimeType: "image/png",
            aspectRatio: "9:16",
            resolution: "2K",
        })
        const qa2 = await verifyNativeImage(fixed, qaExpectation, qaProductRef)
        if (!qa2.ok) {
            console.log(`   ❌ Cover neprošel QA ani po opravě`)
            return undefined
        }
        coverBuffer = fixed
    }
    console.log(`   ✅ Native cover OK (${(coverBuffer.length / 1024).toFixed(0)} KB)`)
    return coverBuffer
}
