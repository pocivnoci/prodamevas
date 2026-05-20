"use client"

import { useEffect, useState } from "react"
import { getIGPostsList } from "@/app/actions/admin-actions"

interface FeedPost {
    id: string
    caption: string
    image_url: string | null
    status: string
    created_at: string
    post_type?: { name: string; display_name: string; emoji: string }
}

export function FeedTab({ projectId }: { projectId: string }) {
    const [posts, setPosts] = useState<FeedPost[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedPost, setSelectedPost] = useState<FeedPost | null>(null)

    useEffect(() => {
        if (!projectId) return
        setLoading(true)
        getIGPostsList(undefined, projectId, 0, 100).then(result => {
            // Show only posts with images, prioritize posted > ready > draft
            const withImages = (result.posts || [])
                .filter((p: any) => p.image_url)
                .sort((a: any, b: any) => {
                    const statusOrder: Record<string, number> = { posted: 0, ready: 1, draft: 2 }
                    const sa = statusOrder[a.status] ?? 3
                    const sb = statusOrder[b.status] ?? 3
                    if (sa !== sb) return sa - sb
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
                    {/* Profile pic placeholder (first post image) */}
                    <div className="w-20 h-20 rounded-full border-2 border-white/20 overflow-hidden flex-shrink-0 bg-white/5">
                        {posts[0]?.image_url && (
                            <img src={posts[0].image_url} alt="" className="w-full h-full object-cover" />
                        )}
                    </div>
                    <div className="flex-1">
                        <div className="flex items-center gap-4 mb-3">
                            <span className="text-white font-bold text-sm">@brand</span>
                        </div>
                        <div className="flex gap-8">
                            <div className="text-center">
                                <p className="text-white font-black text-lg">{posts.length}</p>
                                <p className="text-[9px] text-white/40 uppercase tracking-widest font-bold">příspěvků</p>
                            </div>
                            <div className="text-center">
                                <p className="text-emerald-400 font-black text-lg">{posted}</p>
                                <p className="text-[9px] text-white/40 uppercase tracking-widest font-bold">publikováno</p>
                            </div>
                            <div className="text-center">
                                <p className="text-blue-400 font-black text-lg">{ready}</p>
                                <p className="text-[9px] text-white/40 uppercase tracking-widest font-bold">ke schválení</p>
                            </div>
                            <div className="text-center">
                                <p className="text-amber-400 font-black text-lg">{drafts}</p>
                                <p className="text-[9px] text-white/40 uppercase tracking-widest font-bold">drafty</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Feed Grid — 3 columns like IG */}
            <div className="grid grid-cols-3 gap-1">
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
                                src={post.image_url!}
                                alt=""
                                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                            />
                            {/* Hover overlay */}
                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <span className="text-white text-xs font-bold uppercase tracking-wider">
                                    {post.post_type?.emoji || "📸"}
                                </span>
                            </div>
                            {/* Status dot */}
                            <div className={`absolute top-2 right-2 w-2 h-2 rounded-full ${statusDot[post.status] || "bg-white/30"} shadow-lg`} />
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
                    <span className="text-[9px] text-white/40 uppercase tracking-widest font-bold">Ke schválení</span>
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
                            <img src={selectedPost.image_url} alt="" className="w-full aspect-square object-cover" />
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
