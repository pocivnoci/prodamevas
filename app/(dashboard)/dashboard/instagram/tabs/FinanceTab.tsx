"use client"

import { useEffect, useState, useCallback } from "react"
import { Plus, Trash2 } from "lucide-react"
import {
    getFinanceOverview, createFinanceEntry, updateFinanceEntry, deleteFinanceEntry,
    type FinanceOverview,
} from "@/app/actions/finance-actions"
import {
    KIND_LABELS, COST_TYPE_LABELS, formatCzk,
    type FinanceEntry,
} from "@/lib/finance"
import { listTeam } from "@/app/actions/task-actions"
import type { TeamMember } from "@/lib/team"

/**
 * Finance — kolik jsme do firmy dali a co nás stojí provoz.
 *
 * **Evidence, ne účetnictví.** Žádné grafy, žádné napojení na Fakturoid ani na
 * banku: zadání znělo „náklady (fixní, variabilní), co kdo platil a kdo kolik
 * dal peněz". Čtyři čísla nahoře jsou součet řádků pod nimi, ne report — kdyby
 * se odsud dělaly výkazy, potřebuje to nejdřív jiná data než ruční zápis.
 *
 * Doklady zákazníků sem nepatří a nikdy nepatřily: vydané žijí v `invoices`,
 * přijaté platby v `payments`. Tahle obrazovka drží jen to, co v nich není.
 */

const inputClass = "px-3 py-2 bg-[#0a0a0a] border border-white/10 rounded-sm text-white text-xs focus:outline-none focus:ring-1 focus:ring-white/20 placeholder:text-white/20"

/** Kdo platil. `team_members` plus firemní karta — ta žádného člena nemá. */
const FIRMA = "Firma"

type Filtr = "vse" | "naklad" | "vklad"

const FILTR_LABEL: Record<Filtr, string> = {
    vse: "Vše",
    naklad: "Náklady",
    vklad: "Vklady",
}

