"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { motion } from "framer-motion"
import { useTranslations } from "next-intl"
import {
    uploadBrandImage,
    deleteBrandImage,
    getBrandImageObjects,
    retagBrandImages,
    setBrandImageTags,
} from "@/app/actions/brand-images-action"
import { getClientConfig } from "@/app/actions/settings-actions"
import { ensureImageBrief } from "@/app/onboarding/actions"
import { BRAND_IMAGE_TAGS, BRAND_DESCRIPTION_MAX } from "@/instagram/configs/types"
import type { ImageBriefItem, BrandImage } from "@/instagram/configs/types"
import { LoadingSpinner } from "./shared"
import { Camera, Image, TriangleAlert } from "lucide-react"

export function BrandTab({ projectId }: { projectId: string }) {
    const t = useTranslations("brand")
    const [images, setImages] = useState<BrandImage[]>([])
    const [loading, setLoading] = useState(true)
    const [uploading, setUploading] = useState(false)
    // Postup po jednotlivých fotkách — jeden ukazatel bez čísel se po minutě
    // nedá odlišit od zaseknutého programu.
    const [progress, setProgress] = useState({ done: 0, total: 0 })
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
    // Popis jde k obrazovému modelu doslova jako popisek reference — proto se dá
    // přepsat, ne jen přečíst. AI ví, co na fotce vidí; člověk ví, co ta fotka je.
    const [draftDescription, setDraftDescription] = useState("")
    const [savingTags, setSavingTags] = useState(false)

    const loadImages = useCallback(async () => {
        if (!projectId) return
        setLoading(true)
        // try/finally, protože `setLoading(false)` na konci NENÍ zaručené: kdykoli
        // některá ze server actions odmítne (výpadek sítě, timeout, 500), funkce
        // se ukončí výjimkou a kolečko se točí navždycky. Viz `handleUpload`.
        try {
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
        } finally {
            setLoading(false)
        }
    }, [projectId])

    const handleRegenerateBrief = async () => {
        setBriefLoading(true)
        setMessage(null)
        const res = await ensureImageBrief(projectId, { force: true })
        if (res.success && res.brief) {
            setImageBrief(res.brief)
            setMessage({ type: 'success', text: t("messages.briefRegenerated") })
        } else {
            setMessage({ type: 'error', text: res.error || t("messages.briefFailed") })
        }
        setBriefLoading(false)
    }

    useEffect(() => { loadImages() }, [loadImages])

    /**
     * Zmenši fotku JEŠTĚ V PROHLÍŽEČI, než se vůbec odešle.
     *
     * Tři důvody, každý z reálné stížnosti:
     *   1. Server action má strop 10 MB (`bodySizeLimit`). Fotka z telefonu ho
     *      trhá a uživatel dostal nesrozumitelnou chybu.
     *   2. Osmimegová fotka se po drátě táhne desítky sekund. Server ji stejně
     *      hned zmenší na 2048 px, takže se ta data přenášejí zbytečně.
     *   3. Tam, kde prohlížeč HEIC dekódovat umí (Safari na iPhonu má systémový
     *      kodek, sharp na serveru ne), projde převodem na JPEG i fotka, která
     *      dřív skončila hláškou „pošli to jako JPG“. Není to zaručené — na
     *      Chromu HEIC nedekóduje nic a padá se do serverové hlášky jako dřív,
     *      proto to UI neslibuje.
     *
     * Když cokoliv z toho selže, pošle se původní soubor — zmenšení je zrychlení,
     * ne podmínka.
     */
    const shrinkForUpload = async (file: File): Promise<File> => {
        try {
            if (!file.type.startsWith('image/')) return file
            const bitmap = await createImageBitmap(file)
            const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height))
            const w = Math.round(bitmap.width * scale)
            const h = Math.round(bitmap.height * scale)
            const canvas = document.createElement('canvas')
            canvas.width = w
            canvas.height = h
            const ctx = canvas.getContext('2d')
            if (!ctx) return file
            ctx.drawImage(bitmap, 0, 0, w, h)
            bitmap.close?.()
            const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.85))
            if (!blob || blob.size === 0) return file
            // Zvětšit se nesmí: u malého PNG loga umí JPEG vyjít větší než originál.
            if (blob.size >= file.size && file.size < 2_000_000) return file
            return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
        } catch {
            return file
        }
    }

    const handleUpload = async (files: FileList | null) => {
        if (!files || !projectId) return
        const list = Array.from(files)
        setUploading(true)
        setMessage(null)
        setProgress({ done: 0, total: list.length })

        // Tři „souběžné“ smyčky — ale nedělej si iluze, že se tím zrychlí přenos.
        //
        // Next.js server actions z JEDNOHO klienta se řadí do fronty a běží po
        // jedné; naměřeno na produkci 10. 9. 2026, kdy osm fotek dorazilo do
        // storage přesně po ~6 sekundách za sebou. Souběh je tady proto, aby se
        // v prohlížeči překrývalo zmenšování obrázků s čekáním na server, ne kvůli
        // paralelnímu uploadu. Skutečné zdržení je volání vision modelu uvnitř
        // akce a to tímhle neobejdeš.
        //
        // Opakované nahrání téže fotky je no-op (otisk obsahu v názvu +
        // idempotentní `append_brand_image`), takže netrpělivé klikání duplicitu
        // vyrobit nemůže.
        const CONCURRENCY = 3
        let cursor = 0
        let successCount = 0
        let lastError: string | null = null

        const worker = async () => {
            while (cursor < list.length) {
                const file = list[cursor++]
                const formData = new FormData()
                formData.append('file', await shrinkForUpload(file))
                formData.append('clientSlug', projectId)
                formData.append('category', 'brand')
                try {
                    const result = await uploadBrandImage(formData)
                    if (result.success) {
                        successCount++
                        // Ukaž ji v mřížce HNED, ne až na konci dávky. Server actions
                        // jedou po jedné, takže u osmi fotek je to rozdíl mezi „vidím,
                        // jak přibývají“ a „minutu kouká na kolečko“. Štítky a popis
                        // doplní `loadImages()` na konci.
                        if (result.imageUrl) {
                            const url = result.imageUrl
                            setImages(prev => prev.some(i => i.url === url)
                                ? prev
                                : [...prev, { url, tags: [], description: '' }])
                        }
                    } else {
                        lastError = result.error || t("messages.uploadFailed")
                    }
                } catch {
                    lastError = t("messages.uploadFailedRetry")
                }
                setProgress(p => ({ done: p.done + 1, total: p.total }))
            }
        }

        // try/finally kolem VŠEHO, co následuje.
        //
        // Do 10. 9. 2026 tu try/finally nebylo a `setUploading(false)` stálo až za
        // `await loadImages()`. Když kterákoli server action odmítla, celá funkce
        // skončila výjimkou a kolečko se točilo donekonečna — přestože fotky byly
        // dávno nahrané a v galerii. Přesně to se stalo při nahrání osmi fotek:
        // ve storage i v konfiguraci bylo všech osm, jen se to uživatel z obrazovky
        // nedozvěděl. Ukazatel průběhu nesmí být závislý na tom, že poslední krok
        // dopadne dobře.
        try {
            await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker))

            // Kolik prošlo A kolik ne — dřív se ukázala jen poslední chyba, takže
            // „3 z 5 se nenahrály“ vypadalo stejně jako „všechno je v pořádku“.
            if (successCount === list.length) {
                setMessage({ type: 'success', text: t("messages.uploaded", { count: successCount }) })
            } else if (successCount > 0) {
                setMessage({ type: 'error', text: `${t("messages.uploadedPartial", { done: successCount, total: list.length })} ${lastError || ''}`.trim() })
            } else {
                setMessage({ type: 'error', text: lastError || t("messages.uploadFailed") })
            }

            // Dotažení štítků a popisů. Selhat smí — fotky už nahrané jsou a v mřížce
            // je vidět, takže je to zpřesnění, ne podmínka úspěchu.
            try {
                await loadImages()
            } catch {
                setMessage({ type: 'error', text: t("messages.uploadedListFailed", { done: successCount, total: list.length }) })
            }
        } finally {
            setProgress({ done: 0, total: 0 })
            setUploading(false)
        }
    }

    const handleDelete = async (imageUrl: string) => {
        const result = await deleteBrandImage(projectId, imageUrl)
        if (result.success) {
            setImages(prev => prev.filter(im => im.url !== imageUrl))
            setMessage({ type: 'success', text: t("messages.deleted") })
        } else {
            setMessage({ type: 'error', text: result.error || t("messages.deleteFailed") })
        }
    }

    const handleRetag = async () => {
        if (!projectId || images.length === 0) return
        setRetagging(true)
        setMessage(null)
        const result = await retagBrandImages(projectId)
        if (result.success) {
            setMessage({ type: 'success', text: t("messages.retagged", { count: result.count }) })
            await loadImages()
        } else {
            setMessage({ type: 'error', text: result.error || t("messages.retagFailed") })
        }
        setRetagging(false)
    }

    const openTagEditor = (img: BrandImage) => {
        setEditing(img)
        setDraftTags(img.tags || [])
        setDraftDescription(img.description || "")
    }

    const toggleDraftTag = (tag: string) => {
        setDraftTags(prev => prev.includes(tag)
            ? prev.filter(t => t !== tag)
            : prev.length >= 4 ? prev : [...prev, tag])
    }

    const handleSaveTags = async () => {
        if (!editing) return
        setSavingTags(true)
        const description = draftDescription.trim().replace(/\s+/g, " ").slice(0, BRAND_DESCRIPTION_MAX)
        const result = await setBrandImageTags(projectId, editing.url, draftTags, description)
        if (result.success) {
            setImages(prev => prev.map(im =>
                im.url === editing.url ? { ...im, tags: draftTags, description, userTagged: true } : im))
            setMessage({ type: 'success', text: t("messages.tagsSaved") })
            setEditing(null)
        } else {
            setMessage({ type: 'error', text: result.error || t("messages.saveFailed") })
        }
        setSavingTags(false)
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        setDragOver(false)
        handleUpload(e.dataTransfer.files)
    }

    /** Zvýraznění v infoboxu (`<strong>` v messages). */
    const strong = (chunks: React.ReactNode) => <strong className="text-white/50">{chunks}</strong>

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="bg-[#0a0a0a]/90 backdrop-blur-xl border border-white/10 rounded-sm p-6 shadow-sm">
                <h2 className="text-lg font-black uppercase tracking-tight text-white">{t("header.title")}</h2>
                <p className="text-white/50 text-xs mt-1 tracking-wide">
                    {t("header.body")}
                </p>
            </div>

            {/* Shot list — "Co ještě chybí" */}
            {imageBrief.length === 0 && briefLoading && (
                <div className="bg-[#0a0a0a]/90 border border-blue-500/20 rounded-sm p-4 flex items-center gap-3">
                    <div className="w-4 h-4 border-2 border-white/10 border-t-blue-400/70 rounded-full animate-spin shrink-0" />
                    <span className="text-xs text-white/50">{t("brief.loading")}</span>
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
                            <span className="text-sm font-bold text-white">{t("brief.title")}</span>
                            <span className="text-[10px] text-blue-400/60 font-mono">
                                {t("brief.itemCount", { count: imageBrief.reduce((sum, cat) => sum + cat.items.length, 0) })}
                            </span>
                        </button>
                        <div className="flex items-center gap-3 shrink-0">
                            <button
                                onClick={handleRegenerateBrief}
                                disabled={briefLoading}
                                className="text-[9px] uppercase tracking-widest font-bold text-white/30 hover:text-white/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                            >
                                {briefLoading ? t("brief.regenerating") : t("brief.regenerate")}
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
                                            <span className="text-[8px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400/80 border border-amber-500/15 font-bold uppercase tracking-wider">{t("brief.must")}</span>
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
                        <span className="text-white/50 text-xs font-bold uppercase tracking-wider">
                            {progress.total > 1
                                ? t("upload.progress", { current: Math.min(progress.done + 1, progress.total), total: progress.total })
                                : t("upload.uploading")}
                        </span>
                        {/* Proužek postupu, ne jen kolečko: u pěti fotek to trvá desítky
                            sekund a bez čísla to vypadá zaseknutě — přesně proto zákaznice
                            nahrávala tutéž fotku dvakrát. */}
                        {progress.total > 1 && (
                            <div className="w-40 h-1 bg-white/10 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                                    style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                                />
                            </div>
                        )}
                        <span className="text-white/25 text-[10px] tracking-wide">
                            {t("upload.aiNote")}
                        </span>
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-3">
                        <Camera className="w-8 h-8" />
                        <span className="text-white/50 text-xs font-bold uppercase tracking-wider">
                            {t("upload.dropHint")}
                        </span>
                        <span className="text-white/30 text-[10px] tracking-wide">
                            {t("upload.formats")}
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
                    <p className="text-xs font-bold uppercase tracking-wider">{t("grid.emptyTitle")}</p>
                    <p className="text-[10px] mt-1 tracking-wide">{t("grid.emptyBody")}</p>
                </div>
            ) : (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <p className="text-[10px] text-white/30 font-bold uppercase tracking-widest">{t("grid.count", { count: images.length })}</p>
                        <button
                            onClick={handleRetag}
                            disabled={retagging}
                            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 rounded-sm text-[9px] font-bold uppercase tracking-widest transition-colors disabled:opacity-50"
                            title={t("grid.retagTitle")}
                        >
                            {retagging ? t("grid.retagging") : t("grid.retag")}
                        </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                        {images.map((img, i) => (
                            <div key={img.url} className="group relative aspect-square bg-[#0f0f0f] border border-white/10 rounded-sm overflow-hidden shadow-sm">
                                <img
                                    src={img.url}
                                    alt={img.description || t("grid.altFallback", { n: i + 1 })}
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
                                        {t("grid.delete")}
                                    </button>
                                </div>

                                {/* Telefon: najetí myší neexistuje, takže mazání fotky nešlo
                                    vyvolat vůbec. Rohové tlačítko místo overlaye, ať zůstane
                                    vidět, co se maže. */}
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleDelete(img.url) }}
                                    aria-label={t("grid.deleteAria")}
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
                                    title={t("grid.editTags")}
                                    className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-2 text-left cursor-pointer hover:from-black"
                                >
                                    {img.tags && img.tags.length > 0 ? (
                                        <div className="flex flex-wrap gap-1 items-center">
                                            {img.tags.slice(0, 4).map(t => (
                                                <span key={t} className={`text-[8px] px-1 py-0.5 rounded-sm font-bold uppercase tracking-wider ${t === 'person' ? 'bg-emerald-500/30 text-emerald-200' : 'bg-white/15 text-white/80'}`}>{t}</span>
                                            ))}
                                            {img.userTagged && (
                                                <span title={t("grid.userTagged")} className="text-[8px] text-emerald-400/80 font-bold">✓</span>
                                            )}
                                        </div>
                                    ) : (
                                        <span className="inline-flex items-center gap-1.5 text-[8px] text-amber-400/90 font-bold uppercase tracking-wider"><TriangleAlert className="w-3 h-3 shrink-0" />{t("grid.untagged")}</span>
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
                            <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">{t("editor.title")}</p>
                            <p className="text-[10px] text-white/30 mt-2 tracking-wide">
                                {t("editor.intro")}
                            </p>
                        </div>
                    </div>

                    {/* Popis jde k obrazovému modelu doslova. AI napíše, co vidí;
                        člověk dopíše, co ta fotka JE — a to model jinak nemá odkud vzít. */}
                    <div>
                        <label className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                            {t("editor.descriptionLabel")}
                        </label>
                        <textarea
                            value={draftDescription}
                            onChange={e => setDraftDescription(e.target.value.slice(0, BRAND_DESCRIPTION_MAX))}
                            rows={2}
                            placeholder={t("editor.descriptionPlaceholder")}
                            className="mt-1.5 w-full bg-[#0f0f0f] border border-white/10 rounded-sm px-3 py-2 text-xs text-white/85 placeholder:text-white/20 focus:border-white/30 focus:outline-none resize-none"
                        />
                        <div className="flex items-start justify-between gap-3 mt-1">
                            <p className="text-[10px] text-white/30 tracking-wide">
                                {t("editor.descriptionHelp")}
                            </p>
                            <span className={`text-[10px] font-bold shrink-0 ${draftDescription.length >= BRAND_DESCRIPTION_MAX ? 'text-amber-400/80' : 'text-white/25'}`}>
                                {draftDescription.length}/{BRAND_DESCRIPTION_MAX}
                            </span>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                        {BRAND_IMAGE_TAGS.map(tag => {
                            const on = draftTags.includes(tag.id)
                            const full = !on && draftTags.length >= 4
                            return (
                                <button
                                    key={tag.id}
                                    onClick={() => toggleDraftTag(tag.id)}
                                    disabled={full}
                                    title={t(`tags.${tag.id}.hint`)}
                                    className={`px-2 py-1 rounded-sm text-[9px] font-bold uppercase tracking-wider border transition-colors cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed ${
                                        on
                                            ? tag.id === 'person'
                                                ? 'bg-emerald-500/25 border-emerald-400/40 text-emerald-200'
                                                : 'bg-white/20 border-white/30 text-white'
                                            : 'bg-white/5 border-white/10 text-white/50 hover:border-white/25'
                                    }`}
                                >
                                    {t(`tags.${tag.id}.label`)}
                                </button>
                            )
                        })}
                    </div>

                    {draftTags.includes('person') && (
                        <p className="text-[10px] text-emerald-300/80 tracking-wide">
                            {t("editor.personNote")}
                        </p>
                    )}

                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleSaveTags}
                            disabled={savingTags || draftTags.length === 0}
                            className="px-4 py-2 bg-white text-black rounded-sm text-[10px] font-bold uppercase tracking-widest disabled:opacity-40 cursor-pointer"
                        >
                            {savingTags ? t("editor.saving") : t("editor.save")}
                        </button>
                        <button
                            onClick={() => setEditing(null)}
                            className="px-4 py-2 bg-white/5 border border-white/10 text-white/60 rounded-sm text-[10px] font-bold uppercase tracking-widest cursor-pointer"
                        >
                            {t("editor.cancel")}
                        </button>
                        <span className="text-[10px] text-white/25 tracking-wide">{draftTags.length}/4</span>
                    </div>
                </div>
            )}

            {/* Info */}
            <div className="bg-[#0a0a0a]/60 border border-white/5 rounded-sm p-4 text-[10px] text-white/30 tracking-wide space-y-1">
                <p>{t.rich("info.tip", { strong })}</p>
                <p>{t.rich("info.face", { strong, tag: (chunks) => <strong className="text-emerald-300/70">{chunks}</strong> })}</p>
                <p>{t.rich("info.tags", { strong })}</p>
                <p>{t.rich("info.environment", { strong })}</p>
            </div>
        </div>
    )
}
