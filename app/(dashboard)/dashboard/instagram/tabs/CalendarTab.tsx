"use client"

import { useEffect, useState, useCallback } from "react"
import { getWeekPosts, approvePost } from "@/app/actions/calendar-actions"
import { useStudio } from "@/app/(dashboard)/StudioContext"

interface CalendarPost {
    id: string
    caption: string
    image_url: string | null
    status: string
    scheduled_for: string | null
    time_slot: string | null
    created_at: string
    post_type?: { name: string; display_name: string; emoji: string }
}

const DAY_NAMES = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"]
const DAY_NAMES_FULL = ["Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek", "Sobota", "Neděle"]

function getMonday(d: Date): Date {
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    const monday = new Date(d)
    monday.setDate(diff)
    monday.setHours(0, 0, 0, 0)
    return monday
}

function formatDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function CalendarTab({ projectId }: { projectId: string }) {
    const { setActiveSection, setGenerateIntent } = useStudio()
    const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))
    const [posts, setPosts] = useState<CalendarPost[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedPost, setSelectedPost] = useState<CalendarPost | null>(null)

    const weekStartStr = formatDate(weekStart)

    const loadPosts = useCallback(async () => {
        if (!projectId) return
        setLoading(true)
        const result = await getWeekPosts(projectId, weekStartStr)
        setPosts(result.posts)
        setLoading(false)
    }, [projectId, weekStartStr])

    useEffect(() => { loadPosts() }, [loadPosts])

    // Week planning goes through the proper campaign flow (plan preview → credit
    // gating → durable worker) — the old in-request planWeekAction generated posts
    // synchronously with NO credit charge and died with the tab.
    const handlePlanWeek = () => {
        setGenerateIntent({ mode: "plan", duration: "1w" })
        setActiveSection("generate")
    }

    const handleApprove = async (postId: string) => {
        await approvePost(postId)
        setPosts(prev => prev.map(p => p.id === postId ? { ...p, status: "ready" } : p))
        setSelectedPost(null)
    }

    const prevWeek = () => {
        const d = new Date(weekStart)
        d.setDate(d.getDate() - 7)
        setWeekStart(d)
    }

    const nextWeek = () => {
        const d = new Date(weekStart)
        d.setDate(d.getDate() + 7)
        setWeekStart(d)
    }

    const thisWeek = () => setWeekStart(getMonday(new Date()))

    // Build days with posts
    const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart)
        d.setDate(d.getDate() + i)
        const dateStr = formatDate(d)
        const dayPosts = posts.filter(p => p.scheduled_for?.startsWith(dateStr))
        const isToday = formatDate(new Date()) === dateStr
        return { date: d, dateStr, dayPosts, isToday, dayName: DAY_NAMES[i], dayNameFull: DAY_NAMES_FULL[i] }
    })

    const weekEndDate = new Date(weekStart)
    weekEndDate.setDate(weekEndDate.getDate() + 6)

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-black uppercase tracking-tight text-white flex items-center gap-2">
                        📅 Content Calendar
                    </h2>
                    <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest mt-1">
                        {weekStart.getDate()}.{weekStart.getMonth() + 1}. – {weekEndDate.getDate()}.{weekEndDate.getMonth() + 1}.{weekEndDate.getFullYear()}
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <button onClick={prevWeek} className="px-3 py-2 bg-white/5 border border-white/10 rounded-sm text-white/50 hover:text-white hover:bg-white/10 transition-all text-xs font-bold">
                        ←
                    </button>
                    <button onClick={thisWeek} className="px-3 py-2 bg-white/5 border border-white/10 rounded-sm text-white/50 hover:text-white hover:bg-white/10 transition-all text-[9px] font-bold uppercase tracking-widest">
                        Dnes
                    </button>
                    <button onClick={nextWeek} className="px-3 py-2 bg-white/5 border border-white/10 rounded-sm text-white/50 hover:text-white hover:bg-white/10 transition-all text-xs font-bold">
                        →
                    </button>
                </div>
            </div>

            {/* Plan button — opens the campaign flow pre-set to one week */}
            <div className="flex items-center gap-4">
                <button
                    onClick={handlePlanWeek}
                    className="px-6 py-3 bg-gradient-to-r from-emerald-600/20 to-emerald-500/10 border border-emerald-500/30 rounded-sm text-emerald-400 text-xs font-bold uppercase tracking-widest hover:from-emerald-600/30 hover:to-emerald-500/20 transition-all shadow-lg shadow-emerald-900/20"
                >
                    🪄 Naplánovat týden →
                </button>
            </div>

            {/* Calendar Grid */}
            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <div className="animate-spin rounded-full h-8 w-8 border-2 border-white/20 border-t-white/80" />
                </div>
            ) : (
                <div className="grid grid-cols-7 gap-2">
                    {days.map(day => (
                        <div
                            key={day.dateStr}
                            className={`min-h-[200px] bg-[#0a0a0a]/80 border rounded-sm p-3 transition-colors ${
                                day.isToday
                                    ? "border-emerald-500/40 bg-emerald-950/20"
                                    : "border-white/10 hover:border-white/20"
                            }`}
                        >
                            {/* Day header */}
                            <div className="flex items-center justify-between mb-3">
                                <div>
                                    <span className={`text-[10px] font-bold uppercase tracking-widest ${
                                        day.isToday ? "text-emerald-400" : "text-white/40"
                                    }`}>
                                        {day.dayName}
                                    </span>
                                    <span className={`text-lg font-black ml-1.5 ${
                                        day.isToday ? "text-emerald-400" : "text-white/70"
                                    }`}>
                                        {day.date.getDate()}
                                    </span>
                                </div>
                                {day.isToday && (
                                    <span className="text-[8px] text-emerald-400 font-bold uppercase tracking-widest bg-emerald-500/10 px-2 py-0.5 rounded-sm border border-emerald-500/20">
                                        Dnes
                                    </span>
                                )}
                            </div>

                            {/* Posts */}
                            <div className="space-y-2">
                                {day.dayPosts.map(post => {
                                    const statusColors: Record<string, string> = {
                                        draft: "border-amber-500/30 bg-amber-500/5",
                                        ready: "border-emerald-500/30 bg-emerald-500/5",
                                        posted: "border-blue-500/30 bg-blue-500/5",
                                    }
                                    const statusBadge: Record<string, string> = {
                                        draft: "📝",
                                        ready: "✅",
                                        posted: "📤",
                                    }

                                    return (
                                        <div
                                            key={post.id}
                                            onClick={() => setSelectedPost(post)}
                                            className={`p-2 border rounded-sm cursor-pointer transition-all hover:scale-[1.02] ${statusColors[post.status] || "border-white/10"}`}
                                        >
                                            {/* Thumbnail */}
                                            {post.image_url && (
                                                <img
                                                    src={post.image_url.split("|")[0]}
                                                    alt=""
                                                    className="w-full h-16 object-cover rounded-sm mb-1.5 opacity-80"
                                                />
                                            )}
                                            <div className="flex items-start justify-between gap-1">
                                                <span className="text-[9px] text-white/60 leading-tight line-clamp-2">
                                                    {post.caption?.split("\n")[0]?.substring(0, 50) || "—"}
                                                </span>
                                                <span className="text-[10px] flex-shrink-0">{statusBadge[post.status] || "📝"}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5 mt-1">
                                                <span className="text-[8px] text-white/30">{post.time_slot || "—"}</span>
                                                {post.post_type && (
                                                    <span className="text-[8px] text-white/20">{post.post_type.emoji}</span>
                                                )}
                                            </div>
                                        </div>
                                    )
                                })}

                                {/* Empty slot */}
                                {day.dayPosts.length === 0 && (
                                    <div className="flex items-center justify-center h-20 border border-dashed border-white/10 rounded-sm">
                                        <span className="text-[9px] text-white/20">Volno</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Post detail modal */}
            {selectedPost && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setSelectedPost(null)}>
                    <div className="bg-[#0a0a0a] border border-white/10 rounded-sm max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
                        {/* Image */}
                        {selectedPost.image_url && (
                            <img src={selectedPost.image_url.split("|")[0]} alt="" className="w-full aspect-square object-cover" />
                        )}

                        <div className="p-6 space-y-4">
                            {/* Status + Type */}
                            <div className="flex items-center gap-2">
                                <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-sm border ${
                                    selectedPost.status === "ready"
                                        ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                                        : selectedPost.status === "posted"
                                            ? "text-blue-400 border-blue-500/30 bg-blue-500/10"
                                            : "text-amber-400 border-amber-500/30 bg-amber-500/10"
                                }`}>
                                    {selectedPost.status}
                                </span>
                                {selectedPost.post_type && (
                                    <span className="text-[9px] text-white/40 font-bold uppercase tracking-widest">
                                        {selectedPost.post_type.emoji} {selectedPost.post_type.display_name}
                                    </span>
                                )}
                                {selectedPost.time_slot && (
                                    <span className="text-[9px] text-white/30">🕐 {selectedPost.time_slot}</span>
                                )}
                            </div>

                            {/* Caption */}
                            <p className="text-white/80 text-sm leading-relaxed whitespace-pre-line">
                                {selectedPost.caption}
                            </p>

                            {/* Actions */}
                            <div className="flex gap-2 pt-4 border-t border-white/10">
                                {selectedPost.status === "draft" && (
                                    <button
                                        onClick={() => handleApprove(selectedPost.id)}
                                        className="flex-1 px-4 py-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-sm text-emerald-400 text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-500/20 transition-all"
                                    >
                                        ✅ Schválit
                                    </button>
                                )}
                                <button
                                    onClick={() => setSelectedPost(null)}
                                    className="flex-1 px-4 py-2.5 bg-white/5 border border-white/10 rounded-sm text-white/50 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all"
                                >
                                    Zavřít
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Info */}
            <div className="bg-[#0a0a0a]/60 border border-white/5 rounded-sm p-4 text-[10px] text-white/30 tracking-wide space-y-1">
                <p>📅 <strong className="text-white/50">Naplánuj týden:</strong> AI analyzuje počasí, svátky a výkon značky, pak strategicky naplánuje posty na celý týden.</p>
                <p>🌤️ <strong className="text-white/50">Počasí:</strong> Když je dostupná předpověď, plán ji zohlední. Jinak plánuje podle kalendáře, svátků a výkonu značky.</p>
                <p>📝 <strong className="text-white/50">Workflow:</strong> Naplánuj → zkontroluj drafty → schval → publikuj.</p>
            </div>
        </div>
    )
}
