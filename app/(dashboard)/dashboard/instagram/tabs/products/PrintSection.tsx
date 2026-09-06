"use client"

/**
 * Print design — flat artwork, die-line preview, printer spec, optional mockup.
 *
 * Deliberately honest about what the output is. The previous UI claimed
 * "tisknutelný grafický design izolovaný na černém pozadí — připravený pro DTG
 * potisk" while the pipeline produced a studio photograph of a finished product,
 * and the FAQ promised a transparent background that no code ever created.
 */

import { useCallback, useEffect, useState } from "react"
import { motion } from "framer-motion"
import {
    generatePrintDesign,
    generatePrintVariants,
    editPrintDesign,
    generateMockup,
    getPrintDesigns,
    getPrintProgress,
    selectDesignWinner,
    ratePrintDesign,
    type PrintDesignRow,
} from "@/app/actions/print-actions"
import { getProducts } from "@/app/actions/product-actions"
import { getLines, type LineRow } from "@/app/actions/line-actions"
import { LoadingSpinner } from "../shared"
import { Star } from "lucide-react"

interface CategoryItem {
    id: string
    slug: string
    label: string
    icon: string
    artwork_kind?: string | null
    print_size_mm?: string | null
}

const LABEL = "text-[9px] uppercase tracking-widest font-bold text-white/40"
const INPUT = "w-full bg-[#0a0a0a] border border-white/8 rounded-sm px-3 py-2 text-sm text-white/90 focus:border-amber-500/40 focus:outline-none"

const KIND_LABEL: Record<string, string> = {
    flat: "Potisk", label: "Etiketa", wrap: "Ovin", poster: "Plakát",
}

