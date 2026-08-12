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
    /** Živnostenský úřad, který živnost vydal — povinný údaj u OSVČ (§435 obč. zák.). */
    registryOffice: string
    /** Bankovní účet pro faktury (i když se platí kartou, patří na doklad). */
    bankAccount: string
    iban: string
    website: string
}

const env = (key: string, fallback: string): string => {
    const v = process.env[key]
    return v && v.trim() ? v.trim() : fallback
}

/**
 * Výchozí hodnoty převzaté z ARESu (registr ekonomických subjektů + RZP),
 * IČO 21263990, ověřeno 30. 7. 2026. Živnost vznikla 19. 2. 2024, živnost volná,
 * bez registrace k DPH (`dic: null` v ARESu → `vatStatus: "none"`).
 *
 * ⚠️ `name` je záměrně ve tvaru, v jakém je subjekt **zapsaný v rejstříku**
 * („Adela", bez délky) — na faktuře a v obchodních podmínkách musí být jméno
 * shodné se zápisem, ne fonetická podoba. Pokud je v rejstříku překlep, opravuje
 * se na živnostenském úřadě a teprve pak tady.
 */
export const LEGAL: LegalIdentity = {
    name: env("NEXT_PUBLIC_BUSINESS_NAME", "Adela Mužátková"),
    tradeName: env("NEXT_PUBLIC_BUSINESS_TRADE_NAME", "Chrlit"),
    ico: env("NEXT_PUBLIC_BUSINESS_ICO", "21263990"),
    dic: env("NEXT_PUBLIC_BUSINESS_DIC", ""),
    vatStatus: env("NEXT_PUBLIC_BUSINESS_VAT_STATUS", "none") as VatStatus,
    street: env("NEXT_PUBLIC_BUSINESS_STREET", "Svitákova 2729/10"),
    city: env("NEXT_PUBLIC_BUSINESS_CITY", "Praha 5"),
    zip: env("NEXT_PUBLIC_BUSINESS_ZIP", "155 00"),
    countryCode: env("NEXT_PUBLIC_BUSINESS_COUNTRY_CODE", "CZ"),
    country: env("NEXT_PUBLIC_BUSINESS_COUNTRY", "Česká republika"),
    email: env("NEXT_PUBLIC_BUSINESS_EMAIL", "info@chrlit.cz"),
    phone: env("NEXT_PUBLIC_BUSINESS_PHONE", ""),
    // Sídlo je ve Stodůlkách → správní obvod Praha 13. ARES uvádí u adresy
    // „Praha 5", což je městský obvod (poštovní/soudní), ne městská část.
    registryOffice: env("NEXT_PUBLIC_BUSINESS_REGISTRY_OFFICE", "Úřad městské části Praha 13"),
    bankAccount: env("NEXT_PUBLIC_BUSINESS_BANK_ACCOUNT", PLACEHOLDER),
    iban: env("NEXT_PUBLIC_BUSINESS_IBAN", ""),
    website: env("NEXT_PUBLIC_SITE_URL", "https://chrlit.cz"),
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
            return "Ceny jsou uvedeny bez DPH. K ceně bude připočtena DPH v zákonné sazbě."
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
        ["registryOffice", "živnostenský úřad"],
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
] as const
