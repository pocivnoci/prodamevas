/**
 * Ceník — jediný zdroj pravdy o obdobích a o tom, jak se z měsíční ceny počítá
 * cena za období.
 * =========================================================================
 * Čistý modul: **žádná DB, žádné `server-only`**. Importuje ho landing (klient),
 * dashboard (klient), platební routy i cron obnovy — a všichni musí dostat
 * stejné číslo. Kdyby cena za rok žila zvlášť v Reactu a zvlášť v cronu,
 * zákazník uvidí jednu a strhne se mu druhá.
 *
 * Dělba práce s databází:
 *   `subscription_plans.price_czk` = MĚSÍČNÍ cena tarifu (haléře). Peníze patří do DB.
 *   `BILLING_TERMS` tady            = kolik měsíců se platí za jaké období. Pravidlo patří do kódu.
 *
 * Tarif se tím nezdvojuje na 16 řádků: úroveň služby (kredity, formáty) je tarif,
 * délka zaplaceného období je vlastnost PŘEDPLATNÉHO (`subscriptions.term_months`).
 */

// ─── Období ──────────────────────────────────────────────────────────────────

export type TermMonths = 1 | 3 | 6 | 12

export interface BillingTerm {
    months: TermMonths
    /**
     * Kolik měsíců zákazník ve skutečnosti zaplatí, ×100 (celočíselně, aby se
     * cena nikdy nepočítala v plovoucí čárce).
     *   3 měsíce → 2,85 měsíce (−5 %)
     *   6 měsíců → 5,4 měsíce  (−10 %)
     *  12 měsíců → 10 měsíců   (−16,7 %, „2 měsíce zdarma")
     */
    payMonthsX100: number
    /** Popisek v přepínači. */
    label: string
    /** Krátký tvar do vět („platíte ~"). */
    shortLabel: string
    /** Štítek úspory. `null` = měsíční, žádná úspora se neslibuje. */
    badge: string | null
    /** Věta pod cenou na kartě. */
    note: string
}

/**
 * Žebřík je záměrně monotónní a končí kulatým číslem: roční cena je PŘESNĚ
 * desetinásobek měsíční, takže si ji zákazník ověří z hlavy. „2 měsíce zdarma"
 * je konkrétní slib, „16,7 % sleva" je abstrakce.
 */
export const BILLING_TERMS: readonly BillingTerm[] = [
    {
        months: 1,
        payMonthsX100: 100,
        label: "Měsíčně",
        shortLabel: "měsíčně",
        badge: null,
        note: "bez závazku · zrušit kdykoliv",
    },
    {
        months: 3,
        payMonthsX100: 285,
        label: "3 měsíce",
        shortLabel: "na 3 měsíce",
        badge: "−5 %",
        note: "zaplatíte jednou na čtvrt roku",
    },
    {
        months: 6,
        payMonthsX100: 540,
        label: "6 měsíců",
        shortLabel: "na 6 měsíců",
        badge: "−10 %",
        note: "zaplatíte jednou na půl roku",
    },
    {
        months: 12,
        payMonthsX100: 1000,
        label: "12 měsíců",
        shortLabel: "na 12 měsíců",
        badge: "2 měsíce zdarma",
        note: "cena zamčená na celý rok",
    },
] as const

/** Období, které je na ceníku předvybrané. */
export const DEFAULT_TERM_MONTHS: TermMonths = 12

export function getTerm(months: TermMonths): BillingTerm {
    const term = BILLING_TERMS.find((t) => t.months === months)
    if (!term) throw new Error(`Neznámé období: ${months}`)
    return term
}

/**
 * Nikdy nevěřit vstupu z klienta ani z DB — cokoliv jiného než 3/6/12 je měsíc.
 * Stejná obrana jako `normalizeInterval` v `lib/billing-period.ts`: špatná
 * hodnota nesmí vyrobit období, které nikdo nezaplatil.
 */
export function normalizeTermMonths(raw: unknown): TermMonths {
    const n = typeof raw === "string" ? parseInt(raw, 10) : typeof raw === "number" ? raw : NaN
    return n === 3 || n === 6 || n === 12 ? n : 1
}

/**
 * Cena celého období v haléřích.
 *
 * Zaokrouhluje se **dolů na celých 10 Kč** — skutečná sleva je proto vždy
 * ≥ inzerovaná, nikdy naopak. Celočíselná aritmetika až do jediného dělení,
 * aby 990 × 2,85 nevyšlo jako 2821,4999999.
 */
