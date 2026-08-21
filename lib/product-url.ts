/**
 * Import produktu z přímého odkazu
 * ═══════════════════════════════════════════════════════════
 *
 * Katalog uměl dvě krajnosti: vyscrapovat celý web (`scrapeProductsFromWebsite`),
 * nebo produkt vyťukat ručně. Tenhle modul obsluhuje to mezi — „mám URL jednoho
 * konkrétního produktu".
 *
 * Proč to není jen zmenšený scrape webu: **detailová stránka produktu je řádově
 * spolehlivější zdroj než homepage.** Skoro každý e-shop (Shopify, WooCommerce,
 * Shoptet, PrestaShop) do ní vypisuje schema.org JSON-LD `Product` s názvem, cenou,
 * popisem i galerií. Tahle strukturovaná data se čtou přesně a zadarmo, kdežto scrape
 * homepage musí modelu nechat hádat, kde produkt začíná a končí. Model je tady proto
 * až **záchranná síť**, ne první volba — volá se jen když strukturovaná data chybí.
 *
 * Pořadí zdrojů (první, který dá jméno, vyhrává):
 *   1. JSON-LD `Product` (včetně `@graph` a polí)
 *   2. OpenGraph / microdata / meta
 *   3. `<h1>` + `<title>`
 *   4. AI nad očištěným textem stránky — jen pokud 1–3 nedaly jméno,
 *      nebo chybí popis i cena zároveň
 */

import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

/** Co se ze stránky podařilo vyčíst. `imageUrls` jsou vzdálené adresy, ještě nestažené. */
export interface ProductPageData {
    name: string | null
    type: string | null
    price: string | null
    description: string | null
    imageUrls: string[]
    /** Odkud data přišla — jde do UI, aby bylo poznat, co je odečtené a co dopočítané */
    extraction: "structured" | "mixed" | "ai"
}

/** Kolik fotek z galerie vůbec nabídnout k uložení. */
export const MAX_PRODUCT_IMAGES = 5

const FETCH_TIMEOUT_MS = 10_000
const MAX_HTML_BYTES = 3_000_000
const MAX_REDIRECTS = 5
const USER_AGENT =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

// ============================================
// URL: normalizace + ochrana proti SSRF
// ============================================

