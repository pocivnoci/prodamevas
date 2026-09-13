/**
 * Slovník financí firmy — druhy záznamů, typy nákladů, whitelist sloupců.
 *
 * Bydlí mimo `app/actions/finance-actions.ts` ze stejného tvrdého důvodu jako
 * `lib/leads.ts`: soubor s `"use server"` smí exportovat **jenom async funkce**.
 * Konstanta vedle nich projde `tsc` i buildem a shodí se až při vyhodnocení
 * modulu, tedy na produkci. Číselník je data, ne akce.
 */

/** Náklad, nebo vklad. Znaménko nese druh, nikdy částka. */
export const KINDS = ["naklad", "vklad"] as const
export type FinanceKind = typeof KINDS[number]

export const KIND_LABELS: Record<string, string> = {
    naklad: "Náklad",
    vklad: "Vklad",
}

/**
 * Fixní = platí se, i když firma měsíc nic neudělá (nájem, předplatné nástrojů).
 * Variabilní = váže se na provoz (modely, tisk, kampaň).
 */
export const COST_TYPES = ["fixni", "variabilni"] as const
export type CostType = typeof COST_TYPES[number]

export const COST_TYPE_LABELS: Record<string, string> = {
    fixni: "Fixní",
    variabilni: "Variabilní",
}

/**
 * Sloupce, které vlastní formulář. Cokoliv mimo seznam se z patche zahodí —
 * `created_by` ani razítka do formuláře nepatří, i kdyby je tam někdo poslal.
 *
 * `kind` v seznamu schválně NENÍ: přepnutí nákladu na vklad by muselo zároveň
 * vynulovat `cost_type`, jinak to neprojde databázovým constraintem. Špatný
 * druh se opraví smazáním a novým řádkem — evidence o třech polích je levnější
 * přepsat než migrovat.
 */
export const EDITABLE = [
    "cost_type", "amount_czk", "label", "person", "happened_on", "note",
] as const
export type FinancePatch = Partial<Record<typeof EDITABLE[number], string | number | null>>

export interface FinanceEntry {
    id: string
    kind: string
    cost_type: string | null
    amount_czk: number
    label: string
    person: string
    happened_on: string
    note: string | null
    created_at: string
    updated_at: string
    created_by: string | null
    updated_by: string | null
}

/** Součty, které obrazovka ukazuje nad tabulkou. Evidence, ne report. */
export interface FinanceTotals {
    fixni: number
    variabilni: number
    vklady: number
    /** Vklady minus všechny náklady — kolik z vložených peněz zbývá. */
    zustatek: number
}

/**
 * Částka z databáze. PostgREST vrací `numeric` jako číslo, ale u větších hodnot
 * i jako řetězec — a `"1200" + 300` je v JS `"1200300"`, tedy tichý nesmysl
 * přesně tam, kde jde o peníze.
 */
export function toAmount(value: unknown): number {
    const n = typeof value === "number" ? value : Number(value)
    return Number.isFinite(n) ? n : 0
}

/** Součty nad už načtenými řádky — jedna pravda pro server i obrazovku. */
export function sumEntries(entries: FinanceEntry[]): FinanceTotals {
    let fixni = 0, variabilni = 0, vklady = 0
    for (const e of entries) {
        const amount = toAmount(e.amount_czk)
        if (e.kind === "vklad") vklady += amount
        else if (e.cost_type === "fixni") fixni += amount
        else variabilni += amount
    }
    return { fixni, variabilni, vklady, zustatek: vklady - fixni - variabilni }
}

/**
 * Částka do UI — „12 300 Kč", ne „12300".
 *
 * Haléře se ukazují jen když nějaké jsou, ale pak vždycky obě místa: „250,5 Kč"
 * vypadá jako překlep, „250,50 Kč" jako peníze.
 */
export function formatCzk(amount: number): string {
    const mista = Number.isInteger(amount) ? 0 : 2
    return new Intl.NumberFormat("cs-CZ", {
        style: "currency",
        currency: "CZK",
        minimumFractionDigits: mista,
        maximumFractionDigits: mista,
    }).format(amount)
}

/**
 * Částka z formuláře. Člověk píše „1 200", „1200,50" i „1.200" — všechno jsou
 * koruny. Vrací `null`, když z toho kladné číslo nevyjde; volající pak odmítne
 * zápis místo toho, aby uložil nulu.
 */
export function parseAmount(raw: string): number | null {
    const bez = raw
        .replace(/[\s ]/g, "")   // mezery i nezlomitelné, jak je vloží tabulka
        .replace(/[Kk]č$/u, "")

    // Čárka je v češtině desetinná — je-li tam, jsou všechny tečky tisícové.
    const normalized = bez.includes(",")
        ? bez.replace(/\./g, "").replace(",", ".")
        : bez

    // Bez čárky je tečka dvojznačná: „1.200" jsou tisíce, „1200.50" haléře.
    // Tisícová je jen tehdy, když tvoří celý řetězec po trojicích.
    const cleaned = /^\d{1,3}(\.\d{3})+$/.test(normalized)
        ? normalized.replace(/\./g, "")
        : normalized

    const n = Number(cleaned)
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}
