/**
 * Jazyk obsahu značky
 * ===================
 * Jediné místo, kde engine ví, JAKÝM JAZYKEM značka mluví ke svému publiku.
 *
 * Dvě osy, které se nesmí plést:
 *  - **Jazyk obsahu** = vlastnost ZNAČKY (`ClientConfig.language`). Řídí všechno, co
 *    uvidí publikum: texty postů, hashtagy, typografii v obraze, narraci, titulky,
 *    a taky všechno, co AI o značce ukládá (brand memory, formáty, persony) — protože
 *    to samé pak čte copywriter jako kontext. Česká agentura může spravovat německou
 *    značku; ta mluví německy.
 *  - **Jazyk UI** = vlastnost UŽIVATELE (viz `lib/i18n`). Chrome dashboardu, e-maily
 *    uživateli, onboardingové otázky. Tady se neřeší.
 *
 * Prompty enginu jsou psané česky a takové zůstávají — model je vícejazyčný a jedna
 * kopie promptu je jediná, která se dá udržet. Co se mění, je VÝSTUPNÍ jazyk: každé
 * místo, kde prompt dřív říkal „česky", „Czech" nebo vypisoval českou diakritiku, si
 * frázi bere odsud. Nikdy „česky" natvrdo — hlídá `npm run guard`.
 *
 * Nový jazyk = nový záznam v `PACKS` + tabulka svátků v `signals/calendar.ts`.
 * Leaf modul: žádné importy z enginu, aby ho mohl číst kdokoli bez cyklu.
 */

export const CONTENT_LANGUAGES = ["cs", "sk", "en", "de", "pl"] as const
export type ContentLanguage = (typeof CONTENT_LANGUAGES)[number]

/** Domácí trh produktu. Config bez pole = česká značka (všichni klienti před 9/2026). */
export const DEFAULT_CONTENT_LANGUAGE: ContentLanguage = "cs"

export interface LanguagePack {
    code: ContentLanguage
    /** BCP-47 — formátování čísel/dat a TTS poskytovatelé, kteří jazyk chtějí explicitně. */
    locale: string
    /** Země, podle které se berou svátky a marketingové dny (`signals/calendar.ts`). */
    country: string
    /** Do anglicky psaných promptů (obrazový model, vision QA, režisér reelu): „Czech". */
    englishName: string
    /** Pro UI a výběr jazyka: „čeština". */
    nativeName: string
    /** Do česky psaných promptů místo slova „česky": „slovensky". */
    adverbCs: string
    /** Přídavné jméno pro „české hashtagy": „slovenské". */
    localCs: string
    /** 6. pád pro „na českém trhu": „slovenském". */
    marketCs: string
    /** Jak má text znít, česky pro prompt: „moderní hovorovou češtinou". */
    styleCs: string
    /** Totéž pravidlo v jazyce samotném — druhá kotva, aby model nesklouzl do češtiny
     *  promptu. Prázdné u češtiny (prompt už česky je). */
    nativeRule: string
    /** Znaky s diakritikou, které obrazový model musí vykreslit přesně. Prázdné = žádné. */
    diacritics: string
    /** Region pro kontextového agenta, když značka nemá město: „Česká republika". */
    regionCs: string
}