/** Doplní schéma, ořízne tracking parametry. Vrací null, když to není použitelná adresa. */
export function normalizeProductUrl(raw: string): string | null {
    const trimmed = raw.trim()
    if (!trimmed) return null
    try {
        const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`)
        if (url.protocol !== "http:" && url.protocol !== "https:") return null
        if (!url.hostname.includes(".")) return null
        // utm_* a fbclid mění adresu, ale ne produkt — bez ořezu by dedup neseděl
        for (const key of [...url.searchParams.keys()]) {
            if (key.startsWith("utm_") || key === "fbclid" || key === "gclid") url.searchParams.delete(key)
        }
        url.hash = ""
        return url.toString()
    } catch {
        return null
    }
}

function isPrivateAddress(ip: string): boolean {
    if (ip === "::1" || ip === "0.0.0.0") return true
    if (/^(fc|fd|fe80)/i.test(ip)) return true
    const parts = ip.split(".").map(Number)
    if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return false
    const [a, b] = parts
    return (
        a === 10 ||
        a === 127 ||
        a === 0 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 169 && b === 254) // link-local: metadata endpoint cloudu
    )
}

/**
 * Adresu zadává uživatel a stahuje ji server — bez téhle kontroly by šlo přes
 * import produktu sáhnout na interní síť včetně metadata endpointu.
 * Kontroluje se každý hop redirectu, ne jen zadaná adresa.
 */
export async function assertFetchableUrl(url: string): Promise<void> {
    const { hostname } = new URL(url)
    if (hostname === "localhost" || /\.(local|internal|localhost)$/i.test(hostname)) {
        throw new Error("Interní adresy nejdou načíst")
    }
    if (isIP(hostname)) {
        if (isPrivateAddress(hostname)) throw new Error("Interní adresy nejdou načíst")
        return
    }
    let addresses: { address: string }[]
    try {
        addresses = await lookup(hostname, { all: true })
    } catch {
        throw new Error("Doménu se nepodařilo přeložit")
    }
    if (addresses.some(a => isPrivateAddress(a.address))) {
        throw new Error("Interní adresy nejdou načíst")
    }
}

/** Stáhne HTML stránky. Redirecty řeší ručně, aby šel prověřit každý hop. */
export async function fetchProductPage(url: string): Promise<{ html: string; finalUrl: string }> {
    let current = url
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        await assertFetchableUrl(current)

        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
        let resp: Response
        try {
            resp = await fetch(current, {
                signal: ctrl.signal,
                redirect: "manual",
                headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
            })
        } finally {
            clearTimeout(timer)
        }

        if (resp.status >= 300 && resp.status < 400) {
            const location = resp.headers.get("location")
            if (!location) throw new Error(`HTTP ${resp.status} bez cílové adresy`)
            current = new URL(location, current).toString()
            continue
        }
        if (!resp.ok) {
            // Cloudflare a spol. vrací 403/429 na cokoli bez prohlížeče. Holé číslo
            // vypadá jako naše chyba, přitom se s tím nedá nic dělat než přidat ručně.
            if (resp.status === 403 || resp.status === 401 || resp.status === 429) {
                throw new Error("Web se brání automatickému čtení — přidej produkt ručně")
            }
            if (resp.status === 404) throw new Error("Stránka neexistuje (404) — zkontroluj odkaz")
            throw new Error(`Stránka vrátila HTTP ${resp.status}`)
        }

        const contentType = resp.headers.get("content-type") || ""
        if (contentType && !contentType.includes("html") && !contentType.includes("xml")) {
            throw new Error("Odkaz nevede na webovou stránku")
        }

        const text = await resp.text()
        return { html: text.slice(0, MAX_HTML_BYTES), finalUrl: current }
    }
    throw new Error("Příliš mnoho přesměrování")
}

// ============================================
// Parsování stránky
// ============================================

/**
 * Pojmenované entity, které v praxi chodí z českých e-shopů. Není to celá tabulka
 * HTML5 — `&aacute;` v názvu produktu je ale rozdíl mezi „Zimák" a „Zim&aacute;k"
 * v hotovém postu, takže česká diakritika a běžná interpunkce tu být musí.
 */
const NAMED_ENTITIES: Record<string, string> = {
    nbsp: " ", quot: '"', apos: "'", lt: "<", gt: ">",
    aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", yacute: "ý",
    ccaron: "č", dcaron: "ď", ecaron: "ě", ncaron: "ň", rcaron: "ř",
    scaron: "š", tcaron: "ť", zcaron: "ž", uring: "ů",
    Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Yacute: "Ý",
    Ccaron: "Č", Dcaron: "Ď", Ecaron: "Ě", Ncaron: "Ň", Rcaron: "Ř",
    Scaron: "Š", Tcaron: "Ť", Zcaron: "Ž", Uring: "Ů",
    hellip: "…", ndash: "–", mdash: "—", times: "×", middot: "·", deg: "°",
    laquo: "«", raquo: "»", bdquo: "„", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
    euro: "€", pound: "£", yen: "¥", cent: "¢", copy: "©", reg: "®", trade: "™",
}

function decodeEntities(input: string): string {
    return input
        // Číselné entity dřív než pojmenované — &#38; je „&", ne začátek další entity
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(Number(dec)))
        .replace(/&([a-z]+);/gi, (match, name: string) => {
            const exact = NAMED_ENTITIES[name]
            if (exact !== undefined) return exact
            const lower = NAMED_ENTITIES[name.toLowerCase()]
            // Neznámou entitu nech být — je čitelnější než prázdné místo
            return lower !== undefined ? lower : match
        })
        // &amp; až nakonec, jinak by se „&amp;lt;" rozpadlo na „<"
        .replace(/&amp;/gi, "&")
}

function safeCodePoint(code: number): string {
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return ""
    try {
        return String.fromCodePoint(code)
    } catch {
        return ""
    }
}

function clean(value: unknown, maxLength = 600): string | null {
    if (typeof value !== "string") return null
    const text = decodeEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
    if (!text) return null
    return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text
}

function absolutize(src: string, pageUrl: string): string | null {
    try {
        return new URL(src, pageUrl).toString()
    } catch {
        return null
    }
}

/** Vyhodí ikony, loga, trackovací pixely a datové URI — nic z toho není fotka produktu. */
function isPlausibleProductImage(url: string): boolean {
    if (!url.startsWith("http")) return false
    if (/\.(svg|ico|gif)(\?|$)/i.test(url)) return false
    return !/(sprite|placeholder|spinner|loading|avatar|emoji|widget|pixel|tracking|logo|favicon|badge|1x1|2x2|spacer)/i.test(url)
}

/**
 * Identita fotky bez rozměrů. Shopify a spol. servírují jeden snímek v deseti
 * velikostech (`?width=100`, `_300x300.png`) — bez tohohle by se galerie zaplnila
 * pěti kopiemi téhož obrázku a skutečné pohledy na produkt by vypadly.
 */
function imageIdentity(url: string): string {
    try {
        const parsed = new URL(url)
        for (const key of ["width", "height", "w", "h", "size", "quality", "q", "dpr", "v"]) {
            parsed.searchParams.delete(key)
        }
        parsed.pathname = parsed.pathname.replace(/_\d+x\d*(?=\.[a-z]+$)/i, "")
        // JSON-LD často uvádí http://, OG https:// — pro galerii je to tentýž snímek
        parsed.protocol = "https:"
        return parsed.toString()
    } catch {
        return url
    }
}

/** Šířka deklarovaná v adrese — rozhoduje, která varianta téže fotky se nechá. */
function declaredWidth(url: string): number {
    try {
        const parsed = new URL(url)
        const fromQuery = Number(parsed.searchParams.get("width") || parsed.searchParams.get("w") || 0)
        if (Number.isFinite(fromQuery) && fromQuery > 0) return fromQuery
        const fromPath = parsed.pathname.match(/_(\d+)x\d*(?=\.[a-z]+$)/i)
        return fromPath ? Number(fromPath[1]) : 0
    } catch {
        return 0
    }
}

const CURRENCY_LABEL: Record<string, string> = { CZK: "Kč", EUR: "€", USD: "$", GBP: "£", PLN: "zł" }

/** `1290.00` + `CZK` → `1 290 Kč`; katalog drží cenu jako text, ne jako číslo. */
function formatPrice(amount: unknown, currency?: unknown): string | null {
    const numeric =
        typeof amount === "number"
            ? amount
            : Number(String(amount ?? "").replace(/\s/g, "").replace(/[^\d.,-]/g, "").replace(",", "."))
    if (!Number.isFinite(numeric) || numeric <= 0) return null
    const rounded = Math.round(numeric * 100) / 100
    const body = (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2))
        .replace(/\B(?=(\d{3})+(?!\d))/g, " ")
    const code = typeof currency === "string" ? currency.toUpperCase() : ""
    const label = CURRENCY_LABEL[code] || (/^[A-Z]{3}$/.test(code) ? code : "")
    return label ? `${body} ${label}` : body
}

function jsonLdNodes(html: string): any[] {
    const nodes: any[] = []
    const blocks = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
    for (const block of blocks) {
        try {
            const parsed = JSON.parse(block[1].trim())
            const queue = Array.isArray(parsed) ? [...parsed] : [parsed]
            while (queue.length) {
                const node = queue.shift()
                if (!node || typeof node !== "object") continue
                nodes.push(node)
                if (Array.isArray(node["@graph"])) queue.push(...node["@graph"])
            }
        } catch {
            // Rozbité JSON-LD je na webu běžné; jen ho přeskoč a zkus další zdroj.
        }
    }
    return nodes
}

function isProductNode(node: any): boolean {
    const type = node?.["@type"]
    const types = Array.isArray(type) ? type : [type]
    return types.some(t => typeof t === "string" && /^(Product|ProductGroup|IndividualProduct|Service)$/i.test(t))
}

function metaContent(html: string, ...names: string[]): string | null {
    for (const name of names) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        const pattern = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]*>`, "i")
        const tag = html.match(pattern)?.[0]
        const value = tag?.match(/content=["']([^"']*)["']/i)?.[1]
        const cleaned = clean(value)
        if (cleaned) return cleaned
    }
    return null
}

