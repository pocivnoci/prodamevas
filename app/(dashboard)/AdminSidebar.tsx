"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"

import { logout } from "@/app/login/actions"
import { LogoPV } from "@/components/LogoPV"

const NAV_ITEMS = [
    { href: "/dashboard/instagram", label: "Studio", icon: "✨" },
]

export function AdminSidebar() {
    const pathname = usePathname()
    const [open, setOpen] = useState(false)

    // Close on route change
    useEffect(() => { setOpen(false) }, [pathname])

    // Close on Escape
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
        window.addEventListener("keydown", handler)
        return () => window.removeEventListener("keydown", handler)
    }, [])

    const isActive = (href: string) => {
        if (href === "/dashboard") return pathname === "/dashboard"
        return pathname.startsWith(href)
    }

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
                <div className="p-8 border-b border-white/5 bg-gradient-to-b from-white/5 to-transparent">
                    <div className="flex items-center gap-4">
                        <div className="relative w-12 h-12 bg-aisummit-cinnabar rounded-sm flex items-center justify-center flex-shrink-0 group cursor-pointer overflow-hidden border border-white/10">
                            <LogoPV className="relative z-10 text-white w-7 h-7 group-hover:scale-110 transition-transform" />
                        </div>
                        <div>
                            <h2 className="text-white font-black tracking-tighter text-xl uppercase">Prodáme<span className="text-aisummit-cinnabar">Vás</span></h2>
                            <div className="flex items-center gap-1.5 mt-1">
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]"></div>
                                <p className="text-[10px] text-white/40 font-bold tracking-[0.2em] uppercase">Tech-Summit</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Navigation */}
                <nav className="flex-1 px-4 py-8 space-y-2 overflow-y-auto override-scrollbar">
                    {NAV_ITEMS.map((item) => {
                        const active = isActive(item.href)
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={`group relative flex items-center gap-4 px-4 py-3.5 rounded-sm text-xs font-bold uppercase tracking-wider transition-all duration-300 overflow-hidden ${active
                                    ? "text-white"
                                    : "text-white/40 hover:text-white"
                                    }`}
                            >
                                {active && (
                                    <motion.div
                                        layoutId="activeNavIndicator"
                                        className="absolute inset-0 bg-[#0f0f0f] shadow-sm border border-white/5 rounded-sm"
                                        initial={false}
                                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                    />
                                )}
                                {!active && (
                                    <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity rounded-sm"></div>
                                )}
                                <span className={`relative z-10 text-lg transition-transform duration-300 ${active ? 'scale-110 grayscale-0' : 'group-hover:scale-110 grayscale group-hover:grayscale-0 opacity-50 group-hover:opacity-100'}`}>{item.icon}</span>
                                <span className="relative z-10">{item.label}</span>
                                {active && (
                                    <div className="relative z-10 ml-auto w-1.5 h-1.5 bg-aisummit-cinnabar rounded-full shadow-[0_0_8px_rgba(229,83,63,0.8)]" />
                                )}
                            </Link>
                        )
                    })}
                </nav>

                {/* Footer */}
                <div className="p-4 border-t border-white/5 bg-gradient-to-t from-white/5 to-transparent">
                    <form action={logout}>
                        <button
                            type="submit"
                            className="group relative flex items-center gap-4 px-4 py-3.5 rounded-sm text-xs font-bold uppercase tracking-wider text-white/40 transition-all w-full cursor-pointer hover:text-white overflow-hidden"
                        >
                            <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity rounded-sm"></div>
                            <span className="relative z-10 text-lg group-hover:-translate-x-1 transition-transform grayscale opacity-50 group-hover:opacity-100 group-hover:grayscale-0">🚪</span>
                            <span className="relative z-10">Odhlásit se</span>
                        </button>
                    </form>
                </div>
            </aside>
        </>
    )
}
