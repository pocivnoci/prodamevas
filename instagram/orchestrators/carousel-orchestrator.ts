/**
 * Carousel Orchestrator — Multi-slide image generation pipeline
 *
 * Native engine only: one designer call → shared design system + per-slide briefs →
 * Nano Banana Pro renders complete slides (Czech typography + logo on cover) →
 * vision QA with a carousel-wide corrective-edit budget (300s guard). On QA trouble a
 * slide keeps its best native attempt (never a Satori overlay; see qaScore).
 *
 * Extracted from autopilot.ts for maintainability.
 */

import supabaseAdmin from "../../supabase/admin"
import sharp from "sharp"
import { generateImageWithReferences } from "../gemini-client"
import {
    generateCarouselDesignBriefs,
    buildNativeImagePrompt,
    verifyNativeImage,
    qaScore,
} from "../image-pipeline"
import { loadLogo } from "../logo-loader"
import { loadReferenceImages, loadUserPhoto } from "./image-orchestrator"
import { COSTS, getPostTypeDef } from "../caption-generator"
import { getModel } from "../models"
import { withRetry } from "../../utils/retry"
import type { RenderContext, RenderResult } from "./types"

/** Max corrective text-fix edits per carousel — keeps worst case inside the 300s budget */
const MAX_CORRECTIVE_EDITS = 2
/** Separate, tiny budget for "severe" (unreadable/garbled) misses — spent even when the
 *  normal edit budget above is exhausted, because shipping unreadable typography is worse
 *  than a slightly higher bill. Capped at 1 so a bad carousel can't blow past the 300s guard. */
const MAX_SEVERE_BONUS_EDITS = 1

export async function renderCarousel(ctx: RenderContext): Promise<RenderResult> {
    if (!ctx.captionData.slides) return { cost: 0 }
    // Native-only: Nano Banana Pro renders each slide with its Czech text; on QA trouble
    // it retries and keeps the best native attempt per slide (never a Satori overlay). A
    // null return means a true infra failure (the cover couldn't be generated at all).
    try {
        const native = await renderCarouselNative(ctx)
        if (native) return native
    } catch (err: any) {
        console.warn(`   ⚠️ Native carousel failed: ${err?.message?.substring(0, 120)}`)
    }
    return { cost: 0 }
}

// ============================================
// NATIVE ENGINE
// ============================================