function allMetaContents(html: string, name: string): string[] {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "gi")
    const out: string[] = []
    for (const tag of html.matchAll(pattern)) {
        const value = tag[0].match(/content=["']([^"']*)["']/i)?.[1]
        if (value) out.push(decodeEntities(value))
    }
    return out
}

/**
 * Odřízne z titulku jméno e-shopu: „Keramická ochrana | Autokosmetika Novák".
 *
 * Odřízne se **jen segment, který se dá ztotožnit s webem** (`og:site_name` nebo
 * doména) — ne slepě první část. Titulek totiž nese i produkty, které pomlčku mají
 * v názvu („Sada – šampon a vosk"), a ty by slepý ořez zkrátil na „Sada".
 * Na `name` z JSON-LD se tohle nepouští vůbec: to je jméno produktu, ne titulek.
 */
function stripSiteSuffix(title: string, html: string, pageUrl: string): string {
    const siteName = metaContent(html, "og:site_name")?.trim().toLowerCase()
    let host = ""
    try {
        host = new URL(pageUrl).hostname.replace(/^www\./, "").toLowerCase()
    } catch {
        // Bez adresy zbývá jen og:site_name
    }
    const hostBase = host.split(".")[0]

    const looksLikeSite = (segment: string): boolean => {
        const s = segment.trim().toLowerCase()
        if (!s) return false
        if (siteName && s === siteName) return true
        if (s === host) return true
        return hostBase.length >= 3 && s.replace(/[^a-z0-9]+/g, "").includes(hostBase)
    }

    let out = title
    // Některé šablony lepí dvě patičky: „Produkt | Kategorie | Obchod.cz"
    for (let i = 0; i < 3; i++) {
        const match = out.match(/^(.*\S)\s+[|–—·•]\s+([^|–—·•]+)$/)
        if (!match || !looksLikeSite(match[2])) break
        out = match[1]
    }
    return out.trim() || title
}

