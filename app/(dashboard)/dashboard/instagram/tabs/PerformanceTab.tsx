"use client"

import { useEffect, useState, useCallback } from "react"
import { getPerformanceInsights, updateIGPostMetrics } from "@/app/actions/admin-actions"
import { getGrowthData, type GrowthData } from "@/app/actions/growth-actions"
import { useStudio } from "@/app/(dashboard)/StudioContext"

export function PerformanceTab({ projectId }: { projectId: string }) {
    const [posts, setPosts] = useState<any[]>([])
    const [insights, setInsights] = useState<any>(null)
    const [pillarLabels, setPillarLabels] = useState<Record<string, { emoji: string; label: string }>>({})
    const [loading, setLoading] = useState(true)
    const [editingMetrics, setEditingMetrics] = useState<Record<string, any>>({})
    const [savingId, setSavingId] = useState<string | null>(null)
    const [savedId, setSavedId] = useState<string | null>(null)

    const loadData = useCallback(async () => {
        if (!projectId) return
        setLoading(true)
        const data = await getPerformanceInsights(projectId)
        setPosts(data.posts)
        setInsights(data.insights)
        setPillarLabels(data.pillarLabels || {})
        // Init editing state from existing post metrics
        const metrics: Record<string, any> = {}
        for (const p of data.posts) {
            metrics[p.id] = {
                likes: p.likes || 0,
                comments: p.comments || 0,
                saves: p.saves || 0,
                reach: p.reach || 0,
                shares: p.shares || 0,
                profile_visits: p.profile_visits || 0,
                link_clicks: p.link_clicks || 0,
            }
        }
        setEditingMetrics(metrics)
        setLoading(false)
    }, [projectId])

    useEffect(() => { loadData() }, [loadData])

    const handleMetricChange = (postId: string, field: string, value: string) => {
        setEditingMetrics(prev => ({
            ...prev,
            [postId]: { ...prev[postId], [field]: parseInt(value) || 0 }
        }))
    }

    const handleSave = async (postId: string) => {
        setSavingId(postId)
        const metrics = editingMetrics[postId]
        if (metrics) {
            await updateIGPostMetrics(postId, metrics)
            setSavedId(postId)
            setTimeout(() => setSavedId(null), 2000)
            // Refresh insights after saving
            const data = await getPerformanceInsights(projectId)
            setInsights(data.insights)
        }
        setSavingId(null)
    }

    const metricFields = [
        { key: "likes", label: "❤️", title: "Likes" },
        { key: "comments", label: "💬", title: "Komentáře" },
        { key: "saves", label: "🔖", title: "Uložení" },
        { key: "reach", label: "👁", title: "Reach" },
        { key: "shares", label: "↗️", title: "Sdílení" },
        { key: "link_clicks", label: "🔗", title: "Kliky" },
    ]

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-white/20 border-t-white/80" />
            </div>
        )
    }

    const hasData = insights && insights.avgEngagement > 0

    return (
        <div className="space-y-8">
            {/* ── Růst profilu ───────────────────────────────── */}
            <GrowthSection projectId={projectId} />

            {/* ── Statistiky výkonu ──────────────────────────── */}
            <div>
                <h2 className="text-lg font-black uppercase tracking-tight text-white mb-4 flex items-center gap-2">
                    📊 Statistiky výkonu
                    {!hasData && <span className="text-[10px] font-normal normal-case tracking-normal text-white/30">— zatím žádná data, zadej metriky níže</span>}
                </h2>

                {hasData ? (
                    <>
                        {/* Key Metrics */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                            <div className="bg-[#0a0a0a]/80 border border-white/10 rounded-sm p-4">
                                <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Průměrná interakce</div>
                                <div className="text-2xl font-black text-white">{Math.round(insights.avgEngagement)}</div>
                            </div>
                            <div className="bg-[#0a0a0a]/80 border border-white/10 rounded-sm p-4">
                                <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Konverzní poměr</div>
                                <div className="text-2xl font-black text-white">{(insights.conversionRate * 100).toFixed(1)}%</div>
                            </div>
                            <div className="bg-[#0a0a0a]/80 border border-white/10 rounded-sm p-4">
                                <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Nejlepší čas</div>
                                <div className="text-2xl font-black text-white">{insights.bestTimeSlots?.[0] || "—"}</div>
                            </div>
                            <div className="bg-[#0a0a0a]/80 border border-white/10 rounded-sm p-4">
                                <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Postů s daty</div>
                                <div className="text-2xl font-black text-white">{posts.filter((p: any) => p.likes !== null && p.likes > 0).length}</div>
                            </div>
                        </div>

                        {/* Two Columns: Best Types + Top Patterns */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                            {/* Best Hooks */}
                            <div className="bg-[#0a0a0a]/80 border border-white/10 rounded-sm p-4">
                                <div className="text-[10px] text-white/40 uppercase tracking-wider mb-3">🎣 Nejlepší hooky</div>
                                <div className="space-y-2">
                                    {insights.bestHooks?.slice(0, 5).map((hook: string, i: number) => (
                                        <div key={i} className="flex items-start gap-2">
                                            <span className="text-[10px] text-white/30 font-mono mt-0.5">{i + 1}.</span>
                                            <span className="text-xs text-white/70 leading-relaxed">"{hook.substring(0, 80)}{hook.length > 80 ? "..." : ""}"</span>
                                        </div>
                                    ))}
                                    {(!insights.bestHooks || insights.bestHooks.length === 0) && (
                                        <span className="text-xs text-white/30">Žádná data</span>
                                    )}
                                </div>
                            </div>

                            {/* Top Patterns */}
                            <div className="bg-[#0a0a0a]/80 border border-white/10 rounded-sm p-4">
                                <div className="text-[10px] text-white/40 uppercase tracking-wider mb-3">🔍 Detekované vzorce</div>
                                <div className="flex flex-wrap gap-2">
                                    {insights.topPatterns?.map((pattern: string, i: number) => (
                                        <span key={i} className="inline-flex items-center px-3 py-1.5 bg-white/5 border border-white/10 rounded-sm text-[11px] text-white/70 font-medium">
                                            {pattern}
                                        </span>
                                    ))}
                                    {(!insights.topPatterns || insights.topPatterns.length === 0) && (
                                        <span className="text-xs text-white/30">Zadej metriky k postům pro detekci vzorců</span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Per-Pillar Performance */}
                        {insights.pillarPerformance && Object.keys(insights.pillarPerformance).length > 0 && (
                            <div>
                                <div className="text-[10px] text-white/40 uppercase tracking-wider mb-3">📊 Výkon podle témat</div>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    {Object.entries(insights.pillarPerformance).map(([key, perf]: [string, any]) => {
                                        const label = pillarLabels[key]
                                        return (
                                            <div key={key} className="bg-[#0a0a0a]/80 border border-white/10 rounded-sm p-3 text-center">
                                                <div className="text-lg mb-1">{label?.emoji || "📊"}</div>
                                                <div className="text-[10px] text-white/40 uppercase tracking-wider">{label?.label || key}</div>
                                                <div className="text-xl font-black text-white mt-1">{Math.round(perf.avgScore)}</div>
                                                {perf.topPatterns?.length > 0 && (
                                                    <div className="text-[9px] text-white/30 mt-1">{perf.topPatterns.slice(0, 2).join(", ")}</div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="bg-[#0a0a0a]/80 border border-white/10 rounded-sm p-6 text-center">
                        <div className="text-2xl mb-2">🧠</div>
                        <div className="text-sm text-white/50">Zadej metriky k publikovaným postům níže</div>
                        <div className="text-[10px] text-white/30 mt-1">Statistiky se zobrazí po přidání dat k alespoň 3 postům</div>
                    </div>
                )}
            </div>

            {/* ── Manual Metrics Input ──────────────────────── */}
            <div>
                <h2 className="text-lg font-black uppercase tracking-tight text-white mb-4 flex items-center gap-2">
                    📊 Manuální zadávání metrik
                    <span className="text-[10px] font-normal normal-case tracking-normal text-white/30">— {posts.length} postů</span>
                </h2>

                {posts.length === 0 ? (
                    <div className="bg-[#0a0a0a]/80 border border-white/10 rounded-sm p-6 text-center">
                        <div className="text-sm text-white/50">Žádné publikované posty</div>
                        <div className="text-[10px] text-white/30 mt-1">Vygeneruj posty a označ je jako "posted"</div>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {/* Header */}
                        <div className="hidden sm:grid grid-cols-[1fr_repeat(6,60px)_70px] gap-2 px-3 py-2">
                            <div className="text-[9px] text-white/30 uppercase tracking-wider">Post</div>
                            {metricFields.map(f => (
                                <div key={f.key} className="text-[9px] text-white/30 uppercase tracking-wider text-center" title={f.title}>{f.label}</div>
                            ))}
                            <div />
                        </div>

                        {/* Rows */}
                        {posts.map((post: any) => {
                            const metrics = editingMetrics[post.id] || {}
                            const isSaving = savingId === post.id
                            const isSaved = savedId === post.id
                            const hook = post.caption?.split("\n")[0]?.substring(0, 60) || "—"
                            const postType = post.ig_post_types?.name || post.content_pillar || "—"
                            const hasMetrics = post.likes !== null && post.likes > 0

                            return (
                                <div
                                    key={post.id}
                                    className={`grid grid-cols-1 sm:grid-cols-[1fr_repeat(6,60px)_70px] gap-2 items-center px-3 py-2.5 rounded-sm border transition-colors ${hasMetrics
                                            ? "bg-[#0a0a0a]/60 border-white/10"
                                            : "bg-[#0a0a0a]/40 border-white/5"
                                        }`}
                                >
                                    {/* Post info */}
                                    <div className="flex items-center gap-3 min-w-0">
                                        {post.image_url && (
                                            <img
                                                src={post.image_url.split("|")[0]}
                                                alt=""
                                                className="w-8 h-8 rounded-sm object-cover flex-shrink-0"
                                            />
                                        )}
                                        <div className="min-w-0">
                                            <div className="text-xs text-white/70 truncate">{hook}</div>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className="text-[9px] px-1.5 py-0.5 bg-white/5 border border-white/10 rounded-sm text-white/40">
                                                    {post.ig_post_types?.emoji || "📝"} {postType}
                                                </span>
                                                <span className="text-[9px] text-white/20">
                                                    {post.posted_at ? new Date(post.posted_at).toLocaleDateString("cs") : new Date(post.created_at).toLocaleDateString("cs")}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Metric inputs */}
                                    {metricFields.map(f => (
                                        <div key={f.key} className="flex sm:block items-center gap-2">
                                            <span className="sm:hidden text-[9px] text-white/30 w-8">{f.label}</span>
                                            <input
                                                type="number"
                                                min="0"
                                                value={metrics[f.key] || 0}
                                                onChange={e => handleMetricChange(post.id, f.key, e.target.value)}
                                                className="w-full sm:w-[60px] bg-[#0f0f0f] border border-white/10 rounded-sm px-2 py-1.5 text-xs text-white text-center font-mono focus:outline-none focus:border-white/30 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                title={f.title}
                                            />
                                        </div>
                                    ))}

                                    {/* Save button */}
                                    <button
                                        onClick={() => handleSave(post.id)}
                                        disabled={isSaving}
                                        className={`px-3 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-wider transition-all shadow-sm ${isSaved
                                                ? "bg-green-500/20 text-green-400 border border-green-500/30"
                                                : isSaving
                                                    ? "bg-white/5 text-white/30 border border-white/5"
                                                    : "bg-white/5 text-white/60 border border-white/10 hover:bg-white/10 hover:text-white"
                                            }`}
                                    >
                                        {isSaved ? "✓" : isSaving ? "..." : "Uložit"}
                                    </button>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* Info */}
            <div className="bg-[#0a0a0a]/60 border border-white/5 rounded-sm p-4 text-[10px] text-white/30 tracking-wide space-y-1">
                <p>🧠 <strong className="text-white/50">Neural Engine:</strong> Zadané metriky automaticky ovlivní příští generování — AI se naučí, co funguje líp.</p>
                <p>📊 <strong className="text-white/50">Insights:</strong> Zobrazí se po zadání metrik k alespoň 3 postům se statusem "posted".</p>
                <p>🔗 <strong className="text-white/50">Meta API:</strong> Automatické stahování metrik bude přidáno později — zatím zadávej ručně z IG Insights.</p>
            </div>
        </div>
    )
}

// ── Růst profilu — follower graf z týdenních snapshotů ─────────────
function GrowthSection({ projectId }: { projectId: string }) {
    const { subscription, setActiveSection } = useStudio()
    const [growth, setGrowth] = useState<GrowthData | null>(null)
    const [growthLoading, setGrowthLoading] = useState(true)
    const hasGrowthPlan = subscription?.growthTracking ?? false

    useEffect(() => {
        if (!projectId || !hasGrowthPlan) { setGrowthLoading(false); return }
        getGrowthData(projectId)
            .then(r => setGrowth(r.success ? r.data ?? null : null))
            .finally(() => setGrowthLoading(false))
    }, [projectId, hasGrowthPlan])

    if (!hasGrowthPlan) {
        return (
            <div className="bg-[#0a0a0a]/80 border border-white/10 rounded-sm p-6 flex items-center justify-between gap-4 flex-wrap">
                <div>
                    <h2 className="text-lg font-black uppercase tracking-tight text-white mb-1">📈 Růst profilu</h2>
                    <p className="text-xs text-white/40">Týdenní sledování followerů a graf růstu od startu je dostupný od balíčku <strong className="text-white/70">Růst</strong>.</p>
                </div>
                <button
                    onClick={() => setActiveSection("settings")}
                    className="px-5 py-2.5 rounded-sm bg-aisummit-cinnabar text-white text-[9px] font-bold uppercase tracking-widest hover:bg-aisummit-cinnabar/90 transition-all"
                >
                    🔓 Odemknout
                </button>
            </div>
        )
    }

    if (growthLoading) {
        return <div className="bg-[#0a0a0a]/80 border border-white/10 rounded-sm p-6 h-24 animate-pulse" />
    }

    const points = [
        ...(growth?.baseline ? [growth.baseline] : []),
        ...(growth?.snapshots || []),
    ]

    return (
        <div className="bg-[#0a0a0a]/80 border border-white/10 rounded-sm p-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h2 className="text-lg font-black uppercase tracking-tight text-white">📈 Růst profilu</h2>
                <div className="flex items-center gap-4">
                    {growth?.currentFollowers !== null && growth?.currentFollowers !== undefined && (
                        <div className="text-right">
                            <div className="text-[9px] text-white/40 uppercase tracking-widest font-bold">Followers</div>
                            <div className="text-xl font-black text-white">{growth.currentFollowers.toLocaleString("cs")}</div>
                        </div>
                    )}
                    {growth?.deltaSinceStart !== null && growth?.deltaSinceStart !== undefined && (
                        <div className="text-right">
                            <div className="text-[9px] text-white/40 uppercase tracking-widest font-bold">Od startu</div>
                            <div className={`text-xl font-black ${growth.deltaSinceStart >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                {growth.deltaSinceStart >= 0 ? "+" : ""}{growth.deltaSinceStart.toLocaleString("cs")}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {points.length >= 2 ? (
                <GrowthChart points={points} />
            ) : (
                <p className="text-xs text-white/30">
                    {points.length === 1
                        ? `Výchozí bod: ${points[0].followers.toLocaleString("cs")} followerů (${new Date(points[0].date).toLocaleDateString("cs")}). První týdenní snapshot se pořídí v pondělí ráno — graf poroste s vámi.`
                        : "Zatím žádná data — snapshoty followerů se pořizují automaticky každé pondělí."}
                </p>
            )}
        </div>
    )
}

function GrowthChart({ points }: { points: { date: string; followers: number }[] }) {
    const W = 800
    const H = 160
    const PAD = 8
    const min = Math.min(...points.map(p => p.followers))
    const max = Math.max(...points.map(p => p.followers))
    const range = Math.max(1, max - min)
    const x = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2)
    const y = (f: number) => H - PAD - ((f - min) / range) * (H - PAD * 2)
    const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.followers).toFixed(1)}`).join(" ")
    const area = `${path} L${x(points.length - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`

    return (
        <div>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40" preserveAspectRatio="none">
                <path d={area} fill="rgba(16,185,129,0.08)" />
                <path d={path} fill="none" stroke="rgb(16,185,129)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                {points.map((p, i) => (
                    <circle key={i} cx={x(i)} cy={y(p.followers)} r="3" fill="rgb(16,185,129)" />
                ))}
            </svg>
            <div className="flex justify-between mt-1">
                <span className="text-[9px] text-white/25 font-bold">{new Date(points[0].date).toLocaleDateString("cs")}</span>
                <span className="text-[9px] text-white/25 font-bold">{new Date(points[points.length - 1].date).toLocaleDateString("cs")}</span>
            </div>
        </div>
    )
}
