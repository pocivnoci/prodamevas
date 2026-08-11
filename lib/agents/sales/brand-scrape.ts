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

/** Barvy z inline CSS. Neutrální odstíny se zahazují — nenesou identitu značky. */
export function extractColors(html: string, limit = 5): string[] {
    const counts = new Map<string, number>()
    for (const m of html.matchAll(/#([0-9a-fA-F]{6})\b/g)) {
        const hex = `#${m[1].toLowerCase()}`
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
export async function scrapeBrandBasics(rawUrl: string): Promise<BrandBasics | null> {
    const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`
    let html: string
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
        html = new TextDecoder("utf-8").decode(buf.slice(0, MAX_BYTES))
    } catch (err: any) {
        console.warn(`⚠️ brand-scrape selhal pro ${url}: ${err?.message}`)
        return null
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
    }
}
