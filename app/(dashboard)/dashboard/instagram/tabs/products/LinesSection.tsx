"use client"

/**
 * Product Lines — brief → generated proposal → per-SKU revision → approval.
 *
 * The proposal is a persisted draft, so a refresh cannot throw away a paid
 * Pro-ladder run, and approval is a single-use claim on the server — the button
 * disables itself but the guarantee lives in line-actions.approveLine.
 */

import { useCallback, useEffect, useState } from "react"
import { motion } from "framer-motion"
import {
    generateLine,
    getLineProgress,
    getLines,
    reviseLineSku,
    updateLineSku,
    approveLine,
    discardLine,
    archiveLine,
    type LineRow,
} from "@/app/actions/line-actions"
import type { LineSku, PriceTier } from "@/instagram/line-generator"
import { LoadingSpinner } from "../shared"

const TIERS: { id: PriceTier; label: string; hint: string }[] = [
    { id: "budget", label: "Dostupná", hint: "Cena je argument" },
    { id: "mid", label: "Střední", hint: "Poměr cena/výkon" },
    { id: "premium", label: "Prémiová", hint: "Rozhoduje výsledek" },
]

const LABEL = "text-[9px] uppercase tracking-widest font-bold text-white/40"
const INPUT = "w-full bg-[#0a0a0a] border border-white/8 rounded-sm px-3 py-2 text-sm text-white/90 focus:border-amber-500/40 focus:outline-none"

