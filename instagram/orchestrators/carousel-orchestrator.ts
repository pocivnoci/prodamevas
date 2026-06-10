/**
 * Carousel Orchestrator — Multi-slide image generation pipeline
 * Per-slide: prompt refinement → image gen → text overlay → vision check → compress → upload
 *
 * Extracted from autopilot.ts for maintainability.
 */

import supabaseAdmin from "../../supabase/admin"
import sharp from "sharp"
import { generateImage } from "../gemini-client"
import { overlayText } from "../text-overlay"
import { refineCarouselPrompts } from "../image-pipeline"
import { reviewOverlayComposition } from "../editorial-board"
import { COSTS } from "../caption-generator"
import { withRetry } from "../../utils/retry"
import type { RenderContext, RenderResult } from "./types"

export async function renderCarousel(ctx: RenderContext): Promise<RenderResult> {
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

    return { imageUrl, cost }
}
