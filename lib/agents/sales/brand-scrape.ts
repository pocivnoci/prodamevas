/**
 * Lehký scrape značky pro ukázku
 * ==============================
 * Onboarding prochází až 15 podstránek, protože z toho staví celou konfiguraci
 * klienta. Pro ukázku to je zbytečné: stačí titulek, popis, logo a barvy z úvodní
 * stránky. Jedno stažení místo šestnácti.
 *
 * Proč to není sdílené s onboardingem: jeho pomocníci (`fetchPage`,
 * `extractSubpageUrls`) jsou privátní v `app/onboarding/actions.ts`, což je
 * `"use server"` soubor — nejdou z něj vyexportovat bez refaktoru produkční cesty
 * registrace. Rozsah je tu navíc jiný, ne stejný kód v jiném kabátě.
 *
 * ⚠️ Když se tohle někdy bude chtít sjednotit, patří to do `lib/web-scrape.ts`
 *    a použít v obou — ne zkopírovat potřetí.
 */

const TIMEOUT_MS = 12_000
const MAX_BYTES = 1_500_000

export interface BrandBasics {
    url: string
    title: string | null
    description: string | null
    /** og:image — obvykle nejlepší dostupný vizuál značky. */
    image: string | null
    /** Nalezená loga (favicon, apple-touch-icon, og:logo). */
    logo: string | null
    /** Barvy z inline stylů, seřazené podle četnosti. */
    colors: string[]
    /** Prvních pár tisíc znaků čitelného textu — vstup pro analýzu. */
    text: string
    /** Kontaktní adresy, nejvhodnější první. Bez nich není komu napsat. */
    emails: string[]
}

function absolutize(href: string, base: string): string | null {
    try { return new URL(href, base).toString() } catch { return null }
}

function meta(html: string, ...names: string[]): string | null {
    for (const n of names) {
        const re = new RegExp(
            `<meta[^>]+(?:property|name)=["']${n}["'][^>]+content=["']([^"']+)["']`, "i")
        const m = html.match(re)
        if (m?.[1]) return m[1].trim()
        // Pořadí atributů může být opačné.
        const re2 = new RegExp(
            `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${n}["']`, "i")
        const m2 = html.match(re2)
        if (m2?.[1]) return m2[1].trim()
    }
    return null
}

/**
 * Firemní barvy cizích služeb. Sociální tlačítka a widgety je vysypou do stylů
 * skoro každého webu — a pak se vydávají za identitu značky.
 *
 * Nalezeno naostro: web květinářství vrátil jako PRIMÁRNÍ barvu `#25d366`, což je
 * zelená WhatsAppu z chatovacího tlačítka. Ukázka by pak byla laděná do barev
 * Facebooku místo do barev firmy.
 */
const FOREIGN_BRAND_COLORS = new Set([
    "#25d366", "#128c7e", "#075e54",             // WhatsApp
    "#1877f2", "#4267b2", "#3b5998",             // Facebook
    "#e4405f", "#c13584", "#833ab4", "#fd1d1d",  // Instagram
    "#1da1f2", "#14171a",                        // Twitter/X
    "#ff0000", "#282828",                        // YouTube
    "#0a66c2", "#0077b5",                        // LinkedIn
    "#4285f4", "#ea4335", "#34a853", "#fbbc05",  // Google
    "#25f4ee", "#fe2c55",                        // TikTok
    "#7360f2",                                    // Viber
])

