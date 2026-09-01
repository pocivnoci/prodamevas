"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { motion } from "framer-motion"
import {
    uploadBrandImage,
    deleteBrandImage,
    getBrandImageObjects,
    retagBrandImages,
    setBrandImageTags,
} from "@/app/actions/brand-images-action"
import { getClientConfig } from "@/app/actions/settings-actions"
import { ensureImageBrief } from "@/app/onboarding/actions"
import { BRAND_IMAGE_TAGS } from "@/instagram/configs/types"
import type { ImageBriefItem, BrandImage } from "@/instagram/configs/types"
import { LoadingSpinner } from "./shared"
import { Camera, Image, TriangleAlert } from "lucide-react"

export function BrandTab({ projectId }: { projectId: string }) {
    const [images, setImages] = useState<BrandImage[]>([])
    const [loading, setLoading] = useState(true)
    const [uploading, setUploading] = useState(false)
    const [retagging, setRetagging] = useState(false)
    const [dragOver, setDragOver] = useState(false)
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
    const [imageBrief, setImageBrief] = useState<ImageBriefItem[]>([])
    const [briefCollapsed, setBriefCollapsed] = useState(false)
    const [briefLoading, setBriefLoading] = useState(false)
    // Jeden pokus na jedno otevření sekce — bez téhle pojistky by StrictMode
    // (a každý re-run loadImages) pouštěl generování shot listu znovu.
    const briefRequested = useRef(false)
    // Ruční štítkování: AI nepozná, že zrovna tenhle portrét je tvář značky.
    const [editing, setEditing] = useState<BrandImage | null>(null)
    const [draftTags, setDraftTags] = useState<string[]>([])
    const [savingTags, setSavingTags] = useState(false)

    const loadImages = useCallback(async () => {
        if (!projectId) return
        setLoading(true)
        const [imgs, config] = await Promise.all([
            getBrandImageObjects(projectId),
            getClientConfig(projectId),
        ])
        setImages(imgs)
        if (config?.imageBrief?.length) {
            setImageBrief(config.imageBrief)
        } else if (config && !briefRequested.current) {
            // Shot list dosud nikdo nevygeneroval (klient ze self-serve onboardingu,
            // nebo se zavřela karta během adminského). Dogeneruj ho na pozadí a ulož —
            // jinak zůstane „Co ještě chybí" u takového klienta prázdné navždy.
            briefRequested.current = true
            setBriefLoading(true)
            ensureImageBrief(projectId)
                .then(res => { if (res.success && res.brief) setImageBrief(res.brief) })
                .finally(() => setBriefLoading(false))
        }
        setLoading(false)
    }, [projectId])

    const handleRegenerateBrief = async () => {
        setBriefLoading(true)
        setMessage(null)
        const res = await ensureImageBrief(projectId, { force: true })
        if (res.success && res.brief) {
            setImageBrief(res.brief)
            setMessage({ type: 'success', text: 'Shot list přegenerován podle aktuální značky' })
        } else {
            setMessage({ type: 'error', text: res.error || 'Generování shot listu selhalo' })
        }
        setBriefLoading(false)
    }

    useEffect(() => { loadImages() }, [loadImages])

    const handleUpload = async (files: FileList | null) => {
        if (!files || !projectId) return
        setUploading(true)
        setMessage(null)

        let successCount = 0
        for (const file of Array.from(files)) {
            const formData = new FormData()
            formData.append('file', file)
            formData.append('clientSlug', projectId)
            formData.append('category', 'brand')

            const result = await uploadBrandImage(formData)
            if (result.success) successCount++
            else setMessage({ type: 'error', text: result.error || 'Upload selhal' })
        }

        if (successCount > 0) {
            setMessage({ type: 'success', text: `${successCount} ${successCount === 1 ? 'fotka nahrána' : 'fotek nahráno'}` })
        }
        await loadImages()
        setUploading(false)
    }

    const handleDelete = async (imageUrl: string) => {
        const result = await deleteBrandImage(projectId, imageUrl)
        if (result.success) {
            setImages(prev => prev.filter(im => im.url !== imageUrl))
            setMessage({ type: 'success', text: 'Fotka smazána' })
        } else {
            setMessage({ type: 'error', text: result.error || 'Smazání selhalo' })
        }
    }

    const handleRetag = async () => {
        if (!projectId || images.length === 0) return
        setRetagging(true)
        setMessage(null)
        const result = await retagBrandImages(projectId)
        if (result.success) {
            setMessage({ type: 'success', text: `AI přeznačila ${result.count} ${result.count === 1 ? 'fotku' : 'fotek'}` })
            await loadImages()
        } else {
            setMessage({ type: 'error', text: result.error || 'Přeznačení selhalo' })
        }
        setRetagging(false)
    }

    const openTagEditor = (img: BrandImage) => {
        setEditing(img)
        setDraftTags(img.tags || [])
    }

    const toggleDraftTag = (tag: string) => {
        setDraftTags(prev => prev.includes(tag)
            ? prev.filter(t => t !== tag)
            : prev.length >= 4 ? prev : [...prev, tag])
    }

    const handleSaveTags = async () => {
        if (!editing) return
        setSavingTags(true)
        const result = await setBrandImageTags(projectId, editing.url, draftTags)
        if (result.success) {
            setImages(prev => prev.map(im =>
                im.url === editing.url ? { ...im, tags: draftTags, userTagged: true } : im))
            setMessage({ type: 'success', text: 'Štítky uloženy — AI je už nepřepíše' })
            setEditing(null)
        } else {
            setMessage({ type: 'error', text: result.error || 'Uložení selhalo' })
        }
        setSavingTags(false)
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        setDragOver(false)
        handleUpload(e.dataTransfer.files)
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="bg-[#0a0a0a]/90 backdrop-blur-xl border border-white/10 rounded-sm p-6 shadow-sm">
                <h2 className="text-lg font-black uppercase tracking-tight text-white">Brand & Reference Fotky</h2>
                <p className="text-white/50 text-xs mt-1 tracking-wide">
                    Nahraj fotky produktů, lidí, prostředí — AI je použije jako referenci při generování příspěvků.
                    Čím více kvalitních fotek, tím realističtější výstup.
                </p>
            </div>

            {/* Shot list — "Co ještě chybí" */}
            {imageBrief.length === 0 && briefLoading && (
                <div className="bg-[#0a0a0a]/90 border border-blue-500/20 rounded-sm p-4 flex items-center gap-3">
                    <div className="w-4 h-4 border-2 border-white/10 border-t-blue-400/70 rounded-full animate-spin shrink-0" />
                    <span className="text-xs text-white/50">Skládám shot list — co ještě dofotit, aby AI měla z čeho brát…</span>
                </div>
            )}
            {imageBrief.length > 0 && (
                <div className="bg-[#0a0a0a]/90 border border-blue-500/20 rounded-sm overflow-hidden">
                    <div className="w-full flex items-center justify-between p-4 gap-3">
                        <button
                            onClick={() => setBriefCollapsed(!briefCollapsed)}
                            className="flex items-center gap-2 cursor-pointer min-w-0"
                        >
                            <Camera className="w-5 h-5 shrink-0" />
                            <span className="text-sm font-bold text-white">Co ještě chybí</span>
                            <span className="text-[10px] text-blue-400/60 font-mono">
                                {imageBrief.reduce((sum, cat) => sum + cat.items.length, 0)} položek
                            </span>
                        </button>
                        <div className="flex items-center gap-3 shrink-0">
                            <button
                                onClick={handleRegenerateBrief}
                                disabled={briefLoading}
                                className="text-[9px] uppercase tracking-widest font-bold text-white/30 hover:text-white/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                            >
                                {briefLoading ? 'Generuji…' : 'Přegenerovat'}
                            </button>
                            <button
                                onClick={() => setBriefCollapsed(!briefCollapsed)}
                                className="text-white/30 text-xs cursor-pointer hover:text-white/60 transition-colors"
                            >
                                {briefCollapsed ? '▼' : '▲'}
                            </button>
                        </div>
                    </div>
                    {!briefCollapsed && (
                        <div className="px-4 pb-4 space-y-3">
                            {imageBrief.map((cat, i) => (
                                <div key={i}>
                                    <div className="flex items-center gap-2 mb-1.5">
                                        <span className="text-sm">{cat.emoji}</span>
                                        <span className="text-xs font-bold text-white/70">{cat.category}</span>
                                        <span className="text-[9px] text-white/30">({cat.count})</span>
                                        {cat.priority === 'must' && (
                                            <span className="text-[8px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400/80 border border-amber-500/15 font-bold uppercase tracking-wider">Důležité</span>
                                        )}
                                    </div>
                                    <div className="space-y-1 ml-5">
                                        {cat.items.map((item, j) => (
                                            <div key={j} className="flex items-start gap-2 text-[11px] text-white/40">
                                                <span className="text-white/15 mt-0.5">□</span>
                                                <span>{item}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Status Message */}
            {message && (
                <div className={`px-4 py-3 rounded-sm text-xs font-bold uppercase tracking-wider border ${message.type === 'success'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-red-500/10 text-red-400 border-red-500/20'
                    }`}>
                    {message.text}
                </div>
            )}

            {/* Upload Zone */}
            <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-sm p-8 text-center transition-all cursor-pointer ${dragOver
                    ? 'border-white/40 bg-white/5'
                    : 'border-white/10 hover:border-white/20 bg-[#0a0a0a]/50'
                    }`}
                onClick={() => {
                    const input = document.createElement('input')
                    input.type = 'file'
                    input.multiple = true
                    input.accept = 'image/*'
                    input.onchange = (e) => handleUpload((e.target as HTMLInputElement).files)
                    input.click()
                }}
            >
                {uploading ? (
                    <div className="flex flex-col items-center gap-3">
                        <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span className="text-white/50 text-xs font-bold uppercase tracking-wider">Nahrávám...</span>
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-3">
                        <Camera className="w-8 h-8" />
                        <span className="text-white/50 text-xs font-bold uppercase tracking-wider">
                            Přetáhni fotky sem nebo klikni pro výběr
                        </span>
                        <span className="text-white/30 text-[10px] tracking-wide">
                            JPG, PNG, WebP • max 10 MB • produkty, lidi, prostředí
                        </span>
                    </div>
                )}
            </div>

            {/* Image Grid */}
            {loading ? (
                <div className="flex items-center justify-center py-12">
                    <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                </div>
            ) : images.length === 0 ? (
                <div className="text-center py-12 text-white/30">
                    <Image className="w-8 h-8 block mb-4" />
                    <p className="text-xs font-bold uppercase tracking-wider">Zatím žádné fotky</p>
                    <p className="text-[10px] mt-1 tracking-wide">Nahraj fotky produktů a značky pro lepší AI generování</p>
                </div>
            ) : (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <p className="text-[10px] text-white/30 font-bold uppercase tracking-widest">{images.length} fotek · AI štítky</p>
                        <button
                            onClick={handleRetag}
                            disabled={retagging}
                            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 rounded-sm text-[9px] font-bold uppercase tracking-widest transition-colors disabled:opacity-50"
                            title="Nechej AI znovu projít a oštítkovat všechny fotky"
                        >
                            {retagging ? "Přeznačuji…" : "Přeznačit AI"}
                        </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                        {images.map((img, i) => (
                            <div key={img.url} className="group relative aspect-square bg-[#0f0f0f] border border-white/10 rounded-sm overflow-hidden shadow-sm">
                                <img
                                    src={img.url}
                                    alt={img.description || `Brand image ${i + 1}`}
                                    title={img.description || ""}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                />
                                {/* Počítač: celoplošný overlay na najetí myší. */}
                                <div className="hidden sm:flex absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity items-center justify-center">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleDelete(img.url) }}
                                        className="bg-red-500/80 hover:bg-red-500 text-white px-3 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-wider transition-colors shadow-sm cursor-pointer"
                                    >
                                        Smazat
                                    </button>
                                </div>

                                {/* Telefon: najetí myší neexistuje, takže mazání fotky nešlo
                                    vyvolat vůbec. Rohové tlačítko místo overlaye, ať zůstane
                                    vidět, co se maže. */}
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleDelete(img.url) }}
                                    aria-label="Smazat fotku"
                                    className="sm:hidden absolute top-1.5 right-1.5 w-9 h-9 rounded-sm bg-black/70 border border-white/15 text-red-400 flex items-center justify-center active:bg-black/90 transition-colors cursor-pointer"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                </button>
                                {/* Štítky jsou klikací: rozhodují, kdy se fotka k příspěvku
                                    vůbec přiloží, takže musí jít opravit. */}
                                <button
                                    onClick={(e) => { e.stopPropagation(); openTagEditor(img) }}
                                    title="Upravit štítky"
                                    className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-2 text-left cursor-pointer hover:from-black"
                                >
                                    {img.tags && img.tags.length > 0 ? (
                                        <div className="flex flex-wrap gap-1 items-center">
                                            {img.tags.slice(0, 4).map(t => (
                                                <span key={t} className={`text-[8px] px-1 py-0.5 rounded-sm font-bold uppercase tracking-wider ${t === 'person' ? 'bg-emerald-500/30 text-emerald-200' : 'bg-white/15 text-white/80'}`}>{t}</span>
                                            ))}
                                            {img.userTagged && (
                                                <span title="Štítky nastavil člověk — AI je nepřepíše" className="text-[8px] text-emerald-400/80 font-bold">✓</span>
                                            )}
                                        </div>
                                    ) : (
                                        <span className="inline-flex items-center gap-1.5 text-[8px] text-amber-400/90 font-bold uppercase tracking-wider"><TriangleAlert className="w-3 h-3 shrink-0" />bez štítku</span>
                                    )}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Editor štítků */}
            {editing && (
                <div className="bg-[#0a0a0a] border border-white/10 rounded-sm p-4 space-y-4">
                    <div className="flex items-start gap-3">
                        <img src={editing.url} alt="" className="w-20 h-20 object-cover rounded-sm border border-white/10 shrink-0" />
                        <div className="min-w-0">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">Štítky fotky</p>
                            <p className="text-xs text-white/70 mt-1">{editing.description || "Bez popisu"}</p>
                            <p className="text-[10px] text-white/30 mt-2 tracking-wide">
                                Podle štítků se rozhoduje, ke kterým příspěvkům se fotka přiloží. Vyber 1–4.
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                        {BRAND_IMAGE_TAGS.map(t => {
                            const on = draftTags.includes(t.id)
                            const full = !on && draftTags.length >= 4
                            return (
                                <button
                                    key={t.id}
                                    onClick={() => toggleDraftTag(t.id)}
                                    disabled={full}
                                    title={t.hint}
                                    className={`px-2 py-1 rounded-sm text-[9px] font-bold uppercase tracking-wider border transition-colors cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed ${
                                        on
                                            ? t.id === 'person'
                                                ? 'bg-emerald-500/25 border-emerald-400/40 text-emerald-200'
                                                : 'bg-white/20 border-white/30 text-white'
                                            : 'bg-white/5 border-white/10 text-white/50 hover:border-white/25'
                                    }`}
                                >
                                    {t.label}
                                </button>
                            )
                        })}
                    </div>

                    {draftTags.includes('person') && (
                        <p className="text-[10px] text-emerald-300/80 tracking-wide">
                            👤 Tuhle tvář bude engine držet napříč příspěvky — nenahradí ji fotobankovým modelem.
                        </p>
                    )}

                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleSaveTags}
                            disabled={savingTags || draftTags.length === 0}
                            className="px-4 py-2 bg-white text-black rounded-sm text-[10px] font-bold uppercase tracking-widest disabled:opacity-40 cursor-pointer"
                        >
                            {savingTags ? "Ukládám…" : "Uložit štítky"}
                        </button>
                        <button
                            onClick={() => setEditing(null)}
                            className="px-4 py-2 bg-white/5 border border-white/10 text-white/60 rounded-sm text-[10px] font-bold uppercase tracking-widest cursor-pointer"
                        >
                            Zrušit
                        </button>
                        <span className="text-[10px] text-white/25 tracking-wide">{draftTags.length}/4</span>
                    </div>
                </div>
            )}

            {/* Info */}
            <div className="bg-[#0a0a0a]/60 border border-white/5 rounded-sm p-4 text-[10px] text-white/30 tracking-wide space-y-1">
                <p>💡 <strong className="text-white/50">Tip:</strong> Nahraj fotky produktů — AI je zakomponuje do reálných scén místo generování od nuly.</p>
                <p>👤 <strong className="text-white/50">Tvář značky:</strong> Portrét konkrétního člověka označ štítkem <strong className="text-emerald-300/70">Konkrétní osoba</strong> — engine ho pak drží napříč příspěvky místo fotobankového modelu.</p>
                <p>🏷️ <strong className="text-white/50">Oprava štítků:</strong> Klikni na štítky pod fotkou. Ruční štítek už AI nikdy nepřepíše — ani při „Přeznačit AI“.</p>
                <p>🏙️ <strong className="text-white/50">Prostředí:</strong> Fotky prodejny/kanceláře pomohou zachovat autentičnost behind-the-scenes postů.</p>
            </div>
        </div>
    )
}
