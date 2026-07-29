/**
 * Story Orchestrator — 1-3 vertical 9:16 frames
 *
 * Native engine only: one designer call → shared design system + per-frame briefs →
 * Nano Banana Pro renders complete frames (Czech typography + logo on frame 1) →
 * vision QA with a set-wide corrective-edit budget (300s guard) and the story-only
 * safe-zone check. On QA trouble a frame keeps its best native attempt (see qaScore).
 *
 * Deliberately close to carousel-orchestrator.ts — the ship-best-native ladder is
 * copied verbatim on purpose. Where the two genuinely differ:
 *   · no cover/inner asymmetry and NO "N/M" slide indicator (a story is not a carousel)
 *   · every frame carries STORY_SAFE_ZONE_RULE and is QA'd against it
 *   · a partial set still ships: losing frame 2 of 3 leaves a perfectly good story
 */

import supabaseAdmin from "../../supabase/admin"
import sharp from "sharp"
import { generateImageWithReferences } from "../gemini-client"
import {
    generateStoryDesignBriefs,
    buildNativeImagePrompt,
    verifyNativeImage,
    qaScore,
    STORY_SAFE_ZONE_RULE,
} from "../image-pipeline"
import { loadLogo } from "../logo-loader"
import { loadReferenceImages, loadUserPhoto } from "./image-orchestrator"
import { COSTS, getPostTypeDef } from "../caption-generator"
import { getModel } from "../models"
import { withRetry } from "../../utils/retry"
import type { RenderContext, RenderResult } from "./types"

/** Max corrective text-fix edits per story set — same budget as a carousel. A 3-frame
 *  worst case (3 gens + 3 QAs + 2 edits + 1 bonus) is smaller than a 5-slide carousel's,
 *  so these numbers are already proven safe inside the 300s guard. Do NOT scale per frame. */
const MAX_CORRECTIVE_EDITS = 2
/** Separate tiny budget for "severe" (unreadable/garbled) misses — spent even when the
 *  normal budget is exhausted, because shipping unreadable typography is worse than a
 *  slightly higher bill. */
const MAX_SEVERE_BONUS_EDITS = 1

export async function renderStory(ctx: RenderContext): Promise<RenderResult> {
    if (!ctx.captionData.frames?.length) return { cost: 0 }
    try {
        const native = await renderStoryNative(ctx)
        if (native) return native
    } catch (err: any) {
        console.warn(`   ⚠️ Native story failed: ${err?.message?.substring(0, 120)}`)
    }
    return { cost: 0 }
}

// ============================================
// NATIVE ENGINE
// ============================================

