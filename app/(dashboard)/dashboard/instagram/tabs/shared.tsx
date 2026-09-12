"use client"

import { useState } from "react"
import { updateIGPostMetrics } from "@/app/actions/admin-actions"
import { trackEvent } from "@/lib/analytics"
import type { IGPost } from "./types"
import { ChartColumn } from "lucide-react"

export function CopyButton({ onClick, copied, label }: { onClick: () => void; copied: boolean; label?: string }) {
    return (
        <button
            onClick={onClick}
            className={`text-[9px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-sm transition-all flex items-center gap-1.5 border ${copied
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-white/5 text-white/50 border-white/10 hover:bg-white/10 hover:text-white"
                }`}
        >
            {copied ? "Zkopírováno" : label || "Kopírovat"}
        </button>
    )
}

export function StatusBadge({ status }: { status: string }) {
    const config: Record<string, { text: string; class: string }> = {
        draft: { text: "KONCEPT", class: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
        plan_draft: { text: "PLÁN", class: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
        plan_locked: { text: "ZAMČENO", class: "bg-amber-500/10 text-amber-500/60 border-amber-500/15" },
        ready: { text: "PŘIPRAVENO", class: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
        scheduled: { text: "NAPLÁNOVÁNO", class: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" },
        posting: { text: "PUBLIKUJE SE…", class: "bg-cyan-500/10 text-cyan-300 border-cyan-500/20 animate-pulse" },
        posted: { text: "PUBLIKOVÁNO", class: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
        failed: { text: "SELHALO", class: "bg-red-500/10 text-red-400 border-red-500/20" },
        archived: { text: "ARCHIVOVÁNO", class: "bg-white/5 text-white/40 border-white/10" },
    }
    const badge = config[status] || config.draft
    return (
        <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-sm border ${badge.class}`}>
            {badge.text}
        </span>
    )
}

export function LoadingSpinner() {
    return (
        <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-[3px] border-white/10 border-t-aisummit-cinnabar rounded-full animate-spin shadow-sm" />
        </div>
    )
}

export function PillarBadge({ pillar }: { pillar: string }) {
    const config: Record<string, { emoji: string; label: string; color: string }> = {
        reach: { emoji: "🔥", label: "DOSAH", color: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
        value: { emoji: "📚", label: "HODNOTA", color: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
        convert: { emoji: "💰", label: "KONVERZE", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
        connect: { emoji: "🤝", label: "PROPOJENÍ", color: "text-purple-400 bg-purple-500/10 border-purple-500/20" },
    }

    const badge = config[pillar]
    if (!badge) return null

    return (
        <span className={`text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-sm border ${badge.color} flex items-center gap-1`}>
            <span>{badge.emoji}</span>
            <span>{badge.label}</span>
        </span>
    )
}

export function MetricInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
    return (
        <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1.5 block">{label}</label>
            <input
                type="number"
                value={value}
                onChange={(e) => onChange(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-1.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all font-medium"
            />
        </div>
    )
}

export function MetricsInputForm({ post, onUpdate }: { post: IGPost; onUpdate: () => void }) {
    const [metrics, setMetrics] = useState({
        likes: post.likes || 0,
        comments: post.comments || 0,
        saves: post.saves || 0,
        reach: post.reach || 0,
        shares: post.shares || 0,
        profile_visits: post.profile_visits || 0,
        views: post.views || 0,
        link_clicks: post.link_clicks || 0,
    })
    const [saving, setSaving] = useState(false)

    const handleSave = async () => {
        setSaving(true)
        await updateIGPostMetrics(post.id, metrics)
        setSaving(false)
        onUpdate()
    }

    const reachScore = (metrics.saves * 5 + metrics.shares * 8 + metrics.reach * 0.01).toFixed(0)
    const conversionScore = (metrics.link_clicks * 10 + metrics.profile_visits * 3).toFixed(0)

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-white/40 uppercase tracking-widest"><ChartColumn className="w-3 h-3 shrink-0" />Metriky</span>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-3 py-1.5 text-[10px] uppercase font-bold tracking-widest rounded-sm bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all border border-blue-500/20 disabled:opacity-50"
                >
                    {saving ? "Ukládám..." : "Uložit"}
                </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
                {/* Engagement metrics */}
                <MetricInput label="Lajky" value={metrics.likes} onChange={(v) => setMetrics({ ...metrics, likes: v })} />
                <MetricInput label="Komentáře" value={metrics.comments} onChange={(v) => setMetrics({ ...metrics, comments: v })} />
                <MetricInput label="Uložení" value={metrics.saves} onChange={(v) => setMetrics({ ...metrics, saves: v })} />

                {/* Growth Engine metrics */}
                <MetricInput label="Dosah" value={metrics.reach} onChange={(v) => setMetrics({ ...metrics, reach: v })} />
                <MetricInput label="Zhlédnutí" value={metrics.views} onChange={(v) => setMetrics({ ...metrics, views: v })} />
                <MetricInput label="↗️ Sdílení" value={metrics.shares} onChange={(v) => setMetrics({ ...metrics, shares: v })} />
                <MetricInput label="Návštěvy profilu" value={metrics.profile_visits} onChange={(v) => setMetrics({ ...metrics, profile_visits: v })} />
                <MetricInput label="Prokliknutí" value={metrics.link_clicks} onChange={(v) => setMetrics({ ...metrics, link_clicks: v })} />
            </div>

            {/* Calculated scores */}
            <div className="flex gap-3 pt-4 border-t border-white/10 mt-4">
                <div className="flex-1 bg-amber-500/5 rounded-sm p-3 border border-amber-500/10">
                    <p className="text-[9px] text-amber-500/50 uppercase tracking-widest font-bold">Dosah</p>
                    <p className="text-2xl font-black text-amber-500">{reachScore}</p>
                </div>
                <div className="flex-1 bg-emerald-500/5 rounded-sm p-3 border border-emerald-500/10">
                    <p className="text-[9px] text-emerald-500/50 uppercase tracking-widest font-bold">Konverze</p>
                    <p className="text-2xl font-black text-emerald-500">{conversionScore}</p>
                </div>
            </div>
        </div>
    )
}

// ═══════════════════════════════════════════════════════════
// RUČNÍ TEXT — EDITOR TAM, KDE TEXT JE
// ═══════════════════════════════════════════════════════════

/**
 * Caption jako pole, ne jako odstavec.
 *
 * Ruční přepis textu server uměl odjakživa (`saveManualText`), ale v UI bydlel
 * v panelu pod detailem, schovaný za tlačítkem „Napsat sám" vedle tří AI režimů.
 * Kdo chtěl opravit překlep, musel nejdřív uhodnout, že úprava textu nežije
 * u textu — a pak psát do jiného pole, než na které se díval. Editor je proto
 * tady: klikneš na caption, přepíšeš ho, uložíš.
 *
 * Zápis jde **výhradně** přes `saveManualText`. Ta je jediná cesta, která uloží
 * text doslova (žádný model mezi člověkem a jeho větou), poznamená předchozí
 * znění do `edit_history` (jde vrátit zpět), osvěží faktickou bránu v režimu
 * „jen značkuj" a pošle rozdíl brand memory. Vlastní `.update({ caption })`
 * odsud by tiše obešel všechny čtyři.
 *
 * Publikovaný příspěvek zamyká server. Tady se tlačítko rovnou neukáže —
 * dozvědět se o zámku až po napsání odstavce je horší než ho nevidět.
 */
export function CaptionEditor({
    projectId,
    post,
    onSaved,
    showHashtags = false,
    editing: editingProp,
    onEditingChange,
    emptyLabel = "—",
}: {
    projectId: string
    /** Stačí to, co má i lehký náhled v kalendáři nebo ve feedu. */
    post: { id: string; caption: string | null; hashtags?: string[] | null; status: string }
    /** Dostane uložený řádek a čerstvý stav faktické brány — volající si
     *  překreslí, co z nich zobrazuje. Bez toho by po smazání nepravdy zůstalo
     *  varování na ni svítit vedle už opraveného textu. */
    onSaved: (post: IGPost, fact?: { flags?: string[]; sources?: IGPost["fact_sources"] }) => void
    /** Hashtagy edituje jen detail příspěvku; náhledy je vůbec nenačítají a
     *  server si při vynechání nechá ty stávající. */
    showHashtags?: boolean
    /** Otevření zvenčí — panel s označenými tvrzeními umí editor rozbalit sám. */
    editing?: boolean
    onEditingChange?: (editing: boolean) => void
    emptyLabel?: string
}) {
    const savedCaption = post.caption || ""
    const savedHashtags = (post.hashtags || []).join(" ")
    const [selfEditing, setSelfEditing] = useState(false)
    const editing = editingProp ?? selfEditing
    const setEditing = onEditingChange ?? setSelfEditing

    const [draftCaption, setDraftCaption] = useState(savedCaption)
    const [draftHashtags, setDraftHashtags] = useState(savedHashtags)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Zdroj pravdy je řádek příspěvku, ne rozepsané pole: po uložení, po vrácení
    // zpět i po AI retuši musí editor ukazovat text, který na postu SKUTEČNĚ je.
    // Srovnává se při renderu, ne v efektu — efekt by pole nejdřív vykreslil se
    // starým textem a hned přepsal, a psaní by v tu chvíli přišlo o znak.
    const [syncedWith, setSyncedWith] = useState({ caption: savedCaption, hashtags: savedHashtags })
    if (syncedWith.caption !== savedCaption || syncedWith.hashtags !== savedHashtags) {
        setSyncedWith({ caption: savedCaption, hashtags: savedHashtags })
        setDraftCaption(savedCaption)
        setDraftHashtags(savedHashtags)
    }

    // Stejný zámek jako na serveru. Publikovaný řádek se nesmí rozejít s tím,
    // co lidé na Instagramu doopravdy vidí.
    const locked = post.status === "posted" || post.status === "posting"
    const dirty = draftCaption !== savedCaption || draftHashtags !== savedHashtags

    const save = async () => {
        if (!draftCaption.trim() || busy) return
        setBusy(true)
        setError(null)
        const { saveManualText } = await import("@/app/actions/post-edit-actions")
        const res = await saveManualText(projectId, post.id, {
            caption: draftCaption,
            // Uživatel je píše, jak mu přijdou pod ruku — „#sleva, jaro". Rozdělení
            // tady, pořádný úklid (mřížky, duplicity) dělá server.
            ...(showHashtags ? { hashtags: draftHashtags.split(/[\s,]+/).filter(Boolean) } : {}),
        })
        setBusy(false)
        if (res.success && res.post) {
            onSaved(res.post, { flags: res.factFlags, sources: res.factSources })
            setEditing(false)
            trackEvent("post_text_edited_manually", {})
        } else {
            setError(res.error || "Uložení selhalo.")
        }
    }

    const cancel = () => {
        setDraftCaption(savedCaption)
        setDraftHashtags(savedHashtags)
        setError(null)
        setEditing(false)
    }

    if (!editing) {
        return (
            <div className="group relative">
                <div
                    onClick={() => { if (!locked) setEditing(true) }}
                    role={locked ? undefined : "button"}
                    tabIndex={locked ? undefined : 0}
                    onKeyDown={e => { if (!locked && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setEditing(true) } }}
                    title={locked ? "Publikovaný text už nejde upravit — vytvoř variantu" : "Kliknutím text přepíšeš"}
                    className={`bg-[#0f0f0f] border rounded-sm p-4 max-h-60 overflow-y-auto shadow-inner transition-colors ${
                        locked
                            ? "border-white/5"
                            : "border-white/5 hover:border-white/20 cursor-text focus:outline-none focus:border-white/25"
                    }`}
                >
                    <p className="text-sm text-white/70 whitespace-pre-wrap leading-relaxed font-medium">
                        {savedCaption || emptyLabel}
                    </p>
                </div>
                {!locked && (
                    <button
                        onClick={() => setEditing(true)}
                        className="absolute top-2 right-2 px-2 py-1 rounded-sm border border-white/10 bg-black/60 text-[9px] font-bold uppercase tracking-widest text-white/40 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-white hover:border-white/25 transition-all"
                    >
                        Upravit
                    </button>
                )}
            </div>
        )
    }

    return (
        <div className="space-y-2">
            <textarea
                autoFocus
                value={draftCaption}
                onChange={e => setDraftCaption(e.target.value)}
                onKeyDown={e => {
                    if (e.key === "Escape") { e.preventDefault(); cancel() }
                    // Enter dělá odstavec — caption je víceřádkový text. Uložit
                    // se dá zkratkou, kterou má na tohle zbytek světa.
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save() }
                }}
                placeholder="Text příspěvku — uloží se přesně tak, jak ho napíšeš"
                rows={10}
                className="w-full px-3 py-2 bg-[#050505] border border-white/20 rounded-sm text-white text-sm resize-y focus:outline-none focus:ring-1 focus:ring-white/20 placeholder:text-white/20 leading-relaxed"
            />
            {showHashtags && (
                <input
                    value={draftHashtags}
                    onChange={e => setDraftHashtags(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === "Escape") { e.preventDefault(); cancel() }
                        if (e.key === "Enter") { e.preventDefault(); void save() }
                    }}
                    placeholder="Hashtagy oddělené mezerou (nepovinné)"
                    className="w-full px-3 py-2 bg-[#050505] border border-white/10 rounded-sm text-white text-xs focus:outline-none focus:ring-1 focus:ring-white/20 placeholder:text-white/20"
                />
            )}
            <div className="flex items-center gap-2">
                <button
                    onClick={save}
                    disabled={busy || !draftCaption.trim() || !dirty}
                    title={!dirty ? "Text se od uloženého neliší" : undefined}
                    className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-white/10 text-white border border-white/20 hover:bg-white/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {busy ? "Ukládám…" : "Uložit text"}
                </button>
                <button
                    onClick={cancel}
                    disabled={busy}
                    className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest rounded-sm text-white/40 hover:text-white transition-all disabled:opacity-40"
                >
                    Zrušit
                </button>
                <span className="text-[9px] text-white/25 uppercase tracking-widest font-bold ml-auto text-right">
                    Zdarma · jde vrátit zpět
                </span>
            </div>
            {error && <p className="text-[10px] text-red-400">{error}</p>}
        </div>
    )
}

// ═══════════════════════════════════════════════════════════
// POLE ADMINSKÝCH TABŮ — buňka tabulky, ne formulář
// ═══════════════════════════════════════════════════════════

/**
 * Tahle trojice vznikla v `LeadsTab` a `TasksTab` si ji obkresloval podruhé.
 * Chování je u obou stejné a je to chování TABULKY: klikneš do buňky, přepíšeš,
 * odklikneš — uloží se. Žádné tlačítko „Uložit", žádný dialog.
 */

/** Textové pole, které se ukládá na blur. Escape vrátí původní hodnotu. */
export function Field({ label, value, onSave, multiline, placeholder }: {
    label: string
    value: string | null
    onSave: (v: string) => void | Promise<void>
    multiline?: boolean
    placeholder?: string
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
                placeholder={placeholder}
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

/** Výběr z číselníku. Prázdná hodnota je platná — „nezadáno" není chyba. */
export function Select({ label, value, options, onSave, emptyLabel = "—" }: {
    label: string
    value: string | null
    options: Record<string, string>
    onSave: (v: string) => void | Promise<void>
    emptyLabel?: string
}) {
    return (
        <label className="block">
            <span className="block text-[8px] font-bold uppercase tracking-widest text-white/30 mb-1">{label}</span>
            <select
                value={value ?? ""}
                onChange={e => void onSave(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs focus:outline-none focus:ring-1 focus:ring-white/20"
            >
                <option value="" className="bg-[#0a0a0a]">{emptyLabel}</option>
                {Object.entries(options).map(([k, v]) => <option key={k} value={k} className="bg-[#0a0a0a]">{v}</option>)}
            </select>
        </label>
    )
}

/**
 * Datum, nebo datum s časem.
 *
 * `mode="date"` posílá `YYYY-MM-DD` beze změny — sloupec `date` žádné pásmo nemá
 * a převod přes `new Date()` by termín posunul o den zpátky každému, kdo sedí
 * východně od Greenwiche. `mode="datetime"` naopak posílá ISO v UTC.
 */
export function DateField({ label, value, onSave, mode = "datetime" }: {
    label: string
    value: string | null
    onSave: (v: string) => void | Promise<void>
    mode?: "date" | "datetime"
}) {
    return (
        <label className="block">
            <span className="block text-[8px] font-bold uppercase tracking-widest text-white/30 mb-1">{label}</span>
            <input
                type={mode === "date" ? "date" : "datetime-local"}
                defaultValue={mode === "date" ? (value ?? "") : toLocalInput(value)}
                onChange={e => {
                    const raw = e.target.value
                    if (mode === "date") { void onSave(raw); return }
                    void onSave(raw ? new Date(raw).toISOString() : "")
                }}
                className="w-full px-2.5 py-1.5 bg-[#050505] border border-white/10 rounded-sm text-white/80 text-xs focus:outline-none focus:ring-1 focus:ring-white/20"
            />
        </label>
    )
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

/** Filtrační štítek. Stejný v Obchodu i v Úkolech — dřív byl okopírovaný. */
export function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
    return (
        <button
            onClick={onClick}
            className={`px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest rounded-sm border transition-all ${
                active ? "bg-white/10 text-white border-white/20" : "bg-transparent text-white/35 border-white/10 hover:text-white/70"
            }`}
        >{label}</button>
    )
}
