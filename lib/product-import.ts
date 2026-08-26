/**
 * Import produktu z odkazu — jádro bez session
 * ═══════════════════════════════════════════════════════════
 *
 * Čtení stránky žije v `lib/product-url.ts`; tady je vrstva nad ním, která už
 * sahá na katalog: dedup proti tomu, co klient má, a zápis včetně stažení fotek.
 *
 * Proč to není rovnou v server action: action musí ověřit přihlášení, a tím se
 * celá logika stává nespustitelnou odjinud než z prohlížeče — tedy i neověřitelnou.
 * Stejné dělení jako u `instagram/metrics-sync.ts`. Server action nad tím dělá
 * jen `requireProjectAccess` a předá `clientId`.
 *
 * **Multi-tenancy:** `clientId` je povinný parametr, ne něco, co si tenhle modul
 * někde vyzvedne. Každý dotaz i zápis jím filtruje.
 */

import supabaseAdmin from "@/supabase/admin"
import {
    normalizeProductUrl,
    fetchProductPage,
    extractStructured,
    needsAiFallback,
    hasEnoughTextForAi,
    pageToText,
    buildProductPrompt,
    mergeAiResult,
    PRODUCT_AI_SCHEMA,
    MAX_PRODUCT_IMAGES,
} from "@/lib/product-url"

/** Jeden řádek náhledu importu. Pole jsou editovatelná v UI, server je při ukládání znovu validuje. */
export interface ProductUrlDraft {
    /** Normalizovaná adresa (bez utm_*), pod kterou se produkt uloží */
    url: string
    ok: boolean
    error?: string
    /** Název existujícího produktu, kterému by import udělal dvojče */
    duplicateOf?: string
    name: string
    type: string
    slug: string
    price: string
    description: string
    imageUrls: string[]
    /** "structured" = odečteno z JSON-LD/microdat/OG, "ai" = dopočítal model, "mixed" = obojí */
    extraction: "structured" | "mixed" | "ai"
}

/** Strop na jedno vložení. Deset odkazů je ~10 fetchů — pod limitem funkce i s AI fallbackem. */
export const MAX_IMPORT_URLS = 10
/** Cizí weby jsou pomalé; tři souběžně drží celou dávku pod ~15 s bez toho, aby to vypadalo jako útok. */
const IMPORT_CONCURRENCY = 3

const EMPTY_DRAFT_FIELDS = { name: "", type: "", slug: "", price: "", description: "", imageUrls: [] as string[] }

export function productSlugFrom(name: string): string {
    return name
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40)
        .replace(/-+$/, "")
}

export function freeSlug(base: string, taken: Set<string>): string {
    const seed = base || "produkt"
    if (!taken.has(seed)) return seed
    let n = 2
    while (taken.has(`${seed}-${n}`)) n++
    return `${seed}-${n}`
}

/** Rozdělí nalepený text na adresy. URL nesmí obsahovat mezeru, takže dělení po bílých znacích stačí. */
export function splitUrlInput(raw: string): string[] {
    return raw.split(/\s+/).filter(Boolean)
}

// ============================================
// Fáze 1 — čtení stránek (nic se neukládá)
// ============================================

/** Načte jeden odkaz. Model se volá jen jako záchranná síť — viz `lib/product-url.ts`. */
async function readOne(url: string, knownBySlug: Map<string, string>, knownByUrl: Map<string, string>): Promise<ProductUrlDraft> {
    try {
        const { html, finalUrl } = await fetchProductPage(url)
        let data = extractStructured(html, finalUrl)

        const pageText = pageToText(html)
        // SPA pošle prázdnou slupku; model by z ní produkt vymyslel, tak se neptáme
        const emptyShell = !hasEnoughTextForAi(pageText)

        if (needsAiFallback(data) && !emptyShell) {
            try {
                const { generateText } = await import("@/instagram/gemini-client")
                const { getModel } = await import("@/instagram/models")
                const raw = await generateText(buildProductPrompt(pageText, finalUrl, data), {
                    model: getModel("text"),
                    responseSchema: PRODUCT_AI_SCHEMA,
                })
                data = mergeAiResult(data, JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}"))
            } catch (aiErr: any) {
                // Model je záchranná síť, ne podmínka. Co dala strukturovaná data, pořád platí.
                console.warn(`   ⚠️ AI fallback selhal pro ${url}: ${aiErr?.message || aiErr}`)
            }
        }

        // Bez značky produktu a bez potvrzení od modelu je „název" jen titulek webu.
        // Takový produkt v katalogu vypadá věrohodně, a přesně proto je horší než chyba.
        if (!data.name || !data.isProductPage) {
            return {
                url,
                ok: false,
                error: emptyShell
                    ? "Stránka se skládá až v prohlížeči — přidej produkt ručně"
                    : data.name
                        ? "Odkaz nevede na detail produktu (spíš rozcestník nebo výpis)"
                        : "Na stránce jsem nenašel produkt",
                ...EMPTY_DRAFT_FIELDS,
                extraction: data.extraction,
            }
        }

        const slug = productSlugFrom(data.name)
        return {
            url,
            ok: true,
            duplicateOf: knownByUrl.get(url) || knownBySlug.get(slug) || undefined,
            name: data.name,
            type: data.type || "produkt",
            slug,
            price: data.price || "",
            description: data.description || "",
            imageUrls: data.imageUrls,
            extraction: data.extraction,
        }
    } catch (err: any) {
        return { url, ok: false, error: err?.message || String(err), ...EMPTY_DRAFT_FIELDS, extraction: "structured" }
    }
}

