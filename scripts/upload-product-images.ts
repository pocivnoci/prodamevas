/**
 * Upload all product images from instagram/product-images/{clientId}/
 * to Supabase storage bucket "product-images".
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
    }

    console.log(`\n${'═'.repeat(50)}`)
    console.log(`📊 Done: ${uploaded} uploaded, ${skipped} skipped, ${failed} failed`)
    console.log(`${'═'.repeat(50)}`)
}

uploadAll().catch(console.error)
