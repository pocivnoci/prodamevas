"use client"

import { useState, useEffect, useCallback } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { Building2, CalendarClock, ListPlus, Mail, Phone, Plus, RefreshCw, Trash2, X } from "lucide-react"
import {
    listLeads, listLeadEvents, createLead, updateLead, setLeadStatus, addLeadContact, deleteLead,
} from "@/app/actions/lead-actions"
// Číselníky ze slovníku, ne ze souboru akcí — ten smí exportovat jen async funkce.
import {
    HUMAN_STATUSES, STATUS_LABELS, PRIORITY_LABELS, CLIENT_TYPE_LABELS,
    CONTACT_KINDS, CONTACT_KIND_LABELS,
    type Lead, type LeadEvent, type ContactKind, type LeadPatch,
} from "@/lib/leads"
// Pole se chovají jako buňky tabulky a stejná trojice je i v Úkolech — bydlí
// proto ve `shared.tsx`, ne dvakrát okopírovaná.
import { DateField, Field, FilterChip, Select } from "./shared"
import { createTask } from "@/app/actions/task-actions"
import { useStudioNavigate } from "@/app/(dashboard)/StudioContext"

/**
 * Evidence klientů.
 *
 * Nahrazuje `Evidence_klientu.xlsx` — tabulku, která žila v soukromém Drive a měla
 * v sobě telefonní čísla firem. Sloupce jsou schválně tytéž, jaké si tým v tabulce
 * zavedl: kdo přejde sem, nemá se co přeučovat.
 *
 * Dvě věci dělá obrazovka jinak než tabulka, a obojí je oprava, ne vylepšení:
 * číslo leadu přiděluje databáze (v tabulce se K0004 objevilo dvakrát hned první
 * den) a historie kontaktů visí na leadu, ne na zvláštním listu, kam se ručně
 * opisuje ID.
 */

const STATUS_TONE: Record<string, string> = {
    new: "bg-white/5 text-white/50 border-white/10",
    qualified: "bg-sky-500/10 text-sky-300/80 border-sky-500/25",
    contacted: "bg-sky-500/10 text-sky-300/80 border-sky-500/25",
    replied: "bg-violet-500/10 text-violet-300/80 border-violet-500/25",
    negotiating: "bg-amber-500/10 text-amber-300/90 border-amber-500/25",
    offer: "bg-amber-500/15 text-amber-200 border-amber-500/35",
    active: "bg-emerald-500/10 text-emerald-300/90 border-emerald-500/25",
    won: "bg-emerald-500/15 text-emerald-200 border-emerald-500/35",
    lost: "bg-white/5 text-white/25 border-white/10",
    inactive: "bg-white/5 text-white/25 border-white/10",
    rejected: "bg-white/5 text-white/25 border-white/10",
}

const PRIORITY_TONE: Record<string, string> = {
    vysoka: "bg-red-500/10 text-red-300/80 border-red-500/25",
    stredni: "bg-amber-500/10 text-amber-300/80 border-amber-500/25",
    nizka: "bg-white/5 text-white/40 border-white/10",
}

type LeadsTranslator = ReturnType<typeof useTranslations<"adminGrowth.leads">>
type LeadsFormatter = ReturnType<typeof useFormatter>

/** `2026-09-09T12:00:00Z` → `9. 9. 12:00` (podle jazyka UI). Rok se dopisuje jen u cizího roku. */
function shortDateTime(format: LeadsFormatter, iso: string | null): string {
    if (!iso) return ""
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ""
    const now = new Date()
    const withYear = d.getFullYear() !== now.getFullYear()
    const withTime = Boolean(d.getHours() || d.getMinutes())
    return format.dateTime(d, {
        day: "numeric",
        month: "numeric",
        year: withYear ? "numeric" : undefined,
        hour: withTime ? "numeric" : undefined,
        minute: withTime ? "2-digit" : undefined,
    })
}

/**
 * Popisek číselníku z messages. Hodnoty, které UI nezná (zapsal je agent),
 * dostanou slovník z `lib/leads.ts` — ten čtou i e-maily a server, proto se nepřekládá.
 */
function dictLabel(t: LeadsTranslator, group: string, value: string, dict: Record<string, string>): string {
    const key = `${group}.${value}`
    return t.has(key) ? t(key) : (dict[value] || value)
}

