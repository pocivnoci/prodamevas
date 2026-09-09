/**
 * Identita podnikatele — JEDINÝ zdroj pravdy.
 * ===========================================
 * Obchodní podmínky, zásady zpracování údajů, patička, faktury i transakční
 * e-maily čtou identifikační údaje odsud. Nikdy je nepiš do JSX napřímo —
 * IČO na pěti místech znamená, že po změně čtyři z nich lžou.
 *
 * Proč konstanta v gitu a ne jen env:
 *  - údaje jsou veřejné (živnostenský rejstřík), takže nejde o tajemství;
 *  - obchodní podmínky musí být verzované a dohledatelné v čase, což git umí
 *    a dashboard Vercelu ne;
 *  - `NEXT_PUBLIC_*` override zůstává pro případ, že se něco změní mimo deploy.
 *
 * ⚠️ PŘED SPUŠTĚNÍM PLATEB vyplň `PLACEHOLDER` hodnoty. Dokud tam jsou,
 * `legalIdentityGaps()` je vrátí a `scripts/check-legal-identity.ts` selže.
 */

/** Hodnota, která ještě není doplněná. Záměrně nevypadá jako reálný údaj. */
export const PLACEHOLDER = "DOPLNIT" as const

/**
 * Základní sazba DPH v procentech.
 *
 * Jedno místo pro fakturaci (`lib/invoicing.ts`), ceník (`lib/pricing.ts`) i text
 * u ceny. Kdyby se sazba psala zvlášť na třech místech, po první změně zákona by
 * dvě z nich lhala — a jedna z nich je doklad.
 */
export const VAT_RATE_PCT = 21

/**
 * Odkdy se DPH připočítává k PROBÍHAJÍCÍM předplatným.
 *
 * Nový zákazník vidí v ceníku „bez DPH" a rovnou platí částku s daní. Kdo si ale
 * předplatné pořídil za starých podmínek (neplátce, cena byla konečná), tomu se
 * cena nesmí zvednout ze dne na den: vlastní obchodní podmínky slibují u změny
 * ceny upozornění předem (a u změny podmínek 14 dní). Do tohohle data se proto
 * obnovy strhávají v původní výši.
 *
 * ⚠️ Datum musí sedět s `EFFECTIVE_FROM` v `app/terms/page.tsx`. Hlídá aserce.
 */
export const VAT_EFFECTIVE_FROM = "2026-09-23"

export type VatStatus =
    /** Neplátce DPH — ceny jsou konečné, na faktuře „Nejsem plátce DPH". */
    | "none"
    /** Identifikovaná osoba — pořád fakturuje bez DPH, ale má DIČ a odvádí DPH z nákupů ze zahraničí. */
    | "identified"
    /** Plátce DPH — na faktuře se rozpadá základ + DPH. */
    | "payer"

export interface LegalIdentity {
    /** Jméno podnikatele tak, jak je v živnostenském rejstříku. */
    name: string
    /** Volitelný obchodní název / značka. */
    tradeName: string
    ico: string
    /** DIČ. Neplátce ho nemá; identifikovaná osoba a plátce ano (CZ + rodné číslo/IČO). */
    dic: string
    vatStatus: VatStatus
    street: string
    city: string
    zip: string
    /** ISO 3166-1 alpha-2 — Fakturoid i faktury ho chtějí takto. */
    countryCode: string
    country: string
    email: string
    phone: string
    /**
     * Zápis v rejstříku — povinný identifikační údaj (§ 435 obč. zák.).
     *
     * U s.r.o. je to obchodní rejstřík včetně soudu a spisové značky, u OSVČ
     * živnostenský rejstřík a úřad, který živnost vydal. Je to jedna volná věta,
     * protože právní forma rozhoduje o tom, co v ní stojí — dvě pole by nutila
     * každou stránku větvit podle formy.
     */
    registration: string
    /** Bankovní účet pro faktury (i když se platí kartou, patří na doklad). */
    bankAccount: string
    iban: string
    website: string
}