async function renderCarouselNative(ctx: RenderContext): Promise<RenderResult | null> {
    const { config, captionData, format, selectedType, report, selectedProduct } = ctx
    let cost = 0

    const allSlides = [
        { headline: captionData.hook, subtext: captionData.imageSubtext || "", imagePrompt: captionData.imagePrompt || "" },
        ...captionData.slides!,
    ]
    const slideCount = allSlides.length
    console.log(`📸 Native carousel (${slideCount} slidů)...`)

    // Product reference photo — loaded BEFORE the briefs so the designer knows the
    // real product exists, and attached to EVERY slide render so any depiction of
    // the product stays faithful (previously carousels got only the logo → the
    // model invented the product on every slide).
    const productRef = selectedProduct
        ? (await loadReferenceImages(ctx)).find(r => r.label?.startsWith("EXACT product photo")) || null
        : null
    const productInfo = selectedProduct ? {
        name: selectedProduct.name,
        type: selectedProduct.type,
        description: selectedProduct.description,
        hasReferencePhoto: Boolean(productRef),
    } : undefined

    // User's own photo — becomes the mandatory visual base of the COVER slide.
    const userPhotoRef = await loadUserPhoto(ctx.userPhotoUrl)
    const userPhotoInfo = userPhotoRef ? { description: ctx.userPhotoDescription } : undefined

    await report("art_director", 52, "🎨 AI Designer navrhuje design systém carouselu...")
    const typeDef = getPostTypeDef(config, selectedType.name)
    const { designSystem, briefs } = await generateCarouselDesignBriefs({
        config,
        clientId: ctx.clientUuid,
        allSlides,
        visualTheme: captionData.visualTheme || "",
        postType: selectedType.name,
        formatBrief: typeDef ? { description: typeDef.description, visualStyle: typeDef.visualStyle } : undefined,
        recentBriefs: ctx.recentBriefs ?? [],
        bannedArchetypes: ctx.recentArchetypes ?? [],
        slotIntent: ctx.slotIntent,
        accentWords: captionData.accentWords,
        product: productInfo,
        userPhoto: userPhotoInfo,
    })
    cost += COSTS.designerBrief
    console.log(`   ✓ Design system: ${designSystem.substring(0, 100)}...`)

    // Logo reference goes on the COVER only
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
    let anyForced = false // a slide shipped its best native attempt without passing QA cleanly
    const modelsUsed = new Set<string>() // every image-model tier that actually rendered a shipped slide

    for (let i = 0; i < allSlides.length; i++) {
        const slide = allSlides[i]
        const brief = briefs[i]
        const isCover = i === 0
        const label = isCover ? "COVER" : `Slide ${i}`
        console.log(`\n   📄 ${label}: "${slide.headline}"`)

        const processSlide = async () => {
            // The client's photo is the base of the COVER only — inner slides keep the
            // design system and must not receive the photo as a reference.
            const slideUserPhoto = isCover ? userPhotoInfo : undefined
            // The indicator goes in THROUGH buildNativeImagePrompt (allowedExtraText), not
            // appended after it: the base prompt forbids "any other text anywhere", so
            // tacking the request on afterwards left the model with two opposite orders —
            // and QA, which was never told the indicator was wanted, then reported it as
            // unwanted extra text and spent the carousel-wide edit budget on it.
            const slideIndicator = `${i + 1}/${slideCount}`
            const prompt = `${buildNativeImagePrompt(brief, { ...config, logoFile: isCover ? config.logoFile : undefined }, productInfo, slideUserPhoto, slideIndicator)}

## CAROUSEL DESIGN SYSTEM (identical across all ${slideCount} slides):
${designSystem}

## SLIDE INDICATOR:
Place the "${slideIndicator}" indicator in a corner or at an edge, styled to match the design system.`

            const refs = isCover && logoRef ? [logoRef] : []
            if (isCover && userPhotoRef) refs.push(userPhotoRef)
            if (productRef) refs.push(productRef)
            let slideModel = getModel("image")
            let imageBuffer = await generateImageWithReferences(prompt, refs, { aspectRatio: format.aspectRatio, resolution: "2K", onModel: m => { slideModel = m } })
            cost += COSTS.imageGeneration
            console.log(`   ✓ Obrázek ${i + 1} (${(imageBuffer.length / 1024).toFixed(0)} KB, model: ${slideModel})`)

            // QA every slide; corrective edits limited carousel-wide. Product fidelity
            // is "if-present": a slide may not show the product, but a depicted
            // product must match the reference photo.
            const qaExpectation = {
                headline: slide.headline,
                subtext: slide.subtext || undefined,
                logoExpected: isCover && !!logoRef,
                allowedExtraText: slideIndicator,
            }
            const qaProductRef = productRef && selectedProduct
                ? { buffer: productRef.buffer, mimeType: productRef.mimeType, name: selectedProduct.name, mode: "if-present" as const }
                : undefined
            const qaUserPhotoRef = isCover && userPhotoRef
                ? { buffer: userPhotoRef.buffer, mimeType: userPhotoRef.mimeType }
                : undefined
            const qa = await verifyNativeImage(imageBuffer, qaExpectation, qaProductRef, qaUserPhotoRef)
            cost += COSTS.imageQA

            // Ship-best-native per slide: retry within the carousel-wide edit budget and
            // keep the closest attempt. No Satori escape hatch — a slide that can't pass
            // cleanly publishes its best native buffer (qaScore picks it).
            let bestBuffer = imageBuffer
            let bestModel = slideModel
            let bestScore = qaScore(qa)
            let bestQa = qa
            let passed = qa.ok

            if (!qa.ok && editsUsed < MAX_CORRECTIVE_EDITS) {
                editsUsed++
                anyRetry = true
                if (qa.productAccurate === false || qa.photoUsed === false) {
                    // A wrong product / an ignored client photo can't be edit-fixed (the
                    // edit model never sees the reference) — regenerate the slide once.
                    const reason = qa.photoUsed === false ? "cover nevychází z klientovy fotky" : "produkt neodpovídá referenci"
                    console.log(`   ⚠️ QA ${label}: ${reason} → regenerace (${editsUsed}/${MAX_CORRECTIVE_EDITS})`)
                    const retryPrompt = `${prompt}

⚠️ PREVIOUS ATTEMPT WAS REJECTED — ${qa.photoUsed === false
    ? `the cover was NOT visibly built from the attached "CLIENT photo" (${qa.issues.join("; ")}).
Follow the CLIENT PHOTO FIDELITY rules exactly: the cover must use the client's photo (whole or a deliberate crop) as its photographic base.`
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
Render the headline as this EXACT Czech text, character-for-character including diacritics: "${slide.headline}"
${slide.subtext ? `Render the subtext as this EXACT Czech text: "${slide.subtext}"` : ""}
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
                slideModel = bestModel
                if (passed) console.log(`   ✓ ${label} prošel QA po opravě`)
                else console.log(`   ⚠️ ${label} — publikuji nejlepší nativní pokus (score ${bestScore})`)
            } else if (!qa.ok) {
                console.log(`   ⚠️ QA ${label} fail, edit budget vyčerpán — nejlepší nativní pokus`)
            } else {
                console.log(`   ✅ QA OK`)
            }

            // A "severe" miss (overlapping/duplicated/garbled/unreadable text) gets one more
            // attempt from a SEPARATE small budget, even if the normal edit budget above is
            // already spent — an unreadable slide is worse than a slightly higher bill.
            if (!passed && bestQa.severity === "severe" && severeBonusEditsUsed < MAX_SEVERE_BONUS_EDITS) {
                severeBonusEditsUsed++
                anyRetry = true
                console.log(`   🚨 ${label}: text nečitelný (severe) → bonusová oprava (${severeBonusEditsUsed}/${MAX_SEVERE_BONUS_EDITS})`)
                try {
                    const { editExistingImage } = await import("../gemini-client")
                    const severeFixPrompt = `The typography in this image is overlapping, duplicated or unreadable — this is NOT publishable.
Redraw ONLY the text cleanly, as flat legible typography — keep the same composition, photo, style, colors and layout.
Render the headline as this EXACT Czech text, character-for-character including diacritics: "${slide.headline}"
${slide.subtext ? `Render the subtext as this EXACT Czech text: "${slide.subtext}"` : ""}`
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
                    slideModel = bestModel
                    if (passed) console.log(`   ✓ ${label} prošel po bonusové opravě`)
                    else console.log(`   ⚠️ ${label} — stále nečitelné, publikuji nejlepší pokus (score ${bestScore})`)
                } catch (e: any) { console.warn(`   ⚠️ Bonusová oprava selhala: ${e?.message?.substring(0, 80)}`) }
            }

            modelsUsed.add(slideModel)
            if (!passed) anyForced = true // final state after every retry (incl. the severe bonus)

            console.log("🗜️ Komprimuji obrázek před uploadem (PNG -> WebP)...")
            const compressedImage = await sharp(imageBuffer)
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
        }

        try {
            await withRetry(processSlide, 1, label)
        } catch (slideErr: any) {
            console.error(`   ❌ ${label} SKIPPED:`, slideErr?.message?.substring(0, 150))
            if (isCover) return null // a carousel without a cover is worthless — full fallback
        }

        // Rate limit protection
        if (i < allSlides.length - 1) {
            await new Promise(r => setTimeout(r, 2000))
        }

        const slideProgress = 55 + Math.round((i + 1) / allSlides.length * 30)
        await report("rendering", slideProgress, `📄 Slide ${i + 1}/${allSlides.length} hotový`)
    }

    if (uploadedUrls.length === 0) return null

    console.log(`\n   ✓ Native carousel: ${uploadedUrls.length}/${slideCount} slidů nahráno`)
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