const PACKS: Record<ContentLanguage, LanguagePack> = {
    cs: {
        code: "cs",
        locale: "cs-CZ",
        country: "CZ",
        englishName: "Czech",
        nativeName: "čeština",
        adverbCs: "česky",
        localCs: "české",
        marketCs: "českém",
        styleCs: "moderní hovorovou češtinou",
        nativeRule: "",
        diacritics: "ě š č ř ž ý á í é ů ú",
        regionCs: "Česká republika",
    },
    sk: {
        code: "sk",
        locale: "sk-SK",
        country: "SK",
        englishName: "Slovak",
        nativeName: "slovenčina",
        adverbCs: "slovensky",
        localCs: "slovenské",
        marketCs: "slovenském",
        styleCs: "moderní hovorovou slovenštinou",
        nativeRule: "Píš po slovensky — moderne, prirodzene a hovorovo, ako rodený copywriter. Nikdy nemiešaj češtinu.",
        diacritics: "ľ š č ť ž ý á í é ú ä ô ň ď ĺ ŕ",
        regionCs: "Slovensko",
    },
    en: {
        code: "en",
        locale: "en-GB",
        country: "INTL",
        englishName: "English",
        nativeName: "English",
        adverbCs: "anglicky",
        localCs: "anglické (lokální pro trh značky)",
        marketCs: "anglicky mluvícím",
        styleCs: "moderní hovorovou angličtinou, jako rodilý mluvčí",
        nativeRule: "Write in natural, modern, conversational English, like a native copywriter. Never mix in Czech.",
        diacritics: "",
        regionCs: "anglicky mluvící trh",
    },
    de: {
        code: "de",
        locale: "de-DE",
        country: "DE",
        englishName: "German",
        nativeName: "Deutsch",
        adverbCs: "německy",
        localCs: "německé",
        marketCs: "německém",
        styleCs: "moderní hovorovou němčinou",
        nativeRule: "Schreibe auf Deutsch — modern, natürlich und umgangssprachlich, wie ein muttersprachlicher Texter. Niemals Tschechisch einmischen.",
        diacritics: "ä ö ü ß",
        regionCs: "Německo",
    },
    pl: {
        code: "pl",
        locale: "pl-PL",
        country: "PL",
        englishName: "Polish",
        nativeName: "polski",
        adverbCs: "polsky",
        localCs: "polské",
        marketCs: "polském",
        styleCs: "moderní hovorovou polštinou",
        nativeRule: "Pisz po polsku — nowocześnie, naturalnie i potocznie, jak rodzimy copywriter. Nigdy nie mieszaj czeskiego.",
        diacritics: "ą ć ę ł ń ó ś ź ż",
        regionCs: "Polsko",
    },
}

export function isContentLanguage(value: unknown): value is ContentLanguage {
    return typeof value === "string" && (CONTENT_LANGUAGES as readonly string[]).includes(value)
}

/**
 * Balíček pro kód jazyka. Neznámá nebo chybějící hodnota = čeština — CLAMP, ne výjimka:
 * config vzniklý před zavedením pole má mluvit tak, jak mluvil dosud. Skutečně
 * neplatnou hodnotu odmítne `validateConfig()`, sem se nedostane.
 */
export function languagePack(code: string | null | undefined): LanguagePack {
    return isContentLanguage(code) ? PACKS[code] : PACKS[DEFAULT_CONTENT_LANGUAGE]
}

/** Hlavní vstup pro engine: `const L = contentLanguage(config)`. */
export function contentLanguage(config: { language?: string | null } | null | undefined): LanguagePack {
    return languagePack(config?.language)
}

/** Pro výběr v UI — v pořadí, v jakém se nabízí. */
export function languageOptions(): { code: ContentLanguage; nativeName: string; englishName: string }[] {
    return CONTENT_LANGUAGES.map(code => ({ code, nativeName: PACKS[code].nativeName, englishName: PACKS[code].englishName }))
}

// ─── Fráze do promptů ───────────────────────────────────────────────────────

/** „Piš česky, moderní hovorovou češtinou." — jedna věta do libovolného českého promptu. */
export function writeRuleCs(L: LanguagePack): string {
    return `Piš ${L.adverbCs}, ${L.styleCs}.${L.nativeRule ? ` ${L.nativeRule}` : ""}`
}

/**
 * Blok pro sekci JAZYK v mega promptu copywritera. U češtiny přesně to, co tam bylo
 * vždycky; u cizího jazyka navíc explicitní výčet, CO všechno má být v jazyce
 * publika — jinak model nechá titulky do obrázku nebo hashtagy v jazyce promptu.
 */