export function termPrice(monthlyHaleru: number, months: TermMonths): number {
    const { payMonthsX100 } = getTerm(months)
    return Math.floor((monthlyHaleru * payMonthsX100) / 100_000) * 1000
}

/** Kolik to vychází na měsíc — číslo, které je na kartě velkým písmem. */
export function monthlyEquivalent(monthlyHaleru: number, months: TermMonths): number {
    return Math.round(termPrice(monthlyHaleru, months) / months)
}

/** Kolik zákazník ušetří proti měsíčnímu placení, v haléřích. */
export function termSavings(monthlyHaleru: number, months: TermMonths): number {
    return monthlyHaleru * months - termPrice(monthlyHaleru, months)
}

/** Sleva v procentech, zaokrouhlená dolů (nikdy neslibovat víc, než se dá). */
export function termSavingsPct(monthlyHaleru: number, months: TermMonths): number {
    if (months === 1) return 0
    return Math.floor((termSavings(monthlyHaleru, months) / (monthlyHaleru * months)) * 100)
}

/** „na 12 měsíců" — do popisku platby a na doklad. */
export function termLabel(months: TermMonths): string {
    return getTerm(months).shortLabel
}

/**
 * Období pro Stripe Billing. Stripe zvládne opakování delší než měsíc přes
 * `interval_count`, takže 3 i 6 měsíců jsou skutečná předplatná, ne jednorázovky.
 */
export function stripeRecurring(months: TermMonths): { interval: "month" | "year"; interval_count: number } {
    return months === 12 ? { interval: "year", interval_count: 1 } : { interval: "month", interval_count: months }
}

// ─── Formátování ─────────────────────────────────────────────────────────────

/** „19 900 Kč" — haléře na české zobrazení. Jediné místo, kde se dělí stem. */
export function formatCzk(haleru: number): string {
    return `${Math.round(haleru / 100).toLocaleString("cs-CZ")} Kč`
}

/** „19 900" bez měny — když je „Kč" ve vlastním elementu (karty ceníku). */
export function formatCzkAmount(haleru: number): string {
    return Math.round(haleru / 100).toLocaleString("cs-CZ")
}

// ─── Marketingová kopie tarifů ───────────────────────────────────────────────

export interface PlanCopy {
    tagline: string
    /** Odrážky na landingu. Kredity a limity se dopisují z DB `features`. */
    bullets: string[]
    highlight?: boolean
}

/**
 * Kopie, ne ceny. Ceny a kredity chodí z `subscription_plans` — tady je jenom to,
 * co se do JSONB sloupce nevejde a co se ladí podle toho, jak se prodává.
 */
export const PLAN_COPY: Record<string, PlanCopy> = {
    chrlit_start: {
        tagline: "Nakopni profil",
        bullets: ["Až 20 příspěvků (~4–5 týdně)", "Unikátní AI obrázky", "Carousel posty", "Nápady na obsah"],
    },
    chrlit_rust: {
        tagline: "Rosteme spolu",
        bullets: ["Obsah na každý den", "Reels — AI video", "A/B varianty příspěvků", "Sledování růstu followerů"],
        highlight: true,
    },
    chrlit_dominance: {
        tagline: "Ovládni svůj trh",
        bullets: ["Maximum obsahu vč. reels", "Produktové vizualizace", "Prioritní generování"],
    },
    chrlit_imperium: {
        tagline: "Postav impérium",
        bullets: ["Plný objem pro agentury a e-shopy", "Vše z Dominance", "Nejvyšší priorita ve frontě"],
    },
}

// ─── Záloha ceníku ───────────────────────────────────────────────────────────

export interface PricingPlan {
    id: string
    name: string
    /** MĚSÍČNÍ cena v haléřích. */
    monthlyHaleru: number
    creditsPerMonth: number
}

/**
 * Statická kopie ceníku v5 pro případ, že se landingu nepodaří přečíst DB.
 * Prázdná sekce s cenami je na marketingové stránce horší než vteřinu stará cena.
 *
 * Aserce v `npm run guard` porovnává tahle čísla s migrací
 * `20260716_pricing_v5.sql` — dvě pravdy o ceně jsou tu jen do té chvíle, než se
 * rozejdou, a tohle je ta chvíle, kdy to spadne v testu, ne u zákazníka.
 */
