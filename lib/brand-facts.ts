/**
 * Fakta ze zdroje, ne z hlavy modelu.
 * ===================================
 * Faktická brána (instagram/fact-check.ts) povoluje konkrétní tvrzení jen tehdy, když
 * stojí v `config.brandFacts`. Prázdný seznam je proto bezpečný, ale hloupý: engine
 * pak nesmí napsat ani to, co má značka černé na bílém na vlastním webu, a posty
 * zbytečně zvágní.
 *
 * Tenhle modul je most mezi webem a tím seznamem. Zásadní pravidlo: **fakt musí být
 * na stránce doslova napsaný**. Model tady nic neodvozuje, nezaokrouhluje a
 * nedopočítává — jinak by se z „extrakce" stal druhý generátor halucinací, jen s
 * razítkem „ověřeno", což je horší než žádná fakta.
 *
 * Návrh k potvrzení, ne k automatickému zapsání: kandidáti jdou v Nastavení
 * uživateli pod ruku (tlačítko „Načíst z webu"), ať o tom, co značka o sobě tvrdí,
 * rozhodne člověk. Výjimka je onboarding, kde ještě žádný člověk u toho není —
 * tam se seed zapíše rovnou a zůstává editovatelný.
 */

import { generateTextQuality } from "@/instagram/gemini-client"
import { trackSpend } from "@/instagram/spend-tracker"
import { getModel, hasFallback } from "@/instagram/models"
import type { BrandFact } from "@/instagram/configs/types"
import { fetchPage, extractStructuredText, fetchSitemapUrls, extractSubpageUrls } from "@/app/onboarding/core"

/** Stránky, ze kterých se fakta obvykle dají vyčíst. Pořadí = priorita. */
const FACT_PAGE_HINTS = ["o-nas", "o-mne", "about", "kdo-jsme", "nase-pribeh", "historie", "kontakt", "contact", "sluzby", "faq", "doprava", "obchodni-podminky"]

export interface FactSourcePage {
    url: string
    text: string
}

/**
 * Prompt extrakce. Vyčleněný a exportovaný kvůli guardu (scripts/test-brand-facts.ts):
 * pravidlo „jen to, co na stránce doslova stojí“ je celý rozdíl mezi rešerší a
 * halucinací s razítkem „ověřeno“ — a takové pravidlo se hlídá, ne doufá.
 */
export function buildFactExtractionPrompt(brandName: string, usable: FactSourcePage[]): string {
    return `Jsi rešeršista. Ze stránek značky "${brandName}" vypiš OVĚŘITELNÁ FAKTA, která tam
stojí DOSLOVA napsaná. Nepíšeš marketing, píšeš seznam toho, čím se dá tvrzení podložit.

## STRÁNKY
${usable.map(p => `### ${p.url}\n${p.text.slice(0, 4000)}`).join("\n\n")}

## CO JE FAKT
Konkrétní údaj, na kterém může zákazník značku chytit za slovo:
- rok založení, doba působení, počet poboček / zaměstnanců / zákazníků
- certifikát, ocenění, členství, licence, atest
- záruka, dodací lhůta, otevírací doba, doprava zdarma od částky
- původ, materiál, složení, výrobní postup, kde se vyrábí
- konkrétní služba nebo parametr produktu, který web uvádí

## CO FAKT NENÍ (nevypisuj)
- Reklamní vata bez údaje: „špičková kvalita", „individuální přístup", „s láskou".
- Cokoli, co musíš odvodit, spočítat, zaokrouhlit nebo odhadnout. Když web říká
  „přes 20 let", napiš „přes 20 let" — ne „21 let" a ne „od roku 2005".
- Ceny konkrétních produktů (živý katalog je čte sám a mění se).
- Tvrzení z cizí stránky (reference, partneři, citace v médiích).

## JAK TO NAPÍŠEŠ
- Jedna věta česky, tak, jak by to mohlo zaznít v příspěvku, ale bez ozdob.
- \`source\` = URL stránky, ze které to je. Beze změny, tak jak stojí výš.
- Radši 5 faktů, kterými jsi si jistý, než 15 natažených. Když web žádné konkrétní
  údaje neuvádí, vrať prázdné pole — to je legitimní výsledek, ne selhání.
- Maximálně 15 faktů, bez duplicit.

## VÝSTUP — vrať POUZE validní JSON:
{ "facts": [ { "text": "...", "source": "https://..." } ] }`
}

