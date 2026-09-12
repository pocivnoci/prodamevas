"use server"

/**
 * Úkoly firmy — seznam, který drží stav mezi schůzkami.
 *
 * Zdroj pravdy je tahle databáze. Google tabulka je jen historický import
 * (`lib/tasks/sheet-sync.ts`, ruční spuštění) — nic z ní se nepřepisuje zpátky.
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
    // ── Doplní třídič (`lib/tasks/triage.ts`) ───────────────────────────────
    /** { cil, hotovo, kde_zacit } — zadání, ne název. */
    spec: { cil?: string; hotovo?: string; kde_zacit?: string } | null
    spec_at: string | null
    /** Jedna věta „co teď". */
    next_step: string | null
    /** S = do půl hodiny, M = do půl dne, L = víc. */
    effort: "S" | "M" | "L" | null
    /** Kdo to smí vzít bez člověka: 'ops' = agent v appce, 'code' = PR, null = jen člověk. */
    agent: "ops" | "code" | null
    client_id: string | null
    /** Přibaleno dotazem — kvůli prokliku do studia klienta. */
    clients?: { slug: string; name: string } | null
    /** Proč se to teď nedělá — otázka nebo vnější událost. */
    blocked_on: string | null
    blocked_until: string | null
    /** Co z úkolu vzniklo: odkaz na PR, doklad, rozhodnutí. */
    result: string | null
}

export type TaskEventKind = "triage" | "question" | "answer" | "note" | "status" | "result"

/** Vlákno úkolu — jediné místo, kde se potkají lidi a AI. Append-only. */
export interface TaskEvent {
    id: string
    task_id: string
    at: string
    /** E-mail člověka, nebo 'ai'. */
    actor: string
    kind: TaskEventKind
    body: string | null
    meta: Record<string, unknown> | null
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