export const FALLBACK_PLANS: readonly PricingPlan[] = [
    { id: "chrlit_start", name: "Start", monthlyHaleru: 99000, creditsPerMonth: 20 },
    { id: "chrlit_rust", name: "Růst", monthlyHaleru: 199000, creditsPerMonth: 45 },
    { id: "chrlit_dominance", name: "Dominance", monthlyHaleru: 399000, creditsPerMonth: 100 },
    { id: "chrlit_imperium", name: "Impérium", monthlyHaleru: 799000, creditsPerMonth: 220 },
] as const

/**
 * Nejnižší měsíční cena, jakou jde na Chrlitu dosáhnout — hero, meta popisek
 * i obchodní e-maily z ní berou „od X Kč měsíčně", aby se to nemuselo hlídat
 * na čtyřech místech ručně.
 */
export const LOWEST_MONTHLY_HALERU = monthlyEquivalent(FALLBACK_PLANS[0].monthlyHaleru, DEFAULT_TERM_MONTHS)

/** „od 825 Kč měsíčně při roční platbě" */
export function lowestPriceClaim(): string {
    return `od ${formatCzk(LOWEST_MONTHLY_HALERU)} měsíčně při roční platbě`
}

// ─── Nastavení značky na míru (vstupní konzultace) ───────────────────────────

/**
 * Jednorázová služba, ne tarif.
 *
 * Cena je záměrně shodná s měsícem Startu — číslo, které si člověk okamžitě
 * přepočítá. Neúčtuje se kvůli tržbě: **je to filtr proti neúčasti.** Bezplatné
 * schůzky u neznámé značky má docházku kolem poloviny, zaplacené se blíží stovce.
 *
 * Prodává se výstup, ne rada: ze schůzky odchází nastavený profil a první měsíc
 * obsahu. Účtovat si za „konzultaci" před nákupem je obchodní hovor za peníze;
 * účtovat si za nastavení je služba.
 */
export const CONSULTATION = {
    id: "nastaveni-znacky",
    name: "Nastavení značky na míru",
    priceHaleru: 99000,
    durationMinutes: 30,
    /**
     * Období, ke kterým se dodává v ceně. Delší závazek tím dostane důvod navíc,
     * aniž se sáhne na slevu — marginální náklad je půlhodina, ne marže.
     */
    includedWithTerms: [6, 12] as readonly number[],
} as const

/** Dostane zákazník nastavení k tomuhle období zdarma? */
export function consultationIncluded(termMonths: number): boolean {
    return CONSULTATION.includedWithTerms.includes(termMonths)
}

// ─── Dobití kreditů ──────────────────────────────────────────────────────────

/**
 * Cena jednoho dokoupeného kreditu.
 *
 * Záměrně **bez množstevní slevy**: 49 Kč odpovídá ceně kreditu v nejlevnějším
 * tarifu, takže dokupování nikdy nevyjde líp než přejít o tarif výš. Sleva na
 * velkém balíčku by tenhle žebřík obrátila a lidi by zůstávali na Startu
 * a dokupovali — s horší marží pro nás i horší cenou pro ně.
 *
 * Jediná pravda o ceně je `features.extra_credit_price` v tarifu; tohle je
 * záloha pro případ, že tarif hodnotu nenese (legacy řádky).
 */
export const EXTRA_CREDIT_HALERU = 4900

/** Velikosti balíčků. Tři stačí — víc voleb v okamžiku zablokování zdržuje. */
export const CREDIT_PACKS = [10, 25, 50] as const
export type CreditPack = (typeof CREDIT_PACKS)[number]

/** Prefix id, pod kterým se balíček kupuje: `kredity-25`. */
export const CREDIT_PACK_PREFIX = "kredity-"

/**
 * `"kredity-25"` → 25. Cokoliv jiného → `null`.
 *
 * Přípona se ověřuje na SAMÉ číslice, ne přes `parseInt`. Ten je shovívavý —
 * `parseInt("25; drop table")` vrátí 25 — a tiše by propustil podvržený `planId`
 * dál do kódu, který s ním pracuje jako s identifikátorem. Dnes by to neuškodilo,
 * ale je to přesně ta laxnost, ze které se stane díra při příštím použití.
 */
export function parseCreditPack(planId: unknown): CreditPack | null {
    if (typeof planId !== "string" || !planId.startsWith(CREDIT_PACK_PREFIX)) return null
    const suffix = planId.slice(CREDIT_PACK_PREFIX.length)
    if (!/^\d+$/.test(suffix)) return null
    const n = Number(suffix)
    return (CREDIT_PACKS as readonly number[]).includes(n) ? (n as CreditPack) : null
}

export function creditPackPrice(credits: number, unitHaleru = EXTRA_CREDIT_HALERU): number {
    return credits * unitHaleru
}
