"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { useTranslations } from "next-intl"
import { CalendarTab } from "./CalendarTab"
import { FeedTab } from "./FeedTab"

/** `label` je klíč v namespace `plan.tab` — text se bere přes `t()` v místě renderu. */
const SUB_TABS = [
    { id: "calendar" as const, label: "calendar", icon: "📅" },
    { id: "feed" as const, label: "feed", icon: "📱" },
]

export function PlanTab({ projectId }: { projectId: string }) {
    const [activeTab, setActiveTab] = useState<"calendar" | "feed">("calendar")
    const t = useTranslations("plan.tab")

    return (
        <div className="space-y-6">
            {/* Sub-tab switcher */}
            <div className="flex items-center gap-1 bg-[#0a0a0a]/60 border border-white/10 rounded-sm p-1 w-fit">
                {SUB_TABS.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`relative px-5 py-2 text-[10px] font-bold uppercase tracking-widest rounded-sm transition-all duration-200 ${
                            activeTab === tab.id
                                ? "text-white"
                                : "text-white/40 hover:text-white/70"
                        }`}
                    >
                        {activeTab === tab.id && (
                            <motion.div
                                layoutId="planSubTab"
                                className="absolute inset-0 bg-white/10 border border-white/10 rounded-sm"
                                initial={false}
                                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                            />
                        )}
                        <span className="relative z-10 flex items-center gap-2">
                            <span>{tab.icon}</span>
                            <span>{t(tab.label)}</span>
                        </span>
                    </button>
                ))}
            </div>

            {/* Content */}
            <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
            >
                {activeTab === "calendar" && <CalendarTab projectId={projectId} />}
                {activeTab === "feed" && <FeedTab projectId={projectId} />}
            </motion.div>
        </div>
    )
}