/**
 * Přečte produkty z vložených odkazů a vrátí je k potvrzení. **Neukládá.**
 *
 * Jeden rozbitý odkaz nezhodí celou dávku: chyba se vrátí u svého řádku a ostatní doběhnou.
 */
/**
 * Účtuje se celá dávka, ne jednotlivé odkazy: model tu je jen fallback pro stránky
 * bez strukturovaných dat, takže z deseti URL ho může potřebovat jedna i všechny.
 * Jeden řádek za dávku říká pravdu o tom, co uživatel spustil.
 */
export async function readProductDrafts(
    clientId: string,
    rawUrls: string[],
): Promise<{ success: boolean; drafts?: ProductUrlDraft[]; error?: string }> {
    const { trackSpend } = await import("@/instagram/spend-tracker")
    return trackSpend(
        "product_import",
        { clientId, refId: `${rawUrls.length} odkazů` },
        () => readProductDraftsInner(clientId, rawUrls),
    )
}

async function readProductDraftsInner(
    clientId: string,
    rawUrls: string[],
): Promise<{ success: boolean; drafts?: ProductUrlDraft[]; error?: string }> {
    // Normalizuj + zahoď duplicity v samotném vstupu (nalepený seznam je má často)
    const seen = new Set<string>()
    const urls: string[] = []
    const invalid: ProductUrlDraft[] = []

    for (const raw of rawUrls) {
        if (!raw.trim()) continue
        const normalized = normalizeProductUrl(raw)
        if (!normalized) {
            invalid.push({
                url: raw.trim().slice(0, 200),
                ok: false,
                error: "Tohle nevypadá jako odkaz",
                ...EMPTY_DRAFT_FIELDS,
                extraction: "structured",
            })
            continue
        }
        if (seen.has(normalized)) continue
        seen.add(normalized)
        urls.push(normalized)
    }

    if (urls.length === 0 && invalid.length === 0) return { success: false, error: "Vlož aspoň jeden odkaz" }
    if (urls.length > MAX_IMPORT_URLS) {
        return { success: false, error: `Najednou zvládnu ${MAX_IMPORT_URLS} odkazů, vložils ${urls.length}` }
    }

    // Katalog klienta — kvůli značce „tohle už máš"
    const { data: existing } = await supabaseAdmin
        .from("ig_products")
        .select("name, slug, source_url")
        .eq("client_id", clientId)

    const bySlug = new Map<string, string>((existing || []).map((p: any) => [p.slug, p.name]))
    const byUrl = new Map<string, string>(
        (existing || []).filter((p: any) => p.source_url).map((p: any) => [p.source_url, p.name]),
    )

    // Malý worker pool — pořadí výsledků drží pořadí vstupu, aby náhled seděl na to, co uživatel nalepil
    const results: ProductUrlDraft[] = new Array(urls.length)
    let cursor = 0
    await Promise.all(
        Array.from({ length: Math.min(IMPORT_CONCURRENCY, urls.length) }, async () => {
            while (cursor < urls.length) {
                const index = cursor++
                results[index] = await readOne(urls[index], bySlug, byUrl)
            }
        }),
    )

    return { success: true, drafts: [...results, ...invalid] }
}

// ============================================
// Fáze 2 — zápis potvrzených produktů
// ============================================

