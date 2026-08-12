"use client"

import { useEffect, useState, useCallback } from "react"
import { getWeekPosts, approvePost } from "@/app/actions/calendar-actions"
import { useStudio } from "@/app/(dashboard)/StudioContext"
import { CalendarDays, CircleCheck, Clock, CloudSun, FileText, Send, Wand, type LucideIcon } from "lucide-react"

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

    // Zámek scrollu pod otevřeným detailem. Bez něj se na telefonu pod listem
    // roluje týden a po zavření je člověk jinde, než byl.
    useEffect(() => {
        if (!selectedPost) return
        const prev = document.body.style.overflow
        document.body.style.overflow = "hidden"
        return () => { document.body.style.overflow = prev }
    }, [selectedPost])

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
            {/* Header — na telefonu pod sebou, ať přepínač týdne dostane plnou šířku.
                Tři tlačítka namačkaná vpravo měla terč pod 40 px. */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h2 className="text-xl font-black uppercase tracking-tight text-white flex items-center gap-2"><CalendarDays className="w-4 h-4 shrink-0" />Content Calendar</h2>
                    <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest mt-1">
                        {weekStart.getDate()}.{weekStart.getMonth() + 1}. – {weekEndDate.getDate()}.{weekEndDate.getMonth() + 1}.{weekEndDate.getFullYear()}
                    </p>
                </div>

                <div className="grid grid-cols-3 sm:flex sm:items-center gap-2">
                    <button onClick={prevWeek} aria-label="Předchozí týden" className="min-h-[44px] px-3 bg-white/5 border border-white/10 rounded-sm text-white/50 hover:text-white hover:bg-white/10 transition-all text-sm font-bold cursor-pointer">
                        ←
                    </button>
                    <button onClick={thisWeek} className="min-h-[44px] px-4 bg-white/5 border border-white/10 rounded-sm text-white/50 hover:text-white hover:bg-white/10 transition-all text-[10px] font-bold uppercase tracking-widest cursor-pointer">
                        Dnes
                    </button>
                    <button onClick={nextWeek} aria-label="Následující týden" className="min-h-[44px] px-3 bg-white/5 border border-white/10 rounded-sm text-white/50 hover:text-white hover:bg-white/10 transition-all text-sm font-bold cursor-pointer">
                        →
                    </button>
                </div>
            </div>

            {/* Plan button — opens the campaign flow pre-set to one week */}
            <div className="flex items-center gap-4">
                <button
                    onClick={handlePlanWeek}
                    className="inline-flex items-center gap-1.5 justify-center w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-emerald-600/20 to-emerald-500/10 border border-emerald-500/30 rounded-sm text-emerald-400 text-xs font-bold uppercase tracking-widest hover:from-emerald-600/30 hover:to-emerald-500/20 transition-all shadow-lg shadow-emerald-900/20 cursor-pointer"
                ><Wand className="w-3.5 h-3.5 shrink-0" />Naplánovat týden →</button>
            </div>

            {/* Calendar Grid */}
            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <div className="animate-spin rounded-full h-8 w-8 border-2 border-white/20 border-t-white/80" />
                </div>
            ) : (
                <>
                {/* Telefon: svislý seznam dnů. Sedm sloupců vycházelo na 390px displeji
                    ~44 px na den, z toho ~20 px vnitřní šířky — do toho se cpal název dne,
                    číslo, náhled i titulek. Mřížka zůstává beze změny od tabletu výš. */}
                <div className="sm:hidden divide-y divide-white/5 border-y border-white/5">
                    {days.map(day => (
                        <div key={day.dateStr} className={`flex gap-3 py-3 ${day.isToday ? "bg-emerald-950/20 -mx-4 px-4" : ""}`}>
                            <div className="w-11 shrink-0 pt-0.5 text-center">
                                <div className={`text-[10px] font-bold uppercase tracking-widest ${day.isToday ? "text-emerald-400" : "text-white/40"}`}>
                                    {day.dayName}
                                </div>
                                <div className={`text-lg font-black leading-tight ${day.isToday ? "text-emerald-400" : "text-white/70"}`}>
                                    {day.date.getDate()}
                                </div>
                            </div>

                            <div className="flex-1 min-w-0 space-y-2">
                                {day.dayPosts.map(post => (
                                    <button
                                        key={post.id}
                                        onClick={() => setSelectedPost(post)}
                                        className={`w-full flex items-center gap-3 p-2 border rounded-sm text-left transition-colors active:bg-white/5 cursor-pointer ${
                                            post.status === "ready" ? "border-emerald-500/30 bg-emerald-500/5"
                                                : post.status === "posted" ? "border-blue-500/30 bg-blue-500/5"
                                                    : "border-amber-500/30 bg-amber-500/5"
                                        }`}
                                    >
                                        {post.image_url ? (
                                            <img
                                                src={post.image_url.split("|")[0]}
                                                alt=""
                                                className="w-14 h-14 shrink-0 object-cover rounded-sm opacity-90"
                                            />
                                        ) : (
                                            <div className="w-14 h-14 shrink-0 rounded-sm bg-white/5 flex items-center justify-center text-white/20 text-lg">
                                                {post.post_type?.emoji || "📝"}
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs text-white/70 leading-snug line-clamp-2">
                                                {post.caption?.split("\n")[0]?.substring(0, 60) || "—"}
                                            </p>
                                            <p className="mt-1 text-[10px] text-white/30 font-bold tracking-widest">
                                                {post.time_slot || "—"} {post.post_type?.emoji}
                                            </p>
                                        </div>
                                    </button>
                                ))}

                                {day.dayPosts.length === 0 && (
                                    <p className="text-[11px] text-white/20 py-2">Volno</p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="hidden sm:grid grid-cols-7 gap-2">
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
                                    const StatusIcon: Record<string, LucideIcon> = {
                                        draft: FileText,
                                        ready: CircleCheck,
                                        posted: Send,
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
                                                {(() => { const I = StatusIcon[post.status] || FileText; return <I className="w-3 h-3 shrink-0 text-white/50" /> })()}
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
                </>
            )}

            {/* Post detail modal — na telefonu vyjede zdola, tam se palcem dosáhne. */}
            {selectedPost && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setSelectedPost(null)}>
                    <div className="bg-[#0a0a0a] border border-white/10 rounded-t-sm sm:rounded-sm sm:max-w-lg w-full sm:mx-4 max-h-[85dvh] overflow-y-auto shadow-2xl pb-[env(safe-area-inset-bottom)] sm:pb-0" onClick={e => e.stopPropagation()}>
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
                                    <span className="text-[9px] text-white/30"><Clock className="w-3.5 h-3.5 shrink-0 inline-block align-[-2px] mr-1" />{selectedPost.time_slot}</span>
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
                                        className="flex-1 min-h-[44px] px-4 bg-emerald-500/10 border border-emerald-500/30 rounded-sm text-emerald-400 text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-500/20 transition-all cursor-pointer"
                                    >
                                        <span className="inline-flex items-center gap-1.5"><CircleCheck className="w-3.5 h-3.5 shrink-0" />Schválit</span>
                                    </button>
                                )}
                                <button
                                    onClick={() => setSelectedPost(null)}
                                    className="flex-1 min-h-[44px] px-4 bg-white/5 border border-white/10 rounded-sm text-white/50 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all cursor-pointer"
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
                <p><CalendarDays className="w-3.5 h-3.5 inline-block align-[-2px] mr-1" /><strong className="text-white/50">Naplánuj týden:</strong> AI analyzuje počasí, svátky a výkon značky, pak strategicky naplánuje posty na celý týden.</p>
                <p><CloudSun className="w-3.5 h-3.5 inline-block align-[-2px] mr-1" /><strong className="text-white/50">Počasí:</strong> Když je dostupná předpověď, plán ji zohlední. Jinak plánuje podle kalendáře, svátků a výkonu značky.</p>
                <p><FileText className="w-3.5 h-3.5 inline-block align-[-2px] mr-1" /><strong className="text-white/50">Workflow:</strong> Naplánuj → zkontroluj drafty → schval → publikuj.</p>
            </div>
        </div>
    )
}
