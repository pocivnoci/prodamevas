"use client"

import { useEffect, useState, useCallback } from "react"
import { createPortal } from "react-dom"
import { motion } from "framer-motion"
import { getIGPostsList, updateIGPostStatus, deleteIGPost, revisePost } from "@/app/actions/admin-actions"
import { LoadingSpinner, StatusBadge, PillarBadge, CopyButton, MetricsInputForm } from "./shared"
import { useCopyToClipboard } from "./hooks"
import type { IGPost } from "./types"

// ═══════════════════════════════════════════════════════════
// POSTS TAB  (with detail modal + copy/download)
// ═══════════════════════════════════════════════════════════

export function PostsTab({ projectId }: { projectId: string }) {
    const [posts, setPosts] = useState<IGPost[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [statusFilter, setStatusFilter] = useState("all")
    const [selectedPost, setSelectedPost] = useState<IGPost | null>(null)

    const loadPosts = async () => {
        if (!projectId) return
        setLoading(true)
        setError(null)
        try {
            const data = await getIGPostsList(statusFilter, projectId)
            setPosts(data)
        } catch (err: any) {
            setError(err?.message || "Nepodařilo se načíst příspěvky")
            setPosts([])
        }
        setLoading(false)
    }

    useEffect(() => { loadPosts() }, [statusFilter, projectId])

    const handleStatusChange = async (postId: string, newStatus: string) => {
        await updateIGPostStatus(postId, newStatus)
        setSelectedPost(null)
        loadPosts()
    }

    const handleDelete = async (postId: string) => {
        await deleteIGPost(postId, projectId)
        setSelectedPost(null)
        loadPosts()
    }

    if (loading) return <LoadingSpinner />
    if (error) return (
        <div className="text-center py-12">
            <p className="text-aisummit-cinnabar mb-4 font-bold uppercase tracking-widest text-sm">❌ {error}</p>
            <button onClick={loadPosts} className="px-5 py-2.5 bg-[#0f0f0f] shadow-sm border border-white/10 text-white rounded-sm text-xs font-bold uppercase tracking-widest hover:bg-white/10 transition-colors">
                🔄 Zkusit znovu
            </button>
        </div>
    )

    return (
        <div className="space-y-6 pt-2">
            {/* Filters */}
            <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-hide">
                {["all", "draft", "ready", "posted"].map(status => (
                    <button
                        key={status}
                        onClick={() => setStatusFilter(status)}
                        className={`px-5 py-2 text-xs font-bold uppercase tracking-wider rounded-sm transition-all shadow-sm whitespace-nowrap border ${statusFilter === status
                            ? "bg-white/10 text-white border-white/20 shadow-md"
                            : "text-white/50 bg-[#0f0f0f] border-white/10 hover:text-white hover:bg-white/5"
                            }`}
                    >
                        {status === "all" ? "Všechny" : status === "draft" ? "Drafty" : status === "ready" ? "Připravené" : "Publikované"}
                    </button>
                ))}
                <span className="text-xs font-mono uppercase tracking-widest text-white/40 ml-auto whitespace-nowrap pl-4">{posts.length} příspěvků</span>
            </div>

            {/* Posts Grid */}
            <motion.div
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
                initial="hidden"
                animate="visible"
                variants={{
                    hidden: { opacity: 0 },
                    visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
                }}
            >
                {posts.map(post => (
                    <motion.div
                        variants={{
                            hidden: { opacity: 0, scale: 0.98, y: 15 },
                            visible: { opacity: 1, scale: 1, y: 0 }
                        }}
                        key={post.id}
                        onClick={() => setSelectedPost(post)}
                        className="bg-[#0a0a0a]/80 backdrop-blur-md rounded-sm p-3 border border-white/10 hover:border-white/30 transition-all cursor-pointer group flex flex-col"
                    >
                        {/* Image Preview */}
                        {post.image_url ? (
                            <div className="w-full h-56 rounded-sm bg-[#0f0f0f] overflow-hidden relative mb-4">
                                <img
                                    src={post.image_url.split("|")[0]}
                                    alt=""
                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
                            </div>
                        ) : (
                            <div className="w-full h-56 rounded-sm bg-[#0f0f0f]/50 border border-white/5 flex flex-col items-center justify-center mb-4 gap-2">
                                <span className="text-2xl opacity-50">🖼️</span>
                                <span className="text-white/40 font-bold uppercase tracking-widest text-[10px]">Bez obrázku</span>
                            </div>
                        )}

                        {/* Content */}
                        <div className="flex-1 px-3 pb-3 flex flex-col">
                            <div className="flex items-start justify-between gap-2 mb-4">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{post.ig_post_types?.display_name || "Generický Post"}</span>
                                    {post.content_pillar && <PillarBadge pillar={post.content_pillar} />}
                                </div>
                                <span className="text-sm bg-white/5 shadow-sm border border-white/10 px-2 py-1 rounded-sm">{post.ig_post_types?.emoji || "📸"}</span>
                            </div>

                            <p className="text-sm text-white/70 line-clamp-2 leading-relaxed mb-6 font-medium">
                                {post.caption || "Bez textu"}
                            </p>

                            <div className="flex items-center justify-between mt-auto pt-4 border-t border-white/10">
                                <StatusBadge status={post.status} />
                                <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">
                                    {new Date(post.created_at).toLocaleDateString("cs-CZ")}
                                </span>
                            </div>
                        </div>
                    </motion.div>
                ))}
            </motion.div>

            {
                posts.length === 0 && !loading && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                        className="text-center py-24 xl:py-32 text-white/40"
                    >
                        <p className="text-4xl mb-4 text-white/20 font-black tracking-tighter uppercase">Prázdné plátno</p>
                        <p className="font-bold tracking-widest text-xs uppercase text-white/40">Zatím zde nejsou žádné příspěvky. Přepněte do sekce Generovat a nechte se inspirovat.</p>
                    </motion.div>
                )
            }

            {/* Post Detail Modal */}
            {selectedPost && (
                    <PostDetailModal
                        post={selectedPost}
                        projectId={projectId}
                        onClose={() => setSelectedPost(null)}
                        onStatusChange={handleStatusChange}
                        onDelete={handleDelete}
                    />
                )}
        </div >
    )
}