/**
 * Přepisy z env.
 *
 * Musí to být **doslovné** výskyty `process.env.NEXT_PUBLIC_…`. Bundler je do
 * klientského balíku vkládá textovou náhradou, takže dynamický `process.env[key]`
 * se na klientu vyhodnotí jako `undefined` a vyhraje fallback.
 *
 * Než tohle vzniklo, byl přepis tichý lhář: na serveru se propsal, po hydrataci
 * zmizel. Patička na landingu (klientská komponenta) tak uměla tvrdit něco jiného
 * než obchodní podmínky (serverová) — a chybějící údaj vypadal jako nevyplněný,
 * ne jako rozbitý. Hlídá to aserce 14.9.
 */
const OVERRIDES: Record<string, string | undefined> = {
    NEXT_PUBLIC_BUSINESS_NAME: process.env.NEXT_PUBLIC_BUSINESS_NAME,
    NEXT_PUBLIC_BUSINESS_TRADE_NAME: process.env.NEXT_PUBLIC_BUSINESS_TRADE_NAME,
    NEXT_PUBLIC_BUSINESS_ICO: process.env.NEXT_PUBLIC_BUSINESS_ICO,
    NEXT_PUBLIC_BUSINESS_DIC: process.env.NEXT_PUBLIC_BUSINESS_DIC,
    NEXT_PUBLIC_BUSINESS_VAT_STATUS: process.env.NEXT_PUBLIC_BUSINESS_VAT_STATUS,
    NEXT_PUBLIC_BUSINESS_STREET: process.env.NEXT_PUBLIC_BUSINESS_STREET,
    NEXT_PUBLIC_BUSINESS_CITY: process.env.NEXT_PUBLIC_BUSINESS_CITY,
    NEXT_PUBLIC_BUSINESS_ZIP: process.env.NEXT_PUBLIC_BUSINESS_ZIP,
    NEXT_PUBLIC_BUSINESS_COUNTRY_CODE: process.env.NEXT_PUBLIC_BUSINESS_COUNTRY_CODE,
    NEXT_PUBLIC_BUSINESS_COUNTRY: process.env.NEXT_PUBLIC_BUSINESS_COUNTRY,
    NEXT_PUBLIC_BUSINESS_EMAIL: process.env.NEXT_PUBLIC_BUSINESS_EMAIL,
    NEXT_PUBLIC_BUSINESS_PHONE: process.env.NEXT_PUBLIC_BUSINESS_PHONE,
    NEXT_PUBLIC_BUSINESS_REGISTRATION: process.env.NEXT_PUBLIC_BUSINESS_REGISTRATION,
    NEXT_PUBLIC_BUSINESS_BANK_ACCOUNT: process.env.NEXT_PUBLIC_BUSINESS_BANK_ACCOUNT,
    NEXT_PUBLIC_BUSINESS_IBAN: process.env.NEXT_PUBLIC_BUSINESS_IBAN,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
}

const env = (key: keyof typeof OVERRIDES, fallback: string): string => {
    const v = OVERRIDES[key]
    return v && v.trim() ? v.trim() : fallback
}

/**
 * Výchozí hodnoty převzaté z ARESu (registr ekonomických subjektů + veřejný
 * rejstřík), IČO 27165281, ověřeno 8. 9. 2026.
 *
 * Od 9/2026 službu provozuje **DOT PRODUCTION s.r.o.** (do té doby OSVČ Adela
 * Mužátková, IČO 21263990, neplátce DPH). Změna se propisuje odsud do obchodních
 * podmínek, zásad zpracování, patičky, faktur i e-mailů — proto ten jediný zdroj
 * pravdy existuje.
 *
 * Dva důsledky, které nejsou jen kosmetika:
 *  - **plátce DPH** (`dic` v ARESu → `vatStatus: "payer"`): ceny se uvádějí bez
 *    DPH, doklad ji rozpadá a brána strhává částku včetně daně;
 *  - **s.r.o. místo OSVČ**: povinný údaj není živnostenský úřad, ale zápis
 *    v obchodním rejstříku se soudem a spisovou značkou (`registration`).
 *
 * Telefon a e-mail v ARESu nejsou — jsou to provozní kontakty, které obchodní
 * podmínky vykreslují jako povinný údaj a musí být dohledatelné v čase.
 *
 * ⚠️ `name` je ve tvaru, v jakém je subjekt **zapsaný v rejstříku** (velké
 * „PRODUCTION"). Na faktuře a v podmínkách musí být název shodný se zápisem.
 */
