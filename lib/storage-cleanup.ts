/**
 * Vyprázdnění bucketu — rekurzivní výpis a mazání po dávkách.
 * ==========================================================
 * Supabase Storage nemá „smaž celý prefix": `remove()` bere seznam konkrétních
 * cest a `list()` vrací jen jednu úroveň, takže složky se musí obcházet ručně.
 * Vzor žil v `scripts/clear-storage.ts` nad natvrdo psaným seznamem bucketů —
 * ten seznam je dnes neúplný (chybí v něm každá značka založená po jeho vzniku),
 * takže se z něj nesmí stát předloha pro mazání klientských dat. Odtud sdílená
 * funkce: bucket si volající vždy vezme z `config.storageBucket` toho klienta.
 *
 * SERVER-ONLY — importuje service-role klienta (`supabase/admin`).
 */
import supabaseAdmin from '../supabase/admin'

/**
 * Bucket, který sdílí VÍC značek naráz.
 *
 * Značka bez vlastního `storageBucket` padá v orchestrátorech na
 * `audit-screenshots` (viz `instagram/orchestrators/*`). Vyprázdnit ho kvůli
 * jednomu klientovi by smazalo soubory všech ostatních — proto ho mazací cesty
 * musí umět rozpoznat a odmítnout.
 */
export const SDILENE_BUCKETY = new Set(['audit-screenshots'])

/** Rekurzivně vypíše všechny soubory bucketu (bez placeholderů prázdných složek). */
export async function listBucketFiles(bucket: string, path = ''): Promise<string[]> {
    const vysledek: string[] = []
    const { data, error } = await supabaseAdmin.storage.from(bucket).list(path, { limit: 1000 })
    if (error) throw new Error(`list ${bucket}/${path || '.'}: ${error.message}`)
    if (!data) return vysledek

    for (const item of data) {
        if (item.name === '.emptyFolderPlaceholder') continue
        const full = path ? `${path}/${item.name}` : item.name
        // Složka se pozná po absenci `id`/metadat — API pro ni žádný jiný příznak nemá.
        const jeSlozka = !item.id || item.metadata === null || (item.metadata && Object.keys(item.metadata).length === 0)
        if (jeSlozka) vysledek.push(...await listBucketFiles(bucket, full))
        else vysledek.push(full)
    }
    return vysledek
}

/**
 * Vyprázdní bucket a vrátí počet smazaných souborů.
 *
 * `dryRun` jen spočítá — mazání storage je stejně nevratné jako DELETE, takže
 * i tady platí „nejdřív ukázat, pak provést".
 */
export async function emptyBucket(
    bucket: string,
    opts: { dryRun?: boolean; onProgress?: (hotovo: number, celkem: number) => void } = {},
): Promise<number> {
    if (SDILENE_BUCKETY.has(bucket)) {
        throw new Error(`${bucket} je sdílený bucket — jeden klient ho nesmí vyprázdnit`)
    }
    const soubory = await listBucketFiles(bucket)
    if (opts.dryRun || soubory.length === 0) return soubory.length

    // Po stovkách: `remove()` s tisíci cestami spadne na velikosti requestu.
    const DAVKA = 100
    let hotovo = 0
    for (let i = 0; i < soubory.length; i += DAVKA) {
        const chunk = soubory.slice(i, i + DAVKA)
        const { error } = await supabaseAdmin.storage.from(bucket).remove(chunk)
        if (error) throw new Error(`remove ${bucket}: ${error.message}`)
        hotovo += chunk.length
        opts.onProgress?.(hotovo, soubory.length)
    }
    return hotovo
}
