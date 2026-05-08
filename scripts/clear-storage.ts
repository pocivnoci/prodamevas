import supabaseAdmin from '../supabase/admin';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// These are buckets that usually contain generated/temporary files
const BUCKETS_TO_CLEAR = [
  'ig-posts',
  'ig-posts-mobilnamiru',
  'ig-posts-hanzfans',
  'product-designs',
  'product-concepts',
  'product-mockups',
  'product-images',
  'ig-posts-laura-wine',
  'ig-posts-popadinec-cz',
  'ig-posts-stara-hospoda-doubice',
  'ig-posts-showpark',
  'ig-posts-vani-stehovani'
];

async function listAllFiles(bucketName: string, path: string = ''): Promise<string[]> {
    const allFiles: string[] = [];
    const { data, error } = await supabaseAdmin.storage.from(bucketName).list(path, { limit: 1000 });
    
    if (error) {
        console.error(`Error listing path "${path}" in ${bucketName}:`, error.message);
        return [];
    }

    if (!data) return [];

    for (const item of data) {
        if (item.name === '.emptyFolderPlaceholder') continue;
        
        // If it has no metadata or id is null, it's a folder
        if (!item.id || item.metadata === null || (item.metadata && Object.keys(item.metadata).length === 0)) {
            const folderPath = path ? `${path}/${item.name}` : item.name;
            const subFiles = await listAllFiles(bucketName, folderPath);
            allFiles.push(...subFiles);
        } else {
            const filePath = path ? `${path}/${item.name}` : item.name;
            allFiles.push(filePath);
        }
    }
    
    return allFiles;
}

async function clearBucket(bucketName: string) {
    console.log(`\n--- Skkenování bucketu: ${bucketName} ---`);
    const filesToDelete = await listAllFiles(bucketName);
    
    if (filesToDelete.length === 0) {
        console.log(`Žádné soubory k odstranění v ${bucketName}.`);
        return;
    }

    console.log(`Nalezeno ${filesToDelete.length} souborů k odstranění v ${bucketName}...`);

    // Delete in chunks of 100
    const chunkSize = 100;
    for (let i = 0; i < filesToDelete.length; i += chunkSize) {
        const chunk = filesToDelete.slice(i, i + chunkSize);
        const { error: deleteError } = await supabaseAdmin.storage
            .from(bucketName)
            .remove(chunk);

        if (deleteError) {
            console.error(`Chyba při mazání souborů v ${bucketName}:`, deleteError.message);
        } else {
            console.log(`Smazáno ${chunk.length} souborů z ${bucketName} (${i + chunk.length}/${filesToDelete.length})...`);
        }
    }
}

async function main() {
    const args = process.argv.slice(2);
    let targetBuckets = BUCKETS_TO_CLEAR;

    if (args.length > 0) {
        targetBuckets = args;
    }

    console.log("Začínám s promazáváním Storage (mimo audit-screenshots, kde jsou důležité referenční fotky)...");
    
    for (const bucket of targetBuckets) {
        await clearBucket(bucket);
    }
    
    console.log("\nPromazávání dokončeno. Místo by se mělo v Supabase uvolnit.");
}

main().catch(console.error);
