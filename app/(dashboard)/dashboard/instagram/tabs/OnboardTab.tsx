'use client'

import { useState, useEffect } from 'react'
import {
    checkIsAdmin,
    analyzeWebsite,
    generateQuestions,
    buildAndSaveConfig,
} from '@/app/actions/admin-onboard-actions'
import type { WebsiteAnalysis, OnboardingQuestion } from '@/app/actions/admin-onboard-actions'

type Step = 'input' | 'analyzing' | 'questions' | 'building' | 'done'

interface OnboardedClient {
    name: string
    slug: string
}

export function OnboardTab() {
    const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
    const [step, setStep] = useState<Step>('input')
    const [url, setUrl] = useState('')
    const [igHandle, setIgHandle] = useState('')
    const [error, setError] = useState<string | null>(null)

    const [analysis, setAnalysis] = useState<WebsiteAnalysis | null>(null)
    const [questions, setQuestions] = useState<OnboardingQuestion[]>([])
    const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
    const [onboarded, setOnboarded] = useState<OnboardedClient | null>(null)

    // History of onboarded clients in this session
    const [history, setHistory] = useState<OnboardedClient[]>([])

    useEffect(() => {
        checkIsAdmin().then(setIsAdmin)
    }, [])

    // ─── Step 1 → 2: Analyze ─────────────────────────────────
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

    // ─── Step 3 → 4: Submit answers & build config ───────────
    async function handleSubmitAnswers(e: React.FormEvent) {
        e.preventDefault()
        if (!analysis) return

        setError(null)
        setStep('building')

        try {
            const result = await buildAndSaveConfig(analysis, answers, url.trim(), igHandle.trim())
            if (!result.success) {
                throw new Error(result.error || 'Generování konfigurace selhalo')
            }

            const client = { name: analysis.companyName, slug: result.clientSlug || '' }
            setOnboarded(client)
            setHistory(prev => [...prev, client])
            setStep('done')
        } catch (err) {
            setError((err as Error).message)
            setStep('questions')
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
        setStep('input')
        setUrl('')
        setIgHandle('')
        setError(null)
        setAnalysis(null)
        setQuestions([])
        setAnswers({})
        setOnboarded(null)
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
                        width: step === 'input' ? '0%'
                            : step === 'analyzing' ? '33%'
                                : step === 'questions' ? '66%'
                                    : '100%'
                    }}
                />
            </div>

            {/* ═══ STEP 1: Input ═══ */}
            {step === 'input' && (
                <div>
                    <div className="mb-8">
                        <h2 className="text-2xl font-bold text-white mb-2">➕ Onboardovat nového klienta</h2>
                        <p className="text-white/50 text-sm">Zadej web a Instagram klienta — AI analyzuje značku a vytvoří konfiguraci.</p>
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

                        <button
                            type="submit"
                            className="w-full rounded-lg bg-emerald-600 px-6 py-3.5 text-sm font-medium text-white transition-all hover:bg-emerald-500 cursor-pointer"
                        >
                            🔍 Analyzovat web
                        </button>
                    </form>

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

            {/* ═══ STEP 2: Analyzing ═══ */}
            {step === 'analyzing' && (
                <div className="text-center py-16">
                    <div className="inline-flex rounded-2xl bg-blue-500/10 p-5 mb-8 ring-1 ring-inset ring-blue-500/20">
                        <div className="w-10 h-10 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
                    </div>
                    <h2 className="text-xl font-bold text-white mb-3">AI analyzuje web klienta</h2>
                    <p className="text-white/40 text-sm mb-8">Scrapuji obsah, detekuji brand, analyzuji tón...</p>
                    <div className="max-w-sm mx-auto space-y-2 text-left">
                        <LoadingStep label="Stahuji homepage" active />
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
                        <p className="text-white/40 text-xs mt-1">Na základě analýzy webu máme pár doplňujících otázek.</p>
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
                                            <button
                                                key={option}
                                                type="button"
                                                onClick={() => setAnswer(q.id, option)}
                                                className={`px-3 py-2 rounded-lg text-sm transition-all cursor-pointer text-left ${answers[q.id] === option
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
                                                    className={`px-3 py-2 rounded-lg text-sm transition-all cursor-pointer text-left ${selected
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
                                        placeholder={q.placeholder || 'Napiš odpověď...'}
                                        rows={2}
                                        className="w-full px-4 py-3 rounded-lg bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition-all text-sm resize-none"
                                    />
                                )}

                                {q.type === 'scale' && (
                                    <div className="flex gap-2">
                                        {[1, 2, 3, 4, 5].map(n => (
                                            <button
                                                key={n}
                                                type="button"
                                                onClick={() => setAnswer(q.id, String(n))}
                                                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${answers[q.id] === String(n)
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
                    <p className="text-white/40 text-sm mb-8">AI staví brand voice, content pilíře, hashtag strategie...</p>
                    <div className="max-w-sm mx-auto space-y-2 text-left">
                        <LoadingStep label="Brand voice & persona" active />
                        <LoadingStep label="Content pilíře & strategie" />
                        <LoadingStep label="Hook templates & CTA" />
                        <LoadingStep label="Ukládám do databáze" />
                    </div>
                </div>
            )}

            {/* ═══ STEP 5: Done ═══ */}
            {step === 'done' && onboarded && (
                <div className="text-center py-12">
                    <div className="inline-flex rounded-2xl bg-emerald-500/10 p-5 mb-6 ring-1 ring-inset ring-emerald-500/20">
                        <svg className="w-10 h-10 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                    <h2 className="text-2xl font-bold text-white mb-2">Klient onboardován! 🎉</h2>
                    <p className="text-white/40 mb-2">{onboarded.name}</p>
                    <p className="text-xs text-white/20 font-mono mb-8">slug: {onboarded.slug}</p>

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
