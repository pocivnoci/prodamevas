/**
 * Sken celého webu → katalog produktů (jádro bez session)
 * ═══════════════════════════════════════════════════════════
 *
 * Třetí čtečka produktů vedle `lib/product-url.ts` (jeden odkaz → jeden produkt,
 * strukturovaná data) a ručního formuláře. Tahle projde web sama: homepage +
 * podstránky, z textu vytáhne modelem VŠECHNY produkty/služby včetně odkazu na
 * fotku a rovnou je uloží do `ig_products`.
 *
 * Proč vlastní modul a ne tělo server action: onboarding tenhle sken potřebuje
 * spustit z durable workera (`lib/agents/handlers.ts`), který se nesmí dotknout
 * auth vrstvy. Dokud logika žila v `app/actions/product-actions.ts` za
 * `requireProjectAccess()`, uměl ji vyvolat jen člověk klikem v Katalogu — a
 * onboarding musel vystačit s deseti produkty bez fotek z brand analýzy.
 * Stejné dělení jako `lib/product-import.ts` a `instagram/metrics-sync.ts`.
 *
 * **Multi-tenancy:** `clientId` je povinný parametr, ne něco, co si modul někde
 * vyzvedne. Každý dotaz i zápis jím filtruje.
 */

import supabaseAdmin from "@/supabase/admin"
import { productSlugFrom, freeSlug, storeProductImage } from "@/lib/product-import"

/** Strop na jeden sken. Víc než třicet položek už není katalog, ale výpis e-shopu. */
const MAX_PRODUCTS = 30
/** Kolik podstránek se čte navíc k homepage. */
const MAX_SUBPAGES = 10
/** Cizí weby jsou pomalé; pár souběžných requestů drží sken v minutách, ne v desítkách minut. */
const FETCH_CONCURRENCY = 4

export interface ScrapedProduct {
    name: string
    type?: string
    slug: string
    price?: string
    description?: string
    imageUrl?: string
}

export interface ScrapeResult {
    success: boolean
    /** Kolik produktů model na webu našel (včetně těch, co už v katalogu jsou) */
    found: number
    /** Kolik nových řádků přibylo */
    inserted: number
    /** Kolik fotek se stáhlo (u nových i u starých produktů, které fotku neměly) */
    images: number
    error?: string
}

type Progress = (percent: number, message: string) => void | Promise<void>

/** Odpal `fn` nad položkami, ale nejvýš `limit` naráz. Pořadí výsledků odpovídá vstupu. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const out = new Array<R>(items.length)
    let next = 0
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        for (let i = next++; i < items.length; i = next++) {
            out[i] = await fn(items[i])
        }
    })
    await Promise.all(workers)
    return out
}

async function fetchWithTimeout(url: string, ms = 8000): Promise<string> {
    const { assertFetchableUrl } = await import("@/lib/product-url")
    // Adresa webu jde z konfigurace, kterou plní uživatel — stejná třída rizika
    // jako import z odkazu, takže stejná pojistka proti sáhnutí na interní síť.
    await assertFetchableUrl(url)
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), ms)
    try {
        const r = await fetch(url, {
            signal: ctrl.signal,
            headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
        })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return await r.text()
    } finally { clearTimeout(t) }
}

/**
 * Text stránky pro model. `<img>` se nezahazují, ale zůstávají jako `[IMG: url]` —
 * jinak by nebylo z čeho fotku produktu přiřadit.
 */
function stripHtml(html: string, pageBaseUrl: string): string {
    return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
        .replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gi, (_, lvl, c) => `\n[H${lvl}] ${c.replace(/<[^>]+>/g, "").trim()}\n`)
        .replace(/<img[^>]+(?:src|data-src)="([^"]+)"[^>]*>/gi, (_, src) => {
            // Skip tiny icons, trackers, SVGs
            if (src.endsWith('.svg') || src.endsWith('.ico') || src.includes('data:image')
                || src.includes('pixel') || src.includes('tracking') || src.includes('placeholder')
                || src.includes('spinner') || src.includes('loading') || src.includes('avatar')
                || src.includes('emoji') || src.includes('widget') || /\b(1x1|2x2|spacer)\b/i.test(src)) return ""
            let url = src
            if (url.startsWith("//")) url = `https:${url}`
            else if (url.startsWith("/")) url = `${pageBaseUrl}${url}`
            return ` [IMG: ${url}] `
        })
        .replace(/<li[^>]*>(.*?)<\/li>/gi, (_, c) => `• ${c.replace(/<[^>]+>/g, "").trim()}\n`)
        .replace(/(\d[\d\s]*(?:Kč|CZK|,-|€|\$))/gi, " [CENA: $1] ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/\s+/g, " ")
        .trim()
}

