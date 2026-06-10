'use client'

import { useState, useEffect } from 'react'
import { checkIsAdmin } from '@/app/actions/admin-actions'
import {
    analyzeWebsite,
    generateQuestions,
    buildManualAnalysis,
    generateConfigPreview,
    refineConfigSection,
    saveReviewedConfig,
    generateImageBrief,
} from '@/app/onboarding/actions'
import type { WebsiteAnalysis, OnboardingQuestion, ReviewSection } from '@/app/onboarding/actions'
import type { ClientConfig, ImageBriefItem } from '@/instagram/configs/types'

type Step = 'choose' | 'input' | 'manual' | 'analyzing' | 'questions' | 'building' | 'review' | 'saving' | 'done'

interface OnboardedClient {
    name: string
    slug: string
}

const REVIEW_SECTIONS: { id: ReviewSection; icon: string; title: string }[] = [
    { id: 'brand_voice', icon: '🎤', title: 'Brand Voice' },
    { id: 'pillars', icon: '📊', title: 'Content Pillars' },
    { id: 'products', icon: '📦', title: 'Produkty' },
    { id: 'visual', icon: '🎨', title: 'Vizuální identita' },
    { id: 'hooks_cta', icon: '🪝', title: 'Hooks & CTA' },
]

export function OnboardTab() {
    const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
    const [step, setStep] = useState<Step>('choose')
    const [url, setUrl] = useState('')
    const [igHandle, setIgHandle] = useState('')
    const [error, setError] = useState<string | null>(null)

    // Manual form fields
    const [businessName, setBusinessName] = useState('')
    const [category, setCategory] = useState('')
    const [manualDescription, setManualDescription] = useState('')
    const [manualProducts, setManualProducts] = useState('')
    const [manualTone, setManualTone] = useState('')

    // Enhanced fields (Phase 2)
    const [targetAudience, setTargetAudience] = useState('')
    const [competitors, setCompetitors] = useState('')
    const [visualStyle, setVisualStyle] = useState('')
    const [followerCount, setFollowerCount] = useState('')
    const [topLocations, setTopLocations] = useState('')
    const [audienceGender, setAudienceGender] = useState('')

    const [analysis, setAnalysis] = useState<WebsiteAnalysis | null>(null)
    const [questions, setQuestions] = useState<OnboardingQuestion[]>([])
    const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
    const [onboarded, setOnboarded] = useState<OnboardedClient | null>(null)

    // Review state (Phase 1)
    const [configPreview, setConfigPreview] = useState<ClientConfig | null>(null)
    const [sectionStatuses, setSectionStatuses] = useState<Record<ReviewSection, 'pending' | 'approved' | 'rejected' | 'refining'>>({
        brand_voice: 'pending', pillars: 'pending', products: 'pending', visual: 'pending', hooks_cta: 'pending',
    })
    const [sectionFeedback, setSectionFeedback] = useState<Record<ReviewSection, string>>({
        brand_voice: '', pillars: '', products: '', visual: '', hooks_cta: '',
    })
    const [refineCounts, setRefineCounts] = useState<Record<ReviewSection, number>>({
        brand_voice: 0, pillars: 0, products: 0, visual: 0, hooks_cta: 0,
    })

    // Image brief (Phase 3)
    const [imageBrief, setImageBrief] = useState<ImageBriefItem[]>([])
    const [briefLoading, setBriefLoading] = useState(false)

    // Session history
    const [history, setHistory] = useState<OnboardedClient[]>([])

    useEffect(() => {
        checkIsAdmin().then(setIsAdmin)
    }, [])

    // ─── Step 1A → 2: Analyze website ────────────────────────
    async function handleAnalyze(e: React.FormEvent) {
        e.preventDefault()
        if (!url.trim()) return

        setError(null)
        setStep('analyzing')

        try {
            const result = await analyzeWebsite(url.trim(), igHandle.trim())
            if (!result.success || !result.analysis) {
                throw new Error(result.error || 'Analýza selhala')
            }
            setAnalysis(result.analysis)

            const qResult = await generateQuestions(result.analysis)
            if (!qResult.success || !qResult.questions) {
                throw new Error(qResult.error || 'Generování dotazníku selhalo')
            }
            setQuestions(qResult.questions)
            setStep('questions')
        } catch (err) {
            setError((err as Error).message)
            setStep('input')
        }
    }

    // ─── Step 1B → 2: Manual analyze ──────────────────────────
    async function handleManualSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!businessName.trim() || !category || !manualDescription.trim()) return

        setError(null)
        setStep('analyzing')

        try {
            const result = await buildManualAnalysis({
                businessName: businessName.trim(),
                category,
                description: manualDescription.trim(),
                products: manualProducts.trim(),
                tone: manualTone || 'přátelský',
                igHandle: igHandle.trim(),
                targetAudience: targetAudience.trim() || undefined,
                competitors: competitors.trim() || undefined,
                visualStyle: visualStyle || undefined,
                followerCount: followerCount ? parseInt(followerCount) : undefined,
                topLocations: topLocations.trim() || undefined,
                audienceGender: (audienceGender as any) || undefined,
            })
            if (!result.success || !result.analysis) {
                throw new Error(result.error || 'Analýza selhala')
            }
            setAnalysis(result.analysis)

            const qResult = await generateQuestions(result.analysis)
            if (!qResult.success || !qResult.questions) {
                throw new Error(qResult.error || 'Generování dotazníku selhalo')
            }
            setQuestions(qResult.questions)
            setStep('questions')
        } catch (err) {
            setError((err as Error).message)
            setStep('manual')
        }
    }

    // ─── Step 3 → 4: Generate config preview ─────────────────
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
            // Reset review state
            setSectionStatuses({ brand_voice: 'pending', pillars: 'pending', products: 'pending', visual: 'pending', hooks_cta: 'pending' })
            setSectionFeedback({ brand_voice: '', pillars: '', products: '', visual: '', hooks_cta: '' })
            setRefineCounts({ brand_voice: 0, pillars: 0, products: 0, visual: 0, hooks_cta: 0 })
            setStep('review')
        } catch (err) {
            setError((err as Error).message)
            setStep('questions')
        }
    }

    // ─── Review handlers ──────────────────────────────────────
    function approveSection(section: ReviewSection) {
        setSectionStatuses(prev => ({ ...prev, [section]: 'approved' }))
    }

    function rejectSection(section: ReviewSection) {
        setSectionStatuses(prev => ({ ...prev, [section]: 'rejected' }))
    }

    async function handleRefineSection(section: ReviewSection) {
        if (!configPreview || !sectionFeedback[section].trim()) return
        setSectionStatuses(prev => ({ ...prev, [section]: 'refining' }))

        try {
            const result = await refineConfigSection(configPreview, section, sectionFeedback[section], analysis!)
            if (result.success && result.config) {
                setConfigPreview(result.config)
                setRefineCounts(prev => ({ ...prev, [section]: prev[section] + 1 }))
                setSectionFeedback(prev => ({ ...prev, [section]: '' }))
                setSectionStatuses(prev => ({ ...prev, [section]: 'pending' }))
            } else {
                setSectionStatuses(prev => ({ ...prev, [section]: 'rejected' }))
            }
        } catch {
            setSectionStatuses(prev => ({ ...prev, [section]: 'rejected' }))
        }
    }

    const allApproved = REVIEW_SECTIONS.every(s => sectionStatuses[s.id] === 'approved')

    async function handleSaveConfig() {
        if (!configPreview || !analysis || !allApproved) return
        setStep('saving')
        setError(null)

        try {
            const result = await saveReviewedConfig(configPreview, analysis)
            if (!result.success) {
                throw new Error(result.error || 'Uložení selhalo')
            }

            const client = { name: analysis.companyName, slug: result.clientSlug || '' }
            setOnboarded(client)
            setHistory(prev => [...prev, client])
            setStep('done')

            // Generate image brief in background and save to config
            setBriefLoading(true)
            generateImageBrief(configPreview).then(async (res) => {
                if (res.success && res.brief) {
                    setImageBrief(res.brief)
                    // Persist brief to config in DB
                    const { updateClientConfig } = await import('@/app/actions/settings-actions')
                    const { getClientConfig } = await import('@/app/actions/settings-actions')
                    const currentConfig = await getClientConfig(client.slug)
                    if (currentConfig) {
                        await updateClientConfig(client.slug, { ...currentConfig, imageBrief: res.brief })
                    }
                }
            }).finally(() => setBriefLoading(false))
        } catch (err) {
            setError((err as Error).message)
            setStep('review')
        }
    }

    // ─── Answer handlers ─────────────────────────────────────
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

    function handleReset() {
        setStep('choose')
        setUrl('')
        setIgHandle('')
        setError(null)
        setAnalysis(null)
        setQuestions([])
        setAnswers({})
        setOnboarded(null)
        setConfigPreview(null)
        setImageBrief([])
        setBusinessName('')
        setCategory('')
        setManualDescription('')
        setManualProducts('')
        setManualTone('')
        setTargetAudience('')
        setCompetitors('')
        setVisualStyle('')
        setFollowerCount('')
        setTopLocations('')
        setAudienceGender('')
        setSectionStatuses({ brand_voice: 'pending', pillars: 'pending', products: 'pending', visual: 'pending', hooks_cta: 'pending' })
    }

    function copyBriefToClipboard() {
        const text = imageBrief.map(cat =>
            `${cat.emoji} ${cat.category} (${cat.count})\n${cat.items.map(item => `  □ ${item}`).join('\n')}`
        ).join('\n\n')
        navigator.clipboard.writeText(`📸 Shot list pro ${onboarded?.name || 'klienta'}\n${'━'.repeat(30)}\n\n${text}`)
    }

    // ─── Access guard ────────────────────────────────────────
    if (isAdmin === null) {
        return <div className="text-center py-20 text-white/40">Ověřuji oprávnění...</div>
    }
    if (!isAdmin) {
        return (
            <div className="text-center py-20">
                <div className="text-4xl mb-4">🔒</div>
                <p className="text-white/50">Pouze pro administrátory</p>
            </div>
        )
    }

    return (
        <div className="max-w-2xl mx-auto">
            {/* ═══ Progress bar ═══ */}
            <div className="h-1 bg-white/5 rounded-full mb-8 overflow-hidden">
                <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-blue-500 transition-all duration-700 ease-out rounded-full"
                    style={{
                        width: (step === 'choose' || step === 'input' || step === 'manual') ? '0%'
                            : step === 'analyzing' ? '20%'
                                : step === 'questions' ? '40%'
                                    : step === 'building' ? '55%'
                                        : step === 'review' ? '70%'
                                            : step === 'saving' ? '90%'
                                                : '100%'
                    }}
                />
            </div>

            {/* ═══ STEP 0: Choose mode ═══ */}
            {step === 'choose' && (
                <div>
                    <div className="mb-8">
                        <h2 className="text-2xl font-bold text-white mb-2">➕ Onboardovat nového klienta</h2>
                        <p className="text-white/50 text-sm">Jak chceš začít?</p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <button
                            onClick={() => setStep('input')}
                            className="p-5 bg-white/5 border border-white/10 rounded-xl text-left hover:border-emerald-500/40 transition-all cursor-pointer group"
                        >
                            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center text-lg mb-3 group-hover:scale-110 transition-transform">🌐</div>
                            <h3 className="font-bold text-white text-sm mb-1">Mám web</h3>
                            <p className="text-xs text-white/40">AI analyzuje web a nastaví vše automaticky.</p>
                        </button>
                        <button
                            onClick={() => setStep('manual')}
                            className="p-5 bg-white/5 border border-white/10 rounded-xl text-left hover:border-blue-500/40 transition-all cursor-pointer group"
                        >
                            <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center text-lg mb-3 group-hover:scale-110 transition-transform">✏️</div>
                            <h3 className="font-bold text-white text-sm mb-1">Nemám web</h3>
                            <p className="text-xs text-white/40">Vyplníš pár otázek a AI nastaví vše za tebe.</p>
                        </button>
                    </div>

                    {/* History */}
                    {history.length > 0 && (
                        <div className="mt-8 p-4 bg-white/5 border border-white/10 rounded-xl">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-white/40 mb-3">Dnes onboardovaní</h4>
                            <div className="space-y-2">
                                {history.map((c, i) => (
                                    <div key={i} className="flex items-center gap-2 text-sm text-white/60">
                                        <span className="text-emerald-400">✓</span>
                                        <span className="font-medium text-white/80">{c.name}</span>
                                        <span className="text-white/30">({c.slug})</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ═══ STEP 1A: Input URL ═══ */}
            {step === 'input' && (
                <div>
                    <div className="mb-8">
                        <h2 className="text-2xl font-bold text-white mb-2">🌐 Webová stránka klienta</h2>
                        <p className="text-white/50 text-sm">AI analyzuje web a vytvoří konfiguraci.</p>
                    </div>

                    {error && <ErrorBanner message={error} />}

                    <form onSubmit={handleAnalyze} className="space-y-5">
                        <div className="p-6 bg-white/5 border border-white/10 rounded-xl space-y-5">
                            <div>
                                <label htmlFor="onboard-url" className="block text-sm font-medium text-gray-300 mb-2">Webová stránka</label>
                                <input
                                    id="onboard-url"
                                    type="text"
                                    value={url}
                                    onChange={e => setUrl(e.target.value)}
                                    required
                                    placeholder="https://klientweb.cz"
                                    className="w-full px-4 py-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition-all text-sm"
                                />
                            </div>
                            <div>
                                <label htmlFor="onboard-ig" className="block text-sm font-medium text-gray-300 mb-2">Instagram handle</label>
                                <input
                                    id="onboard-ig"
                                    type="text"
                                    value={igHandle}
                                    onChange={e => setIgHandle(e.target.value)}
                                    placeholder="@klient"
                                    className="w-full px-4 py-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition-all text-sm"
                                />
                                <p className="mt-1.5 text-xs text-gray-500">Volitelné</p>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button type="button" onClick={() => setStep('choose')} className="px-4 py-3.5 rounded-lg border border-white/10 text-sm text-gray-400 hover:text-white transition-all cursor-pointer">← Zpět</button>
                            <button
                                type="submit"
                                className="flex-1 rounded-lg bg-emerald-600 px-6 py-3.5 text-sm font-medium text-white transition-all hover:bg-emerald-500 cursor-pointer"
                            >
                                🔍 Analyzovat web
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* ═══ STEP 1B: Manual form ═══ */}
            {step === 'manual' && (
                <div>
                    <div className="mb-8">
                        <h2 className="text-2xl font-bold text-white mb-2">✏️ Manuální onboarding</h2>
                        <p className="text-white/50 text-sm">Vyplň základní info — AI vytvoří konfiguraci bez webu.</p>
                    </div>

                    {error && <ErrorBanner message={error} />}

                    <form onSubmit={handleManualSubmit} className="space-y-5">
                        {/* Core fields */}
                        <div className="p-6 bg-white/5 border border-white/10 rounded-xl space-y-5">
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Název firmy / značky</label>
                                <input type="text" value={businessName} onChange={e => setBusinessName(e.target.value)} required placeholder="např. Café Pohoda" className="w-full px-4 py-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all text-sm" />
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
                                            className={`px-3 py-2 rounded-lg text-sm transition-all cursor-pointer text-left ${
                                                category === cat.id ? 'bg-blue-500/20 border-blue-500/50 text-blue-300 border' : 'bg-black/30 border border-white/10 text-gray-300 hover:border-white/20'
                                            }`}>{cat.label}</button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Co děláte? Popište podnikání</label>
                                <textarea value={manualDescription} onChange={e => setManualDescription(e.target.value)} required placeholder="např. Útulná kavárna v centru Brna, pražíme vlastní kávu..." rows={3} className="w-full px-4 py-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all text-sm resize-none" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Produkty / služby <span className="text-gray-500">(oddělte čárkou)</span></label>
                                <input type="text" value={manualProducts} onChange={e => setManualProducts(e.target.value)} placeholder="např. Espresso, Cappuccino, Cheesecake" className="w-full px-4 py-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all text-sm" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Tón komunikace</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {[
                                        { id: 'přátelský', label: '😊 Přátelský' },
                                        { id: 'profesionální', label: '👔 Profesionální' },
                                        { id: 'drzý', label: '😎 Drzý / Vtipný' },
                                        { id: 'expertní', label: '🎓 Expertní' },
                                    ].map(t => (
                                        <button key={t.id} type="button" onClick={() => setManualTone(t.id)}
                                            className={`px-3 py-2 rounded-lg text-sm transition-all cursor-pointer text-left ${
                                                manualTone === t.id ? 'bg-blue-500/20 border-blue-500/50 text-blue-300 border' : 'bg-black/30 border border-white/10 text-gray-300 hover:border-white/20'
                                            }`}>{t.label}</button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Instagram handle <span className="text-gray-500">(volitelné)</span></label>
                                <input type="text" value={igHandle} onChange={e => setIgHandle(e.target.value)} placeholder="@klient" className="w-full px-4 py-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all text-sm" />
                            </div>
                        </div>

                        {/* Enhanced fields */}
                        <div className="p-6 bg-white/5 border border-white/10 rounded-xl space-y-5">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-white/40">Volitelné — pro lepší výsledky</h4>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Cílová skupina</label>
                                <textarea value={targetAudience} onChange={e => setTargetAudience(e.target.value)} placeholder="např. Ženy 25-40, zajímají se o zdravý životní styl, žijí v Brně..." rows={2} className="w-full px-4 py-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all text-sm resize-none" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Inspirace / IG účty</label>
                                <input type="text" value={competitors} onChange={e => setCompetitors(e.target.value)} placeholder="např. @kavarnarovnost, @doubleshot.cz" className="w-full px-4 py-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all text-sm" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Vizuální styl</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {[
                                        { id: 'tmavý', label: '🌑 Tmavý' },
                                        { id: 'světlý', label: '☀️ Světlý' },
                                        { id: 'barevný', label: '🌈 Barevný' },
                                        { id: 'minimalistický', label: '⬜ Minimalistický' },
                                        { id: 'luxusní', label: '✨ Luxusní' },
                                    ].map(v => (
                                        <button key={v.id} type="button" onClick={() => setVisualStyle(v.id)}
                                            className={`px-3 py-2 rounded-lg text-sm transition-all cursor-pointer text-left ${
                                                visualStyle === v.id ? 'bg-blue-500/20 border-blue-500/50 text-blue-300 border' : 'bg-black/30 border border-white/10 text-gray-300 hover:border-white/20'
                                            }`}>{v.label}</button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* IG Insights */}
                        <div className="p-6 bg-white/5 border border-white/10 rounded-xl space-y-5">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-white/40">📊 Instagram insights (volitelné)</h4>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Followerů</label>
                                    <input type="number" value={followerCount} onChange={e => setFollowerCount(e.target.value)} placeholder="např. 1500" className="w-full px-4 py-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all text-sm" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">Top lokace</label>
                                    <input type="text" value={topLocations} onChange={e => setTopLocations(e.target.value)} placeholder="Praha, Brno" className="w-full px-4 py-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all text-sm" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Publikum</label>
                                <div className="grid grid-cols-4 gap-2">
                                    {[
                                        { id: 'mostly_female', label: '👩 Převážně ženy' },
                                        { id: 'mostly_male', label: '👨 Převážně muži' },
                                        { id: 'mixed', label: '👥 Mix' },
                                        { id: 'unknown', label: '❓ Nevím' },
                                    ].map(g => (
                                        <button key={g.id} type="button" onClick={() => setAudienceGender(g.id)}
                                            className={`px-3 py-2 rounded-lg text-xs transition-all cursor-pointer text-center ${
                                                audienceGender === g.id ? 'bg-blue-500/20 border-blue-500/50 text-blue-300 border' : 'bg-black/30 border border-white/10 text-gray-300 hover:border-white/20'
                                            }`}>{g.label}</button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button type="button" onClick={() => setStep('choose')} className="px-4 py-3.5 rounded-lg border border-white/10 text-sm text-gray-400 hover:text-white transition-all cursor-pointer">← Zpět</button>
                            <button
                                type="submit"
                                disabled={!businessName || !category || !manualDescription}
                                className="flex-1 rounded-lg bg-blue-600 px-6 py-3.5 text-sm font-medium text-white transition-all hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                            >
                                🚀 Analyzovat a nastavit
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* ═══ STEP 2: Analyzing ═══ */}
            {step === 'analyzing' && (
                <div className="text-center py-16">
                    <div className="inline-flex rounded-2xl bg-blue-500/10 p-5 mb-8 ring-1 ring-inset ring-blue-500/20">
                        <div className="w-10 h-10 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
                    </div>
                    <h2 className="text-xl font-bold text-white mb-3">AI analyzuje klienta</h2>
                    <p className="text-white/40 text-sm mb-8">Scrapuji obsah, detekuji brand, analyzuji tón...</p>
                    <div className="max-w-sm mx-auto space-y-2 text-left">
                        <LoadingStep label="Analyzuji značku" active />
                        <LoadingStep label="Analyzuji produkty & služby" />
                        <LoadingStep label="Detekuji brand voice" />
                        <LoadingStep label="Generuji dotazník na míru" />
                    </div>
                </div>
            )}

            {/* ═══ STEP 3: Questions ═══ */}
            {step === 'questions' && analysis && (
                <div>
                    <div className="mb-6">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-9 h-9 rounded-lg bg-emerald-500/20 flex items-center justify-center text-lg">✅</div>
                            <div>
                                <h3 className="font-bold text-white">{analysis.companyName}</h3>
                                <p className="text-xs text-white/40">{analysis.description}</p>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2 mb-4">
                            {analysis.uniqueSellingPoints.slice(0, 3).map((usp, i) => (
                                <span key={i} className="text-xs px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-gray-300">
                                    {usp}
                                </span>
                            ))}
                        </div>
                        <h3 className="text-lg font-bold text-white">Doplňující otázky</h3>
                        <p className="text-white/40 text-xs mt-1">Na základě analýzy máme pár doplňujících otázek.</p>
                    </div>

                    {error && <ErrorBanner message={error} />}

                    <form onSubmit={handleSubmitAnswers} className="space-y-4">
                        {questions.map((q, idx) => (
                            <div key={q.id} className="p-4 bg-white/5 border border-white/10 rounded-xl">
                                <label className="block text-sm font-medium text-gray-200 mb-3">
                                    <span className="text-emerald-400 font-mono text-xs mr-2">{idx + 1}.</span>
                                    {q.question}
                                </label>

                                {q.type === 'select' && q.options && (
                                    <div className="grid grid-cols-2 gap-2">
                                        {q.options.map(option => (
                                            <button key={option} type="button" onClick={() => setAnswer(q.id, option)}
                                                className={`px-3 py-2 rounded-lg text-sm transition-all cursor-pointer text-left ${answers[q.id] === option
                                                    ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 border'
                                                    : 'bg-black/30 border border-white/10 text-gray-300 hover:border-white/20'
                                                }`}>{option}</button>
                                        ))}
                                    </div>
                                )}

                                {q.type === 'multiselect' && q.options && (
                                    <div className="grid grid-cols-2 gap-2">
                                        {q.options.map(option => {
                                            const selected = ((answers[q.id] as string[]) || []).includes(option)
                                            return (
                                                <button key={option} type="button" onClick={() => toggleMultiselect(q.id, option)}
                                                    className={`px-3 py-2 rounded-lg text-sm transition-all cursor-pointer text-left ${selected
                                                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 border'
                                                        : 'bg-black/30 border border-white/10 text-gray-300 hover:border-white/20'
                                                    }`}>{selected ? '✓ ' : ''}{option}</button>
                                            )
                                        })}
                                    </div>
                                )}

                                {q.type === 'text' && (
                                    <textarea
                                        value={(answers[q.id] as string) || ''}
                                        onChange={e => setAnswer(q.id, e.target.value)}
                                        placeholder={q.placeholder || 'Napiš odpověď...'}
                                        rows={2}
                                        className="w-full px-4 py-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition-all text-sm resize-none"
                                    />
                                )}

                                {q.type === 'scale' && (
                                    <div className="flex gap-2">
                                        {[1, 2, 3, 4, 5].map(n => (
                                            <button key={n} type="button" onClick={() => setAnswer(q.id, String(n))}
                                                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${answers[q.id] === String(n)
                                                    ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 border'
                                                    : 'bg-black/30 border border-white/10 text-gray-400 hover:border-white/20'
                                                }`}>{n}</button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}

                        <button
                            type="submit"
                            className="w-full rounded-lg bg-emerald-600 px-6 py-3.5 text-sm font-medium text-white transition-all hover:bg-emerald-500 cursor-pointer"
                        >
                            🚀 Vygenerovat konfiguraci
                        </button>
                    </form>
                </div>
            )}

            {/* ═══ STEP 4: Building ═══ */}
            {step === 'building' && (
                <div className="text-center py-16">
                    <div className="inline-flex rounded-2xl bg-purple-500/10 p-5 mb-8 ring-1 ring-inset ring-purple-500/20">
                        <div className="w-10 h-10 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin" />
                    </div>
                    <h2 className="text-xl font-bold text-white mb-3">Generuji konfiguraci</h2>
                    <p className="text-white/40 text-sm mb-8">AI staví styl textu, témata obsahu, hashtag strategie...</p>
                    <div className="max-w-sm mx-auto space-y-2 text-left">
                        <LoadingStep label="Styl textu & persona" active />
                        <LoadingStep label="Témata obsahu & strategie" />
                        <LoadingStep label="Šablony úvodních vět & CTA" />
                        <LoadingStep label="Připravuji preview" />
                    </div>
                </div>
            )}

            {/* ═══ STEP 5: Review ═══ */}
            {step === 'review' && configPreview && (
                <div>
                    <div className="mb-6">
                        <h2 className="text-xl font-bold text-white mb-1">📋 Review konfigurace</h2>
                        <p className="text-white/40 text-sm">Projdi každou sekci — schval 👍 nebo nech přegenerovat 👎</p>
                    </div>

                    {error && <ErrorBanner message={error} />}

                    <div className="space-y-4">
                        {/* Brand Voice */}
                        <ReviewCard
                            section="brand_voice" icon="🎤" title="Brand Voice"
                            status={sectionStatuses.brand_voice} feedback={sectionFeedback.brand_voice}
                            refineCount={refineCounts.brand_voice} isRefining={sectionStatuses.brand_voice === 'refining'}
                            onApprove={() => approveSection('brand_voice')} onReject={() => rejectSection('brand_voice')}
                            onFeedbackChange={v => setSectionFeedback(p => ({ ...p, brand_voice: v }))}
                            onRefine={() => handleRefineSection('brand_voice')}
                        >
                            <div className="space-y-2">
                                <ReviewField label="Persona" value={configPreview.brandVoice?.persona} />
                                <ReviewField label="Voice Traits" value={configPreview.brandVoice?.voiceTraits?.join(', ')} />
                                <ReviewField label="Anti-Patterns" value={configPreview.brandVoice?.antiPatterns?.slice(0, 3).join(' • ')} />
                            </div>
                        </ReviewCard>

                        {/* Pillars */}
                        <ReviewCard
                            section="pillars" icon="📊" title="Content Pillars"
                            status={sectionStatuses.pillars} feedback={sectionFeedback.pillars}
                            refineCount={refineCounts.pillars} isRefining={sectionStatuses.pillars === 'refining'}
                            onApprove={() => approveSection('pillars')} onReject={() => rejectSection('pillars')}
                            onFeedbackChange={v => setSectionFeedback(p => ({ ...p, pillars: v }))}
                            onRefine={() => handleRefineSection('pillars')}
                        >
                            <div className="space-y-1.5">
                                {Object.entries(configPreview.contentPillars || {}).map(([key, pillar]) => (
                                    <div key={key} className="flex items-center gap-2 text-xs">
                                        <span>{pillar.emoji}</span>
                                        <span className="text-white/80 font-medium">{pillar.label}</span>
                                        <span className="text-white/30">({Math.round(pillar.ratio * 100)}%)</span>
                                    </div>
                                ))}
                            </div>
                        </ReviewCard>

                        {/* Products */}
                        <ReviewCard
                            section="products" icon="📦" title="Produkty"
                            status={sectionStatuses.products} feedback={sectionFeedback.products}
                            refineCount={refineCounts.products} isRefining={sectionStatuses.products === 'refining'}
                            onApprove={() => approveSection('products')} onReject={() => rejectSection('products')}
                            onFeedbackChange={v => setSectionFeedback(p => ({ ...p, products: v }))}
                            onRefine={() => handleRefineSection('products')}
                        >
                            <div className="flex flex-wrap gap-1.5">
                                {(configPreview.products || []).map((p, i) => (
                                    <span key={i} className="text-xs px-2 py-1 rounded-full bg-white/5 border border-white/10 text-gray-300">{p.name}</span>
                                ))}
                                {(!configPreview.products || configPreview.products.length === 0) && (
                                    <span className="text-xs text-white/30">Žádné produkty</span>
                                )}
                            </div>
                        </ReviewCard>

                        {/* Visual */}
                        <ReviewCard
                            section="visual" icon="🎨" title="Vizuální identita"
                            status={sectionStatuses.visual} feedback={sectionFeedback.visual}
                            refineCount={refineCounts.visual} isRefining={sectionStatuses.visual === 'refining'}
                            onApprove={() => approveSection('visual')} onReject={() => rejectSection('visual')}
                            onFeedbackChange={v => setSectionFeedback(p => ({ ...p, visual: v }))}
                            onRefine={() => handleRefineSection('visual')}
                        >
                            <div className="space-y-2">
                                <ReviewField label="Vizuální styl" value={configPreview.feedAesthetic?.feel} />
                                {configPreview.overlayGradient && (
                                    <div>
                                        <span className="block text-gray-500 text-[10px] uppercase font-bold tracking-wider mb-1">Gradient</span>
                                        <div className="flex gap-2 items-center">
                                            {[configPreview.overlayGradient.topColor, configPreview.overlayGradient.midColor, configPreview.overlayGradient.bottomColor].map((color, i) => (
                                                <div key={i} className="flex items-center gap-1.5">
                                                    <div className="w-5 h-5 rounded border border-white/20" style={{ backgroundColor: color }} />
                                                    <span className="text-[10px] text-white/40 font-mono">{color}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </ReviewCard>

                        {/* Hooks & CTA */}
                        <ReviewCard
                            section="hooks_cta" icon="🪝" title="Hooks & CTA"
                            status={sectionStatuses.hooks_cta} feedback={sectionFeedback.hooks_cta}
                            refineCount={refineCounts.hooks_cta} isRefining={sectionStatuses.hooks_cta === 'refining'}
                            onApprove={() => approveSection('hooks_cta')} onReject={() => rejectSection('hooks_cta')}
                            onFeedbackChange={v => setSectionFeedback(p => ({ ...p, hooks_cta: v }))}
                            onRefine={() => handleRefineSection('hooks_cta')}
                        >
                            <div className="space-y-2">
                                <ReviewField label="Hook šablony" value={configPreview.brandVoice?.hookTemplates?.slice(0, 3).join(' | ')} />
                                <ReviewField label="CTA (soft)" value={configPreview.ctaStrategies?.soft?.slice(0, 2).join(' | ')} />
                            </div>
                        </ReviewCard>
                    </div>

                    {/* Save button */}
                    <div className="mt-6">
                        <button
                            onClick={handleSaveConfig}
                            disabled={!allApproved}
                            className={`w-full rounded-lg px-6 py-3.5 text-sm font-medium transition-all cursor-pointer ${
                                allApproved
                                    ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                                    : 'bg-white/5 text-white/30 border border-white/10 cursor-not-allowed'
                            }`}
                        >
                            {allApproved ? '💾 Uložit konfiguraci' : `Schval všech 5 sekcí (${REVIEW_SECTIONS.filter(s => sectionStatuses[s.id] === 'approved').length}/5)`}
                        </button>
                    </div>
                </div>
            )}

            {/* ═══ STEP 6: Saving ═══ */}
            {step === 'saving' && (
                <div className="text-center py-16">
                    <div className="inline-flex rounded-2xl bg-emerald-500/10 p-5 mb-8 ring-1 ring-inset ring-emerald-500/20">
                        <div className="w-10 h-10 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" />
                    </div>
                    <h2 className="text-xl font-bold text-white mb-3">Ukládám konfiguraci</h2>
                    <p className="text-white/40 text-sm">Zapisuji do databáze, vytvářím bucket...</p>
                </div>
            )}

            {/* ═══ STEP 7: Done ═══ */}
            {step === 'done' && onboarded && (
                <div className="py-8">
                    <div className="text-center mb-8">
                        <div className="inline-flex rounded-2xl bg-emerald-500/10 p-5 mb-6 ring-1 ring-inset ring-emerald-500/20">
                            <svg className="w-10 h-10 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <h2 className="text-2xl font-bold text-white mb-2">Klient onboardován! 🎉</h2>
                        <p className="text-white/40 mb-1">{onboarded.name}</p>
                        <p className="text-xs text-white/20 font-mono">slug: {onboarded.slug}</p>
                    </div>

                    {/* Image Brief / Shot List */}
                    {briefLoading && (
                        <div className="p-6 bg-white/5 border border-white/10 rounded-xl mb-6 text-center">
                            <div className="w-6 h-6 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin mx-auto mb-3" />
                            <p className="text-sm text-white/40">Generuji shot list...</p>
                        </div>
                    )}

                    {imageBrief.length > 0 && (
                        <div className="p-6 bg-white/5 border border-white/10 rounded-xl mb-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="font-bold text-white text-sm">📸 Shot list pro klienta</h3>
                                <button
                                    onClick={copyBriefToClipboard}
                                    className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white/50 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
                                >
                                    📋 Kopírovat
                                </button>
                            </div>
                            <div className="space-y-4">
                                {imageBrief.map((cat, i) => (
                                    <div key={i}>
                                        <div className="flex items-center gap-2 mb-2">
                                            <span>{cat.emoji}</span>
                                            <span className="text-sm font-medium text-white/80">{cat.category}</span>
                                            <span className="text-[10px] text-white/30">({cat.count})</span>
                                            {cat.priority === 'must' && <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/20">DŮLEŽITÉ</span>}
                                        </div>
                                        <div className="space-y-1 ml-6">
                                            {cat.items.map((item, j) => (
                                                <div key={j} className="flex items-start gap-2 text-xs text-white/50">
                                                    <span className="text-white/20 mt-0.5">□</span>
                                                    <span>{item}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <p className="mt-4 text-[10px] text-white/30">
                                Pošli tento seznam klientovi — fotky pak nahraj v sekci &quot;Brand & Fotky&quot; v dashboardu.
                            </p>
                        </div>
                    )}

                    <div className="flex gap-3 justify-center">
                        <button
                            onClick={handleReset}
                            className="px-6 py-3 rounded-lg bg-emerald-600 text-sm font-medium text-white transition-all hover:bg-emerald-500 cursor-pointer"
                        >
                            ➕ Onboardovat dalšího
                        </button>
                        <button
                            onClick={() => window.location.reload()}
                            className="px-6 py-3 rounded-lg bg-white/10 border border-white/10 text-sm font-medium text-white/70 transition-all hover:bg-white/15 cursor-pointer"
                        >
                            ↻ Obnovit dashboard
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

// ─── Sub-components ──────────────────────────────────────────

function ErrorBanner({ message }: { message: string }) {
    return (
        <div className="mb-4 rounded-lg bg-red-500/10 p-3 border border-red-500/20">
            <p className="text-sm text-red-400">⚠️ {message}</p>
        </div>
    )
}

function LoadingStep({ label, active }: { label: string; active?: boolean }) {
    return (
        <div className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all ${active ? 'bg-white/5 border border-white/10' : 'opacity-40'}`}>
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
        <div className={`bg-white/5 border ${borderColor} rounded-xl p-5 transition-all`}>
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
