"use server"

/**
 * Úkoly firmy — seznam, který drží stav mezi schůzkami.
 *
 * Vstupem je Google tabulka, kterou tým udržuje ručně (`lib/tasks/sheet-sync.ts`).
 * Zapisovat do ní zpátky nejde, takže stav — kdo to má a jak na tom je — žije tady.
 *
 * Brána je `requireSuperAdmin()` u KAŽDÉ akce, jako v `waitlist-admin.ts`. Role
 * z `lib/team.ts` rozhodují jen o přiřazování a filtrování; kdo se sem dostane,
 * vidí a mění všechno.
 */

import supabaseAdmin from "@/supabase/admin"
import { requireSuperAdmin } from "@/lib/auth-guard"
import { revalidatePath } from "next/cache"
import type { TeamMember, TeamRole } from "@/lib/team"

export type TaskStatus = "todo" | "doing" | "blocked" | "done" | "dropped"
export type TaskSource = "sheet" | "app"

export interface Task {
    id: string
    title: string
    note: string | null
    owner_email: string | null
    priority: number | null
    status: TaskStatus
    due_date: string | null
    source: TaskSource
    source_key: string | null
    created_at: string
    updated_at: string
    done_at: string | null
    created_by: string | null
    updated_by: string | null
}

export interface TaskResult {
    success: boolean
    task?: Task
    error?: string
}

// ─── Čtení ───────────────────────────────────────────────────

/**
 * Všechny úkoly najednou. Řadí se tak, jak se čtou: otevřené nahoru, uvnitř podle
 * priority (bez priority nakonec — `nulls last`, jinak by prázdné pole předběhlo
 * jedničku) a pak od nejnovějšího.
 */
export async function listTasks(): Promise<Task[]> {
    await requireSuperAdmin()

    const { data, error } = await supabaseAdmin
        .from("tasks")
        .select("*")
        .order("priority", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })

    if (error) {
        console.error("listTasks error:", error.message)
        return []
    }
    return (data ?? []) as Task[]
}

/** Tým pro přiřazování. Neaktivní členové se nenabízejí, ale staré úkoly si je drží. */
export async function listTeam(): Promise<TeamMember[]> {
    await requireSuperAdmin()

    const { data, error } = await supabaseAdmin
        .from("team_members")
        .select("email, name, role, active")
        .order("created_at", { ascending: true })

    if (error) {
        console.error("listTeam error:", error.message)
        return []
    }
    return (data ?? []) as TeamMember[]
}

// ─── Zápis ───────────────────────────────────────────────────

export async function createTask(input: {
    title: string
    note?: string | null
    ownerEmail?: string | null
    priority?: number | null
}): Promise<TaskResult> {
    const { email } = await requireSuperAdmin()

    const title = input.title?.trim()
    if (!title) return { success: false, error: "Úkol potřebuje název." }

    const { data, error } = await supabaseAdmin
        .from("tasks")
        .insert({
            title,
            note: input.note?.trim() || null,
            owner_email: input.ownerEmail || null,
            priority: clampPriority(input.priority),
            source: "app",
            created_by: email,
            updated_by: email,
        })
        .select("*")
        .single()

    if (error) {
        console.error("createTask error:", error.message)
        return { success: false, error: error.message }
    }
    revalidatePath("/dashboard/instagram")
    return { success: true, task: data as Task }
}

/**
 * Stav úkolu. `done_at` se plní a maže spolu se stavem — jinak by u úkolu, který se
 * vrátil z hotového zpátky do práce, zůstalo datum dokončení a týdenní součty by
 * počítaly hotové věci, které hotové nejsou.
 */
export async function setTaskStatus(id: string, status: TaskStatus): Promise<TaskResult> {
    const { email } = await requireSuperAdmin()

    const { data, error } = await supabaseAdmin
        .from("tasks")
        .update({
            status,
            done_at: status === "done" ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
            updated_by: email,
        })
        .eq("id", id)
        .select("*")
        .single()

    if (error) {
        console.error("setTaskStatus error:", error.message)
        return { success: false, error: error.message }
    }
    revalidatePath("/dashboard/instagram")
    return { success: true, task: data as Task }
}