/** Text stránky bez navigace a skriptů — vstup pro AI záchrannou síť. */
export function pageToText(html: string, limit = 6000): string {
    return decodeEntities(
        html
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
            .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
            .replace(/<header[\s\S]*?<\/header>/gi, " ")
            .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, c) => `\n[NADPIS] ${c}\n`)
            .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, c) => `\n• ${c}`)
            .replace(/<[^>]+>/g, " "),
    )
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s*\n+/g, "\n")
        .trim()
        .slice(0, limit)
}

/** Přečte, co jde přečíst bez modelu. Chybějící pole nechává na null. */
export function extractStructured(html: string, pageUrl: string): ProductPageData {
    // Klíč = fotka bez rozměrů, hodnota = její největší nalezená varianta
    const images = new Map<string, string>()
    const pushImage = (candidate: unknown) => {
        if (typeof candidate !== "string" || !candidate.trim()) return
        const absolute = absolutize(decodeEntities(candidate.trim()), pageUrl)
        if (!absolute || !isPlausibleProductImage(absolute)) return
        const id = imageIdentity(absolute)
        const held = images.get(id)
        // Rozhoduje rozlišení; při shodě vyhraje https (v náhledu se http fotka nenačte).
        // Map.set na existující klíč drží původní pořadí, takže hlavní fotka zůstane první.
        const score = (candidateUrl: string) =>
            declaredWidth(candidateUrl) * 2 + (candidateUrl.startsWith("https:") ? 1 : 0)
        if (!held || score(absolute) > score(held)) images.set(id, absolute)
    }
    const pushImageField = (field: any) => {
        const list = Array.isArray(field) ? field : [field]
        for (const item of list) {
            if (typeof item === "string") pushImage(item)
            else if (item && typeof item === "object") pushImage(item.url || item.contentUrl)
        }
    }

    let name: string | null = null
    let description: string | null = null
    let price: string | null = null
    let type: string | null = null

    // 1) JSON-LD — nejspolehlivější zdroj, když ho stránka má
    for (const node of jsonLdNodes(html)) {
        if (!isProductNode(node)) continue
        name ||= clean(node.name, 200)
        description ||= clean(node.description)
        pushImageField(node.image)

        if (!type) {
            const category = Array.isArray(node.category) ? node.category[0] : node.category
            const label = clean(typeof category === "object" ? category?.name : category, 60)
            // Breadcrumb kategorie „Domů > Oblečení > Košile" — bere se list, ne celá cesta
            if (label) type = label.split(/\s*[>›|]\s*/).pop()?.trim() || label
        }

        if (!price) {
            const offers = Array.isArray(node.offers) ? node.offers : node.offers ? [node.offers] : []
            for (const offer of offers) {
                if (!offer || typeof offer !== "object") continue
                const rawSpec = offer.priceSpecification
                const spec = Array.isArray(rawSpec) ? rawSpec[0] : rawSpec
                price =
                    formatPrice(offer.price, offer.priceCurrency) ||
                    formatPrice(offer.lowPrice, offer.priceCurrency) ||
                    formatPrice(spec?.price, spec?.priceCurrency || offer.priceCurrency)
                if (price) break
            }
        }
    }

    // JSON-LD `name` je jméno produktu — od téhle chvíle už se s titulkem nepracuje
    const nameFromProductData = Boolean(name)

    // 2) OpenGraph / microdata — spolehlivé pro jméno a hlavní fotku
    name ||= metaContent(html, "og:title", "twitter:title", "product:name")
    description ||= metaContent(html, "og:description", "twitter:description", "description")
    price ||= formatPrice(
        metaContent(html, "product:price:amount", "og:price:amount"),
        metaContent(html, "product:price:currency", "og:price:currency") || "CZK",
    )
    for (const image of [
        ...allMetaContents(html, "og:image"),
        ...allMetaContents(html, "og:image:secure_url"),
        ...allMetaContents(html, "twitter:image"),
    ]) {
        pushImage(image)
    }

    // 3) Poslední čtená instance: <h1> a <title>
    if (!name) name = clean(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1], 200)
    if (!name) name = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1], 200)

    // Jen u jmen z titulku — „Košile modrá | Obchod.cz" produkt s tím jménem není
    if (name && !nameFromProductData) name = stripSiteSuffix(name, html, pageUrl)

    // Galerie z <img>: doplňkový zdroj, když strukturovaná data dala málo fotek.
    if (images.size < MAX_PRODUCT_IMAGES) {
        for (const tag of html.matchAll(/<img\b[^>]*>/gi)) {
            if (images.size >= MAX_PRODUCT_IMAGES) break
            const attrs = tag[0]
            const src = attrs.match(/\b(?:data-src|data-original|src)=["']([^"']+)["']/i)?.[1]
            const width = Number(attrs.match(/\bwidth=["']?(\d+)/i)?.[1] || 0)
            const height = Number(attrs.match(/\bheight=["']?(\d+)/i)?.[1] || 0)
            // Rozměr v atributu je jen nápověda — když chybí, kandidáta nezahazuj
            if ((width && width < 200) || (height && height < 200)) continue
            pushImage(src)
        }
    }

    return {
        name,
        type,
        price,
        description,
        imageUrls: [...images.values()].slice(0, MAX_PRODUCT_IMAGES),
        extraction: "structured",
    }
}

/** True, když se bez modelu nedobralo použitelného výsledku. */
export function needsAiFallback(data: ProductPageData): boolean {
    return !data.name || (!data.description && !data.price)
}

/** Kolik textu musí stránka mít, aby mělo smysl ptát se modelu. */
const MIN_TEXT_FOR_AI = 200

/**
 * SPA (Rohlík, part of Alzy) pošle prázdné HTML a obsah dokreslí až prohlížeč.
 * Model by z takové stránky produkt „vymyslel" — a vymyšlený produkt v katalogu
 * je horší než hláška, že to nešlo. Radši se neptáme.
 */
export function hasEnoughTextForAi(pageText: string): boolean {
    return pageText.trim().length >= MIN_TEXT_FOR_AI
}

export const PRODUCT_AI_SCHEMA = {
    type: "object",
    properties: {
        name: { type: "string" },
        type: { type: "string" },
        price: { type: "string" },
        description: { type: "string" },
    },
    required: ["name"],
}

export function buildProductPrompt(pageText: string, url: string, known: ProductPageData): string {
    const alreadyKnown = known.name
        ? `## UŽ ZNÁME\nnázev: ${known.name}${known.price ? `\ncena: ${known.price}` : ""}${known.description ? `\npopis: ${known.description}` : ""}\n\n`
        : ""

    return `Ze stránky jednoho produktu vytáhni jeho údaje. Stránka je z e-shopu nebo webu služby.

## ADRESA
${url}

## OBSAH STRÁNKY
${pageText}

${alreadyKnown}## ÚKOL
Vrať JSON s údaji o TOM JEDNOM produktu, kterému stránka patří — ne o doporučených
nebo souvisejících produktech v patičce.

- name: název produktu tak, jak ho píše prodejce (bez názvu e-shopu, bez ceny)
- type: kategorie česky (produkt, služba, balíček, kurz, menu, pokoj…)
- price: cena včetně měny tak, jak je na stránce (např. "1 290 Kč"), jinak vynech
- description: 1–2 věty česky o tom, co produkt je a pro koho — konkrétně, žádná
  marketingová vata. Když stránka popis nemá, pole vynech.

Vrať POUZE platný JSON objekt.`
}

/** Sloučí odečtená a dopočítaná data. Strukturovaná data mají přednost — jsou přesnější. */
export function mergeAiResult(structured: ProductPageData, ai: any): ProductPageData {
    return {
        name: structured.name || clean(ai?.name, 200),
        type: structured.type || clean(ai?.type, 60),
        price: structured.price || clean(ai?.price, 60),
        description: structured.description || clean(ai?.description),
        imageUrls: structured.imageUrls,
        extraction: structured.name ? "mixed" : "ai",
    }
}
