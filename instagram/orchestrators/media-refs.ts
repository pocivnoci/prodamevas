/**
 * Shared reference-image loading for media orchestrators.
 * Extracted from image-orchestrator so the reel path grounds on the same
 * product photo logic (DB image_urls → Supabase storage → local dev files).
 */

import supabaseAdmin from "../../supabase/admin"
import type { ClientConfig } from "../configs/types"
import type { SelectedProduct } from "./types"

/**
 * Load the product's reference photo. Priority:
 * 0. `ig_products.image_urls[0]` (live catalog row)
 * 1. `product-images` bucket — historically keyed by slug (config.id), but
 *    dashboard uploads write under the client UUID; check both layouts.
 * 2. Local filesystem (dev only).
 * Returns null when no photo exists — callers treat that as "no grounding ref".
 */
export async function loadProductPhoto(
    selectedProduct: SelectedProduct,
    config: ClientConfig,
    clientUuid: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
    if (!selectedProduct?.slug) return null

    // Priority 0: product's own image_urls from ig_products DB
    if (selectedProduct.imageUrls?.length) {
        try {
            const imgUrl = selectedProduct.imageUrls[0]
            const resp = await fetch(imgUrl)
            if (resp.ok) {
                const arrayBuf = await resp.arrayBuffer()
                console.log(`   🛍️ Loaded product image from DB image_urls: ${imgUrl.substring(0, 80)}...`)
                return {
                    buffer: Buffer.from(arrayBuf),
                    mimeType: imgUrl.endsWith(".png") ? "image/png" : "image/jpeg",
                }
            }
        } catch {
            console.warn(`   ⚠️ DB image_url fetch failed, trying storage...`)
        }
    }

    // Priority 1: Supabase storage (both directory layouts)
    try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        if (!supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL not set")
        for (const dir of [config.id, clientUuid]) {
            if (!dir) continue
            const { data: files } = await supabaseAdmin.storage
                .from("product-images")
                .list(dir, { search: selectedProduct.slug })

            const matchingFiles = (files || [])
                .filter(f => f.name.startsWith(selectedProduct.slug) && /\.(jpg|jpeg|png|webp)$/i.test(f.name))
                .sort((a, b) => a.name.localeCompare(b.name))

            if (matchingFiles.length > 0) {
                const mainFile = matchingFiles[0].name
                const publicUrl = `${supabaseUrl}/storage/v1/object/public/product-images/${dir}/${mainFile}`
                const resp = await fetch(publicUrl)
                if (resp.ok) {
                    const arrayBuf = await resp.arrayBuffer()
                    console.log(`   🛍️ Loaded product image from Supabase: ${dir}/${mainFile}`)
                    return {
                        buffer: Buffer.from(arrayBuf),
                        mimeType: mainFile.endsWith(".png") ? "image/png" : "image/jpeg",
                    }
                }
            }
        }
    } catch {
        // Supabase not available, try local
    }

    // Priority 2: Local filesystem fallback (dev only)
    try {
        const { readdir, readFile } = await import("fs/promises")
        const { join, dirname } = await import("path")
        const { fileURLToPath } = await import("url")
        const baseDir = dirname(fileURLToPath(import.meta.url))
        const productDir = join(baseDir, "..", "product-images", config.id)

        const localFiles = await readdir(productDir).catch(() => [] as string[])
        const productFiles = localFiles
            .filter(f => f.startsWith(selectedProduct.slug) && /\.(jpg|jpeg|png|webp)$/i.test(f))
            .sort()

        if (productFiles.length > 0) {
            const mainFile = productFiles[0]
            const imgBuffer = await readFile(join(productDir, mainFile))
            console.log(`   🛍️ Loaded local product image: ${mainFile}`)
            return {
                buffer: imgBuffer,
                mimeType: mainFile.endsWith(".png") ? "image/png" : "image/jpeg",
            }
        }
    } catch {
        // Local files not available
    }

    return null
}
