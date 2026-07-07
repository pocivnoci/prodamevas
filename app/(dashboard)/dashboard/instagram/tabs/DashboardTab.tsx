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
    ideasAvailable: number
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
    quickMetrics: {
        postsWithMetrics: number
        avgLikes: number
        avgComments: number
        avgSaves: number
        avgReach: number
        totalEngagement: number
        bestPostId: string
        bestPostCaption: string
    } | null
}

// ═══════════════════════════════════════════════════════════
// STATUS LOGIC — "Is everything OK?"
// ═══════════════════════════════════════════════════════════

type StatusLevel = "ok" | "warning" | "critical"

interface DashboardStatus {
    level: StatusLevel
    message: string
    action?: { label: string; section: string }
}

function computeStatus(stats: DashboardStats): DashboardStatus {
    // Critical: nothing to publish and nothing in draft
    if (stats.ready === 0 && stats.drafts === 0 && stats.totalPosts > 0) {
        return {
            level: "critical",
            message: "Žádný obsah k publikování — vygenerujte nové příspěvky",
            action: { label: "Generovat", section: "generate" },
        }
    }

    // Warning: no ready posts but some drafts exist
    if (stats.ready === 0 && stats.drafts > 0) {
        return {
            level: "warning",
            message: `${stats.drafts} ${stats.drafts === 1 ? "koncept čeká" : stats.drafts < 5 ? "koncepty čekají" : "konceptů čeká"} na schválení`,
            action: { label: "Schválit", section: "posts" },
        }
    }

    // OK: ready posts exist
    if (stats.ready > 0) {
        return {
            level: "ok",
            message: `${stats.ready} ${stats.ready === 1 ? "příspěvek připraven" : stats.ready < 5 ? "příspěvky připraveny" : "příspěvků připraveno"} k publikování`,
        }
    }

    // New user
    return {
        level: "warning",
        message: "Začněte tvořit obsah",
        action: { label: "Vytvořit první", section: "generate" },
    }
}

// ═══════════════════════════════════════════════════════════
// ACTION ITEMS — what should the user do next?
// ═══════════════════════════════════════════════════════════

interface ActionItem {
    emoji: string
    label: string
    detail: string
    section: string
    priority: number
}

