/**
 * Image Orchestrator — Single image generation pipeline
 *
 * Two engines (config.visualEngine):
 *  - "native" (default): AI Designer brief → Nano Banana Pro renders the FULL post
 *    (Czech typography + logo) → vision QA → corrective edit → Satori fallback
 *  - "overlay" (legacy): brand ref loading → product scene placement →
 *    text-free image gen/edit → Satori text overlay → vision check
 *
 * Extracted from autopilot.ts for maintainability.
 */

import supabaseAdmin from "../../supabase/admin"
import sharp from "sharp"
import { generateImage, generateImageWithReferences } from "../gemini-client"
import { overlayText } from "../text-overlay"
import {
    refineImagePrompt,
    generateDesignBrief,
    buildNativeImagePrompt,
    verifyNativeImage,
} from "../image-pipeline"
import { loadLogo } from "../logo-loader"
import { reviewOverlayComposition } from "../editorial-board"
import { COSTS } from "../caption-generator"
import type { RenderContext, RenderResult } from "./types"

type RefImage = { buffer: Buffer; mimeType?: string; label?: string }

// Reference-image labels driven by each photo's OWN tags (not a narrow industry
// regex). A "product"/"food" photo must be reproduced faithfully; a place photo
// must be used as the exact location. This is what makes Nano Banana actually USE
// the brand's real photos instead of treating them as loose style inspiration.
const REF_PLACE_TAGS = ["exterior", "interior", "bedroom", "bathroom", "kitchen", "living", "pool", "restaurant", "lobby", "garden", "shop", "store", "location", "room", "space", "venue"]
const REF_PRODUCT_TAGS = ["product", "food", "drink", "dish", "merch", "bouquet", "kytice", "flower", "outfit"]
function brandRefLabel(tags: string[] = []): string {
    const t = tags.map(x => x.toLowerCase())
    if (t.some(x => REF_PRODUCT_TAGS.includes(x)))
        return "EXACT product/subject reference — reproduce this real item faithfully (same colors, shape, details); do NOT invent a different one"
    if (t.some(x => REF_PLACE_TAGS.includes(x)))
        return "real location reference — depict this EXACT place, interior and atmosphere; do NOT invent a different location"
    return "brand visual reference — match this exact style, colors and aesthetic"
}

export async function renderImage(ctx: RenderContext): Promise<RenderResult> {
    // "none" overlay style = intentionally text-free post → legacy path renders raw image
    if (ctx.config.visualEngine !== "overlay" && ctx.format.overlayStyle !== "none") {
        try {
            const native = await renderImageNative(ctx)
            if (native) return native
        } catch (err: any) {
            console.warn(`   ⚠️ Native engine failed: ${err?.message?.substring(0, 100)}`)
        }
        console.log("   ↩️ Native design nevyšel — fallback na overlay engine...")
        const fallback = await renderImageOverlay(ctx)
        return { ...fallback, qaStatus: "fallback" }
    }
    const result = await renderImageOverlay(ctx)
    return { ...result, qaStatus: "overlay" }
}

// ============================================
// NATIVE ENGINE — Nano Banana Pro designs the full post
// ============================================

