/**
 * Rozeslání denní práce na klienta.
 * ==================================
 * Protějšek `client-sweep.ts`. Sweep projde všechny klienty v JEDNÉ úloze
 * s časovým rozpočtem; fan-out z plánovače udělá levný dotaz a skutečnou práci
 * rozešle jako JEDNU ÚLOHU NA KLIENTA.
 *
 * KDY CO POUŽÍT
 * -------------
 *   sweep    — práce na klienta je levná (pár dotazů do databáze, žádný model).
 *              `auto_publish_arm` a `voice_examples_promote` takové jsou.
 *   fan-out  — práce na klienta volá model nebo jinak trvá desítky vteřin.
 *              `idea_replenish` takový je: doplnění zásobníku dělá až dvě
 *              generování nápadů, tedy ~20–60 s na klienta.
 *
 * PROČ TO VZNIKLO
 * ---------------
 * Sweep má rozpočet 600 s. Při 26 klientech doběhne za vteřiny — ale jen proto,
 * že se produkt nepoužívá: zásobníky jsou plné, `idea_replenish` vrací každý den
 * `added: 0` a žádný model nezavolá. Jakmile klienti obsah reálně berou, vejde
 * se do 600 s ~20 klientů. Při 300 klientech by se na každého dostalo jednou za
 * dva týdny. Rotace zajistí, že to nebude pořád tentýž smolař — ale neobslouží
 * to nikoho.
 *
 * SOUBĚŽNOST PŘIJDE SAMA, NENÍ TU ŽÁDNÝ POOL
 * -------------------------------------------
 * `agent-worker` startuje každou minutu a jeden běh žije až 700 s, takže se
 * běhy překrývají; lease v `claimNext()` brání tomu, aby si dva vzaly tutéž
 * úlohu. Naměřeno v produkci: až 5 souběžných generování napříč 5 klienty.
 * Zvyšovat souběžnost se tedy dá přidáním běhů, ne přepisem tohohle souboru —
 * a strop se pak přesune na kvóty modelu, což je potřeba ověřit zvlášť.
 *
 * DVOJÍ ZAŘAZENÍ ŘEŠÍ DATABÁZE, NE KONTROLA PŘED ZÁPISEM
 * -------------------------------------------------------
 * „Zjisti, jestli úloha čeká, a když ne, zařaď ji" je závod: dva souběžné
 * plánovače projdou kontrolou oba a model se zaplatí dvakrát. Hranici proto
 * drží částečný unikátní index na `agent_tasks.dedupe_key` a kolize se čte jako
 * „už zařazeno". Stejná doktrína jako podmíněný claim jinde v repu.
 */

import { tryEnqueueTask } from "@/lib/agent-runner"

export interface FanOutResult {
    /** Kolik úloh se opravdu založilo. */
    enqueued: number
    /** Kolik jich přeskočil dedupe (klient už jednu čekající má). */
    skipped: number
    /** Klienti, pro které se úloha nezaložila kvůli chybě — ne kvůli dedupe. */
    failed: { clientId: string; error: string }[]
}

/**
 * Zařadí jednu úlohu daného typu pro každého klienta ze seznamu.
 *
 * Chyba u jednoho klienta nikdy nezastaví ostatní — to je celý smysl rozeslání.
 * Plánovač musí zůstat levný, takže se tu nedělá nic než zápis: veškeré
 * rozhodování „má tenhle klient práci potřebovat?" patří buď do dotazu, který
 * seznam sestavil, nebo do samotné úlohy.
 */
export async function fanOutPerClient(
    type: string,
    clientIds: string[],
    opts: { priority?: number; maxAttempts?: number; payload?: Record<string, unknown> } = {},
): Promise<FanOutResult> {
    const result: FanOutResult = { enqueued: 0, skipped: 0, failed: [] }

    for (const clientId of clientIds) {
        try {
            const id = await tryEnqueueTask({
                type,
                clientId,
                payload: opts.payload,
                priority: opts.priority,
                maxAttempts: opts.maxAttempts,
                dedupeKey: `${type}:${clientId}`,
            })
            if (id) result.enqueued++
            else result.skipped++
        } catch (err) {
            result.failed.push({ clientId, error: (err as Error)?.message?.slice(0, 200) || "neznámá chyba" })
        }
    }

    return result
}