async function renderStoryNative(ctx: RenderContext): Promise<RenderResult | null> {
    const { config, captionData, format, selectedType, report, selectedProduct } = ctx
    let cost = 0

    const frames = captionData.frames!
    const frameCount = frames.length
    console.log(`📱 Native story (${frameCount} snímk${frameCount === 1 ? "" : frameCount < 5 ? "y" : "ů"})...`)

    // Product reference photo — loaded BEFORE the briefs so the designer knows the real
    // product exists, and attached to EVERY frame so any depiction stays faithful.
    const productRef = selectedProduct
        ? (await loadReferenceImages(ctx)).find(r => r.label?.startsWith("EXACT product photo")) || null
        : null
    const productInfo = selectedProduct ? {
        name: selectedProduct.name,
        type: selectedProduct.type,
        description: selectedProduct.description,
        hasReferencePhoto: Boolean(productRef),
    } : undefined

    // User's own photo — becomes the mandatory visual base of the FIRST frame.
    const userPhotoRef = await loadUserPhoto(ctx.userPhotoUrl)
    const userPhotoInfo = userPhotoRef ? { description: ctx.userPhotoDescription } : undefined

    await report("art_director", 52, "🎨 AI Designer navrhuje design systém storky...")
    const typeDef = getPostTypeDef(config, selectedType.name)
    const { designSystem, briefs } = await generateStoryDesignBriefs({
        config,
        clientId: ctx.clientUuid,
        frames,
        postType: selectedType.name,
        formatBrief: typeDef ? { description: typeDef.description, visualStyle: typeDef.visualStyle } : undefined,
        recentBriefs: ctx.recentBriefs ?? [],
        bannedArchetypes: ctx.recentArchetypes ?? [],
        product: productInfo,
        userPhoto: userPhotoInfo,
    })
    cost += COSTS.designerBrief
    console.log(`   ✓ Design system: ${designSystem.substring(0, 100)}...`)

    // Logo reference goes on the FIRST frame only — repeating it on every frame reads
    // as a watermark, not a brand.
    let logoRef: { buffer: Buffer; mimeType?: string; label?: string } | null = null
    if (config.logoFile) {
        const logo = await loadLogo(config.logoFile)
        if (logo) {
            logoRef = {
                buffer: logo,
                mimeType: "image/png",
                label: "brand logo — reproduce faithfully with exact shapes and colors, do not redraw",
            }
        }
    }

    const uploadedUrls: string[] = []
    const bucketName = config.storageBucket || "audit-screenshots"
    let editsUsed = 0
    let severeBonusEditsUsed = 0
    let anyRetry = false
    let anyForced = false // a frame shipped its best native attempt without passing QA cleanly
    const modelsUsed = new Set<string>()

    for (let i = 0; i < frameCount; i++) {
        const frame = frames[i]
        const brief = briefs[i]
        const isFirst = i === 0
        const label = `Snímek ${i + 1}/${frameCount}`
        console.log(`\n   📱 ${label}: "${frame.headline}"`)

        const processFrame = async () => {
            // The client's photo is the base of the FIRST frame only.
            const frameUserPhoto = isFirst ? userPhotoInfo : undefined
            const prompt = `${buildNativeImagePrompt(brief, { ...config, logoFile: isFirst ? config.logoFile : undefined }, productInfo, frameUserPhoto)}

## STORY DESIGN SYSTEM (identical across all ${frameCount} frame${frameCount > 1 ? "s" : ""}):
${designSystem}

${STORY_SAFE_ZONE_RULE}

## FORMAT:
Vertical 9:16 Instagram story frame, full-screen on a phone. Frame ${i + 1} of ${frameCount}.
Do NOT render any page counter, slide indicator or "swipe" arrow — this is a story, not a carousel.`

            const refs = isFirst && logoRef ? [logoRef] : []
            if (isFirst && userPhotoRef) refs.push(userPhotoRef)
            if (productRef) refs.push(productRef)
            let frameModel = getModel("image")
            let imageBuffer = await generateImageWithReferences(prompt, refs, { aspectRatio: format.aspectRatio, resolution: "2K", onModel: m => { frameModel = m } })
            cost += COSTS.imageGeneration
            console.log(`   ✓ Obrázek ${i + 1} (${(imageBuffer.length / 1024).toFixed(0)} KB, model: ${frameModel})`)

            // safeZone is the one QA check stories have that feed media doesn't: text
            // under Instagram's own UI bands is invisible, and unlike a feed crop the
            // author never finds out.
            const qaExpectation = {
                headline: frame.headline,
                subtext: frame.subtext || undefined,
                logoExpected: isFirst && !!logoRef,
                safeZone: true,
            }
            const qaProductRef = productRef && selectedProduct
                ? { buffer: productRef.buffer, mimeType: productRef.mimeType, name: selectedProduct.name, mode: "if-present" as const }
                : undefined
            const qaUserPhotoRef = isFirst && userPhotoRef
                ? { buffer: userPhotoRef.buffer, mimeType: userPhotoRef.mimeType }
                : undefined
            const qa = await verifyNativeImage(imageBuffer, qaExpectation, qaProductRef, qaUserPhotoRef)
            cost += COSTS.imageQA

            // Ship-best-native per frame: retry within the set-wide edit budget and keep
            // the closest attempt. No fallback engine — a frame that can't pass cleanly
            // publishes its best native buffer (qaScore picks it).
            let bestBuffer = imageBuffer
            let bestModel = frameModel
            let bestScore = qaScore(qa)
            let bestQa = qa
            let passed = qa.ok

            if (!qa.ok && editsUsed < MAX_CORRECTIVE_EDITS) {
                editsUsed++
                anyRetry = true
                if (qa.productAccurate === false || qa.photoUsed === false) {
                    // A wrong product / an ignored client photo can't be edit-fixed (the
                    // edit model never sees the reference) — regenerate the frame once.
                    const reason = qa.photoUsed === false ? "snímek nevychází z klientovy fotky" : "produkt neodpovídá referenci"
                    console.log(`   ⚠️ QA ${label}: ${reason} → regenerace (${editsUsed}/${MAX_CORRECTIVE_EDITS})`)
                    const retryPrompt = `${prompt}

⚠️ PREVIOUS ATTEMPT WAS REJECTED — ${qa.photoUsed === false
    ? `the frame was NOT visibly built from the attached "CLIENT photo" (${qa.issues.join("; ")}).
Follow the CLIENT PHOTO FIDELITY rules exactly: it must use the client's photo (whole or a deliberate crop) as its photographic base.`
    : `the depicted product did not match the reference photo (${qa.issues.join("; ")}).
Follow the PRODUCT FIDELITY rules exactly: any depicted product must be a faithful reproduction of the attached "EXACT product photo".`}`
                    try {
                        let retryModel = getModel("image")
                        const retryBuffer = await generateImageWithReferences(retryPrompt, refs, { aspectRatio: format.aspectRatio, resolution: "2K", onModel: m => { retryModel = m } })
                        cost += COSTS.imageGeneration
                        const qa2 = await verifyNativeImage(retryBuffer, qaExpectation, qaProductRef, qaUserPhotoRef)
                        cost += COSTS.imageQA
                        if (qaScore(qa2) < bestScore) { bestBuffer = retryBuffer; bestModel = retryModel; bestScore = qaScore(qa2); bestQa = qa2; passed = qa2.ok }
                    } catch (e: any) { console.warn(`   ⚠️ Regenerace selhala: ${e?.message?.substring(0, 60)}`) }
                } else {
                    console.log(`   ⚠️ QA ${label}: ${qa.issues.join("; ")} → korektivní edit (${editsUsed}/${MAX_CORRECTIVE_EDITS})`)
                    try {
                        const { editExistingImage } = await import("../gemini-client")
                        const fixPrompt = `Fix ONLY the text problems in this image — keep composition, photo, style and layout EXACTLY the same.
Render the headline as this EXACT Czech text, character-for-character including diacritics: "${frame.headline}"
${frame.subtext ? `Render the subtext as this EXACT Czech text: "${frame.subtext}"` : ""}
All text and the logo must sit between 15% and 85% of the frame HEIGHT — Instagram's story UI covers the top and bottom bands.
${qa.fixHint ? `Specific fix: ${qa.fixHint}` : ""}`
                        let editModel = getModel("image")
                        const fixed = await editExistingImage(imageBuffer, fixPrompt, {
                            mimeType: "image/png",
                            aspectRatio: format.aspectRatio,
                            resolution: "2K",
                            onModel: m => { editModel = m },
                        })
                        cost += COSTS.imageCorrectiveEdit
                        const qa2 = await verifyNativeImage(fixed, qaExpectation, qaProductRef, qaUserPhotoRef)
                        cost += COSTS.imageQA
                        if (qaScore(qa2) < bestScore) { bestBuffer = fixed; bestModel = editModel; bestScore = qaScore(qa2); bestQa = qa2; passed = qa2.ok }
                    } catch (editErr: any) {
                        console.warn(`   ⚠️ Korektivní edit selhal: ${editErr?.message?.substring(0, 80)}`)
                    }
                }
                imageBuffer = bestBuffer
                frameModel = bestModel
                if (passed) console.log(`   ✓ ${label} prošel QA po opravě`)
                else console.log(`   ⚠️ ${label} — publikuji nejlepší nativní pokus (score ${bestScore})`)
            } else if (!qa.ok) {
                console.log(`   ⚠️ QA ${label} fail, edit budget vyčerpán — nejlepší nativní pokus`)
            } else {
                console.log(`   ✅ QA OK`)
            }

            // A "severe" miss gets one more attempt from a SEPARATE small budget.
            if (!passed && bestQa.severity === "severe" && severeBonusEditsUsed < MAX_SEVERE_BONUS_EDITS) {
                severeBonusEditsUsed++
                anyRetry = true
                console.log(`   🚨 ${label}: text nečitelný (severe) → bonusová oprava (${severeBonusEditsUsed}/${MAX_SEVERE_BONUS_EDITS})`)
                try {
                    const { editExistingImage } = await import("../gemini-client")
                    const severeFixPrompt = `The typography in this image is overlapping, duplicated or unreadable — this is NOT publishable.
Redraw ONLY the text cleanly, as flat legible typography — keep the same composition, photo, style, colors and layout.
Render the headline as this EXACT Czech text, character-for-character including diacritics: "${frame.headline}"
${frame.subtext ? `Render the subtext as this EXACT Czech text: "${frame.subtext}"` : ""}
Keep all text between 15% and 85% of the frame HEIGHT.`
                    let severeModel = getModel("image")
                    const severeBuffer = await editExistingImage(bestBuffer, severeFixPrompt, {
                        mimeType: "image/png",
                        aspectRatio: format.aspectRatio,
                        resolution: "2K",
                        onModel: m => { severeModel = m },
                    })
                    cost += COSTS.imageCorrectiveEdit
                    const qaSevere = await verifyNativeImage(severeBuffer, qaExpectation, qaProductRef, qaUserPhotoRef)
                    cost += COSTS.imageQA
                    if (qaScore(qaSevere) < bestScore) { bestBuffer = severeBuffer; bestModel = severeModel; bestScore = qaScore(qaSevere); bestQa = qaSevere; passed = qaSevere.ok }
                    imageBuffer = bestBuffer
                    frameModel = bestModel
                    if (passed) console.log(`   ✓ ${label} prošel po bonusové opravě`)
                    else console.log(`   ⚠️ ${label} — stále nečitelné, publikuji nejlepší pokus (score ${bestScore})`)
                } catch (e: any) { console.warn(`   ⚠️ Bonusová oprava selhala: ${e?.message?.substring(0, 80)}`) }
            }

            modelsUsed.add(frameModel)
            if (!passed) anyForced = true

            console.log("🗜️ Komprimuji obrázek před uploadem (PNG -> WebP)...")
            const compressedImage = await sharp(imageBuffer)
                .webp({ quality: 90, effort: 6 })
                .toBuffer()

            const timestamp = Date.now()
            const filename = `ig-stories/${timestamp}-frame${i}.webp`

            const { error: uploadError } = await supabaseAdmin.storage
                .from(bucketName)
                .upload(filename, compressedImage, {
                    contentType: "image/webp",
                    cacheControl: "31536000",
                })

            if (uploadError) {
                console.error(`   ⚠️ Upload snímku ${i + 1} failed:`, uploadError.message)
            } else {
                const { data: publicUrlData } = supabaseAdmin.storage
                    .from(bucketName)
                    .getPublicUrl(filename)
                uploadedUrls.push(publicUrlData.publicUrl)
                console.log(`   ✓ Uploaded`)
            }
        }

        try {
            await withRetry(processFrame, 1, label)
        } catch (frameErr: any) {
            console.error(`   ❌ ${label} SKIPPED:`, frameErr?.message?.substring(0, 150))
            // Frame 1 is the hook — a story without its opener is worthless, so bail out
            // and let the caller fall back to a single image. Losing a LATER frame is
            // survivable: a 2-frame story is still a story, so keep what uploaded.
            if (isFirst) return null
        }

        // Rate limit protection
        if (i < frameCount - 1) {
            await new Promise(r => setTimeout(r, 2000))
        }

        const frameProgress = 55 + Math.round((i + 1) / frameCount * 30)
        await report("rendering", frameProgress, `📱 Snímek ${i + 1}/${frameCount} hotový`)
    }

    if (uploadedUrls.length === 0) return null

    console.log(`\n   ✓ Native story: ${uploadedUrls.length}/${frameCount} snímků nahráno`)
    const conceptSlug = briefs[0].concept.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").substring(0, 40)
    return {
        imageUrl: uploadedUrls.join("|"),
        cost,
        imageStyle: `native:${conceptSlug}`,
        designBrief: briefs[0],
        qaStatus: anyForced ? "native_forced" : anyRetry ? "retry_pass" : "pass",
        imageModel: [...modelsUsed].join(", "),
    }
}