function computeActionItems(stats: DashboardStats): ActionItem[] {
    const items: ActionItem[] = []

    if (stats.drafts > 0) {
        items.push({
            emoji: "📝",
            label: `${stats.drafts} ${stats.drafts === 1 ? "koncept" : stats.drafts < 5 ? "koncepty" : "konceptů"} ke schválení`,
            detail: "Zkontrolujte a schvalte",
            section: "posts",
            priority: 1,
        })
    }

    if (stats.ready > 0) {
        items.push({
            emoji: "📤",
            label: `${stats.ready} ${stats.ready === 1 ? "příspěvek" : stats.ready < 5 ? "příspěvky" : "příspěvků"} k publikování`,
            detail: "Připraveno na Instagram",
            section: "posts",
            priority: 2,
        })
    }

    // Find underused post types
    const allTypes = Object.entries(stats.typeCounts)
    if (allTypes.length > 2) {
        const sorted = [...allTypes].sort((a, b) => a[1].count - b[1].count)
        const least = sorted[0]
        items.push({
            emoji: least[1].emoji,
            label: `Chybí ${least[1].display_name}`,
            detail: `Jen ${least[1].count}× — oživte mix`,
            section: "generate",
            priority: 3,
        })
    }

    // No posts this week
    if (stats.postsThisWeek === 0 && stats.totalPosts > 0) {
        items.push({
            emoji: "📅",
            label: "Tento týden žádný post",
            detail: "Naplánujte obsah",
            section: "generate",
            priority: 0,
        })
    }

    // Performance metrics missing
    if (stats.quickMetrics === null && stats.posted > 5) {
        items.push({
            emoji: "📊",
            label: "Chybí metriky",
            detail: "Zadejte likes/saves pro lepší AI",
            section: "performance",
            priority: 4,
        })
    }

    // Idea bank running low — the engine falls back to inventing topics.
    // Gated on "had ideas or is an active poster" so a brand-new account
    // (0 ideas, 30 plan_locked teasers) isn't nagged on day one.
    if (stats.ideasAvailable < 5 && (stats.ideas > 0 || stats.posted > 0)) {
        items.push({
            emoji: "💡",
            label: "Docházejí nápady",
            detail: "Doplňte zásobník témat",
            section: "inspiration",
            priority: 3,
        })
    }

    return items.sort((a, b) => a.priority - b.priority).slice(0, 4)
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════

export function DashboardTab({ projectId }: { projectId: string }) {
    const { setActiveSection, setGenerateIntent } = useStudio()
    // Deep-link into GenerateTab pre-configured (hero + secondary CTAs).
    const goGenerate = (intent: { mode: "plan" | "single"; duration?: "1w" | "2w" | "month" }) => {
        setGenerateIntent(intent)
        setActiveSection("generate")
    }
    const [stats, setStats] = useState<DashboardStats | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)
    // Onboarding stashes the first content plan in localStorage; if the user landed here
    // without consuming it, surface a banner so the plan doesn't wait invisibly forever.
    const [draftPlanWaiting, setDraftPlanWaiting] = useState(false)

    useEffect(() => {
        if (!projectId) return
        try {
            setDraftPlanWaiting(!!localStorage.getItem(`ig_draft_plan_${projectId}`))
        } catch { /* ignore */ }
    }, [projectId])

    useEffect(() => {
        if (!projectId) return
        setLoading(true)
        setError(false)
        getDashboardStats(projectId)
            .then(data => {
                setStats(data as DashboardStats)
                setLoading(false)
            })
            .catch(() => {
                setError(true)
                setLoading(false)
            })
    }, [projectId])

    const status = useMemo(() => stats ? computeStatus(stats) : null, [stats])
    const actionItems = useMemo(() => stats ? computeActionItems(stats) : [], [stats])

    // ─── Loading skeleton ───
    if (loading) {
        return (
            <div className="space-y-4">
                <div className="h-16 bg-[#0a0a0a] border border-white/5 rounded-sm animate-pulse" />
                <div className="grid grid-cols-2 gap-3">
                    {[1, 2].map(i => <div key={i} className="h-24 bg-[#0a0a0a] border border-white/5 rounded-sm animate-pulse" />)}
                </div>
                <div className="h-28 bg-[#0a0a0a] border border-white/5 rounded-sm animate-pulse" />
                <div className="grid grid-cols-3 gap-3">
                    {[1, 2, 3].map(i => <div key={i} className="h-48 bg-[#0a0a0a] border border-white/5 rounded-sm animate-pulse" />)}
                </div>
            </div>
        )
    }

    // ─── Error state ───
    if (error || !stats) {
        return (
            <div className="text-center py-20 border border-dashed border-white/10 rounded-sm">
                <p className="text-3xl mb-3">⚠️</p>
                <p className="text-white/60 font-black uppercase tracking-tight text-sm mb-2">Nepodařilo se načíst data</p>
                <p className="text-white/30 text-xs font-medium mb-6">Zkontrolujte připojení a zkuste to znovu</p>
                <button
                    onClick={() => {
                        setLoading(true)
                        setError(false)
                        getDashboardStats(projectId)
                            .then(data => { setStats(data as DashboardStats); setLoading(false) })
                            .catch(() => { setError(true); setLoading(false) })
                    }}
                    className="px-6 py-2.5 bg-white/10 border border-white/20 text-white rounded-sm text-[10px] font-black uppercase tracking-widest hover:bg-white/15 transition-all"
                >
                    🔄 Zkusit znovu
                </button>
            </div>
        )
    }

    return (
        <div className="space-y-5">

            {/* ──── First content plan waiting for review (onboarding handoff) ──── */}
            {draftPlanWaiting && (
                <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center justify-between gap-4 rounded-sm border border-violet-400/25 bg-violet-400/5 p-4"
                >
                    <div className="flex items-center gap-3">
                        <span className="text-2xl leading-none">🗓️</span>
                        <div>
                            <p className="text-xs font-black uppercase tracking-tight text-white">Váš první plán obsahu čeká na schválení</p>
                            <p className="text-[10px] text-white/40 font-medium mt-0.5">AI ho připravila při onboardingu — stačí zkontrolovat a spustit.</p>
                        </div>
                    </div>
                    {/* Plain section switch — a generateIntent would reset GenerateTab to step 1
                        and fight the draft-plan consume effect. */}
                    <button
                        onClick={() => setActiveSection("generate")}
                        className="shrink-0 px-5 py-2.5 bg-violet-500/15 border border-violet-400/30 text-violet-200 rounded-sm text-[10px] font-black uppercase tracking-widest hover:bg-violet-500/25 transition-all"
                    >
                        Zkontrolovat →
                    </button>
                </motion.div>
            )}

            {/* ──── HERO: OBSAH NA MĚSÍC (the money action) ──── */}
            <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative overflow-hidden rounded-sm border border-aisummit-cinnabar/25 bg-gradient-to-br from-aisummit-cinnabar/10 via-[#0a0a0a] to-[#0a0a0a] p-6 sm:p-7"
            >
                <div className="absolute inset-0 bg-gradient-to-r from-aisummit-cinnabar/[0.06] to-transparent pointer-events-none" />
                <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
                    <div className="flex items-start gap-4">
                        <span className="text-3xl sm:text-4xl leading-none">📅</span>
                        <div>
                            <h2 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-white">Obsah na měsíc</h2>
                            <p className="text-white/50 text-xs sm:text-sm font-medium mt-1 max-w-md">
                                AI vytvoří celý měsíc příspěvků. Vy je schválíte, my je zveřejníme.
                            </p>
                            <div className="flex items-center gap-4 mt-3">
                                <button
                                    onClick={() => goGenerate({ mode: "plan", duration: "1w" })}
                                    className="text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white/70 transition-colors"
                                >
                                    nebo: Týden →
                                </button>
                                <button
                                    onClick={() => goGenerate({ mode: "single" })}
                                    className="text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white/70 transition-colors"
                                >
                                    Jeden příspěvek →
                                </button>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={() => goGenerate({ mode: "plan", duration: "month" })}
                        className="shrink-0 w-full sm:w-auto px-8 py-3.5 bg-gradient-to-r from-aisummit-cinnabar to-orange-600 text-white rounded-sm text-xs font-black uppercase tracking-widest hover:opacity-90 transition-all shadow-[0_0_30px_rgba(229,83,63,0.3)]"
                    >
                        Spustit →
                    </button>
                </div>
            </motion.div>

            {/* ──── STATUS BANNER ──── */}
            {status && stats.totalPosts > 0 && (
                <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex items-center justify-between px-5 py-3.5 rounded-sm border ${
                        status.level === "critical"
                            ? "bg-red-500/5 border-red-500/20"
                            : status.level === "warning"
                                ? "bg-amber-500/5 border-amber-500/20"
                                : "bg-emerald-500/5 border-emerald-500/20"
                    }`}
                >
                    <div className="flex items-center gap-3">
                        <span className="text-lg">
                            {status.level === "critical" ? "🔴" : status.level === "warning" ? "🟡" : "✅"}
                        </span>
                        <span className={`text-xs font-bold ${
                            status.level === "critical"
                                ? "text-red-400"
                                : status.level === "warning"
                                    ? "text-amber-400"
                                    : "text-emerald-400"
                        }`}>
                            {status.message}
                        </span>
                    </div>
                    {status.action && (
                        <button
                            onClick={() => setActiveSection(status.action!.section as any)}
                            className={`px-4 py-1.5 rounded-sm text-[9px] font-black uppercase tracking-widest transition-all ${
                                status.level === "critical"
                                    ? "bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/20"
                                    : "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/20"
                            }`}
                        >
                            {status.action.label} →
                        </button>
                    )}
                </motion.div>
            )}

            {/* ──── PRIMARY PIPELINE (2 action cards) ──── */}
            <div className="grid grid-cols-2 gap-3">
                <ActionCard
                    icon="📝" label="Koncepty" count={stats.drafts}
                    color="amber" actionLabel="Schválit"
                    onClick={() => setActiveSection("posts")}
                />
                <ActionCard
                    icon="✅" label="Připravené" count={stats.ready}
                    color="blue" actionLabel="Publikovat"
                    onClick={() => setActiveSection("posts")}
                />
            </div>

            {/* ──── Secondary counts (compact, not primary) ──── */}
            <div className="flex items-center gap-6 px-1">
                <SecondaryCount emoji="📤" label="Publikováno" count={stats.posted} />
                <SecondaryCount emoji="💡" label="Nápady" count={stats.ideas} onClick={() => setActiveSection("inspiration")} />
                {stats.quickMetrics && (
                    <>
                        <div className="w-px h-4 bg-white/10" />
                        <SecondaryCount emoji="❤️" label="Ø Lajky" count={stats.quickMetrics.avgLikes} onClick={() => setActiveSection("performance")} />
                        <SecondaryCount emoji="🔖" label="Ø Uložení" count={stats.quickMetrics.avgSaves} onClick={() => setActiveSection("performance")} />
                    </>
                )}
            </div>

            {/* ──── WEEK STRIP + ACTION ITEMS ──── */}
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

                {/* Action Items — 1/3 */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                    className="bg-[#0a0a0a]/80 border border-white/10 rounded-sm p-5 flex flex-col"
                >
                    <h2 className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-4">Co teď</h2>

                    {actionItems.length > 0 ? (
                        <div className="flex-1 flex flex-col gap-2">
                            {actionItems.map((item, i) => (
                                <button
                                    key={i}
                                    onClick={() => setActiveSection(item.section as any)}
                                    className="group flex items-center gap-3 p-3 rounded-sm border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/15 transition-all text-left"
                                >
                                    <span className="text-lg group-hover:scale-110 transition-transform">{item.emoji}</span>
                                    <div className="flex-1 min-w-0">
                                        <span className="text-xs text-white/60 font-bold block truncate group-hover:text-white/80 transition-colors">{item.label}</span>
                                        <span className="text-[9px] text-white/25 font-medium block truncate">{item.detail}</span>
                                    </div>
                                    <span className="text-white/10 group-hover:text-white/30 group-hover:translate-x-0.5 transition-all text-sm">→</span>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="flex-1 flex items-center justify-center">
                            <div className="text-center">
                                <p className="text-2xl mb-2 opacity-20">✨</p>
                                <p className="text-[9px] text-white/25 font-bold uppercase tracking-widest">Vše hotovo</p>
                            </div>
                        </div>
                    )}

                    {/* Main CTA */}
                    <button
                        onClick={() => goGenerate({ mode: "plan", duration: "month" })}
                        className="mt-4 w-full py-3 bg-gradient-to-r from-aisummit-cinnabar/80 to-orange-600/60 border border-aisummit-cinnabar/30 text-white rounded-sm text-[10px] font-black uppercase tracking-widest hover:from-aisummit-cinnabar hover:to-orange-600 transition-all shadow-[0_0_20px_rgba(229,83,63,0.15)] hover:shadow-[0_0_30px_rgba(229,83,63,0.3)]"
                    >
                        📅 Obsah na měsíc
                    </button>
                </motion.div>
            </div>

            {/* ──── RECENT POSTS ──── */}
            {stats.recentPosts.length > 0 && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
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

            {/* ──── PERFORMANCE SUMMARY (only if metrics exist) ──── */}
            {stats.quickMetrics && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.28 }}
                    className="bg-[#0a0a0a]/80 border border-white/10 rounded-sm p-5"
                >
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-[10px] font-bold uppercase tracking-widest text-white/40">Výkon příspěvků</h2>
                        <button
                            onClick={() => setActiveSection("performance")}
                            className="text-[9px] font-bold uppercase tracking-widest text-white/25 hover:text-white/50 transition-colors"
                        >
                            Detail →
                        </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <MetricCard emoji="❤️" label="Ø Lajky" value={stats.quickMetrics.avgLikes} />
                        <MetricCard emoji="💬" label="Ø Komentáře" value={stats.quickMetrics.avgComments} />
                        <MetricCard emoji="🔖" label="Ø Uložení" value={stats.quickMetrics.avgSaves} />
                        <MetricCard emoji="👁" label="Ø Dosah" value={stats.quickMetrics.avgReach} />
                    </div>
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/5">
                        <span className="text-[9px] text-white/25 font-bold uppercase tracking-widest">
                            Z {stats.quickMetrics.postsWithMetrics} příspěvků s metrikami
                        </span>
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
                        Ještě nemáte žádné příspěvky. Nechte AI připravit obsah na celý měsíc — schválíte a zveřejníte.
                    </p>
                    <button
                        onClick={() => goGenerate({ mode: "plan", duration: "month" })}
                        className="px-8 py-3 bg-gradient-to-r from-aisummit-cinnabar to-orange-600 text-white rounded-sm text-xs font-black uppercase tracking-widest hover:opacity-90 transition-opacity shadow-[0_0_30px_rgba(229,83,63,0.3)]"
                    >
                        📅 Vytvořit obsah na měsíc
                    </button>
                </motion.div>
            )}
        </div>
    )
}

// ═══════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════

function ActionCard({ icon, label, count, color, actionLabel, onClick }: {
    icon: string; label: string; count: number; color: string; actionLabel: string; onClick: () => void
}) {
    const colorMap: Record<string, { bg: string; border: string; text: string; countColor: string }> = {
        amber: { bg: "bg-amber-500/5", border: "border-amber-500/20", text: "text-amber-400", countColor: "text-amber-400" },
        blue: { bg: "bg-blue-500/5", border: "border-blue-500/20", text: "text-blue-400", countColor: "text-blue-400" },
    }
    const c = colorMap[color] || colorMap.blue

    return (
        <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={onClick}
            className={`relative flex items-center gap-4 p-4 rounded-sm border ${c.bg} ${c.border} hover:bg-white/[0.04] transition-all group cursor-pointer text-left`}
        >
            <span className="text-2xl group-hover:scale-110 transition-transform">{icon}</span>
            <div className="flex-1 min-w-0">
                <span className={`text-3xl font-black ${c.countColor}`}>{count}</span>
                <span className="text-[9px] font-bold uppercase tracking-widest text-white/30 block mt-0.5">{label}</span>
            </div>
            {count > 0 && (
                <span className="text-[9px] font-bold uppercase tracking-widest text-white/20 group-hover:text-white/40 transition-colors">
                    {actionLabel} →
                </span>
            )}
        </motion.button>
    )
}

function SecondaryCount({ emoji, label, count, onClick }: {
    emoji: string; label: string; count: number; onClick?: () => void
}) {
    const Tag = onClick ? "button" : "div"
    return (
        <Tag
            onClick={onClick}
            className={`flex items-center gap-2 ${onClick ? "hover:opacity-80 transition-opacity cursor-pointer" : ""}`}
        >
            <span className="text-sm">{emoji}</span>
            <span className="text-[9px] text-white/25 font-bold uppercase tracking-widest">{label}</span>
            <span className="text-xs text-white/50 font-black">{count.toLocaleString("cs-CZ")}</span>
        </Tag>
    )
}

function MetricCard({ emoji, label, value }: { emoji: string; label: string; value: number }) {
    return (
        <div className="bg-white/[0.02] border border-white/5 rounded-sm p-3 text-center">
            <span className="text-base">{emoji}</span>
            <p className="text-lg font-black text-white/80 mt-1">{value.toLocaleString("cs-CZ")}</p>
            <p className="text-[8px] font-bold uppercase tracking-widest text-white/30 mt-0.5">{label}</p>
        </div>
    )
}
