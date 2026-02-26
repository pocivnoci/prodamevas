"use client"

import { useEffect, useState, useCallback } from "react"
import { motion } from "framer-motion"
import {
    uploadBrandImage,
    deleteBrandImage,
    getBrandImages,
} from "@/app/actions/brand-images-action"
import { LoadingSpinner } from "./shared"

export function BrandTab({ projectId }: { projectId: string }) {
    const [images, setImages] = useState<string[]>([])
    const [loading, setLoading] = useState(true)
    const [uploading, setUploading] = useState(false)
    const [dragOver, setDragOver] = useState(false)
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

    const loadImages = useCallback(async () => {
        if (!projectId) return
        setLoading(true)
        const urls = await getBrandImages(projectId)
        setImages(urls)
        setLoading(false)
    }, [projectId])

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
            setImages(prev => prev.filter(url => url !== imageUrl))
            setMessage({ type: 'success', text: 'Fotka smazána' })
        } else {
            setMessage({ type: 'error', text: result.error || 'Smazání selhalo' })
        }
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
                        <span className="text-4xl">📸</span>
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
                    <span className="text-5xl block mb-4">🖼️</span>
                    <p className="text-xs font-bold uppercase tracking-wider">Zatím žádné fotky</p>
                    <p className="text-[10px] mt-1 tracking-wide">Nahraj fotky produktů a značky pro lepší AI generování</p>
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {images.map((url, i) => (
                        <div key={url} className="group relative aspect-square bg-[#0f0f0f] border border-white/10 rounded-sm overflow-hidden shadow-sm">
                            <img
                                src={url}
                                alt={`Brand image ${i + 1}`}
                                className="w-full h-full object-cover"
                                loading="lazy"
                            />
                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleDelete(url) }}
                                    className="bg-red-500/80 hover:bg-red-500 text-white px-3 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-wider transition-colors shadow-sm"
                                >
                                    Smazat
                                </button>
                            </div>
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                                <span className="text-[9px] text-white/60 font-mono">{i + 1}/{images.length}</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Info */}
            <div className="bg-[#0a0a0a]/60 border border-white/5 rounded-sm p-4 text-[10px] text-white/30 tracking-wide space-y-1">
                <p>💡 <strong className="text-white/50">Tip:</strong> Nahraj fotky produktů — AI je zakomponuje do reálných scén místo generování od nuly.</p>
                <p>👤 <strong className="text-white/50">Lidi:</strong> Fotky lidí se použijí pro konzistentní postavu napříč příspěvky (max 5 referenčních fotek).</p>
                <p>🏙️ <strong className="text-white/50">Prostředí:</strong> Fotky prodejny/kanceláře pomohou zachovat autentičnost behind-the-scenes postů.</p>
            </div>
        </div>
    )
}
