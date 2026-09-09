"use server"

/**
 * Evidence klientů — obchodní pipeline pro člověka.
 *
 * Tabulka `leads` tu byla od 11. 8. 2026, ale plnil a četl ji výhradně obchodní
 * agent; v celém dashboardu na ni nevedla jediná obrazovka. Kdo chtěl vidět nebo
 * doplnit obchodní data, neměl kam kliknout — a tak vznikaly tabulky v Drive.
 * Tohle je ta chybějící půlka.
 *
 * **Jeden trychtýř, dva pisatelé.** Agent zapisuje `qualified`/`rejected`/
 * `contacted`, člověk `negotiating`/`offer`/`active`/`won`/`lost`/`inactive`.
 * Fronta agenta se ptá jen na `status = 'qualified'`, takže lidský stav do ní
 * nikdy nespadne — a proto tu člověk `qualified` nastavit NESMÍ. Je to slovo
 * robota: lead, který si obchodník vede rukou, se nesmí ocitnout ve frontě
 * studeného oslovení. Domluvená schůzka a automatický mail „všiml jsem si, že
 * váš profil spí" se nesmí potkat.
 *
 * Brána je `requireSuperAdmin()` u KAŽDÉ akce, stejně jako v `task-actions.ts`.
 */

import supabaseAdmin from "@/supabase/admin"
import { requireSuperAdmin } from "@/lib/auth-guard"
import { revalidatePath } from "next/cache"
// Číselníky a typy bydlí v `lib/leads.ts`, ne tady: soubor s `"use server"` smí
// exportovat jenom async funkce. Konstanta vedle nich projde buildem a shodí se
// až za běhu při vyhodnocení modulu — tedy na produkci, ne v CI.
import { HUMAN_STATUSES, STATUS_LABELS, CONTACT_KINDS, EDITABLE } from "@/lib/leads"
import type { Lead, LeadEvent, LeadResult, LeadPatch, ContactKind } from "@/lib/leads"

// ─── Čtení ───────────────────────────────────────────────────

/**
 * Seznam pro obrazovku. Řadí se tak, jak obchodník ráno čte: nejdřív co má
 * termín (schůzka, domluvený další kontakt), pak zbytek od nejnovějšího.
 *
 * Uzavřené se ve výchozím stavu neukazují — jinak by za rok seznam začínal
 * loňskými klienty a dnešní schůzka by byla na třetí obrazovce.
 */
export async function listLeads(input?: { status?: string; q?: string; includeClosed?: boolean }): Promise<Lead[]> {
    await requireSuperAdmin()

    let query = supabaseAdmin.from("leads").select("*").limit(500)

    if (input?.status) query = query.eq("status", input.status)
    else if (!input?.includeClosed) query = query.not("status", "in", "(won,lost,inactive,rejected)")

    const q = input?.q?.trim()
    if (q) {
        const safe = q.replace(/[%,()]/g, " ")
        query = query.or(`company.ilike.%${safe}%,contact_person.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%,ref.ilike.%${safe}%`)
    }

    const { data, error } = await query
        .order("meeting_at", { ascending: true, nullsFirst: false })
        .order("next_contact_at", { ascending: true, nullsFirst: false })
        .order("discovered_at", { ascending: false })

    if (error) {
        console.error("listLeads error:", error.message)
        return []
    }
    return (data ?? []) as Lead[]
}

/** Vlákno kontaktu — ruční hovory i kroky agenta v jedné ose. Append-only. */
export async function listLeadEvents(leadId: string): Promise<LeadEvent[]> {
    await requireSuperAdmin()

    const { data, error } = await supabaseAdmin
        .from("lead_events")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(200)

    if (error) {
        console.error("listLeadEvents error:", error.message)
        return []
    }
    return (data ?? []) as LeadEvent[]
}

// ─── Zápis ───────────────────────────────────────────────────

/**
 * Nový lead z ruky.
 *
 * `source: 'manual'` a **žádné zařazení do fronty agenta**. Import (`scripts/
 * import-leads.ts`) po sobě zařazuje `lead_qualify`, protože tam jde o studený
 * seznam k proklepnutí. Tady sedí obchodník, který s firmou nejspíš už mluvil —
 * poslat jí robotický první dojem by byla ostuda, ne automatizace.
 */
export async function createLead(input: {
    company: string
    contactPerson?: string | null
    email?: string | null
    phone?: string | null
    website?: string | null
    clientType?: string | null
    priority?: string | null
}): Promise<LeadResult> {
    await requireSuperAdmin()

    const company = input.company?.trim()
    if (!company) return { success: false, error: "Firma potřebuje název." }

    const { data, error } = await supabaseAdmin
        .from("leads")
        .insert({
            source: "manual",
            company,
            contact_person: input.contactPerson?.trim() || null,
            email: input.email?.trim() || null,
            phone: input.phone?.trim() || null,
            website: input.website?.trim() || null,
            client_type: input.clientType || null,
            priority: input.priority || null,
            status: "new",
        })
        .select("*")
        .single()

    if (error) {
        console.error("createLead error:", error.message)
        // Unikátní index na e-mailu chrání před dvojím zavedením téže firmy.
        if (error.code === "23505") return { success: false, error: "Tenhle kontakt už v evidenci je." }
        return { success: false, error: error.message }
    }
    revalidatePath("/dashboard/instagram")
    return { success: true, lead: data as Lead }
}

