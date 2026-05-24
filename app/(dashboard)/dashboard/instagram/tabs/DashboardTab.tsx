"use client"

import { useEffect, useState, useMemo } from "react"
import { motion } from "framer-motion"
import { getDashboardStats } from "@/app/actions/admin-actions"
import { useStudio } from "@/app/(dashboard)/StudioContext"

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

interface WeekDay {
    date: string
    dayName: string
    isToday: boolean
    posts: { id: string; caption: string; image_url: string | null; status: string; type_emoji: string }[]
}

interface ActivityItem {
    id: string
    type: "generated"
    caption: string
    timeMs: number
    created_at: string
}

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
    weekDays: WeekDay[]
    activity: ActivityItem[]
    typeCounts: Record<string, { count: number; emoji: string; display_name: string }>
    postsThisWeek: number
    postsThisMonth: number
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return "právě teď"
    if (mins < 60) return `před ${mins}m`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `před ${hours}h`
    const days = Math.floor(hours / 24)
    if (days === 1) return "včera"
    return `před ${days}d`
}

function formatDuration(ms: number): string {
    const s = Math.round(ms / 1000)
    if (s < 60) return `${s}s`
    return `${Math.floor(s / 60)}m ${s % 60}s`
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════

export function DashboardTab({ projectId, onOpenTutorial }: { projectId: string; onOpenTutorial?: () => void }) {
    const { setActiveSection, subscription } = useStudio()
    const [stats, setStats] = useState<DashboardStats | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!projectId) return
        setLoading(true)
        getDashboardStats(projectId).then(data => {
            setStats(data as DashboardStats)
            setLoading(false)
        })
    }, [projectId])

    // Smart suggestions based on what's missing
    const suggestions = useMemo(() => {
        if (!stats) return []
        const items: { label: string; type: string; emoji: string }[] = []
        // Suggest types not used recently
        const allTypes = Object.entries(stats.typeCounts)
        const sortedByCount = [...allTypes].sort((a, b) => a[1].count - b[1].count)

        if (stats.drafts === 0 && stats.ready === 0) {
            items.push({ label: "Vygeneruj první post", type: "", emoji: "🚀" })
        }
        if (sortedByCount.length > 0) {
            const least = sortedByCount[0]
            items.push({ label: least[1].display_name, type: least[0], emoji: least[1].emoji })
        }
        if (sortedByCount.length > 1) {
            const second = sortedByCount[1]
            items.push({ label: second[1].display_name, type: second[0], emoji: second[1].emoji })
        }
        // Always suggest carousel
        items.push({ label: "Carousel", type: "", emoji: "📸" })
        return items.slice(0, 3)
    }, [stats])

    if (loading) {
        return (
            <div className="space-y-6">
                {/* Skeleton */}
                <div className="h-24 bg-[#0a0a0a] border border-white/5 rounded-sm animate-pulse" />
                <div className="grid grid-cols-3 gap-3">
                    {[1, 2, 3].map(i => <div key={i} className="h-28 bg-[#0a0a0a] border border-white/5 rounded-sm animate-pulse" />)}
                </div>
                <div className="h-20 bg-[#0a0a0a] border border-white/5 rounded-sm animate-pulse" />
                <div className="grid grid-cols-3 gap-3">
                    {[1, 2, 3].map(i => <div key={i} className="h-48 bg-[#0a0a0a] border border-white/5 rounded-sm animate-pulse" />)}
                </div>
            </div>
        )
    }

    if (!stats) return null

    return (
        <div className="space-y-6">

            {/* ──── CONTENT PIPELINE ──── */}
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-[#0a0a0a]/80 border border-white/10 rounded-sm p-5"
            >
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-[10px] font-bold uppercase tracking-widest text-white/40">Content Pipeline</h2>
                    <div className="flex items-center gap-3 text-[9px] text-white/30 font-bold uppercase tracking-widest">
                        <span>Tento týden: <span className="text-white/60">{stats.postsThisWeek}</span></span>
                        <span className="text-white/10">|</span>
                        <span>Tento měsíc: <span className="text-white/60">{stats.postsThisMonth}</span></span>
                    </div>
                </div>

                <div className="grid grid-cols-4 gap-0 relative">
                    {/* Connecting line */}
                    <div className="absolute top-1/2 left-[12.5%] right-[12.5%] h-px bg-gradient-to-r from-amber-500/20 via-blue-500/20 to-emerald-500/20 -translate-y-1/2 z-0" />

                    <PipelineStep
                        icon="📝" label="Drafty" count={stats.drafts}
                        color="amber" onClick={() => setActiveSection("posts")}
                    />
                    <PipelineStep
                        icon="✅" label="Připravené" count={stats.ready}
                        color="blue" onClick={() => setActiveSection("posts")}
                    />
                    <PipelineStep
                        icon="📤" label="Publikované" count={stats.posted}
                        color="emerald" onClick={() => setActiveSection("posts")}
                    />
                    <PipelineStep
                        icon="💡" label="Nápady" count={stats.ideas}
                        color="violet" onClick={() => setActiveSection("ideas")}
                    />
                </div>
            </motion.div>

            {/* ──── WEEK STRIP + QUICK GENERATE ──── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

                {/* Week strip — 2/3 */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="lg:col-span-2 bg-[#0a0a0a]/80 border border-white/10 rounded-sm p-5"
                >
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-[10px] font-bold uppercase tracking-widest text-white/40">Tento týden</h2>
                        <button
                            onClick={() => setActiveSection("calendar")}
                            className="text-[9px] font-bold uppercase tracking-widest text-white/25 hover:text-white/50 transition-colors"
                        >
                            Kalendář →
                        </button>
                    </div>
                    <div className="grid grid-cols-7 gap-2">
                        {stats.weekDays.map(day => (
                            <div
                                key={day.date}
                                className={`relative rounded-sm border transition-all p-2 min-h-[80px] flex flex-col ${
                                    day.isToday
                                        ? "border-aisummit-cinnabar/40 bg-aisummit-cinnabar/5"
                                        : day.posts.length > 0
                                            ? "border-white/10 bg-white/[0.02]"
                                            : "border-white/5 bg-transparent"
                                }`}
                            >
                                <span className={`text-[9px] font-bold uppercase tracking-widest mb-1 ${
                                    day.isToday ? "text-aisummit-cinnabar" : "text-white/30"
                                }`}>
                                    {day.dayName}
                                </span>
                                <span className={`text-[8px] font-mono mb-2 ${
                                    day.isToday ? "text-white/50" : "text-white/15"
                                }`}>
                                    {day.date.split("-").slice(1).join(".")}
                                </span>

                                {day.posts.length > 0 ? (
                                    <div className="flex-1 flex flex-col gap-1">
                                        {day.posts.map(p => (
                                            <div key={p.id} className="flex items-center gap-1">
                                                {p.image_url ? (
                                                    <img
                                                        src={p.image_url.split("|")[0]}
                                                        alt=""
                                                        className="w-5 h-5 rounded-sm object-cover flex-shrink-0"
                                                    />
                                                ) : (
                                                    <span className="text-[10px]">{p.type_emoji}</span>
                                                )}
                                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                                    p.status === "posted" ? "bg-emerald-500" : p.status === "ready" ? "bg-blue-500" : "bg-amber-500"
                                                }`} />
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex-1 flex items-center justify-center">
                                        <span className="text-white/10 text-[8px]">—</span>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </motion.div>

                {/* Quick Generate — 1/3 */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                    className="bg-[#0a0a0a]/80 border border-white/10 rounded-sm p-5 flex flex-col"
                >
                    <h2 className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-4">Quick Generate</h2>
                    <div className="flex-1 flex flex-col gap-2">
                        {suggestions.map((s, i) => (
                            <button
                                key={i}
                                onClick={() => setActiveSection("generate")}
                                className="group flex items-center gap-3 p-3 rounded-sm border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/15 transition-all text-left"
                            >
                                <span className="text-lg group-hover:scale-110 transition-transform">{s.emoji}</span>
                                <div className="flex-1 min-w-0">
                                    <span className="text-xs text-white/60 font-bold block truncate group-hover:text-white/80 transition-colors">{s.label}</span>
                                </div>
                                <span className="text-white/10 group-hover:text-white/30 group-hover:translate-x-0.5 transition-all text-sm">→</span>
                            </button>
                        ))}
                    </div>

                    {/* Main CTA */}
                    <button
                        onClick={() => setActiveSection("generate")}
                        className="mt-4 w-full py-3 bg-gradient-to-r from-aisummit-cinnabar/80 to-orange-600/60 border border-aisummit-cinnabar/30 text-white rounded-sm text-[10px] font-black uppercase tracking-widest hover:from-aisummit-cinnabar hover:to-orange-600 transition-all shadow-[0_0_20px_rgba(229,83,63,0.15)] hover:shadow-[0_0_30px_rgba(229,83,63,0.3)]"
                    >
                        🚀 Vytvořit příspěvek
                    </button>
                </motion.div>
            </div>

            {/* ──── RECENT POSTS + ACTIVITY ──── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

                {/* Recent posts — 2/3 */}
                {stats.recentPosts.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="lg:col-span-2"
                    >
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="text-[10px] font-bold uppercase tracking-widest text-white/40">Poslední příspěvky</h2>
                            <button
                                onClick={() => setActiveSection("posts")}
                                className="text-[9px] font-bold uppercase tracking-widest text-white/25 hover:text-white/50 transition-colors"
                            >
                                Vše →
                            </button>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {stats.recentPosts.map(post => (
                                <button
                                    key={post.id}
                                    onClick={() => setActiveSection("posts")}
                                    className="group bg-[#0a0a0a]/80 border border-white/10 rounded-sm overflow-hidden text-left hover:border-white/20 transition-all"
                                >
                                    {post.image_url ? (
                                        <div className="w-full aspect-square overflow-hidden relative">
                                            <img
                                                src={post.image_url.split("|")[0]}
                                                alt=""
                                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                            />
                                            <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                                            {/* Status dot */}
                                            <span className={`absolute top-2 right-2 w-2 h-2 rounded-full shadow-lg ${
                                                post.status === "posted" ? "bg-emerald-500" : post.status === "ready" ? "bg-blue-500" : "bg-amber-500"
                                            }`} />
                                            {/* Carousel badge */}
                                            {post.image_url.includes("|") && (
                                                <span className="absolute top-2 left-2 bg-black/60 text-white/70 text-[8px] font-bold px-1.5 py-0.5 rounded-sm">
                                                    📸 {post.image_url.split("|").length}
                                                </span>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="w-full aspect-square bg-white/[0.02] flex items-center justify-center">
                                            <span className="text-2xl opacity-20">{post.type_emoji}</span>
                                        </div>
                                    )}
                                    <div className="p-2.5">
                                        <div className="flex items-center gap-1.5 mb-1">
                                            <span className="text-[10px]">{post.type_emoji}</span>
                                            <span className="text-[8px] font-bold uppercase tracking-widest text-white/30 truncate">{post.type_name}</span>
                                        </div>
                                        <p className="text-[10px] text-white/40 line-clamp-1 font-medium">{post.caption}</p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </motion.div>
                )}

                {/* Activity timeline — 1/3 */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.25 }}
                    className="bg-[#0a0a0a]/80 border border-white/10 rounded-sm p-5"
                >
                    <h2 className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-4">Nedávná aktivita</h2>

                    {stats.activity.length > 0 ? (
                        <div className="space-y-0">
                            {stats.activity.map((item, i) => (
                                <div key={item.id} className="flex gap-3 relative">
                                    {/* Timeline line */}
                                    {i < stats.activity.length - 1 && (
                                        <div className="absolute left-[5px] top-[14px] bottom-0 w-px bg-white/5" />
                                    )}
                                    {/* Dot */}
                                    <div className="w-[11px] h-[11px] rounded-full bg-emerald-500/20 border border-emerald-500/40 flex-shrink-0 mt-[3px] relative z-10" />
                                    {/* Content */}
                                    <div className="flex-1 pb-4 min-w-0">
                                        <div className="flex items-baseline gap-2">
                                            <span className="text-[9px] font-bold text-white/50">🤖 Vygenerováno</span>
                                            <span className="text-[8px] text-white/20 font-mono">{timeAgo(item.created_at)}</span>
                                        </div>
                                        <p className="text-[10px] text-white/35 truncate mt-0.5">{item.caption}</p>
                                        {item.timeMs > 0 && (
                                            <span className="text-[8px] text-white/15 font-mono">{formatDuration(item.timeMs)}</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-8">
                            <p className="text-2xl opacity-20 mb-2">📭</p>
                            <p className="text-[9px] text-white/25 font-bold uppercase tracking-widest">Zatím žádná aktivita</p>
                        </div>
                    )}
                </motion.div>
            </div>

            {/* ──── CONTENT MIX ──── */}
            {Object.keys(stats.typeCounts).length > 0 && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="bg-[#0a0a0a]/80 border border-white/10 rounded-sm p-5"
                >
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-[10px] font-bold uppercase tracking-widest text-white/40">Content Mix</h2>
                        <span className="text-[9px] text-white/20 font-bold">{stats.totalPosts} celkem</span>
                    </div>
                    <div className="flex gap-1 h-3 rounded-full overflow-hidden mb-3">
                        {Object.entries(stats.typeCounts)
                            .sort((a, b) => b[1].count - a[1].count)
                            .map(([name, data]) => {
                                const pct = stats.totalPosts > 0 ? (data.count / stats.totalPosts) * 100 : 0
                                return (
                                    <div
                                        key={name}
                                        className="h-full transition-all hover:opacity-80"
                                        style={{
                                            width: `${Math.max(pct, 2)}%`,
                                            backgroundColor: `hsl(${hashCode(name) % 360}, 60%, 50%)`,
                                        }}
                                        title={`${data.display_name}: ${data.count}`}
                                    />
                                )
                            })}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {Object.entries(stats.typeCounts)
                            .sort((a, b) => b[1].count - a[1].count)
                            .slice(0, 8)
                            .map(([name, data]) => (
                                <div key={name} className="flex items-center gap-1.5">
                                    <div
                                        className="w-2 h-2 rounded-full"
                                        style={{ backgroundColor: `hsl(${hashCode(name) % 360}, 60%, 50%)` }}
                                    />
                                    <span className="text-[9px] text-white/40 font-medium">{data.emoji} {data.display_name}</span>
                                    <span className="text-[9px] text-white/20 font-mono">{data.count}</span>
                                </div>
                            ))}
                    </div>
                </motion.div>
            )}

            {/* ──── CREDIT METER ──── */}
            {subscription && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.35 }}
                    className="flex items-center gap-4 bg-[#0a0a0a]/60 border border-white/5 rounded-sm p-4"
                >
                    <div className="flex-1">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[9px] text-white/40 font-bold uppercase tracking-widest">
                                {subscription.planName}
                                {subscription.status === "trialing" && <span className="text-amber-400 ml-1">Trial</span>}
                            </span>
                            <span className="text-[9px] text-white/30 font-bold">
                                {subscription.creditsRemaining} kreditů zbývá
                                {subscription.creditsTotal > 0 && (
                                    <span className="text-white/15"> (~{Math.floor(subscription.creditsRemaining / 3)} postů)</span>
                                )}
                            </span>
                        </div>
                        <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
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
                </motion.div>
            )}

            {/* ──── EMPTY STATE ──── */}
            {stats.totalPosts === 0 && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
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
        </div>
    )
}

// ═══════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════

function PipelineStep({ icon, label, count, color, onClick }: {
    icon: string; label: string; count: number; color: string; onClick: () => void
}) {
    const colorMap: Record<string, { bg: string; border: string; text: string; glow: string }> = {
        amber: { bg: "bg-amber-500/10", border: "border-amber-500/20", text: "text-amber-400", glow: "shadow-amber-500/10" },
        blue: { bg: "bg-blue-500/10", border: "border-blue-500/20", text: "text-blue-400", glow: "shadow-blue-500/10" },
        emerald: { bg: "bg-emerald-500/10", border: "border-emerald-500/20", text: "text-emerald-400", glow: "shadow-emerald-500/10" },
        violet: { bg: "bg-violet-500/10", border: "border-violet-500/20", text: "text-violet-400", glow: "shadow-violet-500/10" },
    }
    const c = colorMap[color] || colorMap.blue

    return (
        <button
            onClick={onClick}
            className={`relative z-10 flex flex-col items-center gap-2 p-3 rounded-sm border ${c.bg} ${c.border} hover:shadow-lg ${c.glow} transition-all group cursor-pointer`}
        >
            <span className="text-xl group-hover:scale-110 transition-transform">{icon}</span>
            <span className={`text-2xl font-black ${c.text}`}>{count}</span>
            <span className="text-[8px] font-bold uppercase tracking-widest text-white/30">{label}</span>
        </button>
    )
}

// Stable hash for consistent colors per type name
function hashCode(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash)
    }
    return Math.abs(hash)
}
