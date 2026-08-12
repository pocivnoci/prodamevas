"use client"

import { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useStudio, type StudioSection } from "@/app/(dashboard)/StudioContext"
import { Camera, Rocket, Settings, Sparkles } from "lucide-react"

// ═══════════════════════════════════════════════════════════
// WELCOME BANNER — replaces 7-step tutorial modal
// Single screen, 3 tips, one CTA. Dismissible.
// ═══════════════════════════════════════════════════════════

const STORAGE_KEY = "chrlit_tutorial_completed"

export function TutorialOverlay({
    isOpen,
    onClose,
}: {
    isOpen: boolean
    onClose: () => void
}) {
    const { setActiveSection } = useStudio()

    const handleDismiss = useCallback(() => {
        localStorage.setItem(STORAGE_KEY, "true")
        onClose()
    }, [onClose])

    const handleStartGenerating = useCallback(() => {
        localStorage.setItem(STORAGE_KEY, "true")
        setActiveSection("generate")
        onClose()
    }, [setActiveSection, onClose])

    // Keyboard: Escape to dismiss
    useEffect(() => {
        if (!isOpen) return
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") handleDismiss()
        }
        window.addEventListener("keydown", handler)
        return () => window.removeEventListener("keydown", handler)
    }, [isOpen, handleDismiss])

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
                <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={handleDismiss} />

                {/* Welcome Card */}
                <motion.div
                    className="relative w-full max-w-lg"
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 25 }}
                >
                    {/* Ambient glow */}
                    <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-[400px] h-[200px] bg-aisummit-cinnabar/15 blur-[120px] pointer-events-none" />

                    <div className="relative bg-[#0a0a0a] border border-white/10 rounded-sm overflow-hidden shadow-2xl">
                        {/* Header */}
                        <div className="flex items-center justify-between px-6 py-3 border-b border-white/5">
                            <span className="text-[9px] text-white/30 font-bold uppercase tracking-widest">
                                Vítejte v Chrlit Studio
                            </span>
                            <button
                                onClick={handleDismiss}
                                className="text-[10px] text-white/30 font-bold uppercase tracking-widest hover:text-white/60 transition-colors px-2 py-1"
                            >
                                Zavřít ✕
                            </button>
                        </div>

                        {/* Content */}
                        <div className="px-8 py-8">
                            <div className="flex items-center justify-center mb-6">
                                <div className="w-16 h-16 bg-white/5 border border-white/10 rounded-sm flex items-center justify-center">
                                    <Sparkles className="w-8 h-8" />
                                </div>
                            </div>

                            <h2 className="text-2xl font-black uppercase tracking-tight text-white text-center mb-2">
                                Vše je připraveno
                            </h2>
                            <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest text-center mb-8">
                                AI analyzovala váš web a nastavila studio na míru
                            </p>

                            {/* 3 key tips */}
                            <div className="space-y-3 mb-8">
                                <div className="flex items-start gap-3 bg-white/5 border border-white/10 rounded-sm p-4">
                                    <Rocket className="w-5 h-5 mt-0.5" />
                                    <div>
                                        <p className="text-xs font-bold text-white/80">Generovat</p>
                                        <p className="text-[11px] text-white/40 mt-0.5">Vytvořte příspěvek jedním klikem — vyberte téma a AI udělá zbytek</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3 bg-white/5 border border-white/10 rounded-sm p-4">
                                    <Camera className="w-5 h-5 mt-0.5" />
                                    <div>
                                        <p className="text-xs font-bold text-white/80">Příspěvky</p>
                                        <p className="text-[11px] text-white/40 mt-0.5">Všechny vygenerované posty najdete v Příspěvcích — zkopírujte text a stáhněte obrázek</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3 bg-white/5 border border-white/10 rounded-sm p-4">
                                    <Settings className="w-5 h-5 mt-0.5" />
                                    <div>
                                        <p className="text-xs font-bold text-white/80">Nastavení</p>
                                        <p className="text-[11px] text-white/40 mt-0.5">Dolaďte styl textu, témata a vizuální styl kdykoliv v Nastavení</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="px-8 py-5 border-t border-white/5 flex items-center justify-between">
                            <button
                                onClick={handleDismiss}
                                className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white hover:bg-white/5 rounded-sm transition-all border border-transparent hover:border-white/10"
                            >
                                Zavřít
                            </button>
                            <button
                                onClick={handleStartGenerating}
                                className="inline-flex items-center gap-1.5 justify-center px-8 py-3 bg-gradient-to-r from-aisummit-cinnabar to-orange-600 text-white rounded-sm text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-all shadow-[0_0_25px_rgba(229,83,63,0.3)]"
                            ><Rocket className="w-3 h-3 shrink-0" />Vytvořit první příspěvek</button>
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
