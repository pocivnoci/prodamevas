"use client"

import { useState, useEffect, useCallback } from "react"
import { Building2, CalendarClock, Phone, Plus, RefreshCw, Trash2, X } from "lucide-react"
import {
    listLeads, listLeadEvents, createLead, updateLead, setLeadStatus, addLeadContact, deleteLead,
} from "@/app/actions/lead-actions"
// Číselníky ze slovníku, ne ze souboru akcí — ten smí exportovat jen async funkce.
import {
    HUMAN_STATUSES, STATUS_LABELS, PRIORITY_LABELS, CLIENT_TYPE_LABELS,
    CONTACT_KINDS, CONTACT_KIND_LABELS,
    type Lead, type LeadEvent, type ContactKind, type LeadPatch,
} from "@/lib/leads"

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

/** `2026-09-09T12:00:00Z` → `9. 9. 12:00`. Rok se dopisuje jen u cizího roku. */
function czDateTime(iso: string | null): string {
    if (!iso) return ""
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ""
    const now = new Date()
    const year = d.getFullYear() === now.getFullYear() ? "" : ` ${d.getFullYear()}`
    const time = d.getHours() || d.getMinutes() ? ` ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}` : ""
    return `${d.getDate()}. ${d.getMonth() + 1}.${year}${time}`
}

/** ISO → hodnota pro `datetime-local`, v místním čase. Bez posunu by schůzka
 *  ve 12:00 vyskočila v poli jako 10:00 a někdo by ji „opravil". */
