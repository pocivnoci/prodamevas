/**
 * Eshop Product Image Scraper
 * ============================
 * Downloads product images from Upgates-based eshops (hanzfans.cz etc.)
 * 
 * Usage:
 *   npx tsx instagram/eshop-scraper.ts --config hanzfans
 *   npx tsx instagram/eshop-scraper.ts --config hanzfans --slug triko-mrdke-gang-white-black
 */

import type { ClientConfig, ProductInfo } from "./configs/types"
import { mkdir, writeFile, access } from "fs/promises"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── Types ──────────────────────────────────────────────────

export interface ProductImages {
    slug: string
    name: string
    ogImage: string | null
    galleryImages: string[]
    localPaths: string[]
}

// ─── Core Scraper ───────────────────────────────────────────

/**
 * Scrape product images from a single product page.
 * Extracts og:image and all product gallery images from HTML.
 */
export async function scrapeProduct(baseUrl: string, slug: string): Promise<ProductImages> {
    const url = `${baseUrl}/p/${slug}`
    console.log(`   📸 Fetching ${url}...`)

    const response = await fetch(url)
    if (!response.ok) {
        console.error(`   ⚠️ HTTP ${response.status} for ${url}`)
        return { slug, name: slug, ogImage: null, galleryImages: [], localPaths: [] }
    }

    const html = await response.text()

    // Extract og:image
    const ogMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)
    const ogImage = ogMatch?.[1] || null

    // Extract og:title for name
    const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)
    const name = titleMatch?.[1] || slug

    // Strategy: og:image + product gallery images from img[data-src] or slider images
    // These are the actual high-quality product photos
    const images: string[] = []

    // 1. og:image is always the main product photo
    if (ogImage) images.push(ogImage)

    // 2. Extract gallery images from the product slider (Upgates uses data-src or src on gallery imgs)
    // Look for img tags with CDN URLs matching this product slug
    const imgTagRegex = new RegExp(
        `<img[^>]+(?:src|data-src)="(https?://[^"]+cdn-upgates\\.com/[^"]*${slug.replace(/-/g, "[-_]")}[^"]*\\.(?:jpg|png|webp))"`,
        "gi"
    )
    let match
    while ((match = imgTagRegex.exec(html)) !== null) {
        const url = match[1]
        // Skip tiny thumbnails (cache paths with short hashes tend to be small)
        if (!images.includes(url)) images.push(url)
    }

    // 3. Deduplicate: same filename can appear in different cache dirs
    const seen = new Set<string>()
    const galleryImages = images.filter(url => {
        const filename = url.split("/").pop()?.split("?")[0] || url
        if (seen.has(filename)) return false
        seen.add(filename)
        return true
    }).slice(0, 5) // Max 5 images per product

    console.log(`   ✓ ${name}: ${galleryImages.length} images found`)

    return { slug, name, ogImage, galleryImages, localPaths: [] }
}

// ─── Download & Cache ───────────────────────────────────────

/**
 * Download an image from URL and save to local path.
 */
async function downloadImage(imageUrl: string, savePath: string): Promise<boolean> {
    try {
        // Skip if already exists
        try {
            await access(savePath)
            return true // Already cached
        } catch { /* doesn't exist, proceed */ }

        const response = await fetch(imageUrl)
        if (!response.ok) return false

        const buffer = Buffer.from(await response.arrayBuffer())
        await writeFile(savePath, buffer)
        return true
    } catch (err) {
        console.error(`   ⚠️ Download failed for ${imageUrl}:`, err)
        return false
    }
}

/**
 * Scrape and download all product images for a client.
 * Saves to instagram/product-images/{clientId}/
 */
export async function scrapeAllProducts(config: ClientConfig): Promise<ProductImages[]> {
    if (!config.products?.length) {
        console.log("⚠️ No products defined in config")
        return []
    }

    const outputDir = join(__dirname, "product-images", config.id)
    await mkdir(outputDir, { recursive: true })

    console.log(`\n🛍️  Scraping ${config.products.length} products from ${config.website}...\n`)

    const results: ProductImages[] = []

    for (const product of config.products) {
        if (!product.slug) {
            console.log(`   ⚠️ Skipping "${product.name}" — no slug defined`)
            continue
        }

        const scraped = await scrapeProduct(config.website, product.slug)
        const localPaths: string[] = []

        // Download each image
        for (let i = 0; i < scraped.galleryImages.length; i++) {
            const ext = scraped.galleryImages[i].split(".").pop()?.split("?")[0] || "jpg"
            const filename = `${product.slug}-${i + 1}.${ext}`
            const savePath = join(outputDir, filename)

            const ok = await downloadImage(scraped.galleryImages[i], savePath)
            if (ok) {
                localPaths.push(savePath)
            }
        }

        scraped.localPaths = localPaths
        results.push(scraped)

        console.log(`   💾 Saved ${localPaths.length} images for "${product.name}"`)

        // Small delay to be nice to the server
        await new Promise(r => setTimeout(r, 300))
    }

    console.log(`\n✅ Done! ${results.reduce((sum, r) => sum + r.localPaths.length, 0)} images saved to ${outputDir}`)

    return results
}

/**
 * Get cached product images for a specific product.
 */
export function getProductImagesDir(clientId: string): string {
    return join(__dirname, "product-images", clientId)
}

// ─── CLI ────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2)
    const configIdx = args.indexOf("--config")

    if (configIdx === -1 || !args[configIdx + 1]) {
        console.log("Usage: npx tsx instagram/eshop-scraper.ts --config <name> [--slug <product-slug>]")
        process.exit(1)
    }

    const configName = args[configIdx + 1]
    const slugIdx = args.indexOf("--slug")
    const singleSlug = slugIdx !== -1 ? args[slugIdx + 1] : null

    // Load config
    const { loadConfig } = await import("./configs")
    const config = await loadConfig(configName)

    if (singleSlug) {
        // Scrape single product
        const result = await scrapeProduct(config.website, singleSlug)
        console.log(JSON.stringify(result, null, 2))
    } else {
        // Scrape all products
        await scrapeAllProducts(config)
    }
}

// Run if called directly
main().catch(err => {
    console.error("💥 Scraper error:", err)
    process.exit(1)
})
