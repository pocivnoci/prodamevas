/**
 * Tým Chrlitu — kdo je kdo a co komu typicky patří.
 *
 * **Role tady nejsou bezpečnostní hranice.** Do admin sekce pouští výhradně
 * `SUPER_ADMIN_EMAILS` (`lib/super-admins.ts`) a kdo se tam dostane, vidí i mění
 * všechno. Role slouží k přiřazování a filtrování úkolů; tvářit se u nich jako
 * oprávnění by byla dekorace, která by časem někoho zmátla k tomu, aby se na ni
 * spolehl.
 */

export type TeamRole = "founder" | "manager" | "investor"

export interface TeamMember {
    email: string
    name: string
    role: TeamRole
    active: boolean
}

/** Jak se role jmenují v UI. */
export const ROLE_LABELS: Record<TeamRole, string> = {
    founder: "Zakladatel",
    manager: "Obchod",
    investor: "Investor",
}

/**
 * Slova, podle kterých se pozná, čí je úkol.
 *
 * Tohle je jediná věc, kterou tabulka neuměla: v ní byl každý úkol ničí, takže se
 * ráno četl celý seznam a hledalo se v něm. Pravidla jsou schválně hloupá a čitelná —
 * model by na to byl dražší, pomalejší a u „zavolat Michalovi" by se stejně netrefil
 * líp než tenhle seznam.
 */
const ROLE_KEYWORDS: Record<Exclude<TeamRole, "investor">, string[]> = {
    // Obchod: lidi, schůzky, peníze, papíry.
    manager: [
        "volat", "zavolat", "telefon", "schůz", "schuz", "sejít", "sejit", "domluvit",
        "klient", "zákazník", "zakaznik", "lead", "nabídk", "nabidk", "smlouv",
        "faktur", "účet", "ucet", "banka", "revolut", "ičo", "ico", "dph",
        "prezentac", "leták", "letak", "reklam",
    ],
    // Produkt a kód.
    founder: [
        "appk", "aplikac", "web", "stránk", "strank", "kód", "kod", "deploy", "vercel",
        "databáz", "databaz", "api", "engine", "generov", "prompt", "model",
        "bug", "chyb", "oprav", "feature", "funkc", "instagram", "reels", "reel",
        "landing", "onboarding", "úprav", "uprav", "stran",
    ],
}

/** Bez diakritiky a malými — ať „schůzka" chytí i „schuzka". */
export function normalizeText(value: string): string {
    return value
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .trim()
}

/**
 * Komu úkol nejspíš patří — **návrh, ne rozhodnutí**.
 *
 * Volá se jen při zakládání úkolu ze syncu a jen když vlastník není vyplněný.
 * Ručně nastaveného vlastníka nesmí přepsat nikdy: člověk ví víc než seznam slov,
 * a úkol, který si někdo vzal, mu v úterý ráno nikdo brát nebude.
 *
 * Když si dvě role nárokují stejný text, vyhrává ta s víc trefami; při rovnosti
 * nikdo. Hádat je horší než nechat úkol viset jako nezadaný — nezadaný je vidět,
 * špatně přiřazený se ztratí v cizím sloupci.
 */
export function suggestRole(title: string, note?: string | null): TeamRole | null {
    const haystack = normalizeText(`${title} ${note ?? ""}`)
    const score = (words: string[]) => words.filter(w => haystack.includes(normalizeText(w))).length

    const manager = score(ROLE_KEYWORDS.manager)
    const founder = score(ROLE_KEYWORDS.founder)

    if (manager === 0 && founder === 0) return null
    if (manager === founder) return null
    return manager > founder ? "manager" : "founder"
}

/** První aktivní člen s danou rolí. Prázdný tým = nikdo, ne výjimka. */
export function memberForRole(team: TeamMember[], role: TeamRole | null): TeamMember | null {
    if (!role) return null
    return team.find(m => m.active && m.role === role) ?? null
}