async function renderImageNative(ctx: RenderContext): Promise<RenderResult | null> {
    const { config, captionData, format, selectedType, report } = ctx
    let cost = 0

    await report("art_director", 55, "🎨 AI Designer navrhuje kompozici...")
    console.log("🎨 AI Designer — generuji design brief...")
    const brief = await generateDesignBrief({
        config,
        clientId: ctx.clientUuid,
        captionData: {
            hook: captionData.hook,
            imageSubtext: captionData.imageSubtext,
            imagePrompt: captionData.imagePrompt,
            body: captionData.body,
            accentWords: captionData.accentWords,
        },
        postType: selectedType.name,
        recentBriefs: ctx.recentBriefs ?? [],
        bannedArchetypes: ctx.recentArchetypes ?? [],
    })
    cost += COSTS.designerBrief
    console.log(`   ✓ Koncept: "${brief.concept}" [${brief.layoutArchetype || "no archetype"}]`)
    console.log(`   ✓ Divergence: ${brief.divergenceNote?.substring(0, 100)}`)

    const prompt = buildNativeImagePrompt(brief, config)

    // Reference images: logo FIRST, then product photo, then brand refs (max 4 total)
    const refs: RefImage[] = []
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
    const otherRefs = await loadReferenceImages(ctx)
    otherRefs.sort((a, b) =>
        Number(b.label?.startsWith("EXACT product photo") || 0) - Number(a.label?.startsWith("EXACT product photo") || 0)
    )
    refs.push(...otherRefs.slice(0, Math.max(0, 4 - refs.length)))

    await report("rendering", 62, "🖼️ Nano Banana Pro generuje finální post...")
    console.log(`🖼️ Nano Banana Pro — native design (${refs.length} refs, 2K)...`)
    let imageBuffer = await generateImageWithReferences(prompt, refs, {
        aspectRatio: format.aspectRatio,
        resolution: "2K",
    })
    cost += COSTS.imageGeneration
    console.log(`   ✓ Obrázek (${(imageBuffer.length / 1024).toFixed(0)} KB)`)

    // Vision QA: exact Czech text + logo presence
    await report("chief_editor", 75, "👁️ Kontrola českého textu a loga...")
    console.log("👁️ QA — kontrola textu (diakritika) a loga...")
    const logoExpected = refs.some(r => r.label?.startsWith("brand logo"))
    const qaExpectation = {
        headline: captionData.hook,
        subtext: captionData.imageSubtext,
        logoExpected,
    }
    const qa = await verifyNativeImage(imageBuffer, qaExpectation)
    cost += COSTS.imageQA
    let qaStatus = "pass"

    if (!qa.ok) {
        console.log(`   ⚠️ QA problém: ${qa.issues.join("; ")}`)
        console.log(`   🔄 Korektivní edit...`)
        await report("rendering", 78, "🔧 Opravuji text v obrázku...")
        try {
            const { editExistingImage } = await import("../gemini-client")
            const fixPrompt = `Fix ONLY the text and logo problems in this image — keep the composition, photo, style, colors and layout EXACTLY the same.
Render the headline as this EXACT Czech text, character-for-character including diacritics: "${captionData.hook}"
${captionData.imageSubtext ? `Render the subtext as this EXACT Czech text: "${captionData.imageSubtext}"` : ""}
${qa.fixHint ? `Specific fix: ${qa.fixHint}` : ""}`

            const fixedBuffer = await editExistingImage(imageBuffer, fixPrompt, {
                mimeType: "image/png",
                aspectRatio: format.aspectRatio,
                resolution: "2K",
            })
            cost += COSTS.imageCorrectiveEdit
            const qa2 = await verifyNativeImage(fixedBuffer, qaExpectation)
            cost += COSTS.imageQA
            if (qa2.ok) {
                imageBuffer = fixedBuffer
                qaStatus = "retry_pass"
                console.log(`   ✓ Oprava prošla QA`)
            } else {
                console.log(`   ❌ Oprava neprošla QA: ${qa2.issues.join("; ")}`)
                return null
            }
        } catch (editErr: any) {
            console.warn(`   ⚠️ Korektivní edit selhal: ${editErr?.message?.substring(0, 80)}`)
            return null
        }
    } else {
        console.log(`   ✅ QA OK — text i logo v pořádku`)
    }

    const imageUrl = await uploadFinalImage(imageBuffer, ctx)
    if (!imageUrl) return null

    const conceptSlug = brief.concept.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").substring(0, 40)
    return {
        imageUrl,
        cost,
        imageStyle: `native:${conceptSlug}`,
        designBrief: brief,
        qaStatus,
    }
}

// ============================================
// REFERENCE IMAGE LOADING — shared by both engines
// ============================================