/** Barvy z inline CSS. Neutrální odstíny se zahazují — nenesou identitu značky. */
export function extractColors(html: string, limit = 5): string[] {
    const counts = new Map<string, number>()
    for (const m of html.matchAll(/#([0-9a-fA-F]{6})\b/g)) {
        const hex = `#${m[1].toLowerCase()}`
        if (FOREIGN_BRAND_COLORS.has(hex)) continue
        const r = parseInt(hex.slice(1, 3), 16)
        const g = parseInt(hex.slice(3, 5), 16)
        const b = parseInt(hex.slice(5, 7), 16)
        const max = Math.max(r, g, b), min = Math.min(r, g, b)
        // Šedé, skoro bílé a skoro černé jsou pozadí, ne značka.
        if (max - min < 24) continue
        if (max > 245 || max < 25) continue
        counts.set(hex, (counts.get(hex) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([c]) => c)
}

/**
 * E-maily ze stránky. Tohle je ta část, která v první verzi úplně chyběla —
 * postavil jsem trychtýř, který našel firmy, na které se nedá napsat.
 *
 * Instagram kontakty spolehlivě nevydává: ověřeno na skutečných profilech, kde
 * `public_email`, `contact_phone_number` i `external_url` byly prázdné i u účtů
 * označených jako firemní. Web adresu naopak uvádí skoro vždycky, protože ji tam
 * firma dává schválně.
 *
 * Vrací se v pořadí podle vhodnosti: `info@` a spol. dřív než cokoli osobního.
 */
const OBFUSCATED = /\s*(?:\[at\]|\(at\)|\{at\}|\s+at\s+)\s*/gi

export function extractEmails(html: string, domain?: string): string[] {
    // Zamaskované zápisy („info (at) firma.cz") se nejdřív narovnají.
    const text = html.replace(OBFUSCATED, "@")
    const found = new Set<string>()

    // Escapované znaky v JSON/JS blocích ("info@x.cz\") by jinak zůstaly v adrese.
    const clean = (e: string) => e.trim().toLowerCase().replace(/[\\"'<>,;:.)\]}]+$/, "")

    for (const m of text.matchAll(/mailto:([^"'?>\s]+)/gi)) {
        const e = clean(decodeURIComponent(m[1]))
        if (e.includes("@")) found.add(e)
    }
    for (const m of text.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
        found.add(clean(m[0]))
    }

    const ROLE = ["info", "kontakt", "obchod", "office", "podpora", "hello", "ahoj",
        "objednavky", "prodej", "rezervace", "recepce", "studio", "shop", "eshop"]
    // Adresy šablon, knihoven a sledovačů — nejsou to kontakty na firmu.
    // České zástupné texty z formulářů („tvuj@email.cz") sem patří taky: vypadají
    // jako platná adresa, ale poslat na ně znamená bounce, a ten kazí reputaci.
    // Pozor na doménu: `email.cz` je SKUTEČNÝ český poskytovatel, ne zástupný text.
    // Zástupnost pozná místní část („tvuj@", „vase@"), ne doména.
    const NOISE = new RegExp([
        "sentry", "wixpress", "godaddy", "@2x", "\\.png", "\\.jpg", "\\.webp", "\\.svg",
        "wordpress", "placeholder",
        "^(tvuj|tvoje|vas|vase|jmeno|prijmeni|neco|nekdo|adresa|nazev)@",
        "@(example|priklad|yourdomain|domain|vasedomena)\\.",
    ].join("|"), "i")

    return [...found]
        .filter(e => !NOISE.test(e) && e.split("@")[1]?.includes("."))
        .sort((a, b) => {
            // 1) adresa na vlastní doméně firmy, 2) role adresa, 3) zbytek
            const own = (e: string) => (domain && e.endsWith(`@${domain}`) ? 0 : 1)
            const role = (e: string) => (ROLE.includes(e.split("@")[0].split(/[.\-_+]/)[0]) ? 0 : 1)
            return own(a) - own(b) || role(a) - role(b) || a.localeCompare(b)
        })
        .slice(0, 5)
}

/** Podstránky, kde firmy kontakt obvykle mají. Zkouší se, až když ho úvodní nemá. */
export const CONTACT_PATHS = ["/kontakt", "/kontakty", "/contact", "/o-nas", "/napiste-nam"]

/** Čitelný text bez skriptů, stylů a značek. */
export function extractText(html: string, maxChars = 4000): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxChars)
}

/**
 * Stáhne úvodní stránku a vytáhne základ značky.
 * Vrací `null`, když web nejde načíst — lead se pak nekvalifikuje, protože bez
 * webu není z čeho udělat ukázku.
 */
async function fetchHtml(url: string): Promise<string | null> {
    try {
        const res = await fetch(url, {
            headers: {
                // Pravdivá identifikace robota — ne maskování za prohlížeč.
                "user-agent": "ChrlitPreviewBot/1.0 (+https://chrlit.cz)",
                "accept": "text/html,application/xhtml+xml",
            },
            signal: AbortSignal.timeout(TIMEOUT_MS),
            redirect: "follow",
        })
        if (!res.ok) {
            console.warn(`⚠️ brand-scrape ${res.status} pro ${url}`)
            return null
        }
        const buf = await res.arrayBuffer()
        return new TextDecoder("utf-8").decode(buf.slice(0, MAX_BYTES))
    } catch (err: any) {
        console.warn(`⚠️ brand-scrape selhal pro ${url}: ${err?.message}`)
        return null
    }
}

export async function scrapeBrandBasics(rawUrl: string): Promise<BrandBasics | null> {
    const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`
    const html = await fetchHtml(url)
    if (!html) return null
    const domain = (() => { try { return new URL(url).hostname.replace(/^www\./, "") } catch { return undefined } })()

    // Kontakt nejdřív z úvodní stránky; když tam není, zkusí se /kontakt a spol.
    // Až TŘI stažení na firmu — víc ne, tohle je kvalifikace, ne crawler.
    let emails = extractEmails(html, domain)
    if (emails.length === 0) {
        for (const path of CONTACT_PATHS.slice(0, 2)) {
            const sub = await fetchHtml(new URL(path, url).toString())
            if (!sub) continue
            emails = extractEmails(sub, domain)
            if (emails.length) break
        }
    }

    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? null
    const iconHref =
        html.match(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i)?.[1] ??
        html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i)?.[1] ??
        null

    return {
        url,
        title: meta(html, "og:title") ?? titleTag,
        description: meta(html, "og:description", "description"),
        image: (() => { const i = meta(html, "og:image"); return i ? absolutize(i, url) : null })(),
        logo: iconHref ? absolutize(iconHref, url) : null,
        colors: extractColors(html),
        text: extractText(html),
        emails,
    }
}
