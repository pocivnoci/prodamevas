"use client"

import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
    getIGPostTypes,
    getIGPostFormats,
    getIGCategories,
} from "@/app/actions/admin-actions"
import { type GenerateResult } from "@/app/actions/ig-generate-action"
import { useCopyToClipboard } from "./hooks"
import type { IGPostType, IGCategory, IGPostFormat } from "./types"

export function GenerateTab({ projectId }: { projectId: string }) {
    const [postTypes, setPostTypes] = useState<IGPostType[]>([])
    const [postFormats, setPostFormats] = useState<Record<string, IGPostFormat>>({})
    const [categories, setCategories] = useState<IGCategory[]>([])
    const [selectedType, setSelectedType] = useState("")
    const [topic, setTopic] = useState("")
    const [aspectRatio, setAspectRatio] = useState("")
    const [category, setCategory] = useState("")
    const [dryRun, setDryRun] = useState(false)
    const [generating, setGenerating] = useState(false)
    const [result, setResult] = useState<GenerateResult | null>(null)
    const [batchCount, setBatchCount] = useState(3)
    const [batchMode, setBatchMode] = useState(false)
    const [batchResult, setBatchResult] = useState<{ generated: number; errors: number; message: string } | null>(null)
    const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; successes: number; failures: number } | null>(null)
    const [generationHistory, setGenerationHistory] = useState<GenerateResult[]>([])
    const [step, setStep] = useState(1)

    // Reload post types + formats + categories when project changes
    useEffect(() => {
        if (!projectId) return
        getIGPostTypes(projectId).then(setPostTypes)
        getIGPostFormats(projectId).then(setPostFormats)
        getIGCategories(projectId).then(setCategories)
        setSelectedType("") // reset selection on project change
        setCategory("") // reset category on project change
        setStep(1)
    }, [projectId])

    // Fetch wrapper replacing the old 'use server' action (to bypass Vercel 60s limit with our custom API layout maxDuration=300)
    const triggerPostGeneration = async (options: any) => {
        const res = await fetch("/api/ig-generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(options)
        })
        const data = await res.json()
        if (!res.ok) {
            return { success: false, error: data.error || "API error" }
        }
        return data
    }

    const handleGenerate = async () => {
        setGenerating(true)
        setResult(null)
        setBatchResult(null)
        setBatchProgress(null)

        const maxClientRetries = 1

        try {
            if (batchMode) {
                // === SEQUENTIAL BATCH: generate posts one by one ===
                // Each post is a separate Vercel request (~90s), never hitting 300s timeout
                let successes = 0
                let failures = 0
                setBatchProgress({ current: 0, total: batchCount, successes: 0, failures: 0 })

                for (let i = 0; i < batchCount; i++) {
                    setBatchProgress({ current: i + 1, total: batchCount, successes, failures })

                    try {
                        let res = await triggerPostGeneration({
                            configName: projectId,
                            type: undefined, // let autopilot pick smart types
                            topic: topic || undefined,
                            category: category !== "auto" ? category : undefined,
                            dryRun,
                            aspectRatio: aspectRatio || undefined,
                        })
                        // Auto-retry once on failure
                        if (!res.success && maxClientRetries > 0) {
                            await new Promise(r => setTimeout(r, 3000))
                            res = await triggerPostGeneration({
                                configName: projectId,
                                type: undefined,
                                topic: topic || undefined,
                                category: category !== "auto" ? category : undefined,
                                dryRun,
                                aspectRatio: aspectRatio || undefined,
                            })
                        }
                        if (res.success) {
                            successes++
                            setGenerationHistory(prev => [res, ...prev].slice(0, 10))
                        } else {
                            failures++
                        }
                    } catch {
                        failures++
                    }

                    setBatchProgress({ current: i + 1, total: batchCount, successes, failures })

                    // Small pause between posts to avoid API rate limiting
                    if (i < batchCount - 1) {
                        await new Promise(r => setTimeout(r, 2000))
                    }
                }

                setBatchResult({
                    generated: successes,
                    errors: failures,
                    message: successes > 0
                        ? `Úspěšně vygenerováno ${successes} z ${batchCount} postů`
                        : `Všech ${batchCount} postů selhalo`,
                    success: successes > 0,
                } as any)
            } else {
                let res = await triggerPostGeneration({
                    configName: projectId,
                    type: selectedType || undefined,
                    topic: topic || undefined,
                    category: category !== "auto" ? category : undefined,
                    dryRun,
                    aspectRatio: aspectRatio || undefined,
                })
                // Auto-retry once on failure
                if (!res.success && maxClientRetries > 0) {
                    await new Promise(r => setTimeout(r, 3000))
                    res = await triggerPostGeneration({
                        configName: projectId,
                        type: selectedType || undefined,
                        topic: topic || undefined,
                        category: category !== "auto" ? category : undefined,
                        dryRun,
                        aspectRatio: aspectRatio || undefined,
                    })
                }
                setResult(res)
                if (res.success) {
                    setGenerationHistory(prev => [res, ...prev].slice(0, 10))
                }
            }
        } catch (err: any) {
            const errorMsg = err?.message || "Neznámá chyba při generování"
            if (batchMode) {
                setBatchResult({
                    generated: 0,
                    errors: batchCount,
                    message: errorMsg,
                })
            } else {
                setResult({
                    success: false,
                    error: errorMsg,
                })
            }
        }

        setBatchProgress(null)
        setStep(3)
        setGenerating(false)
    }

    const { copiedField, copyToClipboard } = useCopyToClipboard()

    return (
        <div className="max-w-4xl mx-auto space-y-8 mt-2 pb-24">
            {/* Progress Pill */}
            <div className="flex justify-center">
                <div className="inline-flex items-center bg-[#0a0a0a] shadow-sm border border-white/10 rounded-sm p-1.5 relative overflow-hidden">
                    {/* Animated gradient accent behind active step */}
                    <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-transparent via-aisummit-cinnabar to-transparent opacity-50 blur-[2px]"></div>

                    {[1, 2, 3].map(s => (
                        <button
                            key={s}
                            onClick={() => {
                                if (generating) return
                                // Prevent skipping directly to result if not generated yet
                                if (s === 3 && !result && !batchResult && !generating) return
                                setStep(s)
                            }}
                            disabled={generating && s !== step}
                            className={`px-6 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm transition-all duration-300 relative z-10 ${step === s
                                ? "bg-white/10 text-white shadow-md border border-white/20"
                                : "text-white/40 hover:text-white hover:bg-white/5"
                                } ${s === 3 && !result && !batchResult && !generating ? "opacity-30 cursor-not-allowed" : ""}`}
                        >
                            {s === 1 ? "1. Styl & Vibe" : s === 2 ? "2. Kreativní Brief" : "3. Prezentace"}
                        </button>
                    ))}
                </div>
            </div>

            <AnimatePresence mode="wait">
                {step === 1 && (
                    <motion.div
                        key="step1"
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -15 }}
                        className="bg-[#0f0f0f] rounded-sm p-8 sm:p-12 border border-white/10 flex flex-col items-center"
                    >
                        <div className="text-center mb-10">
                            <h2 className="text-4xl font-black tracking-tighter uppercase text-white/90 mb-3">Základní směr</h2>
                            <p className="text-[10px] text-white/40 font-bold tracking-widest uppercase">Jaký typ obsahu pro vás dnes AI architekt navrhne?</p>
                        </div>

                        {/* Mode Selector */}
                        <div className="flex bg-[#050505] p-1.5 rounded-sm border border-white/10 w-full max-w-sm mb-10 mx-auto">
                            <button
                                onClick={() => setBatchMode(false)}
                                className={`flex-1 py-3.5 text-[10px] font-bold uppercase tracking-widest rounded-sm transition-all ${!batchMode
                                    ? "bg-white/10 text-white border border-white/20 shadow-sm"
                                    : "text-white/50 hover:text-white"
                                    }`}
                            >
                                Exkluzivní post
                            </button>
                            <button
                                onClick={() => setBatchMode(true)}
                                className={`flex-1 py-3.5 text-[10px] font-bold uppercase tracking-widest rounded-sm transition-all ${batchMode
                                    ? "bg-aisummit-cinnabar/20 text-aisummit-cinnabar border border-aisummit-cinnabar/30 shadow-sm"
                                    : "text-white/50 hover:text-white"
                                    }`}
                            >
                                Content Plán
                            </button>
                        </div>

                        {/* Category Grid - Only for Single Post Mode */}
                        {!batchMode ? (
                            <div className="w-full">
                                <label className="text-[10px] text-white/40 mb-4 block uppercase tracking-widest text-center font-bold">Vyberte Základní Pilíř</label>
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                    <button
                                        onClick={() => setCategory("auto")}
                                        className={`p-4 rounded-sm border transition-all text-center flex flex-col items-center justify-center gap-3 ${category === "auto" || category === ""
                                            ? "border-white/30 bg-white/10 text-white shadow-sm scale-[1.02]"
                                            : "border-white/5 bg-[#0a0a0a] hover:border-white/20 text-white/50"
                                            }`}
                                    >
                                        <span className="text-3xl grayscale opacity-80">🤖</span>
                                        <span className="text-[10px] font-bold uppercase tracking-widest mt-1">Automaticky</span>
                                    </button>
                                    {categories.map(cat => (
                                        <button
                                            key={cat.id}
                                            onClick={() => setCategory(cat.id)}
                                            className={`p-4 rounded-sm border transition-all text-center flex flex-col items-center justify-center gap-3 ${category === cat.id
                                                ? "border-aisummit-cinnabar/50 bg-aisummit-cinnabar/10 text-aisummit-cinnabar shadow-[0_0_15px_rgba(229,83,63,0.1)] scale-[1.02]"
                                                : "border-white/5 bg-[#0a0a0a] hover:border-white/20 text-white/50"
                                                }`}
                                        >
                                            <span className="text-3xl">{cat.emoji}</span>
                                            <span className="text-[10px] font-bold uppercase tracking-widest mt-1">{cat.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="w-full text-center py-8 bg-[#0a0a0a] border border-white/5 rounded-sm">
                                <span className="text-4xl block mb-4">📅</span>
                                <h3 className="text-white/90 font-bold mb-2">Inteligentní Content Plán</h3>
                                <p className="text-white/50 text-sm max-w-md mx-auto">
                                    Vygeneruje celou sérii příspěvků na základě nastavené týdenní strategie (např. Poměr Edukace vs Prodej vs Humor). System zajistí dokonalý mix.
                                </p>
                            </div>
                        )}

                        <button
                            onClick={() => setStep(2)}
                            className="mt-12 group flex items-center gap-3 px-8 py-4 bg-[#050505] text-white rounded-sm font-bold uppercase tracking-widest border border-white/10 hover:border-white/30 transition-all hover:pr-6"
                        >
                            <span>Pokračovat k Detailům</span>
                            <span className="opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all">→</span>
                        </button>
                    </motion.div>
                )}

                {step === 2 && (
                    <motion.div
                        key="step2"
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -15 }}
                        className="bg-[#0f0f0f] rounded-sm p-8 sm:p-12 border border-white/10"
                    >
                        <div className="text-center mb-10">
                            <h2 className="text-4xl font-black uppercase tracking-tighter text-white/90 mb-3">Kreativní Brief</h2>
                            <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest">Upřesněte zadání pro dnešní {batchMode ? 'kampaň' : 'příspěvek'}.</p>
                        </div>

                        <div className="max-w-2xl mx-auto space-y-8">
                            {!batchMode && (
                                <div>
                                    <label className="text-[10px] text-white/50 mb-2 block uppercase tracking-widest font-bold">Specifický Formát (Kategorie: {category === "auto" || !category ? "Vše" : categories.find(c => c.id === category)?.label})</label>
                                    <select
                                        value={selectedType}
                                        onChange={(e) => setSelectedType(e.target.value)}
                                        className="w-full px-5 py-4 bg-[#050505] border border-white/10 rounded-sm text-white text-sm focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all shadow-sm"
                                    >
                                        <option value="">🎲 Překvapte mě (Náhodný výběr AI)</option>
                                        {postTypes
                                            .filter(pt => pt.is_active)
                                            .filter(pt => category === "auto" || category === "" || pt.pillarId === category)
                                            .map(pt => (
                                                <option key={pt.id} value={pt.name}>
                                                    {pt.emoji} {pt.display_name}
                                                </option>
                                            ))}
                                    </select>
                                </div>
                            )}

                            {batchMode && (
                                <div>
                                    <label className="text-[10px] text-white/50 mb-2 block uppercase tracking-widest font-bold">Objem kampaně</label>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                        {[
                                            { count: 3, label: "3 dny (Zkouška)" },
                                            { count: 7, label: "7 dní (Týden)" },
                                            { count: 14, label: "14 dní (Půl měsíce)" },
                                            { count: 30, label: "30 dní (Měsíc)" }
                                        ].map(opt => (
                                            <button
                                                key={opt.count}
                                                onClick={() => setBatchCount(opt.count)}
                                                className={`py-4 px-2 rounded-sm text-sm font-semibold transition-all border ${batchCount === opt.count
                                                    ? "bg-aisummit-cinnabar/20 border-aisummit-cinnabar/30 text-aisummit-cinnabar shadow-sm"
                                                    : "bg-[#050505] border-white/10 text-white/40 hover:text-white hover:border-white/30"
                                                    }`}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                    <p className="text-[10px] text-white/30 mt-2 text-right font-mono tracking-widest uppercase">
                                        Odhadovaná cena AI: ${(batchCount * 0.10).toFixed(2)}
                                    </p>
                                </div>
                            )}

                            <div>
                                <label className="text-[10px] text-white/50 mb-2 block uppercase tracking-widest font-bold">Hlavní téma / Myšlenka (Volitelné)</label>
                                <textarea
                                    placeholder="O čem by měl příspěvek komunikovat? Např. Jarní slevy, Nová kolekce šperků, nebo edukace ohledně péče o pleť..."
                                    value={topic}
                                    onChange={(e) => setTopic(e.target.value)}
                                    rows={3}
                                    className="w-full px-5 py-4 bg-[#050505] border border-white/10 rounded-sm text-white placeholder:text-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all shadow-sm resize-none"
                                />
                            </div>

                            <div>
                                <label className="text-[10px] text-white/50 mb-2 block uppercase tracking-widest font-bold">📐 Formát obrázku</label>
                                <div className="grid grid-cols-4 gap-2">
                                    {[
                                        { value: "", label: "Auto", desc: "Dle configu" },
                                        { value: "1:1", label: "1:1", desc: "Čtverec" },
                                        { value: "4:5", label: "4:5", desc: "IG Feed" },
                                        { value: "3:4", label: "3:4", desc: "Na výšku" },
                                    ].map(opt => (
                                        <button
                                            key={opt.value}
                                            onClick={() => setAspectRatio(opt.value)}
                                            className={`py-3 px-2 rounded-sm text-center transition-all border ${aspectRatio === opt.value
                                                ? "bg-white/10 border-white/30 text-white shadow-sm"
                                                : "bg-[#050505] border-white/10 text-white/40 hover:text-white hover:border-white/20"
                                                }`}
                                        >
                                            <span className="text-sm font-black block">{opt.label}</span>
                                            <span className="text-[8px] uppercase tracking-widest font-bold opacity-50">{opt.desc}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="pt-4 border-t border-white/10 flex items-center justify-between">
                                <label className="flex items-center gap-3 cursor-pointer group">
                                    <div className={`relative w-12 h-6 rounded-full transition-colors ${dryRun ? "bg-aisummit-cinnabar" : "bg-white/10 hover:bg-white/20"}`}
                                        onClick={() => setDryRun(!dryRun)}
                                    >
                                        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm ${dryRun ? "translate-x-7" : "translate-x-1"}`} />
                                    </div>
                                    <span className="text-[10px] uppercase tracking-widest font-bold text-white/70 group-hover:text-white transition-colors mt-1.5">Návrhový režim <span className="text-white/40 font-normal">(bez obrázků)</span></span>
                                </label>

                                <button
                                    onClick={handleGenerate}
                                    disabled={generating}
                                    className={`px-8 py-4 rounded-sm transition-all flex items-center gap-3 text-[10px] font-black tracking-widest uppercase ${generating
                                        ? "bg-white/5 text-white/30 cursor-wait border border-white/10"
                                        : "bg-aisummit-cinnabar text-white shadow-[0_0_15px_rgba(229,83,63,0.3)] hover:shadow-[0_0_20px_rgba(229,83,63,0.6)]"
                                        }`}
                                >
                                    {generating ? (
                                        <>
                                            <span className="w-4 h-4 border-2 border-white/30 border-t-transparent rounded-full animate-spin" />
                                            {batchProgress ? `Post ${batchProgress.current}/${batchProgress.total} (✅${batchProgress.successes} ❌${batchProgress.failures})` : "Navrhuji obsah..."}
                                        </>
                                    ) : (
                                        <>
                                            <span>✨ Vytvořit magii</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}

                {step === 3 && (
                    <motion.div
                        key="step3"
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -15 }}
                        className="bg-[#0f0f0f] rounded-sm p-8 sm:p-12 border border-white/10 relative overflow-hidden min-h-[500px] flex flex-col justify-center"
                    >
                        {generating ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0f0f0f] z-10">
                                <div className="absolute inset-0 opacity-20 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-aisummit-cinnabar via-[#0f0f0f] to-[#0f0f0f] pointer-events-none mix-blend-screen animate-pulse"></div>
                                <div className="w-16 h-16 border-[3px] border-white/10 border-t-aisummit-cinnabar rounded-full animate-spin mx-auto mb-8 shadow-sm relative z-10" />
                                <h3 className="text-2xl font-black uppercase tracking-tighter text-white mb-4 relative z-10">{batchProgress ? `Generuji post ${batchProgress.current} z ${batchProgress.total}...` : "Kreativní proces probíhá..."}</h3>
                                {batchProgress && (
                                    <div className="w-64 h-2 bg-white/10 rounded-full mb-4 relative z-10 overflow-hidden">
                                        <div
                                            className="h-full bg-gradient-to-r from-aisummit-cinnabar to-orange-400 rounded-full transition-all duration-500"
                                            style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                                        />
                                    </div>
                                )}
                                <div className="h-6 overflow-hidden relative z-10">
                                    <motion.div
                                        animate={{ y: [0, -24, -48, -72, -96] }}
                                        transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
                                    >
                                        <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest h-6 flex items-center">Architekt analyzuje brand identitu...</p>
                                        <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest h-6 flex items-center">Copywriter skládá úderné texty...</p>
                                        <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest h-6 flex items-center">Generuji vizuální prompt pro AI...</p>
                                        <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest h-6 flex items-center">Vykreslování pixelů v Imagen 3...</p>
                                        <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest h-6 flex items-center">Finální leštění a optimalizace...</p>
                                    </motion.div>
                                </div>
                            </div>
                        ) : result ? (
                            <div className="w-full max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                                <div className="text-center mb-8">
                                    <span className={`inline-flex items-center justify-center w-16 h-16 rounded-sm text-3xl mb-4 shadow-sm border ${result.success ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-aisummit-cinnabar/10 text-aisummit-cinnabar border-aisummit-cinnabar/20"}`}>
                                        {result.success ? "✨" : "⚠️"}
                                    </span>
                                    <h2 className="text-3xl font-black uppercase tracking-tighter text-white mb-2">
                                        {result.success ? "Prezentace návrhu" : "Něco se pokazilo"}
                                    </h2>
                                    {result.error && <p className="text-aisummit-cinnabar font-bold uppercase tracking-widest text-[10px]">{result.error}</p>}
                                </div>

                                {/* Detailed Presentation View */}
                                {result.success && result.imageUrl && (
                                    <div className="bg-[#0a0a0a] rounded-sm p-4 sm:p-6 border border-white/10 shadow-lg">
                                        <div className="mb-6 rounded-sm overflow-hidden bg-[#0f0f0f] shadow-inner border border-white/5">
                                            {(() => {
                                                const urls = result.imageUrl?.split("|").filter(Boolean) || []
                                                if (urls.length > 1) {
                                                    return (
                                                        <div className="flex overflow-x-auto snap-x snap-mandatory hide-scrollbar">
                                                            {urls.map((u, i) => (
                                                                <img key={i} src={u} className="w-full h-auto max-h-[500px] object-contain snap-center shrink-0 border-r border-white/5 last:border-0" alt={`Slide ${i}`} />
                                                            ))}
                                                        </div>
                                                    )
                                                }
                                                return <img src={urls[0]} className="w-full h-auto max-h-[500px] object-contain" alt="Vygenerovaný obsah" />
                                            })()}
                                        </div>

                                        {result.caption && (
                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Finální Copy</span>
                                                    <button onClick={() => copyToClipboard(result.caption!, "final")} className="text-[10px] font-bold uppercase tracking-widest text-aisummit-cinnabar hover:text-white transition-colors">
                                                        {copiedField === "final" ? "✓ Zkopírováno" : "Kopírovat text"}
                                                    </button>
                                                </div>
                                                <p className="text-white/70 font-medium leading-relaxed whitespace-pre-wrap bg-[#0f0f0f] p-5 rounded-sm border border-white/5 shadow-sm">{result.caption}</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ) : batchResult ? (
                            <div className="w-full max-w-md mx-auto text-center space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
                                <span className="inline-flex items-center justify-center w-20 h-20 rounded-sm bg-emerald-500/10 text-emerald-400 text-4xl shadow-sm border border-emerald-500/20 mb-2">🚀</span>
                                <h2 className="text-4xl font-black uppercase tracking-tighter text-white">Kampaň spuštěna</h2>
                                <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest">{batchResult.message}</p>

                                <div className="grid grid-cols-2 gap-4 mt-8">
                                    <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-sm p-6 shadow-sm">
                                        <p className="text-5xl font-black text-emerald-500 mb-2">{batchResult.generated}</p>
                                        <p className="text-[10px] font-bold tracking-widest uppercase text-emerald-500/50">Úspěch</p>
                                    </div>
                                    <div className="bg-aisummit-cinnabar/5 border border-aisummit-cinnabar/10 rounded-sm p-6 shadow-sm">
                                        <p className="text-5xl font-black text-aisummit-cinnabar mb-2">{batchResult.errors}</p>
                                        <p className="text-[10px] font-bold tracking-widest uppercase text-aisummit-cinnabar/50">Selhání</p>
                                    </div>
                                </div>

                                <button onClick={() => setStep(1)} className="mt-8 px-8 py-3 rounded-sm bg-[#050505] text-white font-bold uppercase tracking-widest text-[10px] border border-white/10 hover:border-white/30 transition-colors">
                                    Vytvořit další
                                </button>
                            </div>
                        ) : (
                            <div className="text-center text-white/40">
                                <p className="text-5xl mb-4 opacity-30 grayscale">✨</p>
                                <p className="text-xl font-black uppercase tracking-tighter text-white/50 mb-2">Čekám na zadání</p>
                                <p className="font-bold uppercase tracking-widest text-[10px]">Vraťte se na krok Brief a spusťte generování.</p>
                                <button onClick={() => setStep(2)} className="mt-6 px-6 py-2 rounded-sm text-[10px] font-bold tracking-widest uppercase bg-white/5 text-white/50 border border-white/10 hover:text-white hover:bg-white/10 transition-colors">Zpět na Brief</button>
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
