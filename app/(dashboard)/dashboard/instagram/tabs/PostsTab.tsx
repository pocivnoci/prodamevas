"use client"

import { useEffect, useState, useCallback } from "react"
import { createPortal } from "react-dom"
import { motion } from "framer-motion"
import { getIGPostsList, updateIGPostStatus, getEditorialLog } from "@/app/actions/admin-actions"
import { deleteIGPost, deleteIGPosts } from "@/app/actions/post-actions"
import { revisePost, generateMultipleVariants, selectVariantWinner, getVariantGroup } from "@/app/actions/variant-actions"
import { retryPublishAction } from "@/app/actions/calendar-actions"
import { LoadingSpinner, StatusBadge, PillarBadge, CopyButton, MetricsInputForm } from "./shared"
import { PublishHandoffModal } from "./PublishHandoffModal"
import { getConnectionStatus } from "@/app/actions/ig-connection-actions"
import { useCopyToClipboard } from "./hooks"
import type { IGPost } from "./types"
import { trackEvent } from "@/lib/analytics"
import { usePaywall } from "@/app/(dashboard)/PaywallProvider"

// ═══════════════════════════════════════════════════════════
// POSTS TAB  (with detail modal + copy/download)
// ═══════════════════════════════════════════════════════════

export function PostsTab({ projectId }: { projectId: string }) {
    const [posts, setPosts] = useState<IGPost[]>([])
    const [loading, setLoading] = useState(true)
    const [loadingMore, setLoadingMore] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [statusFilter, setStatusFilter] = useState("all")
    const [selectedPost, setSelectedPost] = useState<IGPost | null>(null)
    const [handoffPost, setHandoffPost] = useState<IGPost | null>(null)
    const [igConnected, setIgConnected] = useState(false)
    const [page, setPage] = useState(0)
    const [total, setTotal] = useState(0)
    const [hasMore, setHasMore] = useState(false)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [bulkDeleting, setBulkDeleting] = useState(false)

    const loadPosts = async (pageNum: number = 0, append: boolean = false) => {
        if (!projectId) return
        if (append) {
            setLoadingMore(true)
        } else {
            setLoading(true)
        }
        setError(null)
        try {
            const result = await getIGPostsList(statusFilter, projectId, pageNum)
            if (append) {
                setPosts(prev => [...prev, ...result.posts])
            } else {
                setPosts(result.posts)
            }
            setTotal(result.total)
            setHasMore(result.hasMore)
            setPage(pageNum)
        } catch (err: any) {
            setError(err?.message || "Nepodařilo se načíst příspěvky")
            if (!append) setPosts([])
        }
        setLoading(false)
        setLoadingMore(false)
    }

    const loadMore = () => loadPosts(page + 1, true)

    useEffect(() => { loadPosts(0) }, [statusFilter, projectId])

    useEffect(() => {
        if (!projectId) return
        getConnectionStatus(projectId).then(s => setIgConnected(s.connected)).catch(() => setIgConnected(false))
    }, [projectId])

    const handleStatusChange = async (postId: string, newStatus: string) => {
        await updateIGPostStatus(postId, newStatus)
        if (newStatus === "posted") trackEvent('post_published')
        setSelectedPost(null)
        loadPosts(0)
    }

    // Mark posted from the handoff modal (after the user shares to the IG app).
    const handleHandoffMarkPosted = async (postId: string) => {
        await updateIGPostStatus(postId, "posted")
        trackEvent('post_published')
        setHandoffPost(null)
        loadPosts(0)
    }

    const handleDelete = async (postId: string) => {
        await deleteIGPost(postId, projectId)
        setSelectedPost(null)
        loadPosts(0)
    }

    if (loading) return <LoadingSpinner />
    if (error) return (
        <div className="text-center py-12">
            <p className="text-aisummit-cinnabar mb-4 font-bold uppercase tracking-widest text-sm">❌ {error}</p>
            <button onClick={() => loadPosts(0)} className="px-5 py-2.5 bg-[#0f0f0f] shadow-sm border border-white/10 text-white rounded-sm text-xs font-bold uppercase tracking-widest hover:bg-white/10 transition-colors">
                🔄 Zkusit znovu
            </button>
        </div>
    )

    return (
        <div className="space-y-6 pt-2">
            {/* Filters */}
            <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-hide">
                {["all", "draft", "ready", "scheduled", "posted", "failed", "plan_locked"].map(status => (
                    <button
                        key={status}
                        onClick={() => setStatusFilter(status)}
                        className={`px-5 py-2 text-xs font-bold uppercase tracking-wider rounded-sm transition-all shadow-sm whitespace-nowrap border ${statusFilter === status
                            ? "bg-white/10 text-white border-white/20 shadow-md"
                            : "text-white/50 bg-[#0f0f0f] border-white/10 hover:text-white hover:bg-white/5"
                            }`}
                    >
                        {status === "all" ? "Všechny" : status === "draft" ? "Koncepty" : status === "ready" ? "Připravené" : status === "scheduled" ? "Naplánované" : status === "posted" ? "Publikované" : status === "failed" ? "⚠ Selhalé" : "🔒 Plán"}
                    </button>
                ))}
                <span className="text-xs font-mono uppercase tracking-widest text-white/40 ml-auto whitespace-nowrap pl-4">{posts.length} z {total} příspěvků</span>
            </div>

            {/* Bulk actions bar */}
            {posts.length > 0 && (
                <div className="flex items-center justify-between gap-3 bg-[#0a0a0a] border border-white/5 rounded-sm px-4 py-3">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => {
                                if (selectedIds.size === posts.length) setSelectedIds(new Set())
                                else setSelectedIds(new Set(posts.map(p => p.id)))
                            }}
                            className="text-[9px] text-white/40 hover:text-white/70 font-bold uppercase tracking-widest transition-colors"
                        >
                            {selectedIds.size === posts.length && posts.length > 0 ? "Odznačit vše" : "Vybrat vše"}
                        </button>
                        {selectedIds.size > 0 && (
                            <span className="text-[9px] text-white/30">{selectedIds.size} vybráno</span>
                        )}
                    </div>
                    {selectedIds.size > 0 && (
                        <button
                            onClick={async () => {
                                if (!confirm(`Smazat ${selectedIds.size} příspěvků? Tato akce je nevratná.`)) return
                                setBulkDeleting(true)
                                await deleteIGPosts(Array.from(selectedIds), projectId)
                                setSelectedIds(new Set())
                                setBulkDeleting(false)
                                loadPosts(0)
                            }}
                            disabled={bulkDeleting}
                            className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all border border-red-500/20 disabled:opacity-50 whitespace-nowrap"
                        >
                            {bulkDeleting ? "Mažu…" : `🗑 Smazat ${selectedIds.size}`}
                        </button>
                    )}
                </div>
            )}

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
                        className={`bg-[#0a0a0a]/80 backdrop-blur-md rounded-sm border transition-all flex flex-col relative ${selectedIds.has(post.id) ? 'border-red-500/30 bg-red-500/5' : 'border-white/10 hover:border-white/30'}`}
                    >
                        {/* Checkbox */}
                        <label
                            className="absolute top-2 left-2 z-10 cursor-pointer"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <input
                                type="checkbox"
                                checked={selectedIds.has(post.id)}
                                onChange={(e) => {
                                    setSelectedIds(prev => {
                                        const next = new Set(prev)
                                        if (e.target.checked) next.add(post.id)
                                        else next.delete(post.id)
                                        return next
                                    })
                                }}
                                className="w-4 h-4 rounded-sm border-white/20 bg-black/60 accent-red-500 cursor-pointer"
                            />
                        </label>

                        {/* Locked post overlay */}
                        {post.status === "plan_locked" ? (
                            <LockedPostCard post={post} />
                        ) : (
                        <div
                            onClick={() => setSelectedPost(post)}
                            className="p-3 cursor-pointer group flex flex-col flex-1"
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
                                {post.image_url.includes("|") && (
                                    <span className="absolute top-2 right-2 bg-black/70 border border-white/20 text-white/80 text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-sm backdrop-blur-sm">
                                        📸 {post.image_url.split("|").length} slidů
                                    </span>
                                )}
                                {post.qa_status === "native_forced" && (
                                    <span
                                        title="Vizuální QA neprošla čistě ani po opravách — zkontroluj text a diakritiku v obrázku před publikací"
                                        className="absolute top-2 left-2 bg-red-950/80 border border-red-500/40 text-red-300 text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-sm backdrop-blur-sm"
                                    >
                                        ⚠ Zkontroluj text
                                    </span>
                                )}
                            </div>
                        ) : (
                            <div className="w-full h-56 rounded-sm bg-[#0f0f0f]/50 border border-white/5 flex flex-col items-center justify-center mb-4 gap-2">
                                <span className="text-2xl opacity-50">🖼️</span>
                                <span className="text-white/40 font-bold uppercase tracking-widest text-[10px]">Bez obrázku</span>
                            </div>
                        )}

                        <div className="flex-1 px-3 pb-3 flex flex-col">
                            <div className="flex items-start justify-between gap-2 mb-4">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{post.ig_post_types?.display_name || "Generický Post"}</span>
                                    {post.content_pillar && <PillarBadge pillar={post.content_pillar} />}
                                </div>
                                <span className="text-sm bg-white/5 shadow-sm border border-white/10 px-2 py-1 rounded-sm">{post.ig_post_types?.emoji || "📸"}</span>
                            </div>

                            <p className="text-sm text-white/70 line-clamp-2 leading-relaxed mb-4 font-medium">
                                {post.caption || "Bez textu"}
                            </p>

                            {/* Inline quick actions — always visible */}
                            <div className="flex items-center gap-1.5 mb-3" onClick={(e) => e.stopPropagation()}>
                                <InlineAction
                                    label="📋"
                                    title="Kopírovat text"
                                    onClick={() => {
                                        if (post.caption) {
                                            navigator.clipboard.writeText(post.caption + (post.hashtags ? "\n\n" + post.hashtags : ""))
                                        }
                                    }}
                                />
                                {post.image_url && (
                                    <InlineAction
                                        label="⬇️"
                                        title="Stáhnout obrázek"
                                        onClick={() => {
                                            const a = document.createElement("a")
                                            a.href = post.image_url!.split("|")[0]
                                            a.download = `post-${post.id.slice(0, 8)}.png`
                                            a.target = "_blank"
                                            a.click()
                                        }}
                                    />
                                )}
                                {post.image_url && (
                                    <InlineAction
                                        label="📲"
                                        title="Publikovat na Instagram"
                                        onClick={() => setHandoffPost(post)}
                                    />
                                )}
                                {(post.status === "draft" || post.status === "plan_draft") && (
                                    <InlineAction
                                        label="✅"
                                        title="Označit jako Připraveno"
                                        onClick={() => handleStatusChange(post.id, "ready")}
                                        accent="blue"
                                    />
                                )}
                                {post.status === "ready" && (
                                    <InlineAction
                                        label="📤"
                                        title="Označit jako Publikováno"
                                        onClick={() => handleStatusChange(post.id, "posted")}
                                        accent="emerald"
                                    />
                                )}
                            </div>

                            <div className="flex items-center justify-between mt-auto pt-3 border-t border-white/10">
                                <StatusBadge status={post.status} />
                                <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">
                                    {new Date(post.created_at).toLocaleDateString("cs-CZ")}
                                </span>
                            </div>
                        </div>
                        </div>
                        )}
                    </motion.div>
                ))}
            </motion.div>

            {/* Load More */}
            {hasMore && (
                <div className="flex justify-center pt-4">
                    <button
                        onClick={loadMore}
                        disabled={loadingMore}
                        className="px-8 py-3 bg-[#0f0f0f] border border-white/10 text-white/70 rounded-sm text-xs font-bold uppercase tracking-widest hover:bg-white/5 hover:text-white hover:border-white/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {loadingMore ? "Načítám..." : `Načíst další (${total - posts.length} zbývá)`}
                    </button>
                </div>
            )}

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
                        onRefresh={() => { setSelectedPost(null); loadPosts(0) }}
                        onPublish={(p) => { setSelectedPost(null); setHandoffPost(p) }}
                    />
                )}

            {/* Publish Handoff Modal — post to Instagram (Publikovat hned / manual share) */}
            {handoffPost && (
                <PublishHandoffModal
                    post={handoffPost}
                    connected={igConnected}
                    onClose={() => { setHandoffPost(null); loadPosts(0) }}
                    onMarkedPosted={handleHandoffMarkPosted}
                />
            )}
        </div >
    )
}

