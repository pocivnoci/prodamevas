"use client"

import { usePathname } from "next/navigation"
import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"

import { logout } from "@/app/login/actions"
import { LogoPV } from "@/components/LogoPV"
import { useStudio, type StudioSection } from "./StudioContext"
import { getAvailableIGClients } from "@/app/actions/admin-actions"

type ClientInfo = { id: string; name: string; icon: string; description: string }

interface NavItem {
    id: StudioSection
    label: string
    icon: string
}

interface NavGroup {
    label: string
    items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
    {
        label: "Obsah",
        items: [
            { id: "posts", label: "Příspěvky", icon: "📸" },
            { id: "calendar", label: "Kalendář", icon: "📅" },
            { id: "feed", label: "Feed náhled", icon: "📱" },
        ],
    },
    {
        label: "Tvořit",
        items: [
            { id: "generate", label: "Generovat", icon: "🚀" },
            { id: "products", label: "Produkty", icon: "🛍️" },
            { id: "ideas", label: "Nápady", icon: "💡" },
        ],
    },
    {
        label: "Zdroje",
        items: [
            { id: "reviews", label: "Recenze", icon: "⭐" },
            { id: "brand", label: "Brand fotky", icon: "🖼️" },
        ],
    },
    {
        label: "Analytika",
        items: [
            { id: "performance", label: "Výkon", icon: "📊" },
        ],
    },
    {
        label: "Admin",
        items: [
            { id: "onboard", label: "Onboarding", icon: "➕" },
        ],
    },
]