/** Volby pro `<Select>` — tytéž klíče jako slovník, popisky z messages. */
function dictOptions(t: LeadsTranslator, group: string, dict: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.keys(dict).map(k => [k, dictLabel(t, group, k, dict)]))
}

/** Do 48 hodin = to je ta věc, kvůli které se obrazovka ráno otevírá. */
function isSoon(iso: string | null): boolean {
    if (!iso) return false
    const t = new Date(iso).getTime()
    return !Number.isNaN(t) && t - Date.now() < 48 * 3600_000 && t > Date.now() - 12 * 3600_000
}

export function LeadsTab() {
    const t = useTranslations("adminGrowth.leads")
    const [leads, setLeads] = useState<Lead[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [q, setQ] = useState("")
    const [statusFilter, setStatusFilter] = useState<string>("")
    const [includeClosed, setIncludeClosed] = useState(false)
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [creating, setCreating] = useState(false)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            setLeads(await listLeads({ q, status: statusFilter || undefined, includeClosed }))
            setError(null)
        } catch (err) {
            setError((err as Error)?.message || t("loadFailed"))
        }
        setLoading(false)
    }, [q, statusFilter, includeClosed, t])

    // Hledání se nepouští po každém písmenu — 300 ms po dopsání.
    useEffect(() => {
        const t = setTimeout(() => { void load() }, q ? 300 : 0)
        return () => clearTimeout(t)
    }, [load, q])

    const patchLocal = (lead: Lead) => setLeads(prev => prev.map(l => l.id === lead.id ? lead : l))

    return (
        <div className="space-y-4">
            {/* Hlavička */}
            <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-white/60">
                    <Building2 className="w-3.5 h-3.5 shrink-0" />{t("header.title")}
                    <span className="text-white/25">{leads.length}</span>
                </span>
                <input
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    placeholder={t("header.searchPlaceholder")}
                    className="flex-1 min-w-[180px] px-3 py-2 bg-[#050505] border border-white/10 rounded-sm text-white text-xs focus:outline-none focus:ring-1 focus:ring-white/20 placeholder:text-white/20"
                />
                <button
                    onClick={() => void load()}
                    title={t("header.reload")}
                    className="px-3 py-2 rounded-sm border border-white/10 text-white/40 hover:text-white hover:border-white/25 transition-all"
                ><RefreshCw className="w-3.5 h-3.5" /></button>
                <button
                    onClick={() => setCreating(v => !v)}
                    className="px-3 py-2 text-[9px] font-bold uppercase tracking-widest rounded-sm border border-white/20 bg-white/10 text-white hover:bg-white/20 transition-all inline-flex items-center gap-1.5"
                ><Plus className="w-3.5 h-3.5" />{t("header.newContact")}</button>
            </div>

            {/* Filtr stavů */}
            <div className="flex flex-wrap items-center gap-1.5">
                <FilterChip active={!statusFilter} onClick={() => setStatusFilter("")} label={t("filter.all")} />
                {HUMAN_STATUSES.map(s => (
                    <FilterChip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)} label={dictLabel(t, "status", s, STATUS_LABELS)} />
                ))}
                <label className="ml-auto flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-white/30 cursor-pointer">
                    <input type="checkbox" checked={includeClosed} onChange={e => setIncludeClosed(e.target.checked)} className="accent-white/40" />
                    {t("filter.includeClosed")}
                </label>
            </div>

            {creating && <NewLeadForm onDone={lead => { setCreating(false); if (lead) { setLeads(p => [lead, ...p]); setExpandedId(lead.id) } }} />}

            {error && <p className="text-[10px] text-red-400">{error}</p>}
            {loading && <p className="text-[10px] uppercase tracking-widest font-bold text-white/25">{t("loading")}</p>}

            {!loading && leads.length === 0 && (
                <div className="border border-white/5 rounded-sm p-8 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">{t("empty.title")}</p>
                    <p className="text-xs text-white/40 mt-2">{t("empty.body")}</p>
                </div>
            )}

            <div className="space-y-1.5">
                {leads.map(lead => (
                    <LeadRow
                        key={lead.id}
                        lead={lead}
                        expanded={expandedId === lead.id}
                        onToggle={() => setExpandedId(id => id === lead.id ? null : lead.id)}
                        onChanged={patchLocal}
                        onDeleted={() => setLeads(p => p.filter(l => l.id !== lead.id))}
                    />
                ))}
            </div>
        </div>
    )
}

// ─── Řádek ───────────────────────────────────────────────────

