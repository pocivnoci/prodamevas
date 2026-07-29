"use client"

import { useEffect, useState } from "react"
import { getIGPostsList, getProfilePreview } from "@/app/actions/admin-actions"
import { getFeedPatternPreview } from "@/app/actions/content-plan-actions"
import { VISUAL_MODE_LABELS, type VisualMode } from "@/lib/feed-pattern"

interface FeedPost {
    id: string
    caption: string | null
    image_url: string | null
    status: string
    created_at: string
    scheduled_for: string | null
    time_slot: string | null
    post_type?: { name: string; display_name: string; emoji: string }
}

interface ProfilePreview {
    handle: string | null
    avatarUrl: string | null
    followerCount: number | null
    postCount: number
}

export function FeedTab({ projectId }: { projectId: string }) {
    const [posts, setPosts] = useState<FeedPost[]>([])
    const [profile, setProfile] = useState<ProfilePreview | null>(null)
    const [loading, setLoading] = useState(true)
    const [selectedPost, setSelectedPost] = useState<FeedPost | null>(null)
    // The grid rhythm + the modes of the posts that haven't been made yet.
    const [pattern, setPattern] = useState<{ patternId: string; label: string; gridAligned: boolean; ghostRoles: VisualMode[] } | null>(null)

    useEffect(() => {
        if (!projectId) return
        setLoading(true)
        getProfilePreview(projectId).then(setProfile).catch(() => setProfile(null))
        getFeedPatternPreview(projectId).then(setPattern).catch(() => setPattern(null))
        getIGPostsList(undefined, projectId, 0, 100).then(result => {
            // "Future profile" order: scheduled posts first, newest-scheduled on top
            // (like IG shows newest first), then unscheduled by creation date.
            // Stories never appear in the profile grid, so they must not appear here either.
            // This filter MUST stay identical to countFeedPosts() in instagram/service.ts —
            // the engine computes each post's grid position from that count, and a preview
            // built from a different set draws ghost cells that lie. (JS !== is NULL-safe,
            // unlike PostgREST's .neq() — see the note in countFeedPosts.)
            const withImages = (result.posts || [])
                .filter((p: any) => p.image_url && p.media_type !== "story")
                .sort((a: any, b: any) => {
                    const ka = a.scheduled_for ? new Date(a.scheduled_for).getTime() : null
                    const kb = b.scheduled_for ? new Date(b.scheduled_for).getTime() : null
                    if (ka !== null && kb !== null) return kb - ka
                    if (ka !== null) return -1 // scheduled before unscheduled
                    if (kb !== null) return 1
                    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                })
            setPosts(withImages)
            setLoading(false)
        })
    }, [projectId])

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-white/20 border-t-white/80" />
            </div>
        )
    }

    if (posts.length === 0) {
        return (
            <div className="text-center py-20">
                <p className="text-4xl mb-3 opacity-30">📱</p>
                <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest">Žádné příspěvky s obrázky</p>
                <p className="text-[10px] text-white/25 mt-1">Vygenerujte obsah v sekci Generovat</p>
            </div>
        )
    }

    // Stats
    const posted = posts.filter(p => p.status === "posted").length
    const ready = posts.filter(p => p.status === "ready").length
    const drafts = posts.filter(p => p.status === "draft").length

    return (
        <div className="space-y-6">
            {/* IG Profile Header */}
            <div className="bg-[#0a0a0a]/80 border border-white/10 rounded-sm p-6">
                <div className="flex items-center gap-6">
                    {/* Avatar: brand logo, falls back to the first post image on 404 */}
                    <div className="w-20 h-20 rounded-full border-2 border-white/20 overflow-hidden flex-shrink-0 bg-white/5">
                        {(profile?.avatarUrl || posts[0]?.image_url) && (
                            <img
                                src={profile?.avatarUrl || posts[0]!.image_url!.split("|")[0]}
                                alt=""
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                    const fallback = posts[0]?.image_url?.split("|")[0]
                                    if (fallback && e.currentTarget.src !== fallback) e.currentTarget.src = fallback
                                }}
                            />
                        )}
                    </div>
                    <div className="flex-1">
                        <div className="flex items-center gap-4 mb-3">
                            <span className="text-white font-bold text-sm">@{profile?.handle || "brand"}</span>
                        </div>
                        <div className="flex gap-8">
                            <div className="text-center">
                                <p className="text-white font-black text-lg">{profile?.postCount ?? posts.length}</p>
                                <p className="text-[9px] text-white/40 uppercase tracking-widest font-bold">příspěvků</p>
                            </div>
                            <div className="text-center">
                                <p className="text-white font-black text-lg">{profile?.followerCount != null ? profile.followerCount.toLocaleString("cs-CZ") : "—"}</p>
                                <p className="text-[9px] text-white/40 uppercase tracking-widest font-bold">sledujících</p>
                            </div>
                            <div className="text-center">
                                <p className="text-emerald-400 font-black text-lg">{posted}</p>
                                <p className="text-[9px] text-white/40 uppercase tracking-widest font-bold">publikováno</p>
                            </div>
                            <div className="text-center">
                                <p className="text-blue-400 font-black text-lg">{ready}</p>
                                <p className="text-[9px] text-white/40 uppercase tracking-widest font-bold">naplánováno</p>
                            </div>
                            <div className="text-center">
                                <p className="text-amber-400 font-black text-lg">{drafts}</p>
                                <p className="text-[9px] text-white/40 uppercase tracking-widest font-bold">drafty</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Feed pattern banner — what shape the grid is being built toward */}
            {pattern && pattern.patternId !== "none" && (
                <div className="flex items-center justify-between gap-4 bg-[#0a0a0a]/80 border border-white/10 rounded-sm px-4 py-3">
                    <div className="flex items-center gap-3">
                        <span className="text-[9px] text-white/40 uppercase tracking-widest font-bold">Vzor feedu</span>
                        <span className="text-[11px] text-aisummit-cinnabar font-bold uppercase tracking-widest">🔲 {pattern.label}</span>
                    </div>
                    {pattern.gridAligned && (
                        <span className="text-[9px] text-white/25 font-bold uppercase tracking-widest text-right">
                            Nejlépe drží tvar při publikování po celých řádcích
                        </span>
                    )}
                </div>
            )}

            {/* Feed Grid — 3 columns like IG. Ghost cells go FIRST: the grid is newest-first,
                so the posts that don't exist yet belong above the ones that do. */}
            <div className="grid grid-cols-3 gap-1">
                {(pattern?.ghostRoles || []).map((mode, i) => {
                    const m = VISUAL_MODE_LABELS[mode]
                    return (
                        <div
                            key={`ghost-${i}`}
                            title={`Další post v pořadí: ${m.label}`}
                            className="relative aspect-square border border-dashed border-white/15 bg-white/[0.02] flex flex-col items-center justify-center gap-1"
                        >
                            <span className="text-lg opacity-30">{m.icon}</span>
                            <span className="text-[8px] text-white/25 uppercase tracking-widest font-bold">{m.label}</span>
                        </div>
                    )
                })}
                {posts.map(post => {
                    const statusDot: Record<string, string> = {
                        posted: "bg-emerald-500",
                        ready: "bg-blue-500",
                        draft: "bg-amber-500",
                    }
                    return (
                        <button
                            key={post.id}
                            onClick={() => setSelectedPost(post)}
                            className="relative aspect-square overflow-hidden group cursor-pointer"
                        >
                            <img
                                src={post.image_url!.split("|")[0]}
                                alt=""
                                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                            />
                            {/* Hover overlay */}
                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <span className="text-white text-xs font-bold uppercase tracking-wider">
                                    {post.post_type?.emoji || "📸"}
                                </span>
                            </div>
                            {/* Carousel indicator */}
                            {post.image_url!.includes("|") && (
                                <div className="absolute top-2 left-2 text-white/80 text-[10px]">🖼️🖼️</div>
                            )}
                            {/* Status dot */}
                            <div className={`absolute top-2 right-2 w-2 h-2 rounded-full ${statusDot[post.status] || "bg-white/30"} shadow-lg`} />
                            {/* Scheduled date — so the grid reads as a future plan */}
                            {post.scheduled_for && (
                                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1 text-[9px] font-bold text-white/90 text-left">
                                    📅 {new Date(post.scheduled_for).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" })}
                                    {post.time_slot ? ` · ${post.time_slot}` : ""}
                                </div>
                            )}
                        </button>
                    )
                })}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-6 justify-center">
                <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-[9px] text-white/40 uppercase tracking-widest font-bold">Publikováno</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-blue-500" />
                    <span className="text-[9px] text-white/40 uppercase tracking-widest font-bold">Naplánováno</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-amber-500" />
                    <span className="text-[9px] text-white/40 uppercase tracking-widest font-bold">Draft</span>
                </div>
            </div>

            {/* Post Detail Modal */}
            {selectedPost && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setSelectedPost(null)}>
                    <div className="bg-[#0a0a0a] border border-white/10 rounded-sm max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
                        {selectedPost.image_url && (
                            <img src={selectedPost.image_url.split("|")[0]} alt="" className="w-full aspect-square object-cover" />
                        )}
                        <div className="p-5 space-y-3">
                            <div className="flex items-center gap-2">
                                <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-sm border ${
                                    selectedPost.status === "posted"
                                        ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                                        : selectedPost.status === "ready"
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
                            </div>
                            <p className="text-white/80 text-sm leading-relaxed whitespace-pre-line line-clamp-6">
                                {selectedPost.caption}
                            </p>
                            <button
                                onClick={() => setSelectedPost(null)}
                                className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-sm text-white/50 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all"
                            >
                                Zavřít
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
