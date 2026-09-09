/**
 * Showcase kit — jedna generace v cizí barevnosti a cizím hlase.
 * =============================================================
 * Čistá funkce bez DB, jde otestovat bez `.env.local`.
 *
 * Účet `chrlit` má jednu paletu (#050505 + #c0392b) a zvenčí to čte jako
 * „umí jenom červený feed". Ukázková série to vyvrací tím, že každý příspěvek
 * je hotová práce pro značku z jiného oboru — v její barevnosti, typografii
 * i hlase. My na snímku zůstáváme jen jako drobný podpis v rohu.
 *
 * Engine přitom umí **jednu značku na generaci**: `## BRAND KIT:` v promptu
 * art directora se plní výhradně z `config.feedAesthetic` a copywriter čte
 * `config.brandVoice`. Tenhle modul nic neobchází — jen jim pro jedno
 * generování podstrčí jinou značku.
 *
 * ⚠️ ANONYMITA NENÍ KOSMETIKA. Když má kit `sourceSlug`, bere se z toho
 * portfoliového klienta POUZE paleta — jméno, web ani logo nikdy. Portfoliové
 * značky nejsou zákazníci a nevědí o sobě (viz `lib/audience.ts`); na
 * Instagramu není místo na disclaimer, takže jmenovitá ukázka by tvrdila
 * obchodní vztah, který neexistuje. Značka na snímku je VYMYŠLENÁ.
 */

import type { ClientConfig, FeedAesthetic, OverlayGradient } from "./configs/types"
import type { VisualMode } from "../lib/feed-pattern"

/** Čtyři výhody, které série rotuje. Text je zadání pro copywritera, ne hotová věta. */
export const SHOWCASE_BENEFITS = {
    cas: "majitel u toho nemusí sedět — obsah běží, i když je v terénu, v provozu nebo u zákazníka",
    znalost: "nemusí nic vysvětlovat ani promptovat — Chrlit si přečte jeho web a mluví jako on",
    cena: "vyjde levněji než externí social media manažer nebo agentura",
    konzistence: "feed nevysychá — pravidelné postování bez výpadků, které algoritmus odměňuje",
} as const

export type ShowcaseBenefit = keyof typeof SHOWCASE_BENEFITS

