"use client"

/**
 * Product catalog — moved here from SettingsTab.
 *
 * It lived under Nastavení → Produkty while the Product Studio lived in its own
 * top-level tab, so "where do I create a product" had two different answers.
 *
 * Additions over the SettingsTab version: grouping by product line, the line
 * step/role badges, and a field for `variants` (a column that has existed and been
 * accepted by createProduct/updateProduct all along with no way to set it).
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"
import {
    getProducts,
    createProduct,
    updateProduct,
    deleteProduct,
    deleteProducts,
    uploadProductImage,
    scrapeProductsFromWebsite,
    previewProductsFromUrls,
    saveImportedProducts,
} from "@/app/actions/product-actions"
// Typ jde přímo ze zdroje, ne přes server action: `"use server"` modul typ
// re-exportovat nesmí (viz komentář v product-actions.ts). `import type` se
// smaže při překladu, takže si klient nic serverového nepřitáhne.
import type { ProductUrlDraft } from "@/lib/product-import"
import { getLines, type LineRow } from "@/app/actions/line-actions"
import { Camera, Link2, Package, Pencil, X } from "lucide-react"

const LABEL = "text-[9px] uppercase tracking-widest font-bold text-white/40"
const INPUT = "w-full bg-[#0a0a0a] border border-white/8 rounded-sm px-3 py-2 text-sm text-white/90 focus:border-amber-500/40 focus:outline-none"

const EMPTY_FORM = { name: "", type: "", slug: "", price: "", description: "", variants: "" }

export function CatalogSection({ projectId }: { projectId: string }) {
    const [products, setProducts] = useState<any[]>([])
    const [lines, setLines] = useState<LineRow[]>([])
    const [loading, setLoading] = useState(true)
    const [showForm, setShowForm] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [uploading, setUploading] = useState<string | null>(null)
    const [scraping, setScraping] = useState(false)
    const [scrapeResult, setScrapeResult] = useState<string | null>(null)
    const [form, setForm] = useState(EMPTY_FORM)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [bulkDeleting, setBulkDeleting] = useState(false)
    const [lineFilter, setLineFilter] = useState<string>("all")

    // Import z přímých odkazů — dvoufázový: načti → potvrď → ulož
    const [showImport, setShowImport] = useState(false)
    const [importUrls, setImportUrls] = useState("")
    const [importing, setImporting] = useState(false)
    const [drafts, setDrafts] = useState<ProductUrlDraft[] | null>(null)
    const [draftsOff, setDraftsOff] = useState<Set<number>>(new Set())
    const [savingImport, setSavingImport] = useState(false)
    const [importError, setImportError] = useState<string | null>(null)
    const [importResult, setImportResult] = useState<string | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        const [p, l] = await Promise.all([getProducts(projectId), getLines(projectId)])
        setProducts(p)
        setLines(l)
        setLoading(false)
    }, [projectId])

    useEffect(() => { load() }, [load])

    const lineName = useMemo(() => {
        const map = new Map(lines.map(l => [l.id, l.name]))
        return (id: string | null) => (id ? map.get(id) || null : null)
    }, [lines])

    const visible = useMemo(() => {
        const filtered = lineFilter === "all"
            ? products
            : lineFilter === "none"
                ? products.filter(p => !p.line_id)
                : products.filter(p => p.line_id === lineFilter)

        // Products inside a line read as a sequence, so order by step; everything
        // else keeps the newest-first order getProducts returns.
        return [...filtered].sort((a, b) => {
            if (a.line_id && b.line_id && a.line_id === b.line_id) {
                return (a.line_step ?? 99) - (b.line_step ?? 99)
            }
            return 0
        })
    }, [products, lineFilter])

    const autoSlug = (name: string) =>
        name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

    const handleSubmit = async () => {
        if (!form.name || !form.slug) return
        setSaving(true)
        const payload = {
            name: form.name,
            type: form.type,
            slug: form.slug,
            price: form.price,
            description: form.description,
            variants: form.variants ? Number(form.variants) : undefined,
        }
        if (editingId) await updateProduct(editingId, projectId, payload)
        else await createProduct(projectId, payload)
        setForm(EMPTY_FORM)
        setShowForm(false)
        setEditingId(null)
        setSaving(false)
        await load()
    }

    const handleEdit = (p: any) => {
        setForm({
            name: p.name,
            type: p.type || "",
            slug: p.slug,
            price: p.price || "",
            description: p.description || "",
            variants: p.variants != null ? String(p.variants) : "",
        })
        setEditingId(p.id)
        setShowForm(true)
    }

    const handleDelete = async (id: string) => {
        if (!confirm("Smazat produkt? Tato akce je nevratná.")) return
        await deleteProduct(id, projectId)
        await load()
    }

    const handleImageUpload = async (productId: string, e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        setUploading(productId)
        const fd = new FormData()
        fd.append("file", file)
        await uploadProductImage(projectId, productId, fd)
        await load()
        setUploading(null)
        e.target.value = ""
    }

    const resetImport = () => {
        setShowImport(false)
        setImportUrls("")
        setDrafts(null)
        setDraftsOff(new Set())
        setImportError(null)
    }

    const handlePreviewUrls = async () => {
        // URL nesmí obsahovat mezeru, takže dělení po bílých znacích zvládne
        // nalepený sloupec odkazů i odkazy oddělené mezerou
        const urls = importUrls.split(/\s+/).filter(Boolean)
        if (urls.length === 0) return
        setImporting(true)
        setImportError(null)
        setImportResult(null)
        const res = await previewProductsFromUrls(projectId, urls)
        if (res.success && res.drafts) {
            setDrafts(res.drafts)
            // Duplicitu nech odškrtnutou — druhý import téhož odkazu je skoro vždy omyl
            setDraftsOff(new Set(res.drafts.flatMap((d, i) => (d.ok && !d.duplicateOf ? [] : [i]))))
        } else {
            setImportError(res.error || "Načtení selhalo")
        }
        setImporting(false)
    }

    const patchDraft = (index: number, patch: Partial<ProductUrlDraft>) =>
        setDrafts(list => list?.map((d, i) => (i === index ? { ...d, ...patch } : d)) ?? null)

    const handleSaveImport = async () => {
        if (!drafts) return
        const chosen = drafts.filter((d, i) => d.ok && d.name.trim() && !draftsOff.has(i))
        if (chosen.length === 0) return
        setSavingImport(true)
        setImportError(null)
        const res = await saveImportedProducts(projectId, chosen.map(d => ({
            url: d.url,
            name: d.name,
            type: d.type,
            slug: d.slug,
            price: d.price,
            description: d.description,
            imageUrls: d.imageUrls,
        })))
        setSavingImport(false)
        if (res.success) {
            setImportResult(
                `Uloženo ${res.inserted} produktů · ${res.images} fotek${res.skipped ? ` · ${res.skipped} přeskočeno` : ""}`
            )
            resetImport()
            await load()
        } else {
            setImportError(res.error || "Uložení selhalo")
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
        )
    }

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="bg-[#050505] border border-white/5 rounded-sm p-5">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                        <h3 className="text-[11px] uppercase tracking-widest font-bold text-white/70">Produktový katalog</h3>
                        <p className="text-[10px] text-white/30 mt-1">
                            Zdroj pravdy pro generování obsahu. Produkty se do postů přiřazují přes @ mention v content planu.
                        </p>
                        {products.length > 0 && (
                            <p className="text-[10px] text-white/30 mt-2">{products.length} produktů v katalogu</p>
                        )}
                        {scrapeResult && <p className="text-[10px] text-white/50 mt-1">{scrapeResult}</p>}
                        {importResult && <p className="text-[10px] text-emerald-400/70 mt-1">{importResult}</p>}
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 flex-shrink-0">
                        <button
                            onClick={() => {
                                setImportResult(null)
                                setShowImport(v => !v)
                            }}
                            className={`px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm border whitespace-nowrap transition-all flex items-center justify-center gap-1.5 ${showImport
                                ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
                                : "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border-amber-500/20"}`}
                        >
                            <Link2 className="w-3 h-3" />
                            Vložit odkaz
                        </button>
                        <button
                            onClick={async () => {
                                setScraping(true)
                                setScrapeResult(null)
                                const res = await scrapeProductsFromWebsite(projectId)
                                if (res.success) {
                                    setScrapeResult(`Nalezeno ${res.found} · vloženo ${res.inserted} nových · ${res.images} fotek staženo`)
                                    await load()
                                } else {
                                    setScrapeResult(`Chyba: ${res.error}`)
                                }
                                setScraping(false)
                            }}
                            disabled={scraping}
                            className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/20 disabled:opacity-50 whitespace-nowrap transition-all"
                        >
                            {scraping ? "Scanuji web…" : "Načíst z webu"}
                        </button>
                    </div>
                </div>
            </div>

            {/* Import z přímých odkazů */}
            {showImport && (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                    className="bg-[#0f0f0f] border border-amber-500/20 rounded-sm p-5 space-y-4">
                    <div>
                        <h4 className="text-[11px] uppercase tracking-widest font-bold text-amber-400/80">Import z odkazů</h4>
                        <p className="text-[10px] text-white/30 mt-1">
                            Vlož odkaz na konkrétní produkt — jeden na řádek, max 10 najednou. Načtu název,
                            cenu, popis i fotky a ukážu ti je k potvrzení, než se uloží.
                        </p>
                    </div>

                    <textarea
                        value={importUrls}
                        onChange={(e) => setImportUrls(e.target.value)}
                        rows={4}
                        spellCheck={false}
                        className={`${INPUT} font-mono text-xs resize-y`}
                        placeholder={"https://obchod.cz/produkt/keramicka-ochrana\nhttps://obchod.cz/produkt/sampon"}
                    />

                    {importError && <p className="text-[10px] text-red-400/80">{importError}</p>}

                    <div className="flex items-center justify-end gap-3">
                        <button onClick={resetImport}
                            className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white/70 transition-colors">
                            Zavřít
                        </button>
                        <button onClick={handlePreviewUrls} disabled={importing || !importUrls.trim()}
                            className="px-6 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-sm bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 disabled:opacity-40 transition-all">
                            {importing ? "Načítám…" : drafts ? "Načíst znovu" : "Načíst produkty"}
                        </button>
                    </div>

                    {/* Náhled — nic z tohohle není v katalogu, dokud se to nepotvrdí */}
                    {drafts && (
                        <div className="space-y-3 pt-2 border-t border-white/10">
                            {drafts.map((d, i) => !d.ok ? (
                                <div key={`${d.url}-${i}`} className="bg-[#0a0a0a] border border-red-500/20 rounded-sm p-4">
                                    <p className="text-[10px] font-mono text-white/40 truncate">{d.url}</p>
                                    <p className="text-[10px] text-red-400/80 mt-1">{d.error}</p>
                                </div>
                            ) : (
                                <div key={`${d.url}-${i}`}
                                    className={`bg-[#0a0a0a] border rounded-sm p-4 space-y-3 transition-all ${draftsOff.has(i) ? "border-white/5 opacity-45" : "border-emerald-500/20"}`}>
                                    <div className="flex items-start gap-3">
                                        <input
                                            type="checkbox"
                                            checked={!draftsOff.has(i)}
                                            onChange={() => setDraftsOff(prev => {
                                                const next = new Set(prev)
                                                if (next.has(i)) next.delete(i)
                                                else next.add(i)
                                                return next
                                            })}
                                            className="mt-1 w-4 h-4 accent-emerald-500 cursor-pointer flex-shrink-0"
                                        />
                                        <div className="flex-1 min-w-0 space-y-3">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <a href={d.url} target="_blank" rel="noopener noreferrer"
                                                    className="text-[9px] font-mono text-white/30 hover:text-white/60 truncate max-w-full transition-colors">
                                                    {d.url}
                                                </a>
                                                <Badge tone={d.extraction === "ai" ? "amber" : "neutral"}>
                                                    {d.extraction === "structured" ? "Odečteno ze stránky" : d.extraction === "mixed" ? "Odečteno + doplněno AI" : "Dopočítala AI"}
                                                </Badge>
                                                {d.duplicateOf && <Badge tone="red">Už v katalogu: {d.duplicateOf}</Badge>}
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                <div className="space-y-1.5 md:col-span-2">
                                                    <label className={LABEL}>Název</label>
                                                    <input value={d.name} className={INPUT}
                                                        onChange={(e) => patchDraft(i, { name: e.target.value })} />
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className={LABEL}>Typ / kategorie</label>
                                                    <input value={d.type} className={INPUT} placeholder="produkt"
                                                        onChange={(e) => patchDraft(i, { type: e.target.value })} />
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className={LABEL}>Cena</label>
                                                    <input value={d.price} className={INPUT} placeholder="990 Kč"
                                                        onChange={(e) => patchDraft(i, { price: e.target.value })} />
                                                </div>
                                                <div className="space-y-1.5 md:col-span-2">
                                                    <label className={LABEL}>Slug (URL)</label>
                                                    <input value={d.slug} className={`${INPUT} font-mono`}
                                                        onChange={(e) => patchDraft(i, { slug: e.target.value })} />
                                                </div>
                                                <div className="space-y-1.5 md:col-span-2">
                                                    <label className={LABEL}>Popis</label>
                                                    <textarea value={d.description} rows={2} className={`${INPUT} resize-y`}
                                                        placeholder="Co produkt dělá, pro koho je, čím se liší."
                                                        onChange={(e) => patchDraft(i, { description: e.target.value })} />
                                                </div>
                                            </div>

                                            <div className="space-y-1.5">
                                                <label className={LABEL}>
                                                    Fotky {d.imageUrls.length > 0 ? `(${d.imageUrls.length}) — křížkem vyhodíš, co není produkt` : "— žádné nenalezeny"}
                                                </label>
                                                {d.imageUrls.length > 0 && (
                                                    <div className="flex gap-2 flex-wrap">
                                                        {d.imageUrls.map((url, imgIndex) => (
                                                            <div key={url} className="relative group">
                                                                <img src={url} alt="" referrerPolicy="no-referrer"
                                                                    className="w-16 h-16 object-cover rounded-sm border border-white/10 bg-[#050505]" />
                                                                <button
                                                                    onClick={() => patchDraft(i, { imageUrls: d.imageUrls.filter((_, k) => k !== imgIndex) })}
                                                                    title="Odebrat fotku"
                                                                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#0a0a0a] border border-white/20 text-white/50 hover:text-red-400 hover:border-red-400/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all">
                                                                    <X className="w-3 h-3" />
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}

                            <div className="flex items-center justify-between gap-3 pt-1">
                                <span className="text-[9px] uppercase tracking-widest font-bold text-white/30">
                                    {drafts.filter((d, i) => d.ok && !draftsOff.has(i)).length} k uložení
                                </span>
                                <button onClick={handleSaveImport}
                                    disabled={savingImport || drafts.every((d, i) => !d.ok || draftsOff.has(i))}
                                    className="px-6 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-sm bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 disabled:opacity-40 transition-all">
                                    {savingImport ? "Ukládám…" : "Uložit do katalogu"}
                                </button>
                            </div>
                        </div>
                    )}
                </motion.div>
            )}

            {/* Line filter */}
            {lines.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    <FilterChip active={lineFilter === "all"} onClick={() => setLineFilter("all")}>Vše</FilterChip>
                    {lines.map(l => (
                        <FilterChip key={l.id} active={lineFilter === l.id} onClick={() => setLineFilter(l.id)}>
                            {l.name}
                        </FilterChip>
                    ))}
                    <FilterChip active={lineFilter === "none"} onClick={() => setLineFilter("none")}>Bez řady</FilterChip>
                </div>
            )}

            {/* Bulk actions */}
            {visible.length > 0 && (
                <div className="flex items-center justify-between gap-3 bg-[#0a0a0a] border border-white/5 rounded-sm px-4 py-3">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => {
                                if (selectedIds.size === visible.length) setSelectedIds(new Set())
                                else setSelectedIds(new Set(visible.map(p => p.id)))
                            }}
                            className="text-[9px] text-white/40 hover:text-white/70 font-bold uppercase tracking-widest transition-colors"
                        >
                            {selectedIds.size === visible.length ? "Odznačit vše" : "Vybrat vše"}
                        </button>
                        {selectedIds.size > 0 && <span className="text-[9px] text-white/30">{selectedIds.size} vybráno</span>}
                    </div>
                    {selectedIds.size > 0 && (
                        <button
                            onClick={async () => {
                                if (!confirm(`Smazat ${selectedIds.size} produktů? Tato akce je nevratná.`)) return
                                setBulkDeleting(true)
                                await deleteProducts(Array.from(selectedIds), projectId)
                                setSelectedIds(new Set())
                                setBulkDeleting(false)
                                await load()
                            }}
                            disabled={bulkDeleting}
                            className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 disabled:opacity-50 transition-all"
                        >
                            {bulkDeleting ? "Mažu…" : `Smazat ${selectedIds.size}`}
                        </button>
                    )}
                </div>
            )}

            {visible.length === 0 && (
                <p className="text-[10px] text-white/30 text-center py-8 uppercase tracking-widest font-bold">
                    Žádné produkty — vložte odkaz na produkt, načtěte je z webu, přidejte ručně, nebo nechte AI navrhnout celou řadu.
                </p>
            )}

            {/* Product list */}
            {visible.map(p => (
                <div key={p.id}
                    className={`bg-[#0f0f0f] border rounded-sm p-5 transition-all ${selectedIds.has(p.id) ? "border-red-500/30 bg-red-500/5" : "border-white/5 hover:border-white/10"}`}>
                    <div className="flex items-start gap-4">
                        <label className="flex-shrink-0 flex items-center justify-center w-5 h-16 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={selectedIds.has(p.id)}
                                onChange={(e) => setSelectedIds(prev => {
                                    const next = new Set(prev)
                                    if (e.target.checked) next.add(p.id)
                                    else next.delete(p.id)
                                    return next
                                })}
                                className="w-3.5 h-3.5 rounded-sm border-white/20 bg-[#050505] accent-red-500 cursor-pointer"
                            />
                        </label>

                        <div className="w-16 h-16 flex-shrink-0 bg-[#050505] border border-white/10 rounded-sm overflow-hidden flex items-center justify-center">
                            {p.image_urls?.length > 0
                                ? <img src={p.image_urls[0]} alt={p.name} className="w-full h-full object-cover" />
                                : <Package className="w-6 h-6 opacity-30" />}
                        </div>

                        <div className="flex-1 min-w-0">
                            <div className="flex items-center flex-wrap gap-2 mb-1">
                                {p.line_step != null && (
                                    <span className="w-5 h-5 rounded-sm bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-[9px] font-bold text-amber-400 shrink-0">
                                        {p.line_step}
                                    </span>
                                )}
                                <span className="text-white font-bold text-sm">{p.name}</span>
                                {lineName(p.line_id) && (
                                    <span className="text-[8px] px-1.5 py-0.5 bg-amber-500/10 border border-amber-500/25 rounded-sm text-amber-400/80 font-bold uppercase tracking-wider">
                                        {lineName(p.line_id)}
                                    </span>
                                )}
                                {p.line_role && (
                                    <span className="text-[8px] px-1.5 py-0.5 bg-white/5 border border-white/10 rounded-sm text-white/40 font-bold uppercase tracking-wider">
                                        {p.line_role}
                                    </span>
                                )}
                                {p.type && !p.line_id && (
                                    <span className="text-[8px] px-1.5 py-0.5 bg-white/5 border border-white/10 rounded-sm text-white/40 font-bold uppercase tracking-wider">{p.type}</span>
                                )}
                            </div>
                            {p.description && <p className="text-[10px] text-white/40 leading-relaxed line-clamp-2">{p.description}</p>}
                            <div className="flex items-center flex-wrap gap-3 mt-2">
                                {p.price && <span className="text-[10px] text-emerald-400/70 font-bold">{p.price}</span>}
                                <span className="text-[8px] text-white/20 font-mono">/{p.slug}</span>
                                <span className="text-[8px] text-white/20">{(p.image_urls || []).length} fotek</span>
                                {p.specs?.volume && <span className="text-[8px] text-white/25">{p.specs.volume}</span>}
                            </div>
                        </div>

                        <div className="flex items-center gap-1 flex-shrink-0">
                            <label className={`p-2 text-white/20 hover:text-blue-400/80 cursor-pointer transition-colors ${uploading === p.id ? "animate-pulse" : ""}`} title="Nahrát obrázek">
                                <Camera className="w-3 h-3 text-[10px]" />
                                <input type="file" accept="image/*" className="hidden"
                                    onChange={(e) => handleImageUpload(p.id, e)} disabled={uploading === p.id} />
                            </label>
                            <button onClick={() => handleEdit(p)} className="p-2 text-white/20 hover:text-white/60 transition-colors" title="Upravit">
                                <Pencil className="w-3 h-3 text-[10px]" />
                            </button>
                            <button onClick={() => handleDelete(p.id)} className="p-2 text-white/20 hover:text-red-400/80 transition-colors" title="Smazat">
                                <X className="w-3 h-3 text-[10px]" />
                            </button>
                        </div>
                    </div>

                    {p.image_urls?.length > 1 && (
                        <div className="flex gap-2 mt-3 overflow-x-auto">
                            {p.image_urls.map((url: string, i: number) => (
                                <img key={i} src={url} alt={`${p.name} ${i + 1}`}
                                    className="w-12 h-12 object-cover rounded-sm border border-white/10 flex-shrink-0" />
                            ))}
                        </div>
                    )}
                </div>
            ))}

            {/* Add / edit form */}
            {showForm && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    className="bg-[#0f0f0f] border border-white/10 rounded-sm p-6 space-y-4">
                    <div className="border-b border-white/10 pb-3">
                        <h4 className="text-sm font-black uppercase tracking-widest text-white/70">
                            {editingId ? "Upravit produkt" : "Nový produkt"}
                        </h4>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className={LABEL}>Název produktu</label>
                            <input value={form.name} className={INPUT} placeholder="Keramická ochrana laku"
                                onChange={(e) => {
                                    const name = e.target.value
                                    setForm(f => ({ ...f, name, slug: editingId ? f.slug : autoSlug(name) }))
                                }} />
                        </div>
                        <div className="space-y-1.5">
                            <label className={LABEL}>Slug (URL)</label>
                            <input value={form.slug} className={`${INPUT} font-mono`} placeholder="keramicka-ochrana"
                                onChange={(e) => setForm(f => ({ ...f, slug: e.target.value }))} />
                        </div>
                        <div className="space-y-1.5">
                            <label className={LABEL}>Typ / kategorie</label>
                            <input value={form.type} className={INPUT} placeholder="Autokosmetika, Balíček, Služba…"
                                onChange={(e) => setForm(f => ({ ...f, type: e.target.value }))} />
                        </div>
                        <div className="space-y-1.5">
                            <label className={LABEL}>Cena</label>
                            <input value={form.price} className={INPUT} placeholder="990 Kč"
                                onChange={(e) => setForm(f => ({ ...f, price: e.target.value }))} />
                        </div>
                        <div className="space-y-1.5">
                            <label className={LABEL}>Počet variant (volitelné)</label>
                            <input value={form.variants} type="number" min={0} className={INPUT} placeholder="3"
                                onChange={(e) => setForm(f => ({ ...f, variants: e.target.value }))} />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <label className={LABEL}>Popis — čím konkrétnější, tím lepší captions</label>
                        <textarea value={form.description} rows={3} className={`${INPUT} resize-y`}
                            placeholder="Co produkt dělá, pro koho je, čím se liší."
                            onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} />
                    </div>

                    <div className="flex items-center justify-end gap-3 pt-2">
                        <button onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM) }}
                            className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white/70 transition-colors">
                            Zrušit
                        </button>
                        <button onClick={handleSubmit} disabled={saving || !form.name || !form.slug}
                            className="px-6 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-sm bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 disabled:opacity-40 transition-all">
                            {saving ? "Ukládám…" : editingId ? "Uložit změny" : "Vytvořit produkt"}
                        </button>
                    </div>
                </motion.div>
            )}

            {!showForm && (
                <button onClick={() => { setShowForm(true); setEditingId(null); setForm(EMPTY_FORM) }}
                    className="w-full py-4 border border-dashed border-white/15 rounded-sm text-[10px] text-white/40 font-bold uppercase tracking-widest hover:text-white/70 hover:border-white/30 transition-all">
                    + Přidat produkt
                </button>
            )}
        </div>
    )
}

function Badge({ tone, children }: { tone: "neutral" | "amber" | "red"; children: React.ReactNode }) {
    const palette = {
        neutral: "border-white/10 text-white/35",
        amber: "border-amber-500/30 text-amber-400/80",
        red: "border-red-500/30 text-red-400/80",
    }[tone]
    return (
        <span className={`px-2 py-0.5 rounded-sm border text-[8px] uppercase tracking-widest font-bold whitespace-nowrap ${palette}`}>
            {children}
        </span>
    )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button onClick={onClick}
            className={`px-3 py-1.5 rounded-sm border text-[9px] uppercase tracking-widest font-bold transition-all ${active
                ? "bg-amber-500/10 border-amber-500/40 text-amber-400"
                : "bg-[#0a0a0a] border-white/8 text-white/40 hover:border-white/20"}`}>
            {children}
        </button>
    )
}
