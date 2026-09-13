'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from "next-intl"
import { checkIsAdmin, transferClientToUser } from '@/app/actions/admin-actions'
import {
    startWebsiteAnalysis,
    startManualAnalysis,
    startConfigPreview,
    refineConfigSection,
    saveReviewedConfig,
    ensureImageBrief,
    startOnboardingBootstrap,
} from '@/app/onboarding/actions'
import { awaitOnboardingTask, humanizeClientError } from '@/app/onboarding/task-client'
import { TaskProgress } from '@/app/onboarding/TaskProgress'
import type { WebsiteAnalysis, OnboardingQuestion, ReviewSection } from '@/app/onboarding/types'
import type { ClientConfig, ImageBriefItem } from '@/instagram/configs/types'
import { Anchor, Camera, ChartColumn, Check, CircleCheck, ClipboardList, Globe, Mic, Package, Palette, Pencil, Plus, Rocket, Search, ThumbsUp, TriangleAlert, type LucideIcon } from "lucide-react"

type Step = 'choose' | 'input' | 'manual' | 'analyzing' | 'questions' | 'building' | 'review' | 'saving' | 'done'

interface OnboardedClient {
    name: string
    slug: string
}

export function OnboardTab() {
    const t = useTranslations("adminOnboard")
    const REVIEW_SECTIONS: { id: ReviewSection; Icon: LucideIcon; title: string }[] = [
        { id: 'brand_voice', Icon: Mic, title: t("sections.brand_voice") },
        { id: 'pillars', Icon: ChartColumn, title: t("sections.pillars") },
        { id: 'products', Icon: Package, title: t("sections.products") },
        { id: 'visual', Icon: Palette, title: t("sections.visual") },
        { id: 'hooks_cta', Icon: Anchor, title: t("sections.hooks_cta") },
    ]
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
    // Analýza žije jako agent_task; config si z něj vstup vezme sám na serveru.
    const [analyzeTaskId, setAnalyzeTaskId] = useState<string | null>(null)
    const [taskProgress, setTaskProgress] = useState<{ progress: number; message: string }>({ progress: 0, message: '' })
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
    // Předání značky jejímu majiteli — onboarding ji jinak nechá viset na účtu správce.
    const [handoffEmail, setHandoffEmail] = useState('')
    const [handoffRelease, setHandoffRelease] = useState(false)
    const [handoffBusy, setHandoffBusy] = useState(false)
    const [handoffCopied, setHandoffCopied] = useState(false)
    const [handoffResult, setHandoffResult] = useState<{ ok: boolean; text: string; inviteUrl?: string | null } | null>(null)

    // Session history
    const [history, setHistory] = useState<OnboardedClient[]>([])

    useEffect(() => {
        checkIsAdmin().then(setIsAdmin)
    }, [])

    // Zvýrazněný kus věty v návodu — ve zprávě je <strong>, vykreslí se stejný span jako dřív.
    const howItWorksStrong = (chunks: React.ReactNode) => <span className="text-white/70">{chunks}</span>

    // ─── Step 1A → 2: Analyze website ────────────────────────
    // Práce běží jako durable agent_task — prohlížeč ji jen zařadí, šťouchne a ptá se.
    // Věty, které vznikají v prohlížeči (ne na serveru), jdou v jazyce UI; průběh
    // a chyby ze serveru se zobrazují tak, jak přijdou.
    const taskMessages = { connectionLost: t("errors.connectionLost"), taskFailed: t("errors.taskFailed"), taskTimeout: t("errors.taskTimeout") }
    const awaitTask = <T,>(taskId: string) => awaitOnboardingTask<T>(taskId, setTaskProgress, taskMessages)

    type AnalyzeResult = { analysis: WebsiteAnalysis; questions: OnboardingQuestion[] }
    type StartResult = { success: boolean; taskId?: string; error?: string }

    /**
     * Společný běh obou cest analýzy. Zařazení MUSÍ být uvnitř try: i krátká server
     * action je fetch, a když se rozpadne, vyletí syrové „Failed to fetch" jako
     * neošetřená chyba a průvodce zamrzne na točícím se kolečku.
     */
    async function runAnalysis(start: () => Promise<StartResult>, backTo: Step) {
        try {
            const started = await start()
            if (!started.success || !started.taskId) throw new Error(started.error || t("errors.analysisFailed"))
            setAnalyzeTaskId(started.taskId)
            const { analysis, questions } = await awaitTask<AnalyzeResult>(started.taskId)
            setAnalysis(analysis)
            setQuestions(questions)
            setStep('questions')
        } catch (err) {
            setError(humanizeClientError(err, taskMessages))
            setStep(backTo)
        }
    }

    async function handleAnalyze(e: React.FormEvent) {
        e.preventDefault()
        if (!url.trim()) return

        setError(null)
        setTaskProgress({ progress: 0, message: '' })
        setStep('analyzing')

        await runAnalysis(() => startWebsiteAnalysis(url.trim(), igHandle.trim()), 'input')
    }

    // ─── Step 1B → 2: Manual analyze ──────────────────────────
    async function handleManualSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!businessName.trim() || !category || !manualDescription.trim()) return

        setError(null)
        setTaskProgress({ progress: 0, message: '' })
        setStep('analyzing')

        await runAnalysis(() => startManualAnalysis({
            businessName: businessName.trim(),
            category,
            description: manualDescription.trim(),
            products: manualProducts.trim(),
            tone: manualTone || 'přátelský', // i18n-ignore: hodnota jde doslova do promptu analýzy (core.ts), ne do UI
            igHandle: igHandle.trim(),
            targetAudience: targetAudience.trim() || undefined,
            competitors: competitors.trim() || undefined,
            visualStyle: visualStyle || undefined,
            followerCount: followerCount ? parseInt(followerCount) : undefined,
            topLocations: topLocations.trim() || undefined,
            audienceGender: (audienceGender as any) || undefined,
        }), 'manual')
    }

    // ─── Step 3 → 4: Generate config preview ─────────────────
    async function handleSubmitAnswers(e: React.FormEvent) {
        e.preventDefault()
        if (!analysis || !analyzeTaskId) return

        setError(null)
        setTaskProgress({ progress: 0, message: '' })
        setStep('building')

        try {
            const started = await startConfigPreview(analyzeTaskId, answers, url.trim(), igHandle.trim())
            if (!started.success || !started.taskId) {
                throw new Error(started.error || t("errors.configFailed"))
            }
            const { config } = await awaitTask<{ config: ClientConfig }>(started.taskId)
            setConfigPreview(config)
            // Reset review state
            setSectionStatuses({ brand_voice: 'pending', pillars: 'pending', products: 'pending', visual: 'pending', hooks_cta: 'pending' })
            setSectionFeedback({ brand_voice: '', pillars: '', products: '', visual: '', hooks_cta: '' })
            setRefineCounts({ brand_voice: 0, pillars: 0, products: 0, visual: 0, hooks_cta: 0 })
            setStep('review')
        } catch (err) {
            setError(humanizeClientError(err, taskMessages))
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
                throw new Error(result.error || t("errors.saveFailed"))
            }

            const client = { name: analysis.companyName, slug: result.clientSlug || '' }
            setOnboarded(client)
            setHistory(prev => [...prev, client])
            setStep('done')

            // Značka založená odsud dostane TOTÉŽ, co značka z `/onboarding`.
            // Do 9/2026 tenhle řádek chyběl a `startOnboardingBootstrap` volala
            // jen průvodce na `/onboarding` — klient onboardovaný z admin záložky
            // tak neměl teaser plán, prázdný zásobník nápadů a nula ukázkových
            // příspěvků. Vypadalo to, že engine nic neumí, přitom se jen nikdy
            // nespustil. Nefatální stejně jako v průvodci: značka existuje i bez
            // obsahu, jen je prázdná.
            startOnboardingBootstrap(client.slug)
                .then(boot => { if (!boot.success) console.warn('Bootstrap selhal (nefatální):', boot.error) })
                .catch(bootErr => console.warn('Bootstrap selhal (nefatální):', bootErr))

            // Shot list na pozadí. Generování i zápis do configu drží server
            // (ensureImageBrief) — dřív se to skládalo ze tří volání odsud a zavřená
            // karta znamenala, že se brief nikdy neuložil.
            setBriefLoading(true)
            ensureImageBrief(client.slug, { force: true })
                .then(res => { if (res.success && res.brief) setImageBrief(res.brief) })
                .finally(() => setBriefLoading(false))
        } catch (err) {
            setError(humanizeClientError(err, taskMessages))
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

    async function handleHandoff() {
        if (!onboarded) return
        setHandoffBusy(true)
        setHandoffResult(null)
        try {
            const res = await transferClientToUser(onboarded.slug, handoffEmail, { releaseAdminAccess: handoffRelease })
            setHandoffResult({
                ok: !!res.success,
                text: res.success ? (res.message || t("done.handoff.success")) : (res.error || t("done.handoff.failed")),
                inviteUrl: res.inviteUrl,
            })
            if (res.success) setHandoffEmail('')
        } catch (err) {
            setHandoffResult({ ok: false, text: err instanceof Error ? err.message : t("done.handoff.failed") })
        } finally {
            setHandoffBusy(false)
        }
    }

    function copyBriefToClipboard() {
        const text = imageBrief.map(cat =>
            `${cat.emoji} ${cat.category} (${cat.count})\n${cat.items.map(item => `  □ ${item}`).join('\n')}`
        ).join('\n\n')
        navigator.clipboard.writeText(`${t("done.brief.clipboardTitle", { name: onboarded?.name || t("done.brief.clipboardFallbackName") })}\n${'━'.repeat(30)}\n\n${text}`)
    }

    // ─── Access guard ────────────────────────────────────────
    if (isAdmin === null) {
        return <div className="text-center py-20 text-white/40">{t("access.checking")}</div>
    }
    if (!isAdmin) {
        return (
            <div className="text-center py-20">
                <div className="text-4xl mb-4">🔒</div>
                <p className="text-white/50">{t("access.adminsOnly")}</p>
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
                        <h2 className="inline-flex items-center gap-1.5 text-2xl font-bold text-white mb-2"><Plus className="w-5 h-5 shrink-0" />{t("choose.title")}</h2>
                        <p className="text-white/50 text-sm">{t("choose.subtitle")}</p>
                    </div>

                    {/* Postup — nejčastější dotaz obchodu: „musí se klient registrovat?"
                        Odpověď patří sem, kde se onboarduje, ne do dokumentace, kterou
                        si nikdo neotevře uprostřed hovoru s klientem. */}
                    <details className="mb-4 bg-white/[0.03] border border-white/10 rounded-xl">
                        <summary className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-white/50 cursor-pointer hover:text-white/80 transition-colors">
                            {t("choose.howItWorks.summary")}
                        </summary>
                        <div className="px-4 pb-4 pt-1 space-y-2 text-[11px] text-white/50 leading-relaxed">
                            <p><span className="text-white/70 font-bold">1.</span> {t("choose.howItWorks.step1")}</p>
                            <p><span className="text-white/70 font-bold">2.</span> {t("choose.howItWorks.step2")}</p>
                            <p><span className="text-white/70 font-bold">3.</span> {t.rich("choose.howItWorks.step3", { strong: howItWorksStrong })}</p>
                            <p><span className="text-white/70 font-bold">4.</span> {t.rich("choose.howItWorks.step4", { strong: howItWorksStrong })}</p>
                            <p><span className="text-white/70 font-bold">5.</span> {t.rich("choose.howItWorks.step5", { strong: howItWorksStrong })}</p>
                            <p className="text-white/30 pt-1">{t("choose.howItWorks.docs")}</p>
                        </div>
                    </details>

                    <div className="grid grid-cols-2 gap-3">
                        <button
                            onClick={() => setStep('input')}
                            className="p-5 bg-white/5 border border-white/10 rounded-xl text-left hover:border-emerald-500/40 transition-all cursor-pointer group"
                        >
                            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center text-lg mb-3 group-hover:scale-110 transition-transform">🌐</div>
                            <h3 className="font-bold text-white text-sm mb-1">{t("choose.withWebsite.title")}</h3>
                            <p className="text-xs text-white/40">{t("choose.withWebsite.body")}</p>
                        </button>
                        <button
                            onClick={() => setStep('manual')}
                            className="p-5 bg-white/5 border border-white/10 rounded-xl text-left hover:border-blue-500/40 transition-all cursor-pointer group"
                        >
                            <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center text-lg mb-3 group-hover:scale-110 transition-transform">✏️</div>
                            <h3 className="font-bold text-white text-sm mb-1">{t("choose.withoutWebsite.title")}</h3>
                            <p className="text-xs text-white/40">{t("choose.withoutWebsite.body")}</p>
                        </button>
                    </div>

                    {/* History */}
                    {history.length > 0 && (
                        <div className="mt-8 p-4 bg-white/5 border border-white/10 rounded-xl">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-white/40 mb-3">{t("choose.historyTitle")}</h4>
                            <div className="space-y-2">
                                {history.map((c, i) => (
                                    <div key={i} className="flex items-center gap-2 text-sm text-white/60">
                                        <Check className="w-4 h-4 text-emerald-400" />
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
                        <h2 className="inline-flex items-center gap-1.5 text-2xl font-bold text-white mb-2"><Globe className="w-5 h-5 shrink-0" />{t("input.title")}</h2>
                        <p className="text-white/50 text-sm">{t("input.subtitle")}</p>
                    </div>

                    {error && <ErrorBanner message={error} />}

                    <form onSubmit={handleAnalyze} className="space-y-5">
                        <div className="p-6 bg-white/5 border border-white/10 rounded-xl space-y-5">
                            <div>
                                <label htmlFor="onboard-url" className="block text-sm font-medium text-gray-300 mb-2">{t("input.urlLabel")}</label>
                                <input
                                    id="onboard-url"
                                    type="text"
                                    value={url}
                                    onChange={e => setUrl(e.target.value)}
                                    required
                                    placeholder={t("input.urlPlaceholder")}
                                    className="w-full px-4 py-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition-all text-sm"
                                />
                            </div>
                            <div>
                                <label htmlFor="onboard-ig" className="block text-sm font-medium text-gray-300 mb-2">{t("input.igLabel")}</label>
                                <input
                                    id="onboard-ig"
                                    type="text"
                                    value={igHandle}
                                    onChange={e => setIgHandle(e.target.value)}
                                    placeholder={t("input.igPlaceholder")}
                                    className="w-full px-4 py-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition-all text-sm"
                                />
                                <p className="mt-1.5 text-xs text-gray-500">{t("input.optional")}</p>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button type="button" onClick={() => setStep('choose')} className="px-4 py-3.5 rounded-lg border border-white/10 text-sm text-gray-400 hover:text-white transition-all cursor-pointer">{t("common.back")}</button>
                            <button
                                type="submit"
                                className="flex-1 rounded-lg bg-emerald-600 px-6 py-3.5 text-sm font-medium text-white transition-all hover:bg-emerald-500 cursor-pointer"
                            ><Search className="w-3.5 h-3.5 shrink-0" />{t("input.analyze")}</button>
                        </div>
                    </form>
                </div>
            )}

            {/* ═══ STEP 1B: Manual form ═══ */}
            {step === 'manual' && (
                <div>
                    <div className="mb-8">
                        <h2 className="inline-flex items-center gap-1.5 text-2xl font-bold text-white mb-2"><Pencil className="w-5 h-5 shrink-0" />{t("manual.title")}</h2>
                        <p className="text-white/50 text-sm">{t("manual.subtitle")}</p>
                    </div>

                    {error && <ErrorBanner message={error} />}

                    <form onSubmit={handleManualSubmit} className="space-y-5">
                        {/* Core fields */}
                        <div className="p-6 bg-white/5 border border-white/10 rounded-xl space-y-5">
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">{t("manual.nameLabel")}</label>
                                <input type="text" value={businessName} onChange={e => setBusinessName(e.target.value)} required placeholder={t("manual.namePlaceholder")} className="w-full px-4 py-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all text-sm" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">{t("manual.categoryLabel")}</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {[
                                        { id: 'kavarna', label: t("manual.category.kavarna") },
                                        { id: 'restaurace', label: t("manual.category.restaurace") },
                                        { id: 'salon', label: t("manual.category.salon") },
                                        { id: 'fitness', label: t("manual.category.fitness") },
                                        { id: 'eshop', label: t("manual.category.eshop") },
                                        { id: 'remeslnik', label: t("manual.category.remeslnik") },
                                        { id: 'poradce', label: t("manual.category.poradce") },
                                        { id: 'fotograf', label: t("manual.category.fotograf") },
                                        { id: 'jine', label: t("manual.category.jine") },
                                    ].map(cat => (
                                        <button key={cat.id} type="button" onClick={() => setCategory(cat.id)}
                                            className={`px-3 py-2 rounded-lg text-sm transition-all cursor-pointer text-left ${
                                                category === cat.id ? 'bg-blue-500/20 border-blue-500/50 text-blue-300 border' : 'bg-black/30 border border-white/10 text-gray-300 hover:border-white/20'
                                            }`}>{cat.label}</button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">{t("manual.descriptionLabel")}</label>
                                <textarea value={manualDescription} onChange={e => setManualDescription(e.target.value)} required placeholder={t("manual.descriptionPlaceholder")} rows={3} className="w-full px-4 py-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all text-sm resize-none" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">{t("manual.productsLabel")} <span className="text-gray-500">{t("manual.productsHint")}</span></label>
                                <input type="text" value={manualProducts} onChange={e => setManualProducts(e.target.value)} placeholder={t("manual.productsPlaceholder")} className="w-full px-4 py-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all text-sm" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">{t("manual.toneLabel")}</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {[
                                        { id: 'přátelský', label: t("manual.tone.friendly") }, // i18n-ignore: id jde doslova do promptu analýzy (core.ts), ne do UI
                                        { id: 'profesionální', label: t("manual.tone.professional") }, // i18n-ignore: id jde doslova do promptu analýzy (core.ts), ne do UI
                                        { id: 'drzý', label: t("manual.tone.cheeky") }, // i18n-ignore: id jde doslova do promptu analýzy (core.ts), ne do UI
                                        { id: 'expertní', label: t("manual.tone.expert") }, // i18n-ignore: id jde doslova do promptu analýzy (core.ts), ne do UI
                                    ].map(tone => (
                                        <button key={tone.id} type="button" onClick={() => setManualTone(tone.id)}
                                            className={`px-3 py-2 rounded-lg text-sm transition-all cursor-pointer text-left ${
                                                manualTone === tone.id ? 'bg-blue-500/20 border-blue-500/50 text-blue-300 border' : 'bg-black/30 border border-white/10 text-gray-300 hover:border-white/20'
                                            }`}>{tone.label}</button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">{t("manual.igLabel")} <span className="text-gray-500">{t("manual.igOptional")}</span></label>
                                <input type="text" value={igHandle} onChange={e => setIgHandle(e.target.value)} placeholder={t("manual.igPlaceholder")} className="w-full px-4 py-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all text-sm" />
                            </div>
                        </div>

                        {/* Enhanced fields */}
                        <div className="p-6 bg-white/5 border border-white/10 rounded-xl space-y-5">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-white/40">{t("manual.enhancedTitle")}</h4>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">{t("manual.audienceLabel")}</label>
                                <textarea value={targetAudience} onChange={e => setTargetAudience(e.target.value)} placeholder={t("manual.audiencePlaceholder")} rows={2} className="w-full px-4 py-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all text-sm resize-none" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">{t("manual.competitorsLabel")}</label>
                                <input type="text" value={competitors} onChange={e => setCompetitors(e.target.value)} placeholder={t("manual.competitorsPlaceholder")} className="w-full px-4 py-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all text-sm" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">{t("manual.visualStyleLabel")}</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {[
                                        { id: 'tmavý', label: t("manual.visualStyle.dark") }, // i18n-ignore: id jde doslova do promptu analýzy (core.ts), ne do UI
                                        { id: 'světlý', label: t("manual.visualStyle.light") }, // i18n-ignore: id jde doslova do promptu analýzy (core.ts), ne do UI
                                        { id: 'barevný', label: t("manual.visualStyle.colorful") }, // i18n-ignore: id jde doslova do promptu analýzy (core.ts), ne do UI
                                        { id: 'minimalistický', label: t("manual.visualStyle.minimalist") }, // i18n-ignore: id jde doslova do promptu analýzy (core.ts), ne do UI
                                        { id: 'luxusní', label: t("manual.visualStyle.luxury") }, // i18n-ignore: id jde doslova do promptu analýzy (core.ts), ne do UI
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
                            <h4 className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-white/40"><ChartColumn className="w-3.5 h-3.5 shrink-0" />{t("manual.insightsTitle")}</h4>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">{t("manual.followersLabel")}</label>
                                    <input type="number" value={followerCount} onChange={e => setFollowerCount(e.target.value)} placeholder={t("manual.followersPlaceholder")} className="w-full px-4 py-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all text-sm" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-2">{t("manual.locationsLabel")}</label>
                                    <input type="text" value={topLocations} onChange={e => setTopLocations(e.target.value)} placeholder={t("manual.locationsPlaceholder")} className="w-full px-4 py-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all text-sm" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">{t("manual.genderLabel")}</label>
                                <div className="grid grid-cols-4 gap-2">
                                    {[
                                        { id: 'mostly_female', label: t("manual.gender.mostly_female") },
                                        { id: 'mostly_male', label: t("manual.gender.mostly_male") },
                                        { id: 'mixed', label: t("manual.gender.mixed") },
                                        { id: 'unknown', label: t("manual.gender.unknown") },
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
                            <button type="button" onClick={() => setStep('choose')} className="px-4 py-3.5 rounded-lg border border-white/10 text-sm text-gray-400 hover:text-white transition-all cursor-pointer">{t("common.back")}</button>
                            <button
                                type="submit"
                                disabled={!businessName || !category || !manualDescription}
                                className="flex-1 rounded-lg bg-blue-600 px-6 py-3.5 text-sm font-medium text-white transition-all hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                            ><Rocket className="w-3.5 h-3.5 shrink-0" />{t("manual.submit")}</button>
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
                    <h2 className="text-xl font-bold text-white mb-3">{t("analyzing.title")}</h2>
                    <p className="text-white/40 text-sm mb-8">{t("analyzing.body")}</p>
                    <TaskProgress {...taskProgress} accent="bg-blue-400" />
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
                        <h3 className="text-lg font-bold text-white">{t("questions.title")}</h3>
                        <p className="text-white/40 text-xs mt-1">{t("questions.subtitle")}</p>
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
                                                    }`}>{selected ? '' : ''}{option}</button>
                                            )
                                        })}
                                    </div>
                                )}

                                {q.type === 'text' && (
                                    <textarea
                                        value={(answers[q.id] as string) || ''}
                                        onChange={e => setAnswer(q.id, e.target.value)}
                                        placeholder={q.placeholder || t("questions.answerPlaceholder")}
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
                            className="inline-flex items-center gap-1.5 justify-center w-full rounded-lg bg-emerald-600 px-6 py-3.5 text-sm font-medium text-white transition-all hover:bg-emerald-500 cursor-pointer"
                        ><Rocket className="w-3.5 h-3.5 shrink-0" />{t("questions.submit")}</button>
                    </form>
                </div>
            )}

            {/* ═══ STEP 4: Building ═══ */}
            {step === 'building' && (
                <div className="text-center py-16">
                    <div className="inline-flex rounded-2xl bg-purple-500/10 p-5 mb-8 ring-1 ring-inset ring-purple-500/20">
                        <div className="w-10 h-10 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin" />
                    </div>
                    <h2 className="text-xl font-bold text-white mb-3">{t("building.title")}</h2>
                    <p className="text-white/40 text-sm mb-8">{t("building.body")}</p>
                    <TaskProgress {...taskProgress} accent="bg-purple-400" />
                </div>
            )}

            {/* ═══ STEP 5: Review ═══ */}
            {step === 'review' && configPreview && (
                <div>
                    <div className="mb-6">
                        <h2 className="inline-flex items-center gap-1.5 text-xl font-bold text-white mb-1"><ClipboardList className="w-4 h-4 shrink-0" />{t("review.title")}</h2>
                        <p className="text-white/40 text-sm">{t("review.subtitle")}</p>
                    </div>

                    {error && <ErrorBanner message={error} />}

                    <div className="space-y-4">
                        {/* Brand Voice */}
                        <ReviewCard
                            section="brand_voice" Icon={Mic} title={t("sections.brand_voice")}
                            status={sectionStatuses.brand_voice} feedback={sectionFeedback.brand_voice}
                            refineCount={refineCounts.brand_voice} isRefining={sectionStatuses.brand_voice === 'refining'}
                            onApprove={() => approveSection('brand_voice')} onReject={() => rejectSection('brand_voice')}
                            onFeedbackChange={v => setSectionFeedback(p => ({ ...p, brand_voice: v }))}
                            onRefine={() => handleRefineSection('brand_voice')}
                        >
                            <div className="space-y-2">
                                <ReviewField label={t("review.fields.persona")} value={configPreview.brandVoice?.persona} />
                                <ReviewField label={t("review.fields.voiceTraits")} value={configPreview.brandVoice?.voiceTraits?.join(', ')} />
                                <ReviewField label={t("review.fields.antiPatterns")} value={configPreview.brandVoice?.antiPatterns?.slice(0, 3).join(' • ')} />
                            </div>
                        </ReviewCard>

                        {/* Pillars */}
                        <ReviewCard
                            section="pillars" Icon={ChartColumn} title={t("sections.pillars")}
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
                            section="products" Icon={Package} title={t("sections.products")}
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
                                    <span className="text-xs text-white/30">{t("review.noProducts")}</span>
                                )}
                            </div>
                        </ReviewCard>

                        {/* Visual */}
                        <ReviewCard
                            section="visual" Icon={Palette} title={t("sections.visual")}
                            status={sectionStatuses.visual} feedback={sectionFeedback.visual}
                            refineCount={refineCounts.visual} isRefining={sectionStatuses.visual === 'refining'}
                            onApprove={() => approveSection('visual')} onReject={() => rejectSection('visual')}
                            onFeedbackChange={v => setSectionFeedback(p => ({ ...p, visual: v }))}
                            onRefine={() => handleRefineSection('visual')}
                        >
                            <div className="space-y-2">
                                <ReviewField label={t("review.fields.visualStyle")} value={configPreview.feedAesthetic?.feel} />
                                {configPreview.overlayGradient && (
                                    <div>
                                        <span className="block text-gray-500 text-[10px] uppercase font-bold tracking-wider mb-1">{t("review.fields.gradient")}</span>
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
                            section="hooks_cta" Icon={Anchor} title={t("sections.hooks_cta")}
                            status={sectionStatuses.hooks_cta} feedback={sectionFeedback.hooks_cta}
                            refineCount={refineCounts.hooks_cta} isRefining={sectionStatuses.hooks_cta === 'refining'}
                            onApprove={() => approveSection('hooks_cta')} onReject={() => rejectSection('hooks_cta')}
                            onFeedbackChange={v => setSectionFeedback(p => ({ ...p, hooks_cta: v }))}
                            onRefine={() => handleRefineSection('hooks_cta')}
                        >
                            <div className="space-y-2">
                                <ReviewField label={t("review.fields.hookTemplates")} value={configPreview.brandVoice?.hookTemplates?.slice(0, 3).join(' | ')} />
                                <ReviewField label={t("review.fields.ctaSoft")} value={configPreview.ctaStrategies?.soft?.slice(0, 2).join(' | ')} />
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
                            {allApproved ? t("review.save") : t("review.approveAll", { approved: REVIEW_SECTIONS.filter(s => sectionStatuses[s.id] === 'approved').length, total: REVIEW_SECTIONS.length })}
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
                    <h2 className="text-xl font-bold text-white mb-3">{t("saving.title")}</h2>
                    <p className="text-white/40 text-sm">{t("saving.body")}</p>
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
                        <h2 className="text-2xl font-bold text-white mb-2">{t("done.title")}</h2>
                        <p className="text-white/40 mb-1">{onboarded.name}</p>
                        <p className="text-xs text-white/20 font-mono">{t("done.slug", { slug: onboarded.slug })}</p>
                    </div>

                    {/* Předání majiteli. Onboarding zapsal vazbu na TVŮJ účet — bez
                        tohohle kroku zákazník svoji značku v dashboardu neuvidí. */}
                    <div className="p-6 bg-white/5 border border-white/10 rounded-xl mb-6">
                        <h3 className="inline-flex items-center gap-1.5 font-bold text-white text-sm mb-1"><Rocket className="w-3.5 h-3.5 shrink-0" />{t("done.handoff.title")}</h3>
                        <p className="text-[11px] text-white/30 mb-4 leading-relaxed">
                            {t("done.handoff.body")}
                        </p>
                        <div className="flex flex-col sm:flex-row gap-2">
                            <input
                                type="email"
                                value={handoffEmail}
                                onChange={e => setHandoffEmail(e.target.value)}
                                placeholder={t("done.handoff.emailPlaceholder")}
                                disabled={handoffBusy}
                                className="flex-1 px-4 py-2.5 rounded-lg bg-[#050505] border border-white/10 text-white placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 text-sm"
                            />
                            <button
                                onClick={handleHandoff}
                                disabled={handoffBusy || !handoffEmail.trim()}
                                className="px-5 py-2.5 rounded-lg bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 text-xs font-bold uppercase tracking-widest hover:bg-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
                            >{handoffBusy ? t("done.handoff.submitting") : t("done.handoff.submit")}</button>
                        </div>
                        <label className="mt-3 flex items-center gap-2 text-[11px] text-white/30 cursor-pointer">
                            <input type="checkbox" checked={handoffRelease} onChange={e => setHandoffRelease(e.target.checked)} className="accent-emerald-500" />
                            {t("done.handoff.release")}
                        </label>
                        {handoffResult && (
                            <div className="mt-3 space-y-2">
                                <p className={`text-xs ${handoffResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>{handoffResult.text}</p>
                                {/* Odkaz s kódem — když pošta selže (nebo skončí ve spamu),
                                    tohle je jediná cesta, jak se zákazník k registraci dostane. */}
                                {handoffResult.inviteUrl && (
                                    <button
                                        onClick={() => { navigator.clipboard.writeText(handoffResult.inviteUrl!); setHandoffCopied(true); setTimeout(() => setHandoffCopied(false), 2000) }}
                                        className="text-[10px] uppercase tracking-widest font-bold text-white/40 hover:text-white transition-colors cursor-pointer"
                                    >
                                        {handoffCopied ? t("done.handoff.copied") : t("done.handoff.copyInvite")}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Image Brief / Shot List */}
                    {briefLoading && (
                        <div className="p-6 bg-white/5 border border-white/10 rounded-xl mb-6 text-center">
                            <div className="w-6 h-6 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin mx-auto mb-3" />
                            <p className="text-sm text-white/40">{t("done.brief.loading")}</p>
                        </div>
                    )}

                    {imageBrief.length > 0 && (
                        <div className="p-6 bg-white/5 border border-white/10 rounded-xl mb-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="inline-flex items-center gap-1.5 font-bold text-white text-sm"><Camera className="w-3.5 h-3.5 shrink-0" />{t("done.brief.title")}</h3>
                                <button
                                    onClick={copyBriefToClipboard}
                                    className="inline-flex items-center gap-1.5 justify-center px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white/50 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
                                ><ClipboardList className="w-3.5 h-3.5 shrink-0" />{t("done.brief.copy")}</button>
                            </div>
                            <div className="space-y-4">
                                {imageBrief.map((cat, i) => (
                                    <div key={i}>
                                        <div className="flex items-center gap-2 mb-2">
                                            <span>{cat.emoji}</span>
                                            <span className="text-sm font-medium text-white/80">{cat.category}</span>
                                            <span className="text-[10px] text-white/30">({cat.count})</span>
                                            {cat.priority === 'must' && <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/20">{t("done.brief.must")}</span>}
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
                                {t("done.brief.footer")}
                            </p>
                        </div>
                    )}

                    <div className="flex gap-3 justify-center">
                        <button
                            onClick={handleReset}
                            className="inline-flex items-center gap-1.5 justify-center px-6 py-3 rounded-lg bg-emerald-600 text-sm font-medium text-white transition-all hover:bg-emerald-500 cursor-pointer"
                        ><Plus className="w-3.5 h-3.5 shrink-0" />{t("done.onboardAnother")}</button>
                        <button
                            onClick={() => window.location.reload()}
                            className="px-6 py-3 rounded-lg bg-white/10 border border-white/10 text-sm font-medium text-white/70 transition-all hover:bg-white/15 cursor-pointer"
                        >
                            {t("done.reload")}
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
            <p className="text-sm text-red-400"><TriangleAlert className="w-3.5 h-3.5 shrink-0 inline-block align-[-2px] mr-1" />{message}</p>
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
    Icon,
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
    Icon: LucideIcon
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
    const t = useTranslations("adminOnboard")
    const maxRefines = 3
    const borderColor = status === 'approved' ? 'border-emerald-500/30'
        : status === 'rejected' ? 'border-amber-500/30'
            : status === 'refining' ? 'border-purple-500/30'
                : 'border-white/10'

    return (
        <div className={`bg-white/5 border ${borderColor} rounded-xl p-5 transition-all`}>
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4 shrink-0 text-white/60" />
                    <h3 className="font-bold text-sm text-white">{title}</h3>
                    {status === 'approved' && <CircleCheck className="w-4 h-4 text-emerald-400" />}
                    {status === 'refining' && <span className="text-purple-400 text-xs animate-pulse">{t("review.card.refining")}</span>}
                    {refineCount > 0 && <span className="text-[9px] text-gray-500 font-mono">{t("review.card.version", { n: refineCount + 1 })}</span>}
                </div>
                <div className="flex gap-1.5">
                    <button onClick={onApprove}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                            status === 'approved'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : 'bg-white/5 text-gray-400 border border-white/10 hover:text-emerald-300 hover:border-emerald-500/30'
                        }`}><span className="inline-flex items-center gap-1.5"><ThumbsUp className="w-3.5 h-3.5 shrink-0" /> </span></button>
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
                        placeholder={t("review.card.feedbackPlaceholder")}
                        rows={2}
                        className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition-all text-xs resize-none"
                    />
                    <div className="flex items-center justify-between">
                        <span className="text-[9px] text-gray-500">
                            {refineCount >= maxRefines ? t("review.card.maxRefines") : t("review.card.attempt", { n: refineCount + 1, max: maxRefines })}
                        </span>
                        <button
                            onClick={onRefine}
                            disabled={!feedback.trim() || isRefining || refineCount >= maxRefines}
                            className="px-4 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-medium hover:bg-amber-500/30 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {isRefining ? t("review.card.refineBusy") : t("review.card.refine")}
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
