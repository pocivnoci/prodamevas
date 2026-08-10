"use client"

import { usePathname } from "next/navigation"
import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"

import { logout } from "@/app/login/actions"
import { LogoPV } from "@/components/LogoPV"
import { useStudio, type StudioSection } from "./StudioContext"
import { getAvailableIGClients, isCurrentUserSuperAdmin } from "@/app/actions/admin-actions"

type ClientInfo = { id: string; name: string; icon: string; description: string }

/** Last tenant the user picked in the sidebar. Value is a client SLUG (StudioContext's
 *  `projectId` is a slug despite the name). Only ever trusted after it is matched
 *  against the list getAvailableIGClients() returns for the current session. */
const PROJECT_STORAGE_KEY = "chrlit_active_project"

function readStoredProject(): string | null {
    try {
        return localStorage.getItem(PROJECT_STORAGE_KEY)
    } catch {
        return null // private mode / storage disabled
    }
}

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
        label: "",
        items: [
            { id: "dashboard", label: "Dashboard", icon: "🏠" },
        ],
    },
    {
        label: "Obsah",
        items: [
            { id: "posts", label: "Příspěvky", icon: "📸" },
            { id: "plan", label: "Plán", icon: "📅" },
        ],
    },
    {
        label: "Tvořit",
        items: [
            { id: "generate", label: "Generovat", icon: "🚀" },
        ],
    },
    {
        label: "Inspirace",
        items: [
            { id: "inspiration", label: "Nápady & Recenze", icon: "💡" },
            { id: "brand", label: "Fotky značky", icon: "🖼️" },
        ],
    },
    {
        label: "Analytika",
        items: [
            { id: "performance", label: "Výkon", icon: "📊" },
        ],
    },
]

const ADMIN_GROUP: NavGroup = {
    label: "Admin",
    items: [
        { id: "products", label: "Produkty", icon: "📦" },
        { id: "company", label: "Firma", icon: "🏢" },
        { id: "approvals", label: "Schválení", icon: "✅" },
        { id: "onboard", label: "Onboarding", icon: "➕" },
        { id: "waitlist", label: "Waitlist", icon: "🔑" },
        { id: "mailing", label: "Mailing", icon: "✉️" },
    ],
}