/** Podstránky z `<a href>` homepage, produktové a ceníkové napřed. */
function discoverSubpages(homepageHtml: string, origin: string): string[] {
    const subUrls = new Set<string>()
    const linkRegex = /href="([^"]+)"/gi
    let m: RegExpExecArray | null
    while ((m = linkRegex.exec(homepageHtml)) !== null) {
        const href = m[1]
        if (href.startsWith("/") && !href.startsWith("//") && href.length > 1
            && !href.match(/\.(js|css|png|jpg|svg|ico|webp|gif|pdf|xml|json)/i) && !href.includes("#")) {
            subUrls.add(`${origin}${href}`)
        }
    }
    const priority = /produk|sluzb|služb|cenik|ceník|nabid|shop|store|menu|katalog|balic|balíč|price|offer|obchod/i
    return Array.from(subUrls)
        .sort((a, b) => (priority.test(a) ? 0 : 1) - (priority.test(b) ? 0 : 1))
        .slice(0, MAX_SUBPAGES)
}

const PRODUCT_SCHEMA = {
    type: "object",
    properties: {
        products: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    name: { type: "string" },
                    type: { type: "string" },
                    slug: { type: "string" },
                    price: { type: "string" },
                    description: { type: "string" },
                    imageUrl: { type: "string" },
                },
                required: ["name", "type", "slug"],
            },
        },
    },
    required: ["products"],
}

/** Přečte web a vrátí, co na něm model našel. **Neukládá** — zápis je `saveScrapedProducts`. */
export async function readProductsFromWebsite(website: string, onProgress?: Progress): Promise<ScrapedProduct[]> {
    const baseUrl = website.startsWith("http") ? website : `https://${website}`
    const origin = new URL(baseUrl).origin

    await onProgress?.(15, "Čtu web…")
    console.log(`🔍 Scraping products from ${baseUrl}...`)
    const homepageHtml = await fetchWithTimeout(baseUrl)
    const homepageText = stripHtml(homepageHtml, origin).substring(0, 6000)

    const sortedSubs = discoverSubpages(homepageHtml, origin)
    await onProgress?.(30, `Procházím podstránky (${sortedSubs.length})…`)
    const subTexts = (await mapLimit(sortedSubs, FETCH_CONCURRENCY, async (url) => {
        try {
            const html = await fetchWithTimeout(url)
            return `### ${url}\n${stripHtml(html, origin).substring(0, 2000)}`
        } catch { return "" }
    })).filter(Boolean)

    const prompt = `Analyzuj obsah tohoto webu a extrahuj VŠECHNY produkty, služby, balíčky, nabídky a cenové položky.

Obsah obsahuje značky [IMG: url] označující obrázky nalezené na stránce.

## HOMEPAGE
${homepageText}

## PODSTRÁNKY (${sortedSubs.length})
${subTexts.join("\n\n")}

## ÚKOL
Extrahuj pole produktů/služeb. Pro KAŽDÝ nalezený produkt/službu vrať:
- name: název produktu/služby (česky)
- type: kategorie (produkt, služba, balíček, menu, pokoj, kurz, atd.)
- slug: URL-friendly verze názvu (lowercase, bez diakritiky, pomlčky místo mezer)
- price: cena pokud nalezena (např. "990 Kč", "od 1500 Kč/hod") nebo null
- description: stručný popis (1-2 věty) nebo null
- imageUrl: URL obrázku produktu z nejbližší [IMG: url] značky, nebo null

PRAVIDLA:
- Maximálně ${MAX_PRODUCTS} položek
- Zahrň i služby, balíčky, kategorie menu, typy pokojů atd.
- Nezahrnuj navigační položky, stránky, nebo interní odkazy
- Slug: bez diakritiky, lowercase, max 40 znaků
- imageUrl: vyber obrázek který nejlépe odpovídá danému produktu (nejbližší [IMG:] tag). Pokud žádný vhodný není, nastav null
- Pokud na webu žádné produkty/služby nejsou, vrať prázdné pole

Vrať POUZE platný JSON pole objektů.`

    await onProgress?.(50, "Vybírám z webu produkty…")
    const { generateText } = await import("@/instagram/gemini-client")
    const { getModel } = await import("@/instagram/models")
    const raw = await generateText(prompt, { model: getModel("text"), responseSchema: PRODUCT_SCHEMA })

    let products: any[] = []
    // Parse — handle both {products: [...]} and bare [...]
    const jsonObjMatch = raw.match(/\{[\s\S]*\}/)
    const jsonArrMatch = raw.match(/\[[\s\S]*\]/)
    if (jsonObjMatch) {
        const parsed = JSON.parse(jsonObjMatch[0])
        products = parsed.products || parsed
    } else if (jsonArrMatch) {
        products = JSON.parse(jsonArrMatch[0])
    }
    if (!Array.isArray(products)) products = []

    return products
        .filter((p: any) => p && typeof p.name === "string" && p.name.trim())
        .slice(0, MAX_PRODUCTS)
        .map((p: any) => ({
            name: String(p.name).trim(),
            type: p.type ? String(p.type) : undefined,
            // Slug od modelu občas přijde s diakritikou nebo mezerou — vlastní normalizace
            // je jistota, že v katalogu nevznikne adresa, která se nedá použít.
            slug: productSlugFrom(String(p.slug || p.name)),
            price: p.price ? String(p.price) : undefined,
            description: p.description ? String(p.description) : undefined,
            imageUrl: typeof p.imageUrl === "string" && p.imageUrl.startsWith("http") ? p.imageUrl : undefined,
        }))
        .filter((p: ScrapedProduct) => Boolean(p.slug))
}

