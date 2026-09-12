/**
 * Jednorázový import úkolů z Google tabulky
 * =========================================
 *
 * **Zdroj pravdy je databáze, ne tabulka.** Do 9/2026 tohle byl obousměrný-ish
 * sync: cron dvakrát týdně přepisoval `title`, `note` a `prioritu` podle listu
 * ÚKOLY. Stálo to za tím vlastnictví sloupců, kvůli kterému se každá úprava
 * v appce musela bránit (`source: 'app'`) — a stejně platilo, že co člověk
 * v appce upřesnil, tabulka příští pondělí přepsala zpátky.
 *
 * Od té doby je tohle **importér**: zakládá jen řádky, které v databázi ještě
 * nejsou, a existující úkol nikdy nesahá. Cron je pryč (`vercel.json`), route
 * `/api/cron/tasks-sync` zůstala jako ruční spuštění za `CRON_SECRET`.
 *
 * `source_key` zůstává a je pořád claim na řádek: bez něj by druhý import
 * založil tytéž úkoly znovu. Týž částečný unikátní index sdílí návrhy AI
 * (prefix `ai:`, `lib/tasks/propose.ts`).
 *
 * Řádek, který z tabulky zmizí, se **nemaže**. Vrátí se v souhrnu jako
 * `chybiVTabulce`, ať se člověk rozhodne sám.
 */

import supabaseAdmin from "@/supabase/admin"
import { suggestRole, memberForRole, type TeamMember } from "@/lib/team"
import { fetchSheetTasks } from "@/lib/tasks/sheet-parse"

export interface SyncSummary {
    /** Kolik řádků z tabulky v databázi nebylo a založilo se. */
    novych: number
    /** Kolik už v databázi je — importér se jich ani nedotkne. */
    preskocenych: number
    /** Úkoly, které v tabulce nejsou. Nemažou se, jen se hlásí. */
    chybiVTabulce: string[]
    skipped?: string
}

/**
 * Projde tabulku a založí, co v databázi chybí.
 *
 * Claim na řádek drží částečný unikátní index `tasks(source_key)` — stejná
 * doktrína jako `UNIQUE INDEX ON invoices(payment_id)`: klíč rozhoduje, ne
 * pořadí dvou souběžných běhů.
 *
 * **Žádný `.update()` nad `tasks` tady nesmí být.** Existující úkol už žije
 * v appce; přepsat mu text podle měsíce starého řádku v tabulce znamená smazat
 * upřesnění, které do něj někdo napsal. Hlídá `scripts/test-ukoly.ts`.
 */
export async function syncTasksFromSheet(): Promise<SyncSummary> {
    const sheet = await fetchSheetTasks()
    if (!sheet) {
        return { novych: 0, preskocenych: 0, chybiVTabulce: [], skipped: "import není nakonfigurovaný" }
    }

    const { data: existingRows } = await supabaseAdmin
        .from("tasks")
        .select("id, title, source_key")
        .not("source_key", "is", null)
        // Návrhy od AI nosí klíč s prefixem `ai:` (`lib/tasks/propose.ts`). Sdílí
        // s tabulkou tentýž unikátní index — je to táž ochrana proti duplicitě —
        // ale v tabulce nikdy nebyly, takže by je souhrn hlásil jako „chybí
        // v tabulce" a člověk by je den co den hledal v řádku, který neexistuje.
        .not("source_key", "like", "ai:%")

    const existing = new Set((existingRows ?? []).map(t => t.source_key as string))

    const { data: teamRows } = await supabaseAdmin
        .from("team_members")
        .select("email, name, role, active")
    const team = (teamRows ?? []) as TeamMember[]

    let novych = 0
    let preskocenych = 0

    for (const task of sheet) {
        if (existing.has(task.sourceKey)) {
            preskocenych++
            continue
        }

        // Návrh vlastníka jen tady, u nového úkolu. Nikdy u existujícího — to už
        // je rozhodnutí člověka a seznam klíčových slov ho nepřebije.
        const suggested = memberForRole(team, suggestRole(task.title, task.note))
        const { error } = await supabaseAdmin.from("tasks").insert({
            title: task.title,
            note: task.note,
            priority: task.priority,
            owner_email: suggested?.email ?? null,
            source: "sheet",
            source_key: task.sourceKey,
            created_by: "import",
            updated_by: "import",
        })
        if (error) {
            console.error(`import: úkol "${task.title.slice(0, 50)}" se nezaložil — ${error.message}`)
            continue
        }
        novych++
    }

    const inSheet = new Set(sheet.map(t => t.sourceKey))
    const chybiVTabulce = (existingRows ?? [])
        .filter(t => !inSheet.has(t.source_key as string))
        .map(t => t.title as string)

    return { novych, preskocenych, chybiVTabulce }
}
