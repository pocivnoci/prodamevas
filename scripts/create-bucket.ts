import supabaseAdmin from '../supabase/admin';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function createBucket() {
    const { data, error } = await supabaseAdmin.storage.createBucket('audit-screenshots', {
        public: true,
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        fileSizeLimit: 10485760 // 10MB
    });

    if (error) {
        console.error("Error creating bucket:", error);
    } else {
        console.log("Bucket created successfully:", data);

        // Let's create `ig-posts` bucket just in case
        await supabaseAdmin.storage.createBucket('ig-posts', {
            public: true,
            allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
            fileSizeLimit: 10485760
        });
        console.log("Created ig-posts bucket too.");
    }
}
createBucket();
