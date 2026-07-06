/**
 * Image Orchestrator — Single image generation pipeline
 *
 * Native engine only: AI Designer brief → Nano Banana Pro renders the FULL post
 * (Czech typography + logo) → vision QA → corrective edit / fresh regen →
 * ship the best native attempt (never a Satori overlay; see qaScore / "native_forced").
 *
 * Extracted from autopilot.ts for maintainability.
 */

import supabaseAdmin from "../../supabase/admin"
import sharp from "sharp"
import { generateImageWithReferences } from "../gemini-client"
import {
    generateDesignBrief,
    buildNativeImagePrompt,
    verifyNativeImage,
    qaScore,
} from "../image-pipeline"
import { loadLogo } from "../logo-loader"
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
    // overlayStyle "none" = intentionally text-free, and is ONLY valid for reels. But this is the
    // IMAGE orchestrator — a static post always needs its Czech headline/logo. A reel-format type
    // whose reel got clamped to an image (reels off) still arrives with overlayStyle "none", which
    // would otherwise render a bare text-free photo (the "post without text" bug). Coerce it to a
    // real overlay. Copy the format — never mutate the cached config.postFormats reference.
    if (ctx.format.overlayStyle === "none") {
        ctx = { ...ctx, format: { ...ctx.format, overlayStyle: "default" } }
    }
    // Native-only: Nano Banana Pro designs the full post. On QA trouble it retries and
    // ships the best native attempt (never a Satori overlay). A null return here means a
    // true infrastructure failure (generation/upload threw) — the post ships imageless.
    try {
        const native = await renderImageNative(ctx)
        if (native) return native
    } catch (err: any) {
        console.warn(`   ⚠️ Native engine failed: ${err?.message?.substring(0, 120)}`)
    }
    return { cost: 0 }
}

// ============================================
// NATIVE ENGINE — Nano Banana Pro designs the full post
// ============================================

