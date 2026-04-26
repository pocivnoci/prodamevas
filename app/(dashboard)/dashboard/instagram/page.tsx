"use client"

import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { getAvailableIGClients } from "@/app/actions/admin-actions"

// Tab components — extracted from this file for maintainability
import { PostsTab } from "./tabs/PostsTab"
import { GenerateTab } from "./tabs/GenerateTab"
import { IdeasTab } from "./tabs/IdeasTab"
import { ReviewsTab } from "./tabs/ReviewsTab"
import { ProductsTab } from "./tabs/ProductsTab"
import { BrandTab } from "./tabs/BrandTab"
import { PerformanceTab } from "./tabs/PerformanceTab"
import { LogsTab } from "./tabs/LogsTab"
import { OnboardTab } from "./tabs/OnboardTab"
import { SettingsTab } from "./tabs/SettingsTab"

type Tab = "posts" | "generate" | "ideas" | "reviews" | "logs" | "products" | "brand" | "performance" | "onboard" | "settings"
type ClientInfo = { id: string; name: string; icon: string; description: string }

export default function InstagramPage() {
    const [activeTab, setActiveTab] = useState<Tab>("posts")
    const [projectId, setProjectId] = useState("") // Dynamic now
    const [clients, setClients] = useState<ClientInfo[]>([])

    // Load available clients from config registry
    useEffect(() => {
        getAvailableIGClients().then(data => {
            setClients(data)
            if (data.length > 0 && !projectId) {
                setProjectId(data[0].id)
            }
        })
    }, [])

    const currentProject = clients.find(p => p.id === projectId) || { id: projectId, name: projectId || "Načítám...", icon: "📦", description: "" }

    const tabs: { id: Tab; label: string; icon: string }[] = [
        { id: "posts", label: "Příspěvky", icon: "📸" },
        { id: "generate", label: "Generovat", icon: "🚀" },
        { id: "ideas", label: "Nápady", icon: "💡" },
        { id: "reviews", label: "Recenze", icon: "⭐" },
        { id: "products", label: "Produkty", icon: "🛍️" },
        { id: "brand", label: "Fotky", icon: "🎨" },
        { id: "performance", label: "Performance", icon: "🧠" },
        { id: "onboard", label: "Onboard", icon: "➕" },
        { id: "settings", label: "Nastavení", icon: "⚙️" },
        { id: "logs", label: "Logy", icon: "📊" },
    ]

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="text-4xl font-black uppercase tracking-tighter text-white">Studio</h1>
                    <p className="text-white/50 mt-2 font-bold uppercase tracking-widest text-[10px]">Kreativní prostor pro generování a správu obsahu</p>
                </div>

                {/* Project Selector */}
                <div className="relative">
                    <select
                        value={projectId}
                        onChange={(e) => setProjectId(e.target.value)}
                        className="appearance-none bg-[#0a0a0a]/90 backdrop-blur-xl border border-white/10 text-white rounded-sm px-5 py-3 pr-12 text-sm font-bold uppercase tracking-wider cursor-pointer shadow-sm hover:border-white/30 transition-colors focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30"
                    >
                        {clients.map(p => (
                            <option key={p.id} value={p.id}>
                                {p.icon} {p.name}
                            </option>
                        ))}
                    </select>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-white/40">
                        ▾
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 pb-2 overflow-x-auto scrollbar-hide">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center gap-2 px-5 py-2.5 text-xs font-bold uppercase tracking-wider transition-all rounded-sm whitespace-nowrap shadow-sm ${activeTab === tab.id
                            ? "bg-white/10 text-white shadow-md border border-white/20"
                            : "bg-[#0f0f0f] text-white/50 border border-white/10 hover:text-white hover:bg-white/5"
                            }`}
                    >
                        <span>{tab.icon}</span>
                        <span>{tab.label}</span>
                    </button>
                ))}
            </div>

            <div className="relative mt-4">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={activeTab}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.3, ease: "easeOut" }}
                    >
                        {activeTab === "posts" && <PostsTab projectId={projectId} />}
                        {activeTab === "generate" && <GenerateTab projectId={projectId} />}
                        {activeTab === "ideas" && <IdeasTab projectId={projectId} />}
                        {activeTab === "reviews" && <ReviewsTab projectId={projectId} />}
                        {activeTab === "products" && <ProductsTab projectId={projectId} />}
                        {activeTab === "brand" && <BrandTab projectId={projectId} />}
                        {activeTab === "performance" && <PerformanceTab projectId={projectId} />}
                        {activeTab === "onboard" && <OnboardTab />}
                        {activeTab === "settings" && <SettingsTab projectId={projectId} />}
                        {activeTab === "logs" && <LogsTab projectId={projectId} />}
                    </motion.div>
                </AnimatePresence>
            </div>
        </div>
    )
}