// Extracted to eliminate 3x copy-paste
function NavButton({ item, active, onSelect }: {
    item: NavItem
    active: boolean
    onSelect: () => void
}) {
    return (
        <button
            key={item.id}
            onClick={onSelect}
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
}

export function AdminSidebar() {
    const pathname = usePathname()
    const [open, setOpen] = useState(false)
    const { activeSection, setActiveSection, projectId, setProjectId, subscription, subscriptionLoading, setGenerateIntent } = useStudio()
    const [clients, setClients] = useState<ClientInfo[]>([])
    const [isAdmin, setIsAdmin] = useState(false)

    // Load clients
    useEffect(() => {
        getAvailableIGClients().then(data => {
            setClients(data)
            if (data.length > 0 && !projectId) {
                // Precedence: explicit deep link → last selection → first client.
                //
                // `projectId` is plain React state, so a reload wipes it. "Aktualizovat"
                // is window.location.reload(), which meant every refresh silently threw
                // you back to clients[0] — and because activeSection rides the URL hash
                // and DOES survive, you stayed on the same tab while the tenant under it
                // changed. Persisting the choice is what makes refresh non-destructive.
                //
                // Every candidate is validated against the user's OWN list before it can
                // select anything: a stale slug (access revoked, another account on a
                // shared browser) must fall through to clients[0], never resolve.
                const wanted = new URLSearchParams(window.location.search).get("project")
                const stored = readStoredProject()
                const pick = [wanted, stored].find(id => id && data.some(c => c.id === id))
                setProjectId(pick || data[0].id)
            }
        })
        isCurrentUserSuperAdmin().then(setIsAdmin)
    }, [])

    // Remember the active tenant across reloads (see precedence note above).
    useEffect(() => {
        if (!projectId) return
        try {
            localStorage.setItem(PROJECT_STORAGE_KEY, projectId)
        } catch {
            // Private mode / storage disabled — selection just won't survive a reload.
        }
    }, [projectId])

    // Close on Escape
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
        window.addEventListener("keydown", handler)
        return () => window.removeEventListener("keydown", handler)
    }, [])

    return (
        <>
            {/* Mobile Refresh */}
            <button
                onClick={() => window.location.reload()}
                className="lg:hidden fixed top-4 right-20 z-[60] w-12 h-12 bg-[#0a0a0a]/90 backdrop-blur-xl border border-white/10 rounded-sm flex items-center justify-center text-white shadow-sm hover:bg-white/5 transition-all"
                aria-label="Obnovit"
            >
                <span className="text-xl">🔄</span>
            </button>

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
                        <LogoPV className="h-8 flex-shrink-0" />
                        <p className="text-[8px] text-white/30 font-bold tracking-[0.2em] uppercase">Studio</p>
                    </div>
                </div>

                {/* Client Selector — only when there is something to switch between.
                    A single-tenant customer sees a dropdown with one dead option, and it
                    costs ~80px of FIXED chrome above the scrollable <nav>. That nav is
                    already squeezed (logo + this + CTA above, plan box + 4 links below),
                    which is what pushed "Generovat" under the fold and left the "Tvořit"
                    heading looking empty. Admins and multi-project plans keep it. */}
                {clients.length > 1 && (
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
                )}

                {/* CTA Button */}
                <div className="px-4 py-3 border-b border-white/5">
                    <button
                        onClick={() => {
                            setGenerateIntent({ mode: "plan", duration: "month" })
                            setActiveSection("generate")
                            setOpen(false)
                        }}
                        className="w-full py-3 bg-gradient-to-r from-aisummit-cinnabar to-orange-600 text-white rounded-sm text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-all shadow-[0_0_20px_rgba(229,83,63,0.25)] flex items-center justify-center gap-2"
                    >
                        <span>📅</span> Obsah na měsíc
                    </button>
                </div>

                {/* Everything below the header scrolls as ONE column.
                    Previously only <nav> was the scroll area (flex-1 overflow-y-auto) while
                    the plan widget and the Help/Settings/Logout block stayed pinned below it.
                    On a 900px window that left the nav 237px tall for 762px of content —
                    525px (69%) hidden, with the "Tvořit" heading landing right on the cut so
                    "Generovat", the product's primary action, was invisible and the heading
                    read as an empty section. One scroll column more than doubles the region. */}
                <div className="flex-1 overflow-y-auto override-scrollbar">
                <nav className="px-3 py-4 space-y-5">
                    {NAV_GROUPS.map((group, gi) => (
                        <div key={group.label || `group-${gi}`}>
                            {group.label && (
                                <p className="text-[8px] text-white/25 font-bold uppercase tracking-[0.25em] px-3 mb-1.5">{group.label}</p>
                            )}
                            <div className="space-y-0.5">
                                {group.items.map(item => (
                                    <NavButton
                                        key={item.id}
                                        item={item}
                                        active={activeSection === item.id}
                                        onSelect={() => { setActiveSection(item.id); setOpen(false) }}
                                    />
                                ))}
                            </div>
                        </div>
                    ))}

                    {/* Admin group — super admins only (SUPER_ADMIN_EMAILS) */}
                    {isAdmin && (
                        <div>
                            <p className="text-[8px] text-white/25 font-bold uppercase tracking-[0.25em] px-3 mb-1.5">{ADMIN_GROUP.label}</p>
                            <div className="space-y-0.5">
                                {ADMIN_GROUP.items.map(item => (
                                    <NavButton
                                        key={item.id}
                                        item={item}
                                        active={activeSection === item.id}
                                        onSelect={() => { setActiveSection(item.id); setOpen(false) }}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
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
                        const isTrial = subscription.status === "trialing"
                        // Content-gated trial (credits_per_month=0) shows its "free posts"
                        // allotment, not a "0/0 kreditů" bar that reads as broken.
                        const planLimit = subscription.planPostsLimit ?? 0
                        const usePostQuota = isTrial && subscription.creditsTotal === 0 && planLimit > 0
                        const usedUnits = usePostQuota ? (subscription.planPostsUnlocked ?? 0) : subscription.creditsUsed
                        const totalUnits = usePostQuota ? planLimit : subscription.creditsTotal
                        const remainingUnits = usePostQuota ? Math.max(0, planLimit - (subscription.planPostsUnlocked ?? 0)) : subscription.creditsRemaining
                        const pct = totalUnits > 0 ? Math.min(100, (usedUnits / totalUnits) * 100) : 0
                        const isLow = pct > 80
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
                                        {usedUnits}/{totalUnits} {usePostQuota ? "příspěvků zdarma" : "kreditů"}
                                    </span>
                                    <span className={`text-[9px] font-bold ${isLow ? 'text-aisummit-cinnabar' : 'text-white/20'}`}>
                                        {remainingUnits} zbývá
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

                {/* Bottom: Help + Settings + Logout */}
                <div className="px-3 py-3 border-t border-white/5 space-y-0.5">
                    <NavButton
                        item={{ id: "faq", label: "Nápověda", icon: "❓" }}
                        active={activeSection === "faq"}
                        onSelect={() => { setActiveSection("faq"); setOpen(false) }}
                    />
                    <NavButton
                        item={{ id: "settings", label: "Nastavení", icon: "⚙️" }}
                        active={activeSection === "settings"}
                        onSelect={() => { setActiveSection("settings"); setOpen(false) }}
                    />

                    <button
                        onClick={() => window.location.reload()}
                        className="group relative flex items-center gap-3 w-full px-3 py-2.5 rounded-sm text-[11px] font-bold uppercase tracking-wider text-white/40 hover:text-white/70 transition-all cursor-pointer"
                    >
                        <span className="text-base opacity-70 group-hover:opacity-100 transition-opacity">🔄</span>
                        <span>Aktualizovat</span>
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
                </div>
            </aside>
        </>
    )
}