export interface ShowcaseKit {
    /** Klíč do registru showcase kitů (`--only=<key>`). */
    key: string
    /**
     * Portfoliový klient, ze kterého se čte ŽIVÁ paleta (`config.feedAesthetic`).
     * Jen zdroj barev — jméno, web ani logo se z něj nikdy nepřebírá.
     *
     * NEPOVINNÉ. Portfoliových značek je dvanáct, ale oborů chceme desítky:
     * vietnamská restaurace, čištění dlažeb ani zahradník žádnou předlohu
     * nemají. Bez `sourceSlug` si kit nese vlastní paletu ve `feedAesthetic`
     * a vyrábí ji `scripts/add-showcase-kit.ts`.
     */
    sourceSlug?: string
    /** Obor tak, jak se napíše do chrlitího pruhu na obálce. */
    industryLabel: string
    /**
     * Barva, která má snímku VLÁDNOUT (hex). Autorská volba z palety oboru.
     *
     * Naučený `accentColor` se na to použít nedá: Grandhotel Pupp má `#111111`,
     * takže z něj designér udělal černou dlaždici — v mřížce k nerozeznání od
     * chrlití černé.
     *
     * Pozor na opačný extrém: první verze tohle vynucovala jako „jedna plochá
     * výplň od kraje ke kraji", a devět značek se tím proměnilo v jednu šablonu
     * s vyměněným hexem. Barva teď musí přijít Z FOTKY — z osvětlené plodiny,
     * z vody, z omítky — ne z panelu za ní. Barva se předepisuje, KOMPOZICE ne.
     *
     * A musí mít energii: `isLowEnergyColor()`. Napodruhé série padla právě na
     * tom, že barvy vzaté z firemních palet portfoliových značek byly z deseti
     * ze šestnácti tmavé nebo mdlé a feed působil depresivně.
     */
    dominantColor: string
    /**
     * Rodina layoutů pro tenhle obor (`lib/feed-pattern.ts`).
     *
     * Rozprostřená napříč sérií schválně: devět dlaždic ve stejné kompozici je
     * složka prezentací, ne portfolio. Engine má osm archetypů — tohle je pustí
     * ke slovu místo toho, aby všechny spadly do `color-block-graphic`.
     */
    visualMode: VisualMode
    /**
     * VYMYŠLENÁ značka, za kterou příspěvek mluví. Nikdy skutečná firma.
     * Ukázka nějakou značku nést musí, jinak nevypadá jako skutečný post.
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
    /**
     * Hlas ukázkové značky — PŘEPISUJE `config.brandVoice` pro tuhle generaci.
     *
     * Napřed to bylo jen v `topic` a nestačilo to: copywriter má vlastní pilíře,
     * hlasové vzory a kritika, kteří ho všichni tlačí prodávat majitele účtu.
     * Nadpis sice poslechl, ale podtitulek se vrátil k „Chrlit maká" a vizuál
     * sklouzl k našemu vlastnímu před/po triku. S vyměněným hlasem soudí
     * i kritik a redakční rada za tu značku, ne za nás.
     */
    voiceBrief: string
    /** Persona ukázkové značky do `brandVoice.persona` — jedna věta, jak mluví. */
    persona: string
    /** 3-5 rysů hlasu do `brandVoice.voiceTraits`. */
    voiceTraits: string[]
    /**
     * Jednorázový směr art direction (`--variant=` v seed skriptu).
     *
     * Slouží ke srovnávacímu kolu: tentýž obor ve třech různých směrech vedle
     * sebe, ať se dá ukázat prstem místo popisování slovy. V registru se
     * nenastavuje — kdyby ano, byl by to zase mustr pro všechny.
     */
    directionOverride?: string
    /**
     * Výhoda Chrlitu, kterou tenhle obor nese v podtitulku ukázky.
     *
     * Instagram Chrlitu není portfolio klientských prací, ale náš prodejní
     * kanál na majitele firem. Vizuál dokazuje řemeslo, tenhle řádek prodává —
     * a rotuje napříč sérií, aby feed vyložil celou nabídku, ne pořád tutéž.
     */
    benefit: ShowcaseBenefit
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

/** Naše vlastní paleta. Ukázka pro cizí obor se od ní musí barevně odlepit. */
export const OWN_PALETTE = ["#050505", "#c0392b", "#ffffff"] as const

export function parseHex(hex: string): [number, number, number] | null {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
    if (!m) return null
    return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) as [number, number, number]
}

/**
 * Je barva tak blízko naší vlastní, že dlaždice splyne s domácím feedem?
 *
 * Generátor kitů navrhl pro vietnamskou restauraci „chilli červenou" #D82800 —
 * věcně správně pro ten obor, ale vedle naší #c0392b je to tatáž dlaždice,
 * a série existuje právě proto, aby červený feed rozbila.
 *
 * Práh 60 v RGB je empirický: #D82800 je od #c0392b vzdálená ~40 (zamítnuto),
 * terakota #c88c64 ~110 a závodní modř #004B93 ~200 (obě projdou).
 */
export function isTooCloseToOwnPalette(hex: string, threshold = 60): boolean {
    const c = parseHex(hex)
    if (!c) return true
    return OWN_PALETTE.some(own => {
        const o = parseHex(own)!
        return Math.hypot(c[0] - o[0], c[1] - o[1], c[2] - o[2]) < threshold
    })
}

/** HSL z hexu — sytost a světlost jsou to jediné, čím jde „energie" barvy měřit. */
export function toHsl(hex: string): { h: number; s: number; l: number } | null {
    const c = parseHex(hex)
    if (!c) return null
    const [r, g, b] = c.map(v => v / 255)
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    const l = (max + min) / 2
    const d = max - min
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
    let h = 0
    if (d !== 0) {
        if (max === r) h = ((g - b) / d) % 6
        else if (max === g) h = (b - r) / d + 2
        else h = (r - g) / d + 4
    }
    return { h: (h * 60 + 360) % 360, s, l }
}

