/**
 * Oborový profil rizika — obory, kde nepodložené tvrzení stojí víc než nudný post.
 * ==============================================================================
 * Jediný zdroj pravdy o tom, KTERÉ obory jsou rizikové a PROČ. Čte ho showcase
 * (ukázkový feed pro cizí značku musí mít `guardrails`) i faktická brána
 * (`instagram/fact-check.ts` přitvrdí prompt podle rodiny). Dvě kopie téhož
 * seznamu by se rozešly — a rozejít se smí leda tak, že jedna zapomene na
 * stavebnictví, což je přesně případ, kvůli kterému tenhle modul vznikl.
 *
 * Tři rodiny, každá s vlastním důvodem:
 *  • finance — precedens commitu 2ba162e6: portfolio AGRO INVEST nešlo na web,
 *    protože posty nesly „8% zhodnocení", „garanci odkupu" a „absolutní jistotu".
 *  • zdraví a estetika — reklama nesmí slibovat léčebný účinek ani výsledek zákroku.
 *  • technické a řemeslné obory — parametr vlastní práce (tloušťka, tlak, únosnost,
 *    tepelný odpor, životnost, záruka) vypadá jako neutrální technický údaj, ale je
 *    to závazek vůči zákazníkovi a reklamační podklad. Přidáno pro hydroizolace:
 *    „naše izolace vydrží 4 bary podle ČSN P 73 0606" doloží normu, ale ne vlastní
 *    práci — a brána bez tohohle rozdělení pustila obojí.
 *
 * Porovnává se BEZ DIAKRITIKY (`normalizeText`), takže „strech" chytí i „střech"
 * a obor zapsaný uživatelem bez háčků nepropadne.
 */

import { normalizeText } from "@/lib/team"

export type IndustryRiskFamily = "finance" | "health" | "technical"

/** Finance: výnos, garance, jistota — vždycky s ČNB a zákonem o spotřebitelském úvěru za zády. */
const FINANCE_HINTS = [
    "invest", "výnos", "vynos", "financ", "půd", "pud", "úvěr", "uver", "pojiš", "pojis",
]

/** Zdraví a estetika: účinek, výsledek zákroku, „vyléčí". */
const HEALTH_HINTS = [
    "zdrav", "medicín", "medicin", "klinik", "estetick", "lékař", "lekar", "dentál", "dental",
]

/**
 * Technické a řemeslné obory: každý parametr je závazek, který jde změřit na stavbě.
 * Zákazník si „vydrží 4 bary" neověří na webu — ověří si to reklamací.
 */
const TECHNICAL_HINTS = [
    "stavebn", "izolac", "hydroizolac", "řemesl", "remesl", "střech", "strech",
    "zateplen", "elektro", "revize", "montáž", "montaz", "instalat", "topen",
]

/**
 * Obory, kde `guardrails` u showcase kitu NEJSOU volitelné (vynucuje `npm run guard`).
 *
 * Schválně jen finance + zdraví: showcase je náš prodejní feed o cizí značce, kde
 * hrozí právní postih. Technické obory dostávají přitvrzenou bránu, ne povinný
 * guardrail — tam je riziko v klientském obsahu, ne v naší výloze.
 */
export const REGULATED_INDUSTRY_HINTS = [...FINANCE_HINTS, ...HEALTH_HINTS]

function matches(industry: string, hints: string[]): boolean {
    const s = normalizeText(industry)
    if (!s) return false
    return hints.some(h => s.includes(normalizeText(h)))
}

/**
 * Do které rizikové rodiny obor patří — `null`, když do žádné.
 *
 * Pořadí je záměrné: obor typu „financování rekonstrukcí" je primárně finanční,
 * protože tam se lže o penězích, ne o tloušťce izolace.
 */
export function industryRiskFamily(industry: string | null | undefined): IndustryRiskFamily | null {
    const s = (industry || "").trim()
    if (!s) return null
    if (matches(s, FINANCE_HINTS)) return "finance"
    if (matches(s, HEALTH_HINTS)) return "health"
    if (matches(s, TECHNICAL_HINTS)) return "technical"
    return null
}

/** Obor, kde showcase kit musí mít `guardrails` (finance nebo zdraví). */
export function isRegulatedIndustry(industry: string | null | undefined): boolean {
    const family = industryRiskFamily(industry)
    return family === "finance" || family === "health"
}