export const LEGAL: LegalIdentity = {
    name: env("NEXT_PUBLIC_BUSINESS_NAME", "DOT PRODUCTION s.r.o."),
    tradeName: env("NEXT_PUBLIC_BUSINESS_TRADE_NAME", "Chrlit"),
    ico: env("NEXT_PUBLIC_BUSINESS_ICO", "27165281"),
    dic: env("NEXT_PUBLIC_BUSINESS_DIC", "CZ27165281"),
    vatStatus: env("NEXT_PUBLIC_BUSINESS_VAT_STATUS", "payer") as VatStatus,
    street: env("NEXT_PUBLIC_BUSINESS_STREET", "Hartigova 426/35"),
    // Žižkov je část obce, Praha 3 městská část — na doklad patří obojí, ale
    // `city` drží to, co jde do adresního řádku faktury a Fakturoidu.
    city: env("NEXT_PUBLIC_BUSINESS_CITY", "Praha 3"),
    zip: env("NEXT_PUBLIC_BUSINESS_ZIP", "130 00"),
    countryCode: env("NEXT_PUBLIC_BUSINESS_COUNTRY_CODE", "CZ"),
    country: env("NEXT_PUBLIC_BUSINESS_COUNTRY", "Česká republika"),
    email: env("NEXT_PUBLIC_BUSINESS_EMAIL", "info@chrlit.cz"),
    phone: env("NEXT_PUBLIC_BUSINESS_PHONE", "+420 601 279 377"),
    registration: env(
        "NEXT_PUBLIC_BUSINESS_REGISTRATION",
        "zapsaná v obchodním rejstříku vedeném Městským soudem v Praze, oddíl C, vložka 101257",
    ),
    bankAccount: env("NEXT_PUBLIC_BUSINESS_BANK_ACCOUNT", PLACEHOLDER),
    iban: env("NEXT_PUBLIC_BUSINESS_IBAN", ""),
    website: env("NEXT_PUBLIC_SITE_URL", "https://chrlit.cz"),
}

/**
 * Kdo službu poskytoval předtím.
 *
 * Není to nostalgie: přechodné ustanovení obchodních podmínek musí říct, podle
 * jakého znění a pod kým se plnilo do dne účinnosti změny — a údaj o dřívějším
 * poskytovateli patří ke zbytku identity, ne natvrdo do JSX (aserce 14.1).
 */
export const PREVIOUS_PROVIDER = {
    name: "Adela Mužátková",
    ico: "21263990",
    vatStatus: "none" as VatStatus,
    until: "2026-09-22",
} as const

/** Věta o dřívějším poskytovateli do přechodného ustanovení. */
export function previousProviderLine(): string {
    return `${PREVIOUS_PROVIDER.name}, IČO ${PREVIOUS_PROVIDER.ico} (neplátce DPH)`
}

/** „Ulice, PSČ Město" na jeden řádek — do patičky a na fakturu. */
export function formatAddress(id: LegalIdentity = LEGAL): string {
    return `${id.street}, ${id.zip} ${id.city}`
}

/** Celá identifikace do jednoho odstavce — používají obchodní podmínky. */
export function formatIdentityLine(id: LegalIdentity = LEGAL): string {
    const parts = [id.name, `IČO ${id.ico}`]
    if (id.dic) parts.push(`DIČ ${id.dic}`)
    parts.push(formatAddress(id))
    return parts.join(", ")
}

/**
 * Věta o DPH na fakturu i do ceníku. Právně povinná u neplátce, který by jinak
 * vypadal, že DPH mlčky zatajil.
 */
export function vatNotice(id: LegalIdentity = LEGAL): string {
    switch (id.vatStatus) {
        case "payer":
            return `Ceny jsou uvedeny bez DPH. K ceně se připočítává DPH ${VAT_RATE_PCT} %.`
        case "identified":
            return "Nejsem plátce DPH (identifikovaná osoba dle zákona o DPH). Uvedené ceny jsou konečné."
        default:
            return "Nejsem plátce DPH. Uvedené ceny jsou konečné."
    }
}

/**
 * Vrátí seznam nevyplněných povinných údajů. Prázdné pole = identita je
 * kompletní a smí se spustit prodej. Volá `scripts/check-legal-identity.ts`
 * a launch checklist.
 */