export function languageSectionCs(L: LanguagePack): string {
    const base = `Piš ${L.adverbCs}, ${L.styleCs}. Krátké věty. Přímé. Bez keců.`
    if (L.code === DEFAULT_CONTENT_LANGUAGE) return base
    return [
        base,
        L.nativeRule,
        `⚠️ VŠECHNO, co uvidí publikum — hook, body, CTA, hashtagy, texty do obrázku (headline, subtext, slidy, snímky), narrace i titulky — je ${L.adverbCs.toUpperCase()}. Instrukce v tomhle zadání jsou česky jen pro tebe; do výstupu čeština nepatří. Pole imagePrompt / visual / camera / mood zůstávají anglicky (jsou pro obrazový model).`,
    ].join("\n")
}

/**
 * Pro anglicky psané prompty obrazového modelu a vision QA:
 * „EXACT Czech text, character-for-character including diacritics (ě š č …)".
 * Angličtina diakritiku nemá — věta se zkrátí, místo aby vypisovala prázdnou závorku.
 */
export function exactTextRule(L: LanguagePack): string {
    return `EXACT ${L.englishName} text, ${verbatimRule(L)}`
}

/** „character-for-character including diacritics (ě š č …)" — bez jazyka, jen přesnost. */
export function verbatimRule(L: LanguagePack): string {
    return `character-for-character${L.diacritics ? ` including diacritics (${L.diacritics})` : ""}`
}

/** „, including Czech diacritics (ě š č …)" — dovětek k „must match EXACTLY". */
export function diacriticsClause(L: LanguagePack): string {
    return L.diacritics ? `, including ${L.englishName} diacritics (${L.diacritics})` : ""
}

// ─── Detekce z webu (onboarding) ────────────────────────────────────────────

/**
 * Jazyk webu značky. Nejdřív to, co web sám tvrdí (`<html lang>`, `og:locale`), pak
 * heuristika nad písmeny, která má z pěti jazyků jen jeden: ř ě ů → čeština,
 * ľ ĺ ŕ ô → slovenština, ą ę ł ń ś ź ż → polština, ö ü ß → němčina (ä sdílí
 * slovenština s němčinou, proto se nepočítá). Bez diakritiky a s anglickými
 * spojkami → angličtina; jinak čeština, protože to je domácí trh a onboarding
 * volbu stejně ukáže k potvrzení.
 */
export function detectContentLanguage(html: string): ContentLanguage {
    const declared = html.match(/<html[^>]*\slang=["']?\s*([a-zA-Z]{2})/i)?.[1]?.toLowerCase()
    if (isContentLanguage(declared)) return declared
    const og = html.match(/og:locale["'][^>]*content=["']\s*([a-zA-Z]{2})/i)?.[1]
        ?? html.match(/content=["']\s*([a-zA-Z]{2})[_-][a-zA-Z]{2}["'][^>]*og:locale/i)?.[1]
    const ogCode = og?.toLowerCase()
    if (isContentLanguage(ogCode)) return ogCode
    return detectLanguageFromText(stripTags(html))
}

export function detectLanguageFromText(text: string): ContentLanguage {
    const sample = text.slice(0, 40_000)
    const count = (re: RegExp) => (sample.match(re) || []).length
    const scores: Record<Exclude<ContentLanguage, "en">, number> = {
        cs: count(/[řěů]/gi),
        sk: count(/[ľĺŕô]/gi),
        pl: count(/[ąęłńśźż]/gi),
        de: count(/[öüß]/gi),
    }
    const [best, bestScore] = (Object.entries(scores) as [Exclude<ContentLanguage, "en">, number][])
        .sort((a, b) => b[1] - a[1])[0]
    if (bestScore >= 3) return best
    const englishGlue = count(/\b(the|and|with|for|your|our|from|about)\b/gi)
    if (englishGlue >= 8) return "en"
    return DEFAULT_CONTENT_LANGUAGE
}

function stripTags(html: string): string {
    return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
}