export function LinesSection({ projectId }: { projectId: string }) {
    const [lines, setLines] = useState<LineRow[]>([])
    const [active, setActive] = useState<LineRow | null>(null)
    const [loading, setLoading] = useState(true)
    const [generating, setGenerating] = useState(false)
    const [progress, setProgress] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const [issues, setIssues] = useState<{ field: string; message: string }[]>([])

    // Brief form
    const [category, setCategory] = useState("")
    const [skuCount, setSkuCount] = useState(5)
    const [priceTier, setPriceTier] = useState<PriceTier>("mid")
    const [positioning, setPositioning] = useState("")
    const [audience, setAudience] = useState("")
    const [mustInclude, setMustInclude] = useState("")

    // Per-SKU interaction
    const [selected, setSelected] = useState<Set<number>>(new Set())
    const [feedback, setFeedback] = useState<Record<number, string>>({})
    const [revising, setRevising] = useState<number | null>(null)
    const [approving, setApproving] = useState(false)

    const load = useCallback(async () => {
        setLoading(true)
        const data = await getLines(projectId)
        setLines(data)
        setLoading(false)
    }, [projectId])

    useEffect(() => { load() }, [load])

    // Select every step by default when a draft opens — the common case is
    // approving the whole line, not cherry-picking.
    useEffect(() => {
        if (active?.status === "draft") {
            setSelected(new Set((active.skus || []).map(s => s.step)))
        }
    }, [active])

    const handleGenerate = async () => {
        if (!category.trim()) { setError("Zadej kategorii řady (např. autokosmetika)"); return }
        setGenerating(true)
        setError(null)
        setIssues([])
        setProgress("Startuji…")

        const runId = crypto.randomUUID()
        const poll = setInterval(async () => {
            const p = await getLineProgress(projectId, runId)
            if (p?.progress) setProgress(p.progress)
        }, 2500)

        try {
            const result = await generateLine(projectId, {
                category: category.trim(),
                skuCount,
                priceTier,
                positioning: positioning.trim() || undefined,
                audience: audience.trim() || undefined,
                mustInclude: mustInclude.split(",").map(s => s.trim()).filter(Boolean),
                runId,
            })
            if (!result.success) { setError(result.error || "Generování selhalo"); return }
            setIssues(result.issues || [])
            await load()
            const fresh = await getLines(projectId)
            setActive(fresh.find(l => l.id === result.lineId) || null)
        } catch (err: any) {
            setError(err.message)
        } finally {
            clearInterval(poll)
            setGenerating(false)
            setProgress("")
        }
    }

    const handleRevise = async (index: number) => {
        const text = feedback[index]?.trim()
        if (!active || !text) return
        setRevising(index)
        setError(null)
        try {
            const result = await reviseLineSku(projectId, active.id, index, text)
            if (!result.success || !result.sku) { setError(result.error || "Úprava selhala"); return }
            const skus = [...active.skus]
            skus[index] = result.sku
            setActive({ ...active, skus })
            setFeedback(prev => ({ ...prev, [index]: "" }))
        } catch (err: any) {
            setError(err.message)
        } finally {
            setRevising(null)
        }
    }

    const handleFieldEdit = async (index: number, patch: Partial<LineSku>) => {
        if (!active) return
        const skus = [...active.skus]
        skus[index] = { ...skus[index], ...patch }
        setActive({ ...active, skus })
        await updateLineSku(projectId, active.id, index, patch)
    }

    const handleApprove = async () => {
        if (!active) return
        setApproving(true)
        setError(null)
        try {
            const result = await approveLine(projectId, active.id, Array.from(selected))
            if (!result.success) { setError(result.error || "Schválení selhalo"); return }
            setNotice(`Do katalogu přidáno ${result.created} produktů · ${result.ideas} launch témat do zásobníku nápadů`)
            await load()
            setActive(null)
        } catch (err: any) {
            setError(err.message)
        } finally {
            setApproving(false)
        }
    }

    const handleDiscard = async (line: LineRow) => {
        const result = await discardLine(projectId, line.id)
        if (!result.success) { setError(result.error || "Zahození selhalo"); return }
        if (active?.id === line.id) setActive(null)
        await load()
    }

    const toggleStep = (step: number) => {
        setSelected(prev => {
            const next = new Set(prev)
            if (next.has(step)) next.delete(step)
            else next.add(step)
            return next
        })
    }

    if (loading) return <LoadingSpinner />

    return (
        <div className="space-y-6">
            {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-sm px-4 py-3 text-xs text-red-300">{error}</div>
            )}
            {notice && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-sm px-4 py-3 text-xs text-emerald-300">{notice}</div>
            )}

            {/* ── Brief ── */}
            <div className="bg-[#050505] border border-white/5 rounded-sm p-5 space-y-4">
                <div>
                    <h3 className="text-[11px] uppercase tracking-widest font-bold text-white/70">Nová produktová řada</h3>
                    <p className="text-[10px] text-white/30 mt-1 leading-relaxed">
                        AI navrhne řadu jako systém — každý produkt dostane svůj krok v procesu, roli, specifikaci a místo v cenovém žebříčku.
                    </p>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <label className={LABEL}>Kategorie řady</label>
                        <input className={INPUT} value={category} onChange={e => setCategory(e.target.value)}
                            placeholder="autokosmetika, péče o vousy, doplňky…" />
                    </div>
                    <div className="space-y-1.5">
                        <label className={LABEL}>Počet produktů: {skuCount}</label>
                        <input type="range" min={2} max={12} value={skuCount}
                            onChange={e => setSkuCount(Number(e.target.value))}
                            className="w-full accent-amber-500 mt-2.5" />
                    </div>
                </div>

                <div className="space-y-1.5">
                    <label className={LABEL}>Cenová hladina</label>
                    <div className="grid grid-cols-3 gap-2">
                        {TIERS.map(t => (
                            <button key={t.id} type="button" onClick={() => setPriceTier(t.id)}
                                className={`py-2.5 px-2 rounded-sm border text-left transition-all ${priceTier === t.id
                                    ? "bg-amber-500/10 border-amber-500/50"
                                    : "bg-[#0a0a0a] border-white/8 hover:border-white/20"}`}>
                                <div className={`text-[9px] uppercase tracking-widest font-bold ${priceTier === t.id ? "text-amber-400" : "text-white/50"}`}>{t.label}</div>
                                <div className="text-[9px] text-white/25 mt-0.5">{t.hint}</div>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <label className={LABEL}>Pozicování (volitelné)</label>
                        <input className={INPUT} value={positioning} onChange={e => setPositioning(e.target.value)}
                            placeholder="proti čemu se vymezujeme" />
                    </div>
                    <div className="space-y-1.5">
                        <label className={LABEL}>Cílová skupina (volitelné)</label>
                        <input className={INPUT} value={audience} onChange={e => setAudience(e.target.value)}
                            placeholder="kdo to kupuje" />
                    </div>
                </div>

                <div className="space-y-1.5">
                    <label className={LABEL}>Musí obsahovat (oddělené čárkou)</label>
                    <input className={INPUT} value={mustInclude} onChange={e => setMustInclude(e.target.value)}
                        placeholder="šampon, keramická ochrana…" />
                </div>

                <button onClick={handleGenerate} disabled={generating}
                    className="w-full bg-amber-500/15 border border-amber-500/40 hover:bg-amber-500/25 disabled:opacity-40 rounded-sm py-3 text-[10px] uppercase tracking-widest font-bold text-amber-300 transition-all">
                    {generating ? (progress || "Generuji…") : "Navrhnout řadu"}
                </button>
                {generating && (
                    <p className="text-[9px] text-white/25 text-center">Běží hluboká analýza (~1–2 min). Můžeš zavřít záložku, výsledek se uloží.</p>
                )}
            </div>

            {/* ── Validation warnings ── */}
            {issues.length > 0 && (
                <div className="bg-amber-500/5 border border-amber-500/25 rounded-sm p-4 space-y-1.5">
                    <div className="text-[9px] uppercase tracking-widest font-bold text-amber-400">Výhrady k návrhu</div>
                    {issues.map((i, n) => (
                        <div key={n} className="text-[11px] text-white/50">· [{i.field}] {i.message}</div>
                    ))}
                    <p className="text-[9px] text-white/25 pt-1">Můžeš je opravit ručně nebo přes zpětnou vazbu u konkrétního produktu.</p>
                </div>
            )}

            {/* ── Line list ── */}
            {lines.length > 0 && (
                <div className="space-y-2">
                    <div className={LABEL}>Řady ({lines.length})</div>
                    {lines.map(line => (
                        <button key={line.id} onClick={() => setActive(active?.id === line.id ? null : line)}
                            className={`w-full text-left bg-[#050505] border rounded-sm px-4 py-3 transition-all ${active?.id === line.id ? "border-amber-500/40" : "border-white/5 hover:border-white/15"}`}>
                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="text-sm text-white/85 font-medium truncate">{line.name}</div>
                                    <div className="text-[10px] text-white/30 truncate">{line.positioning || line.system_logic || "—"}</div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <span className="text-[9px] uppercase tracking-widest font-bold text-white/30">{line.skus?.length || 0} SKU</span>
                                    <StatusChip status={line.status} />
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {/* ── Active line detail ── */}
            {active && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    className="bg-[#050505] border border-white/5 rounded-sm p-5 space-y-5">
                    <div className="space-y-2">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h3 className="text-lg text-white/90 font-medium">{active.name}</h3>
                                <div className="text-[10px] text-white/35 mt-0.5">/{active.slug}</div>
                            </div>
                            <StatusChip status={active.status} />
                        </div>
                        {active.system_logic && (
                            <Field label="Systém řady" value={active.system_logic} />
                        )}
                        {active.naming_convention && (
                            <Field label="Pravidlo pojmenování" value={active.naming_convention} />
                        )}
                        {active.target_audience && (
                            <Field label="Cílová skupina" value={active.target_audience} />
                        )}
                    </div>

                    <div className="space-y-3">
                        {(active.skus || []).map((sku, index) => (
                            <div key={`${sku.step}-${sku.name}`}
                                className="bg-[#0a0a0a] border border-white/8 rounded-sm p-4 space-y-3">
                                <div className="flex items-start gap-3">
                                    {active.status === "draft" && (
                                        <input type="checkbox" checked={selected.has(sku.step)}
                                            onChange={() => toggleStep(sku.step)}
                                            className="mt-1 accent-amber-500" />
                                    )}
                                    <div className="w-7 h-7 shrink-0 rounded-sm bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-[11px] font-bold text-amber-400">
                                        {sku.step}
                                    </div>
                                    <div className="flex-1 min-w-0 space-y-1">
                                        {active.status === "draft" ? (
                                            <input value={sku.name}
                                                onChange={e => handleFieldEdit(index, { name: e.target.value })}
                                                className="w-full bg-transparent text-sm text-white/90 font-medium focus:outline-none focus:bg-white/5 rounded px-1 -mx-1" />
                                        ) : (
                                            <div className="text-sm text-white/90 font-medium">{sku.name}</div>
                                        )}
                                        <div className="text-[10px] uppercase tracking-widest font-bold text-white/35">{sku.role}</div>
                                        <p className="text-xs text-white/50 leading-relaxed">{sku.description}</p>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <div className="text-sm text-white/80 font-medium">{sku.priceCzk?.toLocaleString("cs-CZ")} Kč</div>
                                    </div>
                                </div>

                                <div className="flex flex-wrap gap-1.5 pl-10">
                                    {sku.specs?.volume && <Spec>{sku.specs.volume}</Spec>}
                                    {sku.specs?.surface && <Spec>{sku.specs.surface}</Spec>}
                                    {sku.specs?.application && <Spec>{sku.specs.application}</Spec>}
                                    {sku.pairsWith && <Spec>↔ {sku.pairsWith}</Spec>}
                                </div>
                                {sku.specs?.claims && sku.specs.claims.length > 0 && (
                                    <div className="pl-10 text-[10px] text-white/35">
                                        {sku.specs.claims.join(" · ")}
                                    </div>
                                )}

                                {active.status === "draft" && (
                                    <div className="pl-10 flex gap-2">
                                        <input
                                            value={feedback[index] || ""}
                                            onChange={e => setFeedback(prev => ({ ...prev, [index]: e.target.value }))}
                                            placeholder="Co na tomhle produktu změnit?"
                                            className="flex-1 bg-[#050505] border border-white/8 rounded-sm px-2.5 py-1.5 text-xs text-white/80 focus:border-amber-500/40 focus:outline-none" />
                                        <button onClick={() => handleRevise(index)}
                                            disabled={revising === index || !feedback[index]?.trim()}
                                            className="px-3 py-1.5 rounded-sm border border-white/10 hover:border-white/25 disabled:opacity-30 text-[9px] uppercase tracking-widest font-bold text-white/50 transition-all">
                                            {revising === index ? "…" : "Upravit"}
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {active.status === "draft" && (
                        <div className="flex gap-2 pt-1">
                            <button onClick={handleApprove} disabled={approving || selected.size === 0}
                                className="flex-1 bg-emerald-500/15 border border-emerald-500/40 hover:bg-emerald-500/25 disabled:opacity-30 rounded-sm py-3 text-[10px] uppercase tracking-widest font-bold text-emerald-300 transition-all">
                                {approving ? "Schvaluji…" : `Schválit do katalogu (${selected.size})`}
                            </button>
                            <button onClick={() => handleDiscard(active)}
                                className="px-4 rounded-sm border border-white/10 hover:border-red-500/40 text-[10px] uppercase tracking-widest font-bold text-white/40 hover:text-red-400 transition-all">
                                Zahodit
                            </button>
                        </div>
                    )}

                    {active.status === "active" && (
                        <button onClick={async () => { await archiveLine(projectId, active.id); await load(); setActive(null) }}
                            className="w-full rounded-sm border border-white/10 hover:border-white/25 py-2.5 text-[9px] uppercase tracking-widest font-bold text-white/40 transition-all">
                            Archivovat řadu
                        </button>
                    )}
                </motion.div>
            )}
        </div>
    )
}

function StatusChip({ status }: { status: string }) {
    const map: Record<string, string> = {
        draft: "bg-amber-500/10 border-amber-500/30 text-amber-400",
        active: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
        archived: "bg-white/5 border-white/10 text-white/30",
        failed: "bg-red-500/10 border-red-500/30 text-red-400",
    }
    const label: Record<string, string> = {
        draft: "Návrh", active: "Aktivní", archived: "Archiv", failed: "Chyba",
    }
    return (
        <span className={`px-2 py-0.5 rounded-sm border text-[8px] uppercase tracking-widest font-bold ${map[status] || map.archived}`}>
            {label[status] || status}
        </span>
    )
}

function Field({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <div className={LABEL}>{label}</div>
            <p className="text-xs text-white/55 leading-relaxed mt-0.5">{value}</p>
        </div>
    )
}

function Spec({ children }: { children: React.ReactNode }) {
    return (
        <span className="px-2 py-0.5 rounded-sm bg-white/5 border border-white/8 text-[9px] text-white/40">
            {children}
        </span>
    )
}