// ═══════════════════════════════════════════════════════════
// POST DETAIL MODAL — full view + copy/download
// ═══════════════════════════════════════════════════════════

// Small icon button for card-level quick actions
function LockedPostCard({ post }: { post: IGPost }) {
    const { showPlanUnlockModal } = usePaywall()
    return (
        <div
            onClick={() => showPlanUnlockModal()}
            className="p-3 cursor-pointer flex flex-col flex-1"
        >
            {/* Blurred image placeholder */}
            <div className="w-full h-56 rounded-sm bg-[#0f0f0f]/50 border border-white/5 flex flex-col items-center justify-center mb-4 gap-2 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-white/[0.01]" />
                <span className="text-3xl opacity-30">🔒</span>
                <span className="text-white/30 font-bold uppercase tracking-widest text-[9px]">Zamčený obsah</span>
            </div>

            <div className="flex-1 px-3 pb-3 flex flex-col">
                <div className="flex items-start justify-between gap-2 mb-4">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{post.ig_post_types?.display_name || "Příspěvek"}</span>
                        {post.content_pillar && <PillarBadge pillar={post.content_pillar} />}
                    </div>
                    <span className="text-sm bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-sm">🔒</span>
                </div>

                {/* Blurred caption snippet */}
                <p className="text-sm text-white/30 line-clamp-2 leading-relaxed mb-4 font-medium select-none" style={{ filter: "blur(3px)" }}>
                    {post.caption?.slice(0, 80) || "Obsah příspěvku je zamčený..."}
                </p>

                <div className="mt-auto pt-3 border-t border-white/10">
                    <button className="w-full py-2 bg-gradient-to-r from-aisummit-cinnabar/20 to-orange-600/20 border border-aisummit-cinnabar/20 rounded-sm text-[9px] font-black uppercase tracking-widest text-aisummit-cinnabar hover:from-aisummit-cinnabar/30 hover:to-orange-600/30 transition-all">
                        🔓 Odemknout za 490 Kč
                    </button>
                </div>
            </div>
        </div>
    )
}

