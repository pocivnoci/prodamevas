/**
 * Vyprázdní vyjmenované buckety (údržba místa v Supabase).
 *
 *   npx tsx scripts/clear-storage.ts                 # buckety zadané níž
 *   npx tsx scripts/clear-storage.ts ig-posts-neco   # jen konkrétní buckety
 *
 * Rekurzivní výpis a mazání po dávkách žije v `lib/storage-cleanup.ts` — sdílí ho
 * i `scripts/smazat-opustene-klienty.ts`. Seznam níž je ruční a zastarává; na
 * mazání dat konkrétní značky se NESMÍ používat (bucket se bere z
 * `config.storageBucket`), proto ho tenhle skript drží jen jako pohodlí pro
 * úklid demo dat.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { emptyBucket } from '../lib/storage-cleanup';

// Buckety, ve kterých obvykle leží generované/dočasné soubory.
const BUCKETS_TO_CLEAR = [
  'ig-posts',
  'ig-posts-mobilnamiru',
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

async function main() {
    const args = process.argv.slice(2);
    const targetBuckets = args.length > 0 ? args : BUCKETS_TO_CLEAR;

    console.log("Začínám s promazáváním Storage (mimo audit-screenshots, kde jsou důležité referenční fotky)...");

    for (const bucket of targetBuckets) {
        console.log(`\n--- Skenování bucketu: ${bucket} ---`);
        try {
            const smazano = await emptyBucket(bucket, {
                onProgress: (hotovo, celkem) => console.log(`Smazáno ${hotovo}/${celkem} souborů z ${bucket}...`),
            });
            if (smazano === 0) console.log(`Žádné soubory k odstranění v ${bucket}.`);
        } catch (err: any) {
            console.error(`Chyba u ${bucket}: ${err?.message || err}`);
        }
    }

    console.log("\nPromazávání dokončeno. Místo by se mělo v Supabase uvolnit.");
}

main().catch(console.error);
