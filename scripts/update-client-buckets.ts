/**
 * Doplní klientským bucketům typy a limit, které potřebuje reel (MP4 + voiceover WAV).
 * Jen ROZŠIŘUJE: stávající typy zůstanou, limit se nesníží. Bez --apply jen vypíše.
 *
 *   npx tsx scripts/update-client-buckets.ts            # co by se změnilo
 *   npx tsx scripts/update-client-buckets.ts --apply    # změní
 */
import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })
import supabaseAdmin from "../supabase/admin"
import { CLIENT_BUCKET_MIME_TYPES, CLIENT_BUCKET_SIZE_LIMIT } from "../lib/storage-buckets"

// `audit-screenshots` je výchozí bucket značek bez vlastního `storageBucket`.
const isClientBucket = (id: string) => id.startsWith("ig-posts") || id === "audit-screenshots"

async function main() {
    const apply = process.argv.includes("--apply")
    const { data: buckets, error } = await supabaseAdmin.storage.listBuckets()
    if (error || !buckets) throw new Error(`listBuckets: ${error?.message}`)

    let changed = 0
    for (const b of buckets.filter(b => isClientBucket(b.id))) {
        const current = b.allowed_mime_types ?? null
        // null = bez omezení typů — to je širší než náš seznam, nesahat.
        const mime = current === null ? null : [...new Set([...current, ...CLIENT_BUCKET_MIME_TYPES])]
        const needsMime = current !== null && mime!.length !== current.length
        const needsLimit = b.file_size_limit != null && b.file_size_limit < CLIENT_BUCKET_SIZE_LIMIT
        if (!needsMime && !needsLimit) continue

        changed++
        const limit = b.file_size_limit == null ? undefined : Math.max(b.file_size_limit, CLIENT_BUCKET_SIZE_LIMIT)
        console.log(`${apply ? "✏️" : "🔍"} ${b.id}: typy ${JSON.stringify(current)} → ${JSON.stringify(mime)}, limit ${b.file_size_limit} → ${limit ?? "bez limitu"}`)
        if (!apply) continue

        const { error: upErr } = await supabaseAdmin.storage.updateBucket(b.id, {
            public: b.public,
            allowedMimeTypes: mime ?? undefined,
            fileSizeLimit: limit,
        })
        if (upErr) throw new Error(`${b.id}: ${upErr.message}`)
    }
    console.log(`${apply ? "✅ Změněno" : "🔍 Ke změně"}: ${changed} bucketů${apply || changed === 0 ? "" : " — spusť s --apply"}`)
}

main().catch(err => { console.error("❌", err); process.exit(1) })