function InlineAction({ label, title, onClick, accent }: { label: string; title: string; onClick: () => void; accent?: "blue" | "emerald" }) {
    const accentClass = accent === "blue"
        ? "hover:bg-blue-500/20 hover:border-blue-500/30"
        : accent === "emerald"
        ? "hover:bg-emerald-500/20 hover:border-emerald-500/30"
        : "hover:bg-white/10 hover:border-white/20"
    return (
        <button
            onClick={onClick}
            title={title}
            className={`w-8 h-8 flex items-center justify-center rounded-sm border border-white/10 bg-white/5 text-sm transition-all ${accentClass}`}
        >
            {label}
        </button>
    )
}

function PostDetailModal({
    post,
    projectId,
    onClose,
    onStatusChange,
    onDelete,
    onRefresh,
    onPublish,
}: {
    post: IGPost
    projectId: string
    onClose: () => void
    onStatusChange: (postId: string, status: string) => void
    onDelete: (postId: string) => void
    onRefresh: () => void
    onPublish: (post: IGPost) => void
}) {
    const { copiedField, copyToClipboard } = useCopyToClipboard()
    const [confirmDelete, setConfirmDelete] = useState(false)
    const [feedbackText, setFeedbackText] = useState("")
    const [revising, setRevising] = useState(false)
    const [revisionResult, setRevisionResult] = useState<{ success: boolean; newPostId?: string; error?: string } | null>(null)
    const [generatingVariants, setGeneratingVariants] = useState(false)
    const [variantIds, setVariantIds] = useState<string[]>([])
    const [showVariantComparison, setShowVariantComparison] = useState(false)
    const [variantError, setVariantError] = useState<string | null>(null)
    const [carouselIndex, setCarouselIndex] = useState(0)
    const [editorialLog, setEditorialLog] = useState<{ role: string; action: string; summary: string }[]>([])
    const [editorialOpen, setEditorialOpen] = useState(false)
    const [retrying, setRetrying] = useState(false)

    const handleRetryPublish = async () => {
        setRetrying(true)
        const result = await retryPublishAction(projectId, post.id)
        setRetrying(false)
        if (result.success) onRefresh()
        else alert(result.error || "Akce selhala")
    }

    // Fetch editorial log on mount
    useEffect(() => {
        getEditorialLog(post.id).then(setEditorialLog)
    }, [post.id])

    const imageUrls = post.image_url ? post.image_url.split("|").filter(Boolean) : []
    const isCarousel = imageUrls.length > 1

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
        if (imageUrls.length === 0) return
        const url = imageUrls[carouselIndex] || imageUrls[0]
        try {
            const response = await fetch(url)
            const blob = await response.blob()
            const blobUrl = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = blobUrl
            a.download = isCarousel
                ? `ig-post-${post.id.substring(0, 8)}-slide${carouselIndex + 1}.png`
                : `ig-post-${post.id.substring(0, 8)}.png`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(blobUrl)
        } catch {
            window.open(url, "_blank")
        }
    }, [post, carouselIndex, imageUrls, isCarousel])

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
                        <div className="lg:w-1/2 bg-[#0f0f0f] border-r border-white/10 flex flex-col items-center justify-center p-4 relative">
                            {imageUrls.length > 0 ? (
                                <>
                                    <img
                                        src={imageUrls[carouselIndex] || imageUrls[0]}
                                        alt={isCarousel ? `Slide ${carouselIndex + 1}` : ""}
                                        className="max-w-full max-h-[300px] sm:max-h-[500px] rounded-sm object-contain border border-white/10 shadow-lg"
                                    />
                                    {isCarousel && (
                                        <>
                                            {/* Prev/Next Arrows */}
                                            {carouselIndex > 0 && (
                                                <button
                                                    onClick={() => setCarouselIndex(i => i - 1)}
                                                    className="absolute left-6 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center bg-black/70 border border-white/20 rounded-full text-white/80 hover:bg-white/10 hover:text-white transition-all text-sm"
                                                >
                                                    ←
                                                </button>
                                            )}
                                            {carouselIndex < imageUrls.length - 1 && (
                                                <button
                                                    onClick={() => setCarouselIndex(i => i + 1)}
                                                    className="absolute right-6 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center bg-black/70 border border-white/20 rounded-full text-white/80 hover:bg-white/10 hover:text-white transition-all text-sm"
                                                >
                                                    →
                                                </button>
                                            )}
                                            {/* Dots + Counter */}
                                            <div className="flex items-center gap-2 mt-3">
                                                {imageUrls.map((_, i) => (
                                                    <button
                                                        key={i}
                                                        onClick={() => setCarouselIndex(i)}
                                                        className={`w-2 h-2 rounded-full transition-all ${i === carouselIndex ? "bg-white scale-125" : "bg-white/30 hover:bg-white/50"}`}
                                                    />
                                                ))}
                                                <span className="text-[10px] font-mono text-white/40 ml-2">
                                                    {carouselIndex + 1}/{imageUrls.length}
                                                </span>
                                            </div>
                                        </>
                                    )}
                                </>
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

                            {/* Editorial Board Log */}
                            {editorialLog.length > 0 && (
                                <div>
                                    <button
                                        onClick={() => setEditorialOpen(!editorialOpen)}
                                        className="flex items-center justify-between w-full mb-2 group"
                                    >
                                        <span className="text-[10px] font-bold text-white/50 uppercase tracking-widest">🧠 Editorial Board ({editorialLog.length})</span>
                                        <span className="text-[10px] text-white/30 group-hover:text-white/50 transition-colors">{editorialOpen ? '▲' : '▼'}</span>
                                    </button>
                                    {editorialOpen && (
                                        <div className="bg-[#0f0f0f] border border-white/5 rounded-sm p-3 space-y-2 max-h-48 overflow-y-auto shadow-inner">
                                            {editorialLog.map((msg, i) => {
                                                const roleColors: Record<string, string> = {
                                                    strategist: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
                                                    copywriter: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
                                                    critic: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
                                                    chief_editor: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
                                                }
                                                const color = roleColors[msg.role] || 'text-white/40 bg-white/5 border-white/10'
                                                return (
                                                    <div key={i} className="flex items-start gap-2">
                                                        <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-sm border flex-shrink-0 ${color}`}>
                                                            {msg.role?.replace('_', ' ')}
                                                        </span>
                                                        <span className="text-[10px] text-white/50 leading-snug flex-1">
                                                            {msg.summary || msg.action}
                                                        </span>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
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

                {/* Publish failure reason */}
                {post.status === "failed" && post.publish_error && (
                    <div className="px-4 sm:px-6 pb-2">
                        <p className="text-[10px] text-red-400 leading-relaxed">
                            ⚠ Publikování selhalo: {post.publish_error}
                        </p>
                    </div>
                )}

                {/* Footer Actions */}
                <div className="px-4 sm:px-6 py-3 sm:py-4 bg-[#050505] border-t border-white/10 flex flex-wrap items-center gap-2 sm:gap-3">
                    {/* Download Image */}
                    {imageUrls.length > 0 && (
                        <button
                            onClick={downloadImage}
                            className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-[#0f0f0f] text-white/70 hover:bg-white/10 hover:text-white transition-all flex items-center gap-2 border border-white/10"
                        >
                            ⬇️ {isCarousel ? `Stáhnout slide ${carouselIndex + 1}` : "Stáhnout obrázek"}
                        </button>
                    )}

                    {/* Copy Full */}
                    <button
                        onClick={() => copyToClipboard(fullText, "full-btn")}
                        className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-[#0f0f0f] text-white/70 hover:bg-white/10 hover:text-white transition-all flex items-center gap-2 border border-white/10"
                    >
                        {copiedField === "full-btn" ? "✅ Zkopírováno!" : "📋 Kopírovat text"}
                    </button>

                    {/* Publish to Instagram (mobile handoff) */}
                    {imageUrls.length > 0 && (
                        <button
                            onClick={() => onPublish(post)}
                            className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-gradient-to-r from-aisummit-cinnabar/20 to-orange-600/20 text-aisummit-cinnabar hover:from-aisummit-cinnabar/30 hover:to-orange-600/30 transition-all flex items-center gap-2 border border-aisummit-cinnabar/30"
                        >
                            📲 Publikovat na Instagram
                        </button>
                    )}

                    {/* Spacer */}
                    <div className="flex-1" />

                    {/* Status Actions */}
                    {(post.status === "draft" || post.status === "plan_draft") && (
                        <>
                            <button
                                onClick={() => onStatusChange(post.id, "ready")}
                                className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all border border-blue-500/20"
                            >
                                → Označit jako Připraveno
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
                                ← Zpět na Koncept
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
                        <>
                            {post.permalink && (
                                <a
                                    href={post.permalink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-all border border-emerald-500/20"
                                >
                                    ↗ Zobrazit na Instagramu
                                </a>
                            )}
                            <button
                                onClick={() => onStatusChange(post.id, "archived")}
                                className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-white/5 text-white/40 hover:bg-white/10 transition-all border border-white/10"
                            >
                                📦 Archivovat
                            </button>
                        </>
                    )}
                    {post.status === "failed" && (
                        <button
                            onClick={handleRetryPublish}
                            disabled={retrying}
                            className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all border border-red-500/20 disabled:opacity-50"
                        >
                            {retrying ? "Plánuji…" : "↻ Zkusit publikovat znovu"}
                        </button>
                    )}

                    {/* A/B Variant System */}
                    <button
                        onClick={async () => {
                            setGeneratingVariants(true)
                            setVariantError(null)
                            setVariantIds([])
                            const result = await generateMultipleVariants(post.id, projectId, 2)
                            if (result.success && result.variantIds.length > 0) {
                                setVariantIds(result.variantIds)
                                setShowVariantComparison(true)
                            } else {
                                setVariantError(result.error || "Generování selhalo")
                            }
                            setGeneratingVariants(false)
                        }}
                        disabled={generatingVariants}
                        className={`px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm transition-all border ${
                            generatingVariants
                                ? "bg-violet-500/10 text-violet-300 border-violet-500/20 animate-pulse cursor-not-allowed"
                                : variantIds.length > 0
                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 cursor-pointer"
                                    : "bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 border-violet-500/20"
                        }`}
                    >
                        {generatingVariants ? "⏳ Generuji 2 varianty (~60s)..." : variantIds.length > 0 ? "🔀 Zobrazit varianty" : "🔀 A/B Test"}
                    </button>
                    {variantIds.length > 0 && !generatingVariants && (
                        <button
                            onClick={() => setShowVariantComparison(true)}
                            className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 border border-violet-500/20 transition-all"
                        >
                            📊 Srovnat
                        </button>
                    )}
                    {variantError && (
                        <span className="text-[9px] text-red-400">{variantError.substring(0, 60)}</span>
                    )}

                    {/* Variant Comparison Modal */}
                    {showVariantComparison && (
                        <VariantComparisonModal
                            originalPostId={post.id}
                            projectId={projectId}
                            onClose={() => setShowVariantComparison(false)}
                            onWinnerSelected={() => {
                                setShowVariantComparison(false)
                                onClose()
                            }}
                        />
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

// ═══════════════════════════════════════════════════════════
// VARIANT COMPARISON MODAL — A/B side-by-side
// ═══════════════════════════════════════════════════════════

function VariantComparisonModal({
    originalPostId,
    projectId,
    onClose,
    onWinnerSelected,
}: {
    originalPostId: string
    projectId: string
    onClose: () => void
    onWinnerSelected: () => void
}) {
    const [variants, setVariants] = useState<any[]>([])
    const [originalId, setOriginalId] = useState(originalPostId)
    const [loading, setLoading] = useState(true)
    const [selecting, setSelecting] = useState<string | null>(null)
    const [done, setDone] = useState(false)

    useEffect(() => {
        (async () => {
            const result = await getVariantGroup(originalPostId, projectId)
            setVariants(result.posts)
            setOriginalId(result.originalId)
            setLoading(false)
        })()
    }, [originalPostId, projectId])

    const handleSelectWinner = async (winnerId: string) => {
        setSelecting(winnerId)
        const loserIds = variants.filter(v => v.id !== winnerId).map(v => v.id)
        await selectVariantWinner(winnerId, loserIds, projectId)
        setDone(true)
        setTimeout(() => onWinnerSelected(), 1500)
    }

    useEffect(() => {
        const mainEl = document.querySelector("main")
        const orig = document.body.style.overflow
        const origMain = mainEl?.style.overflow || ""
        document.body.style.overflow = "hidden"
        if (mainEl) mainEl.style.overflow = "hidden"
        return () => {
            document.body.style.overflow = orig
            if (mainEl) mainEl.style.overflow = origMain
        }
    }, [])

    return createPortal(
        <div
            className="fixed inset-0 z-[10000] flex items-center justify-center p-3 sm:p-4"
            style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0 }}
            onClick={onClose}
        >
            <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />

            <div
                className="relative w-full max-w-6xl max-h-[90vh] bg-[#0a0a0a] border border-white/10 rounded-sm overflow-hidden flex flex-col shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                    <div className="flex items-center gap-3">
                        <span className="text-lg">🔀</span>
                        <div>
                            <h3 className="text-white font-black uppercase tracking-tighter">A/B Srovnání variant</h3>
                            <p className="text-[10px] text-white/40 font-mono tracking-widest uppercase">
                                {done ? "✅ Vítěz vybrán — systém se učí z tvé preference" : "Vyber nejlepší variantu"}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 rounded-sm transition-colors border border-transparent hover:border-white/10"
                    >
                        ✕
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <div className="text-center">
                                <div className="animate-spin w-8 h-8 border-2 border-violet-500/30 border-t-violet-500 rounded-full mx-auto mb-4" />
                                <p className="text-xs text-white/40 font-bold uppercase tracking-widest">Načítám varianty...</p>
                            </div>
                        </div>
                    ) : (
                        <div className={`grid gap-4 ${variants.length === 2 ? 'grid-cols-1 sm:grid-cols-2' : variants.length >= 3 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1'}`}>
                            {variants.map((variant, index) => {
                                const isOriginal = variant.id === originalId
                                const isWinner = selecting === variant.id && done
                                const isLoser = selecting && selecting !== variant.id && done
                                const hook = (variant.caption || "").split("\n")[0] || "—"
                                const body = (variant.caption || "").split("\n").slice(1).join("\n").substring(0, 200)
                                const firstImage = variant.image_url?.split("|")[0]

                                return (
                                    <motion.div
                                        key={variant.id}
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{
                                            opacity: isLoser ? 0.3 : 1,
                                            y: 0,
                                            scale: isWinner ? 1.02 : isLoser ? 0.98 : 1,
                                        }}
                                        transition={{ duration: 0.4, delay: index * 0.1 }}
                                        className={`bg-[#0f0f0f] border rounded-sm overflow-hidden flex flex-col transition-all ${
                                            isWinner ? 'border-emerald-500/50 ring-1 ring-emerald-500/20' :
                                            isLoser ? 'border-white/5 grayscale' :
                                            'border-white/10 hover:border-white/20'
                                        }`}
                                    >
                                        {/* Label */}
                                        <div className="px-4 py-2 border-b border-white/5 flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-sm border ${
                                                    isOriginal
                                                        ? 'text-blue-400 bg-blue-500/10 border-blue-500/20'
                                                        : 'text-violet-400 bg-violet-500/10 border-violet-500/20'
                                                }`}>
                                                    {isOriginal ? "Originál" : `Varianta ${index}`}
                                                </span>
                                                {isWinner && (
                                                    <span className="text-[9px] font-black uppercase tracking-widest text-emerald-400 animate-pulse">🏆 Vítěz</span>
                                                )}
                                            </div>
                                            <span className="text-[9px] text-white/30 font-mono">{variant.ig_post_types?.emoji || "📸"}</span>
                                        </div>

                                        {/* Image */}
                                        {firstImage ? (
                                            <div className="w-full aspect-[4/5] bg-black overflow-hidden">
                                                <img src={firstImage} alt="" className="w-full h-full object-cover" />
                                            </div>
                                        ) : (
                                            <div className="w-full aspect-[4/5] bg-[#050505] flex items-center justify-center">
                                                <span className="text-white/20 text-3xl">🖼️</span>
                                            </div>
                                        )}

                                        {/* Caption preview */}
                                        <div className="p-4 flex-1 flex flex-col">
                                            <p className="text-sm text-white font-bold leading-snug mb-2 line-clamp-2">{hook}</p>
                                            <p className="text-xs text-white/40 leading-relaxed line-clamp-3 flex-1">{body || "—"}</p>

                                            {!done && (
                                                <button
                                                    onClick={() => handleSelectWinner(variant.id)}
                                                    disabled={!!selecting}
                                                    className={`mt-4 w-full py-3 text-[10px] font-black uppercase tracking-widest rounded-sm transition-all border ${
                                                        selecting === variant.id
                                                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30 animate-pulse'
                                                            : 'bg-white/5 text-white/60 border-white/10 hover:bg-emerald-500/10 hover:text-emerald-400 hover:border-emerald-500/20'
                                                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                                                >
                                                    {selecting === variant.id ? "⏳ Vybírám..." : "✓ Vybrat jako vítěze"}
                                                </button>
                                            )}
                                        </div>
                                    </motion.div>
                                )
                            })}
                        </div>
                    )}
                </div>

                {done && (
                    <div className="px-6 py-3 border-t border-emerald-500/20 bg-emerald-500/5 flex items-center justify-center gap-2">
                        <span className="text-xs text-emerald-400 font-bold uppercase tracking-widest">
                            🧠 Preference uložena — AI se učí z tvého výběru
                        </span>
                    </div>
                )}
            </div>
        </div>,
        document.body
    )
}
