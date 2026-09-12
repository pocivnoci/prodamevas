/**
 * Jazyk značky podle UUID klienta.
 * ================================
 * Pro enginový kód, který má v ruce jen `clientId` (učicí smyčky brand memory,
 * webhooky) a config by kvůli jedinému poli načítat nemusel. Čte přímo
 * `clients.config->>'language'` a clampuje stejně jako `validateConfig()`.
 *
 * Samostatný modul schválně: `configs/index.ts` importuje caption-generator,
 * který importuje memory-agent — kdyby memory-agent sáhl do `configs/index`,
 * vznikne cyklus. Tady je jen Supabase a jazykový balíček.
 */

import supabaseAdmin from "../../supabase/admin"
import { isContentLanguage, DEFAULT_CONTENT_LANGUAGE, type ContentLanguage } from "../language"

const TTL_MS = 60_000
const cache = new Map<string, { code: ContentLanguage; expiresAt: number }>()

export async function languageForClient(clientId: string): Promise<ContentLanguage> {
    if (!clientId) throw new Error("languageForClient: chybí clientId")
    const hit = cache.get(clientId)
    if (hit && Date.now() < hit.expiresAt) return hit.code
    const { data, error } = await supabaseAdmin
        .from("clients")
        .select("config")
        .eq("id", clientId)
        .maybeSingle()
    if (error) console.warn(`⚠️ languageForClient(${clientId}): ${error.message} — beru výchozí jazyk`)
    const raw = (data?.config as { language?: unknown } | null)?.language
    const code = isContentLanguage(raw) ? raw : DEFAULT_CONTENT_LANGUAGE
    cache.set(clientId, { code, expiresAt: Date.now() + TTL_MS })
    return code
}

/** Pro testy a po změně configu. */
export function invalidateLanguageCache(clientId?: string): void {
    if (clientId) cache.delete(clientId)
    else cache.clear()
}
