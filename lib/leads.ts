/**
 * Slovník evidence klientů — stavy, priority, typy kontaktu.
 *
 * Bydlí mimo `app/actions/lead-actions.ts` z tvrdého důvodu: soubor s `"use server"`
 * smí exportovat **jenom async funkce**. Konstanta vedle nich projde typovou
 * kontrolou i buildem a shodí se až za běhu, při vyhodnocení modulu — tedy na
 * produkci, ne v CI. Stejná doktrína jako `lib/team.ts`: číselník je data, ne akce.
 */

/** Stavy, které smí nastavit člověk. `qualified` mezi nimi schválně NENÍ. */
export const HUMAN_STATUSES = [
    "new", "contacted", "negotiating", "offer", "active", "won", "lost", "inactive",
] as const
export type LeadStatus = typeof HUMAN_STATUSES[number] | "qualified" | "rejected" | "replied"

export const STATUS_LABELS: Record<string, string> = {
    new: "Nový",
    qualified: "Kvalifikovaný",     // zapsal agent
    rejected: "Vyřazený",           // zapsal agent
    contacted: "Kontaktován",
    replied: "Odpověděl",           // zapsal agent
    negotiating: "Jednání",
    offer: "Nabídka",
    active: "Aktivní",
    won: "Uzavřený",
    lost: "Ztracený",
    inactive: "Neaktivní",
}

export const PRIORITY_LABELS: Record<string, string> = {
    vysoka: "Vysoká", stredni: "Střední", nizka: "Nízká",
}

export const CLIENT_TYPE_LABELS: Record<string, string> = {
    firma: "Firma", osvc: "OSVČ", jednotlivec: "Jednotlivec", partner: "Partner", jine: "Jiné",
}

/** Typ kontaktu z listu „Historie kontaktů". `note` = poznámka bez kontaktu. */
export const CONTACT_KINDS = ["call", "email", "meeting", "online", "note"] as const
export type ContactKind = typeof CONTACT_KINDS[number]

export const CONTACT_KIND_LABELS: Record<string, string> = {
    call: "Telefon", email: "E-mail", meeting: "Schůzka", online: "Online", note: "Poznámka",
    // Události agenta — v témže vláknu, ať je vidět celý příběh kontaktu.
    discovered: "Nalezen", qualified: "Kvalifikován", sent: "Odeslán e-mail",
    opened: "Otevřel", clicked: "Prokliknul", previewed: "Prohlédl ukázku",
    replied: "Odpověděl", unsubscribed: "Odhlásil se", bounced: "Nedoručeno",
    blocked: "Blokován", status: "Změna stavu",
}

/** Sloupce, které vlastní člověk. Cokoliv mimo seznam se z patche zahodí — skóre,
 *  `source` ani `preview_token` do formuláře nepatří, i kdyby je tam někdo poslal. */
export const EDITABLE = [
    "company", "contact_person", "email", "phone", "website", "ig_handle",
    "client_type", "priority", "meeting_at", "first_contact_at", "next_contact_at",
    "notes", "requirements", "offered", "budget", "next_step", "owner_email",
] as const
export type LeadPatch = Partial<Record<typeof EDITABLE[number], string | null>>

export interface Lead {
    id: string
    ref: string | null
    company: string | null
    contact_person: string | null
    email: string | null
    phone: string | null
    website: string | null
    ig_handle: string | null
    client_type: string | null
    status: string
    priority: string | null
    meeting_at: string | null
    first_contact_at: string | null
    last_contacted_at: string | null
    next_contact_at: string | null
    notes: string | null
    requirements: string | null
    offered: string | null
    budget: string | null
    next_step: string | null
    owner_email: string | null
    source: string
    score: number
    discovered_at: string
    created_at: string
    updated_at: string
}

export interface LeadEvent {
    id: string
    lead_id: string
    kind: string
    detail: Record<string, unknown>
    actor: string | null
    created_at: string
}

export interface LeadResult {
    success: boolean
    lead?: Lead
    error?: string
}
