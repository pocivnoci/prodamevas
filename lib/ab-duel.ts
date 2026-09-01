/**
 * A/B souboje — kdo z dvojice vyhrál a jestli se to vůbec dá tvrdit.
 * ==================================================================
 * **Čistý modul: žádná DB, žádné `server-only`.** Server action sem posílá řádky
 * z `ig_posts`, prohlížeč tytéž typy vykresluje. Rozhodování o vítězi žije na
 * jednom místě, ne půlka na serveru a půlka v komponentě.
 *
 * Varianta je příspěvek s `link_type='variant'`, který přes `revision_of` ukazuje
 * na originál (CLAUDE.md). Vyhodnocení je proto jen porovnání interakcí — data
 * pro něj v databázi ležela od začátku, jen je nikdo nikdy nesečetl.
 *
 * ⚠️ Pravidlo, na kterém tenhle modul stojí: **prohlásit vítěze se smí jen tehdy,
 * když je rozdíl větší než šum.** Dvě fotky se 12 a 13 lajky nejsou „vítěz a
 * poražený", jsou to dvě stejné fotky. Kdyby aplikace na takovém rozdílu stavěla
 * doporučení, učí zákazníka věřit náhodě — a to je horší než mlčet.
 */

import { engagementScore, hasMetrics, type EngagementInput } from "./engagement"

/** Řádek `ig_posts`, jak ho souboj potřebuje. */
export interface DuelPost extends EngagementInput {
    id: string
    caption?: string | null
    image_url?: string | null
    status?: string | null
    posted_at?: string | null
}

export type DuelVerdict =
    /** Ještě není co porovnávat — někdo z dvojice není venku nebo nemá metriky. */
    | "ceka"
    /** Obě mají data, ale rozdíl je v šumu. Vítěze NEURČUJEME. */
    | "tesne"
    /** Rozdíl je dost velký na to, aby se z něj dalo něco vyvodit. */
    | "rozhodnuto"

export interface Duel {
    verdict: DuelVerdict
    original: DuelPost & { score: number }
    variant: DuelPost & { score: number }
    /** Vítěz — jen u `rozhodnuto`. */
    winner: "original" | "variant" | null
    /** O kolik procent je vítěz lepší. Jen u `rozhodnuto`. */
    marginPct: number | null
    /** Věta pro zákazníka. Vždy vyplněná, i u `ceka`. */
    summary: string
}

/**
 * Nejmenší rozdíl, který ještě něco znamená.
 *
 * 20 % je zvolené tak, aby na běžných číslech malé značky (desítky interakcí)
 * odpovídalo rozdílu několika uložení, ne jednomu lajku navíc.
 */
export const MIN_MARGIN_PCT = 20

/**
 * Nejmenší součet interakcí, pod kterým se neprohlašuje nic.
 *
 * Bez tohohle by 1 vs. 2 lajky vyšly jako „o 100 % lepší" — procentuálně pravda,
 * fakticky nesmysl.
 */
export const MIN_TOTAL_ENGAGEMENT = 10

/** Je příspěvek venku a naměřený? */
function jeZmereny(p: DuelPost): boolean {
    return p.status === "posted" && hasMetrics(p)
}

/** Vyhodnotí jednu dvojici originál × varianta. */
export function evaluateDuel(original: DuelPost, variant: DuelPost): Duel {
    const oScore = engagementScore(original)
    const vScore = engagementScore(variant)
    const base = {
        original: { ...original, score: oScore },
        variant: { ...variant, score: vScore },
    }

    if (!jeZmereny(original) || !jeZmereny(variant)) {
        return {
            ...base,
            verdict: "ceka",
            winner: null,
            marginPct: null,
            summary: "Čeká na data — až budou obě verze venku a stáhnou se metriky, uvidíš, která zabrala.",
        }
    }

    const total = oScore + vScore
    const lepsi = Math.max(oScore, vScore)
    const horsi = Math.min(oScore, vScore)
    // Dělí se menším číslem, ne součtem: „o 50 % lepší" má znamenat jedenapůlkrát
    // tolik. Nula ve jmenovateli by dala Infinity, proto podlaha na 1.
    const marginPct = Math.round(((lepsi - horsi) / Math.max(horsi, 1)) * 100)

    if (total < MIN_TOTAL_ENGAGEMENT) {
        return {
            ...base,
            verdict: "tesne",
            winner: null,
            marginPct: null,
            summary: "Obě verze zatím mají málo interakcí — na závěr je brzy.",
        }
    }

    if (marginPct < MIN_MARGIN_PCT) {
        return {
            ...base,
            verdict: "tesne",
            winner: null,
            marginPct,
            summary: "Obě verze dopadly skoro stejně. Rozdíl je v rámci náhody, takže vítěze neurčujeme.",
        }
    }

    const winner: "original" | "variant" = vScore > oScore ? "variant" : "original"
    const jmeno = winner === "variant" ? "Varianta" : "Původní verze"
    return {
        ...base,
        verdict: "rozhodnuto",
        winner,
        marginPct,
        summary: `${jmeno} vyhrála o ${marginPct} %. Chrlit s tím počítá při psaní dalších příspěvků.`,
    }
}

/**
 * Poskládá souboje ze seznamu příspěvků.
 *
 * Varianta se páruje s originálem přes `revision_of`. Originál bez varianty ani
 * varianta bez dohledaného originálu souboj netvoří — osamocený příspěvek není
 * s čím porovnat.
 */
export function buildDuels(
    posts: (DuelPost & { link_type?: string | null; revision_of?: string | null })[],
): Duel[] {
    const podleId = new Map(posts.map((p) => [p.id, p]))
    const duels: Duel[] = []

    for (const p of posts) {
        if (p.link_type !== "variant" || !p.revision_of) continue
        const original = podleId.get(p.revision_of)
        if (!original) continue
        duels.push(evaluateDuel(original, p))
    }

    // Rozhodnuté nahoru — to je to, kvůli čemu sem zákazník chodí. Uvnitř skupiny
    // pak podle síly vítěze, ať nejzajímavější souboj není až dole.
    const poradi: Record<DuelVerdict, number> = { rozhodnuto: 0, tesne: 1, ceka: 2 }
    return duels.sort((a, b) => {
        if (poradi[a.verdict] !== poradi[b.verdict]) return poradi[a.verdict] - poradi[b.verdict]
        return Math.max(b.original.score, b.variant.score) - Math.max(a.original.score, a.variant.score)
    })
}
