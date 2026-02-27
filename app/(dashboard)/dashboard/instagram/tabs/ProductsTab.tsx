"use client"

import { useEffect, useState, useCallback } from "react"
import { motion } from "framer-motion"
import {
    triggerProductIdeas,
    triggerDesignGeneration,
    triggerMockupGeneration,
    triggerProductDesign,
    triggerCustomProductDesign,
    saveProductIdea,
    rejectProductIdea,
    uploadProductReference,
    getSavedProductIdeas,
    type ProductIdea,
    type DesignConcept,
} from "@/app/actions/product-actions"
import { createPromoPost } from "@/app/actions/ig-generate-action"
import { LoadingSpinner } from "./shared"


type ProductSection = "ideas" | "design" | "mockup"

export function ProductsTab({ projectId }: { projectId: string }) {
    const [section, setSection] = useState<ProductSection>("ideas")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Ideas state
    const [ideasTheme, setIdeasTheme] = useState("")
    const [ideasCount, setIdeasCount] = useState(5)
    // currently generated ideas
    const [ideas, setIdeas] = useState<ProductIdea[]>([])
    // ideas already saved in database
    const [savedIdeas, setSavedIdeas] = useState<ProductIdea[]>([])
    const [ideaVisuals, setIdeaVisuals] = useState<Record<string, string>>({})
    const [visualizingId, setVisualizingId] = useState<string | null>(null)
    const [referenceUrls, setReferenceUrls] = useState<Record<string, string>>({})
    // Custom product (user-typed)
    const [customProductInput, setCustomProductInput] = useState("")
    const [customProductUrl, setCustomProductUrl] = useState<string | null>(null)
    const [customProductLoading, setCustomProductLoading] = useState(false)
    const [uploadingId, setUploadingId] = useState<string | null>(null)
    const [savingId, setSavingId] = useState<number | null>(null)
    const [rejectingId, setRejectingId] = useState<number | null>(null)
    const [successMsg, setSuccessMsg] = useState<string | null>(null)

    // Design state
    const [designTheme, setDesignTheme] = useState("")
    const [designProductType, setDesignProductType] = useState("triko")
    const [designResult, setDesignResult] = useState<{ concept: DesignConcept; designUrl: string } | null>(null)
    const [designIncludeLogo, setDesignIncludeLogo] = useState(false)
    const [designOverlayText, setDesignOverlayText] = useState("")
    const [designConceptOnly, setDesignConceptOnly] = useState<DesignConcept | null>(null)

    // Mockup state
    const [mockupDesignUrl, setMockupDesignUrl] = useState("")
    const [mockupProductType, setMockupProductType] = useState("triko")
    const [mockupDescription, setMockupDescription] = useState("")
    const [mockupUrl, setMockupUrl] = useState<string | null>(null)

    const productTypes = [
        { value: "triko", label: "👕 Triko" },
        { value: "mikina", label: "🧥 Mikina" },
        { value: "čepice", label: "🧢 Čepice" },
        { value: "gadget", label: "🔧 Gadget" },
        { value: "accessory", label: "🔑 Doplněk" },
        { value: "card", label: "💳 Karta/Card" },
    ]

    const sections: { id: ProductSection; label: string; icon: string }[] = [
        { id: "ideas", label: "Nápady", icon: "💡" },
        { id: "design", label: "Design", icon: "🎨" },
        { id: "mockup", label: "Mockup", icon: "👕" },
    ]

    // ── Ideas Handler ─────────────────────────────────────
    const fetchSavedIdeas = useCallback(async () => {
        const ideas = await getSavedProductIdeas(projectId)
        setSavedIdeas(ideas)

        // Pre-populate ideaVisuals from DB-persisted URLs
        const visuals: Record<string, string> = {}
        for (const idea of ideas) {
            if ((idea as any).design_url) visuals[idea.id as string] = (idea as any).design_url
        }
        if (Object.keys(visuals).length > 0) {
            setIdeaVisuals(prev => ({ ...prev, ...visuals }))
        }
    }, [projectId])

    useEffect(() => {
        if (section === "ideas") {
            fetchSavedIdeas()
        }
    }, [projectId, section, fetchSavedIdeas])

    const handleSaveIdea = async (idea: ProductIdea, index: number) => {
        setSavingId(index)
        setError(null)
        setSuccessMsg(null)
        try {
            const result = await saveProductIdea(projectId, idea)
            if (result.success) {
                setIdeas(prev => prev.filter((_, i) => i !== index))
                fetchSavedIdeas()
                setSuccessMsg(`"${idea.name}" uložen ✅`)
                setTimeout(() => setSuccessMsg(null), 3000)
            } else {
                setError(`Uložení selhalo: ${result.error || 'Neznámá chyba'} (client: ${projectId})`)
            }
        } catch (err: any) {
            setError(`Save error: ${err.message} (client: ${projectId})`)
        } finally {
            setSavingId(null)
        }
    }

    const handleRejectIdea = async (idea: ProductIdea, index: number) => {
        setRejectingId(index)
        setError(null)
        try {
            const result = await rejectProductIdea(projectId, idea)
            if (result.success) {
                setIdeas(prev => prev.filter((_, i) => i !== index))
            } else {
                setError(`Zamítnutí selhalo: ${result.error || 'Neznámá chyba'}`)
            }
        } catch (err: any) {
            setError(`Reject error: ${err.message}`)
        } finally {
            setRejectingId(null)
        }
    }

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, ideaId: string) => {
        if (!e.target.files || e.target.files.length === 0) return

        const file = e.target.files[0]
        setUploadingId(ideaId)
        setError(null)

        try {
            const formData = new FormData()
            formData.append("file", file)

            const result = await uploadProductReference(projectId, ideaId, formData)
            if (!result.success) throw new Error(result.error || "Upload failed")

            setReferenceUrls(prev => ({ ...prev, [ideaId]: result.publicUrl! }))
        } catch (err: any) {
            setError(`Chyba uploadu: ${err.message}`)
        } finally {
            setUploadingId(null)
        }
    }

    const handleGenerateIdeas = async () => {
        setLoading(true)
        setError(null)
        try {
            const result = await triggerProductIdeas({
                configName: projectId,
                count: ideasCount,
                theme: ideasTheme || undefined,
            })
            if (result.success && result.ideas) {
                setIdeas(result.ideas)
            } else {
                setError(result.error || "Generování selhalo")
            }
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    // ── Design Handler (two-step: concept → image) ────────────
    const handleGenerateDesignConcept = async () => {
        if (!designTheme.trim()) {
            setError("Zadej téma designu")
            return
        }
        setLoading(true)
        setError(null)
        setDesignConceptOnly(null)
        setDesignResult(null)
        setDesignOverlayText("")
        try {
            const result = await triggerDesignGeneration({
                configName: projectId,
                theme: designTheme,
                productType: designProductType,
                includeLogo: designIncludeLogo,
                overlayText: "", // Step 1: no text yet, just get concept + suggestions
            })
            if (result.success && result.concept) {
                setDesignConceptOnly(result.concept)
                // Also set the designUrl if available (concept was generated with image)
                if (result.designUrl) {
                    setDesignResult({ concept: result.concept, designUrl: result.designUrl })
                    setMockupDesignUrl(result.designUrl)
                    setMockupDescription(result.concept.description)
                    setMockupProductType(designProductType)
                }
            } else {
                setError(result.error || "Generování selhalo")
            }
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const handleRegenerateWithText = async () => {
        if (!designConceptOnly) return
        setLoading(true)
        setError(null)
        try {
            const result = await triggerDesignGeneration({
                configName: projectId,
                theme: designTheme,
                productType: designProductType,
                includeLogo: designIncludeLogo,
                overlayText: designOverlayText || undefined,
            })
            if (result.success && result.concept && result.designUrl) {
                setDesignResult({ concept: result.concept, designUrl: result.designUrl })
                setMockupDesignUrl(result.designUrl)
                setMockupDescription(result.concept.description)
                setMockupProductType(designProductType)
            } else {
                setError(result.error || "Generování selhalo")
            }
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    // ── Mockup Handler ────────────────────────────────────
    const handleGenerateMockup = async () => {
        setLoading(true)
        setError(null)
        try {
            const result = await triggerMockupGeneration({
                configName: projectId,
                designUrl: mockupDesignUrl,
                productType: mockupProductType,
                designDescription: mockupDescription || undefined,
            })
            if (result.success && result.mockupUrl) {
                setMockupUrl(result.mockupUrl)
            } else {
                setError(result.error || "Generování selhalo")
            }
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="space-y-6">
            {/* Section tabs */}
            <div className="flex gap-2">
                {sections.map(s => (
                    <button
                        key={s.id}
                        onClick={() => { setSection(s.id); setError(null) }}
                        className={`flex items-center gap-2 px-4 py-2 rounded-sm text-[10px] uppercase tracking-widest font-bold transition-all border ${section === s.id
                            ? "bg-aisummit-cinnabar/10 text-aisummit-cinnabar border-aisummit-cinnabar/30"
                            : "bg-[#0a0a0a] text-white/40 border-white/5 hover:bg-white/5 hover:text-white"
                            }`}
                    >
                        <span>{s.icon}</span>
                        <span>{s.label}</span>
                    </button>
                ))}
            </div>

            {/* Error display */}
            {error && (
                <div className="bg-aisummit-cinnabar/10 border border-aisummit-cinnabar/30 rounded-sm p-4 text-aisummit-cinnabar text-[10px] uppercase font-bold tracking-widest">
                    ❌ {error}
                </div>
            )}
            {successMsg && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-sm p-4 text-emerald-400 text-[10px] uppercase font-bold tracking-widest">
                    {successMsg}
                </div>
            )}

            {/* Loading overlay */}
            {loading && (
                <div className="bg-[#0f0f0f] border border-white/10 rounded-sm p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
                    <div className="inline-block w-12 h-12 border-[3px] border-white/10 border-t-aisummit-cinnabar rounded-full animate-spin shadow-sm mb-6" />
                    <p className="text-[10px] uppercase font-bold tracking-widest text-white/50">Generuji... může to chvíli trvat</p>
                </div>
            )}

            {/* ═══ IDEAS SECTION ═══ */}
            {section === "ideas" && !loading && (
                <div className="space-y-6">
                    <div className="bg-[#0f0f0f] border border-white/10 rounded-sm p-8 shadow-lg">
                        <h3 className="text-2xl font-black uppercase tracking-tighter text-white mb-2">💡 Product Ideas Brainstorm</h3>
                        <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest mb-6">AI vygeneruje kreativní nápady na nové produkty — nejen oblečení, ale i gadgety, doplňky a originální merch.</p>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                            <div>
                                <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5 block">Téma (volitelné)</label>
                                <input
                                    value={ideasTheme}
                                    onChange={(e) => setIdeasTheme(e.target.value)}
                                    placeholder="letní kolekce, valentýn..."
                                    className="w-full px-4 py-3 bg-[#050505] border border-white/10 rounded-sm text-white text-[10px] font-medium placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all"
                                />
                            </div>
                            <div>
                                <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5 block">Počet nápadů</label>
                                <select
                                    value={ideasCount}
                                    onChange={(e) => setIdeasCount(parseInt(e.target.value))}
                                    className="w-full px-4 py-3 bg-[#050505] border border-white/10 rounded-sm text-white text-[10px] font-bold uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all"
                                >
                                    {[3, 5, 7, 10].map(n => <option key={n} value={n}>{n}</option>)}
                                </select>
                            </div>
                            <div className="flex items-end">
                                <button
                                    onClick={handleGenerateIdeas}
                                    disabled={loading}
                                    className="w-full px-4 py-3 bg-white/10 hover:bg-white/20 text-white rounded-sm text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 border border-white/20 shadow-sm"
                                >
                                    🚀 Generovat nápady
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* ═══════════════ VLASTNÍ PRODUKT ═══════════════ */}
                    <div className="bg-[#0a0a0a] border border-emerald-500/20 rounded-sm p-6 mb-6">
                        <h3 className="text-[10px] uppercase tracking-[0.3em] font-black text-emerald-400 mb-4">✏️ Vlastní produkt — napiš co chceš vizualizovat</h3>
                        <div className="flex gap-3">
                            <input
                                value={customProductInput}
                                onChange={(e) => setCustomProductInput(e.target.value)}
                                placeholder="např. černý keramický hrnek, zippo zapalovač, snapback čepice..."
                                className="flex-1 px-4 py-3 bg-[#050505] border border-white/10 rounded-sm text-white text-sm font-medium placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition-all"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && customProductInput.trim() && !customProductLoading) {
                                        (async () => {
                                            setCustomProductLoading(true)
                                            setCustomProductUrl(null)
                                            setError(null)
                                            try {
                                                const result = await triggerCustomProductDesign({
                                                    configName: projectId,
                                                    productDescription: customProductInput.trim(),
                                                })
                                                if (result.success && result.designUrl) {
                                                    setCustomProductUrl(result.designUrl)
                                                } else {
                                                    setError(result.error || 'Vizualizace selhala')
                                                }
                                            } catch (err: any) { setError(err.message) }
                                            finally { setCustomProductLoading(false) }
                                        })()
                                    }
                                }}
                            />
                            <button
                                onClick={async () => {
                                    if (!customProductInput.trim()) return
                                    setCustomProductLoading(true)
                                    setCustomProductUrl(null)
                                    setError(null)
                                    try {
                                        const result = await triggerCustomProductDesign({
                                            configName: projectId,
                                            productDescription: customProductInput.trim(),
                                        })
                                        if (result.success && result.designUrl) {
                                            setCustomProductUrl(result.designUrl)
                                        } else {
                                            setError(result.error || 'Vizualizace selhala')
                                        }
                                    } catch (err: any) { setError(err.message) }
                                    finally { setCustomProductLoading(false) }
                                }}
                                disabled={customProductLoading || !customProductInput.trim()}
                                className="px-6 py-3 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 rounded-sm text-[10px] font-black uppercase tracking-widest text-emerald-400 transition-all disabled:opacity-50 whitespace-nowrap"
                            >
                                {customProductLoading ? '⏳ Generuji...' : '🎨 Vytvořit vizualizaci'}
                            </button>
                        </div>
                        {customProductUrl && (
                            <div className="mt-4">
                                <img src={customProductUrl} alt="Custom product" className="max-w-md rounded-sm border border-white/10" />
                                <a href={customProductUrl} target="_blank" rel="noopener noreferrer" className="inline-block mt-2 text-[9px] text-emerald-400/60 hover:text-emerald-400 uppercase tracking-widest">📸 Plná velikost</a>
                            </div>
                        )}
                    </div>

                    {/* Ideas grid */}
                    {ideas.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {ideas.map((idea, i) => (
                                <div key={i} className="bg-[#0a0a0a] border border-white/10 hover:border-white/20 hover:bg-white/5 rounded-sm p-6 shadow-sm transition-all group">
                                    <div className="flex items-start justify-between mb-4">
                                        <div>
                                            <h4 className="text-white font-bold text-sm tracking-wide uppercase">{idea.name}</h4>
                                            <p className="text-white/50 text-[10px] font-bold mt-1 uppercase tracking-widest">"{idea.tagline}"</p>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-1 bg-white/10 text-white/70 border border-white/10 rounded-sm whitespace-nowrap">{idea.type}</span>
                                            {/* Action buttons */}
                                            <button
                                                onClick={() => handleSaveIdea(idea, i)}
                                                disabled={savingId === i}
                                                className="w-7 h-7 rounded-sm text-sm border flex items-center justify-center transition-all bg-white/5 text-white/30 border-white/10 hover:bg-emerald-500/20 hover:text-emerald-400 hover:border-emerald-500/30 disabled:opacity-50"
                                                title="Uložit nápad"
                                            >{savingId === i ? '⏳' : '💾'}</button>
                                            <button
                                                onClick={() => handleRejectIdea(idea, i)}
                                                disabled={rejectingId === i}
                                                className="w-7 h-7 rounded-sm text-sm border flex items-center justify-center transition-all bg-white/5 text-white/30 border-white/10 hover:bg-aisummit-cinnabar/20 hover:text-aisummit-cinnabar hover:border-aisummit-cinnabar/30 disabled:opacity-50"
                                                title="Zahodit"
                                            >{rejectingId === i ? '⏳' : '🗑️'}</button>
                                        </div>
                                    </div>

                                    {/* Branding name variants */}
                                    {idea.brandingNames && idea.brandingNames.length > 0 && (
                                        <div className="mb-4 pt-2">
                                            <span className="text-[9px] uppercase tracking-widest font-bold text-amber-500/50 mb-2 block">🏷️ Varianty názvů</span>
                                            <div className="flex flex-wrap gap-1.5">
                                                {idea.brandingNames.map((bn: string, j: number) => (
                                                    <span key={j} className="px-2 py-1 bg-amber-500/5 border border-amber-500/10 text-amber-500 rounded-sm text-[9px] font-bold uppercase tracking-widest cursor-default">
                                                        {bn}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <p className="text-white/70 text-xs font-medium mb-5">{idea.description}</p>

                                    <div className="space-y-2 text-[10px] font-mono tracking-wide text-white/50">
                                        <div className="flex gap-2">
                                            <span className="text-white/30 w-16 uppercase font-bold tracking-widest">💰 Cena:</span>
                                            <span className="text-emerald-400 font-bold">{idea.priceRange}</span>
                                        </div>
                                        <div className="flex gap-2">
                                            <span className="text-white/30 w-16 uppercase font-bold tracking-widest">🔧 Mat.:</span>
                                            <span>{idea.material}</span>
                                        </div>
                                        <div className="flex gap-2">
                                            <span className="text-white/30 w-16 uppercase font-bold tracking-widest">📐 Rozm.:</span>
                                            <span>{idea.dimensions}</span>
                                        </div>
                                        <div className="flex gap-2">
                                            <span className="text-white/30 w-16 uppercase font-bold tracking-widest">🏭 Výr.:</span>
                                            <span>{idea.manufacturingMethod}</span>
                                        </div>
                                    </div>

                                    <div className="mt-4 pt-4 border-t border-white/10 space-y-4 shadow-sm pb-2">
                                        <div>
                                            <span className="text-[9px] uppercase tracking-widest text-amber-500/50 font-bold">🔥 Virální angle</span>
                                            <p className="text-white/70 text-[10px] font-medium mt-1 leading-relaxed">{idea.viralAngle}</p>
                                        </div>
                                        <div>
                                            <span className="text-[9px] uppercase tracking-widest text-emerald-500/50 font-bold">✅ Proč to bude fungovat</span>
                                            <p className="text-white/70 text-[10px] font-medium mt-1 leading-relaxed">{idea.whyItWorks}</p>
                                        </div>
                                        <div>
                                            <span className="text-[9px] uppercase tracking-widest text-blue-500/50 font-bold">📋 Produkce</span>
                                            <p className="text-white/70 text-[10px] font-medium mt-1 leading-relaxed">{idea.productionNotes}</p>
                                        </div>
                                    </div>

                                    {/* Product visualization */}
                                    {ideaVisuals[idea.name] && (
                                        <div className="mt-4 relative group/vis">
                                            <img src={ideaVisuals[idea.name]} alt={idea.name} className="w-full rounded-sm border border-white/10 shadow-sm" />
                                            <a
                                                href={ideaVisuals[idea.name]}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="absolute bottom-2 right-2 px-2 py-1 bg-[#050505] border border-white/10 text-white text-[9px] uppercase tracking-widest font-bold rounded-sm opacity-0 group-hover/vis:opacity-100 transition-opacity shadow-sm"
                                            >📥 Plná velikost</a>
                                        </div>
                                    )}

                                    {/* Action buttons */}
                                    <div className="mt-4 flex gap-2 pt-2">
                                        <button
                                            onClick={async () => {
                                                setVisualizingId(idea.name)
                                                setError(null)
                                                try {
                                                    const result = await triggerProductDesign({ configName: projectId, idea })
                                                    if (result.success && result.designUrl) {
                                                        setIdeaVisuals(v => ({ ...v, [idea.name]: result.designUrl! }))
                                                    } else {
                                                        setError(result.error || "Vizualizace selhala")
                                                    }
                                                } catch (err: any) { setError(err.message) }
                                                finally { setVisualizingId(null) }
                                            }}
                                            disabled={visualizingId === idea.name}
                                            className="flex-1 px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded-sm text-[9px] font-bold uppercase tracking-widest text-amber-500 transition-all disabled:opacity-50 shadow-sm"
                                        >
                                            {visualizingId === idea.name ? "⏳ Generuji..." : "🖼️ Vizualizovat produkt"}
                                        </button>
                                        <button
                                            onClick={() => {
                                                setDesignTheme(idea.name + " — " + idea.tagline)
                                                setSection("design")
                                            }}
                                            className="flex-1 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-sm text-[9px] font-bold uppercase tracking-widest text-white/50 hover:text-white transition-all shadow-sm"
                                        >
                                            🎨 Design pro tisk
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* DB Saved Ideas grid */}
                    {savedIdeas.length > 0 && (
                        <div className="mt-12">
                            <h3 className="text-xl font-black uppercase tracking-tighter text-emerald-400 mb-2 border-b border-emerald-900/50 pb-2">💾 Uložené Nápady</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-6">
                                {savedIdeas.map((idea) => (
                                    <div key={idea.id} className="bg-[#050505] border border-emerald-500/20 rounded-sm p-6 shadow-sm transition-all relative overflow-hidden">
                                        {/* Status badge */}
                                        <div className="absolute top-0 right-0 px-3 py-1 bg-emerald-500/20 text-emerald-400 text-[8px] font-black tracking-widest uppercase rounded-bl-sm border-b border-l border-emerald-500/20">
                                            Saved
                                        </div>

                                        <div className="flex items-start justify-between mb-4 pr-12">
                                            <div>
                                                <h4 className="text-white font-bold text-sm tracking-wide uppercase">{idea.name}</h4>
                                                <p className="text-white/50 text-[10px] font-bold mt-1 uppercase tracking-widest">"{idea.tagline}"</p>
                                            </div>
                                        </div>

                                        <div className="mb-4">
                                            <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-1 bg-white/10 text-white/70 border border-white/10 rounded-sm whitespace-nowrap">{idea.type}</span>
                                        </div>

                                        <p className="text-white/70 text-xs font-medium mb-5">{idea.description}</p>

                                        <div className="space-y-2 text-[10px] font-mono tracking-wide text-white/50">
                                            <div className="flex gap-2">
                                                <span className="text-white/30 w-16 uppercase font-bold tracking-widest">💰 Cena:</span>
                                                <span className="text-emerald-400 font-bold">{idea.priceRange}</span>
                                            </div>
                                            <div className="flex gap-2">
                                                <span className="text-white/30 w-16 uppercase font-bold tracking-widest">🔧 Mat.:</span>
                                                <span>{idea.material}</span>
                                            </div>
                                            <div className="flex gap-2">
                                                <span className="text-white/30 w-16 uppercase font-bold tracking-widest">🏭 Výr.:</span>
                                                <span>{idea.manufacturingMethod}</span>
                                            </div>
                                        </div>

                                        {/* Product visualization */}
                                        {ideaVisuals[idea.id as string] && (
                                            <div className="mt-4 relative group/vis">
                                                <img src={ideaVisuals[idea.id as string]} alt={idea.name} className="w-full rounded-sm border border-emerald-500/20 shadow-sm" />
                                                <a
                                                    href={ideaVisuals[idea.id as string]}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="absolute bottom-2 right-2 px-2 py-1 bg-[#050505] border border-white/10 text-white text-[9px] uppercase tracking-widest font-bold rounded-sm opacity-0 group-hover/vis:opacity-100 transition-opacity shadow-sm"
                                                >📥 Plná velikost</a>
                                            </div>
                                        )}

                                        {/* Action buttons */}
                                        <div className="mt-4 flex gap-2 pt-4 border-t border-white/5 items-center">

                                            {/* File Uploader */}
                                            <div className="relative">
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    id={`upload-${idea.id}`}
                                                    className="hidden"
                                                    onChange={(e) => handleImageUpload(e, idea.id as string)}
                                                    disabled={uploadingId === idea.id}
                                                />
                                                <label
                                                    htmlFor={`upload-${idea.id}`}
                                                    className={`w-9 h-9 rounded-sm border flex items-center justify-center transition-all cursor-pointer ${referenceUrls[idea.id as string]
                                                        ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-400"
                                                        : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white"
                                                        } ${uploadingId === idea.id ? "opacity-50 cursor-wait" : ""}`}
                                                    title="Nahrát referenční fotku"
                                                >
                                                    {uploadingId === idea.id ? (
                                                        <div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                                                    ) : referenceUrls[idea.id as string] ? (
                                                        "✓"
                                                    ) : (
                                                        "📎"
                                                    )}
                                                </label>
                                            </div>

                                            <button
                                                onClick={async () => {
                                                    const id = idea.id as string
                                                    setVisualizingId(id)
                                                    setError(null)
                                                    try {
                                                        const reqUrl = referenceUrls[id]
                                                        const result = await triggerProductDesign({
                                                            configName: projectId,
                                                            idea,
                                                            referenceImageUrl: reqUrl,
                                                            ideaId: id,
                                                        })
                                                        if (result.success && result.designUrl) {
                                                            setIdeaVisuals(v => ({ ...v, [id]: result.designUrl! }))
                                                        } else {
                                                            setError(result.error || "Vizualizace selhala")
                                                        }
                                                    } catch (err: any) { setError(err.message) }
                                                    finally { setVisualizingId(null) }
                                                }}
                                                disabled={visualizingId === idea.id}
                                                className="flex-1 px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-sm text-[9px] font-bold uppercase tracking-widest text-emerald-400 transition-all disabled:opacity-50 shadow-sm flex items-center justify-center gap-2"
                                            >
                                                {visualizingId === idea.id ? "⏳ Generuji..." : (
                                                    referenceUrls[idea.id as string]
                                                        ? "🖼️ Fuse vizualizace (i2i)"
                                                        : "🖼️ Vizualizovat z textu"
                                                )}
                                            </button>

                                            {/* Promo Post button — only if design exists */}
                                            {ideaVisuals[idea.id as string] && (
                                                <button
                                                    onClick={async () => {
                                                        const id = idea.id as string
                                                        setVisualizingId(`promo_${id}`)
                                                        setError(null)
                                                        try {
                                                            const result = await createPromoPost({
                                                                configName: projectId,
                                                                ideaName: idea.name,
                                                                ideaTagline: idea.tagline,
                                                                ideaDescription: idea.description,
                                                                ideaType: idea.type,
                                                                ideaPriceRange: idea.priceRange,
                                                                designUrl: ideaVisuals[id],
                                                            })
                                                            if (result.success) {
                                                                alert(`✅ Promo post vytvořen!\n\nCaption:\n${result.caption?.substring(0, 200)}...\n\nNajdeš ho v záložce Posts jako Draft.`)
                                                            } else {
                                                                setError(result.error || "Vytvoření postu selhalo")
                                                            }
                                                        } catch (err: any) { setError(err.message) }
                                                        finally { setVisualizingId(null) }
                                                    }}
                                                    disabled={visualizingId === `promo_${idea.id}`}
                                                    className="flex-1 px-3 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded-sm text-[9px] font-bold uppercase tracking-widest text-blue-400 transition-all disabled:opacity-50 shadow-sm flex items-center justify-center gap-2"
                                                >
                                                    {visualizingId === `promo_${idea.id}` ? "⏳ Vytvářím..." : "📸 Vytvoř promo post"}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ═══ DESIGN SECTION ═══ */}
            {section === "design" && !loading && (
                <div className="space-y-6">
                    <div className="bg-[#0f0f0f] border border-white/10 rounded-sm p-8 shadow-lg">
                        <h3 className="text-2xl font-black uppercase tracking-tighter text-white mb-2">🎨 Print-Ready Design Generator</h3>
                        <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest mb-6">AI vytvoří tisknutelný grafický design izolovaný na černém pozadí — připravený pro DTG potisk.</p>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                            <div>
                                <label className="text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1.5 block">Téma designu *</label>
                                <input
                                    value={designTheme}
                                    onChange={(e) => setDesignTheme(e.target.value)}
                                    placeholder="je ok mít adhd/koho, drogy, holky, dolary! vtipné"
                                    className="w-full px-4 py-3 bg-[#050505] border border-white/10 rounded-sm text-white text-[10px] font-medium placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all"
                                />
                            </div>
                            <div>
                                <label className="text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1.5 block">Typ produktu</label>
                                <select
                                    value={designProductType}
                                    onChange={(e) => setDesignProductType(e.target.value)}
                                    className="w-full px-4 py-3 bg-[#050505] border border-white/10 rounded-sm text-white text-[10px] font-bold uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all"
                                >
                                    {productTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                </select>
                            </div>
                            <div className="flex items-end">
                                <button
                                    onClick={handleGenerateDesignConcept}
                                    disabled={loading || !designTheme.trim()}
                                    className="w-full px-4 py-3 bg-white/10 hover:bg-white/20 text-white rounded-sm text-[10px] uppercase font-black tracking-widest border border-white/20 transition-all disabled:opacity-50 shadow-sm"
                                >
                                    🎨 Generovat design
                                </button>
                            </div>
                        </div>

                        {/* Logo toggle */}
                        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-white/5">
                            <button
                                onClick={() => setDesignIncludeLogo(!designIncludeLogo)}
                                className={`flex items-center gap-2 px-3 py-2 rounded-sm text-[9px] uppercase tracking-widest font-bold transition-all border ${designIncludeLogo
                                    ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                                    : "bg-white/5 text-white/40 border-white/10 hover:bg-white/10 hover:text-white/60"
                                    }`}
                            >
                                <span>{designIncludeLogo ? "✓" : "○"}</span>
                                <span>🏷️ Zakomponovat logo</span>
                            </button>
                            <span className="text-[8px] text-white/25 uppercase tracking-widest">AI kreativně zakomponuje brand logo do designu</span>
                        </div>
                    </div>

                    {/* ── Step 2: Text selection (after concept generated) ── */}
                    {designConceptOnly && designConceptOnly.suggestedTexts && designConceptOnly.suggestedTexts.length > 0 && (
                        <div className="bg-[#0a0a0a] border border-amber-500/20 rounded-sm p-6 shadow-sm">
                            <h4 className="text-[10px] uppercase tracking-[0.3em] font-black text-amber-400 mb-4">✍️ Vyber text na design — nebo napiš vlastní</h4>

                            {/* Suggested text chips */}
                            <div className="flex flex-wrap gap-2 mb-4">
                                <button
                                    onClick={() => setDesignOverlayText("")}
                                    className={`px-3 py-2 rounded-sm text-[9px] uppercase tracking-widest font-bold transition-all border ${!designOverlayText
                                        ? "bg-white/10 text-white border-white/20"
                                        : "bg-white/5 text-white/40 border-white/10 hover:bg-white/10 hover:text-white/60"
                                        }`}
                                >
                                    🚫 Bez textu
                                </button>
                                {designConceptOnly.suggestedTexts.map((text, i) => (
                                    <button
                                        key={i}
                                        onClick={() => setDesignOverlayText(text)}
                                        className={`px-3 py-2 rounded-sm text-[10px] font-bold transition-all border ${designOverlayText === text
                                            ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                                            : "bg-white/5 text-white/60 border-white/10 hover:bg-amber-500/10 hover:text-amber-400 hover:border-amber-500/20"
                                            }`}
                                    >
                                        &ldquo;{text}&rdquo;
                                    </button>
                                ))}
                            </div>

                            {/* Custom text input */}
                            <div className="flex gap-3">
                                <input
                                    value={designOverlayText}
                                    onChange={(e) => setDesignOverlayText(e.target.value)}
                                    placeholder="Nebo napiš vlastní text..."
                                    className="flex-1 px-4 py-3 bg-[#050505] border border-white/10 rounded-sm text-white text-sm font-medium placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition-all"
                                />
                                <button
                                    onClick={handleRegenerateWithText}
                                    disabled={loading}
                                    className="px-6 py-3 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 rounded-sm text-[10px] font-black uppercase tracking-widest text-amber-400 transition-all disabled:opacity-50 whitespace-nowrap shadow-sm"
                                >
                                    {designOverlayText ? "🔄 Přegenerovat s textem" : "🔄 Přegenerovat design"}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Design result */}
                    {designResult && (
                        <div className="bg-[#0a0a0a] border border-white/10 shadow-sm rounded-sm p-6">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* Image preview */}
                                <div className="relative group">
                                    <img
                                        src={designResult.designUrl}
                                        alt={designResult.concept.name}
                                        className="w-full rounded-sm border border-white/10 shadow-sm"
                                    />
                                    <a
                                        href={designResult.designUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="absolute bottom-3 right-3 px-3 py-1.5 bg-[#050505] border border-white/10 text-white text-[9px] font-bold uppercase tracking-widest rounded-sm opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                                    >
                                        📥 Otevřít v plné velikosti
                                    </a>
                                </div>

                                {/* Concept details */}
                                <div className="space-y-4">
                                    <div>
                                        <h4 className="text-2xl font-black uppercase tracking-tighter text-white">{designResult.concept.name}</h4>
                                        <p className="text-white/50 text-xs font-medium mt-1.5">{designResult.concept.description}</p>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="bg-[#0f0f0f] border border-white/5 rounded-sm p-4">
                                            <span className="text-[9px] font-bold uppercase tracking-widest text-white/40">Styl</span>
                                            <p className="text-white text-xs font-medium mt-1">{designResult.concept.style}</p>
                                        </div>
                                        <div className="bg-[#0f0f0f] border border-white/5 rounded-sm p-4">
                                            <span className="text-[9px] font-bold uppercase tracking-widest text-white/40">Placement</span>
                                            <p className="text-white text-xs font-medium mt-1">{designResult.concept.placement}</p>
                                        </div>
                                    </div>

                                    <div>
                                        <span className="text-[9px] font-bold uppercase tracking-widest text-white/40 mb-2 block">Barvy</span>
                                        <div className="flex gap-2">
                                            {designResult.concept.colors.map((c, i) => (
                                                <span key={i} className="px-2 py-1 bg-white/5 border border-white/10 rounded-sm text-[9px] tracking-widest uppercase font-bold text-white/70">{c}</span>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="pt-4 border-t border-white/10">
                                        <span className="text-[9px] font-bold uppercase tracking-widest text-white/40">AI Prompt</span>
                                        <p className="text-white/50 text-[10px] mt-2 font-mono tracking-wide bg-[#0f0f0f] border border-white/5 shadow-inner rounded-sm p-4 leading-relaxed">{designResult.concept.designPrompt}</p>
                                    </div>

                                    {/* Generate mockup from this design */}
                                    <button
                                        onClick={() => {
                                            setMockupDesignUrl(designResult.designUrl)
                                            setMockupDescription(designResult.concept.description)
                                            setMockupProductType(designProductType)
                                            setSection("mockup")
                                        }}
                                        className="w-full px-4 py-3 bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-sm text-[10px] font-black uppercase tracking-widest transition-all shadow-sm"
                                    >
                                        👕 Vytvořit mockup s tímto designem
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ═══ MOCKUP SECTION ═══ */}
            {section === "mockup" && !loading && (
                <div className="space-y-6">
                    <div className="bg-[#0f0f0f] border border-white/10 rounded-sm p-8 shadow-lg">
                        <h3 className="text-2xl font-black uppercase tracking-tighter text-white mb-2">👕 Product Mockup Generator</h3>
                        <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest mb-6">AI vygeneruje fotorealistický mockup produktu s designem — ideální pro e-shop a Instagram.</p>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                            <div>
                                <label className="text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1.5 block">Typ produktu</label>
                                <select
                                    value={mockupProductType}
                                    onChange={(e) => setMockupProductType(e.target.value)}
                                    className="w-full px-4 py-3 bg-[#050505] border border-white/10 rounded-sm text-white text-[10px] font-bold uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all"
                                >
                                    {productTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1.5 block">Popis designu (volitelné)</label>
                                <input
                                    value={mockupDescription}
                                    onChange={(e) => setMockupDescription(e.target.value)}
                                    placeholder="Popis grafiky pro lepší výsledek..."
                                    className="w-full px-4 py-3 bg-[#050505] border border-white/10 rounded-sm text-white text-[10px] font-medium placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all"
                                />
                            </div>
                        </div>

                        <button
                            onClick={handleGenerateMockup}
                            disabled={loading}
                            className="w-full sm:w-auto px-6 py-3 bg-white/10 hover:bg-white/20 border border-white/20 text-white rounded-sm text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 shadow-sm"
                        >
                            📸 Generovat mockup
                        </button>
                    </div>

                    {/* Mockup result */}
                    {mockupUrl && (
                        <div className="bg-[#0a0a0a] border border-white/10 shadow-sm rounded-sm p-6">
                            <div className="max-w-lg mx-auto relative group">
                                <img
                                    src={mockupUrl}
                                    alt="Product mockup"
                                    className="w-full rounded-sm border border-white/10 shadow-sm"
                                />
                                <a
                                    href={mockupUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="absolute bottom-3 right-3 px-3 py-1.5 bg-[#050505] border border-white/10 text-white text-[9px] font-bold uppercase tracking-widest rounded-sm opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                                >
                                    📥 Otevřít v plné velikosti
                                </a>
                            </div>
                        </div>
                    )}

                    {/* Show design reference if available */}
                    {mockupDesignUrl && (
                        <div className="bg-[#0f0f0f] border border-white/5 rounded-sm p-5 shadow-inner">
                            <span className="text-[9px] font-bold uppercase tracking-widest text-white/40">Zdrojový design</span>
                            <div className="flex items-center gap-4 mt-3">
                                <img src={mockupDesignUrl} alt="Source design" className="w-16 h-16 rounded-sm border border-white/10 object-cover shadow-sm" />
                                <code className="text-[10px] text-white/50 tracking-wide font-mono break-all">{mockupDesignUrl}</code>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