// ═══════════════════════════════════════════════════════════
// POST DETAIL MODAL — full view + copy/download
// ═══════════════════════════════════════════════════════════

function PostDetailModal({
    post,
    projectId,
    onClose,
    onStatusChange,
    onDelete,
}: {
    post: IGPost
    projectId: string
    onClose: () => void
    onStatusChange: (postId: string, status: string) => void
    onDelete: (postId: string) => void
}) {
    const { copiedField, copyToClipboard } = useCopyToClipboard()
    const [confirmDelete, setConfirmDelete] = useState(false)
    const [feedbackText, setFeedbackText] = useState("")
    const [revising, setRevising] = useState(false)
    const [revisionResult, setRevisionResult] = useState<{ success: boolean; newPostId?: string; error?: string } | null>(null)

    // Lock ALL scroll containers when modal is open
    useEffect(() => {
        // The admin layout uses <main class="overflow-auto"> as the scroll container
        const mainEl = document.querySelector("main")
        const originalBodyOverflow = document.body.style.overflow
        const originalMainOverflow = mainEl?.style.overflow || ""

        document.body.style.overflow = "hidden"
        if (mainEl) mainEl.style.overflow = "hidden"

        return () => {
            document.body.style.overflow = originalBodyOverflow
            if (mainEl) mainEl.style.overflow = originalMainOverflow
        }
    }, [])

    const downloadImage = useCallback(async () => {
        if (!post.image_url) return
        const url = post.image_url.split("|")[0]
        try {
            const response = await fetch(url)
            const blob = await response.blob()
            const blobUrl = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = blobUrl
            a.download = `ig-post-${post.id.substring(0, 8)}.png`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(blobUrl)
        } catch {
            window.open(url, "_blank")
        }
    }, [post])

    const hashtags = Array.isArray(post.hashtags) ? post.hashtags : []
    const hashtagsText = hashtags.join(" ")
    const fullText = [post.caption, hashtagsText].filter(Boolean).join("\n\n")

    return createPortal(
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4"
            style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0 }}
            onClick={onClose}
        >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

            {/* Content */}
            <div
                className="relative w-full sm:max-w-4xl max-h-[90vh] bg-[#0a0a0a] border border-white/10 rounded-sm overflow-hidden flex flex-col shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-white/10">
                    <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-lg bg-white/5 px-2 py-1 rounded-sm border border-white/10">{post.ig_post_types?.emoji || "📸"}</span>
                        <div>
                            <h3 className="text-white font-black uppercase tracking-tighter">{post.ig_post_types?.display_name || "Post"}</h3>
                            <p className="text-[10px] text-white/40 font-mono tracking-widest uppercase">{new Date(post.created_at).toLocaleString("cs-CZ")}</p>
                        </div>
                        {post.content_pillar && <PillarBadge pillar={post.content_pillar} />}
                        <StatusBadge status={post.status} />
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 rounded-sm transition-colors border border-transparent hover:border-white/10"
                    >
                        ✕
                    </button>
                </div>

                {/* Body — scrollable */}
                <div className="flex-1 overflow-y-auto">
                    <div className="flex flex-col lg:flex-row">
                        {/* Left: Image */}
                        <div className="lg:w-1/2 bg-[#0f0f0f] border-r border-white/10 flex items-center justify-center p-4">
                            {post.image_url ? (
                                <img
                                    src={post.image_url.split("|")[0]}
                                    alt=""
                                    className="max-w-full max-h-[300px] sm:max-h-[500px] rounded-sm object-contain border border-white/10 shadow-lg"
                                />
                            ) : (
                                <div className="text-white/20 text-center py-20 border border-white/5 rounded-sm p-12 flex flex-col items-center justify-center">
                                    <p className="text-4xl mb-4">🖼️</p>
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Žádný obrázek</p>
                                </div>
                            )}
                        </div>

                        {/* Right: Texts */}
                        <div className="lg:w-1/2 p-4 sm:p-6 space-y-4 sm:space-y-5">
                            {/* Caption */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[10px] font-bold text-white/50 uppercase tracking-widest">Caption</span>
                                    <CopyButton
                                        onClick={() => copyToClipboard(post.caption || "", "caption")}
                                        copied={copiedField === "caption"}
                                    />
                                </div>
                                <div className="bg-[#0f0f0f] border border-white/5 rounded-sm p-4 max-h-60 overflow-y-auto shadow-inner">
                                    <p className="text-sm text-white/70 whitespace-pre-wrap leading-relaxed font-medium">
                                        {post.caption || "—"}
                                    </p>
                                </div>
                            </div>

                            {/* Hashtags */}
                            {hashtags.length > 0 && (
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-[10px] font-bold text-white/50 uppercase tracking-widest">Hashtags ({hashtags.length})</span>
                                        <CopyButton
                                            onClick={() => copyToClipboard(hashtagsText, "hashtags")}
                                            copied={copiedField === "hashtags"}
                                        />
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {hashtags.map((h: string, i: number) => (
                                            <span
                                                key={i}
                                                onClick={() => copyToClipboard(h, `tag-${i}`)}
                                                className="text-[10px] text-white/70 bg-white/5 px-2.5 py-1 rounded-sm border border-white/10 cursor-pointer hover:bg-white/10 transition-colors uppercase tracking-wider"
                                            >
                                                {h}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Image Prompt */}
                            {post.image_prompt && (
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-[10px] font-bold text-white/50 uppercase tracking-widest">Image Prompt</span>
                                        <CopyButton
                                            onClick={() => copyToClipboard(post.image_prompt || "", "prompt")}
                                            copied={copiedField === "prompt"}
                                        />
                                    </div>
                                    <p className="text-[10px] font-mono text-white/40 bg-[#0f0f0f] border border-white/5 rounded-sm p-3 shadow-inner">
                                        {post.image_prompt}
                                    </p>
                                </div>
                            )}

                            {/* Copy All / Full Text */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[10px] font-bold text-white/50 uppercase tracking-widest">Celý text (caption + hashtags)</span>
                                    <CopyButton
                                        onClick={() => copyToClipboard(fullText, "full")}
                                        copied={copiedField === "full"}
                                        label="Kopírovat vše"
                                    />
                                </div>
                            </div>

                            {/* Quality Score */}
                            {post.quality_score && (
                                <div className="flex items-center gap-4 p-3 bg-[#1e293b]/30 rounded-xl">
                                    <div>
                                        <span className="text-xs text-gray-500">Kvalita</span>
                                        <p className="text-lg font-bold text-blue-400">{post.quality_score}/100</p>
                                    </div>
                                    <div className="flex-1 h-2 bg-[#0a0e1a] rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-gradient-to-r from-blue-600 to-purple-600 rounded-full transition-all"
                                            style={{ width: `${post.quality_score}%` }}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Metrics Input — only for posted posts */}
                            {post.status === "posted" && (
                                <MetricsInputForm post={post} onUpdate={onClose} />
                            )}
                        </div>
                    </div>
                </div>

                {/* Revision Panel */}
                <div className="px-4 sm:px-6 py-4 border-t border-white/10 bg-[#030303]">
                    <p className="text-[9px] uppercase tracking-widest font-bold text-white/30 mb-2">💬 Feedback k revizi</p>
                    {revisionResult?.success ? (
                        <div className="flex items-center gap-3 py-2">
                            <span className="text-xs text-emerald-400">✅ Revize hotova — nový draft vytvořen</span>
                            <button
                                onClick={() => { onClose() }}
                                className="text-[10px] underline text-white/40 hover:text-white/70"
                            >
                                Zobrazit v seznamu
                            </button>
                        </div>
                    ) : (
                        <div className="flex gap-2 items-start">
                            <textarea
                                value={feedbackText}
                                onChange={e => setFeedbackText(e.target.value)}
                                placeholder="Např: přidej emoji, zkrať text, zmiň konkrétní cenu..."
                                rows={2}
                                className="flex-1 px-3 py-2 bg-[#050505] border border-white/10 rounded-sm text-white text-xs resize-none focus:outline-none focus:ring-1 focus:ring-white/20 placeholder:text-white/20"
                            />
                            <button
                                onClick={async () => {
                                    if (!feedbackText.trim() || revising) return
                                    setRevising(true)
                                    const result = await revisePost(post.id, feedbackText.trim(), projectId)
                                    setRevisionResult(result)
                                    setRevising(false)
                                }}
                                disabled={revising || !feedbackText.trim()}
                                className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-white/5 text-white/60 hover:bg-white/10 hover:text-white transition-all border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap flex-shrink-0"
                            >
                                {revising ? (
                                    <span className="flex items-center gap-1.5">
                                        <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" opacity=".25"/><path d="M12 2a10 10 0 0 1 10 10" /></svg>
                                        Přepracovávám...
                                    </span>
                                ) : "🔄 Přepracovat"}
                            </button>
                        </div>
                    )}
                    {revisionResult?.error && (
                        <p className="text-[10px] text-red-400 mt-1.5">❌ {revisionResult.error}</p>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="px-4 sm:px-6 py-3 sm:py-4 bg-[#050505] border-t border-white/10 flex flex-wrap items-center gap-2 sm:gap-3">
                    {/* Download Image */}
                    {post.image_url && (
                        <button
                            onClick={downloadImage}
                            className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-[#0f0f0f] text-white/70 hover:bg-white/10 hover:text-white transition-all flex items-center gap-2 border border-white/10"
                        >
                            ⬇️ Stáhnout obrázek
                        </button>
                    )}

                    {/* Copy Full */}
                    <button
                        onClick={() => copyToClipboard(fullText, "full-btn")}
                        className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-[#0f0f0f] text-white/70 hover:bg-white/10 hover:text-white transition-all flex items-center gap-2 border border-white/10"
                    >
                        {copiedField === "full-btn" ? "✅ Zkopírováno!" : "📋 Kopírovat text"}
                    </button>

                    {/* Spacer */}
                    <div className="flex-1" />

                    {/* Status Actions */}
                    {post.status === "draft" && (
                        <>
                            <button
                                onClick={() => onStatusChange(post.id, "ready")}
                                className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all border border-blue-500/20"
                            >
                                → Označit jako Ready
                            </button>
                            <button
                                onClick={() => onStatusChange(post.id, "posted")}
                                className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-all border border-emerald-500/20"
                            >
                                ✓ Publikováno
                            </button>
                        </>
                    )}
                    {post.status === "ready" && (
                        <>
                            <button
                                onClick={() => onStatusChange(post.id, "draft")}
                                className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-all border border-amber-500/20"
                            >
                                ← Zpět na Draft
                            </button>
                            <button
                                onClick={() => onStatusChange(post.id, "posted")}
                                className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-all border border-emerald-500/20"
                            >
                                ✓ Publikováno
                            </button>
                        </>
                    )}
                    {post.status === "posted" && (
                        <button
                            onClick={() => onStatusChange(post.id, "archived")}
                            className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-white/5 text-white/40 hover:bg-white/10 transition-all border border-white/10"
                        >
                            📦 Archivovat
                        </button>
                    )}

                    {/* Delete */}
                    {!confirmDelete ? (
                        <button
                            onClick={() => setConfirmDelete(true)}
                            className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-all border border-transparent hover:border-red-500/20"
                        >
                            🗑️ Smazat
                        </button>
                    ) : (
                        <button
                            onClick={() => onDelete(post.id)}
                            className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse"
                        >
                            ⚠️ Opravdu smazat?
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body
    )
}
