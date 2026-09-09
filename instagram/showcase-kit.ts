/**
 * Showcase kit — jedna generace v cizí barevnosti.
 * ===============================================
 * Čistá funkce bez DB, jde otestovat bez `.env.local`.
 *
 * Účet `chrlit` má jednu paletu (#050505 + #c0392b) a zvenčí to čte jako
 * „umí jenom červený feed". Showcase karusel to vyvrací tím, že celý —
 * včetně obálky — běží v barvách jiného oboru; Chrlit v něm drží identitu
 * logem a černým pruhem na obálce, ne barvou pozadí.
 *
 * Engine přitom umí **jednu paletu na karusel**: `## BRAND KIT:` v promptu
 * art directora se plní výhradně z `config.feedAesthetic`
 * (`image-pipeline.ts`), a pravidlo 1 tomu designérovi výslovně přikazuje
 * držet jeden design system přes všechny slidy. Tenhle modul to pravidlo
 * neobchází — jen mu pro jedno generování podstrčí jinou paletu.
 *
 * ⚠️ ANONYMITA NENÍ KOSMETIKA. Paleta se bere z portfoliového klienta, ale
 * jméno, web ani logo té firmy se nepřebírají NIKDY. Portfoliové značky
 * nejsou zákazníci a nevědí o sobě (viz `lib/audience.ts`); na Instagramu
 * není místo na disclaimer, takže jmenovitá ukázka by tvrdila obchodní
 * vztah, který neexistuje. Slidy proto nesou VYMYŠLENOU značku.
 */

import type { ClientConfig, FeedAesthetic, OverlayGradient } from "./configs/types"

export interface ShowcaseKit {
    /** Klíč do registru showcase kitů (`--only=<key>`). */
    key: string
    /**
     * Portfoliový klient, ze kterého se čte ŽIVÁ paleta (`config.feedAesthetic`).
     * Jen zdroj barev — jméno, web ani logo se z něj nikdy nepřebírá.
     */
    sourceSlug: string
    /** Obor tak, jak se napíše do chrlitího pruhu na obálce. */
    industryLabel: string
    /**
     * VYMYŠLENÁ značka na slidech 2-4. Nikdy skutečná firma.
     * Ukázkový příspěvek nějakou značku nést musí, jinak nevypadá jako feed.
     */
    brandName: string
    /**
     * Vizuální přepis. `colorPalette`, `accentColor` a `overlayGradient` doplňuje
     * driver živě ze `sourceSlug`; `typographyStyle` a `feel` jsou autorské —
     * naučené configy mají skoro všechny `font: "Inter"` a
     * `feel: "Moderní a čistý design"`, což by žádanou rozmanitost nedodalo.
     */
    feedAesthetic: Partial<FeedAesthetic>
    overlayGradient?: OverlayGradient
    /** Hlas té značky pro text NA slidech. Jde do `topic`, ne do `brandVoice`. */
    voiceBrief: string
    /**
     * Tvrdé zákazy pro obor. U financí povinné — viz commit 2ba162e6:
     * portfolio AGRO INVEST záměrně nešlo na web, protože vygenerované
     * příspěvky nesly „8% zhodnocení", „garanci odkupu" a „absolutní jistotu".
     */
    guardrails?: string
}

/**
 * Obory, kde `guardrails` nejsou volitelné (vynucuje `npm run guard`).
 *
 * Dvě rodiny, obě s vlastním českým zákonem za zády:
 *  • finance — precedens commitu 2ba162e6 (garantovaný výnos, „absolutní jistota"),
 *  • zdraví a estetika — reklama nesmí slibovat léčebný účinek ani výsledek zákroku.
 */
export const REGULATED_INDUSTRY_HINTS = [
    "invest", "výnos", "vynos", "financ", "půd", "pud", "úvěr", "uver", "pojiš", "pojis",
    "zdrav", "medicín", "medicin", "klinik", "estetick", "lékař", "lekar", "dentál", "dental",
]

export function isRegulatedShowcase(kit: Pick<ShowcaseKit, "industryLabel">): boolean {
    const s = kit.industryLabel.toLowerCase()
    return REGULATED_INDUSTRY_HINTS.some(h => s.includes(h))
}

