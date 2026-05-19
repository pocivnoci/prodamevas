"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { getDashboardStats } from "@/app/actions/admin-actions"
import { useStudio } from "@/app/(dashboard)/StudioContext"

interface DashboardStats {
    totalPosts: number
    drafts: number
    ready: number
    posted: number
    ideas: number
    recentPosts: {
        id: string
        caption: string
        image_url: string | null
        status: string
        created_at: string
        type_name: string
        type_emoji: string
    }[]
}

const ACTION_CARDS = [
    {
        id: "generate" as const,
        icon: "🚀",
        title: "Vytvořit příspěvek",
        description: "Nechte AI vygenerovat nový post na míru vaší značce",
        gradient: "from-orange-600/20 to-red-600/10",
        border: "border-orange-500/30",
        glow: "hover:shadow-[0_0_30px_rgba(249,115,22,0.15)]",
    },
    {
        id: "plan" as const,
        title: "Naplánovat týden",
        icon: "📅",
        description: "AI strategicky rozplánuje obsah na celý týden",
        gradient: "from-emerald-600/20 to-teal-600/10",
        border: "border-emerald-500/30",
        glow: "hover:shadow-[0_0_30px_rgba(16,185,129,0.15)]",
    },
    {
        id: "performance" as const,
        title: "Jak si vedu",
        icon: "📊",
        description: "Sledujte výkon a nechte AI optimalizovat budoucí obsah",
        gradient: "from-blue-600/20 to-indigo-600/10",
        border: "border-blue-500/30",
        glow: "hover:shadow-[0_0_30px_rgba(59,130,246,0.15)]",
    },
    {
        id: "settings" as const,
        title: "Nastavení značky",
        icon: "⚙️",
        description: "Upravte tone of voice, pilíře obsahu a vizuální styl",
        gradient: "from-white/5 to-white/[0.02]",
        border: "border-white/10",
        glow: "hover:shadow-[0_0_30px_rgba(255,255,255,0.05)]",
    },
]