function LeadRow({ lead, expanded, onToggle, onChanged, onDeleted }: {
    lead: Lead
    expanded: boolean
    onToggle: () => void
    onChanged: (lead: Lead) => void
    onDeleted: () => void
}) {
    const t = useTranslations("adminGrowth.leads")
    const format = useFormatter()
    const soon = isSoon(lead.meeting_at)
    const due = lead.meeting_at || lead.next_contact_at

    return (
        <div className={`border rounded-sm bg-[#0a0a0a] transition-colors ${soon ? "border-amber-500/30" : "border-white/5"}`}>
            <button onClick={onToggle} className="w-full text-left px-3 py-2.5 flex flex-wrap items-center gap-2 hover:bg-white/[0.02] transition-colors">
                <span className="text-[9px] font-mono text-white/25 shrink-0">{lead.ref || "—"}</span>
                <span className="text-sm font-bold text-white/85 flex-1 min-w-[120px]">{lead.company || t("row.noName")}</span>
                {lead.contact_person && <span className="text-xs text-white/40">{lead.contact_person}</span>}
                {lead.phone && (
                    <a
                        href={`tel:${lead.phone.replace(/\s/g, "")}`}
                        onClick={e => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-xs text-white/50 hover:text-white transition-colors"
                    ><Phone className="w-3 h-3 shrink-0" />{lead.phone}</a>
                )}
                {due && (
                    <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${soon ? "text-amber-300" : "text-white/35"}`}>
                        <CalendarClock className="w-3 h-3 shrink-0" />{shortDateTime(format, due)}
                    </span>
                )}
                {lead.priority && (
                    <span className={`text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm border ${PRIORITY_TONE[lead.priority]}`}>
                        {dictLabel(t, "priority", lead.priority, PRIORITY_LABELS)}
                    </span>
                )}
                <span className={`text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-sm border shrink-0 ${STATUS_TONE[lead.status] || STATUS_TONE.new}`}>
                    {dictLabel(t, "status", lead.status, STATUS_LABELS)}
                </span>
            </button>

            {expanded && <LeadDetail lead={lead} onChanged={onChanged} onDeleted={onDeleted} />}
        </div>
    )
}

// ─── Detail ──────────────────────────────────────────────────

function LeadDetail({ lead, onChanged, onDeleted }: {
    lead: Lead
    onChanged: (lead: Lead) => void
    onDeleted: () => void
}) {
    const t = useTranslations("adminGrowth.leads")
    const format = useFormatter()
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [confirmDelete, setConfirmDelete] = useState(false)
    const [taskState, setTaskState] = useState<"idle" | "busy" | "done">("idle")
    const navigate = useStudioNavigate()

    /**
     * Z leadu úkol. Termín se bere z „dalšího kontaktu" — datum už je domluvené
     * a opisovat ho podruhé znamená, že se jednou opíše špatně.
     */
    const createFollowUp = async () => {
        setTaskState("busy")
        const res = await createTask({
            title: t("detail.taskTitle", { name: lead.contact_person || lead.company || t("detail.taskFallbackName") }),
            note: [lead.phone, lead.next_step].filter(Boolean).join(" · ") || null,
            ownerEmail: lead.owner_email,
            dueDate: lead.next_contact_at ? lead.next_contact_at.slice(0, 10) : null,
        })
        if (res.success) setTaskState("done")
        else { setTaskState("idle"); setError(res.error || t("detail.taskFailed")) }
    }

    /** Ukládá se na blur, ne na každý znak: pole se chová jako buňka v tabulce. */
    const save = async (patch: LeadPatch) => {
        setBusy(true)
        const res = await updateLead(lead.id, patch)
        setBusy(false)
        if (res.success && res.lead) { onChanged(res.lead); setError(null) }
        else setError(res.error || t("detail.saveFailed"))
    }

    const changeStatus = async (status: string) => {
        setBusy(true)
        const res = await setLeadStatus(lead.id, status)
        setBusy(false)
        if (res.success && res.lead) { onChanged(res.lead); setError(null) }
        else setError(res.error || t("detail.statusFailed"))
    }

    return (
        <div className="px-3 pb-3 pt-1 space-y-4 border-t border-white/5">
            {/* Stav — jedno kliknutí, ne rozbalovací menu */}
            <div className="flex flex-wrap items-center gap-1.5 pt-3">
                <span className="text-[8px] font-bold uppercase tracking-widest text-white/30 mr-1">{t("detail.statusLabel")}</span>
                {HUMAN_STATUSES.map(s => (
                    <button
                        key={s}
                        disabled={busy}
                        onClick={() => void changeStatus(s)}
                        className={`px-2 py-1 text-[8px] font-bold uppercase tracking-widest rounded-sm border transition-all disabled:opacity-40 ${
                            lead.status === s ? STATUS_TONE[s] : "bg-transparent text-white/30 border-white/10 hover:text-white/70"
                        }`}
                    >{dictLabel(t, "status", s, STATUS_LABELS)}</button>
                ))}
            </div>

            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3">
                <Field label={t("detail.fields.company")} value={lead.company} onSave={v => save({ company: v })} />
                <Field label={t("detail.fields.contactPerson")} value={lead.contact_person} onSave={v => save({ contact_person: v })} />
                <Field label={t("detail.fields.phone")} value={lead.phone} onSave={v => save({ phone: v })} />
                <Field label={t("detail.fields.email")} value={lead.email} onSave={v => save({ email: v })} />
                <Field label={t("detail.fields.website")} value={lead.website} onSave={v => save({ website: v })} />
                <Select label={t("detail.fields.clientType")} value={lead.client_type} options={dictOptions(t, "clientType", CLIENT_TYPE_LABELS)} onSave={v => save({ client_type: v })} />
                <Select label={t("detail.fields.priority")} value={lead.priority} options={dictOptions(t, "priority", PRIORITY_LABELS)} onSave={v => save({ priority: v })} />
                <Field label={t("detail.fields.owner")} value={lead.owner_email} onSave={v => save({ owner_email: v })} />
                <DateField label={t("detail.fields.meetingAt")} value={lead.meeting_at} onSave={v => save({ meeting_at: v })} />
                <DateField label={t("detail.fields.nextContactAt")} value={lead.next_contact_at} onSave={v => save({ next_contact_at: v })} />
                <Field label={t("detail.fields.budget")} value={lead.budget} onSave={v => save({ budget: v })} />
                <Field label={t("detail.fields.nextStep")} value={lead.next_step} onSave={v => save({ next_step: v })} />
            </div>

            <div className="space-y-3">
                <Field label={t("detail.fields.requirements")} value={lead.requirements} onSave={v => save({ requirements: v })} multiline />
                <Field label={t("detail.fields.offered")} value={lead.offered} onSave={v => save({ offered: v })} multiline />
                <Field label={t("detail.fields.notes")} value={lead.notes} onSave={v => save({ notes: v })} multiline />
            </div>

            {error && <p className="text-[10px] text-red-400">{error}</p>}

            <ContactThread lead={lead} onChanged={onChanged} />

            {/* Co s leadem dál — obojí vede jinam do studia, aby se nemuselo
                přepisovat jméno ani adresa do druhé obrazovky. */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                    onClick={createFollowUp}
                    disabled={taskState !== "idle"}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest rounded-sm border border-white/10 text-white/50 hover:text-white hover:bg-white/5 transition-all disabled:opacity-40"
                ><ListPlus className="w-3 h-3 shrink-0" />{taskState === "done" ? t("detail.taskDone") : t("detail.createTask")}</button>
                {lead.email && (
                    <button
                        onClick={() => navigate("mailing", { to: lead.email! })}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest rounded-sm border border-white/10 text-white/50 hover:text-white hover:bg-white/5 transition-all"
                    ><Mail className="w-3 h-3 shrink-0" />{t("detail.writeEmail")}</button>
                )}
            </div>

            <div className="flex items-center gap-3 pt-1">
                <span className="text-[9px] text-white/20 uppercase tracking-widest font-bold">
                    {t("detail.founded", { date: shortDateTime(format, lead.discovered_at), source: lead.source === "manual" ? t("detail.sourceManual") : lead.source })}
                </span>
                <button
                    onClick={() => {
                        if (!confirmDelete) { setConfirmDelete(true); return }
                        void deleteLead(lead.id).then(res => { if (res.success) onDeleted(); else setError(res.error || t("detail.deleteFailed")) })
                    }}
                    className="ml-auto inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-white/25 hover:text-red-400 transition-colors"
                ><Trash2 className="w-3 h-3 shrink-0" />{confirmDelete ? t("detail.confirmDelete") : t("detail.delete")}</button>
                {confirmDelete && (
                    <button onClick={() => setConfirmDelete(false)} className="text-[9px] font-bold uppercase tracking-widest text-white/40 hover:text-white">
                        <X className="w-3 h-3" />
                    </button>
                )}
            </div>
        </div>
    )
}

// ─── Historie kontaktů ───────────────────────────────────────

function ContactThread({ lead, onChanged }: { lead: Lead; onChanged: (lead: Lead) => void }) {
    const t = useTranslations("adminGrowth.leads")
    const format = useFormatter()
    const [events, setEvents] = useState<LeadEvent[]>([])
    const [loading, setLoading] = useState(true)
    const [kind, setKind] = useState<ContactKind>("call")
    const [note, setNote] = useState("")
    const [nextStep, setNextStep] = useState("")
    const [nextAt, setNextAt] = useState("")
    const [busy, setBusy] = useState(false)

    /** Po zápisu kontaktu. Volá se z obsluhy tlačítka, ne z effectu. */
    const reload = useCallback(async () => {
        setEvents(await listLeadEvents(lead.id))
    }, [lead.id])

    // `loading` startuje zapnuté a effect ho jen zháší — rozsvěcet ho synchronně
    // na začátku by byl setState hned při běhu effectu, tedy render navíc pokaždé,
    // co se vlákno otevře. `alive` hlídá rychlé zavření: odpověď na zavřený detail
    // by jinak přepsala události leadu, který už je na obrazovce jiný.
    useEffect(() => {
        let alive = true
        listLeadEvents(lead.id).then(rows => {
            if (!alive) return
            setEvents(rows)
            setLoading(false)
        })
        return () => { alive = false }
    }, [lead.id])

    const submit = async () => {
        if (!note.trim() || busy) return
        setBusy(true)
        const res = await addLeadContact(lead.id, {
            kind,
            note,
            nextStep: nextStep || null,
            nextAt: nextAt ? new Date(nextAt).toISOString() : null,
        })
        setBusy(false)
        if (res.success && res.lead) {
            onChanged(res.lead)
            setNote(""); setNextStep(""); setNextAt("")
            void reload()
        }
    }

    return (
        <div className="border-t border-white/5 pt-3 space-y-2">
            <span className="text-[8px] font-bold uppercase tracking-widest text-white/30">{t("thread.title")}</span>

            {/* Zápis kontaktu */}
            <div className="space-y-2 bg-[#050505] border border-white/10 rounded-sm p-2.5">
                <div className="flex flex-wrap gap-1.5">
                    {CONTACT_KINDS.map(k => (
                        <button
                            key={k}
                            onClick={() => setKind(k)}
                            className={`px-2 py-1 text-[8px] font-bold uppercase tracking-widest rounded-sm border transition-all ${
                                kind === k ? "bg-white/10 text-white border-white/20" : "bg-transparent text-white/30 border-white/10 hover:text-white/70"
                            }`}
                        >{dictLabel(t, "contactKind", k, CONTACT_KIND_LABELS)}</button>
                    ))}
                </div>
                <textarea
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    placeholder={t("thread.notePlaceholder")}
                    rows={2}
                    className="w-full px-3 py-2 bg-[#0a0a0a] border border-white/10 rounded-sm text-white text-xs resize-y focus:outline-none focus:ring-1 focus:ring-white/20 placeholder:text-white/20"
                />
                <div className="flex flex-wrap gap-2">
                    <input
                        value={nextStep}
                        onChange={e => setNextStep(e.target.value)}
                        placeholder={t("thread.nextStepPlaceholder")}
                        className="flex-1 min-w-[140px] px-3 py-2 bg-[#0a0a0a] border border-white/10 rounded-sm text-white text-xs focus:outline-none focus:ring-1 focus:ring-white/20 placeholder:text-white/20"
                    />
                    <input
                        type="datetime-local"
                        value={nextAt}
                        onChange={e => setNextAt(e.target.value)}
                        className="px-3 py-2 bg-[#0a0a0a] border border-white/10 rounded-sm text-white/80 text-xs focus:outline-none focus:ring-1 focus:ring-white/20"
                    />
                    <button
                        onClick={submit}
                        disabled={busy || !note.trim()}
                        className="px-4 py-2 text-[9px] font-bold uppercase tracking-widest rounded-sm bg-white/10 text-white border border-white/20 hover:bg-white/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >{busy ? t("thread.saving") : t("thread.submit")}</button>
                </div>
            </div>

            {/* Osa. Události agenta jsou v témže vlákně — je to jeden příběh kontaktu. */}
            {loading ? (
                <p className="text-[9px] uppercase tracking-widest font-bold text-white/20">{t("loading")}</p>
            ) : events.length === 0 ? (
                <p className="text-[10px] text-white/25">{t("thread.empty")}</p>
            ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                    {events.map(ev => {
                        const detail = ev.detail as { note?: string; next_step?: string; label?: string }
                        return (
                            <div key={ev.id} className="flex items-start gap-2 text-xs">
                                <span className="text-[8px] font-bold uppercase tracking-widest text-white/25 w-24 shrink-0 pt-0.5">
                                    {shortDateTime(format, ev.created_at)}
                                </span>
                                <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm border border-white/10 text-white/40 shrink-0">
                                    {dictLabel(t, "contactKind", ev.kind, CONTACT_KIND_LABELS)}
                                </span>
                                <span className="text-white/60 flex-1">
                                    {detail?.note || detail?.label || "—"}
                                    {detail?.next_step && <span className="text-white/30"> → {detail.next_step}</span>}
                                </span>
                                <span className="text-[8px] text-white/20 shrink-0">{ev.actor ? ev.actor.split("@")[0] : t("thread.agent")}</span>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

// ─── Nový kontakt ────────────────────────────────────────────

function NewLeadForm({ onDone }: { onDone: (lead: Lead | null) => void }) {
    const t = useTranslations("adminGrowth.leads")
    const [company, setCompany] = useState("")
    const [contactPerson, setContactPerson] = useState("")
    const [phone, setPhone] = useState("")
    const [email, setEmail] = useState("")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const submit = async () => {
        if (!company.trim() || busy) return
        setBusy(true)
        const res = await createLead({ company, contactPerson, phone, email, clientType: "firma" })
        setBusy(false)
        if (res.success && res.lead) onDone(res.lead)
        else setError(res.error || t("newLead.createFailed"))
    }

    return (
        <div className="border border-white/10 bg-[#050505] rounded-sm p-3 space-y-2">
            <div className="grid sm:grid-cols-4 gap-2">
                <input value={company} onChange={e => setCompany(e.target.value)} placeholder={t("newLead.companyPlaceholder")} autoFocus
                    className="px-3 py-2 bg-[#0a0a0a] border border-white/10 rounded-sm text-white text-xs focus:outline-none focus:ring-1 focus:ring-white/20 placeholder:text-white/20" />
                <input value={contactPerson} onChange={e => setContactPerson(e.target.value)} placeholder={t("detail.fields.contactPerson")}
                    className="px-3 py-2 bg-[#0a0a0a] border border-white/10 rounded-sm text-white text-xs focus:outline-none focus:ring-1 focus:ring-white/20 placeholder:text-white/20" />
                <input value={phone} onChange={e => setPhone(e.target.value)} placeholder={t("detail.fields.phone")}
                    className="px-3 py-2 bg-[#0a0a0a] border border-white/10 rounded-sm text-white text-xs focus:outline-none focus:ring-1 focus:ring-white/20 placeholder:text-white/20" />
                <input value={email} onChange={e => setEmail(e.target.value)} placeholder={t("detail.fields.email")}
                    className="px-3 py-2 bg-[#0a0a0a] border border-white/10 rounded-sm text-white text-xs focus:outline-none focus:ring-1 focus:ring-white/20 placeholder:text-white/20" />
            </div>
            <div className="flex items-center gap-2">
                <button onClick={submit} disabled={busy || !company.trim()}
                    className="px-4 py-2 text-[9px] font-bold uppercase tracking-widest rounded-sm bg-white/10 text-white border border-white/20 hover:bg-white/20 transition-all disabled:opacity-40">
                    {busy ? t("newLead.creating") : t("newLead.create")}
                </button>
                <button onClick={() => onDone(null)} className="px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-white/40 hover:text-white transition-all">
                    {t("newLead.cancel")}
                </button>
                {/* Bez tohohle by se dalo čekat, že se firmě něco odešle. Neodešle. */}
                <span className="text-[8px] uppercase tracking-widest font-bold text-white/20 ml-auto text-right">
                    {t("newLead.noSendNote")}
                </span>
            </div>
            {error && <p className="text-[10px] text-red-400">{error}</p>}
        </div>
    )
}
