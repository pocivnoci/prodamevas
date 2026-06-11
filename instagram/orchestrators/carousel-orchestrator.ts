/**
 * Carousel Orchestrator — Multi-slide image generation pipeline
 *
 * Two engines (config.visualEngine):
 *  - "native" (default): one designer call → shared design system + per-slide briefs →
 *    Nano Banana Pro renders complete slides (Czech typography + logo on cover) →
 *    vision QA with a carousel-wide corrective-edit budget (300s guard)
 *  - "overlay" (legacy): per-slide text-free image gen → Satori overlay → vision check
 *
 * Extracted from autopilot.ts for maintainability.
 */

import supabaseAdmin from "../../supabase/admin"
import sharp from "sharp"
import { generateImage, generateImageWithReferences } from "../gemini-client"
import { overlayText } from "../text-overlay"
import {
    refineCarouselPrompts,
    generateCarouselDesignBriefs,
    buildNativeImagePrompt,
    verifyNativeImage,
    refineImagePrompt,
} from "../image-pipeline"
import { loadLogo } from "../logo-loader"
import { reviewOverlayComposition } from "../editorial-board"
import { COSTS } from "../caption-generator"
import { withRetry } from "../../utils/retry"
import type { RenderContext, RenderResult } from "./types"

/** Max corrective text-fix edits per carousel — keeps worst case inside the 300s budget */
const MAX_CORRECTIVE_EDITS = 2

export async function renderCarousel(ctx: RenderContext): Promise<RenderResult> {
    if (!ctx.captionData.slides) return { cost: 0 }

    if (ctx.config.visualEngine !== "overlay" && ctx.format.overlayStyle !== "none") {
        try {
            const native = await renderCarouselNative(ctx)
            if (native) return native
        } catch (err: any) {
            console.warn(`   ⚠️ Native carousel failed: ${err?.message?.substring(0, 100)}`)
        }
        console.log("   ↩️ Native carousel nevyšel — fallback na overlay engine...")
        const fallback = await renderCarouselOverlay(ctx)
        return { ...fallback, qaStatus: "fallback" }
    }
    const result = await renderCarouselOverlay(ctx)
    return { ...result, qaStatus: "overlay" }
}

// ============================================
// NATIVE ENGINE
// ============================================

