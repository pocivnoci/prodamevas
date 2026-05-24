"use client"

import { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useStudio, type StudioSection } from "@/app/(dashboard)/StudioContext"

// ═══════════════════════════════════════════════════════════
// TUTORIAL STEPS
// ═══════════════════════════════════════════════════════════

interface TutorialStep {
    id: string
    icon: string
    title: string
    description: string
    detail: string
    navigateTo?: StudioSection
    ctaLabel?: string
    tip?: string
}

const TUTORIAL_STEPS: TutorialStep[] = [
    {
        id: "welcome",
        icon: "✨",
        title: "Vítejte v Chrlit Studio",
        description: "Vaše AI centrum pro tvorbu Instagram obsahu",
        detail: "Chrlit Studio vám pomůže vytvářet profesionální Instagram příspěvky pomocí umělé inteligence. AI analyzuje vaši značku, tone of voice a vizuální styl — a generuje posty přesně na míru.",
        tip: "Tento průvodce vám za pár minut ukáže, jak na to. Můžete ho kdykoli přeskočit.",
    },
    {
        id: "dashboard",
        icon: "🏠",
        title: "Dashboard — váš rozcestník",
        description: "Sem se vždy vracíte",
        detail: "Dashboard je vaše hlavní stránka. Najdete tu rychlé akce, statistiky vašeho obsahu a přehled posledních příspěvků. Odtud můžete jedním klikem přejít kamkoli.",
        navigateTo: "dashboard",
        tip: "Dashboard se zobrazí automaticky po přihlášení.",
    },
    {
        id: "settings",
        icon: "⚙️",
        title: "Nastavení značky",
        description: "AI potřebuje znát vaši značku",
        detail: "Při onboardingu jsme automaticky analyzovali váš web. V nastavení můžete upravit tone of voice, content pilíře (edukace, prodej, humor...), barvy a vizuální styl. Čím přesnější nastavení, tím lepší výstupy.",
        navigateTo: "settings",
        ctaLabel: "Ukázat nastavení",
        tip: "💡 Doporučení: Zkontrolujte \"Pilíře obsahu\" — AI podle nich rozhoduje, jaký typ postu vytvořit.",
    },
    {
        id: "generate",
        icon: "🚀",
        title: "Generování příspěvků",
        description: "Srdce Chrlit Studia",
        detail: "Generování funguje ve 3 krocích:\n\n1️⃣ Vyberte pilíř — jaký typ obsahu chcete (edukace, prodej, tip...)\n2️⃣ Upřesněte téma — zadejte konkrétní téma nebo nechte AI vybrat\n3️⃣ Výsledek — AI vytvoří caption, hashtags a obrázek na míru\n\nMůžete generovat jednotlivé posty nebo celou sérii najednou.",
        navigateTo: "generate",
        ctaLabel: "Zkusit generování",
        tip: "⚡ Pro rychlý start nechte vše na \"Automaticky\" a klikněte Generovat.",
    },
    {
        id: "posts",
        icon: "📸",
        title: "Správa příspěvků",
        description: "Všechny vaše vygenerované posty",
        detail: "Po vygenerování najdete všechny příspěvky v sekci Příspěvky. Můžete:\n\n📋 Kopírovat caption jedním klikem\n⬇️ Stáhnout obrázek\n✏️ Požádat AI o revizi (přidej emoji, zkrať text...)\n🔄 Vytvořit variantu existujícího postu\n📤 Označit jako publikované",
        navigateTo: "posts",
        ctaLabel: "Ukázat příspěvky",
        tip: "💡 Workflow: Draft → Ready → Posted. Status pomáhá AI učit se, co funguje.",
    },
    {
        id: "plan",
        icon: "📅",
        title: "Plánování obsahu",
        description: "Kalendář a feed náhled",
        detail: "V sekci Plán najdete dvě věci:\n\n📅 Kalendář — AI naplánuje posty na celý týden s ohledem na optimální časy, svátky a váš styl.\n\n📱 Feed náhled — podívejte se, jak budou vaše příspěvky vypadat v Instagram gridu.",
        navigateTo: "plan",
        ctaLabel: "Ukázat plán",
        tip: "💡 Tip: Klikněte na \"Naplánuj týden\" a AI vytvoří kompletní content plán.",
    },
    {
        id: "inspiration",
        icon: "💡",
        title: "Inspirace & analytika",
        description: "Nápady, recenze a výkon",
        detail: "Další užitečné sekce:\n\n💡 Nápady & Recenze — banka nápadů, kterou můžete naplnit ručně nebo nechat AI vygenerovat. Recenze zákazníků se automaticky zapracují do postů.\n\n📊 Výkon — po publikování postů sem zadejte metriky z IG a AI se naučí, co funguje lépe.",
        navigateTo: "inspiration",
        ctaLabel: "Prozkoumat",
    },
    {
        id: "done",
        icon: "🎉",
        title: "Jste připraveni!",
        description: "Začněte tvořit svůj první příspěvek",
        detail: "To je vše! Teď už víte, jak Chrlit Studio funguje. Doporučený první krok:\n\n1. Zkontrolujte nastavení značky\n2. Vygenerujte svůj první příspěvek\n3. Zkopírujte text a obrázek na Instagram\n\nKdykoli se můžete vrátit k tomuto průvodci přes tlačítko na Dashboardu.",
        navigateTo: "generate",
        ctaLabel: "🚀 Vytvořit první příspěvek",
    },
]

