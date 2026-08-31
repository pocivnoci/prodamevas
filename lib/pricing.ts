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
 * Delší období se zaokrouhluje **dolů na celých 10 Kč** — skutečná sleva je proto
 * vždy ≥ inzerovaná, nikdy naopak. Celočíselná aritmetika až do jediného dělení,
 * aby 999 × 2,85 nevyšlo jako 2847,1499999.
 *
 * **Měsíc se ale nezaokrouhluje vůbec.** Není z čeho: žádná sleva se nepočítá,
 * takže by zaokrouhlení jen umazalo konec ceníkové ceny. Dokud ceny končily nulou,
 * nebylo to vidět; ceník v6 (999 · 2 999 · 4 999 · 8 999) by tím tiše účtoval
 * 990 · 2 990 · 4 990 · 8 990 — devět korun měsíčně pod tím, co je na kartě,
 * na dokladu i v databázi. Měsíční cena je vstup, ne výsledek výpočtu.
 */
export function termPrice(monthlyHaleru: number, months: TermMonths): number {
    if (months === 1) return monthlyHaleru
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

// ─── Priorita ve frontě ──────────────────────────────────────────────────────

/**
 * Stupně priority generování. Vyšší číslo jde z fronty dřív.
 *
 * Do 8/2026 to byl boolean a měl dvě vady najednou: nečetl ho nikdo (fronta jela
 * čistě FIFO, takže „Prioritní generování" byl placený slib bez implementace),
 * a i po implementaci by Dominance vyšla stejně jako Impérium — přestože Impérium
 * inzeruje „nejvyšší prioritu". Stupnice dělá z obou tvrzení pravdu.
 */
export const PRIORITY = { none: 0, high: 10, highest: 20 } as const

/**
 * Priorita tarifu jako číslo, ať už je v DB uložená jakkoliv.
 *
 * Legacy tarify (`pro`, `agency`, `business`…) pořád nesou `priority: true`.
 * Kdyby se `true` dostalo do `ORDER BY` nad integer sloupcem, fronta generování
 * by spadla — a to je poslední místo, které smí shodit marketingové pole.
 */
export function planPriority(features: { priority?: number | boolean | null } | null | undefined): number {
    const raw = features?.priority
    if (typeof raw === "number" && Number.isFinite(raw)) return raw
    return raw === true ? PRIORITY.high : PRIORITY.none
}

// ─── Marketingová kopie tarifů ───────────────────────────────────────────────

/**
 * Odrážka na kartě tarifu.
 *
 * `requiresReels` znamená „tohle platí, jen když jsou reels zapnuté". Reels mají
 * tvrdý vypínač (`REELS_ENABLED`), který `reel` potichu přepíše na `carousel` —
 * bez tohohle příznaku by ceník sliboval médium, které se nevyrobí. Ceník to proto
 * neřeší textem, ale stavem: odznak „připravujeme" zmizí sám ve chvíli, kdy se
 * vypínač zapne, a nikdo nemusí hlídat, že se změnila i marketingová věta.
 */
export type PlanBullet = string | { text: string; requiresReels: true }

export interface PlanCopy {
    tagline: string
    /** Odrážky na landingu. Kredity a limity se dopisují z DB `features`. */
    bullets: PlanBullet[]
    highlight?: boolean
}

/**
 * Kopie, ne ceny. Ceny a kredity chodí z `subscription_plans` — tady je jenom to,
 * co se do JSONB sloupce nevejde a co se ladí podle toho, jak se prodává.
 *
 * Čísla objemu tu schválně NEJSOU: kolik čeho se za kredity pořídí, dopisuje
 * `creditExample()` z reálných vah v `lib/credits.ts`. Dřív tu stálo „Až 20
 * příspěvků" vedle „Carousel posty" — jenže carousel stojí tři kredity, takže to
 * platilo jen pro samé obrázky. Objem patří k výpočtu, ne do marketingové věty.
 */
export const PLAN_COPY: Record<string, PlanCopy> = {
    chrlit_start: {
        tagline: "Nakopni profil",
        bullets: ["Unikátní AI obrázky", "Carousel posty", "Nápady na obsah"],
    },
    chrlit_rust: {
        tagline: "Rosteme spolu",
        bullets: [
            "Až na denní obsah",
            { text: "Reels — AI video", requiresReels: true },
            "A/B varianty příspěvků",
            "Sledování růstu followerů",
        ],
        highlight: true,
    },
    chrlit_dominance: {
        tagline: "Ovládni svůj trh",
        bullets: [
            { text: "Reels — AI video", requiresReels: true },
            "Produktové vizualizace a mockupy",
            "Prioritní generování",
        ],
    },
    chrlit_imperium: {
        // Dřív „Plný objem pro agentury a e-shopy" — jenže víceprofilovost nikdy
        // nebyla implementovaná ani vynucovaná (`max_projects` nečetl žádný kód),
        // takže agentura kupovala něco, co nedostala. Impérium je nejvyšší úroveň
        // pro JEDNU značku: největší objem a skutečně nejvyšší priorita ve frontě.
        tagline: "Postav impérium",
        bullets: ["Nejvyšší objem pro jednu značku", "Vše z Dominance", "Nejvyšší priorita ve frontě"],
    },
}

// ─── Záloha ceníku ───────────────────────────────────────────────────────────

export interface PricingPlan {
    id: string
    name: string
    /** MĚSÍČNÍ cena v haléřích. */
    monthlyHaleru: number
    creditsPerMonth: number
    /**
     * Umí tenhle tarif reels? Chodí z `features.allowed_media` v DB.
     *
     * Ceník bez toho počítal přepočet kreditů globálně a Startu nabízel „nebo
     * 4 reels", přestože Start reels v `allowed_media` nemá a engine mu je odmítne.
     * Vypínač `REELS_ENABLED` je otázka JINÁ — ten říká, jestli reels umí kdokoliv.
     * Nabídnout je smí jen tarif, kde platí obojí.
     */
    allowsReels: boolean
}

/**
 * Statická kopie ceníku v6 pro případ, že se landingu nepodaří přečíst DB.
 * Prázdná sekce s cenami je na marketingové stránce horší než vteřinu stará cena.
 *
 * Aserce v `npm run guard` porovnává tahle čísla s migrací
 * `20260901_pricing_v6.sql` — dvě pravdy o ceně jsou tu jen do té chvíle, než se
 * rozejdou, a tohle je ta chvíle, kdy to spadne v testu, ne u zákazníka.
 */
export const FALLBACK_PLANS: readonly PricingPlan[] = [
    { id: "chrlit_start", name: "Start", monthlyHaleru: 99900, creditsPerMonth: 20, allowsReels: false },
    { id: "chrlit_rust", name: "Růst", monthlyHaleru: 299900, creditsPerMonth: 45, allowsReels: true },
    { id: "chrlit_dominance", name: "Dominance", monthlyHaleru: 499900, creditsPerMonth: 100, allowsReels: true },
    { id: "chrlit_imperium", name: "Impérium", monthlyHaleru: 899900, creditsPerMonth: 220, allowsReels: true },
] as const

/**
 * Nejnižší měsíční cena, jakou jde na Chrlitu dosáhnout — hero, meta popisek
 * i obchodní e-maily z ní berou „od X Kč měsíčně", aby se to nemuselo hlídat
 * na čtyřech místech ručně.
 */
export const LOWEST_MONTHLY_HALERU = monthlyEquivalent(FALLBACK_PLANS[0].monthlyHaleru, DEFAULT_TERM_MONTHS)

/** „od 833 Kč měsíčně při roční platbě" */
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
    priceHaleru: 99900,
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
 * ⚠️ Ceník v6 ten žebřík porušil, a ne tudy: Růst vyšel na 66,6 Kč/kredit (2 999
 * za 45), zatímco Start dává 50,0 a dokoupení stojí 49. Zákazníkovi na Startu se
 * teď vyplatí dokupovat místo přechodu na Růst. Narovnat to jde jen kredity
 * (Růst by potřeboval ~70), což je cenové rozhodnutí majitele, ne oprava kódu —
 * proto to tu stojí napsané, dokud nepadne.
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