export function PrintSection({
    projectId,
    categories,
    initialTheme,
}: {
    projectId: string
    categories: CategoryItem[]
    /** Seeded when the user jumps here from an idea card */
    initialTheme?: string
}) {
    const [designs, setDesigns] = useState<PrintDesignRow[]>([])
    const [products, setProducts] = useState<any[]>([])
    const [lines, setLines] = useState<LineRow[]>([])
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [progress, setProgress] = useState("")
    const [error, setError] = useState<string | null>(null)

    // Form
    const [categorySlug, setCategorySlug] = useState("")
    const [theme, setTheme] = useState("")
    const [designDescription, setDesignDescription] = useState("")
    const [overlayText, setOverlayText] = useState("")
    const [includeLogo, setIncludeLogo] = useState(true)
    const [productId, setProductId] = useState("")
    const [lineId, setLineId] = useState("")
    const [abMode, setAbMode] = useState(false)

    // Detail
    const [open, setOpen] = useState<PrintDesignRow | null>(null)
    const [editInstruction, setEditInstruction] = useState("")
    const [editing, setEditing] = useState(false)
    const [mockingUp, setMockingUp] = useState(false)

    const load = useCallback(async () => {
        setLoading(true)
        const [d, p, l] = await Promise.all([
            getPrintDesigns(projectId),
            getProducts(projectId),
            getLines(projectId),
        ])
        setDesigns(d)
        setProducts(p)
        setLines(l.filter(x => x.status === "active"))
        setLoading(false)
    }, [projectId])

    useEffect(() => { load() }, [load])
    useEffect(() => {
        if (!categorySlug && categories.length > 0) setCategorySlug(categories[0].slug)
    }, [categories, categorySlug])
    // Seed only when it changes and the user hasn't typed anything — never clobber
    // a theme they're in the middle of writing.
    useEffect(() => {
        if (initialTheme) setTheme(prev => prev || initialTheme)
    }, [initialTheme])

    const activeCategory = categories.find(c => c.slug === categorySlug)

    const handleGenerate = async () => {
        if (!categorySlug) { setError("Vyber typ produktu"); return }
        if (!theme.trim()) { setError("Zadej téma designu"); return }
        setBusy(true)
        setError(null)
        setProgress("Startuji…")

        const runId = crypto.randomUUID()
        const poll = setInterval(async () => {
            const p = await getPrintProgress(projectId, runId)
            if (p?.progress) setProgress(p.progress)
        }, 2500)

        try {
            const opts = {
                categorySlug,
                theme: theme.trim(),
                designDescription: designDescription.trim() || undefined,
                overlayText: overlayText.trim() || undefined,
                includeLogo,
                productId: productId || undefined,
                lineId: lineId || undefined,
                runId,
            }
            const result = abMode
                ? await generatePrintVariants(projectId, opts)
                : await generatePrintDesign(projectId, opts)

            if (!result.success) { setError(result.error || "Generování selhalo"); return }
            await load()
            const first = "designs" in result ? result.designs?.[0] : (result as { design?: PrintDesignRow }).design
            if (first) setOpen(first)
        } catch (err: any) {
            setError(err.message)
        } finally {
            clearInterval(poll)
            setBusy(false)
            setProgress("")
        }
    }

    const handleEdit = async () => {
        if (!open || !editInstruction.trim()) return
        setEditing(true)
        setError(null)
        try {
            const result = await editPrintDesign(projectId, open.id, editInstruction.trim())
            if (!result.success || !result.design) { setError(result.error || "Úprava selhala"); return }
            setOpen(result.design)
            setEditInstruction("")
            await load()
        } catch (err: any) {
            setError(err.message)
        } finally {
            setEditing(false)
        }
    }

    const handleMockup = async () => {
        if (!open) return
        setMockingUp(true)
        setError(null)
        try {
            const result = await generateMockup(projectId, open.id)
            if (!result.success) { setError(result.error || "Mockup selhal"); return }
            setOpen({ ...open, mockup_url: result.mockupUrl || null })
            await load()
        } catch (err: any) {
            setError(err.message)
        } finally {
            setMockingUp(false)
        }
    }

    const handleWinner = async (design: PrintDesignRow) => {
        await selectDesignWinner(projectId, design.id)
        await load()
        setOpen({ ...design, is_winner: true })
    }

    const handleRate = async (design: PrintDesignRow, rating: 1 | -1) => {
        await ratePrintDesign(projectId, design.id, design.rating === rating ? null : rating)
        await load()
    }

    const download = async (url: string, filename: string) => {
        const res = await fetch(url)
        const blob = await res.blob()
        const a = document.createElement("a")
        a.href = URL.createObjectURL(blob)
        a.download = filename
        a.click()
        URL.revokeObjectURL(a.href)
    }

    if (loading) return <LoadingSpinner />

    const variantSiblings = open?.variant_group
        ? designs.filter(d => d.variant_group === open.variant_group)
        : []

    return (
        <div className="space-y-6">
            {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-sm px-4 py-3 text-xs text-red-300">{error}</div>
            )}

            {/* ── Brief ── */}
            <div className="bg-[#050505] border border-white/5 rounded-sm p-5 space-y-4">
                <div>
                    <h3 className="text-[11px] uppercase tracking-widest font-bold text-white/70">Podklad pro tisk</h3>
                    <p className="text-[10px] text-white/30 mt-1 leading-relaxed">
                        AI vytvoří plochou tiskovou grafiku ve správném poměru stran, zkontroluje český text a doškáluje ji
                        na fyzický rozměr při 300 DPI. Výstup je <span className="text-white/50">návrh pro tiskaře</span> —
                        pro velké formáty ho nechte převést do vektorů.
                    </p>
                </div>

                <div className="space-y-1.5">
                    <label className={LABEL}>Typ produktu</label>
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                        {categories.map(c => (
                            <button key={c.slug} type="button" onClick={() => setCategorySlug(c.slug)}
                                className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded border transition-all ${categorySlug === c.slug
                                    ? "bg-amber-500/10 border-amber-500/50"
                                    : "bg-[#0a0a0a] border-white/8 hover:border-white/20"}`}>
                                <span className="text-2xl leading-none">{c.icon}</span>
                                <span className={`text-[8px] font-bold uppercase tracking-widest leading-none text-center ${categorySlug === c.slug ? "text-amber-400" : "text-white/50"}`}>{c.label}</span>
                            </button>
                        ))}
                    </div>
                    {activeCategory && (
                        <div className="flex gap-1.5 pt-1">
                            {activeCategory.artwork_kind && (
                                <span className="px-2 py-0.5 rounded-sm bg-white/5 border border-white/8 text-[9px] text-white/40">
                                    {KIND_LABEL[activeCategory.artwork_kind] || activeCategory.artwork_kind}
                                </span>
                            )}
                            {activeCategory.print_size_mm && (
                                <span className="px-2 py-0.5 rounded-sm bg-white/5 border border-white/8 text-[9px] text-white/40">
                                    {activeCategory.print_size_mm.replace("x", " × ")} mm
                                </span>
                            )}
                        </div>
                    )}
                </div>

                <div className="space-y-1.5">
                    <label className={LABEL}>Téma / inspirace</label>
                    <input className={INPUT} value={theme} onChange={e => setTheme(e.target.value)}
                        placeholder="např. dílenská estetika, výrazná typografie" />
                </div>

                <div className="space-y-1.5">
                    <label className={LABEL}>Popis grafiky (volitelné)</label>
                    <textarea className={`${INPUT} min-h-[64px] resize-y`} value={designDescription}
                        onChange={e => setDesignDescription(e.target.value)}
                        placeholder="Konkrétní přání — kompozice, motivy, čemu se vyhnout" />
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <label className={LABEL}>Text na artworku (volitelné)</label>
                        <input className={INPUT} value={overlayText} onChange={e => setOverlayText(e.target.value)}
                            placeholder="přesné znění včetně diakritiky" />
                    </div>
                    <div className="space-y-1.5">
                        <label className={LABEL}>Produkt z katalogu (volitelné)</label>
                        <select className={INPUT} value={productId} onChange={e => setProductId(e.target.value)}>
                            <option value="">— žádný —</option>
                            {products.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {lines.length > 0 && (
                    <div className="space-y-1.5">
                        <label className={LABEL}>Řada (sjednotí vzhled se sourozenci)</label>
                        <select className={INPUT} value={lineId} onChange={e => setLineId(e.target.value)}>
                            <option value="">— žádná —</option>
                            {lines.map(l => (
                                <option key={l.id} value={l.id}>{l.name}</option>
                            ))}
                        </select>
                    </div>
                )}

                <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={includeLogo} onChange={e => setIncludeLogo(e.target.checked)}
                            className="accent-amber-500" />
                        <span className="text-[10px] uppercase tracking-widest font-bold text-white/50">Zapojit logo</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={abMode} onChange={e => setAbMode(e.target.checked)}
                            className="accent-amber-500" />
                        <span className="text-[10px] uppercase tracking-widest font-bold text-white/50">A/B varianty (2× kredity)</span>
                    </label>
                </div>

                <button onClick={handleGenerate} disabled={busy}
                    className="w-full bg-amber-500/15 border border-amber-500/40 hover:bg-amber-500/25 disabled:opacity-40 rounded-sm py-3 text-[10px] uppercase tracking-widest font-bold text-amber-300 transition-all">
                    {busy ? (progress || "Generuji…") : abMode ? "Vytvořit 2 varianty" : "Vytvořit podklad"}
                </button>
            </div>

            {/* ── Detail ── */}
            {open && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    className="bg-[#050505] border border-white/5 rounded-sm p-5 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <h3 className="text-lg text-white/90 font-medium">{open.brief?.name || "Design"}</h3>
                            <div className="text-[10px] text-white/30 mt-0.5">{open.theme}</div>
                        </div>
                        <div className="flex items-center gap-2">
                            <QaChip status={open.qa_status} />
                            <FactChip brief={open.brief} />
                            <button onClick={() => setOpen(null)}
                                className="text-white/30 hover:text-white/60 text-lg leading-none">×</button>
                        </div>
                    </div>

                    {/* A/B comparison */}
                    {variantSiblings.length > 1 && (
                        <div className="space-y-2">
                            <div className={LABEL}>Varianty — vyber vítěze</div>
                            <div className="grid grid-cols-2 gap-3">
                                {variantSiblings.map(v => (
                                    <div key={v.id}
                                        className={`rounded-sm border overflow-hidden transition-all ${v.is_winner ? "border-emerald-500/50" : "border-white/8"}`}>
                                        {v.artwork_url && (
                                            <button onClick={() => setOpen(v)} className="block w-full">
                                                <img src={v.artwork_url} alt="" className="w-full aspect-square object-contain bg-[#0a0a0a]" />
                                            </button>
                                        )}
                                        <button onClick={() => handleWinner(v)}
                                            className={`w-full py-2 text-[9px] uppercase tracking-widest font-bold transition-all ${v.is_winner
                                                ? "bg-emerald-500/15 text-emerald-300"
                                                : "bg-white/5 text-white/40 hover:bg-white/10"}`}>
                                            {v.is_winner ? "Vítěz" : "Vybrat"}
                                        </button>
                                    </div>
                                ))}
                            </div>
                            <p className="text-[9px] text-white/25">Výběr vítěze se uloží do vizuální paměti značky a ovlivní i Instagram art directora.</p>
                        </div>
                    )}

                    {/* Artwork + dieline */}
                    <div className="grid sm:grid-cols-2 gap-3">
                        {open.artwork_url && (
                            <Preview label="Artwork" url={open.artwork_url} checkered />
                        )}
                        {open.dieline_url && (
                            <Preview label="Die-line (spadávka + bezpečný okraj)" url={open.dieline_url} />
                        )}
                    </div>

                    {open.mockup_url && (
                        <Preview label="Mockup" url={open.mockup_url} />
                    )}

                    {/* Print spec */}
                    {open.print_spec && (
                        <div className="bg-[#0a0a0a] border border-white/8 rounded-sm p-4 space-y-1.5">
                            <div className={LABEL}>Tiskové zadání</div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                                <SpecCell k="Formát" v={`${open.print_spec.widthMm} × ${open.print_spec.heightMm} mm`} />
                                <SpecCell k="Rozlišení" v={`${open.print_spec.pixelWidth} × ${open.print_spec.pixelHeight} px`} />
                                <SpecCell k="Spadávka" v={`${open.print_spec.bleedMm} mm`} />
                                <SpecCell k="Bezpečný okraj" v={`${open.print_spec.safeMarginMm} mm`} />
                            </div>
                            {open.print_spec.colors?.length > 0 && (
                                <div className="flex items-center gap-1.5 pt-1">
                                    {open.print_spec.colors.map((c: string) => (
                                        <span key={c} className="flex items-center gap-1 text-[9px] text-white/40">
                                            <span className="w-3 h-3 rounded-sm border border-white/15" style={{ background: c }} />
                                            {c}
                                        </span>
                                    ))}
                                </div>
                            )}
                            <p className="text-[9px] text-white/25 pt-1">{open.print_spec.note}</p>
                        </div>
                    )}

                    {/* Edit — no re-roll */}
                    <div className="space-y-1.5">
                        <label className={LABEL}>Upravit tenhle design (nezačíná od nuly)</label>
                        <div className="flex gap-2">
                            <input value={editInstruction} onChange={e => setEditInstruction(e.target.value)}
                                placeholder="např. zvětši nadpis, přidej text „Krok 2“"
                                className="flex-1 bg-[#0a0a0a] border border-white/8 rounded-sm px-3 py-2 text-sm text-white/90 focus:border-amber-500/40 focus:outline-none" />
                            <button onClick={handleEdit} disabled={editing || !editInstruction.trim()}
                                className="px-4 rounded-sm border border-white/10 hover:border-white/25 disabled:opacity-30 text-[9px] uppercase tracking-widest font-bold text-white/50 transition-all">
                                {editing ? "…" : "Upravit"}
                            </button>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2">
                        {open.artwork_print_url && (
                            <button onClick={() => download(open.artwork_print_url!, `${open.brief?.name || "design"}_300dpi.png`)}
                                className="px-3 py-2 rounded-sm border border-white/10 hover:border-white/25 text-[9px] uppercase tracking-widest font-bold text-white/50 transition-all">
                                Stáhnout tiskový PNG
                            </button>
                        )}
                        {open.dieline_url && (
                            <button onClick={() => download(open.dieline_url!, `${open.brief?.name || "design"}_dieline.png`)}
                                className="px-3 py-2 rounded-sm border border-white/10 hover:border-white/25 text-[9px] uppercase tracking-widest font-bold text-white/50 transition-all">
                                Stáhnout die-line
                            </button>
                        )}
                        <button onClick={handleMockup} disabled={mockingUp}
                            className="px-3 py-2 rounded-sm border border-white/10 hover:border-white/25 disabled:opacity-30 text-[9px] uppercase tracking-widest font-bold text-white/50 transition-all">
                            {mockingUp ? "Renderuji…" : "Vytvořit mockup"}
                        </button>
                        <div className="flex gap-1 ml-auto">
                            <button onClick={() => handleRate(open, 1)}
                                className={`px-3 py-2 rounded-sm border text-sm transition-all ${open.rating === 1 ? "bg-emerald-500/15 border-emerald-500/40" : "border-white/10 hover:border-white/25"}`}>👍</button>
                            <button onClick={() => handleRate(open, -1)}
                                className={`px-3 py-2 rounded-sm border text-sm transition-all ${open.rating === -1 ? "bg-red-500/15 border-red-500/40" : "border-white/10 hover:border-white/25"}`}>👎</button>
                        </div>
                    </div>
                </motion.div>
            )}

            {/* ── History ── */}
            {designs.length > 0 && (
                <div className="space-y-2">
                    <div className={LABEL}>Historie designů ({designs.length})</div>
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                        {designs.map(d => (
                            <button key={d.id} onClick={() => setOpen(d)}
                                className={`rounded-sm border overflow-hidden transition-all ${open?.id === d.id ? "border-amber-500/50" : "border-white/8 hover:border-white/20"}`}>
                                {d.artwork_url
                                    ? <img src={d.artwork_url} alt="" className="w-full aspect-square object-contain bg-[#0a0a0a]" />
                                    : <div className="w-full aspect-square bg-[#0a0a0a] flex items-center justify-center text-white/20 text-xl">🎨</div>}
                                <div className="px-1.5 py-1 text-[8px] uppercase tracking-widest font-bold text-white/35 truncate">
                                    {d.is_winner && <Star className="w-3 h-3 inline-block align-[-1px] mr-1" />}{d.brief?.name || d.category_slug}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}

function Preview({ label, url, checkered }: { label: string; url: string; checkered?: boolean }) {
    return (
        <div className="space-y-1.5">
            <div className={LABEL}>{label}</div>
            <a href={url} target="_blank" rel="noopener noreferrer"
                className="block rounded-sm border border-white/8 overflow-hidden"
                style={checkered ? {
                    // Checkerboard makes the alpha channel visible — the whole point of
                    // cut-out artwork is that the background is actually gone.
                    backgroundImage: "linear-gradient(45deg,#1a1a1a 25%,transparent 25%),linear-gradient(-45deg,#1a1a1a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#1a1a1a 75%),linear-gradient(-45deg,transparent 75%,#1a1a1a 75%)",
                    backgroundSize: "16px 16px",
                    backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
                    backgroundColor: "#0a0a0a",
                } : { backgroundColor: "#0a0a0a" }}>
                <img src={url} alt={label} className="w-full object-contain max-h-[420px]" />
            </a>
        </div>
    )
}

function SpecCell({ k, v }: { k: string; v: string }) {
    return (
        <div>
            <div className="text-[8px] uppercase tracking-widest font-bold text-white/25">{k}</div>
            <div className="text-white/60">{v}</div>
        </div>
    )
}

/**
 * Výsledek faktické brány nad TIŠTĚNÝM textem (instagram/fact-check.ts). Ukládá se
 * do briefu; bez tohohle čipu by tam ležel neviditelný — a tisk se na rozdíl od
 * příspěvku nedá vzít zpátky, takže varování musí být vidět PŘED objednáním.
 */
function FactChip({ brief }: { brief: any }) {
    const fc = brief?.factCheck
    if (!fc || fc.status !== "flagged") return null
    const flags: string[] = Array.isArray(fc.flags) ? fc.flags : []
    return (
        <span
            title={`V textu zůstalo tvrzení bez opory v ověřených faktech:\n${flags.join("\n") || "—"}\n\nDoplň fakt v Nastavení → Ověřená fakta, nebo text uprav před tiskem.`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm border text-[9px] font-bold uppercase tracking-widest bg-amber-500/10 border-amber-500/30 text-amber-400"
        >Ověř fakta</span>
    )
}

function QaChip({ status }: { status: string | null }) {
    if (!status) return null
    const map: Record<string, { c: string; l: string }> = {
        pass: { c: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400", l: "QA OK" },
        retry_pass: { c: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400", l: "QA OK (oprava)" },
        native_forced: { c: "bg-amber-500/10 border-amber-500/30 text-amber-400", l: "Nejlepší pokus" },
        edited: { c: "bg-white/5 border-white/10 text-white/40", l: "Upraveno" },
        failed: { c: "bg-red-500/10 border-red-500/30 text-red-400", l: "Chyba" },
    }
    const s = map[status] || map.edited
    return (
        <span className={`px-2 py-0.5 rounded-sm border text-[8px] uppercase tracking-widest font-bold ${s.c}`}>{s.l}</span>
    )
}