/**
 * Barva bez energie — tmavá, mdlá, nebo vybledlá do ztracena.
 *
 * ⚠️ TOHLE JE DRUHÁ VERZE SÉRIE, KTERÁ NA BARVĚ PADLA. Napoprvé to byla černá
 * dlaždice (naučený accentColor #111111). Napodruhé celý feed: barvy jsem bral
 * z firemních palet portfoliových značek, a ty jsou konzervativní — deset ze
 * šestnácti vyšlo tmavých nebo mdlých a výsledek působil depresivně.
 *
 * Prahy: sytost ≥ 0,45 (jinak je to špína), světlost 0,42-0,80 (pod tím je to
 * noční, nad tím to v mřížce zmizí). Naměřeno na skutečných kitech —
 * #1e3f20 (lesní zeleň) má L 0,18, #b6a284 (béžová) S 0,26, obě propadly.
 */
export function isLowEnergyColor(hex: string): boolean {
    const c = toHsl(hex)
    if (!c) return true
    return c.s < 0.45 || c.l < 0.42 || c.l > 0.80
}

/**
 * Barva, která v mřížce neudělá barvu.
 *
 * Tmavý neutrál (#111111 u Pupp) vypadá v briefu jako legitimní značková barva,
 * ale jako dlaždice je k nerozeznání od chrlití černé. Kritérium je proto
 * dvojí: velmi tmavá A skoro bez barevnosti.
 */