async function renderImageNative(ctx: RenderContext): Promise<RenderResult | null> {
    const { config, captionData, format, selectedType, report, selectedProduct } = ctx
    let cost = 0

    // Reference images load BEFORE the design brief — the designer must know whether
    // an exact product photo exists, otherwise it invents a composition (and Nano
    // Banana then invents the product) even though the real photo is attached.
    const otherRefs = await loadReferenceImages(ctx)
    otherRefs.sort((a, b) =>
        Number(b.label?.startsWith("EXACT product photo") || 0) - Number(a.label?.startsWith("EXACT product photo") || 0)
    )
    const productRef = otherRefs.find(r => r.label?.startsWith("EXACT product photo"))
    const productInfo = selectedProduct ? {
        name: selectedProduct.name,
        type: selectedProduct.type,
        description: selectedProduct.description,
        hasReferencePhoto: Boolean(productRef),
    } : undefined

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
        product: productInfo,
    })
    cost += COSTS.designerBrief
    console.log(`   ✓ Koncept: "${brief.concept}" [${brief.layoutArchetype || "no archetype"}]`)
    console.log(`   ✓ Divergence: ${brief.divergenceNote?.substring(0, 100)}`)

    const prompt = buildNativeImagePrompt(brief, config, productInfo)

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
    refs.push(...otherRefs.slice(0, Math.max(0, 4 - refs.length)))

    await report("rendering", 62, "🖼️ Nano Banana Pro generuje finální post...")
    console.log(`🖼️ Nano Banana Pro — native design (${refs.length} refs, 2K)...`)
    let imageBuffer = await generateImageWithReferences(prompt, refs, {
        aspectRatio: format.aspectRatio,
        resolution: "2K",
    })
    cost += COSTS.imageGeneration
    console.log(`   ✓ Obrázek (${(imageBuffer.length / 1024).toFixed(0)} KB)`)

    // Vision QA: exact Czech text + logo presence + product fidelity (vs reference photo)
    await report("chief_editor", 75, "👁️ Kontrola textu, loga a věrnosti produktu...")
    console.log(`👁️ QA — text (diakritika), logo${productRef ? ", věrnost produktu" : ""}...`)
    const logoExpected = refs.some(r => r.label?.startsWith("brand logo"))
    const qaExpectation = {
        headline: captionData.hook,
        subtext: captionData.imageSubtext,
        logoExpected,
    }
    const qaProductRef = productRef && selectedProduct
        ? { buffer: productRef.buffer, mimeType: productRef.mimeType, name: selectedProduct.name }
        : undefined
    const qa = await verifyNativeImage(imageBuffer, qaExpectation, qaProductRef)
    cost += COSTS.imageQA

    // Ship-best-native: track every attempt and keep the closest one. On QA trouble we
    // retry (targeted fix + one fresh regen) but NEVER drop to a Satori overlay — if
    // nothing passes cleanly we publish the best-scoring native buffer (qaStatus
    // "native_forced"), which beats both a bare overlay and an empty post.
    let bestBuffer = imageBuffer
    let bestScore = qaScore(qa)
    let passed = qa.ok
    let qaStatus = qa.ok ? "pass" : "retry_pass"

    if (!qa.ok) {
        if (qa.productAccurate === false) {
            // A wrong product can't be edit-fixed (the edit model never sees the
            // reference) — regenerate with the references still attached.
            console.log(`   ⚠️ QA: produkt neodpovídá referenci: ${qa.issues.join("; ")} → regeneruji`)
            await report("rendering", 78, "🔧 Regeneruji — produkt musí odpovídat fotce...")
            const retryPrompt = `${prompt}

⚠️ PREVIOUS ATTEMPT WAS REJECTED — the product did not match the reference photo (${qa.issues.join("; ")}).
Follow the PRODUCT FIDELITY rules exactly: the product must be a faithful reproduction of the attached "EXACT product photo".`
            try {
                const retryBuffer = await generateImageWithReferences(retryPrompt, refs, { aspectRatio: format.aspectRatio, resolution: "2K" })
                cost += COSTS.imageGeneration
                const qaRetry = await verifyNativeImage(retryBuffer, qaExpectation, qaProductRef)
                cost += COSTS.imageQA
                if (qaScore(qaRetry) < bestScore) { bestBuffer = retryBuffer; bestScore = qaScore(qaRetry); passed = qaRetry.ok }
            } catch (e: any) { console.warn(`   ⚠️ Regenerace selhala: ${e?.message?.substring(0, 80)}`) }
        } else {
            console.log(`   ⚠️ QA problém: ${qa.issues.join("; ")} → korektivní edit`)
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
                const qa2 = await verifyNativeImage(fixedBuffer, qaExpectation, qaProductRef)
                cost += COSTS.imageQA
                if (qaScore(qa2) < bestScore) { bestBuffer = fixedBuffer; bestScore = qaScore(qa2); passed = qa2.ok }
            } catch (editErr: any) {
                console.warn(`   ⚠️ Korektivní edit selhal: ${editErr?.message?.substring(0, 80)}`)
            }
        }

        // One fresh full regeneration before giving up — a clean second draw often beats
        // a patched first one.
        if (!passed) {
            console.log(`   🔄 Poslední pokus — čerstvá regenerace...`)
            await report("rendering", 80, "🔧 Poslední pokus o čistý render...")
            try {
                const freshBuffer = await generateImageWithReferences(prompt, refs, { aspectRatio: format.aspectRatio, resolution: "2K" })
                cost += COSTS.imageGeneration
                const qaFresh = await verifyNativeImage(freshBuffer, qaExpectation, qaProductRef)
                cost += COSTS.imageQA
                if (qaScore(qaFresh) < bestScore) { bestBuffer = freshBuffer; bestScore = qaScore(qaFresh); passed = qaFresh.ok }
            } catch (e: any) { console.warn(`   ⚠️ Regenerace selhala: ${e?.message?.substring(0, 80)}`) }
        }

        imageBuffer = bestBuffer
        if (passed) {
            qaStatus = "retry_pass"
            console.log(`   ✓ Prošlo QA po opravě`)
        } else {
            qaStatus = "native_forced"
            console.log(`   ⚠️ QA se nepodařilo splnit — publikuji nejlepší nativní pokus (score ${bestScore})`)
        }
    } else {
        console.log(`   ✅ QA OK — text${productRef ? ", logo i produkt" : " i logo"} v pořádku`)
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
// REFERENCE IMAGE LOADING — shared by both engines (and the carousel orchestrator)
// ============================================

export async function loadReferenceImages(ctx: RenderContext): Promise<RefImage[]> {
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

        // Priority 1: Supabase storage — historically keyed by slug (config.id), but
        // dashboard uploads write under the client UUID; check both layouts.
        if (!productImageLoaded && randomProduct.slug) {
            try {
                const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
                if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL not set')
                for (const dir of [config.id, ctx.clientUuid]) {
                    if (productImageLoaded || !dir) continue
                    const { data: files } = await supabaseAdmin.storage
                        .from('product-images')
                        .list(dir, { search: randomProduct.slug })

                    const matchingFiles = (files || [])
                        .filter(f => f.name.startsWith(randomProduct.slug) && /\.(jpg|jpeg|png|webp)$/i.test(f.name))
                        .sort((a, b) => a.name.localeCompare(b.name))

                    if (matchingFiles.length > 0) {
                        const mainFile = matchingFiles[0].name
                        const publicUrl = `${supabaseUrl}/storage/v1/object/public/product-images/${dir}/${mainFile}`
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
                            console.log(`   🛍️ Loaded product image from Supabase: ${dir}/${mainFile}`)
                        }
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