/**
 * Config pro JEDNO generování v barvách kitu.
 *
 * Vrací VŽDY nový objekt a vstup nesmí sáhnout. `CLIENT_CONFIG` v
 * `autopilot.ts` je modulově globální a cachovaná napříč posty jedné lambdy —
 * mutace by prosákla do dalších postů `chrlit` a ty by zůstaly zelenozlaté.
 *
 * Přepisuje se JEN vizuál. `brandVoice` zůstává Chrlitův, protože popisek pod
 * postem patří Chrlitu; hlas ukázkové značky nese `voiceBrief` skrz `topic`.
 * `logoFile` se nepřepisuje: zůstává `logo-chrlit.png` a `loadLogo` ho odvozuje
 * z názvu souboru, ne z aktivního klienta — obálka tak dostane logo Chrlitu.
 */
export function applyShowcaseKit(config: ClientConfig, kit: ShowcaseKit): ClientConfig {
    return {
        ...config,
        feedAesthetic: {
            ...config.feedAesthetic,
            ...kit.feedAesthetic,
            customInstructions: buildCoverLockup(kit),
        },
        overlayGradient: kit.overlayGradient ?? config.overlayGradient,
    }
}

/**
 * Pravidlo obálkového pruhu — jediné místo v BRAND KIT bez limitu délky
 * (`FORMAT_BRIEF_LIMITS` sráží `visualStyle` na 160 znaků, tohle ne).
 *
 * Pruh je to, co drží sérii pohromadě: dvanáct obálek ve dvanácti paletách
 * se stejným podpisem čte jako záměr, dvanáct bez něj jako cizí profily.
 */
export function buildCoverLockup(kit: ShowcaseKit): string {
    return [
        `- COVER LOCKUP (cover slide ONLY, never on inner slides): the bottom ~18% of the cover is a solid`,
        `  near-black band (#050505) spanning the full width. Inside the band, on one line: the Chrlit logo`,
        `  at the left, and to its right the small uppercase eyebrow "CHRLIT PRO ${kit.industryLabel.toUpperCase()}"`,
        `  in white, wide letter-spacing. The band is flat — no gradient, no texture, no photo bleeding into it.`,
        `- Above the band the cover is FULLY in this kit's palette and typography. The headline sits in that`,
        `  area, never inside the band.`,
        `- INNER SLIDES (2..N) carry NO band, NO Chrlit logo and NO Chrlit red — they are a clean feed of the`,
        `  showcased brand "${kit.brandName}" and nothing else.`,
        `- Every inner slide carries the small wordmark "${kit.brandName}" in the SAME corner and the same`,
        `  size — a sample feed that changes its own signature every slide does not read as one brand.`,
        `  Never invent or render any other company name anywhere.`,
    ].join("\n")
}

/**
 * Zadání pro copywritera — `topic` je free text a teče do mega promptu, takže
 * hlas ukázkové značky i zákazy oboru se vejdou bez jediné změny kódu.
 */
export function buildShowcaseTopic(kit: ShowcaseKit): string {
    const lines = [
        `UKÁZKOVÝ KARUSEL: co by Chrlit vyrobil pro obor „${kit.industryLabel}".`,
        ``,
        `Slide 1 (obálka) je Chrlitova: představí, že tohle je ukázka práce pro tenhle obor.`,
        `Slidy 2-4 jsou TŘI SAMOSTATNÉ ukázkové příspěvky vymyšlené značky „${kit.brandName}"`,
        `z toho oboru — každý stojí sám o sobě, nejsou to kroky jednoho návodu.`,
        ``,
        `Hlas značky „${kit.brandName}" pro texty NA slidech 2-4: ${kit.voiceBrief}`,
        `Popisek pod příspěvkem naopak píše Chrlit svým hlasem a musí v něm zaznít,`,
        `že jde o ukázkový koncept, ne o práci pro konkrétního klienta.`,
        ``,
        `„${kit.brandName}" je VYMYŠLENÁ značka. Nikde nesmí padnout jméno žádné skutečné firmy.`,
    ]
    if (kit.guardrails) lines.push(``, `ZÁKAZY PRO TENHLE OBOR: ${kit.guardrails}`)
    return lines.join("\n")
}
