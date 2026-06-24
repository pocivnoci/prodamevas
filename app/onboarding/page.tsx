'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { analyzeWebsite, generateQuestions, generateConfigPreview, refineConfigSection, saveReviewedConfig, buildManualAnalysis } from './actions'
import type { WebsiteAnalysis, OnboardingQuestion, ReviewSection } from './actions'
import type { ClientConfig } from '@/instagram/configs/types'
import { trackEvent } from '@/lib/analytics'

type Step = 'choose' | 'input' | 'manual' | 'analyzing' | 'questions' | 'building' | 'review' | 'saving' | 'generating' | 'done'
type Mode = 'website' | 'manual' | null

type SectionStatus = 'pending' | 'approved' | 'rejected' | 'refining'

export default function OnboardingPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center"><div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" /></div>}>
            <OnboardingContent />
        </Suspense>
    )
}

function OnboardingContent() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const reonboardSlug = searchParams.get('reonboard')

    const [step, setStep] = useState<Step>(reonboardSlug ? 'input' : 'choose')
    const [mode, setMode] = useState<Mode>(reonboardSlug ? 'website' : null)
    const [url, setUrl] = useState('')
    const [igHandle, setIgHandle] = useState('')
    const [error, setError] = useState<string | null>(null)

    // Manual fields
    const [businessName, setBusinessName] = useState('')
    const [category, setCategory] = useState('')
    const [description, setDescription] = useState('')
    const [products, setProducts] = useState('')
    const [tone, setTone] = useState('')

    // Analysis data
    const [analysis, setAnalysis] = useState<WebsiteAnalysis | null>(null)
    const [questions, setQuestions] = useState<OnboardingQuestion[]>([])
    const [answers, setAnswers] = useState<Record<string, string | string[]>>({})

    // Review state
    const [configPreview, setConfigPreview] = useState<ClientConfig | null>(null)
    const [sectionStatuses, setSectionStatuses] = useState<Record<ReviewSection, SectionStatus>>({
        brand_voice: 'pending',
        pillars: 'pending',
        products: 'pending',
        visual: 'pending',
        hooks_cta: 'pending',
    })
    const [sectionFeedback, setSectionFeedback] = useState<Record<string, string>>({})
    const [refiningSection, setRefiningSection] = useState<ReviewSection | null>(null)
    const [refineCounts, setRefineCounts] = useState<Record<string, number>>({})

    // Generating state (post-save showcase generation)
    const [generatingProgress, setGeneratingProgress] = useState<{ phase: string; current: number; total: number }>({
        phase: 'plan', current: 0, total: 4,
    })

    // ─── Re-onboarding: load existing client data ────────────
    useEffect(() => {
        if (!reonboardSlug) return
        async function loadExisting() {
            try {
                const { getClientConfig } = await import('@/app/actions/config-actions')
                const config = await getClientConfig(reonboardSlug!)
                if (config?.website) setUrl(config.website)
                if (config?.instagramHandle) setIgHandle(config.instagramHandle)
            } catch { /* ignore */ }
        }
        loadExisting()
    }, [reonboardSlug])

    // ─── Step 1A: Submit URL & IG ────────────────────────────
    async function handleAnalyze(e: React.FormEvent) {
        e.preventDefault()
        if (!url.trim()) return
        setError(null)
        setStep('analyzing')
        try {
            const result = await analyzeWebsite(url.trim(), igHandle.trim())
            if (!result.success || !result.analysis) throw new Error(result.error || 'Analýza selhala')
            setAnalysis(result.analysis)
            const qResult = await generateQuestions(result.analysis)
            if (!qResult.success || !qResult.questions) throw new Error(qResult.error || 'Generování dotazníku selhalo')
            setQuestions(qResult.questions)
            setStep('questions')
        } catch (err) {
            setError((err as Error).message)
            setStep('input')
        }
    }

    // ─── Step 1B: Manual form submit ────────────────────────────
    async function handleManualSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!businessName.trim() || !category || !description.trim()) return
        setError(null)
        setStep('analyzing')
        try {
            const result = await buildManualAnalysis({
                businessName: businessName.trim(),
                category,
                description: description.trim(),
                products: products.trim(),
                tone: tone || 'přátelský',
                igHandle: igHandle.trim(),
            })
            if (!result.success || !result.analysis) throw new Error(result.error || 'Analýza selhala')
            setAnalysis(result.analysis)
            const qResult = await generateQuestions(result.analysis)
            if (!qResult.success || !qResult.questions) throw new Error(qResult.error || 'Generování dotazníku selhalo')
            setQuestions(qResult.questions)
            setStep('questions')
        } catch (err) {
            setError((err as Error).message)
            setStep('manual')
        }
    }

    // ─── Step 3 → 4: Submit Answers → Generate preview ────────
    async function handleSubmitAnswers(e: React.FormEvent) {
        e.preventDefault()
        if (!analysis) return

        setError(null)
        setStep('building')

        try {
            const result = await generateConfigPreview(analysis, answers, url.trim(), igHandle.trim())
            if (!result.success || !result.config) {
                throw new Error(result.error || 'Generování konfigurace selhalo')
            }
            setConfigPreview(result.config)
            // Reset review states
            setSectionStatuses({
                brand_voice: 'pending',
                pillars: 'pending',
                products: 'pending',
                visual: 'pending',
                hooks_cta: 'pending',
            })
            setSectionFeedback({})
            setRefineCounts({})
            setStep('review')
        } catch (err) {
            setError((err as Error).message)
            setStep('questions')
        }
    }

    // ─── Review: Approve / Reject section ──────────────────────
    function approveSection(section: ReviewSection) {
        setSectionStatuses(prev => ({ ...prev, [section]: 'approved' }))
        setSectionFeedback(prev => { const n = { ...prev }; delete n[section]; return n })
    }

    function rejectSection(section: ReviewSection) {
        setSectionStatuses(prev => ({ ...prev, [section]: 'rejected' }))
    }

    async function handleRefineSection(section: ReviewSection) {
        if (!configPreview || !analysis) return
        const feedback = sectionFeedback[section]
        if (!feedback?.trim()) return

        setRefiningSection(section)
        setSectionStatuses(prev => ({ ...prev, [section]: 'refining' }))

        try {
            const result = await refineConfigSection(configPreview, section, feedback, analysis)
            if (!result.success || !result.config) throw new Error(result.error)
            setConfigPreview(result.config)
            setSectionStatuses(prev => ({ ...prev, [section]: 'pending' }))
            setSectionFeedback(prev => { const n = { ...prev }; delete n[section]; return n })
            setRefineCounts(prev => ({ ...prev, [section]: (prev[section] || 0) + 1 }))
        } catch (err) {
            setError((err as Error).message)
            setSectionStatuses(prev => ({ ...prev, [section]: 'rejected' }))
        }
        setRefiningSection(null)
    }

    // ─── Review: Save approved config ──────────────────────────
    async function handleSaveConfig() {
        if (!configPreview || !analysis) return
        setError(null)
        setStep('saving')
        try {
            const result = await saveReviewedConfig(configPreview, analysis, reonboardSlug || undefined)
            if (!result.success) throw new Error(result.error)

            // Skip generating for re-onboarding (config update only)
            if (reonboardSlug) {
                setStep('done')
                trackEvent('onboarding_completed', { method: mode || 'unknown' })
                return
            }

            // New onboarding: generate showcase content
            const clientSlug = result.clientSlug || configPreview.id
            setStep('generating')

            // Phase 1: Generate 27 locked text concepts
            setGeneratingProgress({ phase: 'plan', current: 0, total: 4 })
            try {
                const { generateMonthlyPlan } = await import('@/app/actions/ig-generate-action')
                await generateMonthlyPlan({ configName: clientSlug, projectId: clientSlug })
            } catch (planErr) {
                console.warn('Plan generation failed (non-fatal):', planErr)
            }

            // Phase 2: Generate 3 full showcase posts (sequential, each ~30-60s, 90s timeout)
            for (let i = 0; i < 3; i++) {
                setGeneratingProgress({ phase: 'showcase', current: i + 1, total: 3 })
                try {
                    const { generateShowcasePost } = await import('@/app/actions/ig-generate-action')
                    const timeout = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Timeout: showcase post exceeded 90s')), 90_000)
                    )
                    await Promise.race([
                        generateShowcasePost({ configName: clientSlug }),
                        timeout,
                    ])
                } catch (showcaseErr) {
                    console.warn(`Showcase post ${i + 1} failed (non-fatal):`, showcaseErr)
                }
            }

            // Phase 3: generate a real, editable first content plan (insight-grounded from
            // the client's scraped IG) and hand it to the dashboard via localStorage, so the
            // user lands on a ready week in the Generate tab instead of a blank slate.
            setGeneratingProgress({ phase: 'firstplan', current: 1, total: 1 })
            try {
                const { generateContentPlan, getPlanCadence } = await import('@/app/actions/content-plan-actions')
                // One real week at the brand's actual cadence (seeded from their IG), not a flat 7.
                const weekCount = await getPlanCadence(clientSlug)
                const planRes = await generateContentPlan(clientSlug, weekCount)
                if (planRes.success && planRes.plan?.length) {
                    try { localStorage.setItem(`ig_draft_plan_${clientSlug}`, JSON.stringify(planRes.plan)) } catch { /* ignore */ }
                }
            } catch (planErr) {
                console.warn('First plan generation failed (non-fatal):', planErr)
            }

            setStep('done')
            trackEvent('onboarding_completed', { method: mode || 'unknown' })
        } catch (err) {
            setError((err as Error).message)
            setStep('review')
        }
    }

    // ─── Answer handlers ────────────────────────────────────────
    function setAnswer(id: string, value: string | string[]) {
        setAnswers(prev => ({ ...prev, [id]: value }))
    }

    function toggleMultiselect(id: string, option: string) {
        setAnswers(prev => {
            const current = (prev[id] as string[]) || []
            const updated = current.includes(option)
                ? current.filter(o => o !== option)
                : [...current, option]
            return { ...prev, [id]: updated }
        })
    }

    return (
        <div className="min-h-screen bg-[#0a0a0f] text-white">
            {/* Progress Bar */}
            <div className="fixed top-0 left-0 right-0 z-50">
                <div className="h-1 bg-white/5">
                    <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-blue-500 transition-all duration-700 ease-out"
                        style={{
                            width: (step === 'choose' || step === 'input' || step === 'manual') ? '0%'
                                : step === 'analyzing' ? '20%'
                                    : step === 'questions' ? '40%'
                                        : step === 'building' ? '60%'
                                            : step === 'review' ? '80%'
                                                : '100%'
                        }}
                    />
                </div>
            </div>

            <div className="max-w-2xl mx-auto px-4 py-16">
                {/* ══════════════════════════════════════════════ */}
                {/* STEP 0: Choose mode                          */}
                {/* ══════════════════════════════════════════════ */}
                {step === 'choose' && (
                    <div className="animate-fadeIn">
                        <div className="text-center mb-10">
                            <h1 className="text-3xl font-bold tracking-tight mb-3">Nastavíme tvůj Chrlit</h1>
                            <p className="text-gray-400 text-lg">Jak chceš začít?</p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <button
                                onClick={() => { setMode('website'); setStep('input'); trackEvent('onboarding_started', { method: 'website' }) }}
                                className="p-6 bg-white/5 border border-white/10 rounded-2xl text-left hover:border-emerald-500/40 transition-all cursor-pointer group"
                            >
                                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-xl mb-4 group-hover:scale-110 transition-transform">🌐</div>
                                <h3 className="font-bold text-white mb-1">Mám webovou stránku</h3>
                                <p className="text-sm text-gray-400">AI analyzuje tvůj web a nastaví vše automaticky.</p>
                            </button>
                            <button
                                onClick={() => { setMode('manual'); setStep('manual'); trackEvent('onboarding_started', { method: 'manual' }) }}
                                className="p-6 bg-white/5 border border-white/10 rounded-2xl text-left hover:border-blue-500/40 transition-all cursor-pointer group"
                            >
                                <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center text-xl mb-4 group-hover:scale-110 transition-transform">✏️</div>
                                <h3 className="font-bold text-white mb-1">Nemám web</h3>
                                <p className="text-sm text-gray-400">Vyplníš pár otázek a AI nastaví vše za tebe.</p>
                            </button>
                        </div>
                    </div>
                )}

                {/* ══════════════════════════════════════════════ */}
                {/* STEP 1A: Input URL & IG Handle               */}
                {/* ══════════════════════════════════════════════ */}
                {step === 'input' && (
                    <div className="animate-fadeIn">
                        <div className="text-center mb-10">
                            <h1 className="text-3xl font-bold tracking-tight mb-3">Zadej svůj web</h1>
                            <p className="text-gray-400 text-lg">AI analyzuje tvou značku a nastaví vše za tebe.</p>
                        </div>
                        {error && <ErrorBanner message={error} />}
                        <form onSubmit={handleAnalyze} className="space-y-5">
                            <div className="p-6 bg-white/5 border border-white/10 rounded-2xl space-y-5">
                                <div>
                                    <label htmlFor="url" className="block text-sm font-medium text-gray-300 mb-2">Webová stránka</label>
                                    <input id="url" type="text" value={url} onChange={e => setUrl(e.target.value)} required placeholder="https://tvujweb.cz" className="w-full px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/50 transition-all text-sm" />
                                </div>
                                <div>
                                    <label htmlFor="ig" className="block text-sm font-medium text-gray-300 mb-2">Instagram handle</label>
                                    <input id="ig" type="text" value={igHandle} onChange={e => setIgHandle(e.target.value)} placeholder="@tvujinstagram" className="w-full px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/50 transition-all text-sm" />
                                    <p className="mt-1.5 text-xs text-gray-500">Volitelné</p>
                                </div>
                            </div>
                            <div className="flex gap-3">
                                <button type="button" onClick={() => setStep('choose')} className="px-4 py-3.5 rounded-xl border border-white/10 text-sm text-gray-400 hover:text-white transition-all cursor-pointer">← Zpět</button>
                                <button type="submit" className="flex-1 relative group overflow-hidden rounded-xl bg-emerald-600 px-6 py-3.5 text-sm font-medium text-white shadow-[0_0_20px_rgba(16,185,129,0.2)] transition-all hover:bg-emerald-500 cursor-pointer">
                                    <span className="relative z-10 flex items-center justify-center gap-2">🔍 Analyzovat web<span className="transition-transform group-hover:translate-x-1">→</span></span>
                                </button>
                            </div>
                        </form>
                    </div>
                )}

                {/* ══════════════════════════════════════════════ */}
                {/* STEP 1B: Manual form (no website)             */}
                {/* ══════════════════════════════════════════════ */}
                {step === 'manual' && (
                    <div className="animate-fadeIn">
                        <div className="text-center mb-10">
                            <h1 className="text-3xl font-bold tracking-tight mb-3">Řekni nám o svém podnikání</h1>
                            <p className="text-gray-400 text-lg">Pár otázek a AI nastaví vše za tebe.</p>
                        </div>
                        {error && <ErrorBanner message={error} />}
                        <form onSubmit={handleManualSubmit} className="space-y-5">
                            <div className="p-6 bg-white/5 border border-white/10 rounded-2xl space-y-5">
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Název firmy / značky</label>
                                    <input type="text" value={businessName} onChange={e => setBusinessName(e.target.value)} required placeholder="např. Café Pohoda" className="w-full px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all text-sm" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Kategorie</label>
                                    <div className="grid grid-cols-3 gap-2">
                                        {[
                                            { id: 'kavarna', label: '☕ Kavárna' },
                                            { id: 'restaurace', label: '🍽️ Restaurace' },
                                            { id: 'salon', label: '💇 Salon' },
                                            { id: 'fitness', label: '💪 Fitness' },
                                            { id: 'eshop', label: '🛒 E-shop' },
                                            { id: 'remeslnik', label: '🔧 Řemeslník' },
                                            { id: 'poradce', label: '📊 Poradce' },
                                            { id: 'fotograf', label: '📸 Fotograf' },
                                            { id: 'jine', label: '📌 Jiné' },
                                        ].map(cat => (
                                            <button key={cat.id} type="button" onClick={() => setCategory(cat.id)}
                                                className={`px-3 py-2.5 rounded-xl text-sm transition-all cursor-pointer text-left ${
                                                    category === cat.id ? 'bg-blue-500/20 border-blue-500/50 text-blue-300 border' : 'bg-black/30 border border-white/10 text-gray-300 hover:border-white/20'
                                                }`}>{cat.label}</button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Co děláte? Popište své podnikání</label>
                                    <textarea value={description} onChange={e => setDescription(e.target.value)} required placeholder="např. Útulná kavárna v centru Brna, pražíme vlastní kávu, děláme domácí dezerty..." rows={3} className="w-full px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all text-sm resize-none" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Produkty / služby <span className="text-gray-500">(oddělte čárkou)</span></label>
                                    <input type="text" value={products} onChange={e => setProducts(e.target.value)} placeholder="např. Espresso, Cappuccino, Cheesecake, Brunch menu" className="w-full px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all text-sm" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Jak chcete komunikovat?</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        {[
                                            { id: 'přátelský', label: '😊 Přátelský' },
                                            { id: 'profesionální', label: '👔 Profesionální' },
                                            { id: 'drzý', label: '😎 Drzý / Vtipný' },
                                            { id: 'expertní', label: '🎓 Expertní' },
                                        ].map(t => (
                                            <button key={t.id} type="button" onClick={() => setTone(t.id)}
                                                className={`px-3 py-2.5 rounded-xl text-sm transition-all cursor-pointer text-left ${
                                                    tone === t.id ? 'bg-blue-500/20 border-blue-500/50 text-blue-300 border' : 'bg-black/30 border border-white/10 text-gray-300 hover:border-white/20'
                                                }`}>{t.label}</button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Instagram handle <span className="text-gray-500">(volitelné)</span></label>
                                    <input type="text" value={igHandle} onChange={e => setIgHandle(e.target.value)} placeholder="@tvujinstagram" className="w-full px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all text-sm" />
                                </div>
                            </div>
                            <div className="flex gap-3">
                                <button type="button" onClick={() => setStep('choose')} className="px-4 py-3.5 rounded-xl border border-white/10 text-sm text-gray-400 hover:text-white transition-all cursor-pointer">← Zpět</button>
                                <button type="submit" disabled={!businessName || !category || !description}
                                    className="flex-1 relative group overflow-hidden rounded-xl bg-blue-600 px-6 py-3.5 text-sm font-medium text-white shadow-[0_0_20px_rgba(59,130,246,0.2)] transition-all hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
                                    <span className="relative z-10 flex items-center justify-center gap-2">🚀 Analyzovat a nastavit<span className="transition-transform group-hover:translate-x-1">→</span></span>
                                </button>
                            </div>
                        </form>
                    </div>
                )}

                {/* ══════════════════════════════════════════════ */}
                {/* STEP 2: Analyzing (loading state)            */}
                {/* ══════════════════════════════════════════════ */}
                {step === 'analyzing' && (
                    <div className="animate-fadeIn text-center py-20">
                        <div className="inline-flex rounded-2xl bg-blue-500/10 p-5 mb-8 ring-1 ring-inset ring-blue-500/20">
                            <div className="w-10 h-10 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
                        </div>
                        <h2 className="text-2xl font-bold mb-4">AI analyzuje tvůj web</h2>
                        <p className="text-gray-400 mb-8">Scrapuji obsah, detekuji brand, analyzuji tón...</p>

                        <div className="max-w-sm mx-auto space-y-3 text-left">
                            <LoadingStep label="Stahuji homepage" active />
                            <LoadingStep label="Analyzuji produkty & služby" />
                            <LoadingStep label="Detekuji brand voice" />
                            <LoadingStep label="Generuji dotazník na míru" />
                        </div>
                    </div>
                )}

                {/* ══════════════════════════════════════════════ */}
                {/* STEP 3: Questionnaire                        */}
                {/* ══════════════════════════════════════════════ */}
                {step === 'questions' && analysis && (
                    <div className="animate-fadeIn">
                        <div className="mb-8">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-xl">✅</div>
                                <div>
                                    <h2 className="font-bold text-lg">{analysis.companyName}</h2>
                                    <p className="text-sm text-gray-400">{analysis.description}</p>
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2 mb-6">
                                {analysis.uniqueSellingPoints.slice(0, 3).map((usp, i) => (
                                    <span key={i} className="text-xs px-3 py-1 rounded-full bg-white/5 border border-white/10 text-gray-300">
                                        {usp}
                                    </span>
                                ))}
                            </div>
                            <h3 className="text-xl font-bold">Doplňující otázky</h3>
                            <p className="text-gray-400 text-sm mt-1">Na základě analýzy tvého webu máme pár doplňujících otázek.</p>
                        </div>

                        {error && <ErrorBanner message={error} />}

                        <form onSubmit={handleSubmitAnswers} className="space-y-5">
                            {questions.map((q, idx) => (
                                <div key={q.id} className="p-5 bg-white/5 border border-white/10 rounded-2xl">
                                    <label className="block text-sm font-medium text-gray-200 mb-3">
                                        <span className="text-emerald-400 font-mono text-xs mr-2">{idx + 1}.</span>
                                        {q.question}
                                    </label>

                                    {q.type === 'select' && q.options && (
                                        <div className="grid grid-cols-2 gap-2">
                                            {q.options.map(option => (
                                                <button
                                                    key={option}
                                                    type="button"
                                                    onClick={() => setAnswer(q.id, option)}
                                                    className={`px-3 py-2.5 rounded-xl text-sm transition-all cursor-pointer text-left ${answers[q.id] === option
                                                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 border'
                                                        : 'bg-black/30 border border-white/10 text-gray-300 hover:border-white/20'
                                                        }`}
                                                >
                                                    {option}
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    {q.type === 'multiselect' && q.options && (
                                        <div className="grid grid-cols-2 gap-2">
                                            {q.options.map(option => {
                                                const selected = ((answers[q.id] as string[]) || []).includes(option)
                                                return (
                                                    <button
                                                        key={option}
                                                        type="button"
                                                        onClick={() => toggleMultiselect(q.id, option)}
                                                        className={`px-3 py-2.5 rounded-xl text-sm transition-all cursor-pointer text-left ${selected
                                                            ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 border'
                                                            : 'bg-black/30 border border-white/10 text-gray-300 hover:border-white/20'
                                                            }`}
                                                    >
                                                        {selected ? '✓ ' : ''}{option}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    )}

                                    {q.type === 'text' && (
                                        <textarea
                                            value={(answers[q.id] as string) || ''}
                                            onChange={e => setAnswer(q.id, e.target.value)}
                                            placeholder={q.placeholder || 'Napiš svou odpověď...'}
                                            rows={2}
                                            className="w-full px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition-all text-sm resize-none"
                                        />
                                    )}

                                    {q.type === 'scale' && (
                                        <div className="flex gap-2">
                                            {[1, 2, 3, 4, 5].map(n => (
                                                <button
                                                    key={n}
                                                    type="button"
                                                    onClick={() => setAnswer(q.id, String(n))}
                                                    className={`flex-1 py-3 rounded-xl text-sm font-medium transition-all cursor-pointer ${answers[q.id] === String(n)
                                                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 border'
                                                        : 'bg-black/30 border border-white/10 text-gray-400 hover:border-white/20'
                                                        }`}
                                                >
                                                    {n}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}

                            <button
                                type="submit"
                                className="w-full relative group overflow-hidden rounded-xl bg-emerald-600 px-6 py-3.5 text-sm font-medium text-white shadow-[0_0_20px_rgba(16,185,129,0.2)] transition-all hover:bg-emerald-500 cursor-pointer"
                            >
                                <span className="relative z-10 flex items-center justify-center gap-2">
                                    🚀 Vygenerovat konfiguraci
                                    <span className="transition-transform group-hover:translate-x-1">→</span>
                                </span>
                            </button>
                        </form>
                    </div>
                )}

                {/* ══════════════════════════════════════════════ */}
                {/* STEP 4: Building config (loading)            */}
                {/* ══════════════════════════════════════════════ */}
                {step === 'building' && (
                    <div className="animate-fadeIn text-center py-20">
                        <div className="inline-flex rounded-2xl bg-purple-500/10 p-5 mb-8 ring-1 ring-inset ring-purple-500/20">
                            <div className="w-10 h-10 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin" />
                        </div>
                        <h2 className="text-2xl font-bold mb-4">Generuji konfiguraci</h2>
                        <p className="text-gray-400 mb-8">AI staví tvůj brand voice, content pilíře, hashtag strategie...</p>

                        <div className="max-w-sm mx-auto space-y-3 text-left">
                            <LoadingStep label="Brand voice & persona" active />
                            <LoadingStep label="Content pilíře & strategie" />
                            <LoadingStep label="Hook templates & CTA" />
                            <LoadingStep label="Feed aesthetic & vizuální styl" />
                        </div>
                    </div>
                )}

                {/* ══════════════════════════════════════════════ */}
                {/* STEP 5: Review config                         */}
                {/* ══════════════════════════════════════════════ */}
                {step === 'review' && configPreview && analysis && (
                    <div className="animate-fadeIn">
                        <div className="text-center mb-8">
                            <h2 className="text-2xl font-bold mb-2">Zkontroluj konfiguraci</h2>
                            <p className="text-gray-400">Projdi si jednotlivé sekce. Pokud je něco špatně, klikni 👎 a napiš co změnit.</p>
                        </div>

                        {error && <ErrorBanner message={error} />}

                        {configPreview.communicationStyle && (
                            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-5 mb-4">
                                <div className="flex items-center gap-2 mb-3">
                                    <span className="text-lg">💬</span>
                                    <h3 className="font-bold text-white">Doporučený styl komunikace</h3>
                                    <span className="ml-auto text-[10px] uppercase tracking-wider font-bold text-emerald-400/70 bg-emerald-500/10 px-2 py-0.5 rounded">AI na míru</span>
                                </div>
                                <p className="text-sm font-semibold text-white mb-1">{configPreview.communicationStyle.headline}</p>
                                <p className="text-xs text-gray-400 mb-4">{configPreview.communicationStyle.rationale}</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <span className="block text-[10px] uppercase font-bold tracking-wider text-emerald-400/70 mb-1.5">✓ Dělat</span>
                                        <ul className="space-y-1">
                                            {(configPreview.communicationStyle.dos || []).map((d: string, i: number) => (
                                                <li key={i} className="text-xs text-gray-300 flex gap-1.5"><span className="text-emerald-400">·</span>{d}</li>
                                            ))}
                                        </ul>
                                    </div>
                                    <div>
                                        <span className="block text-[10px] uppercase font-bold tracking-wider text-rose-400/70 mb-1.5">✕ Vyhnout se</span>
                                        <ul className="space-y-1">
                                            {(configPreview.communicationStyle.donts || []).map((d: string, i: number) => (
                                                <li key={i} className="text-xs text-gray-300 flex gap-1.5"><span className="text-rose-400">·</span>{d}</li>
                                            ))}
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="space-y-4">
                            <ReviewCard section="brand_voice" icon="🎤" title="Brand Voice & Persona"
                                status={sectionStatuses.brand_voice} feedback={sectionFeedback.brand_voice || ''}
                                refineCount={refineCounts.brand_voice || 0} isRefining={refiningSection === 'brand_voice'}
                                onApprove={() => approveSection('brand_voice')} onReject={() => rejectSection('brand_voice')}
                                onFeedbackChange={(v) => setSectionFeedback(prev => ({ ...prev, brand_voice: v }))}
                                onRefine={() => handleRefineSection('brand_voice')}>
                                <div className="space-y-3">
                                    <ReviewField label="Persona" value={configPreview.brandVoice?.persona} />
                                    <ReviewField label="Tón" value={(configPreview.brandVoice?.voiceTraits || []).join(', ')} />
                                    <ReviewField label="Hodnoty" value={(configPreview.brandVoice?.values || []).join(', ')} />
                                    <ReviewField label="Nepoužíváme" value={(configPreview.brandVoice?.antiPatterns || []).join(', ')} />
                                </div>
                            </ReviewCard>

                            <ReviewCard section="pillars" icon="🏛️" title="Content Pilíře & Kategorie"
                                status={sectionStatuses.pillars} feedback={sectionFeedback.pillars || ''}
                                refineCount={refineCounts.pillars || 0} isRefining={refiningSection === 'pillars'}
                                onApprove={() => approveSection('pillars')} onReject={() => rejectSection('pillars')}
                                onFeedbackChange={(v) => setSectionFeedback(prev => ({ ...prev, pillars: v }))}
                                onRefine={() => handleRefineSection('pillars')}>
                                <div className="space-y-2">
                                    {Object.entries(configPreview.contentPillars || {}).map(([key, pillar]: [string, any]) => (
                                        <div key={key} className="flex items-start gap-2 bg-black/20 rounded-lg px-3 py-2">
                                            <span className="text-lg">{pillar.emoji}</span>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-bold text-sm text-white">{pillar.label}</span>
                                                    <span className="text-[10px] text-gray-500 font-mono">{Math.round((pillar.ratio || 0) * 100)}%</span>
                                                </div>
                                                <p className="text-xs text-gray-400 mt-0.5">{pillar.description}</p>
                                                {pillar.categories?.length > 0 && (
                                                    <div className="flex flex-wrap gap-1 mt-1.5">
                                                        {pillar.categories.map((cat: any) => (
                                                            <span key={cat.id} className="text-[9px] px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-gray-400">
                                                                {cat.emoji} {cat.label}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </ReviewCard>

                            <ReviewCard section="products" icon="📦" title="Produkty & Služby"
                                status={sectionStatuses.products} feedback={sectionFeedback.products || ''}
                                refineCount={refineCounts.products || 0} isRefining={refiningSection === 'products'}
                                onApprove={() => approveSection('products')} onReject={() => rejectSection('products')}
                                onFeedbackChange={(v) => setSectionFeedback(prev => ({ ...prev, products: v }))}
                                onRefine={() => handleRefineSection('products')}>
                                {(configPreview.products || []).length > 0 ? (
                                    <div className="flex flex-wrap gap-2">
                                        {(configPreview.products || []).map((p: any, i: number) => (
                                            <span key={i} className="text-xs px-3 py-1.5 bg-black/20 rounded-lg border border-white/5 text-gray-300">
                                                {p.name}{p.price ? ` · ${p.price}` : ''}
                                            </span>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-xs text-gray-500 italic">Žádné produkty detekovány</p>
                                )}
                            </ReviewCard>

                            <ReviewCard section="visual" icon="🎨" title="Vizuální Identita"
                                status={sectionStatuses.visual} feedback={sectionFeedback.visual || ''}
                                refineCount={refineCounts.visual || 0} isRefining={refiningSection === 'visual'}
                                onApprove={() => approveSection('visual')} onReject={() => rejectSection('visual')}
                                onFeedbackChange={(v) => setSectionFeedback(prev => ({ ...prev, visual: v }))}
                                onRefine={() => handleRefineSection('visual')}>
                                <div className="space-y-3">
                                    <ReviewField label="Feel" value={configPreview.feedAesthetic?.feel} />
                                    <ReviewField label="Font" value={configPreview.feedAesthetic?.fontOverride || configPreview.feedAesthetic?.font} />
                                    {configPreview.overlayGradient && (
                                        <div>
                                            <span className="block text-gray-500 text-[10px] uppercase font-bold tracking-wider mb-1">Gradient preview</span>
                                            <div className="h-10 rounded-lg border border-white/10 overflow-hidden"
                                                style={{ background: `linear-gradient(to right, ${configPreview.overlayGradient.topColor}, ${configPreview.overlayGradient.midColor}, ${configPreview.overlayGradient.bottomColor})` }} />
                                        </div>
                                    )}
                                </div>
                            </ReviewCard>

                            <ReviewCard section="hooks_cta" icon="🪝" title="Hook Templates & CTA"
                                status={sectionStatuses.hooks_cta} feedback={sectionFeedback.hooks_cta || ''}
                                refineCount={refineCounts.hooks_cta || 0} isRefining={refiningSection === 'hooks_cta'}
                                onApprove={() => approveSection('hooks_cta')} onReject={() => rejectSection('hooks_cta')}
                                onFeedbackChange={(v) => setSectionFeedback(prev => ({ ...prev, hooks_cta: v }))}
                                onRefine={() => handleRefineSection('hooks_cta')}>
                                <div className="space-y-3">
                                    {(configPreview.brandVoice?.hookTemplates || []).slice(0, 4).map((h: any, i: number) => (
                                        <div key={i} className="text-xs text-gray-400">
                                            <span className="text-gray-500 font-mono mr-1">#{i + 1}</span>
                                            <span className="text-white/80">{h.pattern}</span>
                                            {h.example && <span className="block text-[10px] text-gray-500 ml-5 mt-0.5">→ {h.example}</span>}
                                        </div>
                                    ))}
                                    <ReviewField label="CTA (soft)" value={(configPreview.ctaStrategies?.soft || []).slice(0, 3).join(' · ')} />
                                </div>
                            </ReviewCard>
                        </div>

                        <div className="mt-8">
                            {Object.values(sectionStatuses).every(s => s === 'approved') ? (
                                <button onClick={handleSaveConfig}
                                    className="w-full relative group overflow-hidden rounded-xl bg-emerald-600 px-6 py-4 text-sm font-bold text-white shadow-[0_0_20px_rgba(16,185,129,0.2)] transition-all hover:bg-emerald-500 cursor-pointer">
                                    <span className="relative z-10 flex items-center justify-center gap-2">
                                        ✅ Vše schváleno — Uložit a pokračovat
                                        <span className="transition-transform group-hover:translate-x-1">→</span>
                                    </span>
                                </button>
                            ) : (
                                <div className="text-center">
                                    <p className="text-xs text-gray-500 mb-3">
                                        {Object.values(sectionStatuses).filter(s => s === 'approved').length} / {Object.values(sectionStatuses).length} sekcí schváleno
                                    </p>
                                    <button disabled className="w-full rounded-xl bg-white/5 px-6 py-4 text-sm text-gray-500 border border-white/10 cursor-not-allowed">
                                        Schval všechny sekce pro pokračování
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ══════════════════════════════════════════════ */}
                {/* STEP 5B: Saving (loading after review)        */}
                {/* ══════════════════════════════════════════════ */}
                {step === 'saving' && (
                    <div className="animate-fadeIn text-center py-20">
                        <div className="inline-flex rounded-2xl bg-emerald-500/10 p-5 mb-8 ring-1 ring-inset ring-emerald-500/20">
                            <div className="w-10 h-10 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" />
                        </div>
                        <h2 className="text-2xl font-bold mb-4">Ukládám konfiguraci</h2>
                        <p className="text-gray-400">Vytvářím bucket, propojuji účet...</p>
                    </div>
                )}

                {/* ══════════════════════════════════════════════ */}
                {/* STEP 5C: Generating showcase content           */}
                {/* ══════════════════════════════════════════════ */}
                {step === 'generating' && (
                    <div className="animate-fadeIn text-center py-20 max-w-md mx-auto">
                        <div className="inline-flex rounded-2xl bg-violet-500/10 p-5 mb-8 ring-1 ring-inset ring-violet-500/20">
                            <div className="w-10 h-10 border-2 border-violet-400/30 border-t-violet-400 rounded-full animate-spin" />
                        </div>
                        <h2 className="text-2xl font-bold mb-4">
                            {generatingProgress.phase === 'firstplan'
                                ? 'Připravuji tvůj první plán obsahu...'
                                : `Generuji ukázkový příspěvek ${generatingProgress.current}/3`}
                        </h2>
                        <p className="text-gray-400 mb-8">
                            {generatingProgress.phase === 'firstplan'
                                ? 'Skládám témata a hooky na míru tvé značce — podle toho, co ti na Instagramu už funguje.'
                                : 'Copywriter píše text, Art Director tvoří obrázek, Kritik kontroluje kvalitu...'}
                        </p>
                        {/* Progress bar */}
                        <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden mb-3">
                            <div
                                className="h-full rounded-full bg-violet-500 transition-all duration-1000 ease-out"
                                style={{ width: generatingProgress.phase === 'firstplan' ? '100%' : `${(generatingProgress.current / 3) * 100}%` }}
                            />
                        </div>
                        <p className="text-[10px] text-white/30 font-bold uppercase tracking-widest">
                            {generatingProgress.phase === 'firstplan'
                                ? 'Tvůj týdenní plán bude čekat v dashboardu'
                                : generatingProgress.current === 0
                                    ? 'Připravuji měsíční plán...'
                                    : `Příspěvek ${generatingProgress.current} ze 3 — plný obsah se vším`
                            }
                        </p>
                    </div>
                )}

                {/* ══════════════════════════════════════════════ */}
                {/* STEP 6: Done!                                 */}
                {/* ══════════════════════════════════════════════ */}
                {step === 'done' && analysis && (
                    <div className="animate-fadeIn max-w-2xl mx-auto py-12">
                        <div className="text-center mb-10">
                            <div className="inline-flex rounded-2xl bg-emerald-500/10 p-5 mb-6 ring-1 ring-inset ring-emerald-500/20">
                                <svg className="w-10 h-10 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                            <h2 className="text-3xl font-bold mb-3">
                                {reonboardSlug ? 'Konfigurace aktualizována! 🔄' : 'Vše je připravené! 🎉'}
                            </h2>
                            <p className="text-gray-400 text-lg">
                                {reonboardSlug
                                    ? 'Tvá nová konfigurace je uložená. Všechny budoucí posty budou využívat nové nastavení.'
                                    : 'Tvá schválená konfigurace je uložená. Můžeš začít generovat.'}
                            </p>
                        </div>

                        <button
                            onClick={() => router.push('/dashboard/instagram')}
                            className="w-full relative group overflow-hidden rounded-xl bg-emerald-600 px-6 py-4 text-sm font-bold text-white shadow-[0_0_20px_rgba(16,185,129,0.2)] transition-all hover:bg-emerald-500 cursor-pointer text-center"
                        >
                            <span className="relative z-10 flex items-center justify-center gap-2">
                                {reonboardSlug ? 'Zpět do Dashboardu' : 'Vstoupit do Chrlit Studia'}
                                <span className="transition-transform group-hover:translate-x-1">→</span>
                            </span>
                        </button>
                    </div>
                )}
            </div>

            <style jsx>{`
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(12px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .animate-fadeIn {
                    animation: fadeIn 0.5s ease-out;
                }
                @keyframes progress {
                    from { width: 0%; }
                    to { width: 100%; }
                }
            `}</style>
        </div>
    )
}

// ─── Sub-components ─────────────────────────────────────────

function ErrorBanner({ message }: { message: string }) {
    return (
        <div className="mb-6 rounded-xl bg-red-500/10 p-4 border border-red-500/20">
            <div className="flex gap-3">
                <svg className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <p className="text-sm text-red-400">{message}</p>
            </div>
        </div>
    )
}

function LoadingStep({ label, active }: { label: string; active?: boolean }) {
    return (
        <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all ${active ? 'bg-white/5 border border-white/10' : 'opacity-40'}`}>
            {active ? (
                <div className="w-4 h-4 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
            ) : (
                <div className="w-4 h-4 rounded-full border border-white/20" />
            )}
            <span className="text-sm text-gray-300">{label}</span>
        </div>
    )
}

function ReviewField({ label, value }: { label: string; value?: string }) {
    if (!value) return null
    return (
        <div>
            <span className="block text-gray-500 text-[10px] uppercase font-bold tracking-wider mb-0.5">{label}</span>
            <p className="text-xs text-gray-300 bg-black/20 px-3 py-2 rounded-lg border border-white/5">{value}</p>
        </div>
    )
}

function ReviewCard({
    section: _section,
    icon,
    title,
    status,
    feedback,
    refineCount,
    isRefining,
    onApprove,
    onReject,
    onFeedbackChange,
    onRefine,
    children,
}: {
    section: string
    icon: string
    title: string
    status: 'pending' | 'approved' | 'rejected' | 'refining'
    feedback: string
    refineCount: number
    isRefining: boolean
    onApprove: () => void
    onReject: () => void
    onFeedbackChange: (v: string) => void
    onRefine: () => void
    children: React.ReactNode
}) {
    const maxRefines = 3
    const borderColor = status === 'approved' ? 'border-emerald-500/30'
        : status === 'rejected' ? 'border-amber-500/30'
            : status === 'refining' ? 'border-purple-500/30'
                : 'border-white/10'

    return (
        <div className={`bg-white/5 border ${borderColor} rounded-2xl p-5 transition-all`}>
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <span className="text-lg">{icon}</span>
                    <h3 className="font-bold text-sm text-white">{title}</h3>
                    {status === 'approved' && <span className="text-emerald-400 text-sm">✅</span>}
                    {status === 'refining' && <span className="text-purple-400 text-xs animate-pulse">Přegenerovávám...</span>}
                    {refineCount > 0 && <span className="text-[9px] text-gray-500 font-mono">v{refineCount + 1}</span>}
                </div>
                <div className="flex gap-1.5">
                    <button onClick={onApprove}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                            status === 'approved'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : 'bg-white/5 text-gray-400 border border-white/10 hover:text-emerald-300 hover:border-emerald-500/30'
                        }`}>
                        👍
                    </button>
                    <button onClick={onReject} disabled={isRefining || refineCount >= maxRefines}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                            status === 'rejected'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                : 'bg-white/5 text-gray-400 border border-white/10 hover:text-amber-300 hover:border-amber-500/30'
                        } ${(isRefining || refineCount >= maxRefines) ? 'opacity-40 cursor-not-allowed' : ''}`}>
                        👎
                    </button>
                </div>
            </div>

            {children}

            {status === 'rejected' && (
                <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
                    <textarea
                        value={feedback}
                        onChange={(e) => onFeedbackChange(e.target.value)}
                        placeholder="Co je špatně? Co chceš změnit?"
                        rows={2}
                        className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition-all text-xs resize-none"
                    />
                    <div className="flex items-center justify-between">
                        <span className="text-[9px] text-gray-500">
                            {refineCount >= maxRefines ? 'Max. počet úprav — doladíš v Settings' : `Pokus ${refineCount + 1}/${maxRefines}`}
                        </span>
                        <button
                            onClick={onRefine}
                            disabled={!feedback.trim() || isRefining || refineCount >= maxRefines}
                            className="px-4 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-medium hover:bg-amber-500/30 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {isRefining ? '⏳ Přepracovávám...' : '🔄 Přegenerovat'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
