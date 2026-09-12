"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useFormatter, useTranslations } from "next-intl"
import { ChevronDown } from "lucide-react"
import { EXTRA_CREDIT_HALERU, FALLBACK_PLANS, formatCzk } from "@/lib/pricing"
import { MEDIA_CREDITS, ACTION_CREDITS } from "@/lib/credits"
import { localizedMediaCreditsSentence } from "./Hint"

// ─── FAQ Data ────────────────────────────────────────────────

/**
 * Otázky a odpovědi žijí v messages (`help.faq.items.<id>.q` / `.a`); tady je jen
 * pořadí a rozdělení do kategorií. Nová otázka = klíč v obou jazycích + id sem.
 */
const FAQ_CATEGORIES = [
    { id: "generating", emoji: "🚀", items: ["howItWorks", "whyDifferent", "quality", "batch", "postTypes", "editPost"] },
    { id: "credits", emoji: "💳", items: ["actionCost", "outOfCredits", "topUp", "rollover", "trial", "plans", "longerTerms", "refund", "upgrade"] },
    { id: "settings", emoji: "⚙️", items: ["tone", "addProduct", "colors", "pillars", "hookTemplates", "reonboarding"] },
    { id: "products", emoji: "🛍️", items: ["pipeline", "mockups", "printDesign", "commercialUse"] },
    { id: "tips", emoji: "💡", items: ["betterResults", "postsPerWeek", "brain", "otherLanguage", "ideas", "usedIdea"] },
] as const

type FaqTranslator = ReturnType<typeof useTranslations<"help">>
type FaqFormatter = ReturnType<typeof useFormatter>

/**
 * Věty o cenách se skládají z ceníku, ne z ruky.
 *
 * Do 9/2026 tu stály ceny natvrdo a přežily přecenění na v6 — zákazník tak četl
 * v nápovědě jinou cenu, než jakou mu naúčtovala pokladna. Copy je v messages
 * (`help.faq.*`), čísla chodí z `lib/pricing.ts` a `lib/credits.ts`; ruční čísla
 * tu jednou už lhala („Varianta stojí 1 kredit").
 */
function priceVars(t: FaqTranslator, format: FaqFormatter) {
    const credits = (n: number) => t("faq.credits", { count: n })
    return {
        // „obrázek 1 · story 2 · …" — váhy z MEDIA_CREDITS, názvy médií z messages.
        media: localizedMediaCreditsSentence(t),
        carouselPair: credits(2 * MEDIA_CREDITS.carousel),
        actions: t("faq.actions", {
            postEdit: credits(ACTION_CREDITS.post_edit),
            ideaGenerate: credits(ACTION_CREDITS.idea_generate),
            productVisual: credits(ACTION_CREDITS.product_visual),
            productDesign: credits(ACTION_CREDITS.product_design),
            productMockup: credits(ACTION_CREDITS.product_mockup),
            productBrief: credits(ACTION_CREDITS.product_brief),
            productLine: credits(ACTION_CREDITS.product_line),
        }),
        price: formatCzk(EXTRA_CREDIT_HALERU),
        // „Start 20, Růst 70, Dominance 130, Impérium 260" — také z ceníku, ne z ruky.
        creditsList: FALLBACK_PLANS.map((p) => `${p.name} ${p.creditsPerMonth}`).join(", "),
        // Popisek tarifu (`help.faq.planBlurb.<id>`): u Impéria ne „pro agentury a e-shopy" —
        // víc profilů na účet není implementované ani vynucované, takže by to prodávalo
        // něco, co zákazník nedostane.
        plans: format.list(FALLBACK_PLANS.map((p) => t("faq.planItem", {
            name: p.name,
            price: formatCzk(p.monthlyHaleru),
            credits: p.creditsPerMonth,
            blurb: t.has(`faq.planBlurb.${p.id}`) ? t(`faq.planBlurb.${p.id}`) : "",
        }))),
    }
}

// ─── Component ───────────────────────────────────────────────

export function FaqTab({ onReplayTutorial }: { onReplayTutorial?: () => void }) {
    const t = useTranslations("help")
    const format = useFormatter()
    const [activeCategory, setActiveCategory] = useState<string>(FAQ_CATEGORIES[0].id)
    const [openIndex, setOpenIndex] = useState<number | null>(null)

    const currentCategory = FAQ_CATEGORIES.find(c => c.id === activeCategory) || FAQ_CATEGORIES[0]
    const vars = priceVars(t, format)

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
                        {t(`faq.categories.${cat.id}`)}
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
                                        {t(`faq.items.${item}.q`)}
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
                                                    {t(`faq.items.${item}.a`, vars)}
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
                            {t("faq.tour.title")}
                        </p>
                        <p className="text-xs text-white/40">
                            {t("faq.tour.body")}
                        </p>
                    </div>
                    <button
                        onClick={onReplayTutorial}
                        className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest bg-white/5 text-white/60 border border-white/10 rounded-sm hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
                    >
                        {t("faq.tour.replay")}
                    </button>
                </div>
            )}

            {/* Help footer */}
            <div className="border border-white/5 rounded-sm p-5 bg-white/[0.01] text-center">
                <p className="text-[10px] text-white/25 font-bold uppercase tracking-widest mb-1">
                    {t("faq.footer.title")}
                </p>
                <p className="text-xs text-white/40">
                    {t.rich("faq.footer.body", {
                        a: (chunks) => (
                            <a href="mailto:info@chrlit.cz" className="text-aisummit-cinnabar hover:text-aisummit-cinnabar/80 transition-colors">
                                {chunks}
                            </a>
                        ),
                    })}
                </p>
            </div>
        </div>
    )
}