export function DashboardTab({ projectId, onOpenTutorial }: { projectId: string; onOpenTutorial?: () => void }) {
    const { setActiveSection, subscription } = useStudio()
    const [stats, setStats] = useState<DashboardStats | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!projectId) return
        setLoading(true)
        getDashboardStats(projectId).then(data => {
            setStats(data)
            setLoading(false)
        })
    }, [projectId])

    return (
        <div className="space-y-8">
            {/* Welcome header */}
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative overflow-hidden rounded-sm border border-white/10 bg-gradient-to-br from-[#0a0a0a] to-[#0f0f0f] p-8"
            >
                {/* Ambient glow */}
                <div className="absolute top-0 right-0 w-[300px] h-[200px] bg-aisummit-cinnabar/10 blur-[100px] pointer-events-none" />
                <div className="relative flex items-start justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-black uppercase tracking-tight text-white mb-2">
                            Vítejte v <span className="text-aisummit-cinnabar">Chrlit</span> Studio
                        </h1>
                        <p className="text-white/40 text-sm font-medium max-w-lg">
                            Vaše centrum pro tvorbu a správu Instagram obsahu. Vyberte akci nebo se podívejte na stav vašeho účtu.
                        </p>
                    </div>
                    {onOpenTutorial && (
                        <button
                            onClick={onOpenTutorial}
                            className="flex-shrink-0 px-4 py-2.5 bg-white/5 border border-white/10 rounded-sm text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all flex items-center gap-2"
                        >
                            <span>📖</span> Průvodce
                        </button>
                    )}
                </div>
            </motion.div>

            {/* Action Cards */}
            <motion.div
                className="grid grid-cols-1 sm:grid-cols-2 gap-4"
                initial="hidden"
                animate="visible"
                variants={{
                    hidden: { opacity: 0 },
                    visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
                }}
            >
                {ACTION_CARDS.map(card => (
                    <motion.button
                        key={card.id}
                        variants={{
                            hidden: { opacity: 0, y: 15, scale: 0.97 },
                            visible: { opacity: 1, y: 0, scale: 1 },
                        }}
                        onClick={() => setActiveSection(card.id)}
                        className={`group relative text-left p-6 rounded-sm border bg-gradient-to-br transition-all duration-300 ${card.gradient} ${card.border} ${card.glow} hover:scale-[1.02] active:scale-[0.99]`}
                    >
                        <div className="flex items-start gap-4">
                            <span className="text-3xl group-hover:scale-110 transition-transform duration-300">{card.icon}</span>
                            <div>
                                <h3 className="text-white font-black uppercase tracking-tight text-sm mb-1 group-hover:text-white/90">
                                    {card.title}
                                </h3>
                                <p className="text-white/35 text-xs font-medium leading-relaxed">
                                    {card.description}
                                </p>
                            </div>
                        </div>
                        {/* Arrow indicator */}
                        <div className="absolute right-5 top-1/2 -translate-y-1/2 text-white/10 group-hover:text-white/30 group-hover:translate-x-1 transition-all text-lg">
                            →
                        </div>
                    </motion.button>
                ))}
            </motion.div>

            {/* Stats Row */}
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="grid grid-cols-2 sm:grid-cols-5 gap-3"
            >
                {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="bg-[#0a0a0a]/80 border border-white/5 rounded-sm p-4 animate-pulse">
                            <div className="h-6 w-12 bg-white/10 rounded mb-2" />
                            <div className="h-3 w-20 bg-white/5 rounded" />
                        </div>
                    ))
                ) : stats ? (
                    <>
                        <StatCard label="Celkem postů" value={stats.totalPosts} icon="📸" />
                        <StatCard label="Drafty" value={stats.drafts} icon="📝" color="text-amber-400" />
                        <StatCard label="Připravené" value={stats.ready} icon="✅" color="text-blue-400" />
                        <StatCard label="Publikované" value={stats.posted} icon="📤" color="text-emerald-400" />
                        <StatCard label="Nápady" value={stats.ideas} icon="💡" color="text-violet-400" />
                    </>
                ) : null}
            </motion.div>

            {/* Recent Posts */}
            {stats && stats.recentPosts.length > 0 && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                >
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-sm font-black uppercase tracking-tight text-white/70">Poslední příspěvky</h2>
                        <button
                            onClick={() => setActiveSection("posts")}
                            className="text-[10px] font-bold uppercase tracking-widest text-white/30 hover:text-white/60 transition-colors"
                        >
                            Zobrazit vše →
                        </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {stats.recentPosts.map(post => (
                            <motion.div
                                key={post.id}
                                onClick={() => setActiveSection("posts")}
                                className="bg-[#0a0a0a]/80 border border-white/10 rounded-sm overflow-hidden cursor-pointer group hover:border-white/20 transition-all"
                            >
                                {post.image_url && (
                                    <div className="w-full h-40 overflow-hidden">
                                        <img
                                            src={post.image_url.split("|")[0]}
                                            alt=""
                                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                        />
                                    </div>
                                )}
                                <div className="p-3">
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className="text-[10px]">{post.type_emoji}</span>
                                        <span className="text-[9px] font-bold uppercase tracking-widest text-white/40">{post.type_name}</span>
                                        <span className={`ml-auto text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm border ${
                                            post.status === "posted" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                                            : post.status === "ready" ? "text-blue-400 bg-blue-500/10 border-blue-500/20"
                                            : "text-amber-400 bg-amber-500/10 border-amber-500/20"
                                        }`}>
                                            {post.status}
                                        </span>
                                    </div>
                                    <p className="text-xs text-white/50 line-clamp-2 font-medium leading-relaxed">{post.caption}</p>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </motion.div>
            )}

            {/* Quick CTA for empty state */}
            {stats && stats.totalPosts === 0 && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    className="text-center py-16 border border-dashed border-white/10 rounded-sm"
                >
                    <p className="text-4xl mb-4">✨</p>
                    <p className="text-white/60 font-black uppercase tracking-tight text-lg mb-2">Začněte tvořit</p>
                    <p className="text-white/30 text-xs font-medium mb-6 max-w-sm mx-auto">
                        Ještě nemáte žádné příspěvky. Klikněte na tlačítko níže a nechte AI vytvořit váš první post.
                    </p>
                    <button
                        onClick={() => setActiveSection("generate")}
                        className="px-8 py-3 bg-gradient-to-r from-aisummit-cinnabar to-orange-600 text-white rounded-sm text-xs font-black uppercase tracking-widest hover:opacity-90 transition-opacity shadow-[0_0_30px_rgba(229,83,63,0.3)]"
                    >
                        🚀 Vytvořit první příspěvek
                    </button>
                </motion.div>
            )}

            {/* Subscription hint */}
            {subscription && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 }}
                    className="flex items-center gap-4 bg-[#0a0a0a]/60 border border-white/5 rounded-sm p-4"
                >
                    <div className="flex-1">
                        <span className="text-[9px] text-white/40 font-bold uppercase tracking-widest">
                            Plán: {subscription.planName}
                            {subscription.status === "trialing" && <span className="text-amber-400 ml-1">Trial</span>}
                        </span>
                        <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden mt-1.5">
                            <div
                                className={`h-full rounded-full transition-all duration-500 ${
                                    subscription.creditsTotal > 0 && (subscription.creditsUsed / subscription.creditsTotal) > 0.8
                                        ? "bg-aisummit-cinnabar"
                                        : "bg-emerald-500"
                                }`}
                                style={{ width: `${subscription.creditsTotal > 0 ? Math.min(100, (subscription.creditsUsed / subscription.creditsTotal) * 100) : 0}%` }}
                            />
                        </div>
                    </div>
                    <span className="text-[9px] text-white/30 font-bold whitespace-nowrap">
                        {subscription.creditsRemaining} / {subscription.creditsTotal} kreditů
                    </span>
                </motion.div>
            )}
        </div>
    )
}

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: string; color?: string }) {
    return (
        <div className="bg-[#0a0a0a]/80 border border-white/5 rounded-sm p-4 hover:border-white/10 transition-colors">
            <div className="flex items-center gap-2 mb-1">
                <span className="text-base">{icon}</span>
                <span className={`text-2xl font-black ${color || "text-white"}`}>{value}</span>
            </div>
            <p className="text-[9px] text-white/30 font-bold uppercase tracking-widest">{label}</p>
        </div>
    )
}
