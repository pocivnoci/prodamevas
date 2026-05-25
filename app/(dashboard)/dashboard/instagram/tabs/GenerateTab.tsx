"use client"

import { useEffect, useState, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
    getIGPostTypes,
    getIGPostFormats,
    getIGCategories,
    getIGIdeasList,
    getIGReviewsList,
    generateContentPlan,
    regeneratePlanItem,
    getProducts,
    type ContentPlanItem,
} from "@/app/actions/admin-actions"
import { uploadCustomImage, type GenerateResult } from "@/app/actions/ig-generate-action"
import { canGenerate } from "@/app/actions/credit-guard"
import { useStudio } from "@/app/(dashboard)/StudioContext"
import { usePaywall } from "@/app/(dashboard)/PaywallProvider"
import { useCopyToClipboard } from "./hooks"
import type { IGPostType, IGCategory, IGPostFormat } from "./types"
import { trackEvent } from "@/lib/analytics"

export function GenerateTab({ projectId }: { projectId: string }) {
    const { refreshSubscription, setActiveSection } = useStudio()
    const { showPlanUnlockModal } = usePaywall()
    const [postTypes, setPostTypes] = useState<IGPostType[]>([])
    const [postFormats, setPostFormats] = useState<Record<string, IGPostFormat>>({})
    const [categories, setCategories] = useState<IGCategory[]>([])
    const [selectedType, setSelectedType] = useState("")
    const [topic, setTopic] = useState("")
    const [aspectRatio, setAspectRatio] = useState("")
    const [medium, setMedium] = useState("")
    const [category, setCategory] = useState("")
    const [creditError, setCreditError] = useState<string | null>(null)
    const [customImageFile, setCustomImageFile] = useState<File | null>(null)
    const [generating, setGenerating] = useState(false)
    const [agentStatus, setAgentStatus] = useState<{ stage: string; progress: number; message: string } | null>(null)
    const [result, setResult] = useState<GenerateResult | null>(null)
    const [batchCount, setBatchCount] = useState(3)
    const [batchMode, setBatchMode] = useState(false)
    const [batchResult, setBatchResult] = useState<{ generated: number; errors: number; message: string } | null>(null)
    const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; successes: number; failures: number } | null>(null)
    const [generationHistory, setGenerationHistory] = useState<GenerateResult[]>([])
    const [step, setStep] = useState(1)

    // Content Plan Preview (batch mode intermediate step)
    const [contentPlan, setContentPlan] = useState<ContentPlanItem[]>([])
    const [planGenerating, setPlanGenerating] = useState(false)
    const [editingPlanItem, setEditingPlanItem] = useState<string | null>(null)
    const [regeneratingItem, setRegeneratingItem] = useState<string | null>(null)
    const [showAdvanced, setShowAdvanced] = useState(false)
    const [pendingGenerate, setPendingGenerate] = useState(false)

    // Ideas & Reviews for topic pre-fill
    const [savedIdeas, setSavedIdeas] = useState<any[]>([])
    const [approvedReviews, setApprovedReviews] = useState<any[]>([])
    const [showIdeaPicker, setShowIdeaPicker] = useState(false)

    // Product catalog for @ mention picker
    const [catalogProducts, setCatalogProducts] = useState<any[]>([])
    const [productPickerItem, setProductPickerItem] = useState<string | null>(null)
    const [productSearch, setProductSearch] = useState("")
    const productPickerRef = useRef<HTMLDivElement>(null)

    // Reload post types + formats + categories when project changes
    useEffect(() => {
        if (!projectId) return
        getIGPostTypes(projectId).then(setPostTypes)
        getIGPostFormats(projectId).then(setPostFormats)
        getIGCategories(projectId).then(setCategories)
        getIGIdeasList(projectId).then(setSavedIdeas)
        getIGReviewsList(projectId).then(reviews => setApprovedReviews(reviews.filter((r: any) => r.is_approved)))
        getProducts(projectId).then(setCatalogProducts)
        setSelectedType("") // reset selection on project change
        setCategory("") // reset category on project change
        setStep(1)
    }, [projectId])

    // Close product picker on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (productPickerRef.current && !productPickerRef.current.contains(e.target as Node)) {
                setProductPickerItem(null)
                setProductSearch("")
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [])

    // Set product on content plan item
    const handleSetProduct = (itemId: string, product: any | null) => {
        setContentPlan(prev => prev.map(p =>
            p.id === itemId
                ? { ...p, productId: product?.id || undefined, productName: product?.name || undefined, productImage: product?.image_urls?.[0] || undefined }
                : p
        ))
        setProductPickerItem(null)
        setProductSearch("")
    }

    // Generation: POST blocks synchronously, but we extract jobId via a pre-flight call
    const triggerPostGeneration = async (options: any): Promise<any> => {
        let pollingActive = true
        const jobIdRef = { current: null as string | null }

        // Step 1: Create job only (fast, returns jobId immediately)
        const createRes = await fetch("/api/ig-create-job", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(options)
        })
        if (!createRes.ok) {
            const err = await createRes.json().catch(() => ({}))
            return { success: false, error: err.error || "Nepodařilo se vytvořit úlohu" }
        }
        const { jobId } = await createRes.json()
        jobIdRef.current = jobId

        // Step 2: Kick off actual generation (fire — we'll poll for result)
        const fetchPromise = fetch("/api/ig-run-job", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId })
        })

        // Step 3: Poll job status in parallel — we have jobId from step 1
        const pollLoop = async () => {
            await new Promise(r => setTimeout(r, 2000))

            while (pollingActive && jobIdRef.current) {
                try {
                    const statusRes = await fetch(`/api/ig-job-status?id=${jobIdRef.current}`)
                    const status = await statusRes.json()

                    if (status.agentMessage && status.status !== "done" && status.status !== "failed") {
                        setAgentStatus({
                            stage: status.status,
                            progress: status.progress || 0,
                            message: status.agentMessage,
                        })
                    }
                } catch { /* ignore polling errors */ }

                await new Promise(r => setTimeout(r, 2000))
            }
        }
        pollLoop() // fire-and-forget

        try {
            const result = await fetchPromise
            pollingActive = false
            setAgentStatus(null)

            const data = await result.json()
            if (!result.ok || !data.success) {
                return { success: false, error: data.error || "Generování selhalo" }
            }
            return data

        } catch (err: any) {
            pollingActive = false
            setAgentStatus(null)
            return { success: false, error: err.message || "Chyba sítě" }
        }
    }

    const handleGenerate = async () => {
        setGenerating(true)
        setResult(null)
        setBatchResult(null)
        setBatchProgress(null)
        setCreditError(null)

        const maxClientRetries = 1

        try {
            // Credit check before generation
            const creditCheck = await canGenerate(projectId, batchMode ? (contentPlan.length || batchCount) : 1)
            if (!creditCheck.ok) {
                setCreditError(creditCheck.error || "Nedostatek kreditů")
                setGenerating(false)
                showPlanUnlockModal()
                return
            }

            if (batchMode) {
                // === SEQUENTIAL CAMPAIGN using approved plan ===
                const planToExecute = contentPlan.length > 0 ? contentPlan : []
                const totalPosts = planToExecute.length || batchCount
                let successes = 0
                let failures = 0
                const campaignPosts: { hook: string; topic: string }[] = []
                setBatchProgress({ current: 0, total: totalPosts, successes: 0, failures: 0 })

                for (let i = 0; i < totalPosts; i++) {
                    setBatchProgress({ current: i + 1, total: totalPosts, successes, failures })

                    const planItem = planToExecute[i]
                    const campaignContext = campaignPosts.length > 0
                        ? { postNumber: i + 1, totalPosts, previousPosts: campaignPosts }
                        : undefined

                    // Use plan item's type and topic if available
                    const postType = planItem?.postType || undefined
                    const postTopic = planItem?.topic ? `${planItem.topic}: ${planItem.hookPreview}` : (topic || undefined)

                    try {
                        let res = await triggerPostGeneration({
                            configName: projectId,
                            type: postType,
                            topic: postTopic,
                            category: category !== "auto" ? category : undefined,
                                                        aspectRatio: aspectRatio || undefined,
                            medium: medium || undefined,
                            productId: planItem?.productId || undefined,
                            campaignContext,
                        })
                        // Auto-retry once on failure
                        if (!res.success && maxClientRetries > 0) {
                            await new Promise(r => setTimeout(r, 3000))
                            res = await triggerPostGeneration({
                                configName: projectId,
                                type: postType,
                                topic: postTopic,
                                category: category !== "auto" ? category : undefined,
                                                                aspectRatio: aspectRatio || undefined,
                                medium: medium || undefined,
                                productId: planItem?.productId || undefined,
                                campaignContext,
                            })
                        }
                        if (res.success) {
                            successes++
                            const hook = res.caption?.split("\n")?.[0] || ""
                            campaignPosts.push({ hook, topic: postTopic || "auto" })
                            setGenerationHistory(prev => [res, ...prev].slice(0, 10))
                        } else {
                            failures++
                        }
                    } catch {
                        failures++
                    }

                    setBatchProgress({ current: i + 1, total: totalPosts, successes, failures })

                    if (i < totalPosts - 1) {
                        await new Promise(r => setTimeout(r, 2000))
                    }
                }

                setBatchResult({
                    generated: successes,
                    errors: failures,
                    message: successes > 0
                        ? `Úspěšně vygenerováno ${successes} z ${totalPosts} postů`
                        : `Všech ${totalPosts} postů selhalo`,
                    success: successes > 0,
                } as any)
            } else {
                let finalImageUrl = undefined;
                if (customImageFile) {
                    const formData = new FormData()
                    formData.append("file", customImageFile)
                    const uploadRes = await uploadCustomImage(projectId, formData)
                    if (!uploadRes.success || !uploadRes.publicUrl) {
                        setResult({ success: false, error: uploadRes.error || "Při nahrávání obrázku došlo k chybě." })
                        setGenerating(false)
                        setStep(2)
                        return
                    }
                    finalImageUrl = uploadRes.publicUrl
                }

                let res = await triggerPostGeneration({
                    configName: projectId,
                    type: selectedType || undefined,
                    topic: topic || undefined,
                    category: category !== "auto" ? category : undefined,
                    aspectRatio: aspectRatio || undefined,
                    medium: medium || undefined,
                    customImageUrl: finalImageUrl,
                })
                // Auto-retry once on failure
                if (!res.success && maxClientRetries > 0) {
                    await new Promise(r => setTimeout(r, 3000))
                    res = await triggerPostGeneration({
                        configName: projectId,
                        type: selectedType || undefined,
                        topic: topic || undefined,
                        category: category !== "auto" ? category : undefined,
                        aspectRatio: aspectRatio || undefined,
                        medium: medium || undefined,
                        customImageUrl: finalImageUrl,
                    })
                }
                setResult(res)
                if (res.success) {
                    setGenerationHistory(prev => [res, ...prev].slice(0, 10))
                    trackEvent('post_generated', { mode: 'single', category: category || 'auto' })
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
        setStep(batchMode ? 4 : 3)
        setGenerating(false)
        // Refresh credit display in sidebar/dashboard
        refreshSubscription()
    }

    // Content Plan: generate plan preview
    const handleGeneratePlan = async () => {
        setPlanGenerating(true)
        const result = await generateContentPlan(
            projectId,
            batchCount,
            topic || undefined,
            category !== "auto" ? category : undefined
        )
        if (result.success && result.plan) {
            setContentPlan(result.plan)
            setStep(2)
        } else {
            alert(result.error || "Generování plánu selhalo")
        }
        setPlanGenerating(false)
    }

    // Content Plan: regenerate single item
    const handleRegenerateItem = async (itemId: string) => {
        setRegeneratingItem(itemId)
        const item = contentPlan.find(p => p.id === itemId)
        if (!item) return

        const existingHooks = contentPlan.map(p => p.hookPreview)
        const result = await regeneratePlanItem(projectId, item.postType, existingHooks, topic || undefined)

        if (result.success && result.item) {
            setContentPlan(prev => prev.map(p =>
                p.id === itemId
                    ? { ...p, hookPreview: result.item!.hookPreview, angle: result.item!.angle, topic: result.item!.topic }
                    : p
            ))
        }
        setRegeneratingItem(null)
    }

    // Content Plan: remove item
    const handleRemovePlanItem = (itemId: string) => {
        setContentPlan(prev => prev.filter(p => p.id !== itemId).map((p, i) => ({ ...p, day: i + 1 })))
    }

    // Content Plan: update item topic inline
    const handleUpdatePlanTopic = (itemId: string, newTopic: string) => {
        setContentPlan(prev => prev.map(p => p.id === itemId ? { ...p, topic: newTopic } : p))
    }

    // Content Plan: add a blank post slot
    const handleAddPlanItem = () => {
        const lastItem = contentPlan[contentPlan.length - 1]
        const newItem: ContentPlanItem = {
            id: `plan_${Date.now()}_add`,
            postType: lastItem?.postType || "auto",
            postTypeEmoji: lastItem?.postTypeEmoji || "📝",
            postTypeLabel: lastItem?.postTypeLabel || "Auto",
            pillar: lastItem?.pillar || "content",
            pillarEmoji: lastItem?.pillarEmoji || "📋",
            hookPreview: "Nový post — klikni 🔄 pro vygenerování konceptu",
            angle: "",
            topic: topic || "volné téma",
            day: contentPlan.length + 1,
            week: contentPlan.length >= 14 ? Math.floor(contentPlan.length / 7) + 1 : undefined,
        }
        setContentPlan(prev => [...prev, newItem])
    }

    // Content Plan: start generation from approved plan
    const handleApproveAndGenerate = () => {
        setBatchCount(contentPlan.length)
        setStep(3)
        setPendingGenerate(true)
    }

    // Trigger generation when pendingGenerate flag is set (after step render)
    useEffect(() => {
        if (pendingGenerate && step === 3 && !generating) {
            setPendingGenerate(false)
            handleGenerate()
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingGenerate, step])

    const { copiedField, copyToClipboard } = useCopyToClipboard()

    // Simplified steps: Single = 2 steps, Plan = 3 steps
    const steps = batchMode
        ? [
            { id: 1, label: "Zadání" },
            { id: 2, label: "Plán" },
            { id: 3, label: "Výsledek" },
        ]
        : [
            { id: 1, label: "Zadání" },
            { id: 2, label: "Výsledek" },
        ]

    const resultStep = batchMode ? 3 : 2
    const hasResult = result || batchResult

    return (
        <div className="max-w-4xl mx-auto space-y-8 mt-2 pb-24">
            {/* Mode toggle + Step dots */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex bg-[#0a0a0a] p-1 rounded-sm border border-white/10">
                    <button
                        onClick={() => { setBatchMode(false); setStep(1) }}
                        className={`px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm transition-all ${!batchMode
                            ? "bg-white/10 text-white border border-white/20"
                            : "text-white/40 hover:text-white"
                        }`}
                    >
                        ✨ Jeden příspěvek
                    </button>
                    <button
                        onClick={() => { setBatchMode(true); setStep(1) }}
                        className={`px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm transition-all ${batchMode
                            ? "bg-aisummit-cinnabar/20 text-aisummit-cinnabar border border-aisummit-cinnabar/30"
                            : "text-white/40 hover:text-white"
                        }`}
                    >
                        📅 Obsahový plán
                    </button>
                </div>
                <div className="flex items-center gap-2">
                    {steps.map((s, i) => (
                        <button
                            key={s.id}
                            onClick={() => {
                                if (generating) return
                                if (s.id === 2 && batchMode && contentPlan.length === 0) return
                                if (s.id === resultStep && !hasResult && !generating) return
                                setStep(s.id)
                            }}
                            disabled={generating && s.id !== step}
                            className="flex items-center gap-2"
                        >
                            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black transition-all ${
                                step === s.id ? "bg-white text-black"
                                : step > s.id ? "bg-white/20 text-white/60"
                                : "bg-white/5 text-white/20"
                            }`}>{s.id}</span>
                            <span className={`text-[10px] font-bold uppercase tracking-widest hidden sm:inline ${
                                step === s.id ? "text-white" : "text-white/30"
                            }`}>{s.label}</span>
                            {i < steps.length - 1 && <span className="w-6 h-px bg-white/10 mx-1" />}
                        </button>
                    ))}
                </div>
            </div>

            {/* Credit error */}
            {creditError && (
                <div className="bg-aisummit-cinnabar/10 border border-aisummit-cinnabar/20 rounded-sm p-4 flex items-center gap-3">
                    <span className="text-lg">⚠️</span>
                    <p className="text-sm text-aisummit-cinnabar font-bold">{creditError}</p>
                </div>
            )}

            <AnimatePresence mode="wait">
                {/* ═══ STEP 1: Unified Brief ═══ */}
                {step === 1 && (
                    <motion.div
                        key="brief"
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -15 }}
                        className="bg-[#0f0f0f] rounded-sm p-8 sm:p-10 border border-white/10"
                    >
                        {!batchMode ? (
                            /* ── SINGLE POST ── */
                            <div className="max-w-2xl mx-auto space-y-8">
                                <div className="text-center">
                                    <h2 className="text-3xl font-black tracking-tighter uppercase text-white/90 mb-2">Nový příspěvek</h2>
                                    <p className="text-white/40 text-sm">Řekněte AI o čem má psát, nebo nechte vše na automatice.</p>
                                </div>

                                {/* Topic */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="text-[10px] text-white/50 uppercase tracking-widest font-bold">O čem? (volitelné)</label>
                                        {(savedIdeas.length > 0 || approvedReviews.length > 0) && (
                                            <button type="button" onClick={() => setShowIdeaPicker(!showIdeaPicker)}
                                                className="text-[9px] font-bold uppercase tracking-widest text-emerald-400 hover:text-emerald-300 transition-colors">
                                                {showIdeaPicker ? "✕ Skrýt" : "💡 Vybrat z nápadů"}
                                            </button>
                                        )}
                                    </div>
                                    {showIdeaPicker && (
                                        <div className="mb-3 bg-[#050505] border border-white/10 rounded-sm p-3 max-h-52 overflow-y-auto space-y-1">
                                            {savedIdeas.length > 0 && (
                                                <>
                                                    <span className="text-[9px] font-bold uppercase tracking-widest text-white/30 block mb-1">💡 Nápady</span>
                                                    {savedIdeas.slice(0, 10).map((idea: any) => (
                                                        <button key={idea.id} type="button"
                                                            onClick={() => { setTopic(`${idea.title}: ${idea.content}`); setShowIdeaPicker(false) }}
                                                            className="w-full text-left px-3 py-2 rounded-sm text-xs text-white/70 hover:bg-white/10 hover:text-white transition-colors truncate">
                                                            <span className="text-[9px] px-1.5 py-0.5 bg-white/5 border border-white/10 rounded-sm text-white/40 mr-2">{idea.category}</span>
                                                            {idea.title}
                                                        </button>
                                                    ))}
                                                </>
                                            )}
                                            {approvedReviews.length > 0 && (
                                                <>
                                                    <span className="text-[9px] font-bold uppercase tracking-widest text-white/30 block mb-1 mt-2">⭐ Recenze</span>
                                                    {approvedReviews.slice(0, 5).map((review: any) => (
                                                        <button key={review.id} type="button"
                                                            onClick={() => {
                                                                setTopic(`Recenze zákazníka: "${review.quote}" — ${review.customer_initials || "Anonym"}`)
                                                                const reviewType = postTypes.find(pt => pt.name === "recenze" || pt.name === "review" || pt.name === "testimonial")
                                                                if (reviewType) setSelectedType(reviewType.name)
                                                                setShowIdeaPicker(false)
                                                            }}
                                                            className="w-full text-left px-3 py-2 rounded-sm text-xs text-white/70 hover:bg-white/10 hover:text-white transition-colors">
                                                            <span className="text-[9px] px-1.5 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded-sm text-amber-400 mr-2">{"⭐".repeat(review.rating || 5)}</span>
                                                            &ldquo;{review.quote?.substring(0, 80)}{review.quote?.length > 80 ? "..." : ""}&rdquo;
                                                        </button>
                                                    ))}
                                                </>
                                            )}
                                        </div>
                                    )}
                                    <textarea
                                        placeholder="Např. Jarní slevy, Nová kolekce, Péče o pleť... nebo nechte prázdné a AI vybere samo."
                                        value={topic} onChange={(e) => setTopic(e.target.value)} rows={2}
                                        className="w-full px-5 py-4 bg-[#050505] border border-white/10 rounded-sm text-white placeholder:text-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all shadow-sm resize-none"
                                    />
                                </div>

                                {/* Category pills */}
                                <div>
                                    <label className="text-[10px] text-white/40 mb-3 block uppercase tracking-widest font-bold">Zaměření (volitelné)</label>
                                    <div className="flex flex-wrap gap-2">
                                        <button onClick={() => setCategory("auto")}
                                            className={`px-4 py-2.5 rounded-sm border text-xs font-bold transition-all flex items-center gap-2 ${category === "auto" || category === ""
                                                ? "border-white/30 bg-white/10 text-white" : "border-white/5 bg-[#0a0a0a] text-white/40 hover:border-white/20 hover:text-white/70"}`}>
                                            <span className="grayscale opacity-80">🤖</span> Automaticky
                                        </button>
                                        {categories.map(cat => (
                                            <button key={cat.id} onClick={() => setCategory(cat.id)}
                                                className={`px-4 py-2.5 rounded-sm border text-xs font-bold transition-all flex items-center gap-2 ${category === cat.id
                                                    ? "border-aisummit-cinnabar/50 bg-aisummit-cinnabar/10 text-aisummit-cinnabar" : "border-white/5 bg-[#0a0a0a] text-white/40 hover:border-white/20 hover:text-white/70"}`}>
                                                {cat.emoji} {cat.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Format selector */}
                                <div>
                                    <label className="text-[10px] text-white/40 mb-2 block uppercase tracking-widest font-bold">Formát (volitelné)</label>
                                    <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)}
                                        className="w-full px-5 py-3.5 bg-[#050505] border border-white/10 rounded-sm text-white text-sm focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all">
                                        <option value="">🎲 AI vybere nejlepší formát</option>
                                        {postTypes.filter(pt => pt.is_active).filter(pt => category === "auto" || category === "" || pt.pillarId === category)
                                            .map(pt => (<option key={pt.id} value={pt.name}>{pt.display_name}</option>))}
                                    </select>
                                </div>

                                {/* Advanced */}
                                <div>
                                    <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}
                                        className="text-[10px] text-white/20 hover:text-white/40 font-bold uppercase tracking-widest transition-colors flex items-center gap-2 mb-3">
                                        <span>{showAdvanced ? "▼" : "▶"}</span> Pokročilé
                                    </button>
                                    {showAdvanced && (
                                        <div className="space-y-5 pl-4 border-l border-white/10">
                                            <div>
                                                <label className="text-[10px] text-white/50 mb-2 block uppercase tracking-widest font-bold">📐 Poměr stran</label>
                                                <div className="grid grid-cols-4 gap-2">
                                                    {[{ value: "", label: "Auto" }, { value: "1:1", label: "1:1" }, { value: "4:5", label: "4:5" }, { value: "3:4", label: "3:4" }].map(opt => (
                                                        <button key={opt.value} onClick={() => setAspectRatio(opt.value)}
                                                            className={`py-2.5 rounded-sm text-center transition-all border text-xs font-bold ${aspectRatio === opt.value
                                                                ? "bg-white/10 border-white/30 text-white" : "bg-[#050505] border-white/10 text-white/40 hover:text-white"}`}>
                                                            {opt.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-[10px] text-white/50 mb-2 block uppercase tracking-widest font-bold">🎞️ Typ</label>
                                                <div className="grid grid-cols-4 gap-2">
                                                    {[{ value: "", label: "Auto", emoji: "🎲" }, { value: "image", label: "Obrázek", emoji: "🖼️" }, { value: "carousel", label: "Carousel", emoji: "📸" }, { value: "reel", label: "Reel", emoji: "🎬" }].map(opt => (
                                                        <button key={opt.value} onClick={() => setMedium(opt.value)}
                                                            className={`py-2.5 rounded-sm text-center transition-all border text-xs font-bold ${medium === opt.value
                                                                ? "bg-white/10 border-white/30 text-white" : "bg-[#050505] border-white/10 text-white/40 hover:text-white"}`}>
                                                            {opt.emoji} {opt.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-[10px] text-white/50 mb-2 block uppercase tracking-widest font-bold">Vlastní obrázek</label>
                                                <input type="file" accept="image/png, image/jpeg, image/webp"
                                                    onChange={(e) => { const file = e.target.files?.[0]; if (file) setCustomImageFile(file); else setCustomImageFile(null) }}
                                                    className="w-full px-4 py-3 bg-[#050505] border border-white/10 rounded-sm text-white/70 text-xs focus:outline-none file:mr-3 file:py-1.5 file:px-3 file:rounded-sm file:border-0 file:text-xs file:font-semibold file:bg-white/10 file:text-white cursor-pointer"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Generate CTA */}
                                <button onClick={handleGenerate} disabled={generating}
                                    className={`w-full py-5 rounded-sm transition-all flex items-center justify-center gap-3 text-sm font-black tracking-wider uppercase ${generating
                                        ? "bg-white/5 text-white/30 cursor-wait border border-white/10"
                                        : "bg-aisummit-cinnabar text-white shadow-[0_0_20px_rgba(229,83,63,0.3)] hover:shadow-[0_0_30px_rgba(229,83,63,0.5)] hover:scale-[1.01] active:scale-[0.99]"}`}>
                                    {generating ? (<><span className="w-4 h-4 border-2 border-white/30 border-t-transparent rounded-full animate-spin" /> Pracuji na tom...</>)
                                        : (<>✨ Vytvořit příspěvek</>)}
                                </button>
                            </div>
                        ) : (
                            /* ── CONTENT PLAN ── */
                            <div className="max-w-2xl mx-auto space-y-8">
                                <div className="text-center">
                                    <h2 className="text-3xl font-black tracking-tighter uppercase text-white/90 mb-2">Obsahový plán</h2>
                                    <p className="text-white/40 text-sm">AI navrhne sérii příspěvků. Vy schválíte a spustíte.</p>
                                </div>

                                {/* Count */}
                                <div>
                                    <label className="text-[10px] text-white/40 mb-3 block uppercase tracking-widest font-bold">Kolik příspěvků?</label>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                        {[{ count: 3, label: "3", desc: "Zkouška" }, { count: 7, label: "7", desc: "Týden" }, { count: 14, label: "14", desc: "Dva týdny" }, { count: 30, label: "30", desc: "Měsíc" }].map(opt => (
                                            <button key={opt.count} onClick={() => setBatchCount(opt.count)}
                                                className={`py-4 rounded-sm transition-all border text-center ${batchCount === opt.count
                                                    ? "bg-aisummit-cinnabar/20 border-aisummit-cinnabar/30 text-aisummit-cinnabar" : "bg-[#050505] border-white/10 text-white/40 hover:text-white hover:border-white/30"}`}>
                                                <span className="text-2xl font-black block">{opt.label}</span>
                                                <span className="text-[9px] font-bold uppercase tracking-widest opacity-60">{opt.desc}</span>
                                            </button>
                                        ))}
                                    </div>
                                    <p className="text-[10px] text-white/20 mt-2 text-right font-bold uppercase tracking-widest">Spotřeba: {batchCount} kreditů</p>
                                </div>

                                {/* Topic */}
                                <div>
                                    <label className="text-[10px] text-white/50 mb-2 block uppercase tracking-widest font-bold">Téma kampaně (volitelné)</label>
                                    <textarea placeholder="Např. Letní kolekce, Vánoční kampaň... nebo nechte prázdné."
                                        value={topic} onChange={(e) => setTopic(e.target.value)} rows={2}
                                        className="w-full px-5 py-4 bg-[#050505] border border-white/10 rounded-sm text-white placeholder:text-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all shadow-sm resize-none"
                                    />
                                </div>

                                {/* Generate Plan CTA */}
                                <button onClick={handleGeneratePlan} disabled={planGenerating}
                                    className={`w-full py-5 rounded-sm transition-all flex items-center justify-center gap-3 text-sm font-black tracking-wider uppercase ${planGenerating
                                        ? "bg-white/5 text-white/30 cursor-wait border border-white/10"
                                        : "bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)] hover:scale-[1.01] active:scale-[0.99]"}`}>
                                    {planGenerating ? (<><span className="w-4 h-4 border-2 border-white/30 border-t-transparent rounded-full animate-spin" /> AI plánuje...</>)
                                        : (<>📋 Vytvořit plán</>)}
                                </button>
                            </div>
                        )}
                    </motion.div>
                )}



                {/* ═══ STEP 2: Content Plan Preview (batch mode only) ═══ */}
                {step === 2 && batchMode && (
                    <motion.div
                        key="step3-plan"
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -15 }}
                        className="bg-[#0f0f0f] rounded-sm p-8 sm:p-12 border border-white/10"
                    >
                        <div className="text-center mb-8">
                            <h2 className="text-4xl font-black uppercase tracking-tighter text-white/90 mb-3">Plán obsahu</h2>
                            <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest">
                                AI navrhuje strategický mix {contentPlan.length} postů. Upravte a schvalte.
                            </p>
                        </div>

                        {/* Pillar ratio bar */}
                        {contentPlan.length > 0 && (() => {
                            const pillarCounts: Record<string, { count: number; emoji: string }> = {}
                            contentPlan.forEach(p => {
                                if (!pillarCounts[p.pillar]) pillarCounts[p.pillar] = { count: 0, emoji: p.pillarEmoji }
                                pillarCounts[p.pillar].count++
                            })
                            return (
                                <div className="mb-8 space-y-2">
                                    <div className="flex h-2.5 rounded-sm overflow-hidden border border-white/10">
                                        {Object.entries(pillarCounts).map(([key, { count }], idx) => (
                                            <div key={key} className="h-full transition-all duration-500"
                                                style={{
                                                    width: `${(count / contentPlan.length) * 100}%`,
                                                    backgroundColor: `hsl(${idx * 70}, 50%, 45%)`
                                                }}
                                                title={`${key}: ${count} postů`}
                                            />
                                        ))}
                                    </div>
                                    <div className="flex flex-wrap gap-3 text-[8px] text-white/30 font-bold uppercase tracking-widest">
                                        {Object.entries(pillarCounts).map(([key, { count, emoji }], idx) => (
                                            <span key={key} className="flex items-center gap-1">
                                                <span className="w-2 h-2 rounded-sm inline-block" style={{ backgroundColor: `hsl(${idx * 70}, 50%, 45%)` }} />
                                                {emoji} {key}: {count} ({Math.round(count / contentPlan.length * 100)}%)
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )
                        })()}

                        {/* Plan items */}
                        <div className="space-y-3 max-w-2xl mx-auto">
                            {(() => {
                                let currentWeek = 0
                                return contentPlan.map((item, idx) => {
                                    const showWeekHeader = item.week && item.week !== currentWeek
                                    if (item.week) currentWeek = item.week

                                    return (
                                        <div key={item.id}>
                                            {showWeekHeader && (
                                                <div className="flex items-center gap-3 pt-6 pb-2">
                                                    <div className="h-px flex-1 bg-white/10" />
                                                    <span className="text-[9px] font-black uppercase tracking-widest text-white/30">Týden {item.week}</span>
                                                    <div className="h-px flex-1 bg-white/10" />
                                                </div>
                                            )}
                                            <div className={`bg-[#0a0a0a] border rounded-sm p-4 transition-all hover:border-white/20 ${
                                                regeneratingItem === item.id ? "border-amber-500/30 animate-pulse" : "border-white/10"
                                            }`}>
                                                <div className="flex items-start gap-3">
                                                    {/* Number + Type */}
                                                    <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center bg-white/5 border border-white/10 rounded-sm">
                                                        <span className="text-lg">{item.postTypeEmoji}</span>
                                                    </div>

                                                    {/* Content */}
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <span className="text-[8px] text-white/30 font-bold uppercase tracking-widest">#{idx + 1}</span>
                                                            <span className="text-[8px] px-1.5 py-0.5 bg-white/5 border border-white/10 rounded-sm text-white/40 font-bold uppercase tracking-wider">{item.postTypeLabel}</span>
                                                            <span className="text-[8px] text-white/20">{item.pillarEmoji} {item.pillar}</span>
                                                        </div>

                                                        {/* Hook preview */}
                                                        <p className="text-white/80 text-sm font-bold leading-snug mb-1">
                                                            &ldquo;{item.hookPreview}&rdquo;
                                                        </p>

                                                        {/* Angle */}
                                                        <p className="text-[10px] text-white/40 leading-relaxed">{item.angle}</p>

                                                        {/* Editable topic */}
                                                        {editingPlanItem === item.id ? (
                                                            <div className="mt-2 flex gap-2">
                                                                <input
                                                                    autoFocus
                                                                    defaultValue={item.topic}
                                                                    onBlur={(e) => {
                                                                        handleUpdatePlanTopic(item.id, e.target.value)
                                                                        setEditingPlanItem(null)
                                                                    }}
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === "Enter") {
                                                                            handleUpdatePlanTopic(item.id, e.currentTarget.value)
                                                                            setEditingPlanItem(null)
                                                                        }
                                                                    }}
                                                                    className="flex-1 px-3 py-1.5 bg-[#050505] border border-white/20 rounded-sm text-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                                                                />
                                                            </div>
                                                        ) : (
                                                            <div className="mt-1 flex items-center gap-1.5">
                                                                <span className="text-[9px] text-emerald-400/60 font-mono">📌 {item.topic}</span>
                                                            </div>
                                                        )}

                                                        {/* Product @ mention */}
                                                        <div className="mt-2 relative">
                                                            {item.productId ? (
                                                                <div className="inline-flex items-center gap-2 px-2.5 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-sm group">
                                                                    {item.productImage && (
                                                                        <img src={item.productImage} alt="" className="w-5 h-5 rounded-sm object-cover" />
                                                                    )}
                                                                    <span className="text-[9px] text-blue-400 font-bold">@{item.productName}</span>
                                                                    <button
                                                                        onClick={() => handleSetProduct(item.id, null)}
                                                                        className="text-[8px] text-blue-400/40 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                                                                    >
                                                                        ✕
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <button
                                                                    onClick={() => {
                                                                        setProductPickerItem(productPickerItem === item.id ? null : item.id)
                                                                        setProductSearch("")
                                                                    }}
                                                                    className="inline-flex items-center gap-1 px-2 py-1 text-[9px] text-white/25 hover:text-white/50 font-bold uppercase tracking-widest transition-colors"
                                                                    title="Přiřadit produkt"
                                                                >
                                                                    <span>@</span> Produkt
                                                                </button>
                                                            )}

                                                            {/* Product picker dropdown */}
                                                            {productPickerItem === item.id && catalogProducts.length > 0 && (
                                                                <div ref={productPickerRef} className="absolute left-0 top-full mt-1 z-50 w-72 bg-[#0a0a0a] border border-white/15 rounded-sm shadow-2xl overflow-hidden">
                                                                    <div className="p-2 border-b border-white/10">
                                                                        <input
                                                                            autoFocus
                                                                            value={productSearch}
                                                                            onChange={(e) => setProductSearch(e.target.value)}
                                                                            placeholder="Hledat produkt..."
                                                                            className="w-full px-3 py-2 bg-[#050505] border border-white/10 rounded-sm text-white text-xs focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                                                                        />
                                                                    </div>
                                                                    <div className="max-h-48 overflow-y-auto">
                                                                        {catalogProducts
                                                                            .filter(p => !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase()))
                                                                            .map(p => (
                                                                                <button
                                                                                    key={p.id}
                                                                                    onClick={() => handleSetProduct(item.id, p)}
                                                                                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 transition-colors text-left"
                                                                                >
                                                                                    <div className="w-8 h-8 flex-shrink-0 bg-[#050505] border border-white/10 rounded-sm overflow-hidden flex items-center justify-center">
                                                                                        {p.image_urls?.[0] ? (
                                                                                            <img src={p.image_urls[0]} alt="" className="w-full h-full object-cover" />
                                                                                        ) : (
                                                                                            <span className="text-sm opacity-30">📦</span>
                                                                                        )}
                                                                                    </div>
                                                                                    <div className="flex-1 min-w-0">
                                                                                        <p className="text-white/80 text-xs font-bold truncate">{p.name}</p>
                                                                                        <p className="text-[8px] text-white/30">
                                                                                            {p.type && <span>{p.type}</span>}
                                                                                            {p.price && <span> · {p.price}</span>}
                                                                                        </p>
                                                                                    </div>
                                                                                </button>
                                                                            ))
                                                                        }
                                                                        {catalogProducts.filter(p => !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase())).length === 0 && (
                                                                            <p className="px-3 py-4 text-[10px] text-white/30 text-center">Žádné produkty nenalezeny</p>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Actions */}
                                                    <div className="flex-shrink-0 flex items-center gap-1">
                                                        <button
                                                            onClick={() => setEditingPlanItem(editingPlanItem === item.id ? null : item.id)}
                                                            className="p-1.5 text-white/20 hover:text-white/60 transition-colors"
                                                            title="Upravit téma"
                                                        >
                                                            <span className="text-[10px]">✏️</span>
                                                        </button>
                                                        <button
                                                            onClick={() => handleRegenerateItem(item.id)}
                                                            disabled={regeneratingItem === item.id}
                                                            className="p-1.5 text-white/20 hover:text-amber-400/80 transition-colors disabled:opacity-30"
                                                            title="Jiný koncept"
                                                        >
                                                            <span className="text-[10px]">🔄</span>
                                                        </button>
                                                        <button
                                                            onClick={() => handleRemovePlanItem(item.id)}
                                                            className="p-1.5 text-white/20 hover:text-red-400/80 transition-colors"
                                                            title="Odebrat"
                                                        >
                                                            <span className="text-[10px]">✕</span>
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })
                            })()}
                        </div>

                        {/* Add post button */}
                        <div className="flex justify-center mt-4">
                            <button
                                onClick={handleAddPlanItem}
                                className="flex items-center gap-2 px-5 py-2.5 bg-[#0a0a0a] border border-dashed border-white/15 rounded-sm text-[10px] font-bold uppercase tracking-widest text-white/30 hover:text-white/60 hover:border-white/30 transition-all"
                            >
                                <span>+</span> Přidat post
                            </button>
                        </div>

                        {/* Bottom bar */}
                        <div className="mt-8 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4">
                            <div className="flex items-center gap-4 text-[10px] text-white/30 font-bold uppercase tracking-widest">
                                <span>{contentPlan.length} postů</span>
                                <span>·</span>
                                <span>{contentPlan.length} kreditů</span>
                            </div>

                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setStep(1)}
                                    className="px-6 py-3 rounded-sm text-[10px] font-bold uppercase tracking-widest text-white/40 bg-white/5 border border-white/10 hover:text-white hover:bg-white/10 transition-all"
                                >
                                    ← Zpět na brief
                                </button>
                                <button
                                    onClick={handleApproveAndGenerate}
                                    disabled={contentPlan.length === 0 || generating}
                                    className="px-8 py-3 rounded-sm text-[10px] font-black uppercase tracking-widest bg-aisummit-cinnabar text-white shadow-[0_0_15px_rgba(229,83,63,0.3)] hover:shadow-[0_0_20px_rgba(229,83,63,0.6)] transition-all disabled:opacity-50"
                                >
                                    ✅ Schválit & generovat ({contentPlan.length})
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}

                {/* ═══ STEP 3 (single) / STEP 4 (batch): Results ═══ */}
                {step === resultStep && (
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
                                {agentStatus && !batchProgress && (
                                    <div className="relative z-10 mb-4 w-full max-w-xs">
                                        <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden mb-3">
                                            <div
                                                className="h-full bg-gradient-to-r from-aisummit-cinnabar to-orange-400 rounded-full transition-all duration-700 ease-out"
                                                style={{ width: `${agentStatus.progress}%` }}
                                            />
                                        </div>
                                        <p className="text-[11px] text-white/70 font-bold tracking-wide text-center">
                                            {agentStatus.message}
                                        </p>
                                    </div>
                                )}
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
                                        <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest h-6 flex items-center">Generuji obrázek...</p>
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

                                        {/* Action buttons */}
                                        <div className="flex items-center justify-center gap-3 pt-6 mt-6 border-t border-white/10">
                                            <button
                                                onClick={() => setActiveSection("posts")}
                                                className="px-6 py-3 rounded-sm text-[10px] font-bold uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all"
                                            >
                                                📋 Otevřít v Příspěvcích
                                            </button>
                                            <button
                                                onClick={() => { setResult(null); setStep(1) }}
                                                className="px-6 py-3 rounded-sm text-[10px] font-bold uppercase tracking-widest bg-white/5 text-white/60 border border-white/10 hover:text-white hover:bg-white/10 transition-all"
                                            >
                                                ✨ Generovat další
                                            </button>
                                        </div>
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
                                <div className="flex items-center justify-center gap-3 mt-8">
                                    <button
                                        onClick={() => setActiveSection("posts")}
                                        className="px-6 py-3 rounded-sm text-[10px] font-bold uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all"
                                    >
                                        📋 Otevřít v Příspěvcích
                                    </button>
                                    <button
                                        onClick={() => { setStep(1); setContentPlan([]) }}
                                        className="px-6 py-3 rounded-sm text-[10px] font-bold uppercase tracking-widest bg-white/5 text-white/60 border border-white/10 hover:text-white hover:bg-white/10 transition-all"
                                    >
                                        ✨ Vytvořit další
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="text-center text-white/40">
                                <p className="text-5xl mb-4 opacity-30 grayscale">✨</p>
                                <p className="text-xl font-black uppercase tracking-tighter text-white/50 mb-2">Čekám na zadání</p>
                                <p className="font-bold uppercase tracking-widest text-[10px]">Vraťte se na krok Brief a spusťte generování.</p>
                                <button onClick={() => setStep(1)} className="mt-6 px-6 py-2 rounded-sm text-[10px] font-bold tracking-widest uppercase bg-white/5 text-white/50 border border-white/10 hover:text-white hover:bg-white/10 transition-colors">Zpět na Zadání</button>
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
