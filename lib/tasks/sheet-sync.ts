/**
 * Sync úkolů z Google tabulky do databáze
 * =======================================
 *
 * **Pravidlo, na kterém celý sync stojí — vlastnictví sloupců:**
 *
 * | sloupec                             | vlastní   | sync ho             |
 * |-------------------------------------|-----------|---------------------|
 * | `title`, `note`, `priority`         | tabulka   | přepisuje           |
 * | `status`, `owner_email`, `due_date` | aplikace  | NIKDY nepřepíše     |
 *
 * Kdyby sync sahal i na druhou skupinu, každé pondělí a čtvrtek by smazal všechno,
 * co tým během týdne odbavil — a příště by mu nikdo nevěřil.
 *
 * Řádek, který z tabulky zmizí, se **nemaže**. Vrátí se v souhrnu jako
 * `chybiVTabulce`, ať se člověk rozhodne sám. Smazat někomu rozdělaný úkol proto,
 * že se v tabulce posunul řádek, je horší než nechat jeden viset navíc.
 */

import supabaseAdmin from "@/supabase/admin"
import { suggestRole, memberForRole, type TeamMember } from "@/lib/team"
import { fetchSheetTasks } from "@/lib/tasks/sheet-parse"

export interface SyncSummary {
    novych: number
    zmenenych: number
    bezeZmeny: number
    chybiVTabulce: string[]
    skipped?: string
}

/**
 * Srovná tabulku s databází.
 *
 * Zakládá přes `upsert` na částečném unikátním indexu `tasks(source_key)` — stejná
 * doktrína jako `UNIQUE INDEX ON invoices(payment_id)`: klíč rozhoduje, ne pořadí
 * dvou souběžných běhů.
 */
export async function syncTasksFromSheet(): Promise<SyncSummary> {
    const sheet = await fetchSheetTasks()
    if (!sheet) {
        return { novych: 0, zmenenych: 0, bezeZmeny: 0, chybiVTabulce: [], skipped: "sync není nakonfigurovaný" }
    }

    const { data: existingRows } = await supabaseAdmin
        .from("tasks")
        .select("id, title, note, priority, owner_email, source, source_key")
        .not("source_key", "is", null)

    const existing = new Map((existingRows ?? []).map(t => [t.source_key as string, t]))

    const { data: teamRows } = await supabaseAdmin
        .from("team_members")
        .select("email, name, role, active")
    const team = (teamRows ?? []) as TeamMember[]

    let novych = 0
    let zmenenych = 0
    let bezeZmeny = 0

    for (const task of sheet) {
        const current = existing.get(task.sourceKey)

        if (!current) {
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
                created_by: "sync",
                updated_by: "sync",
            })
            if (error) {
                console.error(`sync: úkol "${task.title.slice(0, 50)}" se nezaložil — ${error.message}`)
                continue
            }
            novych++
            continue
        }

        // Úkol, do kterého někdo v aplikaci sáhl, si tabulka zpátky nevezme. Claim
        // (`source_key`) mu zůstal, takže se řádek nezaloží podruhé — jen se přeskočí.
        if (current.source === "app") {
            bezeZmeny++
            continue
        }

        const changed =
            current.title !== task.title ||
            (current.note ?? null) !== task.note ||
            (current.priority ?? null) !== task.priority

        if (!changed) {
            bezeZmeny++
            continue
        }

        // Jen sloupce tabulky. `status`, `owner_email` ani `due_date` tu schválně
        // nejsou — a nikdy tu být nesmí.
        const { error } = await supabaseAdmin
            .from("tasks")
            .update({
                title: task.title,
                note: task.note,
                priority: task.priority,
                updated_at: new Date().toISOString(),
                updated_by: "sync",
            })
            .eq("id", current.id)

        if (error) {
            console.error(`sync: úkol "${task.title.slice(0, 50)}" se neaktualizoval — ${error.message}`)
            continue
        }
        zmenenych++
    }

    const inSheet = new Set(sheet.map(t => t.sourceKey))
    const chybiVTabulce = (existingRows ?? [])
        .filter(t => !inSheet.has(t.source_key as string))
        .map(t => t.title as string)

    return { novych, zmenenych, bezeZmeny, chybiVTabulce }
}
