"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { IdeasTab } from "./IdeasTab"
import { ReviewsTab } from "./ReviewsTab"

const SUB_TABS = [
    { id: "ideas" as const, label: "Nápady", icon: "💡" },
    { id: "reviews" as const, label: "Recenze", icon: "⭐" },
]

export function InspirationTab({ projectId }: { projectId: string }) {
    const [activeTab, setActiveTab] = useState<"ideas" | "reviews">("ideas")

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
                                layoutId="inspirationSubTab"
                                className="absolute inset-0 bg-white/10 border border-white/10 rounded-sm"
                                initial={false}
                                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                            />
                        )}
                        <span className="relative z-10 flex items-center gap-2">
                            <span>{tab.icon}</span>
                            <span>{tab.label}</span>
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
                {activeTab === "ideas" && <IdeasTab projectId={projectId} />}
                {activeTab === "reviews" && <ReviewsTab projectId={projectId} />}
            </motion.div>
        </div>
    )
}
