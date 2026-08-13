/**
 * Spravedlivý průchod všemi klienty v jedné agentní úloze.
 * ========================================================
 * Denní agenti (`idea_replenish`, `auto_publish_arm`, `voice_examples_promote`)
 * načtou všechny klienty a projdou je sekvenčně v JEDNOM tasku. Při dnešní
 * velikosti to trvá vteřiny. Problém není rychlost, ale co se stane, až se běh
 * do limitu funkce nevejde:
 *
 *   runtime úlohu zabije uprostřed → pořadí je pokaždé stejné (order by slug /
 *   nezadané) → odnesou to vždycky TÍTÍŽ klienti na konci → jejich zásobník se
 *   nikdy nedoplní a nikdo se to nedozví
 *
 * Tichá degradace pro podmnožinu tenantů je přesně to, co má být zakázané.
 * Tenhle helper řeší obojí:
 *
 *   1. ROTACE — startovní pozice se posouvá podle dne, takže žádný klient
 *      nesedí natrvalo na konci fronty
 *   2. ROZPOČET — průchod skončí sám a čistě, ohlásí `truncated`, místo aby
 *      ho runtime přerušil uprostřed zápisu
 *
 * Není to náhrada za rozeslání úlohy na klienta; to je správné řešení, až budou
 * klientů tisíce. Do té doby je tohle levná pojistka, která odstraňuje ten
 * nebezpečný režim selhání, ne jenom oddaluje strop.
 */

/** Limit funkce agent-workeru je 800 s; končíme s rezervou na dopsání výsledku. */
export const DEFAULT_SWEEP_BUDGET_MS = 600_000

export interface SweepOutcome<R> {
    results: R[]
    /** Kolik klientů se stihlo zpracovat. */
    processed: number
    /** Kolik jich bylo celkem. */
    total: number
    /** true = došel rozpočet, zbytek přijde na řadu při dalším běhu (díky rotaci jiní). */
    truncated: boolean
}

/**
 * Projde klienty v rotovaném pořadí s časovým rozpočtem. Chyba jednoho klienta
 * nikdy nezastaví ostatní — `onError` z ní udělá běžný výsledek.
 */
export async function sweepClients<C extends { id: string; slug: string }, R>(
    clients: C[],
    handler: (client: C) => Promise<R>,
    onError: (client: C, err: Error) => R,
    options: { budgetMs?: number; seed?: number } = {},
): Promise<SweepOutcome<R>> {
    const budgetMs = options.budgetMs ?? DEFAULT_SWEEP_BUDGET_MS
    const startedAt = Date.now()
    const total = clients.length
    if (total === 0) return { results: [], processed: 0, total: 0, truncated: false }

    // Den v měsíci stačí: pořadí se mění každý den a je deterministické, takže
    // opakovaný běh téhož dne pokračuje předvídatelně.
    const seed = options.seed ?? new Date().getUTCDate()
    const start = seed % total
    const rotated = [...clients.slice(start), ...clients.slice(0, start)]

    const results: R[] = []
    let processed = 0
    for (const client of rotated) {
        if (Date.now() - startedAt > budgetMs) {
            console.warn(
                `⏱️ sweepClients: rozpočet ${Math.round(budgetMs / 1000)} s vyčerpán po ${processed}/${total} klientech — ` +
                `zbytek se zpracuje při dalším běhu (rotace zajistí, že to nebudou pokaždé titíž).`,
            )
            return { results, processed, total, truncated: true }
        }
        try {
            results.push(await handler(client))
        } catch (err) {
            results.push(onError(client, err as Error))
        }
        processed++
    }

    return { results, processed, total, truncated: false }
}
