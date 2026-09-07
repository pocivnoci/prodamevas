/**
 * Když si brána není jistá, jde se podívat.
 * =========================================
 * Faktická brána (`instagram/fact-check.ts`) uměla dvě odpovědi: „stojí to v povolených
 * zdrojích" nebo „nemáš to čím podložit". Tvrzení o SVĚTĚ — zákon, norma, termín,
 * parametr cizího produktu — nespadalo ani do jedné: pravda to je, ale v `brandFacts`
 * to nikdy nebude, protože to není fakt o značce. Brána z toho dělala vatu.
 *
 * Tenhle modul je ta třetí odpověď: **doložím to citací, nebo mlčím.**
 *
 * Bezpečnost tu nestojí na tom, že levnému modelu věříme. Stojí na třech mezích, které
 * drží KÓD, ne prompt:
 *
 *  1. **Dovnitř smí jen `unsure`.** Volající sem posílá výhradně tvrzení, která Pro
 *     soudce označil za nejistá. Tvrzení, které soudce pustil (`ok`), se sem nedostane
 *     — levný model tedy nemá jak nic shodit; umí jen přidat.
 *  2. **URL musí být ze skutečných výsledků hledání.** Doklad se přijme, jen když jeho
 *     adresa stojí v `evidence` z odpovědi API. Vymyšlená URL je přesně ta halucinace
 *     s razítkem „ověřeno", které má celá vrstva bránit — táž pojistka jako
 *     `known.has(f.source)` v `lib/brand-facts.ts`.
 *  3. **Vlastní web klienta se nepočítá.** Doložit tvrzení o klientovi jeho vlastním
 *     marketingem je kruh; co stojí na jeho webu, patří do Ověřených faktů přes
 *     „Načíst z webu". Doména jde do `blocked_domains` a ještě jednou se filtruje tady.
 *
 * Fail-**closed**: jakákoli chyba, chybějící klíč nebo timeout znamená „nepodloženo",
 * tedy přesně dnešní chování brány. Nikdy nevyhazuje — post se kvůli hledání nezabije.
 */

import { searchWithClaude, claudeJudgeEnabled, type SearchEvidence } from "./anthropic-client"

/** Doklad připojený k příspěvku — jeden tvar pro DB (`ig_generation_log.fact_sources`), log i UI. */
export interface FactSource {
    /** Tvrzení, jak stojí v textu příspěvku. */
    claim: string
    url: string
    title?: string
    /** Doslovný úryvek stránky (API ho zkracuje na 150 znaků). */
    quote?: string
}

/** Tvrzení k ověření — `query` napsal soudce, když ho označil za nejisté. */
export interface WebCheckInput {
    claim: string
    query?: string
}

/** Kolik hledání smí jeden příspěvek spotřebovat. Účtuje se $0,01 za kus. */
const MAX_SEARCHES = 3

/**
 * Prompt ověření. Čistá funkce, exportovaná kvůli guardu — pravidlo „musí to tam stát
 * DOSLOVA" je celý rozdíl mezi rešerší a halucinací s razítkem, a takové pravidlo se
 * hlídá, ne doufá. (Táž doktrína jako `buildFactExtractionPrompt` v lib/brand-facts.ts.)
 */
export function buildWebVerifyPrompt(claims: WebCheckInput[], brandName: string): string {
    return `Jsi rešeršista. Níž jsou tvrzení z marketingového textu značky "${brandName}".
Tvůj jediný úkol: zjistit vyhledáním, jestli je nějaká veřejná stránka uvádí DOSLOVA.

Nehodnotíš styl ani to, jestli se ti tvrzení líbí. Ptáš se jen: **stojí to někde napsané?**

## TVRZENÍ
${claims.map((c, i) => `[${i + 1}] ${c.claim}${c.query ? `\n    (hledej: ${c.query})` : ""}`).join("\n")}

## PRAVIDLA
- **Doslova, nebo nic.** Když stránka říká „přes 20 let", nepotvrzuje to „od roku 2005"
  ani „21 let". Nic neodvozuj, nedopočítávej, nezaokrouhluj.
- **Zdroj musí být z tvého hledání.** Uveď URL, které jsi ve výsledcích skutečně viděl.
  Vymyšlená nebo po paměti napsaná adresa je horší než žádná odpověď.
- **Web samotné značky nepočítej.** Když je jediný nález na "${brandName}" vlastním webu
  nebo v jeho tiskové zprávě, je to jeho vlastní tvrzení o sobě, ne doklad. Označ jako
  nepotvrzené.
- **Nenašel jsi to? Řekni to.** \`"supported": false\` je správná a častá odpověď. Nemáš
  kvótu na potvrzení a nic tě nenutí něco najít.
- **Neber blízké tvrzení místo přesného.** Když text říká 300 °C a stránka 150 °C, je to
  nepotvrzené, ne potvrzené.

## VÝSTUP — vrať POUZE validní JSON, nic jiného:
{
  "results": [
    { "claim": "citace tvrzení beze změny", "supported": true, "url": "https://…", "quote": "věta ze stránky, doslova" },
    { "claim": "citace dalšího tvrzení", "supported": false }
  ]
}`
}