    // Klient se přibaluje rovnou v dotazu: úkol „hydroizolace — zkontrolovat fakta"
    // má z seznamu vést jedním kliknutím do studia toho klienta, ne k hledání slugu.
    const { data, error } = await supabaseAdmin
        .from("tasks")
        .select("*, clients(slug, name)")
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
 * Úprava úkolu — název, poznámka, priorita, termín, klient.
 *
 * Od chvíle, kdy se z Google tabulky stal jednosměrný import
 * (`lib/tasks/sheet-sync.ts`), nevlastní žádný sloupec nikdo jiný než tahle
 * aplikace, takže se tu nic nemusí bránit před přepsáním zvenčí. `source`
 * i `source_key` zůstávají nedotčené: první je stopa, odkud úkol přišel, druhý
 * claim na řádek v tabulce — bez něj by ho příští import založil podruhé.
 */
export async function updateTask(id: string, input: {
    title?: string
    note?: string | null
    priority?: number | null
    dueDate?: string | null
    clientId?: string | null
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
    if (input.clientId !== undefined) patch.client_id = input.clientId || null

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
 * Pozor: úkol s `source_key` z tabulky se vrátí, kdyby někdo pustil import znovu —
 * řádek v tabulce pořád existuje. Import se pouští ručně, takže je to viditelné
 * rozhodnutí, ne překvapení z pondělního cronu.
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

// ─── Vlákno úkolu (lidi × AI) ────────────────────────────────

/** Vlákno jednoho úkolu, odshora dolů tak, jak vzniklo. */
export async function listTaskEvents(taskId: string): Promise<TaskEvent[]> {
    await requireSuperAdmin()

    const { data, error } = await supabaseAdmin
        .from("task_events")
        .select("*")
        .eq("task_id", taskId)
        .order("at", { ascending: true })

    if (error) {
        console.error("listTaskEvents error:", error.message)
        return []
    }
    return (data || []) as TaskEvent[]
}

/**
 * Odpověď na otázku třídiče.
 *
 * Zápis odpovědi je zároveň příkaz „přečti si úkol znovu": `spec_at` se vynuluje,
 * takže ho příští běh vezme do ruky — už s odpovědí ve vlákně — a přepíše zadání.
 * Bez toho by odpověď skončila jako poznámka, kterou nikdo nezpracuje.
 *
 * `blocked_on` se maže tady, ne až po přetřídění: pro člověka v seznamu je úkol
 * odblokovaný ve chvíli, kdy odpověděl.
 */
export async function answerTaskQuestion(taskId: string, text: string): Promise<TaskResult> {
    const { email } = await requireSuperAdmin()

    const body = text?.trim()
    if (!body) return { success: false, error: "Odpověď nemůže být prázdná." }

    const { logEvent } = await import("@/lib/tasks/triage")
    await logEvent(taskId, email, "answer", body)

    const { data, error } = await supabaseAdmin
        .from("tasks")
        .update({
            spec_at: null,
            blocked_on: null,
            status: "todo",
            updated_at: new Date().toISOString(),
            updated_by: email,
        })
        .eq("id", taskId)
        .select("*")
        .single()

    if (error) {
        console.error("answerTaskQuestion error:", error.message)
        return { success: false, error: error.message }
    }
    revalidatePath("/dashboard/instagram")
    return { success: true, task: data as Task }
}

/** Poznámka do vlákna. Nic nespouští — je to jen zápis do historie. */
export async function addTaskNote(taskId: string, text: string): Promise<{ success: boolean; error?: string }> {
    const { email } = await requireSuperAdmin()

    const body = text?.trim()
    if (!body) return { success: false, error: "Poznámka nemůže být prázdná." }

    const { logEvent } = await import("@/lib/tasks/triage")
    await logEvent(taskId, email, "note", body)
    revalidatePath("/dashboard/instagram")
    return { success: true }
}

/**
 * Výsledek úkolu — odkaz na PR, doklad, rozhodnutí.
 *
 * Vlastní sloupec, ne jen poznámka ve vlákně: hotový úkol se po měsíci musí dát
 * doložit jedním pohledem do seznamu, ne čtením celé historie.
 */
export async function setTaskResult(taskId: string, result: string): Promise<TaskResult> {
    const { email } = await requireSuperAdmin()

    const value = result?.trim() || null
    const { data, error } = await supabaseAdmin
        .from("tasks")
        .update({ result: value, updated_at: new Date().toISOString(), updated_by: email })
        .eq("id", taskId)
        .select("*")
        .single()

    if (error) {
        console.error("setTaskResult error:", error.message)
        return { success: false, error: error.message }
    }
    if (value) {
        const { logEvent } = await import("@/lib/tasks/triage")
        await logEvent(taskId, email, "result", value)
    }
    revalidatePath("/dashboard/instagram")
    return { success: true, task: data as Task }
}

/**
 * Přetřídit jeden úkol na vyžádání.
 *
 * Vynulované razítko je celý příkaz — práci udělá běžný třídič. Tlačítko existuje
 * proto, že po ruční úpravě názvu je staré zadání horší než žádné.
 */
export async function retriageTask(taskId: string): Promise<TaskResult> {
    const { email } = await requireSuperAdmin()

    const { data, error } = await supabaseAdmin
        .from("tasks")
        .update({ spec_at: null, updated_at: new Date().toISOString(), updated_by: email })
        .eq("id", taskId)
        .select("*")
        .single()

    if (error) return { success: false, error: error.message }
    revalidatePath("/dashboard/instagram")
    return { success: true, task: data as Task }
}

/**
 * Spustí třídění a návrhy hned, bez čekání na ranní cron.
 *
 * Jde přes `requestAction()` jako cron — ne proto, že by to potřebovalo schválení
 * (`internal` proběhne samo), ale aby po ručním spuštění zůstal tentýž řádek
 * v auditu jako po automatickém. Jinak by v `agent_actions` chyběl každý běh,
 * který si někdo vyžádal sám.
 */
export async function runTaskAgentNow(): Promise<{ success: boolean; error?: string }> {
    await requireSuperAdmin()
    try {
        const { requestAction } = await import("@/lib/agent-safety")
        await requestAction({
            agentType: "ops", action: "Roztřídění úkolů (ručně)", riskTier: "internal",
            taskType: "task_triage", clientId: null, payload: {},
        })
        await requestAction({
            agentType: "ops", action: "Návrhy úkolů (ručně)", riskTier: "internal",
            taskType: "task_propose", clientId: null, payload: {},
        })
        return { success: true }
    } catch (err) {
        return { success: false, error: (err as Error)?.message || "Spuštění selhalo." }
    }
}

// ─── Helpers ─────────────────────────────────────────────────

/** Priorita je 1–3, nebo žádná. Cokoliv mimo rozsah je „žádná", ne chyba zápisu. */
function clampPriority(value: number | null | undefined): number | null {
    if (value == null || !Number.isFinite(value)) return null
    const n = Math.trunc(value)
    return n >= 1 && n <= 3 ? n : null
}
