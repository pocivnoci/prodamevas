"use client"

import { useEffect, useState, useCallback } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import {
    getIGPostsList,
    getIGIdeasList,
    getIGReviewsList,
    getIGGenerationLogs,
    getIGPostTypes,
    getIGPostFormats,
    getIGCategories,
    updateIGPostStatus,
    updateIGReviewApproval,
    updateIGPostMetrics,
    getAvailableIGClients,
} from "@/app/actions/admin-actions"
import {
    triggerPostGeneration,
    triggerBatchGeneration,
    addNewIdea,
    addNewReview,
    triggerProductIdeas,
    triggerDesignGeneration,
    triggerMockupGeneration,
    triggerProductDesign,
    triggerAIIdeasGeneration,
    triggerAIReviewsGeneration,
    saveProductIdea,
    rejectProductIdea,
    createPromoPost,
    type GenerateResult,
    type ProductIdea,
    type DesignConcept,
} from "@/app/actions/ig-generate-action"
import {
    uploadBrandImage,
    deleteBrandImage,
    getBrandImages,
} from "@/app/actions/brand-images-action"

// Extra import for downloading ideas
import supabase from "@/supabase/client"

type Tab = "posts" | "generate" | "ideas" | "reviews" | "logs" | "products" | "brand"
type ClientInfo = { id: string; name: string; icon: string; description: string }

