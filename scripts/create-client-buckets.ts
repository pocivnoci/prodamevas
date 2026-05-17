import supabaseAdmin from '../supabase/admin';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function createBuckets() {
    const bucketsToCreate = ['ig-posts-mobilnamiru'];

    for (const bucket of bucketsToCreate) {
        try {
            const { data, error } = await supabaseAdmin.storage.createBucket(bucket, {
                public: true,
                allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
                fileSizeLimit: 10485760 // 10MB
            });

            if (error) {
                if (error.message.includes("already exists")) {
                    console.log(`Bucket ${bucket} already exists.`);
                } else {
                    console.error(`Error creating bucket ${bucket}:`, error);
                }
            } else {
                console.log(`Bucket ${bucket} created successfully.`);
            }
        } catch (e) {
            console.error(`Error with bucket ${bucket}:`, e);
        }
    }
}

createBuckets();