/** Přiřazení. `null` = zpátky na nikoho — to je platný stav, ne chyba. */
export async function assignTask(id: string, ownerEmail: string | null): Promise<TaskResult> {
    const { email } = await requireSuperAdmin()

    const { data, error } = await supabaseAdmin
        .from("tasks")
        .update({ owner_email: ownerEmail, updated_at: new Date().toISOString(), updated_by: email })
        .eq("id", id)
        .select("*")
        .single()

    if (error) {
        console.error("assignTask error:", error.message)
        return { success: false, error: error.message }
    }
    revalidatePath("/dashboard/instagram")
    return { success: true, task: data as Task }
}

/**
 * Úprava textu úkolu.
 *
 * U úkolu z tabulky název a poznámku normálně vlastní tabulka a příští sync by je
 * přepsal zpátky. Ruční zásah proto úkol překlopí na `source: 'app'` a sync ho od
 * té chvíle přeskakuje — tichá ztráta ruční úpravy je horší než rozejít se s tabulkou.
 *
 * `source_key` si přitom **nechává**. Je to claim na řádek v tabulce: kdyby se zahodil,
 * sync by tentýž řádek považoval za nový a založil vedle druhý úkol.
 */
export async function updateTask(id: string, input: {
    title?: string
    note?: string | null
    priority?: number | null
    dueDate?: string | null
}): Promise<TaskResult> {
    const { email } = await requireSuperAdmin()

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: email }

    if (input.title !== undefined) {
        const title = input.title.trim()
        if (!title) return { success: false, error: "Úkol potřebuje název." }
        patch.title = title
    }
    if (input.note !== undefined) patch.note = input.note?.trim() || null
    if (input.priority !== undefined) patch.priority = clampPriority(input.priority)
    if (input.dueDate !== undefined) patch.due_date = input.dueDate || null

    // Ruční zásah do textu vytrhává úkol ze syncu — viz doktrína v hlavičce.
    // `source_key` zůstává: je to claim na řádek v tabulce, ne značka původu.
    const touchesSheetColumns = input.title !== undefined || input.note !== undefined || input.priority !== undefined
    if (touchesSheetColumns) patch.source = "app"

    const { data, error } = await supabaseAdmin
        .from("tasks")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single()

    if (error) {
        console.error("updateTask error:", error.message)
        return { success: false, error: error.message }
    }
    revalidatePath("/dashboard/instagram")
    return { success: true, task: data as Task }
}

/**
 * Smazání. Vědomě natvrdo, ne příznak: `dropped` už je „tohle neděláme" se stopou,
 * takže druhý měkký stav by jen dělal seznam, který nikdy nezhubne.
 *
 * Pozor: úkol z tabulky se příštím syncem vrátí — řádek v tabulce pořád existuje.
 * To je správně; smazat cizí řádek z tabulky odsud neumíme a předstírat to nebudeme.
 */
export async function deleteTask(id: string): Promise<{ success: boolean; error?: string }> {
    await requireSuperAdmin()

    const { error } = await supabaseAdmin.from("tasks").delete().eq("id", id)
    if (error) {
        console.error("deleteTask error:", error.message)
        return { success: false, error: error.message }
    }
    revalidatePath("/dashboard/instagram")
    return { success: true }
}

// ─── Tým ─────────────────────────────────────────────────────

/**
 * Přidat nebo upravit člena týmu.
 *
 * **Neuděluje to přístup.** Aby se člověk do studia dostal, musí být v
 * `SUPER_ADMIN_EMAILS`; tahle tabulka jen říká, jak se jmenuje a co dělá.
 */
export async function upsertTeamMember(input: {
    email: string
    name: string
    role: TeamRole
    active?: boolean
}): Promise<{ success: boolean; error?: string }> {
    await requireSuperAdmin()

    const email = input.email?.trim().toLowerCase()
    const name = input.name?.trim()
    if (!email || !name) return { success: false, error: "Člen týmu potřebuje e-mail i jméno." }

    const { error } = await supabaseAdmin
        .from("team_members")
        .upsert({ email, name, role: input.role, active: input.active ?? true }, { onConflict: "email" })

    if (error) {
        console.error("upsertTeamMember error:", error.message)
        return { success: false, error: error.message }
    }
    revalidatePath("/dashboard/instagram")
    return { success: true }
}

// ─── Helpers ─────────────────────────────────────────────────

/** Priorita je 1–3, nebo žádná. Cokoliv mimo rozsah je „žádná", ne chyba zápisu. */
function clampPriority(value: number | null | undefined): number | null {
    if (value == null || !Number.isFinite(value)) return null
    const n = Math.trunc(value)
    return n >= 1 && n <= 3 ? n : null
}