/** Úprava políčka. Prázdný řetězec je „vymazáno", ne „nezměněno". */
export async function updateLead(id: string, patch: LeadPatch): Promise<LeadResult> {
    await requireSuperAdmin()

    const clean: Record<string, string | null> = {}
    for (const key of EDITABLE) {
        if (!(key in patch)) continue
        const raw = patch[key]
        clean[key] = typeof raw === "string" ? (raw.trim() || null) : null
    }
    if (Object.keys(clean).length === 0) return { success: false, error: "Není co uložit." }

    const { data, error } = await supabaseAdmin
        .from("leads")
        .update({ ...clean, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("*")
        .single()

    if (error) {
        console.error("updateLead error:", error.message)
        return { success: false, error: error.message }
    }
    revalidatePath("/dashboard/instagram")
    return { success: true, lead: data as Lead }
}

/**
 * Posun ve trychtýři. Zapisuje se i do `lead_events` — stav je „kde to je teď",
 * události jsou „co se stalo", a míra odpovědí se počítá z těch druhých.
 */
export async function setLeadStatus(id: string, status: string): Promise<LeadResult> {
    const { email } = await requireSuperAdmin()

    if (!(HUMAN_STATUSES as readonly string[]).includes(status)) {
        // `qualified` sem patří nejmíň ze všech: je to vstupenka do fronty
        // studeného oslovení, kterou člověk nemá jak chtít.
        return { success: false, error: "Tenhle stav nastavuje agent, ne člověk." }
    }

    const { data, error } = await supabaseAdmin
        .from("leads")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("*")
        .single()

    if (error) {
        console.error("setLeadStatus error:", error.message)
        return { success: false, error: error.message }
    }

    await supabaseAdmin.from("lead_events").insert({
        lead_id: id, kind: "status", actor: email,
        detail: { status, label: STATUS_LABELS[status] ?? status },
    })

    revalidatePath("/dashboard/instagram")
    return { success: true, lead: data as Lead }
}

/**
 * Zápis kontaktu — telefonát, schůzka, poznámka.
 *
 * Kromě události posouvá i datumy na leadu: `first_contact_at` se plní jen
 * poprvé (je to doklad o prvním oslovení, ne o posledním) a `next_contact_at`
 * s `next_step` se přepisují, protože „co dál" má právě jednu platnou verzi.
 */
export async function addLeadContact(leadId: string, input: {
    kind: ContactKind
    note: string
    nextStep?: string | null
    nextAt?: string | null
}): Promise<LeadResult> {
    const { email } = await requireSuperAdmin()

    const note = input.note?.trim()
    if (!note) return { success: false, error: "Napiš, jak to dopadlo." }
    if (!(CONTACT_KINDS as readonly string[]).includes(input.kind)) {
        return { success: false, error: "Neznámý typ kontaktu." }
    }

    const { data: lead } = await supabaseAdmin
        .from("leads").select("first_contact_at").eq("id", leadId).maybeSingle()
    if (!lead) return { success: false, error: "Lead nenalezen." }

    const { error: evErr } = await supabaseAdmin.from("lead_events").insert({
        lead_id: leadId, kind: input.kind, actor: email,
        detail: { note, next_step: input.nextStep?.trim() || null },
    })
    if (evErr) {
        console.error("addLeadContact event error:", evErr.message)
        return { success: false, error: evErr.message }
    }

    const now = new Date().toISOString()
    const patch: Record<string, string | null> = { updated_at: now }
    // Poznámka není kontakt — nesmí posunout „naposledy voláno".
    if (input.kind !== "note") {
        patch.last_contacted_at = now
        if (!lead.first_contact_at) patch.first_contact_at = now
    }
    if (input.nextStep !== undefined) patch.next_step = input.nextStep?.trim() || null
    if (input.nextAt !== undefined) patch.next_contact_at = input.nextAt || null

    const { data, error } = await supabaseAdmin
        .from("leads").update(patch).eq("id", leadId).select("*").single()

    if (error) {
        console.error("addLeadContact error:", error.message)
        return { success: false, error: error.message }
    }
    revalidatePath("/dashboard/instagram")
    return { success: true, lead: data as Lead }
}

/** Smazání. Události jdou s ním (`ON DELETE CASCADE`) — je to jeho příběh. */
export async function deleteLead(id: string): Promise<{ success: boolean; error?: string }> {
    await requireSuperAdmin()

    const { error } = await supabaseAdmin.from("leads").delete().eq("id", id)
    if (error) {
        console.error("deleteLead error:", error.message)
        return { success: false, error: error.message }
    }
    revalidatePath("/dashboard/instagram")
    return { success: true }
}
