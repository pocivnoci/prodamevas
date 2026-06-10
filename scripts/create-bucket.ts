/**
 * Create one or more public Supabase storage buckets.
 * Replaces the former create-client-buckets / create-product-buckets /
 * create-product-references-bucket one-offs.
 *
 * Usage: npx tsx scripts/create-bucket.ts <bucket-name> [<bucket-name> ...]
 */
import supabaseAdmin from '../supabase/admin';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const names = process.argv.slice(2)
if (names.length === 0) {
    console.error("Usage: npx tsx scripts/create-bucket.ts <bucket-name> [<bucket-name> ...]")
    process.exit(1)
}

async function main() {
    for (const name of names) {
        const { error } = await supabaseAdmin.storage.createBucket(name, {
            public: true,
            allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
            fileSizeLimit: 10485760, // 10MB
        })
        if (error) {
            console.error(`❌ ${name}: ${error.message}`)
        } else {
            console.log(`✅ Bucket created: ${name}`)
        }
    }
}

main()