export function AdminSidebar() {
    const pathname = usePathname()
    const [open, setOpen] = useState(false)
    const { activeSection, setActiveSection, projectId, setProjectId, subscription, subscriptionLoading } = useStudio()
    const [clients, setClients] = useState<ClientInfo[]>([])

    // Load clients
    useEffect(() => {
        getAvailableIGClients().then(data => {
            setClients(data)
            if (data.length > 0 && !projectId) {
                setProjectId(data[0].id)
            }
        })
    }, [])

    // Close on Escape
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
        window.addEventListener("keydown", handler)
        return () => window.removeEventListener("keydown", handler)
    }, [])

    return (
        <>
            {/* Mobile hamburger */}
            <button
                onClick={() => setOpen(!open)}
                className="lg:hidden fixed top-4 right-4 z-[60] w-12 h-12 bg-[#0a0a0a]/90 backdrop-blur-xl border border-white/10 rounded-sm flex items-center justify-center text-white shadow-sm hover:bg-white/5 transition-all"
                aria-label="Menu"
            >
                {open ? "✕" : "☰"}
            </button>

            {/* Backdrop */}
            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-[55]"
                        onClick={() => setOpen(false)}
                    />
                )}
            </AnimatePresence>

            {/* Sidebar */}
            <aside className={`
                fixed left-0 top-0 h-screen w-72 bg-[#050505]/95 backdrop-blur-2xl border-r border-white/10 flex flex-col z-[58]
                transition-transform duration-500 cubic-bezier(0.16, 1, 0.3, 1)
                ${open ? "translate-x-0" : "-translate-x-full"}
                lg:translate-x-0
            `}>
                {/* Logo */}
                <div className="p-6 pb-4 border-b border-white/5">
                    <div className="flex items-center gap-3">
                        <LogoPV className="w-10 h-10 rounded-sm flex-shrink-0 group-hover:scale-105 transition-transform" />
                        <div>
                            <h2 className="text-white font-black tracking-tighter text-lg uppercase">Chrl<span className="text-aisummit-cinnabar">it</span></h2>
                            <p className="text-[8px] text-white/30 font-bold tracking-[0.2em] uppercase">Studio</p>
                        </div>
                    </div>
                </div>

                {/* Client Selector */}
                <div className="px-4 py-3 border-b border-white/5">
                    <label className="text-[8px] text-white/30 font-bold uppercase tracking-[0.2em] block mb-1.5">Klient</label>
                    <div className="relative">
                        <select
                            value={projectId}
                            onChange={(e) => setProjectId(e.target.value)}
                            className="w-full appearance-none bg-[#0a0a0a]/80 border border-white/10 text-white rounded-sm px-3 py-2 pr-8 text-xs font-bold cursor-pointer hover:border-white/20 transition-colors focus:outline-none focus:ring-1 focus:ring-aisummit-cinnabar/30"
                        >
                            {clients.map(c => (
                                <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                            ))}
                        </select>
                        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-white/30 text-[10px]">▾</div>
                    </div>
                </div>

                {/* Grouped Navigation */}
                <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto override-scrollbar">
                    {NAV_GROUPS.map(group => (
                        <div key={group.label}>
                            <p className="text-[8px] text-white/25 font-bold uppercase tracking-[0.25em] px-3 mb-1.5">{group.label}</p>
                            <div className="space-y-0.5">
                                {group.items.map(item => {
                                    const active = activeSection === item.id
                                    return (
                                        <button
                                            key={item.id}
                                            onClick={() => {
                                                setActiveSection(item.id)
                                                setOpen(false)
                                            }}
                                            className={`group relative flex items-center gap-3 w-full px-3 py-2.5 rounded-sm text-[11px] font-bold uppercase tracking-wider transition-all duration-200 overflow-hidden ${
                                                active
                                                    ? "text-white"
                                                    : "text-white/40 hover:text-white/70"
                                            }`}
                                        >
                                            {active && (
                                                <motion.div
                                                    layoutId="sidebarActive"
                                                    className="absolute inset-0 bg-white/8 border border-white/10 rounded-sm"
                                                    initial={false}
                                                    transition={{ type: "spring", stiffness: 350, damping: 30 }}
                                                />
                                            )}
                                            {!active && (
                                                <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity rounded-sm" />
                                            )}
                                            <span className={`relative z-10 text-base transition-transform duration-200 ${active ? "scale-110" : "group-hover:scale-105 opacity-60 group-hover:opacity-100"}`}>{item.icon}</span>
                                            <span className="relative z-10">{item.label}</span>
                                            {active && (
                                                <div className="relative z-10 ml-auto w-1.5 h-1.5 bg-aisummit-cinnabar rounded-full shadow-[0_0_6px_rgba(229,83,63,0.6)]" />
                                            )}
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    ))}
                </nav>

                {/* Subscription Widget */}
                <div className="px-3 py-3 border-t border-white/5">
                    {subscriptionLoading ? (
                        <div className="bg-[#0a0a0a]/80 border border-white/5 rounded-sm p-3 animate-pulse">
                            <div className="h-2 w-20 bg-white/10 rounded mb-2" />
                            <div className="h-1.5 w-full bg-white/5 rounded" />
                        </div>
                    ) : !subscription ? (
                        <div className="bg-aisummit-cinnabar/10 border border-aisummit-cinnabar/20 rounded-sm p-3">
                            <p className="text-[9px] text-white/40 font-bold uppercase tracking-widest mb-2">Žádný plán</p>
                            <button
                                onClick={() => { setActiveSection("settings"); setOpen(false) }}
                                className="w-full py-1.5 bg-aisummit-cinnabar text-white rounded-sm text-[9px] font-bold uppercase tracking-widest hover:bg-aisummit-cinnabar/90 transition-all"
                            >
                                🚀 Vybrat plán
                            </button>
                        </div>
                    ) : (() => {
                        const pct = subscription.creditsTotal > 0
                            ? Math.min(100, (subscription.creditsUsed / subscription.creditsTotal) * 100)
                            : 0
                        const isLow = pct > 80
                        const isTrial = subscription.status === "trialing"
                        const trialDays = isTrial && subscription.trialEndsAt
                            ? Math.max(0, Math.ceil((new Date(subscription.trialEndsAt).getTime() - Date.now()) / 86400000))
                            : null

                        return (
                            <div className={`rounded-sm p-3 border ${isLow ? 'bg-aisummit-cinnabar/5 border-aisummit-cinnabar/20' : 'bg-[#0a0a0a]/80 border-white/5'}`}>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[9px] text-white/60 font-bold uppercase tracking-widest">
                                        {subscription.planName}
                                        {isTrial && <span className="text-amber-400 ml-1">Trial</span>}
                                    </span>
                                    {trialDays !== null && (
                                        <span className="text-[8px] text-amber-400 font-bold">
                                            {trialDays}d zbývá
                                        </span>
                                    )}
                                </div>
                                <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden mb-1.5">
                                    <div
                                        className={`h-full rounded-full transition-all duration-500 ${isLow ? 'bg-aisummit-cinnabar' : 'bg-emerald-500'}`}
                                        style={{ width: `${pct}%` }}
                                    />
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-[9px] text-white/30 font-bold">
                                        {subscription.creditsUsed}/{subscription.creditsTotal} kreditů
                                    </span>
                                    <span className={`text-[9px] font-bold ${isLow ? 'text-aisummit-cinnabar' : 'text-white/20'}`}>
                                        {subscription.creditsRemaining} zbývá
                                    </span>
                                </div>
                                {(subscription.status === "expired" || isLow) && (
                                    <button
                                        onClick={() => { setActiveSection("settings"); setOpen(false) }}
                                        className="w-full mt-2 py-1.5 bg-aisummit-cinnabar text-white rounded-sm text-[9px] font-bold uppercase tracking-widest hover:bg-aisummit-cinnabar/90 transition-all"
                                    >
                                        {subscription.status === "expired" ? "🔓 Obnovit plán" : "🚀 Upgradovat"}
                                    </button>
                                )}
                            </div>
                        )
                    })()}
                </div>

                {/* Bottom: Settings + Logout */}
                <div className="px-3 py-3 border-t border-white/5 space-y-0.5">
                    <button
                        onClick={() => {
                            setActiveSection("settings")
                            setOpen(false)
                        }}
                        className={`group relative flex items-center gap-3 w-full px-3 py-2.5 rounded-sm text-[11px] font-bold uppercase tracking-wider transition-all ${
                            activeSection === "settings"
                                ? "text-white"
                                : "text-white/40 hover:text-white/70"
                        }`}
                    >
                        {activeSection === "settings" && (
                            <motion.div
                                layoutId="sidebarActive"
                                className="absolute inset-0 bg-white/8 border border-white/10 rounded-sm"
                                initial={false}
                                transition={{ type: "spring", stiffness: 350, damping: 30 }}
                            />
                        )}
                        <span className="relative z-10 text-base">⚙️</span>
                        <span className="relative z-10">Nastavení</span>
                    </button>

                    <form action={logout}>
                        <button
                            type="submit"
                            className="group relative flex items-center gap-3 w-full px-3 py-2.5 rounded-sm text-[11px] font-bold uppercase tracking-wider text-white/30 hover:text-white/60 transition-all cursor-pointer"
                        >
                            <span className="text-base opacity-50 group-hover:opacity-80 transition-opacity">🚪</span>
                            <span>Odhlásit se</span>
                        </button>
                    </form>
                </div>
            </aside>
        </>
    )
}
