/**
 * Síla příspěvku v číslech — jediný vzorec, který se smí použít kdekoliv.
 * =======================================================================
 * **Žádná DB, žádné `server-only`.** Importuje to engine (`instagram/performance.ts`),
 * server actions i prohlížeč, protože všichni musí dojít ke STEJNÉMU pořadí.
 *
 * Než tenhle modul vznikl, vzorec žil jako tři řádky uvnitř `analyzePerformance()`.
 * Dokud ho nikdo jiný nepotřeboval, bylo to v pořádku. Ve chvíli, kdy vyhodnocení
 * A/B soubojů začalo říkat „vyhrála varianta B", ale žebříček výkonu ji měl níž,
 * by to byly dvě pravdy o témže příspěvku — a zákazník by netušil, které věřit.
 *
 * Váhy nejsou libovolné: uložení a komentář stojí člověka víc úsilí než lajk,
 * takže o kvalitě obsahu vypovídají silněji. Poměr 1 : 3 : 5 je v produkci od
 * začátku a mění se jedině tady.
 */

/** Metriky tak, jak leží na `ig_posts`. Chybějící hodnota se počítá jako nula. */
export interface EngagementInput {
    likes?: number | null
    comments?: number | null
    saves?: number | null
}

export const ENGAGEMENT_WEIGHTS = { likes: 1, comments: 3, saves: 5 } as const

/** Interakce: lajk 1 · komentář 3 · uložení 5. */
export function engagementScore(p: EngagementInput): number {
    return (
        (p.likes || 0) * ENGAGEMENT_WEIGHTS.likes +
        (p.comments || 0) * ENGAGEMENT_WEIGHTS.comments +
        (p.saves || 0) * ENGAGEMENT_WEIGHTS.saves
    )
}

/** Má příspěvek vůbec naměřeno? Nula lajků u zveřejněného postu je legitimní
 *  výsledek, ale `null` znamená „nikdo metriky nestáhl ani nezadal". */
export function hasMetrics(p: EngagementInput): boolean {
    return p.likes != null || p.comments != null || p.saves != null
}