/** Řádek katalogu, jak ho plánovač potřebuje vidět. */
export interface CatalogRow {
    id: string
    slug: string
    name: string
    image_urls?: string[] | null
}

export interface CatalogPlan {
    /** Co se má vložit — slug je už uvolněný proti katalogu i proti dávce */
    inserts: { slug: string; product: ScrapedProduct }[]
    /** Existující řádky bez fotky, ke kterým sken fotku našel */
    backfills: { productId: string; slug: string; imageUrl: string }[]
}

/**
 * Rozhodne, co je nový produkt a co dvojče — čistá funkce, ať se to dá ohlídat asercí.
 *
 * **Totožnost je název, adresa je slug.** Dvojče se hledá přes normalizovaný název:
 * onboarding zapíše do katalogu produkty z brand analýzy s vlastními slugy, takže
 * „Svatební kytice" tam už může ležet jako `svatebni-kytice-premium`. Kdyby se
 * porovnávaly slugy, sken by ten samý produkt založil podruhé — místo aby mu dodal
 * fotku, která mu jediná chybí.
 *
 * Opačným směrem to platí taky: slug se ořezává na 40 znaků, takže dva dlouhé různé
 * názvy skončí na jednom slugu. Shoda slugu proto sama o sobě dvojče neznamená —
 * kolize se řeší volným slugem (`freeSlug`), ne zahozením produktu.
 */
export function planCatalogWrite(existing: CatalogRow[], products: ScrapedProduct[]): CatalogPlan {
    const takenSlugs = new Set<string>(existing.map(p => p.slug))
    const byKey = new Map<string, CatalogRow>()
    for (const row of existing) {
        const nameKey = productSlugFrom(row.name || "")
        // Slug je náhradní klíč jen pro řádek bez použitelného názvu (emoji, prázdno).
        if (nameKey) byKey.set(nameKey, row)
        else byKey.set(row.slug, row)
    }

    const inserts: CatalogPlan["inserts"] = []
    const backfills: CatalogPlan["backfills"] = []
    const seenInBatch = new Set<string>()

    for (const p of products) {
        const nameKey = productSlugFrom(p.name)
        const match = (nameKey ? byKey.get(nameKey) : undefined) || byKey.get(p.slug)
        if (match) {
            // Fotku doplň jen tomu, kdo žádnou nemá — ruční fotka od klienta je víc než ta z webu.
            if (p.imageUrl && !(match.image_urls?.length)) {
                backfills.push({ productId: match.id, slug: match.slug, imageUrl: p.imageUrl })
            }
            continue
        }
        // Totožnost je NÁZEV, ne slug: model umí vrátit tentýž produkt dvakrát (z homepage
        // i z podstránky), a naopak dvěma různým produktům přiřknout jeden slug. Podle
        // názvu se první případ složí do jednoho řádku, druhý dostane volný slug níž.
        const batchKey = nameKey || p.slug
        if (seenInBatch.has(batchKey)) continue
        seenInBatch.add(batchKey)

        const slug = freeSlug(p.slug, takenSlugs)
        takenSlugs.add(slug)
        inserts.push({ slug, product: p })
    }

    return { inserts, backfills }
}