/**
 * Vytáhne fakta z už načtených stránek. Jedno volání Pro ladderu — extrakce je
 * levná, ale špatně vytažený „fakt" se stane licencí ke lži ve VŠECH budoucích
 * postech, takže na ni flash nestačí.
 */
export async function extractFactsFromPages(brandName: string, pages: FactSourcePage[], opts: { clientId?: string | null } = {}): Promise<BrandFact[]> {
    const usable = pages.filter(p => p.text?.trim().length > 80).slice(0, 8)
    if (usable.length === 0) return []

    const prompt = buildFactExtractionPrompt(brandName, usable)

    const models = [getModel("textPro")]
    if (hasFallback("textPro")) models.push(getModel("textPro", "fallback"))

    // Vlastní účtovací scope: extrakci spouští onboarding (kde ji měří handler),
    // tlačítko v Nastavení i backfill skript — bez toho by dvě ze tří cest platily
    // z nikoho. Vnořený scope propaguje volání i nadřazenému akumulátoru.
    const raw = await trackSpend("brand_facts", { clientId: opts.clientId ?? null }, () => generateTextQuality(prompt, {
        models,
        label: "brand-facts",
        responseSchema: {
            type: "object",
            properties: {
                facts: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: { text: { type: "string" }, source: { type: "string" } },
                        required: ["text", "source"],
                    },
                },
            },
            required: ["facts"],
        },
    }))

    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw)
    const known = new Set(usable.map(p => p.url))
    const today = new Date().toISOString().slice(0, 10)

    return (Array.isArray(parsed?.facts) ? parsed.facts : [])
        .filter((f: any) => typeof f?.text === "string" && f.text.trim().length > 5)
        .map((f: any) => ({
            text: f.text.trim(),
            // Zdroj, který mezi načtenými stránkami není, si model vymyslel — a fakt
            // s vymyšleným zdrojem je přesně to, čemu má celá tahle vrstva bránit.
            source: known.has(f.source) ? f.source : usable[0].url,
            verifiedAt: today,
        }))
        .slice(0, 15)
}

/**
 * Načte web značky (homepage + stránky, kde fakta obvykle bývají) a vytáhne z nich
 * kandidáty. Používá to tlačítko v Nastavení i backfill skript.
 */
export async function suggestFactsFromSite(brandName: string, websiteUrl: string, opts: { clientId?: string | null } = {}): Promise<BrandFact[]> {
    const baseUrl = websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`
    const homepage = await fetchPage(baseUrl)

    const discovered = [...new Set([...(await fetchSitemapUrls(baseUrl)), ...extractSubpageUrls(homepage, baseUrl)])]
    // Stránky "o nás" / "kontakt" nesou fakta; kategorie a produkty jen katalog.
    const ranked = discovered
        .filter(u => FACT_PAGE_HINTS.some(h => u.toLowerCase().includes(h)))
        .slice(0, 5)

    const pages: FactSourcePage[] = [{ url: baseUrl, text: extractStructuredText(homepage) }]
    for (const url of ranked) {
        try {
            pages.push({ url, text: extractStructuredText(await fetchPage(url)) })
        } catch { /* nedostupná podstránka není důvod nevytáhnout nic */ }
    }

    return extractFactsFromPages(brandName, pages, opts)
}

/**
 * Sloučí nové kandidáty do stávajícího seznamu. Čistá funkce.
 *
 * NIKDY nemaže a nepřepisuje: ručně zadaný fakt je nadřazený tomu, co model přečetl
 * z webu (člověk ví, co je pravda dneska — web může být rok starý). Duplicita se
 * pozná po normalizovaném znění, ať se seznam po druhém skenu nezdvojí.
 */
export function mergeFacts(existing: BrandFact[], incoming: BrandFact[]): BrandFact[] {
    const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!?]+$/g, "").trim()
    const seen = new Set(existing.map(f => norm(f.text)))
    const added = incoming.filter(f => {
        const key = norm(f.text)
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
    })
    return [...existing, ...added]
}