async function renderCarouselNative(ctx: RenderContext): Promise<RenderResult | null> {
    const { config, captionData, format, selectedType, report } = ctx
    let cost = 0

    const allSlides = [
        { headline: captionData.hook, subtext: captionData.imageSubtext || "", imagePrompt: captionData.imagePrompt || "" },
        ...captionData.slides!,
    ]
    const slideCount = allSlides.length
    console.log(`📸 Native carousel (${slideCount} slidů)...`)

    await report("art_director", 52, "🎨 AI Designer navrhuje design systém carouselu...")
    const { designSystem, briefs } = await generateCarouselDesignBriefs({
        config,
        clientId: ctx.clientUuid,
        allSlides,
        visualTheme: captionData.visualTheme || "",
        postType: selectedType.name,
        recentBriefs: ctx.recentBriefs ?? [],
        accentWords: captionData.accentWords,
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
    let anyRetry = false
    let coverFellBack = false

    for (let i = 0; i < allSlides.length; i++) {
        const slide = allSlides[i]
        const brief = briefs[i]
        const isCover = i === 0
        const label = isCover ? "COVER" : `Slide ${i}`
        console.log(`\n   📄 ${label}: "${slide.headline}"`)

        const processSlide = async () => {
            const prompt = `${buildNativeImagePrompt(brief, { ...config, logoFile: isCover ? config.logoFile : undefined })}

## CAROUSEL DESIGN SYSTEM (identical across all ${slideCount} slides):
${designSystem}

## SLIDE INDICATOR:
Render a small, subtle "${i + 1}/${slideCount}" indicator consistent with the design system (e.g. corner or edge).`

            const refs = isCover && logoRef ? [logoRef] : []
            let imageBuffer = refs.length
                ? await generateImageWithReferences(prompt, refs, { aspectRatio: format.aspectRatio, resolution: "2K" })
                : await generateImageWithReferences(prompt, [], { aspectRatio: format.aspectRatio, resolution: "2K" })
            cost += COSTS.imageGeneration
            console.log(`   ✓ Obrázek ${i + 1} (${(imageBuffer.length / 1024).toFixed(0)} KB)`)

            // QA every slide; corrective edits limited carousel-wide
            const qaExpectation = {
                headline: slide.headline,
                subtext: slide.subtext || undefined,
                logoExpected: isCover && !!logoRef,
            }
            const qa = await verifyNativeImage(imageBuffer, qaExpectation)
            cost += COSTS.imageQA

            if (!qa.ok && editsUsed < MAX_CORRECTIVE_EDITS) {
                editsUsed++
                anyRetry = true
                console.log(`   ⚠️ QA ${label}: ${qa.issues.join("; ")} → korektivní edit (${editsUsed}/${MAX_CORRECTIVE_EDITS})`)
                try {
                    const { editExistingImage } = await import("../gemini-client")
                    const fixPrompt = `Fix ONLY the text problems in this image — keep composition, photo, style and layout EXACTLY the same.
Render the headline as this EXACT Czech text, character-for-character including diacritics: "${slide.headline}"
${slide.subtext ? `Render the subtext as this EXACT Czech text: "${slide.subtext}"` : ""}
${qa.fixHint ? `Specific fix: ${qa.fixHint}` : ""}`
                    const fixed = await editExistingImage(imageBuffer, fixPrompt, {
                        mimeType: "image/png",
                        aspectRatio: format.aspectRatio,
                        resolution: "2K",
                    })
                    cost += COSTS.imageCorrectiveEdit
                    const qa2 = await verifyNativeImage(fixed, qaExpectation)
                    cost += COSTS.imageQA
                    if (qa2.ok) {
                        imageBuffer = fixed
                        console.log(`   ✓ Oprava prošla QA`)
                    } else if (isCover) {
                        // Cover must be right — fall back to legacy text-free + Satori overlay
                        console.log(`   ❌ Cover neprošel QA ani po opravě — Satori fallback pro cover`)
                        imageBuffer = await renderCoverViaSatori(ctx, slide, slideCount)
                        cost += COSTS.promptRefinement + COSTS.imageGeneration
                        coverFellBack = true
                    } else {
                        console.log(`   ⚠️ ${label} neprošel QA — best effort (text může mít vadu)`)
                        imageBuffer = fixed // edited version is usually still closer than the original
                    }
                } catch (editErr: any) {
                    console.warn(`   ⚠️ Korektivní edit selhal: ${editErr?.message?.substring(0, 80)}`)
                    if (isCover) {
                        imageBuffer = await renderCoverViaSatori(ctx, slide, slideCount)
                        cost += COSTS.promptRefinement + COSTS.imageGeneration
                        coverFellBack = true
                    }
                }
            } else if (!qa.ok) {
                if (isCover) {
                    console.log(`   ❌ Cover QA fail, edit budget vyčerpán — Satori fallback pro cover`)
                    imageBuffer = await renderCoverViaSatori(ctx, slide, slideCount)
                    cost += COSTS.promptRefinement + COSTS.imageGeneration
                    coverFellBack = true
                } else {
                    console.log(`   ⚠️ QA ${label} fail, edit budget vyčerpán — best effort`)
                }
            } else {
                console.log(`   ✅ QA OK`)
            }

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
        qaStatus: coverFellBack ? "fallback" : anyRetry ? "retry_pass" : "pass",
    }
}

/** Legacy cover render: text-free background + Satori "cover" overlay (QA escape hatch) */
async function renderCoverViaSatori(
    ctx: RenderContext,
    slide: { headline: string; subtext: string; imagePrompt: string },
    slideCount: number,
): Promise<Buffer> {
    const { config, captionData, format, selectedType } = ctx
    const refined = await refineImagePrompt(
        config,
        { imagePrompt: slide.imagePrompt, hook: slide.headline, imageSubtext: slide.subtext },
        selectedType.name,
        undefined,
        undefined,
        "cover",
    )
    const imageBuffer = await generateImage(
        refined.trim() + " IMPORTANT: NO TEXT, NO WORDS, NO LETTERS, NO SIGNS anywhere in the image. Pure background photo only.",
        { aspectRatio: format.aspectRatio as any },
    )
    return overlayText(imageBuffer, {
        headline: slide.headline,
        subtext: slide.subtext,
        slideInfo: { current: 1, total: slideCount },
        variant: "cover",
        textAlign: config.feedAesthetic?.textAlign,
        headlineScale: config.feedAesthetic?.headlineScale,
        gradientColors: config.overlayGradient,
        logoFile: config.logoFile,
        fontFamily: config.feedAesthetic?.fontOverride,
        accentColor: config.feedAesthetic?.accentColor,
        accentWords: captionData.accentWords,
    })
}

// ============================================
// OVERLAY ENGINE (legacy)
// ============================================

async function renderCarouselOverlay(ctx: RenderContext): Promise<RenderResult> {
    const { config, captionData, format, selectedType, report } = ctx
    let cost = 0
    let imageUrl: string | undefined

    if (!captionData.slides) return { imageUrl, cost }

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

        const processSlide = async () => {
                const refinedPrompt = refinedPrompts[i] || slide.imagePrompt
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

                    // Vision check on COVER slide only
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
        }

        try {
            await withRetry(processSlide, 1, label)
        } catch (slideErr: any) {
            console.error(`   ❌ ${label} SKIPPED:`, slideErr?.message?.substring(0, 150))
        }

        // Rate limit protection
        if (i < allSlides.length - 1) {
            await new Promise(r => setTimeout(r, 2000))
        }

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

    return { imageUrl, cost, imageStyle: `overlay:${format.overlayStyle || "cover"}` }
}