export type SavableDraft = Pick<ProductUrlDraft, "url" | "name" | "type" | "slug" | "price" | "description" | "imageUrls">

/** Stáhne a uloží fotku do bucketu. `null` = fotka nepoužitelná, produkt tím nepadá. */
async function storeImage(clientId: string, slug: string, index: number, imageUrl: string): Promise<string | null> {
    const { assertFetchableUrl } = await import("@/lib/product-url")
    // Seznam fotek se vrací z prohlížeče — adresu je nutné prověřit znovu
    await assertFetchableUrl(imageUrl)

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    let resp: Response
    try {
        resp = await fetch(imageUrl, {
            signal: ctrl.signal,
            headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
        })
    } finally {
        clearTimeout(timer)
    }
    if (!resp.ok) return null

    const contentType = resp.headers.get("content-type") || "image/jpeg"
    if (!contentType.startsWith("image/")) return null

    const buffer = Buffer.from(await resp.arrayBuffer())
    if (buffer.length < 5000 || buffer.length > 10_000_000) return null

    // Rozměr rozhoduje, ne jméno souboru — ikony a odznaky sem nepatří
    const sharp = (await import("sharp")).default
    try {
        const meta = await sharp(buffer).metadata()
        if ((meta.width || 0) < 200 || (meta.height || 0) < 200) return null
    } catch {
        return null
    }

    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg"
    const filename = `${clientId}/${slug}-${index}.${ext}`

    const { error } = await supabaseAdmin.storage
        .from("product-images")
        .upload(filename, buffer, { contentType, cacheControl: "31536000", upsert: true })
    if (error) return null

    return supabaseAdmin.storage.from("product-images").getPublicUrl(filename).data.publicUrl
}

/**
 * Uloží produkty potvrzené v náhledu — včetně stažení fotek do `product-images`.
 *
 * Fotky se stahují až tady, ne při náhledu: u zahozeného importu by šlo o úložiště za nic.
 */
export async function importProductDrafts(
    clientId: string,
    drafts: SavableDraft[],
): Promise<{ success: boolean; inserted: number; skipped: number; images: number; error?: string }> {
    const usable = drafts.filter(d => d.name?.trim())
    if (usable.length === 0) return { success: false, inserted: 0, skipped: 0, images: 0, error: "Není co uložit" }

    // Náhled mohl mezitím zestárnout — dedup i unikátnost slugu se řeší proti čerstvému katalogu
    const { data: existing } = await supabaseAdmin
        .from("ig_products")
        .select("slug, source_url")
        .eq("client_id", clientId)

    const takenSlugs = new Set<string>((existing || []).map((p: any) => p.slug))
    const takenUrls = new Set<string>((existing || []).filter((p: any) => p.source_url).map((p: any) => p.source_url))

    let inserted = 0
    let skipped = 0
    let images = 0

    for (const draft of usable) {
        if (draft.url && takenUrls.has(draft.url)) { skipped++; continue }

        const slug = freeSlug(productSlugFrom(draft.slug || draft.name), takenSlugs)
        takenSlugs.add(slug)
        if (draft.url) takenUrls.add(draft.url)

        const { data: row, error: insertError } = await supabaseAdmin
            .from("ig_products")
            .insert({
                client_id: clientId,
                name: draft.name.trim(),
                type: draft.type?.trim() || "produkt",
                slug,
                price: draft.price?.trim() || null,
                description: draft.description?.trim() || null,
                source_url: draft.url || null,
                image_urls: [],
            })
            .select("id")
            .single()

        if (insertError || !row) {
            console.warn(`   ⚠️ Produkt ${slug} se nepodařilo uložit: ${insertError?.message}`)
            skipped++
            continue
        }
        inserted++

        const storedUrls: string[] = []
        for (const [index, imageUrl] of (draft.imageUrls || []).slice(0, MAX_PRODUCT_IMAGES).entries()) {
            try {
                const stored = await storeImage(clientId, slug, index, imageUrl)
                if (stored) { storedUrls.push(stored); images++ }
            } catch {
                // Fotka je bonus, ne podmínka — produkt zůstává uložený i bez ní
            }
        }

        if (storedUrls.length > 0) {
            await supabaseAdmin
                .from("ig_products")
                .update({ image_urls: storedUrls, updated_at: new Date().toISOString() })
                .eq("id", row.id)
                .eq("client_id", clientId)
        }
    }

    return { success: true, inserted, skipped, images }
}