/** Host z URL bez `www.`, malými písmeny. Vrací `null` u nesmyslu. */
function hostOf(url: string): string | null {
    try {
        return new URL(url).hostname.replace(/^www\./i, "").toLowerCase()
    } catch {
        return null
    }
}

/**
 * Rozhodne, jestli je doklad přípustný. Čistá funkce — testuje ji
 * `scripts/test-prompt-assembly.ts` bez volání modelu.
 *
 * Přijímá jen URL, které je mezi skutečně nalezenými (`evidence`) a není na doméně
 * klienta. Právě tahle funkce je důvod, proč ověřování smí běžet na levném modelu:
 * ať model napíše cokoli, adresu si vymyslet nemůže.
 */
export function admissibleSource(
    url: unknown,
    evidence: SearchEvidence[],
    brandHost: string | null,
): SearchEvidence | null {
    if (typeof url !== "string" || !url.trim()) return null
    const host = hostOf(url)
    if (!host) return null
    if (brandHost && (host === brandHost || host.endsWith(`.${brandHost}`))) return null
    // Shoda po hostu i celé adrese: model občas vrátí URL bez koncového lomítka nebo
    // s jiným fragmentem, což je pořád tentýž nález — ale doména musí sedět vždycky.
    const exact = evidence.find(e => e.url === url)
    if (exact) return exact
    return evidence.find(e => hostOf(e.url) === host) ?? null
}

/**
 * Ověří nejistá tvrzení na webu. Jedno volání pro všechna naráz — čeká se na síť, ne
 * na procesor, a tři sériová volání by trojnásobila latenci uvnitř generačního jobu.
 *
 * Vrací POUZE doložená tvrzení. Co se nevrátí, zůstává pro volajícího nepodložené —
 * proto je selhání téhle funkce bezpečné a nemusí se rozlišovat od negativního nálezu.
 */
export async function verifyClaimsOnWeb(
    claims: WebCheckInput[],
    opts: { brandName: string; brandWebsite?: string | null; label?: string },
): Promise<FactSource[]> {
    if (claims.length === 0) return []
    if (!claudeJudgeEnabled()) return []
    if (process.env.FACT_WEB === "off") return []

    const brandHost = opts.brandWebsite ? hostOf(opts.brandWebsite) : null

    try {
        const { text, evidence } = await searchWithClaude(
            buildWebVerifyPrompt(claims, opts.brandName),
            {
                label: opts.label ?? "fact-web",
                maxSearches: MAX_SEARCHES,
                blockedDomains: brandHost ? [brandHost] : [],
            },
        )

        const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text)
        const results: Record<string, any>[] = Array.isArray(parsed?.results) ? parsed.results : []

        const out: FactSource[] = []
        for (const r of results) {
            if (r?.supported !== true) continue
            const hit = admissibleSource(r.url, evidence, brandHost)
            if (!hit) {
                // Model tvrdí doklad, který v nálezech není. Musí to být slyšet: mlčky
                // zahozený „doklad" vypadá stejně jako tvrzení, které se nenašlo.
                console.warn(`   ⚠️ fact-web: zdroj mimo nálezy, zahazuji — "${String(r.url).slice(0, 80)}"`)
                continue
            }
            // Tvrzení se páruje na to, co poslal volající — model si znění mohl upravit
            // a s upraveným zněním by se doklad u příspěvku nespároval se štítkem.
            const original = claims.find(c => c.claim === r.claim)?.claim
                ?? claims.find(c => typeof r.claim === "string" && c.claim.includes(r.claim))?.claim
            if (!original) continue
            out.push({
                claim: original,
                url: hit.url,
                title: hit.title ?? r.title,
                quote: (typeof r.quote === "string" && r.quote.trim()) ? r.quote.trim().slice(0, 200) : hit.quote,
            })
        }
        return out
    } catch (err: any) {
        // Fail-closed, nahlas: tvrzení zůstane nepodložené = chování brány před touhle
        // vrstvou. Kvalita se nesmí zhoršit ani zlepšit potichu.
        console.warn(`   ⚠️ Ověření na webu nedoběhlo — tvrzení zůstávají nepodložená: ${String(err?.message || err).slice(0, 120)}`)
        return []
    }
}