async function loadReferenceImages(ctx: RenderContext): Promise<RefImage[]> {
    const { config, captionData, selectedType, selectedProduct } = ctx
    const refImages: RefImage[] = []

    // Load brand reference images (scraped or uploaded)
    const { getConfigBrandImageObjects } = await import("../configs/types")
    const brandRefObjects = getConfigBrandImageObjects(config)

    if (brandRefObjects.length > 0) {
        // Per-image labels are computed from each photo's tags (see brandRefLabel).

        // Smart selection: match photos to post context using tags
        let selectedRefs: { url: string; tags: string[]; description: string }[]

        const hasTaggedImages = brandRefObjects.some(img => img.tags.length > 0)

        if (hasTaggedImages && brandRefObjects.length > 3) {
            const postContext = [
                selectedType?.name || '',
                captionData?.hook || '',
                captionData?.body?.substring(0, 100) || '',
                captionData?.imagePrompt || '',
            ].join(' ').toLowerCase()

            const scored = brandRefObjects.map(img => {
                let score = 0
                for (const tag of img.tags) {
                    if (postContext.includes(tag)) score += 3
                }
                if (img.description) {
                    const descWords = img.description.toLowerCase().split(/\s+/)
                    for (const word of descWords) {
                        if (word.length > 3 && postContext.includes(word)) score += 1
                    }
                }
                return { ...img, score }
            })

            scored.sort((a, b) => b.score - a.score)

            const topScore = scored[0]?.score || 0
            if (topScore > 0) {
                const relevant = scored.filter(s => s.score > 0)
                const topPicks = relevant.slice(0, 3)
                console.log(`   🎯 Smart selection: picked ${topPicks.length} tagged images (scores: ${topPicks.map(s => s.score).join(',')})`)
                selectedRefs = topPicks
            } else {
                selectedRefs = brandRefObjects.sort(() => Math.random() - 0.5).slice(0, 3)
                console.log(`   🎲 No tag matches — random ${selectedRefs.length} images`)
            }
        } else {
            selectedRefs = brandRefObjects.length <= 3
                ? brandRefObjects
                : brandRefObjects.sort(() => Math.random() - 0.5).slice(0, 3)
        }

        for (const ref of selectedRefs) {
            try {
                const resp = await fetch(ref.url)
                if (resp.ok) {
                    const arrayBuf = await resp.arrayBuffer()
                    const baseLabel = brandRefLabel(ref.tags)
                    const contextLabel = ref.description
                        ? `${baseLabel} — ${ref.description}`
                        : baseLabel
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

    // Load product photos
    if (selectedProduct?.slug) {
        const randomProduct = selectedProduct

        let productImageLoaded = false

        // Priority 0: Use product's own image_urls from ig_products DB
        if (!productImageLoaded && selectedProduct.imageUrls?.length) {
            try {
                const imgUrl = selectedProduct.imageUrls[0]
                const resp = await fetch(imgUrl)
                if (resp.ok) {
                    const arrayBuf = await resp.arrayBuffer()
                    const mimeType = imgUrl.endsWith(".png") ? "image/png" : "image/jpeg"
                    refImages.push({
                        buffer: Buffer.from(arrayBuf),
                        mimeType,
                        label: `EXACT product photo: ${randomProduct.name}`,
                    })
                    productImageLoaded = true
                    console.log(`   🛍️ Loaded product image from DB image_urls: ${imgUrl.substring(0, 80)}...`)
                }
            } catch (err) {
                console.warn(`   ⚠️ DB image_url fetch failed, trying storage...`)
            }
        }

        // Priority 1: Supabase storage
        if (!productImageLoaded && randomProduct.slug) {
            try {
                const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
                if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL not set')
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
                const productDir = join(baseDir, "..", "product-images", config.id)

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

    return refImages
}

// ============================================
// UPLOAD — shared by both engines
// ============================================

async function uploadFinalImage(finalImage: Buffer, ctx: RenderContext): Promise<string | undefined> {
    const { config, report } = ctx

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
        return undefined
    }

    const { data: publicUrlData } = supabaseAdmin.storage
        .from(bucketName)
        .getPublicUrl(filename)
    console.log(`   ✓ URL: ${publicUrlData.publicUrl}`)
    return publicUrlData.publicUrl
}

// ============================================
// OVERLAY ENGINE (legacy) — text-free image + Satori overlay
// ============================================

async function renderImageOverlay(ctx: RenderContext): Promise<RenderResult> {
    const { config, captionData, format, selectedType, report, selectedProduct } = ctx
    let cost = 0
    let imageUrl: string | undefined

    await report("art_director", 55, "🎨 Art Director vylepšuje image prompt...")
    console.log("🧠 Vylepšuji image prompt (2-step pipeline)...")
    const bodySnippet = captionData.body ? captionData.body.substring(0, 150) : undefined
    let refinedPrompt = await refineImagePrompt(
        config,
        captionData as { imagePrompt: string; hook: string; imageSubtext?: string },
        selectedType.name,
        bodySnippet,
        undefined,
        format.overlayStyle,
    )
    cost += COSTS.promptRefinement
    refinedPrompt = refinedPrompt.trim() + " IMPORTANT: NO TEXT, NO WORDS, NO LETTERS, NO SIGNS anywhere in the image. Pure background photo only."
    console.log(`   ✓ Prompt refined`)

    try {
        let imageBuffer: Buffer | undefined = undefined

        // Load reference images (brand refs + product photos)
        const refImages = await loadReferenceImages(ctx)

        // Product scene placement (product photo → AI edit into lifestyle scene)
        const productRef = refImages.find(r => r.label?.startsWith("EXACT product photo"))
        if (selectedProduct?.slug && productRef) {
            const randomProduct = selectedProduct
            try {
                await report("rendering", 65, `🛍️ Umisťuji produkt do scény...`)
                const productType = (randomProduct.type || "").toLowerCase()
                let sceneHint = "a stylish surface with beautiful props around it"
                if (productType.includes("food") || productType.includes("drink") || productType.includes("dessert") || productType.includes("jogurt")) {
                    sceneHint = "a wooden table, a kitchen counter, a café setting, or a hand holding it. Food photography style"
                } else if (productType.includes("cloth") || productType.includes("shirt") || productType.includes("fashion") || productType.includes("wear")) {
                    sceneHint = "a flat lay on a clean surface, worn by a person, or hanging in a stylish setting. Fashion photography style"
                } else if (productType.includes("apart") || productType.includes("real") || productType.includes("hotel") || productType.includes("room")) {
                    sceneHint = "a wider interior view showing the space in context. Architectural photography style"
                } else if (productType.includes("cosmetic") || productType.includes("beauty") || productType.includes("skin")) {
                    sceneHint = "a marble surface with botanical elements, or held by elegant hands. Beauty photography style"
                }
                const productEditPrompt = `Take this product photo and place the product into a beautiful lifestyle scene. The product must remain EXACTLY as it is — do not change its appearance, colors, shape, or any details. Just add an environment around it: ${sceneHint}, beautiful lighting, shallow depth of field. No text or words in the image.`

                const { editExistingImage } = await import("../gemini-client")
                imageBuffer = await editExistingImage(
                    productRef.buffer,
                    productEditPrompt,
                    {
                        mimeType: productRef.mimeType,
                        aspectRatio: format.aspectRatio,
                        resolution: "2K",
                    }
                )
                refImages.splice(refImages.indexOf(productRef), 1)
                console.log(`   📸 Product placed in scene via AI edit (${(imageBuffer.length / 1024).toFixed(0)} KB)`)
            } catch (editErr: any) {
                console.warn(`   ⚠️ Product scene edit failed: ${editErr.message?.substring(0, 100)}`)
                const aspectMap: Record<string, { w: number; h: number }> = {
                    "1:1": { w: 1080, h: 1080 }, "4:5": { w: 1080, h: 1350 },
                    "3:4": { w: 1080, h: 1440 }, "9:16": { w: 1080, h: 1920 },
                }
                const target = aspectMap[format.aspectRatio] || { w: 1080, h: 1440 }
                imageBuffer = await sharp(productRef.buffer)
                    .resize(target.w, target.h, { fit: "cover", position: "centre" })
                    .jpeg({ quality: 95 })
                    .toBuffer()
                refImages.splice(refImages.indexOf(productRef), 1)
                console.log(`   📸 Fallback: using raw product photo (${target.w}×${target.h})`)
            }
            console.log(`   📌 Product: "${randomProduct.name}" — scene placement mode`)
        }

        // ─── IMAGE STRATEGY: Real photos first, generation as fallback ───
        if (!imageBuffer && refImages.length > 0) {
            try {
                const bestRef = refImages[0]

                await report("rendering", 65, `🖼️ Edituji reálnou fotku...`)
                console.log(`📸 Editing REAL brand photo (not generating fake scene)`)
                console.log(`   📎 Using: ${bestRef.label?.substring(0, 80) || 'brand photo'}`)

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

                const { editExistingImage } = await import("../gemini-client")
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
        // No reference photos at all → pure generation
        if (!imageBuffer) {
            console.log("🎨 No brand photos available → Nano Banana Pro (2K)...")
            imageBuffer = await generateImage(refinedPrompt, { aspectRatio: format.aspectRatio as any })
        }
        cost += COSTS.imageGeneration
        console.log(`   ✓ Obrázek (${(imageBuffer.length / 1024).toFixed(0)} KB, 2K resolution)`)

        // Text overlay
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

            // Vision check
            await report("chief_editor", 75, "👁️ Šéfredaktor kontroluje kompozici obrázku...")
            console.log("👁️ Vision check — kontrola overlay kompozice...")
            const overlayCheck = await reviewOverlayComposition(
                finalImage,
                format.overlayStyle || "default",
                captionData.hook,
            )
            cost += COSTS.textGeneration

            if (!overlayCheck.ok && overlayCheck.issues.length > 0) {
                console.log(`   ⚠️ Overlay problém: ${overlayCheck.issues.join(", ")}`)
                console.log(`   🔄 Regeneruji obrázek s lepší kompozicí...`)

                const compositionFix = overlayCheck.compositionHint
                    ? `\nCOMPOSITION FIX: ${overlayCheck.compositionHint}. Leave the ${format.overlayStyle === "top" || format.overlayStyle === "editorial" ? "top" : "bottom"} area COMPLETELY CLEAR for text overlay.`
                    : ""
                const fixedPrompt = refinedPrompt + compositionFix

                try {
                    const retryBuffer = await generateImage(fixedPrompt, { aspectRatio: format.aspectRatio as any })
                    cost += COSTS.imageGeneration
                    console.log(`   ✓ Retry obrázek (${(retryBuffer.length / 1024).toFixed(0)} KB)`)

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

        imageUrl = await uploadFinalImage(finalImage, ctx)
    } catch (imgErr) {
        console.error("   ⚠️ Image failed:", imgErr)
    }

    return { imageUrl, cost, imageStyle: `overlay:${format.overlayStyle || "default"}` }
}
