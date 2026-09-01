/**
 * Hloubka analytiky — co znamená `analytics: "basic" | "full"`.
 * ==============================================================
 * **Čistý modul: žádná DB, žádné `server-only`.** Server podle něj payload ořezává,
 * prohlížeč podle něj kreslí zámek. Jedno pravidlo, dva čtenáři.
 *
 * Do 9/2026 byl přepínač `analytics` **placený slib bez krytí**: nikde se nečetl,
 * jen se vypsal na kartu tarifu jako „Plná analytika výkonu". Start platil míň
 * a viděl identickou obrazovku Výkon jako Impérium. Stejná vada, jakou měla
 * priorita generování do srpna — a stejné řešení: buď to něco dělá, nebo to
 * z ceníku zmizí.
 *
 * ── Kde je hranice ────────────────────────────────────────────────────────
 * Základní tarif vidí **čísla**: kolik měl který příspěvek lajků, uložení
 * a komentářů, a jaká je průměrná interakce. Nic se před ním neskrývá o tom,
 * CO se stalo.
 *
 * Vyšší tarify vidí **co z těch čísel plyne**: který formát funguje nejlíp, v jaký
 * čas, jaká je konverze, které pilíře táhnou a jak dopadly A/B souboje. To je
 * práce, kterou by jinak dělal člověk nad tabulkou — a přesně to se platí.
 *
 * ⚠️ **Ořez platí VÝHRADNĚ pro čtení v UI, nikdy pro engine.** `analyzePerformance()`
 * dodává tytéž závěry copywriterovi a plánovači, aby psali podle toho, co měřením
 * vyšlo. Kdyby se ořezávalo i tam, Start by dostával horší obsah — a to je přesně
 * ta tichá degradace kvality, kterou CLAUDE.md zakazuje. Tarif rozhoduje o tom,
 * co zákazník VIDÍ, ne o tom, jak dobře se mu generuje.
 */

export type AnalyticsDepth = "basic" | "full"

/** Pole závěrů, která jsou nad rámec „základní". Ořez se řídí tímhle seznamem. */
export const FULL_ONLY_FIELDS = [
    "bestPostTypes",
    "bestHooks",
    "bestTimeSlots",
    "topPatterns",
    "pillarPerformance",
    "typePerformance",
    "conversionRate",
    "bestConvertingTypes",
] as const

/** Nikdy nevěřit vstupu z DB — legacy tarify hodnotu nemusí nést vůbec. */
export function normalizeDepth(raw: unknown): AnalyticsDepth {
    return raw === "full" ? "full" : "basic"
}

export function hasFullAnalytics(raw: unknown): boolean {
    return normalizeDepth(raw) === "full"
}

/**
 * Ořeže závěry na to, co tarif smí vidět.
 *
 * `avgEngagement` zůstává vždy — je to jediné číslo, které shrnuje „jak se dařilo"
 * bez toho, aby radilo, co dělat dál. Ostatní pole se **mažou**, ne nulují:
 * `conversionRate: 0` by na kartě vypadalo jako naměřená nula, tedy jako lež.
 */
export function trimInsightsForDepth<T extends Record<string, unknown> | null>(
    insights: T,
    depth: AnalyticsDepth,
): T {
    if (!insights || depth === "full") return insights
    const trimmed = { ...insights } as Record<string, unknown>
    for (const field of FULL_ONLY_FIELDS) delete trimmed[field]
    return trimmed as T
}

/** Co se zákazníkovi napíše na zamčenou kartu. Jedna věta, žádné výčitky. */
export const LOCKED_ANALYTICS_COPY = {
    title: "Co z čísel plyne",
    body: "Čísla u příspěvků vidíš celá. Vyhodnocení — který formát a čas fungují nejlíp, jaká je konverze a jak dopadly A/B souboje — je od tarifu Růst výš.",
} as const