export function legalIdentityGaps(id: LegalIdentity = LEGAL): string[] {
    // Bankovní účet ZÁMĚRNĚ není povinný: platby jdou kartou přes bránu a doklad
    // se vystavuje už jako zaplacený, takže platební instrukce na něm nemá co
    // dělat. Blokovat kvůli němu spuštění prodeje byla falešná překážka —
    // hlídá ho `compliance-calendar` jako „až bude čas", ne jako bránu.
    const required: Array<[keyof LegalIdentity, string]> = [
        ["name", "jméno podnikatele"],
        ["ico", "IČO"],
        ["street", "ulice a číslo popisné"],
        ["city", "město"],
        ["zip", "PSČ"],
        ["registration", "zápis v rejstříku (soud a spisová značka)"],
        ["email", "kontaktní e-mail"],
    ]
    const gaps = required
        .filter(([key]) => {
            const value = id[key]
            return typeof value !== "string" || !value.trim() || value === PLACEHOLDER
        })
        .map(([, label]) => label)

    // Identifikovaná osoba i plátce musí mít DIČ — bez něj nelze vystavit
    // správný doklad ani uplatnit reverse charge u nákupů ze zahraničí.
    if (id.vatStatus !== "none" && !id.dic.trim()) gaps.push("DIČ")

    return gaps
}

/** Dozorový orgán pro spotřebitelské spory — povinná informace u B2C. */
export const CONSUMER_AUTHORITY = {
    name: "Česká obchodní inspekce",
    department: "Oddělení ADR (mimosoudní řešení spotřebitelských sporů)",
    address: "Štěpánská 796/44, 110 00 Praha 1",
    web: "https://www.coi.cz",
    adrWeb: "https://adr.coi.cz",
    email: "adr@coi.cz",
} as const

/** Dozor nad ochranou osobních údajů. */
export const DATA_AUTHORITY = {
    name: "Úřad pro ochranu osobních údajů",
    address: "Pplk. Sochora 27, 170 00 Praha 7",
    web: "https://www.uoou.cz",
} as const

/**
 * Zpracovatelé osobních údajů — musí sedět s realitou, jinak jsou zásady
 * ochrany údajů nepravdivé. Když přibude dodavatel, přibude řádek i tady.
 */
export const SUBPROCESSORS: ReadonlyArray<{
    name: string
    purpose: string
    location: string
}> = [
    { name: "Supabase, Inc.", purpose: "databáze, autentizace a úložiště souborů", location: "EU (Frankfurt)" },
    { name: "Vercel, Inc.", purpose: "hosting aplikace a doručování obsahu", location: "USA / EU" },
    { name: "Google Ireland Ltd. (Gemini API)", purpose: "generování textů, obrázků a videí", location: "EU / USA" },
    { name: "Anthropic PBC", purpose: "kontrola kvality generovaného obsahu", location: "USA" },
    { name: "ComGate Payments, a.s.", purpose: "zpracování plateb", location: "Česká republika" },
    // Druhá platební brána. Uvedená i tehdy, když zrovna neběží: `activeGateway()`
    // na ni umí přepnout pouhou změnou env proměnné, a mlčet o zpracovateli,
    // který může kdykoli dostat data zákazníka, je porušení informační povinnosti.
    { name: "Stripe Payments Europe, Ltd.", purpose: "zpracování plateb a opakovaných plateb", location: "Irsko / USA" },
    { name: "Resend, Inc.", purpose: "odesílání transakčních e-mailů", location: "EU / USA" },
    { name: "Fakturoid s.r.o.", purpose: "vystavování a archivace faktur", location: "Česká republika" },
    { name: "Meta Platforms Ireland Ltd.", purpose: "publikování na Instagram (jen při propojení účtu)", location: "EU / USA" },
    // Most pro publikaci na cizí profily, dokud neprojde 2. App Review u Mety.
    // Uvedený stejnou logikou jako druhá platební brána výš: `publishTransport`
    // na něj umí přepnout změnou env proměnné, a při propojení mu projde jak
    // přístup k účtu zákazníka, tak jeho obsah a čísla o výkonu. Mlčet o něm by
    // bylo porušení informační povinnosti.
    { name: "Upload-Post LLC", purpose: "publikování na Instagram a čtení statistik příspěvků (jen při propojení účtu přes tuto cestu)", location: "USA" },
] as const
