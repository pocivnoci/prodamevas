/**
 * Widen the audit-screenshots bucket to accept reel videos.
 * The bucket was created for images (10MB, image/* only); reels also upload
 * their MP4 there (ig-reels/<clientUuid>/*.mp4) so it must allow video/mp4 and
 * a larger size (a 24s 1080p multi-clip reel can exceed 10MB). The bucket
 * fileSizeLimit cannot exceed the project's global storage upload limit, so we
 * probe down from 50MB to the largest value the project accepts.
 *
 * Idempotent — safe to re-run. Usage: npx tsx scripts/update-bucket-video.ts
 */
import supabaseAdmin from '../supabase/admin';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const BUCKET = 'audit-screenshots';
const MIME = ['image/png', 'image/jpeg', 'image/webp', 'video/mp4'];

async function main() {
    const { data: b } = await supabaseAdmin.storage.getBucket(BUCKET);
    const bAny = b as { allowed_mime_types?: string[]; file_size_limit?: number } | null;
    console.log(`current: mime=${JSON.stringify(bAny?.allowed_mime_types)} size=${bAny?.file_size_limit}`);

    for (const mb of [50, 25, 20, 15, 10]) {
        const { error } = await supabaseAdmin.storage.updateBucket(BUCKET, {
            public: true,
            allowedMimeTypes: MIME,
            fileSizeLimit: mb * 1048576,
        });
        if (!error) {
            console.log(`✅ ${BUCKET}: now accepts video/mp4, limit ${mb}MB`);
            return;
        }
        console.log(`✗ ${mb}MB: ${error.message}`);
    }
    console.error('❌ could not set any video-capable size limit');
    process.exit(1);
}

main();