/** Uloží, co sken našel: nové produkty vloží, u starých bez fotky fotku doplní. */
export async function saveScrapedProducts(
    clientId: string,
    products: ScrapedProduct[],
    onProgress?: Progress,
): Promise<ScrapeResult> {
    if (products.length === 0) return { success: true, found: 0, inserted: 0, images: 0 }

    const { data: existing } = await supabaseAdmin
        .from("ig_products")
        .select("id, slug, name, image_urls")
        .eq("client_id", clientId)

    const plan = planCatalogWrite((existing || []) as CatalogRow[], products)

    let insertedRows: { id: string; slug: string }[] = []
    if (plan.inserts.length > 0) {
        const { data, error: insertError } = await supabaseAdmin
            .from("ig_products")
            .insert(plan.inserts.map(({ slug, product }) => ({
                client_id: clientId,
                name: product.name,
                type: product.type || "product",
                slug,
                price: product.price || null,
                description: product.description || null,
                image_urls: [],
            })))
            .select("id, slug")
        if (insertError) throw insertError
        insertedRows = (data || []) as { id: string; slug: string }[]
    }

    /** Co se má stáhnout: nový řádek s fotkou, i starý řádek, kterému fotka chybí. */
    const needsImage = [...plan.backfills]
    const insertedBySlug = new Map(insertedRows.map(r => [r.slug, r.id]))
    for (const { slug, product } of plan.inserts) {
        const id = insertedBySlug.get(slug)
        if (id && product.imageUrl) needsImage.push({ productId: id, slug, imageUrl: product.imageUrl })
    }

    let images = 0
    if (needsImage.length > 0) {
        await onProgress?.(75, `Stahuju fotky (${needsImage.length})…`)
        console.log(`📷 Downloading images for ${needsImage.length} products...`)
        await mapLimit(needsImage, FETCH_CONCURRENCY, async ({ productId, slug, imageUrl }) => {
            try {
                const stored = await storeProductImage(clientId, slug, 0, imageUrl)
                if (!stored) return
                await supabaseAdmin
                    .from("ig_products")
                    .update({ image_urls: [stored], updated_at: new Date().toISOString() })
                    .eq("id", productId)
                    .eq("client_id", clientId)
                images++
            } catch {
                // Fotka je bonus, ne podmínka — produkt zůstává uložený i bez ní
            }
        })
    }

    return { success: true, found: products.length, inserted: insertedRows.length, images }
}

/**
 * Celý sken: přečti web → ulož do katalogu. Bezpečné pouštět opakovaně (dedup),
 * takže ho může spustit onboarding i tlačítko „Načíst z webu" nad stejným klientem.
 */
export async function scrapeProductsIntoCatalog(
    clientId: string,
    website: string,
    onProgress?: Progress,
): Promise<ScrapeResult> {
    try {
        const products = await readProductsFromWebsite(website, onProgress)
        if (products.length === 0) return { success: true, found: 0, inserted: 0, images: 0 }
        const result = await saveScrapedProducts(clientId, products, onProgress)
        console.log(`✅ ${result.inserted} products + ${result.images} images scraped for client ${clientId}`)
        return result
    } catch (err: any) {
        console.error("scrapeProductsIntoCatalog error:", err?.message || err)
        return { success: false, found: 0, inserted: 0, images: 0, error: err?.message || String(err) }
    }
}
