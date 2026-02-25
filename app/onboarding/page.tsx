'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { analyzeWebsite, generateQuestions, buildAndSaveConfig } from './actions'
import type { WebsiteAnalysis, OnboardingQuestion } from './actions'

type Step = 'input' | 'analyzing' | 'questions' | 'building' | 'done'

export default function OnboardingPage() {
    const router = useRouter()

    const [step, setStep] = useState<Step>('input')
    const [url, setUrl] = useState('')
    const [igHandle, setIgHandle] = useState('')
    const [error, setError] = useState<string | null>(null)

    // Analysis data
    const [analysis, setAnalysis] = useState<WebsiteAnalysis | null>(null)
    const [questions, setQuestions] = useState<OnboardingQuestion[]>([])
    const [answers, setAnswers] = useState<Record<string, string | string[]>>({})

    // ─── Step 1 → 2: Submit URL & IG ────────────────────────────
    async function handleAnalyze(e: React.FormEvent) {
        e.preventDefault()
        if (!url.trim()) return

        setError(null)
        setStep('analyzing')

        try {
            // Analyze website
            const result = await analyzeWebsite(url.trim(), igHandle.trim())
            if (!result.success || !result.analysis) {
                throw new Error(result.error || 'Analýza selhala')
            }
            setAnalysis(result.analysis)

            // Generate questions
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

    // ─── Step 3 → 4: Submit Answers ─────────────────────────────
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

            // Nevolat ihned přesměrování. 
            // Posuneme na informační zbrazovku.
            setStep('done')

        } catch (err) {
            setError((err as Error).message)
            setStep('questions')
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
                            width: step === 'input' ? '0%'
                                : step === 'analyzing' ? '33%'
                                    : step === 'questions' ? '66%'
                                        : '100%'
                        }}
                    />
                </div>
            </div>

            <div className="max-w-2xl mx-auto px-4 py-16">
                {/* ══════════════════════════════════════════════ */}
                {/* STEP 1: Input URL & IG Handle                */}
                {/* ══════════════════════════════════════════════ */}
                {step === 'input' && (
                    <div className="animate-fadeIn">
                        <div className="text-center mb-10">
                            <div className="inline-flex rounded-2xl bg-emerald-500/10 p-4 mb-6 ring-1 ring-inset ring-emerald-500/20">
                                <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                </svg>
                            </div>
                            <h1 className="text-3xl font-bold tracking-tight mb-3">Nastavíme tvůj Autopilot</h1>
                            <p className="text-gray-400 text-lg">Zadej web a Instagram — AI analyzuje tvou značku a nastaví vše za tebe.</p>
                        </div>

                        {error && <ErrorBanner message={error} />}

                        <form onSubmit={handleAnalyze} className="space-y-5">
                            <div className="p-6 bg-white/5 border border-white/10 rounded-2xl space-y-5">
                                <div>
                                    <label htmlFor="url" className="block text-sm font-medium text-gray-300 mb-2">Webová stránka</label>
                                    <input
                                        id="url"
                                        type="text"
                                        value={url}
                                        onChange={e => setUrl(e.target.value)}
                                        required
                                        placeholder="https://tvujweb.cz"
                                        className="w-full px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/50 transition-all text-sm"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="ig" className="block text-sm font-medium text-gray-300 mb-2">Instagram handle</label>
                                    <input
                                        id="ig"
                                        type="text"
                                        value={igHandle}
                                        onChange={e => setIgHandle(e.target.value)}
                                        placeholder="@tvujinstagram"
                                        className="w-full px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/50 transition-all text-sm"
                                    />
                                    <p className="mt-1.5 text-xs text-gray-500">Volitelné — pomůže nám lépe pochopit tvůj brand</p>
                                </div>
                            </div>

                            <button
                                type="submit"
                                className="w-full relative group overflow-hidden rounded-xl bg-emerald-600 px-6 py-3.5 text-sm font-medium text-white shadow-[0_0_20px_rgba(16,185,129,0.2)] transition-all hover:bg-emerald-500 cursor-pointer"
                            >
                                <span className="relative z-10 flex items-center justify-center gap-2">
                                    🔍 Analyzovat web
                                    <span className="transition-transform group-hover:translate-x-1">→</span>
                                </span>
                            </button>
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
                            <LoadingStep label="Ukládám do databáze" />
                        </div>
                    </div>
                )}

                {/* ══════════════════════════════════════════════ */}
                {/* STEP 5: Done!                                 */}
                {/* ══════════════════════════════════════════════ */}
                {step === 'done' && analysis && (
                    <div className="animate-fadeIn max-w-2xl mx-auto py-12">
                        <div className="text-center mb-10">
                            <div className="inline-flex rounded-2xl bg-emerald-500/10 p-5 mb-6 ring-1 ring-inset ring-emerald-500/20">
                                <svg className="w-10 h-10 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                            <h2 className="text-3xl font-bold mb-3">Autopilot je připravený! 🎉</h2>
                            <p className="text-gray-400 text-lg">AI právě uložila tvou unikátní Brand Identitu do databáze.</p>
                        </div>

                        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-8">
                            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                                <span>🧬</span> Profil klienta: <span className="text-emerald-400">{analysis.companyName}</span>
                            </h3>

                            <div className="space-y-4 text-sm text-gray-300">
                                <div>
                                    <span className="block text-gray-500 text-xs uppercase font-bold tracking-wider mb-1">Brand Voice (Vyznění)</span>
                                    <p className="bg-black/30 p-3 rounded-xl border border-white/5">{analysis.visualFeel || 'Moderní a přátelský'}</p>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <span className="block text-gray-500 text-xs uppercase font-bold tracking-wider mb-1">Typografie</span>
                                        <p className="bg-black/30 px-3 py-2 rounded-xl border border-white/5 font-mono">{analysis.recommendedFont || 'Inter'}</p>
                                    </div>
                                    <div>
                                        <span className="block text-gray-500 text-xs uppercase font-bold tracking-wider mb-1">Sektory (Industry)</span>
                                        <p className="bg-black/30 px-3 py-2 rounded-xl border border-white/5">{analysis.industry || 'Business'}</p>
                                    </div>
                                </div>
                                <div>
                                    <span className="block text-gray-500 text-xs uppercase font-bold tracking-wider mb-2">Unikátní prodejní argumenty (USP)</span>
                                    <ul className="list-disc list-inside space-y-1 ml-1 text-gray-400">
                                        {analysis.uniqueSellingPoints.slice(0, 3).map((usp: string, i: number) => (
                                            <li key={i}>{usp}</li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={() => router.push('/dashboard/instagram')}
                            className="w-full relative group overflow-hidden rounded-xl bg-emerald-600 px-6 py-4 text-sm font-bold text-white shadow-[0_0_20px_rgba(16,185,129,0.2)] transition-all hover:bg-emerald-500 cursor-pointer text-center"
                        >
                            <span className="relative z-10 flex items-center justify-center gap-2">
                                Vstoupit do Dashboardu Autopilota
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
