/**
 * Upload all product images from instagram/product-images/{slug}/
 * to Supabase storage bucket "product-images" AND sync the public URLs
 * into ig_products.image_urls (the engine's Priority-0 source — the only
 * one that works on Vercel, where the local dir doesn't exist).
 *
 * File naming contract: {product-slug}-{n}.{jpg|png|webp} — the numeric
 * suffix is required so a slug that is a prefix of another slug
 * (triko-x vs triko-x-neon) can't steal the longer slug's photos.
 *
 * Usage: npx tsx scripts/upload-product-images.ts
 */

import supabaseAdmin from '../supabase/admin'
import { readdir, readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const BUCKET = 'product-images'
const __dirname = dirname(fileURLToPath(import.meta.url))

async function ensureBucket() {
    const { data: buckets } = await supabaseAdmin.storage.listBuckets()
    const exists = buckets?.some(b => b.name === BUCKET)
    if (!exists) {
        const { error } = await supabaseAdmin.storage.createBucket(BUCKET, {
            public: true,
            fileSizeLimit: 5 * 1024 * 1024, // 5MB
        })
        if (error) throw new Error(`Failed to create bucket: ${error.message}`)
        console.log(`✅ Bucket "${BUCKET}" created`)
    } else {
        console.log(`✅ Bucket "${BUCKET}" already exists`)
    }
}

async function uploadAll() {
    await ensureBucket()

    const baseDir = join(__dirname, '..', 'instagram', 'product-images')
    const clients = await readdir(baseDir)

    let uploaded = 0
    let skipped = 0
    let failed = 0

    for (const clientId of clients) {
        if (clientId.startsWith('.')) continue

        const clientDir = join(baseDir, clientId)
        const files = await readdir(clientDir)
        const imageFiles = files.filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))

        console.log(`\n📂 ${clientId}: ${imageFiles.length} images`)

        for (const file of imageFiles) {
            const storagePath = `${clientId}/${file}`
            const filePath = join(clientDir, file)

            // Check if already uploaded
            const { data: existing } = await supabaseAdmin.storage
                .from(BUCKET)
                .list(clientId, { search: file })

            if (existing?.some(f => f.name === file)) {
                console.log(`   ⏭️  ${file} (already exists)`)
                skipped++
                continue
            }

            const buffer = await readFile(filePath)
            const contentType = file.endsWith('.png') ? 'image/png' : 'image/jpeg'

            const { error } = await supabaseAdmin.storage
                .from(BUCKET)
                .upload(storagePath, buffer, {
                    contentType,
                    upsert: true,
                })

            if (error) {
                console.error(`   ❌ ${file}: ${error.message}`)
                failed++
            } else {
                const { data: urlData } = supabaseAdmin.storage
                    .from(BUCKET)
                    .getPublicUrl(storagePath)
                console.log(`   ✅ ${file} → ${urlData.publicUrl}`)
                uploaded++
            }
        }

        await syncImageUrls(clientId, imageFiles)
    }

    console.log(`\n${'═'.repeat(50)}`)
    console.log(`📊 Done: ${uploaded} uploaded, ${skipped} skipped, ${failed} failed`)
    console.log(`${'═'.repeat(50)}`)
}

/**
 * Point ig_products.image_urls at the uploaded storage files.
 * Match rule: file name === `${product.slug}-{number}.{ext}` (exact slug +
 * numeric suffix). Only fills products whose image_urls is empty — never
 * overwrites URLs uploaded manually through the dashboard.
 */
async function syncImageUrls(slug: string, imageFiles: string[]) {
    const { data: client } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('slug', slug)
        .single()
    if (!client) {
        console.warn(`   ⚠️ No client row for slug "${slug}" — skipping image_urls sync`)
        return
    }

    const { data: products } = await supabaseAdmin
        .from('ig_products')
        .select('id, name, slug, image_urls')
        .eq('client_id', client.id)

    let synced = 0
    for (const product of products || []) {
        if ((product.image_urls || []).length > 0) continue // manual uploads win
        const pattern = new RegExp(`^${product.slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+\\.(jpg|jpeg|png|webp)$`, 'i')
        const matches = imageFiles.filter(f => pattern.test(f)).sort()
        if (matches.length === 0) continue

        const urls = matches.map(f =>
            supabaseAdmin.storage.from(BUCKET).getPublicUrl(`${slug}/${f}`).data.publicUrl
        )
        const { error } = await supabaseAdmin
            .from('ig_products')
            .update({ image_urls: urls, updated_at: new Date().toISOString() })
            .eq('id', product.id)
        if (error) {
            console.error(`   ❌ image_urls sync "${product.name}": ${error.message}`)
        } else {
            console.log(`   🔗 ${product.name}: ${urls.length} image_urls`)
            synced++
        }
    }
    console.log(`   📦 image_urls synced for ${synced} products`)
}

uploadAll().catch(console.error)
