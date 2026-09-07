/**
 * Čtení listu ÚKOLY z Google tabulky
 * ==================================
 *
 * Schválně bez jediného dotazu do databáze: parser tak jde spustit i tam, kde není
 * `.env.local` — v dry-runu (`scripts/sync-ukoly.ts`) i v asercích `npm run guard`.
 * Zápis a srovnávání se stavem žije vedle v `sheet-sync.ts`.
 *
 * Tok je jednosměrný, tabulka → aplikace. Zapisovat do ní zpátky nejde: Drive
 * konektor to neumí a egress na `docs.google.com` je zavřený.
 */

import { normalizeText } from "@/lib/team"

/** Řádek listu ÚKOLY přeložený do našich pojmů. */
export interface SheetTask {
    title: string
    note: string | null
    priority: number | null
    sourceKey: string
}


/**
 * Nadpisy, oddělovače a poznámky pod čarou, které v listu vypadají jako úkol, ale
 * nejsou jím. Porovnává se bez diakritiky, aby to neuletělo na „NOVÉ"/"NOVE".
 */
const NOT_A_TASK = [
    "termich schuze",
    "termin schuze",
    "nove pozadavky",
    "stav",
    "poznamka",
]

/** `prio 1` … `prio 3` ve sloupci stavu. Cokoliv jiného = bez priority. */
function parsePriority(raw: string | undefined): number | null {
    const m = /(\d)/.exec(raw ?? "")
    if (!m) return null
    const n = Number(m[1])
    return n >= 1 && n <= 3 ? n : null
}

/**
 * Stabilní klíč řádku. Diakritika, velikost písmen ani zdvojené mezery ho nesmí
 * rozhodit — jinak by oprava překlepu v tabulce založila druhý úkol vedle prvního.
 */
export function sourceKeyFor(title: string): string {
    return normalizeText(title).replace(/\s+/g, " ").slice(0, 200)
}

/**
 * Přeloží surové řádky z Sheets API na úkoly.
 *
 * Sloupce listu: `A` název (v tabulce sloučený přes A–H), `I` stav (`prio N`),
 * `J` poznámka. Bere se `A` a první neprázdná hodnota z `I`/`J` podle pozice —
 * sloučené buňky vrací API jen jednou, zbytek jako prázdné řetězce.
 */
export function parseSheetRows(rows: string[][]): SheetTask[] {
    const out: SheetTask[] = []
    const seen = new Set<string>()

    for (const row of rows) {
        const title = (row[0] ?? "").trim()
        if (!title) continue

        const flat = normalizeText(title)
        if (NOT_A_TASK.some(bad => flat.startsWith(bad))) continue

        const sourceKey = sourceKeyFor(title)
        if (!sourceKey || seen.has(sourceKey)) continue
        seen.add(sourceKey)

        out.push({
            title,
            note: (row[9] ?? "").trim() || null,
            priority: parsePriority(row[8]),
            sourceKey,
        })
    }
    return out
}

/**
 * Stáhne list ÚKOLY. Vrací `null`, když sync není nakonfigurovaný — chybějící
 * proměnná nesmí shodit cron, jen ho nechá nic neudělat.
 */
export async function fetchSheetTasks(): Promise<SheetTask[] | null> {
    const sheetId = process.env.TASKS_SHEET_ID
    const apiKey = process.env.GOOGLE_SHEETS_API_KEY
    if (!sheetId || !apiKey) return null

    const range = encodeURIComponent("ÚKOLY!A:J")
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`

    const res = await fetch(url, { cache: "no-store" })
    if (!res.ok) {
        // Tělo chyby od Googlu nese důvod (špatný klíč, odebrané sdílení, přejmenovaný
        // list). Bez něj by se ladilo z holého 403.
        const body = await res.text().catch(() => "")
        throw new Error(`Sheets API ${res.status}: ${body.slice(0, 200)}`)
    }

    const json = (await res.json()) as { values?: string[][] }
    return parseSheetRows(json.values ?? [])
}
