"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronDown } from "lucide-react"
// Data nápovědy žijí v `lib/support/faq.ts`, aby na tytéž odpovědi mohl navázat
// agent podpory (`scripts/sync-support-kb.ts`). Dvě kopie odpovědí se rozejdou.
import { FAQ_CATEGORIES } from "@/lib/support/faq"
import { SupportAgent } from "@/components/support/SupportAgent"
import { useStudio } from "@/app/(dashboard)/StudioContext"

// ─── Component ───────────────────────────────────────────────

export function FaqTab({ onReplayTutorial }: { onReplayTutorial?: () => void }) {
    const { projectId } = useStudio()
    const [activeCategory, setActiveCategory] = useState(FAQ_CATEGORIES[0].id)
    const [openIndex, setOpenIndex] = useState<number | null>(null)

    const currentCategory = FAQ_CATEGORIES.find(c => c.id === activeCategory) || FAQ_CATEGORIES[0]

    return (
        <div className="space-y-6">
            {/* Category tabs */}
            <div className="flex flex-wrap gap-2">
                {FAQ_CATEGORIES.map(cat => (
                    <button
                        key={cat.id}
                        onClick={() => {
                            setActiveCategory(cat.id)
                            setOpenIndex(null)
                        }}
                        className={`px-4 py-2.5 rounded-sm text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer flex items-center gap-2 ${
                            activeCategory === cat.id
                                ? "bg-white/10 text-white border border-white/15"
                                : "bg-white/[0.02] text-white/40 border border-white/5 hover:text-white/60 hover:border-white/10"
                        }`}
                    >
                        <span className="text-sm">{cat.emoji}</span>
                        {cat.label}
                    </button>
                ))}
            </div>

            {/* Questions accordion */}
            <AnimatePresence mode="wait">
                <motion.div
                    key={activeCategory}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-1.5"
                >
                    {currentCategory.items.map((item, i) => {
                        const isOpen = openIndex === i
                        return (
                            <div
                                key={i}
                                className={`border rounded-sm overflow-hidden transition-colors duration-300 ${
                                    isOpen
                                        ? "border-white/15 bg-white/[0.03]"
                                        : "border-white/5 bg-[#0a0a0a] hover:border-white/10"
                                }`}
                            >
                                <button
                                    onClick={() => setOpenIndex(isOpen ? null : i)}
                                    className="w-full flex items-center justify-between px-5 py-4 text-left cursor-pointer group"
                                >
                                    <span
                                        className={`text-xs font-bold transition-colors ${
                                            isOpen ? "text-white" : "text-white/50 group-hover:text-white/70"
                                        }`}
                                    >
                                        {item.q}
                                    </span>
                                    <motion.div
                                        animate={{ rotate: isOpen ? 180 : 0 }}
                                        transition={{ duration: 0.25 }}
                                        className="ml-3 flex-shrink-0"
                                    >
                                        <ChevronDown
                                            className={`w-3.5 h-3.5 transition-colors ${
                                                isOpen ? "text-aisummit-cinnabar" : "text-white/15"
                                            }`}
                                        />
                                    </motion.div>
                                </button>
                                <AnimatePresence initial={false}>
                                    {isOpen && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: "auto", opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                                            className="overflow-hidden"
                                        >
                                            <div className="px-5 pb-4 border-t border-white/5">
                                                <p className="text-white/35 text-xs leading-relaxed pt-3">
                                                    {item.a}
                                                </p>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        )
                    })}
                </motion.div>
            </AnimatePresence>

            {/* Replay onboarding tour */}
            {onReplayTutorial && (
                <div className="border border-white/5 rounded-sm p-5 bg-white/[0.01] flex items-center justify-between gap-4">
                    <div>
                        <p className="text-[10px] text-white/25 font-bold uppercase tracking-widest mb-1">
                            Průvodce studiem
                        </p>
                        <p className="text-xs text-white/40">
                            Znovu si projděte úvodní přehled funkcí.
                        </p>
                    </div>
                    <button
                        onClick={onReplayTutorial}
                        className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest bg-white/5 text-white/60 border border-white/10 rounded-sm hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
                    >
                        ▶ Přehrát průvodce
                    </button>
                </div>
            )}

            {/* Agent podpory — vykreslí se jen tarifům, které na něj mají nárok
                (Dominance, Impérium). Pro ostatní vrací null a zůstane jen patička. */}
            <SupportAgent projectId={projectId} />

            {/* Help footer */}
            <div className="border border-white/5 rounded-sm p-5 bg-white/[0.01] text-center">
                <p className="text-[10px] text-white/25 font-bold uppercase tracking-widest mb-1">
                    Nenašli jste odpověď?
                </p>
                <p className="text-xs text-white/40">
                    Napište nám na{" "}
                    <a href="mailto:info@chrlit.cz" className="text-aisummit-cinnabar hover:text-aisummit-cinnabar/80 transition-colors">
                        info@chrlit.cz
                    </a>
                </p>
            </div>
        </div>
    )
}