export function isDeadShowcaseColor(hex: string): boolean {
    const c = parseHex(hex)
    if (!c) return true
    const [r, g, b] = c
    const chroma = Math.max(r, g, b) - Math.min(r, g, b)
    return Math.max(r, g, b) < 60 && chroma < 24
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
/**
 * Config pro JEDNU generaci v barevnosti a (volitelně) hlase jiného oboru.
 *
 * `mode` rozhoduje, KDO na příspěvku mluví, a je to nejdůležitější přepínač
 * celé série:
 *
 *  • `"ukazka"` — hlas patří ukázkové značce. Nadpis je věta, kterou by ta firma
 *    fakt napsala; teprve podtitulek prodává naši výhodu jejímu majiteli.
 *  • `"tema"` — mluvíme MY, jen mířeně na tenhle segment. Mýtus o AI vysázený
 *    v kadeřnických barvách je pořád náš mýtus, jen adresovaný kadeřnici.
 *    Hlas se tady NEPŘEPISUJE, protože prodáváme sebe.
 *
 * Obor se přepisuje v obou režimech: `gatherContext()` z něj čte, co se v tom
 * oboru zrovna děje, takže se hook opře o skutečnou sezónu místo o básničku.
 */
export function applyShowcaseKit(
    config: ClientConfig,
    kit: ShowcaseKit,
    mode: "ukazka" | "tema" = "ukazka",
): ClientConfig {
    const visual: ClientConfig = {
        ...config,
        feedAesthetic: {
            ...config.feedAesthetic,
            ...kit.feedAesthetic,
            customInstructions: buildShowcaseSignature(kit, mode),
        },
        overlayGradient: kit.overlayGradient ?? config.overlayGradient,
        // Context agent čte `industry` — tímhle si nastuduje sezónu a dění
        // v oboru, o který jde, místo v našem vlastním.
        industry: kit.industryLabel,
    }
    if (mode === "tema") return visual

    return {
        ...visual,
        brandVoice: {
            ...config.brandVoice,
            persona: kit.persona,
            voiceTraits: kit.voiceTraits,
            // Naše šablony hooků a CTA jsou celé o prodeji nástroje na obsah.
            // Ponechané by ukázkové značce vložily do úst náš pitch.
            hookTemplates: [],
            ctaVariations: [],
            toneByPostType: {},
        },
        // Few-shot hlasové vzory jsou podle caption-generatoru „nejsilnější
        // jednotlivá páka na konzistenci hlasu" — a ty naše jsou sarkastické
        // prodejní posty. V ukázce pro cizí obor musí zmizet, jinak přebijí
        // všechno ostatní.
        brandVoiceExamples: [],
        // Fakta o nás nemá ukázková značka co citovat; navíc je celá vymyšlená,
        // takže žádná ověřená fakta mít nemůže.
        brandFacts: [],
    }
}

/**
 * Podpis ukázky — jediné, co na snímku prozradí, že za ním stojíme my.
 *
 * ⚠️ TOHLE MÍSTO UŽ JEDNOU SÉRII ZABILO. První verze sem psala tvrdý mustr:
 * plochá výplň od kraje ke kraji, fotka jen jako vsazený inset, dole povinný
 * černý pruh. Devět značek se tím proměnilo v jednu šablonu s vyměněným hexem
 * a font. Vypadalo to lacině a hlavně to NEvypadalo jako práce pro klienta —
 * což je jediné, co má ukázka dokázat.
 *
 * Pravidlo, které z toho zbylo: předepisuj IDENTITU (barva, řez, jméno značky,
 * náš drobný podpis), nikdy KOMPOZICI. Rozvržení, kadrování a práci s fotkou
 * nech art directorovi přesně tak, jak je dělá platícímu klientovi.
 */
export function buildShowcaseSignature(kit: ShowcaseKit, mode: "ukazka" | "tema" = "ukazka"): string {
    // Na postu, kde mluvíme MY, nemá vymyšlená značka co dělat — je to naše
    // reklama v barvách oboru, ne ukázka práce pro tu značku. Podepisujeme se
    // proto sami a plnohodnotně; obor nese vizuál a štítek.
    if (mode === "tema") {
        return [
            `- This is OUR OWN ad, styled for one trade. Do NOT invent or render any company name,`,
            `  wordmark or logo other than the attached Chrlit logo. There is no client brand here.`,
            `- The frame must make the trade "${kit.industryLabel}" legible at a glance — a small label or`,
            `  a subject nobody could mistake for another trade.`,
            `- Our logo is the attached image, placed in one corner, copied exactly: do NOT redraw it, do`,
            `  NOT letter the word yourself, do NOT add a circle or badge that is not in the file.`,
            `- LIGHT: bright, high-key daylight, airy and energetic. No moody low-key murk, no dark vignette.`,
            `- ${kit.dominantColor} must fill the tile, and it comes OUT OF THE PHOTOGRAPH — the wardrobe,`,
            `  the wall, the props, the grade. A flat colour panel with a photo stamped on it is wrong.`,
            `- TYPEFACE — NON-NEGOTIABLE: ${kit.feedAesthetic.typographyStyle}. Render that, not a lookalike.`,
            `- The photograph must look like a real, expensive, commissioned shot: rich colour, crisp light,`,
            `  genuine texture. Juicy, not tasteful-grey. No band, no bar, no full-width strip.`,
        ].join("\n")
    }
    return [
        `- THIS IS A FINISHED POST FOR THE BRAND "${kit.brandName}", not a slide in a deck and not a`,
        `  presentation template. Compose it exactly as you would a real paid post for that brand:`,
        `  photography leads, the layout is free, text lives INSIDE the composition. Do NOT build a flat`,
        `  colour panel with a small bordered photo stamped into it, and do NOT add a footer bar.`,
        `- LIGHT: bright, high-key daylight. Open shade or direct sun, airy and energetic. This is NOT a`,
        `  moody, low-key, night-time or candle-lit scene — no deep shadows swallowing the frame, no dark`,
        `  vignette, no "cinematic" murk. If the subject would normally be shot at dusk, shoot it at noon.`,
        `- ${kit.dominantColor} must DOMINATE the frame so the tile reads as that colour in a profile grid.`,
        `  How it dominates is your call — colour grading of the photograph, a colour field the photo sits`,
        `  against, a tinted duotone. Never a dark neutral wash, never near-black.`,
        `- TYPEFACE — NON-NEGOTIABLE: ${kit.feedAesthetic.typographyStyle}. Render that, not a lookalike.`,
        `  Do NOT fall back to a generic bold grotesque / neo-grotesque sans: that is OUR own house style,`,
        `  and using it here makes the piece prove the opposite of what it exists to prove.`,
        `- The frame must make the INDUSTRY legible at a glance — "${kit.industryLabel}" set as a small`,
        `  label, or a subject so unmistakable nobody could read it as another trade. A follower from`,
        `  that trade has to recognise the post is aimed at them while scrolling.`,
        `- BRANDING ORDER — the showcased brand outranks us, always:`,
        `  1. "${kit.brandName}" is the only wordmark of any size, set in the brand's own typography,`,
        `     placed like a real brand would place it (a top or bottom corner).`,
        `  2. Our signature is the attached logo plus the lowercase words "by chrlit", TOGETHER no wider`,
        `     than about 12% of the frame, in the OPPOSITE corner from the brand wordmark. It must read as`,
        `     a discreet credit line, the way a photographer signs a print.`,
        `  Never lock the two together into one badge, never set our logo larger than the brand wordmark,`,
        `  and never put the brand name underneath ours as a subtitle. Copy our logo's exact shapes and`,
        `  colours — do NOT redraw it, do NOT letter the word yourself, do NOT add a circle or badge that`,
        `  is not in the file. No band, no bar, no full-width strip.`,
    ].join("\n")
}

/**
 * Zadání pro copywritera — `topic` je free text a teče do mega promptu, takže
 * hlas ukázkové značky i zákazy oboru se vejdou bez jediné změny kódu.
 */
export function buildShowcaseTopic(kit: ShowcaseKit): string {
    const lines = [
        `UKÁZKA PRÁCE pro obor „${kit.industryLabel}" — dvouvrstvý příspěvek.`,
        ``,
        `Instagram Chrlitu čtou MAJITELÉ FIREM, ne jejich zákazníci. Tenhle příspěvek`,
        `proto dělá dvě věci najednou a každou nese jiný řádek:`,
        ``,
        `1) HOOK = věta značky „${kit.brandName}" k JEJÍM zákazníkům. Tohle je DŮKAZ,`,
        `   že umíme psát pro tenhle obor. Musí to být věta, kterou by ta firma`,
        `   SKUTEČNĚ napsala — opřená o konkrétní věc: produkt, úkon, ročník, sezónu,`,
        `   termín. Ne hezky znějící básnička, ne obecná chvála řemesla.`,
        ``,
        `   ŠPATNĚ (básnička): „Kde se tradice snoubí s vášní."`,
        `   ŠPATNĚ (mluví o nás): „Takhle prodáte víno bez focení."`,
        `   DOBŘE (konkrétní): „Ryzlink z vápence. Pět dní do sklizně."`,
        `   (Ukázka TVARU. Napiš vlastní větu pro tenhle obor a tuhle sezónu.)`,
        ``,
        `2) PODTITULEK = naše VÝHODA pro majitele takové firmy. Tady mluvíme my`,
        `   a prodáváme: ${SHOWCASE_BENEFITS[kit.benefit]}.`,
        `   Jedna věta, mluv na něj přímo, navaž na tu situaci z hooku.`,
        ``,
        `   DOBŘE: „Nechte sítě žít, i když jste ve vinohradu."`,
        ``,
        `Na snímku musí být vidět, pro jaký obor to je — ať vinař pozná, že je to pro něj.`,
        ``,
        `Popisek pod příspěvkem je náš: pro jaký obor ukázka je, že jde o ukázkový koncept`,
        `a že značka „${kit.brandName}" neexistuje, teprve pak nabídka a odkaz.`,
        ``,
        `„${kit.brandName}" je VYMYŠLENÁ značka. Nikde nesmí padnout jméno skutečné firmy.`,
    ]
    if (kit.guardrails) lines.push(``, `ZÁKAZY PRO TENHLE OBOR: ${kit.guardrails}`)
    return lines.join("\n")
}

/**
 * Zadání pro post, který mluví NAŠÍM hlasem, ale míří na jeden segment.
 *
 * Dvě třetiny feedu jsou Chrlitovy běžné formáty (mýtus, srovnání, před/po).
 * Ty se hlasově nepřepisují — prodáváme sebe. Mění se jen adresát a barevnost,
 * takže mýtus o AI nemluví do prázdna, ale ke kadeřnici.
 */
export function buildSegmentTopic(kit: ShowcaseKit): string {
    return [
        `Tenhle příspěvek míří na JEDEN segment: majitele firmy z oboru „${kit.industryLabel}".`,
        ``,
        `Mluvíme my, naším hlasem, o nás — ale všechno v příspěvku musí sedět tomuhle`,
        `člověku: jeho provoz, jeho sezóna, jeho večery, jeho výmluvy. Obecný příspěvek`,
        `„pro podnikatele" je špatně; tohle je příspěvek pro ${kit.industryLabel.toLowerCase()}.`,
        ``,
        `Výhoda, kterou tenhle příspěvek nese: ${SHOWCASE_BENEFITS[kit.benefit]}.`,
        ``,
        `Vizuál běží v barevnosti a typografii toho oboru, ať je na profilu vidět,`,
        `že pro každý obor vypadá obsah jinak.`,
    ].join("\n")
}
