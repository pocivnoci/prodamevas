import supabaseAdmin from '../supabase/admin';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function checkBuckets() {
    const { data: buckets, error } = await supabaseAdmin.storage.listBuckets();
    if (error) {
        console.error("Error listing buckets:", error);
        return;
    }

    console.log(`Found ${buckets.length} buckets. Calculating sizes...`);
    
    for (const bucket of buckets) {
        let hasMore = true;
        let totalSize = 0;
        let fileCount = 0;

        // This is a simplified fetch, normally you'd paginate to get all, but let's just get up to 500
        const { data: files } = await supabaseAdmin.storage
            .from(bucket.name)
            .list('', { limit: 500 });
            
        if (files) {
            for (const file of files) {
                if (file.name !== '.emptyFolderPlaceholder') {
                    totalSize += file.metadata?.size || 0;
                    fileCount++;
                }
            }
        }
        
        const sizeMB = (totalSize / (1024 * 1024)).toFixed(2);
        console.log(`- ${bucket.name}: ${fileCount} files, ~${sizeMB} MB (top 500 files)`);
    }
}
checkBuckets();