const STORAGE_KEY = "chrlit_tutorial_completed"

// ═══════════════════════════════════════════════════════════
// TUTORIAL OVERLAY COMPONENT
// ═══════════════════════════════════════════════════════════

export function TutorialOverlay({
    isOpen,
    onClose,
}: {
    isOpen: boolean
    onClose: () => void
}) {
    const [currentStep, setCurrentStep] = useState(0)
    const { setActiveSection } = useStudio()
    const step = TUTORIAL_STEPS[currentStep]
    const totalSteps = TUTORIAL_STEPS.length
    const isFirst = currentStep === 0
    const isLast = currentStep === totalSteps - 1

    // Reset step when opened
    useEffect(() => {
        if (isOpen) setCurrentStep(0)
    }, [isOpen])

    // Keyboard navigation
    useEffect(() => {
        if (!isOpen) return
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                handleSkip()
            } else if (e.key === "ArrowRight" || e.key === "Enter") {
                handleNext()
            } else if (e.key === "ArrowLeft") {
                handlePrev()
            }
        }
        window.addEventListener("keydown", handler)
        return () => window.removeEventListener("keydown", handler)
    }, [isOpen, currentStep])

    const handleNext = useCallback(() => {
        if (currentStep < totalSteps - 1) {
            setCurrentStep(prev => prev + 1)
        } else {
            handleComplete()
        }
    }, [currentStep, totalSteps])

    const handlePrev = useCallback(() => {
        if (currentStep > 0) {
            setCurrentStep(prev => prev - 1)
        }
    }, [currentStep])

    const handleSkip = useCallback(() => {
        localStorage.setItem(STORAGE_KEY, "true")
        onClose()
    }, [onClose])

    const handleComplete = useCallback(() => {
        localStorage.setItem(STORAGE_KEY, "true")
        if (step.navigateTo) {
            setActiveSection(step.navigateTo)
        }
        onClose()
    }, [step, setActiveSection, onClose])

    const handleNavigate = useCallback(() => {
        if (step.navigateTo) {
            setActiveSection(step.navigateTo)
        }
        handleNext()
    }, [step, setActiveSection, handleNext])

    if (!isOpen) return null

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
            >
                {/* Backdrop */}
                <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />

                {/* Tutorial Card */}
                <motion.div
                    className="relative w-full max-w-xl"
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 25 }}
                >
                    {/* Ambient glow */}
                    <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-[400px] h-[200px] bg-aisummit-cinnabar/15 blur-[120px] pointer-events-none" />

                    <div className="relative bg-[#0a0a0a] border border-white/10 rounded-sm overflow-hidden shadow-2xl">
                        {/* Progress bar */}
                        <div className="h-1 bg-white/5">
                            <motion.div
                                className="h-full bg-gradient-to-r from-aisummit-cinnabar to-orange-500"
                                initial={false}
                                animate={{ width: `${((currentStep + 1) / totalSteps) * 100}%` }}
                                transition={{ duration: 0.3, ease: "easeOut" }}
                            />
                        </div>

                        {/* Header */}
                        <div className="flex items-center justify-between px-6 py-3 border-b border-white/5">
                            <span className="text-[9px] text-white/30 font-bold uppercase tracking-widest">
                                Průvodce • {currentStep + 1} / {totalSteps}
                            </span>
                            <button
                                onClick={handleSkip}
                                className="text-[10px] text-white/30 font-bold uppercase tracking-widest hover:text-white/60 transition-colors px-2 py-1"
                            >
                                {isLast ? "Zavřít" : "Přeskočit"}
                            </button>
                        </div>

                        {/* Content */}
                        <div className="px-8 py-10 min-h-[320px] flex flex-col">
                            <AnimatePresence mode="wait">
                                <motion.div
                                    key={step.id}
                                    initial={{ opacity: 0, x: 30 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -30 }}
                                    transition={{ duration: 0.2, ease: "easeOut" }}
                                    className="flex-1"
                                >
                                    {/* Icon */}
                                    <div className="flex items-center justify-center mb-6">
                                        <div className="w-20 h-20 bg-white/5 border border-white/10 rounded-sm flex items-center justify-center">
                                            <span className="text-5xl">{step.icon}</span>
                                        </div>
                                    </div>

                                    {/* Title */}
                                    <h2 className="text-2xl font-black uppercase tracking-tight text-white text-center mb-2">
                                        {step.title}
                                    </h2>
                                    <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest text-center mb-6">
                                        {step.description}
                                    </p>

                                    {/* Detail text */}
                                    <div className="text-sm text-white/60 leading-relaxed whitespace-pre-line font-medium max-w-md mx-auto">
                                        {step.detail}
                                    </div>

                                    {/* Tip */}
                                    {step.tip && (
                                        <div className="mt-6 bg-white/5 border border-white/10 rounded-sm p-4 max-w-md mx-auto">
                                            <p className="text-xs text-white/50 leading-relaxed font-medium">
                                                {step.tip}
                                            </p>
                                        </div>
                                    )}
                                </motion.div>
                            </AnimatePresence>
                        </div>

                        {/* Footer */}
                        <div className="px-8 py-5 border-t border-white/5 flex items-center gap-3">
                            {/* Back */}
                            {!isFirst && (
                                <button
                                    onClick={handlePrev}
                                    className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white hover:bg-white/5 rounded-sm transition-all border border-transparent hover:border-white/10"
                                >
                                    ← Zpět
                                </button>
                            )}

                            <div className="flex-1" />

                            {/* Step dots */}
                            <div className="flex items-center gap-1.5">
                                {TUTORIAL_STEPS.map((_, i) => (
                                    <button
                                        key={i}
                                        onClick={() => setCurrentStep(i)}
                                        className={`w-2 h-2 rounded-full transition-all duration-300 ${
                                            i === currentStep
                                                ? "bg-aisummit-cinnabar w-6"
                                                : i < currentStep
                                                ? "bg-white/30"
                                                : "bg-white/10"
                                        }`}
                                    />
                                ))}
                            </div>

                            <div className="flex-1" />

                            {/* Next / Navigate / Complete */}
                            {isLast ? (
                                <button
                                    onClick={handleComplete}
                                    className="px-8 py-3 bg-gradient-to-r from-aisummit-cinnabar to-orange-600 text-white rounded-sm text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-all shadow-[0_0_25px_rgba(229,83,63,0.3)]"
                                >
                                    {step.ctaLabel || "Dokončit"}
                                </button>
                            ) : step.navigateTo && step.ctaLabel ? (
                                <div className="flex gap-2">
                                    <button
                                        onClick={handleNext}
                                        className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white hover:bg-white/5 rounded-sm transition-all border border-transparent hover:border-white/10"
                                    >
                                        Další →
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={handleNext}
                                    className="px-8 py-3 bg-white/10 border border-white/20 text-white rounded-sm text-[10px] font-black uppercase tracking-widest hover:bg-white/15 transition-all"
                                >
                                    Další →
                                </button>
                            )}
                        </div>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    )
}

// ═══════════════════════════════════════════════════════════
// HOOK: Check if tutorial should auto-start
// ═══════════════════════════════════════════════════════════

export function useTutorialState() {
    const [showTutorial, setShowTutorial] = useState(false)
    const [hasChecked, setHasChecked] = useState(false)

    useEffect(() => {
        const completed = localStorage.getItem(STORAGE_KEY)
        if (!completed) {
            // Don't auto-start immediately — let Dashboard load first
            const timer = setTimeout(() => setShowTutorial(true), 800)
            return () => clearTimeout(timer)
        }
        setHasChecked(true)
    }, [])

    const openTutorial = useCallback(() => setShowTutorial(true), [])
    const closeTutorial = useCallback(() => {
        setShowTutorial(false)
        setHasChecked(true)
    }, [])

    const resetTutorial = useCallback(() => {
        localStorage.removeItem(STORAGE_KEY)
        setShowTutorial(true)
        setHasChecked(false)
    }, [])

    return { showTutorial, openTutorial, closeTutorial, resetTutorial, hasChecked }
}