export function FinanceTab() {
    const [data, setData] = useState<FinanceOverview | null>(null)
    const [team, setTeam] = useState<TeamMember[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [creating, setCreating] = useState(false)
    const [filtr, setFiltr] = useState<Filtr>("vse")

    // Stav se přepisuje v callbacku promisy, ne v těle efektu: setState přímo
    // v efektu rozjede kaskádu renderů (a ESLint ho právem hlásí).
    const load = useCallback(() => (
        // Prázdná evidence a rozbitý dotaz vypadají stejně („Zatím nic"). U peněz
        // je ta záměna nejhorší možná, proto se chyba ukáže jako chyba.
        getFinanceOverview()
            .then(d => { setData(d); setError(null) })
            .catch((err: Error) => { setData(null); setError(err?.message || "Evidenci se nepodařilo načíst.") })
            .finally(() => setLoading(false))
    ), [])

    useEffect(() => { void load() }, [load])
    useEffect(() => { listTeam().then(setTeam).catch(() => setTeam([])) }, [])

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-white/20 border-t-white/80" />
            </div>
        )
    }

    if (error) {
        return (
            <div className="border border-red-500/20 bg-red-500/5 rounded-sm p-6 text-center space-y-3">
                <p className="text-[10px] text-red-300 uppercase font-bold tracking-widest">Evidence se nenačetla</p>
                <p className="text-xs text-white/40">{error}</p>
                <button
                    onClick={() => { setLoading(true); void load() }}
                    className="px-4 py-2 text-[9px] font-bold uppercase tracking-widest rounded-sm border border-white/15 text-white/60 hover:text-white hover:bg-white/5 transition-all"
                >Zkusit znovu</button>
            </div>
        )
    }

    const entries = data?.entries ?? []
    const totals = data?.totals
    const zobrazene = entries.filter(e => filtr === "vse" || e.kind === filtr)
    const lide = [...team.filter(m => m.active).map(m => m.name), FIRMA]

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap gap-3">
                <Stat label="Fixní náklady" value={formatCzk(totals?.fixni ?? 0)} />
                <Stat label="Variabilní náklady" value={formatCzk(totals?.variabilni ?? 0)} />
                <Stat label="Vklady" value={formatCzk(totals?.vklady ?? 0)} />
                <Stat
                    label="Zůstatek z vkladů"
                    value={formatCzk(totals?.zustatek ?? 0)}
                    tone={(totals?.zustatek ?? 0) < 0 ? "warn" : "ok"}
                />
            </div>

            <div className="flex flex-wrap items-center gap-2">
                {(["vse", "naklad", "vklad"] as Filtr[]).map(f => (
                    <button
                        key={f}
                        onClick={() => setFiltr(f)}
                        className={`px-3 py-1.5 rounded-sm border text-[9px] uppercase tracking-widest font-bold transition-colors ${
                            filtr === f
                                ? "border-white/20 bg-white/10 text-white"
                                : "border-white/5 bg-[#080808] text-white/40 hover:text-white/70"
                        }`}
                    >
                        {FILTR_LABEL[f]}
                    </button>
                ))}
                <button
                    onClick={() => setCreating(v => !v)}
                    className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest rounded-sm border border-white/10 text-white/50 hover:text-white hover:bg-white/5 transition-all"
                >
                    <Plus className="w-3.5 h-3.5 shrink-0" />Nový záznam
                </button>
            </div>

            {creating && (
                <NewEntryForm
                    lide={lide}
                    onDone={async (ulozeno) => {
                        setCreating(false)
                        if (ulozeno) await load()
                    }}
                />
            )}

            {zobrazene.length === 0 ? (
                <div className="text-center py-20">
                    <p className="text-4xl mb-3 opacity-30">💰</p>
                    <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest">
                        {entries.length === 0 ? "Zatím žádný záznam" : "V tomhle filtru nic není"}
                    </p>
                </div>
            ) : (
                <div className="overflow-x-auto border border-white/5 rounded-sm">
                    <table className="w-full text-left min-w-[720px]">
                        <thead>
                            <tr className="border-b border-white/5">
                                {["Datum", "Co", "Druh", "Kdo", "Částka", ""].map((h, i) => (
                                    <th key={h || `akce-${i}`} className="px-4 py-3 text-[9px] uppercase tracking-widest font-bold text-white/30">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {zobrazene.map(e => <Row key={e.id} e={e} onChanged={load} />)}
                        </tbody>
                    </table>
                </div>
            )}

            <p className="text-[9px] text-white/20 font-bold uppercase tracking-widest">
                Ruční evidence, ne účetnictví · vydané doklady žijí ve fakturaci, přijaté platby u předplatného ·
                zůstatek = vklady minus všechny náklady
            </p>
        </div>
    )
}

// ─── Nový záznam ─────────────────────────────────────────────

function NewEntryForm({ lide, onDone }: { lide: string[]; onDone: (ulozeno: boolean) => void | Promise<void> }) {
    const [kind, setKind] = useState("naklad")
    const [costType, setCostType] = useState("fixni")
    const [amount, setAmount] = useState("")
    const [label, setLabel] = useState("")
    const [person, setPerson] = useState(lide[0] ?? "")
    const [happenedOn, setHappenedOn] = useState(() => new Date().toISOString().slice(0, 10))
    const [note, setNote] = useState("")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const submit = async () => {
        if (busy) return
        setBusy(true)
        setError(null)
        const res = await createFinanceEntry({
            kind,
            // Fixní/variabilní se posílá jen u nákladu — u vkladu ho databáze
            // odmítne, a tady je to vidět dřív než v hlášce z Postgresu.
            costType: kind === "naklad" ? costType : null,
            amount, label, person, happenedOn,
            note: note || null,
        })
        setBusy(false)
        if (res.success) await onDone(true)
        else setError(res.error || "Uložení selhalo.")
    }

    return (
        <div className="border border-white/10 bg-[#050505] rounded-sm p-3 space-y-2">
            <div className="grid sm:grid-cols-3 gap-2">
                <select value={kind} onChange={e => setKind(e.target.value)} className={inputClass}>
                    {Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k} className="bg-[#0a0a0a]">{v}</option>)}
                </select>
                {kind === "naklad" ? (
                    <select value={costType} onChange={e => setCostType(e.target.value)} className={inputClass}>
                        {Object.entries(COST_TYPE_LABELS).map(([k, v]) => <option key={k} value={k} className="bg-[#0a0a0a]">{v}</option>)}
                    </select>
                ) : (
                    <p className="px-3 py-2 text-[9px] uppercase tracking-widest font-bold text-white/25 self-center">
                        Vklad fixní ani variabilní není
                    </p>
                )}
                <input
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="Částka v Kč *"
                    className={inputClass}
                />
            </div>
            <input
                value={label}
                onChange={e => setLabel(e.target.value)}
                autoFocus
                placeholder={kind === "naklad" ? "Čeho se náklad týká *" : "Čeho se vklad týká *"}
                className={`w-full ${inputClass}`}
            />
            <div className="grid sm:grid-cols-2 gap-2">
                <select value={person} onChange={e => setPerson(e.target.value)} className={inputClass}>
                    {lide.map(p => <option key={p} value={p} className="bg-[#0a0a0a]">{p}</option>)}
                </select>
                <input type="date" value={happenedOn} onChange={e => setHappenedOn(e.target.value)} className={inputClass} />
            </div>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Poznámka (nepovinné)" className={`w-full ${inputClass}`} />
            <div className="flex items-center gap-2">
                <button
                    onClick={submit}
                    disabled={busy || !amount.trim() || !label.trim()}
                    className="px-4 py-2 text-[9px] font-bold uppercase tracking-widest rounded-sm bg-white/10 text-white border border-white/20 hover:bg-white/20 transition-all disabled:opacity-40"
                >
                    {busy ? "Ukládám…" : "Uložit"}
                </button>
                <button
                    onClick={() => onDone(false)}
                    className="px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-white/40 hover:text-white transition-all"
                >
                    Zrušit
                </button>
                <span className="text-[8px] uppercase tracking-widest font-bold text-white/20 ml-auto text-right">
                    Datum je kdy se to stalo, ne kdy se to zapsalo
                </span>
            </div>
            {error && <p className="text-[10px] text-red-400">{error}</p>}
        </div>
    )
}