function toLocalInput(iso: string | null): string {
    if (!iso) return ""
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ""
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Do 48 hodin = to je ta věc, kvůli které se obrazovka ráno otevírá. */
function isSoon(iso: string | null): boolean {
    if (!iso) return false
    const t = new Date(iso).getTime()
    return !Number.isNaN(t) && t - Date.now() < 48 * 3600_000 && t > Date.now() - 12 * 3600_000
}

export function LeadsTab() {
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
            setError((err as Error)?.message || "Načtení selhalo.")
        }
        setLoading(false)
    }, [q, statusFilter, includeClosed])

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
                    <Building2 className="w-3.5 h-3.5 shrink-0" />Evidence klientů
                    <span className="text-white/25">{leads.length}</span>
                </span>
                <input
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    placeholder="Hledat firmu, člověka, telefon…"
                    className="flex-1 min-w-[180px] px-3 py-2 bg-[#050505] border border-white/10 rounded-sm text-white text-xs focus:outline-none focus:ring-1 focus:ring-white/20 placeholder:text-white/20"
                />
                <button
                    onClick={() => void load()}
                    title="Načíst znovu"
                    className="px-3 py-2 rounded-sm border border-white/10 text-white/40 hover:text-white hover:border-white/25 transition-all"
                ><RefreshCw className="w-3.5 h-3.5" /></button>
                <button
                    onClick={() => setCreating(v => !v)}
                    className="px-3 py-2 text-[9px] font-bold uppercase tracking-widest rounded-sm border border-white/20 bg-white/10 text-white hover:bg-white/20 transition-all inline-flex items-center gap-1.5"
                ><Plus className="w-3.5 h-3.5" />Nový kontakt</button>
            </div>

            {/* Filtr stavů */}
            <div className="flex flex-wrap items-center gap-1.5">
                <FilterChip active={!statusFilter} onClick={() => setStatusFilter("")} label="Vše" />
                {HUMAN_STATUSES.map(s => (
                    <FilterChip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)} label={STATUS_LABELS[s]} />
                ))}
                <label className="ml-auto flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-white/30 cursor-pointer">
                    <input type="checkbox" checked={includeClosed} onChange={e => setIncludeClosed(e.target.checked)} className="accent-white/40" />
                    I uzavřené
                </label>
            </div>

            {creating && <NewLeadForm onDone={lead => { setCreating(false); if (lead) { setLeads(p => [lead, ...p]); setExpandedId(lead.id) } }} />}

            {error && <p className="text-[10px] text-red-400">{error}</p>}
            {loading && <p className="text-[10px] uppercase tracking-widest font-bold text-white/25">Načítám…</p>}

            {!loading && leads.length === 0 && (
                <div className="border border-white/5 rounded-sm p-8 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">Zatím tu nikdo není</p>
                    <p className="text-xs text-white/40 mt-2">Přidej první firmu, nebo zruš filtr.</p>
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

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
    return (
        <button
            onClick={onClick}
            className={`px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest rounded-sm border transition-all ${
                active ? "bg-white/10 text-white border-white/20" : "bg-transparent text-white/35 border-white/10 hover:text-white/70"
            }`}
        >{label}</button>
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
    const soon = isSoon(lead.meeting_at)
    const due = lead.meeting_at || lead.next_contact_at

    return (
        <div className={`border rounded-sm bg-[#0a0a0a] transition-colors ${soon ? "border-amber-500/30" : "border-white/5"}`}>
            <button onClick={onToggle} className="w-full text-left px-3 py-2.5 flex flex-wrap items-center gap-2 hover:bg-white/[0.02] transition-colors">
                <span className="text-[9px] font-mono text-white/25 shrink-0">{lead.ref || "—"}</span>
                <span className="text-sm font-bold text-white/85 flex-1 min-w-[120px]">{lead.company || "Bez názvu"}</span>
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
                        <CalendarClock className="w-3 h-3 shrink-0" />{czDateTime(due)}
                    </span>
                )}
                {lead.priority && (
                    <span className={`text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm border ${PRIORITY_TONE[lead.priority]}`}>
                        {PRIORITY_LABELS[lead.priority]}
                    </span>
                )}
                <span className={`text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-sm border shrink-0 ${STATUS_TONE[lead.status] || STATUS_TONE.new}`}>
                    {STATUS_LABELS[lead.status] || lead.status}
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
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [confirmDelete, setConfirmDelete] = useState(false)

    /** Ukládá se na blur, ne na každý znak: pole se chová jako buňka v tabulce. */
    const save = async (patch: LeadPatch) => {
        setBusy(true)
        const res = await updateLead(lead.id, patch)
        setBusy(false)
        if (res.success && res.lead) { onChanged(res.lead); setError(null) }
        else setError(res.error || "Uložení selhalo.")
    }

    const changeStatus = async (status: string) => {
        setBusy(true)
        const res = await setLeadStatus(lead.id, status)
        setBusy(false)
        if (res.success && res.lead) { onChanged(res.lead); setError(null) }
        else setError(res.error || "Změna stavu selhala.")
    }

    return (
        <div className="px-3 pb-3 pt-1 space-y-4 border-t border-white/5">
            {/* Stav — jedno kliknutí, ne rozbalovací menu */}
            <div className="flex flex-wrap items-center gap-1.5 pt-3">
                <span className="text-[8px] font-bold uppercase tracking-widest text-white/30 mr-1">Stav</span>
                {HUMAN_STATUSES.map(s => (
                    <button
                        key={s}
                        disabled={busy}
                        onClick={() => void changeStatus(s)}
                        className={`px-2 py-1 text-[8px] font-bold uppercase tracking-widest rounded-sm border transition-all disabled:opacity-40 ${
                            lead.status === s ? STATUS_TONE[s] : "bg-transparent text-white/30 border-white/10 hover:text-white/70"
                        }`}
                    >{STATUS_LABELS[s]}</button>
                ))}
            </div>

            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3">
                <Field label="Firma / klient" value={lead.company} onSave={v => save({ company: v })} />
                <Field label="Kontaktní osoba" value={lead.contact_person} onSave={v => save({ contact_person: v })} />
                <Field label="Telefon" value={lead.phone} onSave={v => save({ phone: v })} />
                <Field label="E-mail" value={lead.email} onSave={v => save({ email: v })} />
                <Field label="Web" value={lead.website} onSave={v => save({ website: v })} />
                <Select label="Typ klienta" value={lead.client_type} options={CLIENT_TYPE_LABELS} onSave={v => save({ client_type: v })} />
                <Select label="Priorita" value={lead.priority} options={PRIORITY_LABELS} onSave={v => save({ priority: v })} />
                <Field label="Odpovědná osoba" value={lead.owner_email} onSave={v => save({ owner_email: v })} />
                <DateField label="Termín osobní schůzky" value={lead.meeting_at} onSave={v => save({ meeting_at: v })} />
                <DateField label="Další kontakt" value={lead.next_contact_at} onSave={v => save({ next_contact_at: v })} />
                <Field label="Cena / rozpočet" value={lead.budget} onSave={v => save({ budget: v })} />
                <Field label="Další kroky" value={lead.next_step} onSave={v => save({ next_step: v })} />
            </div>

            <div className="space-y-3">
                <Field label="Konkrétní požadavky" value={lead.requirements} onSave={v => save({ requirements: v })} multiline />
                <Field label="Co jsme nabídli" value={lead.offered} onSave={v => save({ offered: v })} multiline />
                <Field label="Poznámky" value={lead.notes} onSave={v => save({ notes: v })} multiline />
            </div>

            {error && <p className="text-[10px] text-red-400">{error}</p>}

            <ContactThread lead={lead} onChanged={onChanged} />

            <div className="flex items-center gap-3 pt-1">
                <span className="text-[9px] text-white/20 uppercase tracking-widest font-bold">
                    Založeno {czDateTime(lead.discovered_at)} · {lead.source === "manual" ? "ručně" : lead.source}
                </span>
                <button
                    onClick={() => {
                        if (!confirmDelete) { setConfirmDelete(true); return }
                        void deleteLead(lead.id).then(res => { if (res.success) onDeleted(); else setError(res.error || "Smazání selhalo.") })
                    }}
                    className="ml-auto inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-white/25 hover:text-red-400 transition-colors"
                ><Trash2 className="w-3 h-3 shrink-0" />{confirmDelete ? "Opravdu smazat?" : "Smazat"}</button>
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
            <span className="text-[8px] font-bold uppercase tracking-widest text-white/30">Historie kontaktů</span>

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
                        >{CONTACT_KIND_LABELS[k]}</button>
                    ))}
                </div>
                <textarea
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    placeholder="Jak to dopadlo — jednou větou"
                    rows={2}
                    className="w-full px-3 py-2 bg-[#0a0a0a] border border-white/10 rounded-sm text-white text-xs resize-y focus:outline-none focus:ring-1 focus:ring-white/20 placeholder:text-white/20"
                />
                <div className="flex flex-wrap gap-2">
                    <input
                        value={nextStep}
                        onChange={e => setNextStep(e.target.value)}
                        placeholder="Další krok (nepovinné)"
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
                    >{busy ? "Ukládám…" : "Zapsat"}</button>
                </div>
            </div>

            {/* Osa. Události agenta jsou v témže vlákně — je to jeden příběh kontaktu. */}
            {loading ? (
                <p className="text-[9px] uppercase tracking-widest font-bold text-white/20">Načítám…</p>
            ) : events.length === 0 ? (
                <p className="text-[10px] text-white/25">Zatím žádný záznam.</p>
            ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                    {events.map(ev => {
                        const detail = ev.detail as { note?: string; next_step?: string; label?: string }
                        return (
                            <div key={ev.id} className="flex items-start gap-2 text-xs">
                                <span className="text-[8px] font-bold uppercase tracking-widest text-white/25 w-24 shrink-0 pt-0.5">
                                    {czDateTime(ev.created_at)}
                                </span>
                                <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm border border-white/10 text-white/40 shrink-0">
                                    {CONTACT_KIND_LABELS[ev.kind] || ev.kind}
                                </span>
                                <span className="text-white/60 flex-1">
                                    {detail?.note || detail?.label || "—"}
                                    {detail?.next_step && <span className="text-white/30"> → {detail.next_step}</span>}
                                </span>
                                <span className="text-[8px] text-white/20 shrink-0">{ev.actor ? ev.actor.split("@")[0] : "agent"}</span>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

// ─── Pole ────────────────────────────────────────────────────

function Field({ label, value, onSave, multiline }: {
    label: string
    value: string | null
    onSave: (v: string) => void | Promise<void>
    multiline?: boolean
}) {
    const [draft, setDraft] = useState(value ?? "")
    const [synced, setSynced] = useState(value ?? "")

    // Zdroj pravdy je řádek, ne rozepsané pole — po uložení i po cizí změně musí
    // pole ukazovat, co v databázi opravdu je. Srovnává se při renderu; efekt by
    // hodnotu nejdřív vykreslil starou a hned přepsal, a psaní by přišlo o znak.
    if (synced !== (value ?? "")) { setSynced(value ?? ""); setDraft(value ?? "") }

    const commit = () => { if (draft !== (value ?? "")) void onSave(draft) }
    const Tag = multiline ? "textarea" : "input"

    return (
        <label className="block">
            <span className="block text-[8px] font-bold uppercase tracking-widest text-white/30 mb-1">{label}</span>
            <Tag
                value={draft}
                rows={multiline ? 2 : undefined}
                onChange={(e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e: React.KeyboardEvent) => {
                    if (e.key === "Escape") { setDraft(value ?? ""); (e.target as HTMLElement).blur() }
                    if (e.key === "Enter" && !multiline) (e.target as HTMLElement).blur()
                }}
                className="w-full px-2.5 py-1.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs resize-y focus:outline-none focus:ring-1 focus:ring-white/20 placeholder:text-white/20"
            />
        </label>
    )
}

function Select({ label, value, options, onSave }: {
    label: string
    value: string | null
    options: Record<string, string>
    onSave: (v: string) => void | Promise<void>
}) {
    return (
        <label className="block">
            <span className="block text-[8px] font-bold uppercase tracking-widest text-white/30 mb-1">{label}</span>
            <select
                value={value ?? ""}
                onChange={e => void onSave(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs focus:outline-none focus:ring-1 focus:ring-white/20"
            >
                <option value="">—</option>
                {Object.entries(options).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
        </label>
    )
}

function DateField({ label, value, onSave }: {
    label: string
    value: string | null
    onSave: (v: string) => void | Promise<void>
}) {
    return (
        <label className="block">
            <span className="block text-[8px] font-bold uppercase tracking-widest text-white/30 mb-1">{label}</span>
            <input
                type="datetime-local"
                defaultValue={toLocalInput(value)}
                onChange={e => void onSave(e.target.value ? new Date(e.target.value).toISOString() : "")}
                className="w-full px-2.5 py-1.5 bg-[#050505] border border-white/10 rounded-sm text-white/80 text-xs focus:outline-none focus:ring-1 focus:ring-white/20"
            />
        </label>
    )
}

// ─── Nový kontakt ────────────────────────────────────────────

function NewLeadForm({ onDone }: { onDone: (lead: Lead | null) => void }) {
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
        else setError(res.error || "Založení selhalo.")
    }

    return (
        <div className="border border-white/10 bg-[#050505] rounded-sm p-3 space-y-2">
            <div className="grid sm:grid-cols-4 gap-2">
                <input value={company} onChange={e => setCompany(e.target.value)} placeholder="Firma *" autoFocus
                    className="px-3 py-2 bg-[#0a0a0a] border border-white/10 rounded-sm text-white text-xs focus:outline-none focus:ring-1 focus:ring-white/20 placeholder:text-white/20" />
                <input value={contactPerson} onChange={e => setContactPerson(e.target.value)} placeholder="Kontaktní osoba"
                    className="px-3 py-2 bg-[#0a0a0a] border border-white/10 rounded-sm text-white text-xs focus:outline-none focus:ring-1 focus:ring-white/20 placeholder:text-white/20" />
                <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Telefon"
                    className="px-3 py-2 bg-[#0a0a0a] border border-white/10 rounded-sm text-white text-xs focus:outline-none focus:ring-1 focus:ring-white/20 placeholder:text-white/20" />
                <input value={email} onChange={e => setEmail(e.target.value)} placeholder="E-mail"
                    className="px-3 py-2 bg-[#0a0a0a] border border-white/10 rounded-sm text-white text-xs focus:outline-none focus:ring-1 focus:ring-white/20 placeholder:text-white/20" />
            </div>
            <div className="flex items-center gap-2">
                <button onClick={submit} disabled={busy || !company.trim()}
                    className="px-4 py-2 text-[9px] font-bold uppercase tracking-widest rounded-sm bg-white/10 text-white border border-white/20 hover:bg-white/20 transition-all disabled:opacity-40">
                    {busy ? "Zakládám…" : "Založit"}
                </button>
                <button onClick={() => onDone(null)} className="px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-white/40 hover:text-white transition-all">
                    Zrušit
                </button>
                {/* Bez tohohle by se dalo čekat, že se firmě něco odešle. Neodešle. */}
                <span className="text-[8px] uppercase tracking-widest font-bold text-white/20 ml-auto text-right">
                    Nic se neodesílá · robot ručně zavedený kontakt neosloví
                </span>
            </div>
            {error && <p className="text-[10px] text-red-400">{error}</p>}
        </div>
    )
}