export default function InstagramPage() {
    const [activeTab, setActiveTab] = useState<Tab>("posts")
    const [projectId, setProjectId] = useState("") // Dynamic now
    const [clients, setClients] = useState<ClientInfo[]>([])

    // Load available clients from config registry
    useEffect(() => {
        getAvailableIGClients().then(data => {
            setClients(data)
            if (data.length > 0 && !projectId) {
                setProjectId(data[0].id)
            }
        })
    }, [])

    const currentProject = clients.find(p => p.id === projectId) || { id: projectId, name: projectId || "Načítám...", icon: "📦", description: "" }

    const tabs: { id: Tab; label: string; icon: string }[] = [
        { id: "posts", label: "Příspěvky", icon: "📸" },
        { id: "generate", label: "Generovat", icon: "🚀" },
        { id: "ideas", label: "Nápady", icon: "💡" },
        { id: "reviews", label: "Recenze", icon: "⭐" },
        { id: "products", label: "Produkty", icon: "🛍️" },
        { id: "brand", label: "Fotky", icon: "🎨" },
        { id: "logs", label: "Logy", icon: "📊" },
    ]

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="text-4xl font-black uppercase tracking-tighter text-white">Studio</h1>
                    <p className="text-white/50 mt-2 font-bold uppercase tracking-widest text-[10px]">Kreativní prostor pro generování a správu obsahu</p>
                </div>

                {/* Project Selector */}
                <div className="relative">
                    <select
                        value={projectId}
                        onChange={(e) => setProjectId(e.target.value)}
                        className="appearance-none bg-[#0a0a0a]/90 backdrop-blur-xl border border-white/10 text-white rounded-sm px-5 py-3 pr-12 text-sm font-bold uppercase tracking-wider cursor-pointer shadow-sm hover:border-white/30 transition-colors focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30"
                    >
                        {clients.map(p => (
                            <option key={p.id} value={p.id}>
                                {p.icon} {p.name}
                            </option>
                        ))}
                    </select>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-white/40">
                        ▾
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 pb-2 overflow-x-auto scrollbar-hide">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center gap-2 px-5 py-2.5 text-xs font-bold uppercase tracking-wider transition-all rounded-sm whitespace-nowrap shadow-sm ${activeTab === tab.id
                            ? "bg-white/10 text-white shadow-md border border-white/20"
                            : "bg-[#0f0f0f] text-white/50 border border-white/10 hover:text-white hover:bg-white/5"
                            }`}
                    >
                        <span>{tab.icon}</span>
                        <span>{tab.label}</span>
                    </button>
                ))}
            </div>

            <div className="relative mt-4">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={activeTab}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.3, ease: "easeOut" }}
                    >
                        {activeTab === "posts" && <PostsTab projectId={projectId} />}
                        {activeTab === "generate" && <GenerateTab projectId={projectId} />}
                        {activeTab === "ideas" && <IdeasTab projectId={projectId} />}
                        {activeTab === "reviews" && <ReviewsTab projectId={projectId} />}
                        {activeTab === "products" && <ProductsTab projectId={projectId} />}
                        {activeTab === "brand" && <BrandTab projectId={projectId} />}
                        {activeTab === "logs" && <LogsTab projectId={projectId} />}
                    </motion.div>
                </AnimatePresence>
            </div>
        </div>
    )
}

// ═══════════════════════════════════════════════════════════
// POSTS TAB  (with detail modal + copy/download)
// ═══════════════════════════════════════════════════════════

function PostsTab({ projectId }: { projectId: string }) {
    const [posts, setPosts] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [statusFilter, setStatusFilter] = useState("all")
    const [selectedPost, setSelectedPost] = useState<any | null>(null)

    const loadPosts = async () => {
        if (!projectId) return
        setLoading(true)
        setError(null)
        try {
            const data = await getIGPostsList(statusFilter, projectId)
            setPosts(data)
        } catch (err: any) {
            console.error("loadPosts error:", err)
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
            {
                selectedPost && (
                    <PostDetailModal
                        post={selectedPost}
                        onClose={() => setSelectedPost(null)}
                        onStatusChange={handleStatusChange}
                    />
                )
            }
        </div >
    )
}

// ═══════════════════════════════════════════════════════════
// POST DETAIL MODAL — full view + copy/download
// ═══════════════════════════════════════════════════════════

function PostDetailModal({
    post,
    onClose,
    onStatusChange,
}: {
    post: any
    onClose: () => void
    onStatusChange: (postId: string, status: string) => void
}) {
    const [copiedField, setCopiedField] = useState<string | null>(null)

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

    const copyToClipboard = useCallback(async (text: string, field: string) => {
        await navigator.clipboard.writeText(text)
        setCopiedField(field)
        setTimeout(() => setCopiedField(null), 2000)
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
                                            onClick={() => copyToClipboard(post.image_prompt, "prompt")}
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
                </div>
            </div>
        </div>,
        document.body
    )
}

// ═══════════════════════════════════════════════════════════
// GENERATE TAB — enhanced with more options
// ═══════════════════════════════════════════════════════════

function GenerateTab({ projectId }: { projectId: string }) {
    const [postTypes, setPostTypes] = useState<any[]>([])
    const [postFormats, setPostFormats] = useState<Record<string, { aspectRatio: string; medium: string; overlayStyle: string }>>({})
    const [categories, setCategories] = useState<{ id: string; emoji: string; label: string }[]>([])
    const [selectedType, setSelectedType] = useState("")
    const [topic, setTopic] = useState("")
    const [category, setCategory] = useState("")
    const [dryRun, setDryRun] = useState(false)
    const [generating, setGenerating] = useState(false)
    const [result, setResult] = useState<GenerateResult | null>(null)
    const [batchCount, setBatchCount] = useState(3)
    const [batchMode, setBatchMode] = useState(false)
    const [batchResult, setBatchResult] = useState<{ generated: number; errors: number; message: string } | null>(null)
    const [generationHistory, setGenerationHistory] = useState<GenerateResult[]>([])
    const [step, setStep] = useState(1)

    // Reload post types + formats + categories when project changes
    useEffect(() => {
        if (!projectId) return
        getIGPostTypes(projectId).then(setPostTypes)
        getIGPostFormats(projectId).then(setPostFormats)
        getIGCategories(projectId).then(setCategories)
        setSelectedType("") // reset selection on project change
        setCategory("") // reset category on project change
        setStep(1)
    }, [projectId])

    const handleGenerate = async () => {
        setGenerating(true)
        setResult(null)
        setBatchResult(null)

        const maxClientRetries = 1

        try {
            if (batchMode) {
                let res = await triggerBatchGeneration({
                    configName: projectId,
                    count: batchCount,
                    dryRun,
                    topic: topic || undefined,
                    category: category !== "auto" ? category : undefined,
                })
                // Auto-retry once on failure
                if (!res.success && maxClientRetries > 0) {
                    console.log("⏳ Batch failed, auto-retrying...")
                    await new Promise(r => setTimeout(r, 3000))
                    res = await triggerBatchGeneration({
                        configName: projectId,
                        count: batchCount,
                        dryRun,
                        topic: topic || undefined,
                        category: category !== "auto" ? category : undefined,
                    })
                }
                setBatchResult(res)
            } else {
                let res = await triggerPostGeneration({
                    configName: projectId,
                    type: selectedType || undefined,
                    topic: topic || undefined,
                    category: category !== "auto" ? category : undefined,
                    dryRun,
                })
                // Auto-retry once on failure
                if (!res.success && maxClientRetries > 0) {
                    console.log("⏳ Generation failed, auto-retrying...")
                    await new Promise(r => setTimeout(r, 3000))
                    res = await triggerPostGeneration({
                        configName: projectId,
                        type: selectedType || undefined,
                        topic: topic || undefined,
                        category: category !== "auto" ? category : undefined,
                        dryRun,
                    })
                }
                setResult(res)
                if (res.success) {
                    setGenerationHistory(prev => [res, ...prev].slice(0, 10))
                }
            }
        } catch (err: any) {
            // Catch-all: if the server action itself throws (e.g. serialization error)
            const errorMsg = err?.message || "Neznámá chyba při generování"
            if (batchMode) {
                setBatchResult({
                    generated: 0,
                    errors: batchCount,
                    message: errorMsg,
                })
            } else {
                setResult({
                    success: false,
                    error: errorMsg,
                })
            }
        }

        // Move to result step automatically if we were on step 2
        setStep(3)
        setGenerating(false)
    }

    const [copiedField, setCopiedField] = useState<string | null>(null)
    const copyToClipboard = async (text: string, field: string) => {
        await navigator.clipboard.writeText(text)
        setCopiedField(field)
        setTimeout(() => setCopiedField(null), 2000)
    }

    return (
        <div className="max-w-4xl mx-auto space-y-8 mt-2 pb-24">
            {/* Progress Pill */}
            <div className="flex justify-center">
                <div className="inline-flex items-center bg-[#0a0a0a] shadow-sm border border-white/10 rounded-sm p-1.5 relative overflow-hidden">
                    {/* Animated gradient accent behind active step */}
                    <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-transparent via-aisummit-cinnabar to-transparent opacity-50 blur-[2px]"></div>

                    {[1, 2, 3].map(s => (
                        <button
                            key={s}
                            onClick={() => {
                                if (generating) return
                                // Prevent skipping directly to result if not generated yet
                                if (s === 3 && !result && !batchResult && !generating) return
                                setStep(s)
                            }}
                            disabled={generating && s !== step}
                            className={`px-6 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm transition-all duration-300 relative z-10 ${step === s
                                ? "bg-white/10 text-white shadow-md border border-white/20"
                                : "text-white/40 hover:text-white hover:bg-white/5"
                                } ${s === 3 && !result && !batchResult && !generating ? "opacity-30 cursor-not-allowed" : ""}`}
                        >
                            {s === 1 ? "1. Styl & Vibe" : s === 2 ? "2. Kreativní Brief" : "3. Prezentace"}
                        </button>
                    ))}
                </div>
            </div>

            <AnimatePresence mode="wait">
                {step === 1 && (
                    <motion.div
                        key="step1"
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -15 }}
                        className="bg-[#0f0f0f] rounded-sm p-8 sm:p-12 border border-white/10 flex flex-col items-center"
                    >
                        <div className="text-center mb-10">
                            <h2 className="text-4xl font-black tracking-tighter uppercase text-white/90 mb-3">Základní směr</h2>
                            <p className="text-[10px] text-white/40 font-bold tracking-widest uppercase">Jaký typ obsahu pro vás dnes AI architekt navrhne?</p>
                        </div>

                        {/* Mode Selector */}
                        <div className="flex bg-[#050505] p-1.5 rounded-sm border border-white/10 w-full max-w-sm mb-10 mx-auto">
                            <button
                                onClick={() => setBatchMode(false)}
                                className={`flex-1 py-3.5 text-[10px] font-bold uppercase tracking-widest rounded-sm transition-all ${!batchMode
                                    ? "bg-white/10 text-white border border-white/20 shadow-sm"
                                    : "text-white/50 hover:text-white"
                                    }`}
                            >
                                Exkluzivní post
                            </button>
                            <button
                                onClick={() => setBatchMode(true)}
                                className={`flex-1 py-3.5 text-[10px] font-bold uppercase tracking-widest rounded-sm transition-all ${batchMode
                                    ? "bg-aisummit-cinnabar/20 text-aisummit-cinnabar border border-aisummit-cinnabar/30 shadow-sm"
                                    : "text-white/50 hover:text-white"
                                    }`}
                            >
                                Content Plán
                            </button>
                        </div>

                        {/* Category Grid - Only for Single Post Mode */}
                        {!batchMode ? (
                            <div className="w-full">
                                <label className="text-[10px] text-white/40 mb-4 block uppercase tracking-widest text-center font-bold">Vyberte Základní Pilíř</label>
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                    <button
                                        onClick={() => setCategory("auto")}
                                        className={`p-4 rounded-sm border transition-all text-center flex flex-col items-center justify-center gap-3 ${category === "auto" || category === ""
                                            ? "border-white/30 bg-white/10 text-white shadow-sm scale-[1.02]"
                                            : "border-white/5 bg-[#0a0a0a] hover:border-white/20 text-white/50"
                                            }`}
                                    >
                                        <span className="text-3xl grayscale opacity-80">🤖</span>
                                        <span className="text-[10px] font-bold uppercase tracking-widest mt-1">Automaticky</span>
                                    </button>
                                    {categories.map(cat => (
                                        <button
                                            key={cat.id}
                                            onClick={() => setCategory(cat.id)}
                                            className={`p-4 rounded-sm border transition-all text-center flex flex-col items-center justify-center gap-3 ${category === cat.id
                                                ? "border-aisummit-cinnabar/50 bg-aisummit-cinnabar/10 text-aisummit-cinnabar shadow-[0_0_15px_rgba(229,83,63,0.1)] scale-[1.02]"
                                                : "border-white/5 bg-[#0a0a0a] hover:border-white/20 text-white/50"
                                                }`}
                                        >
                                            <span className="text-3xl">{cat.emoji}</span>
                                            <span className="text-[10px] font-bold uppercase tracking-widest mt-1">{cat.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="w-full text-center py-8 bg-[#0a0a0a] border border-white/5 rounded-sm">
                                <span className="text-4xl block mb-4">📅</span>
                                <h3 className="text-white/90 font-bold mb-2">Inteligentní Content Plán</h3>
                                <p className="text-white/50 text-sm max-w-md mx-auto">
                                    Vygeneruje celou sérii příspěvků na základě nastavené týdenní strategie (např. Poměr Edukace vs Prodej vs Humor). System zajistí dokonalý mix.
                                </p>
                            </div>
                        )}

                        <button
                            onClick={() => setStep(2)}
                            className="mt-12 group flex items-center gap-3 px-8 py-4 bg-[#050505] text-white rounded-sm font-bold uppercase tracking-widest border border-white/10 hover:border-white/30 transition-all hover:pr-6"
                        >
                            <span>Pokračovat k Detailům</span>
                            <span className="opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all">→</span>
                        </button>
                    </motion.div>
                )}

                {step === 2 && (
                    <motion.div
                        key="step2"
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -15 }}
                        className="bg-[#0f0f0f] rounded-sm p-8 sm:p-12 border border-white/10"
                    >
                        <div className="text-center mb-10">
                            <h2 className="text-4xl font-black uppercase tracking-tighter text-white/90 mb-3">Kreativní Brief</h2>
                            <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest">Upřesněte zadání pro dnešní {batchMode ? 'kampaň' : 'příspěvek'}.</p>
                        </div>

                        <div className="max-w-2xl mx-auto space-y-8">
                            {!batchMode && (
                                <div>
                                    <label className="text-[10px] text-white/50 mb-2 block uppercase tracking-widest font-bold">Specifický Formát (Kategorie: {category === "auto" || !category ? "Vše" : categories.find(c => c.id === category)?.label})</label>
                                    <select
                                        value={selectedType}
                                        onChange={(e) => setSelectedType(e.target.value)}
                                        className="w-full px-5 py-4 bg-[#050505] border border-white/10 rounded-sm text-white text-sm focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all shadow-sm"
                                    >
                                        <option value="">🎲 Překvapte mě (Náhodný výběr AI)</option>
                                        {postTypes
                                            .filter(pt => pt.is_active)
                                            .filter(pt => category === "auto" || category === "" || pt.pillarId === category)
                                            .map(pt => (
                                                <option key={pt.id} value={pt.name}>
                                                    {pt.emoji} {pt.display_name}
                                                </option>
                                            ))}
                                    </select>
                                </div>
                            )}

                            {batchMode && (
                                <div>
                                    <label className="text-[10px] text-white/50 mb-2 block uppercase tracking-widest font-bold">Objem kampaně</label>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                        {[
                                            { count: 3, label: "3 dny (Zkouška)" },
                                            { count: 7, label: "7 dní (Týden)" },
                                            { count: 14, label: "14 dní (Půl měsíce)" },
                                            { count: 30, label: "30 dní (Měsíc)" }
                                        ].map(opt => (
                                            <button
                                                key={opt.count}
                                                onClick={() => setBatchCount(opt.count)}
                                                className={`py-4 px-2 rounded-sm text-sm font-semibold transition-all border ${batchCount === opt.count
                                                    ? "bg-aisummit-cinnabar/20 border-aisummit-cinnabar/30 text-aisummit-cinnabar shadow-sm"
                                                    : "bg-[#050505] border-white/10 text-white/40 hover:text-white hover:border-white/30"
                                                    }`}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                    <p className="text-[10px] text-white/30 mt-2 text-right font-mono tracking-widest uppercase">
                                        Odhadovaná cena AI: ${(batchCount * 0.10).toFixed(2)}
                                    </p>
                                </div>
                            )}

                            <div>
                                <label className="text-[10px] text-white/50 mb-2 block uppercase tracking-widest font-bold">Hlavní téma / Myšlenka (Volitelné)</label>
                                <textarea
                                    placeholder="O čem by měl příspěvek komunikovat? Např. Jarní slevy, Nová kolekce šperků, nebo edukace ohledně péče o pleť..."
                                    value={topic}
                                    onChange={(e) => setTopic(e.target.value)}
                                    rows={3}
                                    className="w-full px-5 py-4 bg-[#050505] border border-white/10 rounded-sm text-white placeholder:text-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all shadow-sm resize-none"
                                />
                            </div>

                            <div className="pt-4 border-t border-white/10 flex items-center justify-between">
                                <label className="flex items-center gap-3 cursor-pointer group">
                                    <div className={`relative w-12 h-6 rounded-full transition-colors ${dryRun ? "bg-aisummit-cinnabar" : "bg-white/10 hover:bg-white/20"}`}
                                        onClick={() => setDryRun(!dryRun)}
                                    >
                                        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm ${dryRun ? "translate-x-7" : "translate-x-1"}`} />
                                    </div>
                                    <span className="text-[10px] uppercase tracking-widest font-bold text-white/70 group-hover:text-white transition-colors mt-1.5">Návrhový režim <span className="text-white/40 font-normal">(bez obrázků)</span></span>
                                </label>

                                <button
                                    onClick={handleGenerate}
                                    disabled={generating}
                                    className={`px-8 py-4 rounded-sm transition-all flex items-center gap-3 text-[10px] font-black tracking-widest uppercase ${generating
                                        ? "bg-white/5 text-white/30 cursor-wait border border-white/10"
                                        : "bg-aisummit-cinnabar text-white shadow-[0_0_15px_rgba(229,83,63,0.3)] hover:shadow-[0_0_20px_rgba(229,83,63,0.6)]"
                                        }`}
                                >
                                    {generating ? (
                                        <>
                                            <span className="w-4 h-4 border-2 border-white/30 border-t-transparent rounded-full animate-spin" />
                                            Navrhuji obsah...
                                        </>
                                    ) : (
                                        <>
                                            <span>✨ Vytvořit magii</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}

                {step === 3 && (
                    <motion.div
                        key="step3"
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -15 }}
                        className="bg-[#0f0f0f] rounded-sm p-8 sm:p-12 border border-white/10 relative overflow-hidden min-h-[500px] flex flex-col justify-center"
                    >
                        {generating ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0f0f0f] z-10">
                                <div className="absolute inset-0 opacity-20 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-aisummit-cinnabar via-[#0f0f0f] to-[#0f0f0f] pointer-events-none mix-blend-screen animate-pulse"></div>
                                <div className="w-16 h-16 border-[3px] border-white/10 border-t-aisummit-cinnabar rounded-full animate-spin mx-auto mb-8 shadow-sm relative z-10" />
                                <h3 className="text-2xl font-black uppercase tracking-tighter text-white mb-4 relative z-10">Kreativní proces probíhá...</h3>
                                <div className="h-6 overflow-hidden relative z-10">
                                    <motion.div
                                        animate={{ y: [0, -24, -48, -72, -96] }}
                                        transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
                                    >
                                        <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest h-6 flex items-center">Architekt analyzuje brand identitu...</p>
                                        <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest h-6 flex items-center">Copywriter skládá úderné texty...</p>
                                        <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest h-6 flex items-center">Generuji vizuální prompt pro AI...</p>
                                        <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest h-6 flex items-center">Vykreslování pixelů v Imagen 3...</p>
                                        <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest h-6 flex items-center">Finální leštění a optimalizace...</p>
                                    </motion.div>
                                </div>
                            </div>
                        ) : result ? (
                            <div className="w-full max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                                <div className="text-center mb-8">
                                    <span className={`inline-flex items-center justify-center w-16 h-16 rounded-sm text-3xl mb-4 shadow-sm border ${result.success ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-aisummit-cinnabar/10 text-aisummit-cinnabar border-aisummit-cinnabar/20"}`}>
                                        {result.success ? "✨" : "⚠️"}
                                    </span>
                                    <h2 className="text-3xl font-black uppercase tracking-tighter text-white mb-2">
                                        {result.success ? "Prezentace návrhu" : "Něco se pokazilo"}
                                    </h2>
                                    {result.error && <p className="text-aisummit-cinnabar font-bold uppercase tracking-widest text-[10px]">{result.error}</p>}
                                </div>

                                {/* Detailed Presentation View */}
                                {result.success && result.imageUrl && (
                                    <div className="bg-[#0a0a0a] rounded-sm p-4 sm:p-6 border border-white/10 shadow-lg">
                                        <div className="mb-6 rounded-sm overflow-hidden bg-[#0f0f0f] shadow-inner border border-white/5">
                                            {(() => {
                                                const urls = result.imageUrl?.split("|").filter(Boolean) || []
                                                if (urls.length > 1) {
                                                    return (
                                                        <div className="flex overflow-x-auto snap-x snap-mandatory hide-scrollbar">
                                                            {urls.map((u, i) => (
                                                                <img key={i} src={u} className="w-full h-auto max-h-[500px] object-contain snap-center shrink-0 border-r border-white/5 last:border-0" alt={`Slide ${i}`} />
                                                            ))}
                                                        </div>
                                                    )
                                                }
                                                return <img src={urls[0]} className="w-full h-auto max-h-[500px] object-contain" alt="Vygenerovaný obsah" />
                                            })()}
                                        </div>

                                        {result.caption && (
                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Finální Copy</span>
                                                    <button onClick={() => copyToClipboard(result.caption!, "final")} className="text-[10px] font-bold uppercase tracking-widest text-aisummit-cinnabar hover:text-white transition-colors">
                                                        {copiedField === "final" ? "✓ Zkopírováno" : "Kopírovat text"}
                                                    </button>
                                                </div>
                                                <p className="text-white/70 font-medium leading-relaxed whitespace-pre-wrap bg-[#0f0f0f] p-5 rounded-sm border border-white/5 shadow-sm">{result.caption}</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ) : batchResult ? (
                            <div className="w-full max-w-md mx-auto text-center space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
                                <span className="inline-flex items-center justify-center w-20 h-20 rounded-sm bg-emerald-500/10 text-emerald-400 text-4xl shadow-sm border border-emerald-500/20 mb-2">🚀</span>
                                <h2 className="text-4xl font-black uppercase tracking-tighter text-white">Kampaň spuštěna</h2>
                                <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest">{batchResult.message}</p>

                                <div className="grid grid-cols-2 gap-4 mt-8">
                                    <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-sm p-6 shadow-sm">
                                        <p className="text-5xl font-black text-emerald-500 mb-2">{batchResult.generated}</p>
                                        <p className="text-[10px] font-bold tracking-widest uppercase text-emerald-500/50">Úspěch</p>
                                    </div>
                                    <div className="bg-aisummit-cinnabar/5 border border-aisummit-cinnabar/10 rounded-sm p-6 shadow-sm">
                                        <p className="text-5xl font-black text-aisummit-cinnabar mb-2">{batchResult.errors}</p>
                                        <p className="text-[10px] font-bold tracking-widest uppercase text-aisummit-cinnabar/50">Selhání</p>
                                    </div>
                                </div>

                                <button onClick={() => setStep(1)} className="mt-8 px-8 py-3 rounded-sm bg-[#050505] text-white font-bold uppercase tracking-widest text-[10px] border border-white/10 hover:border-white/30 transition-colors">
                                    Vytvořit další
                                </button>
                            </div>
                        ) : (
                            <div className="text-center text-white/40">
                                <p className="text-5xl mb-4 opacity-30 grayscale">✨</p>
                                <p className="text-xl font-black uppercase tracking-tighter text-white/50 mb-2">Čekám na zadání</p>
                                <p className="font-bold uppercase tracking-widest text-[10px]">Vraťte se na krok Brief a spusťte generování.</p>
                                <button onClick={() => setStep(2)} className="mt-6 px-6 py-2 rounded-sm text-[10px] font-bold tracking-widest uppercase bg-white/5 text-white/50 border border-white/10 hover:text-white hover:bg-white/10 transition-colors">Zpět na Brief</button>
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}

// ═══════════════════════════════════════════════════════════
// IDEAS TAB
// ═══════════════════════════════════════════════════════════

function IdeasTab({ projectId }: { projectId: string }) {
    const [ideas, setIdeas] = useState<any[]>([])
    const [categories, setCategories] = useState<{ id: string; emoji: string; label: string }[]>([])
    const [loading, setLoading] = useState(true)
    const [showForm, setShowForm] = useState(false)
    const [newIdea, setNewIdea] = useState({ title: "", content: "", category: "tip", subcategory: "" })
    const [saving, setSaving] = useState(false)
    const [generatingAI, setGeneratingAI] = useState(false)

    const loadIdeas = async () => {
        if (!projectId) return
        setLoading(true)
        const data = await getIGIdeasList(projectId)
        setIdeas(data)
        setLoading(false)
    }

    useEffect(() => {
        if (!projectId) return
        loadIdeas()
        getIGCategories(projectId).then(setCategories)
    }, [projectId])

    const handleAddIdea = async () => {
        if (!newIdea.title || !newIdea.content) return
        setSaving(true)
        await addNewIdea({ ...newIdea, projectId })
        setNewIdea({ title: "", content: "", category: "tip", subcategory: "" })
        setShowForm(false)
        setSaving(false)
        loadIdeas()
    }

    const handleGenerateAIIdeas = async (pillarId: string) => {
        if (!pillarId) return
        setGeneratingAI(true)
        const res = await triggerAIIdeasGeneration({ configName: projectId, pillarId, count: 10 })
        if (res.success) {
            await loadIdeas()
        } else {
            alert("Chyba při generování nápadů: " + res.error)
        }
        setGeneratingAI(false)
    }

    if (loading) return <LoadingSpinner />

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <span className="text-[10px] text-white/40 tracking-widest uppercase font-bold">{ideas.length} nápadů</span>
                <div className="flex items-center gap-3">
                    {/* Select for AI Generation Category */}
                    <div className="relative group">
                        <select
                            onChange={(e) => {
                                if (e.target.value) {
                                    handleGenerateAIIdeas(e.target.value)
                                    e.target.value = "" // reset select
                                }
                            }}
                            disabled={generatingAI}
                            className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all shadow-[0_0_15px_rgba(16,185,129,0.1)] appearance-none cursor-pointer pr-8 ${generatingAI ? 'opacity-50 cursor-not-allowed' : 'hover:bg-emerald-500/20'}`}
                        >
                            <option value="">{generatingAI ? "✨ Generuji..." : "✨ AI Nápady (10x)"}</option>
                            {categories.map(cat => (
                                <option key={cat.id} value={cat.id}>{cat.emoji} {cat.label}</option>
                            ))}
                        </select>
                        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-emerald-500">
                            ▼
                        </div>
                    </div>

                    <button
                        onClick={() => setShowForm(!showForm)}
                        className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest bg-white/5 text-white/50 border border-white/10 rounded-sm hover:text-white hover:bg-white/10 transition-colors"
                    >
                        + Přidat ručně
                    </button>
                </div>
            </div>

            {showForm && (
                <div className="bg-[#0f0f0f] border border-white/10 rounded-sm p-6 space-y-4 shadow-lg shrink-0">
                    <input
                        type="text"
                        placeholder="Název..."
                        value={newIdea.title}
                        onChange={(e) => setNewIdea(prev => ({ ...prev, title: e.target.value }))}
                        className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white placeholder:text-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all font-medium"
                    />
                    <textarea
                        placeholder="Obsah nápadu..."
                        value={newIdea.content}
                        onChange={(e) => setNewIdea(prev => ({ ...prev, content: e.target.value }))}
                        rows={3}
                        className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white placeholder:text-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all font-medium resize-none"
                    />
                    <div className="flex gap-3">
                        <select
                            value={newIdea.category}
                            onChange={(e) => setNewIdea(prev => ({ ...prev, category: e.target.value }))}
                            className="px-4 py-2 bg-[#050505] border border-white/10 rounded-sm text-white/70 text-[10px] font-bold uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all"
                        >
                            <option value="tip">Tip</option>
                            <option value="edukace">Edukace</option>
                            <option value="motivace">Motivace</option>
                            <option value="statistika">Statistika</option>
                        </select>
                        <button
                            onClick={handleAddIdea}
                            disabled={saving}
                            className="px-6 py-2.5 bg-aisummit-cinnabar text-white text-[10px] font-black uppercase tracking-widest rounded-sm border border-aisummit-cinnabar/30 hover:bg-aisummit-cinnabar/90 transition-all shadow-[0_0_15px_rgba(229,83,63,0.3)]"
                        >
                            {saving ? "Ukládám..." : "Uložit"}
                        </button>
                    </div>
                </div>
            )}

            <motion.div
                className="space-y-2"
                initial="hidden"
                animate="visible"
                variants={{
                    hidden: { opacity: 0 },
                    visible: { opacity: 1, transition: { staggerChildren: 0.05 } }
                }}
            >
                {ideas.map(idea => (
                    <motion.div
                        variants={{
                            hidden: { opacity: 0, x: -20 },
                            visible: { opacity: 1, x: 0 }
                        }}
                        key={idea.id}
                        className="bg-[#0a0a0a] border border-white/5 rounded-sm p-4 hover:border-white/10 transition-all hover:bg-white/5 shadow-sm"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h4 className="text-xs font-bold uppercase tracking-wider text-white">{idea.title}</h4>
                                <p className="text-xs text-white/50 mt-1.5 font-medium">{idea.content}</p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="text-[9px] px-2 py-1 rounded-sm bg-white/5 text-white/50 uppercase tracking-widest font-bold border border-white/10">{idea.category}</span>
                                <span className="text-[9px] font-mono text-white/40 uppercase tracking-widest">×{idea.times_used || 0}</span>
                            </div>
                        </div>
                    </motion.div>
                ))}
            </motion.div>

            {ideas.length === 0 && (
                <div className="text-center py-12 text-white/40">
                    <p className="text-4xl mb-3 grayscale opacity-30">💡</p>
                    <p className="text-[10px] uppercase font-bold tracking-widest">Žádné nápady</p>
                </div>
            )}
        </div>
    )
}

// ═══════════════════════════════════════════════════════════
// REVIEWS TAB
// ═══════════════════════════════════════════════════════════

function ReviewsTab({ projectId }: { projectId: string }) {
    const [reviews, setReviews] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [showForm, setShowForm] = useState(false)
    const [newReview, setNewReview] = useState({ quote: "", customer_initials: "", rating: 5 })
    const [saving, setSaving] = useState(false)
    const [generatingAI, setGeneratingAI] = useState(false)

    const loadReviews = async () => {
        setLoading(true)
        const data = await getIGReviewsList()
        setReviews(data)
        setLoading(false)
    }

    useEffect(() => { loadReviews() }, [])

    const handleApproval = async (id: string, approved: boolean) => {
        await updateIGReviewApproval(id, approved)
        loadReviews()
    }

    const handleAddReview = async () => {
        if (!newReview.quote) return
        setSaving(true)
        await addNewReview({ ...newReview, projectId })
        setNewReview({ quote: "", customer_initials: "", rating: 5 })
        setShowForm(false)
        setSaving(false)
        loadReviews()
    }

    const handleGenerateAIReviews = async () => {
        setGeneratingAI(true)
        const res = await triggerAIReviewsGeneration({ configName: projectId, count: 5 })
        if (res.success) {
            await loadReviews()
        } else {
            alert("Chyba při generování recenzí: " + res.error)
        }
        setGeneratingAI(false)
    }

    if (loading) return <LoadingSpinner />

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold tracking-widest uppercase text-white/40">{reviews.length} recenzí</span>
                <div className="flex gap-3">
                    <button
                        onClick={handleGenerateAIReviews}
                        disabled={generatingAI}
                        className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all shadow-[0_0_15px_rgba(16,185,129,0.1)] ${generatingAI ? 'opacity-50 cursor-not-allowed' : 'hover:bg-emerald-500/20'}`}
                    >
                        {generatingAI ? "✨ Generuji..." : "✨ AI Recenze (5x)"}
                    </button>
                    <button
                        onClick={() => setShowForm(!showForm)}
                        className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest bg-white/5 text-white/50 border border-white/10 rounded-sm hover:text-white hover:bg-white/10 transition-colors"
                    >
                        + Přidat manuálně
                    </button>
                </div>
            </div>

            {showForm && (
                <div className="bg-[#0f0f0f] border border-white/10 rounded-sm p-6 space-y-4 shadow-lg shrink-0">
                    <textarea
                        placeholder="Text recenze..."
                        value={newReview.quote}
                        onChange={(e) => setNewReview(prev => ({ ...prev, quote: e.target.value }))}
                        rows={2}
                        className="w-full px-4 py-2.5 bg-[#050505] border border-white/10 rounded-sm text-white placeholder:text-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all font-medium resize-none"
                    />
                    <div className="flex gap-3">
                        <input
                            type="text"
                            placeholder="Iniciály (J.D.)"
                            value={newReview.customer_initials}
                            onChange={(e) => setNewReview(prev => ({ ...prev, customer_initials: e.target.value }))}
                            className="px-4 py-2 bg-[#050505] border border-white/10 rounded-sm text-white placeholder:text-white/30 text-sm focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all font-medium w-32"
                        />
                        <button
                            onClick={handleAddReview}
                            disabled={saving}
                            className="px-6 py-2.5 bg-aisummit-cinnabar text-white text-[10px] font-black uppercase tracking-widest rounded-sm border border-aisummit-cinnabar/30 hover:bg-aisummit-cinnabar/90 transition-all shadow-[0_0_15px_rgba(229,83,63,0.3)]"
                        >
                            {saving ? "Ukládám..." : "Uložit"}
                        </button>
                    </div>
                </div>
            )}

            <div className="space-y-2">
                {reviews.map(review => (
                    <div key={review.id} className="bg-[#0a0a0a] border border-white/5 rounded-sm p-4 hover:border-white/10 transition-all hover:bg-white/5 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="text-xs text-white/70 italic font-medium">&ldquo;{review.quote}&rdquo;</p>
                                <p className="text-[10px] text-white/40 mt-1.5 font-bold uppercase tracking-widest">— {review.customer_initials || "Anonym"} • {"⭐".repeat(review.rating || 5)}</p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                                {review.is_approved ? (
                                    <span className="text-[9px] px-2 py-1 rounded-sm bg-emerald-500/10 text-emerald-400 uppercase tracking-widest font-bold border border-emerald-500/20">✓ Schváleno</span>
                                ) : (
                                    <div className="flex gap-1">
                                        <button
                                            onClick={() => handleApproval(review.id, true)}
                                            className="text-[9px] px-2 py-1 rounded-sm bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 uppercase tracking-widest font-bold border border-emerald-500/20 transition-colors"
                                        >
                                            ✓
                                        </button>
                                        <button
                                            onClick={() => handleApproval(review.id, false)}
                                            className="text-[9px] px-2 py-1 rounded-sm bg-aisummit-cinnabar/10 text-aisummit-cinnabar hover:bg-aisummit-cinnabar/20 uppercase tracking-widest font-bold border border-aisummit-cinnabar/20 transition-colors"
                                        >
                                            ✗
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}

// ═══════════════════════════════════════════════════════════
// LOGS TAB
// ═══════════════════════════════════════════════════════════

function LogsTab({ projectId }: { projectId: string }) {
    const [logs, setLogs] = useState<any[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!projectId) return
        setLoading(true)
        getIGGenerationLogs(50, projectId).then(data => {
            setLogs(data)
            setLoading(false)
        })
    }, [projectId])

    if (loading) return <LoadingSpinner />

    return (
        <div className="space-y-4">
            <span className="text-[10px] uppercase font-bold tracking-widest text-white/40">{logs.length} záznamů</span>

            <div className="bg-[#0f0f0f] border border-white/10 rounded-sm overflow-hidden shadow-lg">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-white/10 bg-[#050505]">
                                <th className="text-left text-[10px] font-bold text-white/50 uppercase tracking-widest px-5 py-4">Model</th>
                                <th className="text-left text-[10px] font-bold text-white/50 uppercase tracking-widest px-5 py-4">Tokeny</th>
                                <th className="text-left text-[10px] font-bold text-white/50 uppercase tracking-widest px-5 py-4">Čas</th>
                                <th className="text-left text-[10px] font-bold text-white/50 uppercase tracking-widest px-5 py-4">Post</th>
                                <th className="text-left text-[10px] font-bold text-white/50 uppercase tracking-widest px-5 py-4">Error</th>
                                <th className="text-left text-[10px] font-bold text-white/50 uppercase tracking-widest px-5 py-4">Datum</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {logs.map(log => (
                                <tr key={log.id} className="hover:bg-white/5 transition-colors">
                                    <td className="px-5 py-4 text-[10px] text-white/70 font-mono tracking-widest">{log.model_used || "—"}</td>
                                    <td className="px-5 py-4 text-[10px] font-mono text-white/70 tracking-widest">{log.tokens_used || "—"}</td>
                                    <td className="px-5 py-4 text-[10px] font-mono text-white/70 tracking-widest">{log.generation_time_ms ? `${(log.generation_time_ms / 1000).toFixed(1)}s` : "—"}</td>
                                    <td className="px-5 py-4 text-[10px] text-white/50 max-w-[200px] truncate font-medium">
                                        {log.ig_posts?.caption?.substring(0, 50) || "—"}
                                    </td>
                                    <td className="px-5 py-4">
                                        {log.error ? (
                                            <span className="text-[10px] font-mono tracking-widest text-aisummit-cinnabar truncate max-w-[150px] block">{log.error}</span>
                                        ) : (
                                            <span className="text-[10px] font-bold text-emerald-500">✓</span>
                                        )}
                                    </td>
                                    <td className="px-5 py-4 text-[10px] text-white/40 font-mono tracking-widest">
                                        {new Date(log.created_at).toLocaleString("cs-CZ", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {logs.length === 0 && (
                    <div className="text-center py-12 text-[10px] font-bold uppercase tracking-widest text-white/40">Žádné logy</div>
                )}
            </div>
        </div>
    )
}

// ═══════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════

function CopyButton({ onClick, copied, label }: { onClick: () => void; copied: boolean; label?: string }) {
    return (
        <button
            onClick={onClick}
            className={`text-[9px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-sm transition-all flex items-center gap-1.5 border ${copied
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-white/5 text-white/50 border-white/10 hover:bg-white/10 hover:text-white"
                }`}
        >
            {copied ? "✅ Zkopírováno" : label || "📋 Kopírovat"}
        </button>
    )
}

function StatusBadge({ status }: { status: string }) {
    const config: Record<string, { text: string; class: string }> = {
        draft: { text: "DRAFT", class: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
        ready: { text: "READY", class: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
        posted: { text: "POSTED", class: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
        archived: { text: "ARCHIVED", class: "bg-white/5 text-white/40 border-white/10" },
    }
    const badge = config[status] || config.draft
    return (
        <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-sm border ${badge.class}`}>
            {badge.text}
        </span>
    )
}

function LoadingSpinner() {
    return (
        <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-[3px] border-white/10 border-t-aisummit-cinnabar rounded-full animate-spin shadow-sm" />
        </div>
    )
}

// ═══════════════════════════════════════════════════════════
// GROWTH ENGINE COMPONENTS
// ═══════════════════════════════════════════════════════════

function PillarBadge({ pillar }: { pillar: string }) {
    const config: Record<string, { emoji: string; label: string; color: string }> = {
        reach: { emoji: "🔥", label: "REACH", color: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
        value: { emoji: "📚", label: "VALUE", color: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
        convert: { emoji: "💰", label: "CONVERT", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
        connect: { emoji: "🤝", label: "CONNECT", color: "text-purple-400 bg-purple-500/10 border-purple-500/20" },
    }

    const badge = config[pillar]
    if (!badge) return null

    return (
        <span className={`text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-sm border ${badge.color} flex items-center gap-1`}>
            <span>{badge.emoji}</span>
            <span>{badge.label}</span>
        </span>
    )
}

function MetricsInputForm({ post, onUpdate }: { post: any; onUpdate: () => void }) {
    const [metrics, setMetrics] = useState({
        likes: post.likes || 0,
        comments: post.comments || 0,
        saves: post.saves || 0,
        reach: post.reach || 0,
        shares: post.shares || 0,
        profile_visits: post.profile_visits || 0,
        link_clicks: post.link_clicks || 0,
    })
    const [saving, setSaving] = useState(false)

    const handleSave = async () => {
        setSaving(true)
        await updateIGPostMetrics(post.id, metrics)
        setSaving(false)
        onUpdate()
    }

    const reachScore = (metrics.saves * 5 + metrics.shares * 8 + metrics.reach * 0.01).toFixed(0)
    const conversionScore = (metrics.link_clicks * 10 + metrics.profile_visits * 3).toFixed(0)

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">📊 Metriky</span>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-3 py-1.5 text-[10px] uppercase font-bold tracking-widest rounded-sm bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all border border-blue-500/20 disabled:opacity-50"
                >
                    {saving ? "Ukládám..." : "💾 Uložit"}
                </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
                {/* Engagement metrics */}
                <MetricInput label="❤️ Likes" value={metrics.likes} onChange={(v) => setMetrics({ ...metrics, likes: v })} />
                <MetricInput label="💬 Comments" value={metrics.comments} onChange={(v) => setMetrics({ ...metrics, comments: v })} />
                <MetricInput label="🔖 Saves" value={metrics.saves} onChange={(v) => setMetrics({ ...metrics, saves: v })} />

                {/* Growth Engine metrics */}
                <MetricInput label="👀 Reach" value={metrics.reach} onChange={(v) => setMetrics({ ...metrics, reach: v })} />
                <MetricInput label="↗️ Shares" value={metrics.shares} onChange={(v) => setMetrics({ ...metrics, shares: v })} />
                <MetricInput label="👤 Profile Visits" value={metrics.profile_visits} onChange={(v) => setMetrics({ ...metrics, profile_visits: v })} />
                <MetricInput label="🔗 Link Clicks" value={metrics.link_clicks} onChange={(v) => setMetrics({ ...metrics, link_clicks: v })} />
            </div>

            {/* Calculated scores */}
            <div className="flex gap-3 pt-4 border-t border-white/10 mt-4">
                <div className="flex-1 bg-amber-500/5 rounded-sm p-3 border border-amber-500/10">
                    <p className="text-[9px] text-amber-500/50 uppercase tracking-widest font-bold">Reach Score</p>
                    <p className="text-2xl font-black text-amber-500">{reachScore}</p>
                </div>
                <div className="flex-1 bg-emerald-500/5 rounded-sm p-3 border border-emerald-500/10">
                    <p className="text-[9px] text-emerald-500/50 uppercase tracking-widest font-bold">Conversion Score</p>
                    <p className="text-2xl font-black text-emerald-500">{conversionScore}</p>
                </div>
            </div>
        </div>
    )
}

function MetricInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
    return (
        <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1.5 block">{label}</label>
            <input
                type="number"
                value={value}
                onChange={(e) => onChange(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-1.5 bg-[#050505] border border-white/10 rounded-sm text-white text-xs font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all font-medium"
            />
        </div>
    )
}

// ═══════════════════════════════════════════════════════════
// PRODUCTS TAB — Ideas, Designs, Mockups
// ═══════════════════════════════════════════════════════════

type ProductSection = "ideas" | "design" | "mockup"

function ProductsTab({ projectId }: { projectId: string }) {
    const [section, setSection] = useState<ProductSection>("ideas")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Ideas state
    const [ideasTheme, setIdeasTheme] = useState("")
    const [ideasCount, setIdeasCount] = useState(5)
    // currently generated ideas
    const [ideas, setIdeas] = useState<ProductIdea[]>([])
    // ideas already saved in database
    const [savedIdeas, setSavedIdeas] = useState<ProductIdea[]>([])
    const [ideaVisuals, setIdeaVisuals] = useState<Record<string, string>>({})
    const [visualizingId, setVisualizingId] = useState<string | null>(null)
    const [referenceUrls, setReferenceUrls] = useState<Record<string, string>>({})
    const [uploadingId, setUploadingId] = useState<string | null>(null)
    const [savingId, setSavingId] = useState<number | null>(null)
    const [rejectingId, setRejectingId] = useState<number | null>(null)
    const [successMsg, setSuccessMsg] = useState<string | null>(null)

    // Design state
    const [designTheme, setDesignTheme] = useState("")
    const [designProductType, setDesignProductType] = useState("triko")
    const [designResult, setDesignResult] = useState<{ concept: DesignConcept; designUrl: string } | null>(null)

    // Mockup state
    const [mockupDesignUrl, setMockupDesignUrl] = useState("")
    const [mockupProductType, setMockupProductType] = useState("triko")
    const [mockupDescription, setMockupDescription] = useState("")
    const [mockupUrl, setMockupUrl] = useState<string | null>(null)

    const productTypes = [
        { value: "triko", label: "👕 Triko" },
        { value: "mikina", label: "🧥 Mikina" },
        { value: "čepice", label: "🧢 Čepice" },
        { value: "gadget", label: "🔧 Gadget" },
        { value: "accessory", label: "🔑 Doplněk" },
        { value: "card", label: "💳 Karta/Card" },
    ]

    const sections: { id: ProductSection; label: string; icon: string }[] = [
        { id: "ideas", label: "Nápady", icon: "💡" },
        { id: "design", label: "Design", icon: "🎨" },
        { id: "mockup", label: "Mockup", icon: "👕" },
    ]

    // ── Ideas Handler ─────────────────────────────────────
    const fetchSavedIdeas = useCallback(async () => {
        const { data } = await supabase
            .from("ig_product_ideas")
            .select("*")
            .eq("status", "saved")
            .order("created_at", { ascending: false })

        if (data) {
            // Map the snake_case DB fields back to the camelCase ProductIdea interface
            const mappedIdeas = data.map(row => ({
                id: row.id,
                client_id: row.client_id,
                name: row.name,
                brandingNames: row.branding_names || [],
                type: row.type,
                tagline: row.tagline,
                description: row.description,
                material: row.material,
                dimensions: row.dimensions,
                manufacturingMethod: row.manufacturing_method,
                priceRange: row.price_range,
                viralAngle: row.viral_angle,
                whyItWorks: row.why_it_works,
                productionNotes: row.production_notes,
                designPrompt: row.design_prompt,
                status: row.status as "saved" | "review" | "rejected",
                created_at: row.created_at
            }))

            setSavedIdeas(mappedIdeas)

            // Pre-populate ideaVisuals from DB-persisted URLs
            const visuals: Record<string, string> = {}
            for (const row of data) {
                if (row.design_url) visuals[row.id] = row.design_url
            }
            if (Object.keys(visuals).length > 0) {
                setIdeaVisuals(prev => ({ ...prev, ...visuals }))
            }
        }
    }, [])

    useEffect(() => {
        if (section === "ideas") {
            fetchSavedIdeas()
        }
    }, [projectId, section, fetchSavedIdeas])

    const handleSaveIdea = async (idea: ProductIdea, index: number) => {
        setSavingId(index)
        setError(null)
        setSuccessMsg(null)
        try {
            const result = await saveProductIdea(projectId, idea)
            if (result.success) {
                setIdeas(prev => prev.filter((_, i) => i !== index))
                fetchSavedIdeas()
                setSuccessMsg(`"${idea.name}" uložen ✅`)
                setTimeout(() => setSuccessMsg(null), 3000)
            } else {
                setError(`Uložení selhalo: ${result.error || 'Neznámá chyba'} (client: ${projectId})`)
            }
        } catch (err: any) {
            setError(`Save error: ${err.message} (client: ${projectId})`)
        } finally {
            setSavingId(null)
        }
    }

    const handleRejectIdea = async (idea: ProductIdea, index: number) => {
        setRejectingId(index)
        setError(null)
        try {
            const result = await rejectProductIdea(projectId, idea)
            if (result.success) {
                setIdeas(prev => prev.filter((_, i) => i !== index))
            } else {
                setError(`Zamítnutí selhalo: ${result.error || 'Neznámá chyba'}`)
            }
        } catch (err: any) {
            setError(`Reject error: ${err.message}`)
        } finally {
            setRejectingId(null)
        }
    }

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, ideaId: string) => {
        if (!e.target.files || e.target.files.length === 0) return

        const file = e.target.files[0]
        setUploadingId(ideaId)
        setError(null)

        try {
            const fileName = `${projectId}_${ideaId}_${Date.now()}`
            const { data, error } = await supabase.storage
                .from("product-references")
                .upload(fileName, file, { cacheControl: "3600", upsert: false })

            if (error) throw error

            const { data: publicUrlData } = supabase.storage
                .from("product-references")
                .getPublicUrl(fileName)

            setReferenceUrls(prev => ({ ...prev, [ideaId]: publicUrlData.publicUrl }))
        } catch (err: any) {
            setError(`Chyba uploadu: ${err.message}`)
        } finally {
            setUploadingId(null)
        }
    }

    const handleGenerateIdeas = async () => {
        setLoading(true)
        setError(null)
        try {
            const result = await triggerProductIdeas({
                configName: projectId,
                count: ideasCount,
                theme: ideasTheme || undefined,
            })
            if (result.success && result.ideas) {
                setIdeas(result.ideas)
            } else {
                setError(result.error || "Generování selhalo")
            }
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    // ── Design Handler ────────────────────────────────────
    const handleGenerateDesign = async () => {
        if (!designTheme.trim()) {
            setError("Zadej téma designu")
            return
        }
        setLoading(true)
        setError(null)
        try {
            const result = await triggerDesignGeneration({
                configName: projectId,
                theme: designTheme,
                productType: designProductType,
            })
            if (result.success && result.concept && result.designUrl) {
                setDesignResult({ concept: result.concept, designUrl: result.designUrl })
                // Auto-fill mockup with this design
                setMockupDesignUrl(result.designUrl)
                setMockupDescription(result.concept.description)
                setMockupProductType(designProductType)
            } else {
                setError(result.error || "Generování selhalo")
            }
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    // ── Mockup Handler ────────────────────────────────────
    const handleGenerateMockup = async () => {
        setLoading(true)
        setError(null)
        try {
            const result = await triggerMockupGeneration({
                configName: projectId,
                designUrl: mockupDesignUrl,
                productType: mockupProductType,
                designDescription: mockupDescription || undefined,
            })
            if (result.success && result.mockupUrl) {
                setMockupUrl(result.mockupUrl)
            } else {
                setError(result.error || "Generování selhalo")
            }
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="space-y-6">
            {/* Section tabs */}
            <div className="flex gap-2">
                {sections.map(s => (
                    <button
                        key={s.id}
                        onClick={() => { setSection(s.id); setError(null) }}
                        className={`flex items-center gap-2 px-4 py-2 rounded-sm text-[10px] uppercase tracking-widest font-bold transition-all border ${section === s.id
                            ? "bg-aisummit-cinnabar/10 text-aisummit-cinnabar border-aisummit-cinnabar/30"
                            : "bg-[#0a0a0a] text-white/40 border-white/5 hover:bg-white/5 hover:text-white"
                            }`}
                    >
                        <span>{s.icon}</span>
                        <span>{s.label}</span>
                    </button>
                ))}
            </div>

            {/* Error display */}
            {error && (
                <div className="bg-aisummit-cinnabar/10 border border-aisummit-cinnabar/30 rounded-sm p-4 text-aisummit-cinnabar text-[10px] uppercase font-bold tracking-widest">
                    ❌ {error}
                </div>
            )}
            {successMsg && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-sm p-4 text-emerald-400 text-[10px] uppercase font-bold tracking-widest">
                    {successMsg}
                </div>
            )}

            {/* Loading overlay */}
            {loading && (
                <div className="bg-[#0f0f0f] border border-white/10 rounded-sm p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
                    <div className="inline-block w-12 h-12 border-[3px] border-white/10 border-t-aisummit-cinnabar rounded-full animate-spin shadow-sm mb-6" />
                    <p className="text-[10px] uppercase font-bold tracking-widest text-white/50">Generuji... může to chvíli trvat</p>
                </div>
            )}

            {/* ═══ IDEAS SECTION ═══ */}
            {section === "ideas" && !loading && (
                <div className="space-y-6">
                    <div className="bg-[#0f0f0f] border border-white/10 rounded-sm p-8 shadow-lg">
                        <h3 className="text-2xl font-black uppercase tracking-tighter text-white mb-2">💡 Product Ideas Brainstorm</h3>
                        <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest mb-6">AI vygeneruje kreativní nápady na nové produkty — nejen oblečení, ale i gadgety, doplňky a originální merch.</p>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                            <div>
                                <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5 block">Téma (volitelné)</label>
                                <input
                                    value={ideasTheme}
                                    onChange={(e) => setIdeasTheme(e.target.value)}
                                    placeholder="letní kolekce, valentýn..."
                                    className="w-full px-4 py-3 bg-[#050505] border border-white/10 rounded-sm text-white text-[10px] font-medium placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all"
                                />
                            </div>
                            <div>
                                <label className="text-[9px] uppercase tracking-widest font-bold text-white/40 mb-1.5 block">Počet nápadů</label>
                                <select
                                    value={ideasCount}
                                    onChange={(e) => setIdeasCount(parseInt(e.target.value))}
                                    className="w-full px-4 py-3 bg-[#050505] border border-white/10 rounded-sm text-white text-[10px] font-bold uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all"
                                >
                                    {[3, 5, 7, 10].map(n => <option key={n} value={n}>{n}</option>)}
                                </select>
                            </div>
                            <div className="flex items-end">
                                <button
                                    onClick={handleGenerateIdeas}
                                    disabled={loading}
                                    className="w-full px-4 py-3 bg-white/10 hover:bg-white/20 text-white rounded-sm text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 border border-white/20 shadow-sm"
                                >
                                    🚀 Generovat nápady
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Ideas grid */}
                    {ideas.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {ideas.map((idea, i) => (
                                <div key={i} className="bg-[#0a0a0a] border border-white/10 hover:border-white/20 hover:bg-white/5 rounded-sm p-6 shadow-sm transition-all group">
                                    <div className="flex items-start justify-between mb-4">
                                        <div>
                                            <h4 className="text-white font-bold text-sm tracking-wide uppercase">{idea.name}</h4>
                                            <p className="text-white/50 text-[10px] font-bold mt-1 uppercase tracking-widest">"{idea.tagline}"</p>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-1 bg-white/10 text-white/70 border border-white/10 rounded-sm whitespace-nowrap">{idea.type}</span>
                                            {/* Action buttons */}
                                            <button
                                                onClick={() => handleSaveIdea(idea, i)}
                                                disabled={savingId === i}
                                                className="w-7 h-7 rounded-sm text-sm border flex items-center justify-center transition-all bg-white/5 text-white/30 border-white/10 hover:bg-emerald-500/20 hover:text-emerald-400 hover:border-emerald-500/30 disabled:opacity-50"
                                                title="Uložit nápad"
                                            >{savingId === i ? '⏳' : '💾'}</button>
                                            <button
                                                onClick={() => handleRejectIdea(idea, i)}
                                                disabled={rejectingId === i}
                                                className="w-7 h-7 rounded-sm text-sm border flex items-center justify-center transition-all bg-white/5 text-white/30 border-white/10 hover:bg-aisummit-cinnabar/20 hover:text-aisummit-cinnabar hover:border-aisummit-cinnabar/30 disabled:opacity-50"
                                                title="Zahodit"
                                            >{rejectingId === i ? '⏳' : '🗑️'}</button>
                                        </div>
                                    </div>

                                    {/* Branding name variants */}
                                    {idea.brandingNames && idea.brandingNames.length > 0 && (
                                        <div className="mb-4 pt-2">
                                            <span className="text-[9px] uppercase tracking-widest font-bold text-amber-500/50 mb-2 block">🏷️ Varianty názvů</span>
                                            <div className="flex flex-wrap gap-1.5">
                                                {idea.brandingNames.map((bn, j) => (
                                                    <span key={j} className="px-2 py-1 bg-amber-500/5 border border-amber-500/10 text-amber-500 rounded-sm text-[9px] font-bold uppercase tracking-widest cursor-default">
                                                        {bn}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <p className="text-white/70 text-xs font-medium mb-5">{idea.description}</p>

                                    <div className="space-y-2 text-[10px] font-mono tracking-wide text-white/50">
                                        <div className="flex gap-2">
                                            <span className="text-white/30 w-16 uppercase font-bold tracking-widest">💰 Cena:</span>
                                            <span className="text-emerald-400 font-bold">{idea.priceRange}</span>
                                        </div>
                                        <div className="flex gap-2">
                                            <span className="text-white/30 w-16 uppercase font-bold tracking-widest">🔧 Mat.:</span>
                                            <span>{idea.material}</span>
                                        </div>
                                        <div className="flex gap-2">
                                            <span className="text-white/30 w-16 uppercase font-bold tracking-widest">📐 Rozm.:</span>
                                            <span>{idea.dimensions}</span>
                                        </div>
                                        <div className="flex gap-2">
                                            <span className="text-white/30 w-16 uppercase font-bold tracking-widest">🏭 Výr.:</span>
                                            <span>{idea.manufacturingMethod}</span>
                                        </div>
                                    </div>

                                    <div className="mt-4 pt-4 border-t border-white/10 space-y-4 shadow-sm pb-2">
                                        <div>
                                            <span className="text-[9px] uppercase tracking-widest text-amber-500/50 font-bold">🔥 Virální angle</span>
                                            <p className="text-white/70 text-[10px] font-medium mt-1 leading-relaxed">{idea.viralAngle}</p>
                                        </div>
                                        <div>
                                            <span className="text-[9px] uppercase tracking-widest text-emerald-500/50 font-bold">✅ Proč to bude fungovat</span>
                                            <p className="text-white/70 text-[10px] font-medium mt-1 leading-relaxed">{idea.whyItWorks}</p>
                                        </div>
                                        <div>
                                            <span className="text-[9px] uppercase tracking-widest text-blue-500/50 font-bold">📋 Produkce</span>
                                            <p className="text-white/70 text-[10px] font-medium mt-1 leading-relaxed">{idea.productionNotes}</p>
                                        </div>
                                    </div>

                                    {/* Product visualization */}
                                    {ideaVisuals[`gen_${i}`] && (
                                        <div className="mt-4 relative group/vis">
                                            <img src={ideaVisuals[`gen_${i}`]} alt={idea.name} className="w-full rounded-sm border border-white/10 shadow-sm" />
                                            <a
                                                href={ideaVisuals[`gen_${i}`]}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="absolute bottom-2 right-2 px-2 py-1 bg-[#050505] border border-white/10 text-white text-[9px] uppercase tracking-widest font-bold rounded-sm opacity-0 group-hover/vis:opacity-100 transition-opacity shadow-sm"
                                            >📥 Plná velikost</a>
                                        </div>
                                    )}

                                    {/* Action buttons */}
                                    <div className="mt-4 flex gap-2 pt-2">
                                        <button
                                            onClick={async () => {
                                                setVisualizingId(`gen_${i}`)
                                                setError(null)
                                                try {
                                                    const result = await triggerProductDesign({ configName: projectId, idea })
                                                    if (result.success && result.designUrl) {
                                                        setIdeaVisuals(v => ({ ...v, [`gen_${i}`]: result.designUrl! }))
                                                    } else {
                                                        setError(result.error || "Vizualizace selhala")
                                                    }
                                                } catch (err: any) { setError(err.message) }
                                                finally { setVisualizingId(null) }
                                            }}
                                            disabled={visualizingId === `gen_${i}`}
                                            className="flex-1 px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded-sm text-[9px] font-bold uppercase tracking-widest text-amber-500 transition-all disabled:opacity-50 shadow-sm"
                                        >
                                            {visualizingId === `gen_${i}` ? "⏳ Generuji..." : "🖼️ Vizualizovat produkt"}
                                        </button>
                                        <button
                                            onClick={() => {
                                                setDesignTheme(idea.name + " — " + idea.tagline)
                                                setSection("design")
                                            }}
                                            className="flex-1 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-sm text-[9px] font-bold uppercase tracking-widest text-white/50 hover:text-white transition-all shadow-sm"
                                        >
                                            🎨 Design pro tisk
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* DB Saved Ideas grid */}
                    {savedIdeas.length > 0 && (
                        <div className="mt-12">
                            <h3 className="text-xl font-black uppercase tracking-tighter text-emerald-400 mb-2 border-b border-emerald-900/50 pb-2">💾 Uložené Nápady</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-6">
                                {savedIdeas.map((idea) => (
                                    <div key={idea.id} className="bg-[#050505] border border-emerald-500/20 rounded-sm p-6 shadow-sm transition-all relative overflow-hidden">
                                        {/* Status badge */}
                                        <div className="absolute top-0 right-0 px-3 py-1 bg-emerald-500/20 text-emerald-400 text-[8px] font-black tracking-widest uppercase rounded-bl-sm border-b border-l border-emerald-500/20">
                                            Saved
                                        </div>

                                        <div className="flex items-start justify-between mb-4 pr-12">
                                            <div>
                                                <h4 className="text-white font-bold text-sm tracking-wide uppercase">{idea.name}</h4>
                                                <p className="text-white/50 text-[10px] font-bold mt-1 uppercase tracking-widest">"{idea.tagline}"</p>
                                            </div>
                                        </div>

                                        <div className="mb-4">
                                            <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-1 bg-white/10 text-white/70 border border-white/10 rounded-sm whitespace-nowrap">{idea.type}</span>
                                        </div>

                                        <p className="text-white/70 text-xs font-medium mb-5">{idea.description}</p>

                                        <div className="space-y-2 text-[10px] font-mono tracking-wide text-white/50">
                                            <div className="flex gap-2">
                                                <span className="text-white/30 w-16 uppercase font-bold tracking-widest">💰 Cena:</span>
                                                <span className="text-emerald-400 font-bold">{idea.priceRange}</span>
                                            </div>
                                            <div className="flex gap-2">
                                                <span className="text-white/30 w-16 uppercase font-bold tracking-widest">🔧 Mat.:</span>
                                                <span>{idea.material}</span>
                                            </div>
                                            <div className="flex gap-2">
                                                <span className="text-white/30 w-16 uppercase font-bold tracking-widest">🏭 Výr.:</span>
                                                <span>{idea.manufacturingMethod}</span>
                                            </div>
                                        </div>

                                        {/* Product visualization */}
                                        {ideaVisuals[idea.id as string] && (
                                            <div className="mt-4 relative group/vis">
                                                <img src={ideaVisuals[idea.id as string]} alt={idea.name} className="w-full rounded-sm border border-emerald-500/20 shadow-sm" />
                                                <a
                                                    href={ideaVisuals[idea.id as string]}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="absolute bottom-2 right-2 px-2 py-1 bg-[#050505] border border-white/10 text-white text-[9px] uppercase tracking-widest font-bold rounded-sm opacity-0 group-hover/vis:opacity-100 transition-opacity shadow-sm"
                                                >📥 Plná velikost</a>
                                            </div>
                                        )}

                                        {/* Action buttons */}
                                        <div className="mt-4 flex gap-2 pt-4 border-t border-white/5 items-center">

                                            {/* File Uploader */}
                                            <div className="relative">
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    id={`upload-${idea.id}`}
                                                    className="hidden"
                                                    onChange={(e) => handleImageUpload(e, idea.id as string)}
                                                    disabled={uploadingId === idea.id}
                                                />
                                                <label
                                                    htmlFor={`upload-${idea.id}`}
                                                    className={`w-9 h-9 rounded-sm border flex items-center justify-center transition-all cursor-pointer ${referenceUrls[idea.id as string]
                                                        ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-400"
                                                        : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white"
                                                        } ${uploadingId === idea.id ? "opacity-50 cursor-wait" : ""}`}
                                                    title="Nahrát referenční fotku"
                                                >
                                                    {uploadingId === idea.id ? (
                                                        <div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                                                    ) : referenceUrls[idea.id as string] ? (
                                                        "✓"
                                                    ) : (
                                                        "📎"
                                                    )}
                                                </label>
                                            </div>

                                            <button
                                                onClick={async () => {
                                                    const id = idea.id as string
                                                    setVisualizingId(id)
                                                    setError(null)
                                                    try {
                                                        const reqUrl = referenceUrls[id]
                                                        const result = await triggerProductDesign({
                                                            configName: projectId,
                                                            idea,
                                                            referenceImageUrl: reqUrl,
                                                            ideaId: id,
                                                        })
                                                        if (result.success && result.designUrl) {
                                                            setIdeaVisuals(v => ({ ...v, [id]: result.designUrl! }))
                                                        } else {
                                                            setError(result.error || "Vizualizace selhala")
                                                        }
                                                    } catch (err: any) { setError(err.message) }
                                                    finally { setVisualizingId(null) }
                                                }}
                                                disabled={visualizingId === idea.id}
                                                className="flex-1 px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-sm text-[9px] font-bold uppercase tracking-widest text-emerald-400 transition-all disabled:opacity-50 shadow-sm flex items-center justify-center gap-2"
                                            >
                                                {visualizingId === idea.id ? "⏳ Generuji..." : (
                                                    referenceUrls[idea.id as string]
                                                        ? "🖼️ Fuse vizualizace (i2i)"
                                                        : "🖼️ Vizualizovat z textu"
                                                )}
                                            </button>

                                            {/* Promo Post button — only if design exists */}
                                            {ideaVisuals[idea.id as string] && (
                                                <button
                                                    onClick={async () => {
                                                        const id = idea.id as string
                                                        setVisualizingId(`promo_${id}`)
                                                        setError(null)
                                                        try {
                                                            const result = await createPromoPost({
                                                                configName: projectId,
                                                                ideaName: idea.name,
                                                                ideaTagline: idea.tagline,
                                                                ideaDescription: idea.description,
                                                                ideaType: idea.type,
                                                                ideaPriceRange: idea.priceRange,
                                                                designUrl: ideaVisuals[id],
                                                            })
                                                            if (result.success) {
                                                                alert(`✅ Promo post vytvořen!\n\nCaption:\n${result.caption?.substring(0, 200)}...\n\nNajdeš ho v záložce Posts jako Draft.`)
                                                            } else {
                                                                setError(result.error || "Vytvoření postu selhalo")
                                                            }
                                                        } catch (err: any) { setError(err.message) }
                                                        finally { setVisualizingId(null) }
                                                    }}
                                                    disabled={visualizingId === `promo_${idea.id}`}
                                                    className="flex-1 px-3 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded-sm text-[9px] font-bold uppercase tracking-widest text-blue-400 transition-all disabled:opacity-50 shadow-sm flex items-center justify-center gap-2"
                                                >
                                                    {visualizingId === `promo_${idea.id}` ? "⏳ Vytvářím..." : "📸 Vytvoř promo post"}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ═══ DESIGN SECTION ═══ */}
            {section === "design" && !loading && (
                <div className="space-y-6">
                    <div className="bg-[#0f0f0f] border border-white/10 rounded-sm p-8 shadow-lg">
                        <h3 className="text-2xl font-black uppercase tracking-tighter text-white mb-2">🎨 Print-Ready Design Generator</h3>
                        <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest mb-6">AI vytvoří tisknutelný grafický design izolovaný na černém pozadí — připravený pro DTG potisk.</p>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                            <div>
                                <label className="text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1.5 block">Téma designu *</label>
                                <input
                                    value={designTheme}
                                    onChange={(e) => setDesignTheme(e.target.value)}
                                    placeholder="skull and roses, abstract streetwear..."
                                    className="w-full px-4 py-3 bg-[#050505] border border-white/10 rounded-sm text-white text-[10px] font-medium placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all"
                                />
                            </div>
                            <div>
                                <label className="text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1.5 block">Typ produktu</label>
                                <select
                                    value={designProductType}
                                    onChange={(e) => setDesignProductType(e.target.value)}
                                    className="w-full px-4 py-3 bg-[#050505] border border-white/10 rounded-sm text-white text-[10px] font-bold uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all"
                                >
                                    {productTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                </select>
                            </div>
                            <div className="flex items-end">
                                <button
                                    onClick={handleGenerateDesign}
                                    disabled={loading || !designTheme.trim()}
                                    className="w-full px-4 py-3 bg-white/10 hover:bg-white/20 text-white rounded-sm text-[10px] uppercase font-black tracking-widest border border-white/20 transition-all disabled:opacity-50 shadow-sm"
                                >
                                    🎨 Generovat design
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Design result */}
                    {designResult && (
                        <div className="bg-[#0a0a0a] border border-white/10 shadow-sm rounded-sm p-6">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* Image preview */}
                                <div className="relative group">
                                    <img
                                        src={designResult.designUrl}
                                        alt={designResult.concept.name}
                                        className="w-full rounded-sm border border-white/10 shadow-sm"
                                    />
                                    <a
                                        href={designResult.designUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="absolute bottom-3 right-3 px-3 py-1.5 bg-[#050505] border border-white/10 text-white text-[9px] font-bold uppercase tracking-widest rounded-sm opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                                    >
                                        📥 Otevřít v plné velikosti
                                    </a>
                                </div>

                                {/* Concept details */}
                                <div className="space-y-4">
                                    <div>
                                        <h4 className="text-2xl font-black uppercase tracking-tighter text-white">{designResult.concept.name}</h4>
                                        <p className="text-white/50 text-xs font-medium mt-1.5">{designResult.concept.description}</p>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="bg-[#0f0f0f] border border-white/5 rounded-sm p-4">
                                            <span className="text-[9px] font-bold uppercase tracking-widest text-white/40">Styl</span>
                                            <p className="text-white text-xs font-medium mt-1">{designResult.concept.style}</p>
                                        </div>
                                        <div className="bg-[#0f0f0f] border border-white/5 rounded-sm p-4">
                                            <span className="text-[9px] font-bold uppercase tracking-widest text-white/40">Placement</span>
                                            <p className="text-white text-xs font-medium mt-1">{designResult.concept.placement}</p>
                                        </div>
                                    </div>

                                    <div>
                                        <span className="text-[9px] font-bold uppercase tracking-widest text-white/40 mb-2 block">Barvy</span>
                                        <div className="flex gap-2">
                                            {designResult.concept.colors.map((c, i) => (
                                                <span key={i} className="px-2 py-1 bg-white/5 border border-white/10 rounded-sm text-[9px] tracking-widest uppercase font-bold text-white/70">{c}</span>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="pt-4 border-t border-white/10">
                                        <span className="text-[9px] font-bold uppercase tracking-widest text-white/40">AI Prompt</span>
                                        <p className="text-white/50 text-[10px] mt-2 font-mono tracking-wide bg-[#0f0f0f] border border-white/5 shadow-inner rounded-sm p-4 leading-relaxed">{designResult.concept.designPrompt}</p>
                                    </div>

                                    {/* Generate mockup from this design */}
                                    <button
                                        onClick={() => {
                                            setMockupDesignUrl(designResult.designUrl)
                                            setMockupDescription(designResult.concept.description)
                                            setMockupProductType(designProductType)
                                            setSection("mockup")
                                        }}
                                        className="w-full px-4 py-3 bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-sm text-[10px] font-black uppercase tracking-widest transition-all shadow-sm"
                                    >
                                        👕 Vytvořit mockup s tímto designem
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ═══ MOCKUP SECTION ═══ */}
            {section === "mockup" && !loading && (
                <div className="space-y-6">
                    <div className="bg-[#0f0f0f] border border-white/10 rounded-sm p-8 shadow-lg">
                        <h3 className="text-2xl font-black uppercase tracking-tighter text-white mb-2">👕 Product Mockup Generator</h3>
                        <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest mb-6">AI vygeneruje fotorealistický mockup produktu s designem — ideální pro e-shop a Instagram.</p>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                            <div>
                                <label className="text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1.5 block">Typ produktu</label>
                                <select
                                    value={mockupProductType}
                                    onChange={(e) => setMockupProductType(e.target.value)}
                                    className="w-full px-4 py-3 bg-[#050505] border border-white/10 rounded-sm text-white text-[10px] font-bold uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all"
                                >
                                    {productTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1.5 block">Popis designu (volitelné)</label>
                                <input
                                    value={mockupDescription}
                                    onChange={(e) => setMockupDescription(e.target.value)}
                                    placeholder="Popis grafiky pro lepší výsledek..."
                                    className="w-full px-4 py-3 bg-[#050505] border border-white/10 rounded-sm text-white text-[10px] font-medium placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-aisummit-cinnabar/30 transition-all"
                                />
                            </div>
                        </div>

                        <button
                            onClick={handleGenerateMockup}
                            disabled={loading}
                            className="w-full sm:w-auto px-6 py-3 bg-white/10 hover:bg-white/20 border border-white/20 text-white rounded-sm text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 shadow-sm"
                        >
                            📸 Generovat mockup
                        </button>
                    </div>

                    {/* Mockup result */}
                    {mockupUrl && (
                        <div className="bg-[#0a0a0a] border border-white/10 shadow-sm rounded-sm p-6">
                            <div className="max-w-lg mx-auto relative group">
                                <img
                                    src={mockupUrl}
                                    alt="Product mockup"
                                    className="w-full rounded-sm border border-white/10 shadow-sm"
                                />
                                <a
                                    href={mockupUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="absolute bottom-3 right-3 px-3 py-1.5 bg-[#050505] border border-white/10 text-white text-[9px] font-bold uppercase tracking-widest rounded-sm opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                                >
                                    📥 Otevřít v plné velikosti
                                </a>
                            </div>
                        </div>
                    )}

                    {/* Show design reference if available */}
                    {mockupDesignUrl && (
                        <div className="bg-[#0f0f0f] border border-white/5 rounded-sm p-5 shadow-inner">
                            <span className="text-[9px] font-bold uppercase tracking-widest text-white/40">Zdrojový design</span>
                            <div className="flex items-center gap-4 mt-3">
                                <img src={mockupDesignUrl} alt="Source design" className="w-16 h-16 rounded-sm border border-white/10 object-cover shadow-sm" />
                                <code className="text-[10px] text-white/50 tracking-wide font-mono break-all">{mockupDesignUrl}</code>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

// ═══════════════════════════════════════════════════════════
// BRAND TAB  (Upload & manage brand/reference images)
// ═══════════════════════════════════════════════════════════

function BrandTab({ projectId }: { projectId: string }) {
    const [images, setImages] = useState<string[]>([])
    const [loading, setLoading] = useState(true)
    const [uploading, setUploading] = useState(false)
    const [dragOver, setDragOver] = useState(false)
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

    const loadImages = useCallback(async () => {
        if (!projectId) return
        setLoading(true)
        const urls = await getBrandImages(projectId)
        setImages(urls)
        setLoading(false)
    }, [projectId])

    useEffect(() => { loadImages() }, [loadImages])

    const handleUpload = async (files: FileList | null) => {
        if (!files || !projectId) return
        setUploading(true)
        setMessage(null)

        let successCount = 0
        for (const file of Array.from(files)) {
            const formData = new FormData()
            formData.append('file', file)
            formData.append('clientSlug', projectId)
            formData.append('category', 'brand')

            const result = await uploadBrandImage(formData)
            if (result.success) successCount++
            else setMessage({ type: 'error', text: result.error || 'Upload selhal' })
        }

        if (successCount > 0) {
            setMessage({ type: 'success', text: `${successCount} ${successCount === 1 ? 'fotka nahrána' : 'fotek nahráno'}` })
        }
        await loadImages()
        setUploading(false)
    }

    const handleDelete = async (imageUrl: string) => {
        const result = await deleteBrandImage(projectId, imageUrl)
        if (result.success) {
            setImages(prev => prev.filter(url => url !== imageUrl))
            setMessage({ type: 'success', text: 'Fotka smazána' })
        } else {
            setMessage({ type: 'error', text: result.error || 'Smazání selhalo' })
        }
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        setDragOver(false)
        handleUpload(e.dataTransfer.files)
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="bg-[#0a0a0a]/90 backdrop-blur-xl border border-white/10 rounded-sm p-6 shadow-sm">
                <h2 className="text-lg font-black uppercase tracking-tight text-white">Brand & Reference Fotky</h2>
                <p className="text-white/50 text-xs mt-1 tracking-wide">
                    Nahraj fotky produktů, lidí, prostředí — AI je použije jako referenci při generování příspěvků.
                    Čím více kvalitních fotek, tím realističtější výstup.
                </p>
            </div>

            {/* Status Message */}
            {message && (
                <div className={`px-4 py-3 rounded-sm text-xs font-bold uppercase tracking-wider border ${message.type === 'success'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-red-500/10 text-red-400 border-red-500/20'
                    }`}>
                    {message.text}
                </div>
            )}

            {/* Upload Zone */}
            <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-sm p-8 text-center transition-all cursor-pointer ${dragOver
                    ? 'border-white/40 bg-white/5'
                    : 'border-white/10 hover:border-white/20 bg-[#0a0a0a]/50'
                    }`}
                onClick={() => {
                    const input = document.createElement('input')
                    input.type = 'file'
                    input.multiple = true
                    input.accept = 'image/*'
                    input.onchange = (e) => handleUpload((e.target as HTMLInputElement).files)
                    input.click()
                }}
            >
                {uploading ? (
                    <div className="flex flex-col items-center gap-3">
                        <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span className="text-white/50 text-xs font-bold uppercase tracking-wider">Nahrávám...</span>
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-3">
                        <span className="text-4xl">📸</span>
                        <span className="text-white/50 text-xs font-bold uppercase tracking-wider">
                            Přetáhni fotky sem nebo klikni pro výběr
                        </span>
                        <span className="text-white/30 text-[10px] tracking-wide">
                            JPG, PNG, WebP • max 10 MB • produkty, lidi, prostředí
                        </span>
                    </div>
                )}
            </div>

            {/* Image Grid */}
            {loading ? (
                <div className="flex items-center justify-center py-12">
                    <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                </div>
            ) : images.length === 0 ? (
                <div className="text-center py-12 text-white/30">
                    <span className="text-5xl block mb-4">🖼️</span>
                    <p className="text-xs font-bold uppercase tracking-wider">Zatím žádné fotky</p>
                    <p className="text-[10px] mt-1 tracking-wide">Nahraj fotky produktů a značky pro lepší AI generování</p>
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {images.map((url, i) => (
                        <div key={url} className="group relative aspect-square bg-[#0f0f0f] border border-white/10 rounded-sm overflow-hidden shadow-sm">
                            <img
                                src={url}
                                alt={`Brand image ${i + 1}`}
                                className="w-full h-full object-cover"
                                loading="lazy"
                            />
                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleDelete(url) }}
                                    className="bg-red-500/80 hover:bg-red-500 text-white px-3 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-wider transition-colors shadow-sm"
                                >
                                    Smazat
                                </button>
                            </div>
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                                <span className="text-[9px] text-white/60 font-mono">{i + 1}/{images.length}</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Info */}
            <div className="bg-[#0a0a0a]/60 border border-white/5 rounded-sm p-4 text-[10px] text-white/30 tracking-wide space-y-1">
                <p>💡 <strong className="text-white/50">Tip:</strong> Nahraj fotky produktů — AI je zakomponuje do reálných scén místo generování od nuly.</p>
                <p>👤 <strong className="text-white/50">Lidi:</strong> Fotky lidí se použijí pro konzistentní postavu napříč příspěvky (max 5 referenčních fotek).</p>
                <p>🏙️ <strong className="text-white/50">Prostředí:</strong> Fotky prodejny/kanceláře pomohou zachovat autentičnost behind-the-scenes postů.</p>
            </div>
        </div>
    )
}