// ─── Řádek ───────────────────────────────────────────────────

function Row({ e, onChanged }: { e: FinanceEntry; onChanged: () => Promise<void> }) {
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const uloz = async (patch: Parameters<typeof updateFinanceEntry>[1]) => {
        setBusy(true)
        setError(null)
        const res = await updateFinanceEntry(e.id, patch)
        if (!res.success) setError(res.error || "Uložení selhalo.")
        else await onChanged()
        setBusy(false)
    }

    const smaz = async () => {
        if (!confirm(`Smazat záznam „${e.label}"?\n\nJe to ruční evidence — smazané se nedá vrátit.`)) return
        setBusy(true)
        setError(null)
        const res = await deleteFinanceEntry(e.id)
        if (!res.success) setError(res.error || "Smazání selhalo.")
        else await onChanged()
        setBusy(false)
    }

    const jeNaklad = e.kind === "naklad"

    return (
        <tr className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
            <td className="px-4 py-3 text-[10px] text-white/40 font-bold whitespace-nowrap">
                {new Date(`${e.happened_on}T00:00:00`).toLocaleDateString("cs-CZ")}
            </td>
            <td className="px-4 py-3">
                <InlineText value={e.label} onSave={v => uloz({ label: v })} />
                {e.note && <p className="text-[9px] text-white/25 font-bold mt-0.5">{e.note}</p>}
                {error && <p className="text-[9px] text-red-400/80 font-bold mt-0.5">{error}</p>}
            </td>
            <td className="px-4 py-3">
                {jeNaklad ? (
                    <select
                        value={e.cost_type ?? "fixni"}
                        onChange={ev => void uloz({ cost_type: ev.target.value })}
                        disabled={busy}
                        className="bg-transparent text-[9px] uppercase tracking-widest font-bold text-white/60 focus:outline-none disabled:opacity-40"
                    >
                        {Object.entries(COST_TYPE_LABELS).map(([k, v]) => (
                            <option key={k} value={k} className="bg-[#0a0a0a]">{v}</option>
                        ))}
                    </select>
                ) : (
                    <span className="text-[9px] px-2 py-0.5 rounded-full border font-bold uppercase text-emerald-400 border-emerald-500/30 bg-emerald-500/10">
                        {KIND_LABELS.vklad}
                    </span>
                )}
            </td>
            <td className="px-4 py-3">
                <InlineText value={e.person} onSave={v => uloz({ person: v })} />
            </td>
            <td className={`px-4 py-3 text-xs font-bold whitespace-nowrap ${jeNaklad ? "text-white/70" : "text-emerald-400"}`}>
                {jeNaklad ? "−" : "+"}{formatCzk(e.amount_czk)}
            </td>
            <td className="px-4 py-3 text-right">
                <button
                    onClick={smaz}
                    disabled={busy}
                    title="Smazat záznam"
                    className="text-white/25 hover:text-red-400 transition-colors disabled:opacity-40"
                >
                    <Trash2 className="w-3.5 h-3.5 shrink-0" />
                </button>
            </td>
        </tr>
    )
}

/**
 * Buňka tabulky, ne formulář: klikneš, přepíšeš, odklikneš — uloží se.
 * Escape vrátí původní hodnotu. Stejné chování jako `Field` v `shared.tsx`,
 * jen bez popisku — v tabulce ho nese hlavička sloupce.
 */
function InlineText({ value, onSave }: { value: string; onSave: (v: string) => void | Promise<void> }) {
    const [draft, setDraft] = useState(value)
    const [synced, setSynced] = useState(value)

    // Zdroj pravdy je řádek, ne rozepsané pole. Srovnává se při renderu; efekt
    // by hodnotu nejdřív vykreslil starou a hned přepsal, a psaní by přišlo o znak.
    if (synced !== value) { setSynced(value); setDraft(value) }

    return (
        <input
            value={draft}
            onChange={ev => setDraft(ev.target.value)}
            onBlur={() => { if (draft !== value) void onSave(draft) }}
            onKeyDown={ev => {
                if (ev.key === "Escape") { setDraft(value); (ev.target as HTMLElement).blur() }
                if (ev.key === "Enter") (ev.target as HTMLElement).blur()
            }}
            className="w-full bg-transparent text-xs text-white focus:outline-none focus:bg-[#0a0a0a] focus:ring-1 focus:ring-white/20 rounded-sm px-1 -mx-1 py-0.5"
        />
    )
}

function Stat({ label, value, tone = "ok" }: { label: string; value: string; tone?: "ok" | "warn" }) {
    return (
        <div className={`px-4 py-3 rounded-sm border ${tone === "warn" ? "border-amber-500/20 bg-amber-500/5" : "border-white/5 bg-[#080808]"}`}>
            <p className="text-[9px] uppercase tracking-widest font-bold text-white/30">{label}</p>
            <p className={`text-lg font-black ${tone === "warn" ? "text-amber-400" : "text-white"}`}>{value}</p>
        </div>
    )
}
