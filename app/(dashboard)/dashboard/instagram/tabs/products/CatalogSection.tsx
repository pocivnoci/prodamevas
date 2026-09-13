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
import { createPortal } from "react-dom"
import { motion } from "framer-motion"
import { useTranslations } from "next-intl"
import {
    getProducts,
    createProduct,
    updateProduct,
    deleteProduct,
    deleteProductImage,
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
import { Camera, Link2, Package, Pencil, Plus, X } from "lucide-react"

const LABEL = "text-[9px] uppercase tracking-widest font-bold text-white/40"
const INPUT = "w-full bg-[#0a0a0a] border border-white/8 rounded-sm px-3 py-2 text-sm text-white/90 focus:border-amber-500/40 focus:outline-none"

const EMPTY_FORM = { name: "", type: "", slug: "", price: "", description: "", variants: "" }

/** Řádek `ig_products` v rozsahu, který formulář opravdu čte a zapisuje. */
interface CatalogProduct {
    id: string
    name: string
    slug: string
    type?: string | null
    price?: string | null
    description?: string | null
    variants?: number | null
    image_urls?: string[] | null
}

export function CatalogSection({ projectId }: { projectId: string }) {
    const t = useTranslations("products.catalog")
    const [products, setProducts] = useState<any[]>([])
    const [lines, setLines] = useState<LineRow[]>([])
    const [loading, setLoading] = useState(true)
    /** `null` = zavřeno, `"new"` = nový produkt, jinak upravovaný produkt. */
    const [editing, setEditing] = useState<CatalogProduct | "new" | null>(null)
    const [uploading, setUploading] = useState<string | null>(null)
    const [scraping, setScraping] = useState(false)
    const [scrapeResult, setScrapeResult] = useState<string | null>(null)
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

    const handleDelete = async (id: string) => {
        if (!confirm(t("deleteConfirm"))) return
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
            setImportError(res.error || t("import.loadFailed"))
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
            setImportResult(t("import.saved", { inserted: res.inserted, images: res.images, skipped: res.skipped }))
            resetImport()
            await load()
        } else {
            setImportError(res.error || t("common.saveFailed"))
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
                        <h3 className="text-[11px] uppercase tracking-widest font-bold text-white/70">{t("header.title")}</h3>
                        <p className="text-[10px] text-white/30 mt-1">
                            {t("header.intro")}
                        </p>
                        {products.length > 0 && (
                            <p className="text-[10px] text-white/30 mt-2">{t("header.count", { count: products.length })}</p>
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
                            {t("header.importLink")}
                        </button>
                        <button
                            onClick={async () => {
                                setScraping(true)
                                setScrapeResult(null)
                                const res = await scrapeProductsFromWebsite(projectId)
                                if (res.success) {
                                    setScrapeResult(t("header.scrapeResult", { found: res.found, inserted: res.inserted, images: res.images }))
                                    await load()
                                } else {
                                    setScrapeResult(t("header.scrapeError", { error: res.error ?? "" }))
                                }
                                setScraping(false)
                            }}
                            disabled={scraping}
                            className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/20 disabled:opacity-50 whitespace-nowrap transition-all"
                        >
                            {scraping ? t("header.scraping") : t("header.scrape")}
                        </button>
                    </div>
                </div>
            </div>

            {/* Import z přímých odkazů */}
            {showImport && (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                    className="bg-[#0f0f0f] border border-amber-500/20 rounded-sm p-5 space-y-4">
                    <div>
                        <h4 className="text-[11px] uppercase tracking-widest font-bold text-amber-400/80">{t("import.title")}</h4>
                        <p className="text-[10px] text-white/30 mt-1">
                            {t("import.intro")}
                        </p>
                    </div>

                    <textarea
                        value={importUrls}
                        onChange={(e) => setImportUrls(e.target.value)}
                        rows={4}
                        spellCheck={false}
                        className={`${INPUT} font-mono text-xs resize-y`}
                        placeholder={t("import.placeholder")}
                    />

                    {importError && <p className="text-[10px] text-red-400/80">{importError}</p>}

                    <div className="flex items-center justify-end gap-3">
                        <button onClick={resetImport}
                            className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white/70 transition-colors">
                            {t("common.close")}
                        </button>
                        <button onClick={handlePreviewUrls} disabled={importing || !importUrls.trim()}
                            className="px-6 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-sm bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 disabled:opacity-40 transition-all">
                            {importing ? t("import.loading") : drafts ? t("import.reload") : t("import.load")}
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
                                                    {t(`import.extraction.${d.extraction}`)}
                                                </Badge>
                                                {d.duplicateOf && <Badge tone="red">{t("import.duplicate", { name: d.duplicateOf })}</Badge>}
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                <div className="space-y-1.5 md:col-span-2">
                                                    <label className={LABEL}>{t("import.name")}</label>
                                                    <input value={d.name} className={INPUT}
                                                        onChange={(e) => patchDraft(i, { name: e.target.value })} />
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className={LABEL}>{t("common.type")}</label>
                                                    <input value={d.type} className={INPUT} placeholder={t("import.typePlaceholder")}
                                                        onChange={(e) => patchDraft(i, { type: e.target.value })} />
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className={LABEL}>{t("common.price")}</label>
                                                    <input value={d.price} className={INPUT} placeholder={t("common.pricePlaceholder")}
                                                        onChange={(e) => patchDraft(i, { price: e.target.value })} />
                                                </div>
                                                <div className="space-y-1.5 md:col-span-2">
                                                    <label className={LABEL}>{t("common.slug")}</label>
                                                    <input value={d.slug} className={`${INPUT} font-mono`}
                                                        onChange={(e) => patchDraft(i, { slug: e.target.value })} />
                                                </div>
                                                <div className="space-y-1.5 md:col-span-2">
                                                    <label className={LABEL}>{t("import.description")}</label>
                                                    <textarea value={d.description} rows={2} className={`${INPUT} resize-y`}
                                                        placeholder={t("common.descriptionPlaceholder")}
                                                        onChange={(e) => patchDraft(i, { description: e.target.value })} />
                                                </div>
                                            </div>

                                            <div className="space-y-1.5">
                                                <label className={LABEL}>
                                                    {d.imageUrls.length > 0 ? t("import.photos", { count: d.imageUrls.length }) : t("import.photosNone")}
                                                </label>
                                                {d.imageUrls.length > 0 && (
                                                    <div className="flex gap-2 flex-wrap">
                                                        {d.imageUrls.map((url, imgIndex) => (
                                                            <div key={url} className="relative group">
                                                                <img src={url} alt="" referrerPolicy="no-referrer"
                                                                    className="w-16 h-16 object-cover rounded-sm border border-white/10 bg-[#050505]" />
                                                                <button
                                                                    onClick={() => patchDraft(i, { imageUrls: d.imageUrls.filter((_, k) => k !== imgIndex) })}
                                                                    title={t("common.removePhoto")}
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
                                    {t("import.toSave", { count: drafts.filter((d, i) => d.ok && !draftsOff.has(i)).length })}
                                </span>
                                <button onClick={handleSaveImport}
                                    disabled={savingImport || drafts.every((d, i) => !d.ok || draftsOff.has(i))}
                                    className="px-6 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-sm bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 disabled:opacity-40 transition-all">
                                    {savingImport ? t("common.saving") : t("import.save")}
                                </button>
                            </div>
                        </div>
                    )}
                </motion.div>
            )}

            {/* Line filter */}
            {lines.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    <FilterChip active={lineFilter === "all"} onClick={() => setLineFilter("all")}>{t("filter.all")}</FilterChip>
                    {lines.map(l => (
                        <FilterChip key={l.id} active={lineFilter === l.id} onClick={() => setLineFilter(l.id)}>
                            {l.name}
                        </FilterChip>
                    ))}
                    <FilterChip active={lineFilter === "none"} onClick={() => setLineFilter("none")}>{t("filter.none")}</FilterChip>
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
                            {selectedIds.size === visible.length ? t("bulk.deselectAll") : t("bulk.selectAll")}
                        </button>
                        {selectedIds.size > 0 && <span className="text-[9px] text-white/30">{t("bulk.selected", { count: selectedIds.size })}</span>}
                    </div>
                    {selectedIds.size > 0 && (
                        <button
                            onClick={async () => {
                                if (!confirm(t("bulk.deleteConfirm", { count: selectedIds.size }))) return
                                setBulkDeleting(true)
                                await deleteProducts(Array.from(selectedIds), projectId)
                                setSelectedIds(new Set())
                                setBulkDeleting(false)
                                await load()
                            }}
                            disabled={bulkDeleting}
                            className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 disabled:opacity-50 transition-all"
                        >
                            {bulkDeleting ? t("bulk.deleting") : t("bulk.delete", { count: selectedIds.size })}
                        </button>
                    )}
                </div>
            )}

            {visible.length === 0 && (
                <p className="text-[10px] text-white/30 text-center py-8 uppercase tracking-widest font-bold">
                    {t("empty")}
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
                                <span className="text-[8px] text-white/20">{t("item.photos", { count: (p.image_urls || []).length })}</span>
                                {p.specs?.volume && <span className="text-[8px] text-white/25">{p.specs.volume}</span>}
                            </div>
                        </div>

                        <div className="flex items-center gap-1 flex-shrink-0">
                            <label className={`p-2 text-white/20 hover:text-blue-400/80 cursor-pointer transition-colors ${uploading === p.id ? "animate-pulse" : ""}`} title={t("item.upload")}>
                                <Camera className="w-3 h-3 text-[10px]" />
                                <input type="file" accept="image/*" className="hidden"
                                    onChange={(e) => handleImageUpload(p.id, e)} disabled={uploading === p.id} />
                            </label>
                            <button onClick={() => setEditing(p)} className="p-2 text-white/20 hover:text-white/60 transition-colors" title={t("item.edit")}>
                                <Pencil className="w-3 h-3 text-[10px]" />
                            </button>
                            <button onClick={() => handleDelete(p.id)} className="p-2 text-white/20 hover:text-red-400/80 transition-colors" title={t("item.delete")}>
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

            <button onClick={() => setEditing("new")}
                className="w-full py-4 border border-dashed border-white/15 rounded-sm text-[10px] text-white/40 font-bold uppercase tracking-widest hover:text-white/70 hover:border-white/30 transition-all">
                {t("add")}
            </button>

            {/* Úpravy produktu žijí v modálu, ne pod seznamem. Formulář se vykresloval
                až za všemi produkty, takže u delšího katalogu klik na tužku nic
                viditelného neudělal — vypadalo to, že tlačítko nefunguje. */}
            {editing && (
                <ProductFormModal
                    projectId={projectId}
                    product={editing === "new" ? null : editing}
                    onClose={() => setEditing(null)}
                    onSaved={async () => { setEditing(null); await load() }}
                    onImagesChanged={load}
                />
            )}
        </div>
    )
}

/**
 * Všechny úpravy jednoho produktu na jednom místě — text i fotky.
 *
 * Fotky se ukládají hned (upload i mazání jsou samostatné akce nad storage),
 * texty až na „Uložit". Proto má modal dvě cesty ven: `onSaved` po uložení
 * textů a `onImagesChanged` průběžně, aby se seznam pod modálem srovnal
 * i tehdy, když se nakonec zavře křížkem.
 */
function ProductFormModal({ projectId, product, onClose, onSaved, onImagesChanged }: {
    projectId: string
    /** `null` = zakládá se nový produkt. */
    product: CatalogProduct | null
    onClose: () => void
    onSaved: () => void | Promise<void>
    onImagesChanged: () => void | Promise<void>
}) {
    const t = useTranslations("products.catalog")
    const editingId: string | null = product?.id ?? null

    const [form, setForm] = useState(() => product ? {
        name: product.name || "",
        type: product.type || "",
        slug: product.slug || "",
        price: product.price || "",
        description: product.description || "",
        variants: product.variants != null ? String(product.variants) : "",
    } : EMPTY_FORM)
    const [images, setImages] = useState<string[]>(product?.image_urls || [])
    const [saving, setSaving] = useState(false)
    const [busyImage, setBusyImage] = useState<string | null>(null)
    const [uploading, setUploading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Escape zavírá stejně jako klik mimo — modal je nad celou stránkou.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [onClose])

    const autoSlug = (name: string) =>
        name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

    const handleSubmit = async () => {
        if (!form.name || !form.slug) return
        setSaving(true)
        setError(null)
        const payload = {
            name: form.name,
            type: form.type,
            slug: form.slug,
            price: form.price,
            description: form.description,
            variants: form.variants ? Number(form.variants) : undefined,
        }
        const res = editingId
            ? await updateProduct(editingId, projectId, payload)
            : await createProduct(projectId, payload)
        setSaving(false)
        if (!res?.success) {
            setError(res?.error || t("common.saveFailed"))
            return
        }
        await onSaved()
    }

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        e.target.value = ""
        if (!file || !editingId) return
        setUploading(true)
        setError(null)
        const fd = new FormData()
        fd.append("file", file)
        const res = await uploadProductImage(projectId, editingId, fd)
        setUploading(false)
        if (!res.success || !res.publicUrl) {
            setError(res.error || t("form.uploadFailed"))
            return
        }
        setImages(list => [...list, res.publicUrl!])
        await onImagesChanged()
    }

    const handleRemoveImage = async (url: string) => {
        if (!editingId) return
        setBusyImage(url)
        setError(null)
        const res = await deleteProductImage(projectId, editingId, url)
        setBusyImage(null)
        if (!res.success) {
            setError(res.error || t("form.deleteImageFailed"))
            return
        }
        setImages(list => list.filter(u => u !== url))
        await onImagesChanged()
    }

    return createPortal(
        <div
            className="fixed inset-0 z-[10000] flex items-center justify-center p-3 sm:p-4"
            style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0 }}
            onClick={onClose}
        >
            <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />

            <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative w-full sm:max-w-2xl max-h-[92vh] bg-[#0a0a0a] border border-white/10 rounded-sm overflow-hidden flex flex-col shadow-2xl"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 shrink-0">
                    <h4 className="text-sm font-black uppercase tracking-widest text-white/70">
                        {editingId ? t("form.editTitle") : t("form.newTitle")}
                    </h4>
                    <button onClick={onClose} className="p-1.5 text-white/30 hover:text-white/70 transition-colors" title={t("common.close")}>
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className={LABEL}>{t("form.name")}</label>
                            <input value={form.name} className={INPUT} placeholder={t("form.namePlaceholder")}
                                onChange={(e) => {
                                    const name = e.target.value
                                    setForm(f => ({ ...f, name, slug: editingId ? f.slug : autoSlug(name) }))
                                }} />
                        </div>
                        <div className="space-y-1.5">
                            <label className={LABEL}>{t("common.slug")}</label>
                            <input value={form.slug} className={`${INPUT} font-mono`} placeholder={t("form.slugPlaceholder")}
                                onChange={(e) => setForm(f => ({ ...f, slug: e.target.value }))} />
                        </div>
                        <div className="space-y-1.5">
                            <label className={LABEL}>{t("common.type")}</label>
                            <input value={form.type} className={INPUT} placeholder={t("form.typePlaceholder")}
                                onChange={(e) => setForm(f => ({ ...f, type: e.target.value }))} />
                        </div>
                        <div className="space-y-1.5">
                            <label className={LABEL}>{t("common.price")}</label>
                            <input value={form.price} className={INPUT} placeholder={t("common.pricePlaceholder")}
                                onChange={(e) => setForm(f => ({ ...f, price: e.target.value }))} />
                        </div>
                        <div className="space-y-1.5">
                            <label className={LABEL}>{t("form.variants")}</label>
                            <input value={form.variants} type="number" min={0} className={INPUT} placeholder={t("form.variantsPlaceholder")}
                                onChange={(e) => setForm(f => ({ ...f, variants: e.target.value }))} />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <label className={LABEL}>{t("form.description")}</label>
                        <textarea value={form.description} rows={3} className={`${INPUT} resize-y`}
                            placeholder={t("common.descriptionPlaceholder")}
                            onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} />
                    </div>

                    {/* Fotky — jen u existujícího produktu: upload potřebuje id řádku. */}
                    <div className="space-y-2 border-t border-white/5 pt-4">
                        <label className={LABEL}>{t("form.photos")}</label>
                        {editingId ? (
                            <div className="flex flex-wrap gap-2">
                                {images.map(url => (
                                    <div key={url} className="relative w-20 h-20 rounded-sm overflow-hidden border border-white/10 bg-[#050505] group">
                                        <img src={url} alt="" className="w-full h-full object-cover" />
                                        <button
                                            onClick={() => handleRemoveImage(url)}
                                            disabled={busyImage === url}
                                            title={t("common.removePhoto")}
                                            className="absolute top-0.5 right-0.5 p-1 rounded-sm bg-black/70 text-white/60 hover:text-red-400 transition-colors disabled:opacity-40"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                ))}
                                <label className={`w-20 h-20 flex flex-col items-center justify-center gap-1 rounded-sm border border-dashed border-white/15 text-white/30 hover:text-white/60 hover:border-white/30 transition-all cursor-pointer ${uploading ? "animate-pulse" : ""}`}>
                                    <Plus className="w-4 h-4" />
                                    <span className="text-[8px] uppercase tracking-widest font-bold">{t("form.addPhoto")}</span>
                                    <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
                                </label>
                            </div>
                        ) : (
                            <p className="text-[10px] text-white/30">{t("form.photosAfterSave")}</p>
                        )}
                    </div>

                    {error && (
                        <p className="text-[10px] text-red-400/80 bg-red-500/5 border border-red-500/20 rounded-sm px-3 py-2">{error}</p>
                    )}
                </div>

                <div className="flex items-center justify-end gap-3 px-5 py-3.5 border-t border-white/10 bg-[#050505] shrink-0">
                    <button onClick={onClose}
                        className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white/70 transition-colors">
                        {t("form.cancel")}
                    </button>
                    <button onClick={handleSubmit} disabled={saving || !form.name || !form.slug}
                        className="px-6 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-sm bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 disabled:opacity-40 transition-all">
                        {saving ? t("common.saving") : editingId ? t("form.saveChanges") : t("form.create")}
                    </button>
                </div>
            </motion.div>
        </div>,
        document.body
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
