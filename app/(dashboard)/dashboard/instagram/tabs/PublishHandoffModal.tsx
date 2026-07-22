"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { IGPost } from "./types"
import { useCopyToClipboard } from "./hooks"
import { ReelPlayer } from "./shared"
import { parsePostMedia } from "@/lib/media-urls"
import { publishNowAction, getPostPublishStatus } from "@/app/actions/calendar-actions"

// ═══════════════════════════════════════════════════════════
// PUBLISH HANDOFF MODAL — "one-tap" hand-off to the Instagram app
// ═══════════════════════════════════════════════════════════
//
// Per-post "post it" surface with two paths. When the account is connected it
// offers ⚡ Publikovat hned — a real server-side Graph publish via the ig-publisher
// cron (no Instagram app; image, carousel, or reel). The manual "handoff" is always
// available as the fallback (and the route for unconnected accounts): the Web Share
// API pushes the image(s) or the reel MP4 into the Instagram app and copies the
// caption to the clipboard so it's ready to paste.

// Build a test File once to feature-detect Web Share file support.
function canShareFiles(files: File[]): boolean {
    try {
        return typeof navigator !== "undefined" && !!navigator.canShare && navigator.canShare({ files })
    } catch {
        return false
    }
}

export function PublishHandoffModal({
    post,
    connected,
    onClose,
    onMarkedPosted,
}: {
    post: IGPost
    connected: boolean
    onClose: () => void
    onMarkedPosted: (postId: string) => void
}) {
    const { copiedField, copyToClipboard } = useCopyToClipboard()
    const [idx, setIdx] = useState(0)
    const [sharing, setSharing] = useState(false)
    const [shared, setShared] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [shareSupported, setShareSupported] = useState(false)
    const [pubState, setPubState] = useState<"idle" | "publishing" | "posted" | "failed">("idle")
    const [pubMsg, setPubMsg] = useState<string | null>(null)
    const [permalink, setPermalink] = useState<string | null>(null)
    const mounted = useRef(true)

    const media = parsePostMedia(post.image_url, post.media_type)
    const isReel = media.kind === "reel"
    // Reels share/save their MP4; static posts share their image slides.
    const imageUrls = isReel ? (media.coverUrl ? [media.coverUrl] : []) : media.urls
    const isCarousel = media.kind === "carousel" && imageUrls.length > 1

    const hashtags = Array.isArray(post.hashtags) ? post.hashtags : []
    const hashtagsText = hashtags.join(" ")
    const fullText = [post.caption, hashtagsText].filter(Boolean).join("\n\n")
    // ⚡ Publikovat hned — real Graph publish (connected). Reels publish via the REELS
    // container (just need the video); static posts need at least one image.
    const canAutoPublish = connected && (isReel ? !!media.videoUrl : imageUrls.length > 0)
    // Something to hand off manually (Web Share / download): reel video or image slides.
    const hasShareableMedia = isReel ? !!media.videoUrl : imageUrls.length > 0

    // Feature-detect Web Share (files) on the client — true on most phones, false on desktop.
    useEffect(() => {
        try {
            const probe = new File([new Blob(["x"], { type: "image/jpeg" })], "p.jpg", { type: "image/jpeg" })
            setShareSupported(canShareFiles([probe]))
        } catch {
            setShareSupported(false)
        }
    }, [])

    // Lock background scroll while open (mirrors PostDetailModal).
    useEffect(() => {
        const original = document.body.style.overflow
        document.body.style.overflow = "hidden"
        return () => { document.body.style.overflow = original }
    }, [])

    // Guard async polling against unmount.
    useEffect(() => () => { mounted.current = false }, [])

    async function urlsToFiles(urls: string[]): Promise<File[]> {
        const files: File[] = []
        for (let i = 0; i < urls.length; i++) {
            const res = await fetch(urls[i])
            if (!res.ok) throw new Error(`fetch ${res.status}`)
            const blob = await res.blob()
            const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg").replace("+xml", "")
            files.push(new File([blob], `post-${i + 1}.${ext}`, { type: blob.type || "image/jpeg" }))
        }
        return files
    }

    const shareToInstagram = useCallback(async () => {
        // Reels share the MP4; static posts share the image slide(s).
        const shareUrls = isReel ? (media.videoUrl ? [media.videoUrl] : []) : imageUrls
        if (shareUrls.length === 0) return
        setSharing(true)
        setError(null)
        try {
            // 1) Caption to clipboard first — IG's share target ignores shared text
            //    for photo posts, so the clipboard is the bridge (paste in IG).
            try { await navigator.clipboard.writeText(fullText) } catch { /* non-fatal */ }

            // 2) Pull the public media URL(s) into File objects.
            const files = await urlsToFiles(shareUrls)

            // 3) Native share sheet → user picks Instagram.
            if (navigator.canShare && navigator.canShare({ files })) {
                await navigator.share({ files, title: "Instagram" })
                setShared(true)
            } else {
                setError("Tento prohlížeč neumí přímé sdílení — použij Uložit + Kopírovat popisek.")
            }
        } catch (e: unknown) {
            // User dismissing the share sheet throws AbortError — that's not an error.
            if (!(e instanceof DOMException && e.name === "AbortError")) {
                setError("Sdílení se nezdařilo. Použij Uložit + Kopírovat popisek níže.")
            }
        } finally {
            setSharing(false)
        }
    }, [isReel, media.videoUrl, imageUrls, fullText])

    const saveImages = useCallback(async () => {
        // Reels download the MP4 (+ cover); static posts download the image slide(s).
        const items = isReel
            ? [
                ...(media.videoUrl ? [{ url: media.videoUrl, name: `reel-${post.id.slice(0, 8)}.mp4` }] : []),
                ...(media.coverUrl ? [{ url: media.coverUrl, name: `reel-${post.id.slice(0, 8)}-cover.webp` }] : []),
            ]
            : imageUrls.map((url, i) => ({
                url,
                name: isCarousel ? `post-${post.id.slice(0, 8)}-slide${i + 1}.png` : `post-${post.id.slice(0, 8)}.png`,
            }))
        for (const item of items) {
            try {
                const res = await fetch(item.url)
                const blob = await res.blob()
                const blobUrl = URL.createObjectURL(blob)
                const a = document.createElement("a")
                a.href = blobUrl
                a.download = item.name
                document.body.appendChild(a)
                a.click()
                document.body.removeChild(a)
                URL.revokeObjectURL(blobUrl)
            } catch {
                window.open(item.url, "_blank")
            }
        }
    }, [isReel, media.videoUrl, media.coverUrl, imageUrls, isCarousel, post.id])

    // ⚡ Publikovat hned: arm for immediate Graph publish, then poll until it lands.
    const publishNow = useCallback(async () => {
        setPubState("publishing")
        setPubMsg(null)
        const r = await publishNowAction(post.id)
        if (!mounted.current) return
        if (!r.success) {
            setPubState("failed")
            setPubMsg(r.error || "Publikace selhala.")
            return
        }
        // Armed for the next ig-publisher tick (≤60s). Poll until posted/failed.
        const deadline = Date.now() + 150000
        const tick = async () => {
            const s = await getPostPublishStatus(post.id)
            if (!mounted.current) return
            if (s?.status === "posted") {
                setPubState("posted")
                setPermalink(s.permalink)
            } else if (s?.status === "failed") {
                setPubState("failed")
                setPubMsg(s.error || "Publikace selhala.")
            } else if (Date.now() < deadline) {
                setTimeout(tick, 4000)
            } else {
                setPubState("idle")
                setPubMsg("Publikuje se na pozadí — za chvíli se objeví ve stavu Publikované.")
            }
        }
        setTimeout(tick, 4000)
    }, [post.id])

    const btnBase = "px-4 py-3 text-[10px] font-bold uppercase tracking-widest rounded-sm transition-all flex items-center justify-center gap-2 border"
    const btnGhost = `${btnBase} bg-[#0f0f0f] text-white/70 hover:bg-white/10 hover:text-white border-white/10`

    return createPortal(
        <div
            className="fixed inset-0 z-[10000] flex items-center justify-center p-3 sm:p-4"
            style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0 }}
            onClick={onClose}
        >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />

            {/* Content */}
            <div
                className="relative w-full sm:max-w-md max-h-[92vh] bg-[#0a0a0a] border border-white/10 rounded-sm overflow-hidden flex flex-col shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                    <h3 className="text-white font-black uppercase tracking-tighter text-sm flex items-center gap-2">
                        <span>📲</span> Publikovat na Instagram
                    </h3>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 rounded-sm transition-colors border border-transparent hover:border-white/10"
                    >
                        ✕
                    </button>
                </div>

                {/* Body — scrollable */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {/* Reel video preview */}
                    {isReel && media.videoUrl ? (
                        <div className="flex justify-center">
                            <ReelPlayer videoUrl={media.videoUrl} coverUrl={media.coverUrl} className="w-full max-w-[240px] aspect-[9/16] object-contain bg-black rounded-sm border border-white/10" />
                        </div>
                    ) : imageUrls.length > 0 ? (
                        <div className="flex flex-col items-center">
                            <div className="relative w-full bg-[#0f0f0f] rounded-sm border border-white/10 overflow-hidden">
                                <img
                                    src={imageUrls[idx] || imageUrls[0]}
                                    alt={isCarousel ? `Slide ${idx + 1}` : ""}
                                    className="w-full max-h-[44vh] object-contain mx-auto"
                                />
                                {isCarousel && (
                                    <span className="absolute top-2 right-2 bg-black/70 border border-white/20 text-white/80 text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-sm">
                                        {idx + 1}/{imageUrls.length}
                                    </span>
                                )}
                            </div>
                            {isCarousel && (
                                <div className="flex items-center gap-2 mt-3">
                                    {imageUrls.map((_, i) => (
                                        <button
                                            key={i}
                                            onClick={() => setIdx(i)}
                                            className={`w-2 h-2 rounded-full transition-all ${i === idx ? "bg-white scale-125" : "bg-white/30 hover:bg-white/50"}`}
                                            aria-label={`Slide ${i + 1}`}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="w-full h-40 rounded-sm bg-[#0f0f0f]/50 border border-white/5 flex flex-col items-center justify-center gap-2">
                            <span className="text-2xl opacity-50">🖼️</span>
                            <span className="text-white/40 font-bold uppercase tracking-widest text-[10px]">Bez obrázku</span>
                        </div>
                    )}

                    {/* ⚡ Publikovat hned — real Graph publish, no app (connected + image/carousel) */}
                    {canAutoPublish && (
                        pubState === "posted" ? (
                            <div className="w-full px-4 py-3.5 text-xs font-black uppercase tracking-widest rounded-sm bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center justify-center gap-2">
                                ✅ Publikováno!
                                {permalink && (
                                    <a href={permalink} target="_blank" rel="noopener noreferrer" className="underline hover:text-emerald-300 normal-case tracking-normal">otevřít ↗</a>
                                )}
                            </div>
                        ) : (
                            <button
                                onClick={publishNow}
                                disabled={pubState === "publishing"}
                                className="w-full px-4 py-3.5 text-xs font-black uppercase tracking-widest rounded-sm bg-gradient-to-r from-aisummit-cinnabar/30 to-orange-600/30 text-aisummit-cinnabar border border-aisummit-cinnabar/30 hover:from-aisummit-cinnabar/40 hover:to-orange-600/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {pubState === "publishing" ? "⏳ Publikuje se… (do minuty)" : "⚡ Publikovat hned"}
                            </button>
                        )
                    )}
                    {canAutoPublish && pubMsg && (
                        <p className={`text-[11px] text-center ${pubState === "failed" ? "text-red-400" : "text-white/50"}`}>{pubMsg}</p>
                    )}
                    {canAutoPublish && shareSupported && hasShareableMedia && pubState !== "posted" && (
                        <p className="text-[10px] text-white/25 text-center uppercase tracking-widest">nebo sdílej ručně</p>
                    )}

                    {/* Manual share CTA — phone only (Web Share files). Primary when not connected. */}
                    {shareSupported && hasShareableMedia && pubState !== "posted" && (
                        <button
                            onClick={shareToInstagram}
                            disabled={sharing}
                            className={`w-full px-4 py-3.5 text-xs font-black uppercase tracking-widest rounded-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${canAutoPublish ? "bg-[#0f0f0f] text-white/70 border border-white/10 hover:bg-white/10 hover:text-white" : "bg-gradient-to-r from-aisummit-cinnabar/30 to-orange-600/30 text-aisummit-cinnabar border border-aisummit-cinnabar/30 hover:from-aisummit-cinnabar/40 hover:to-orange-600/40"}`}
                        >
                            {sharing ? "⏳ Připravuji…" : shared ? "✅ Sdíleno — popisek je v schránce" : `📲 Sdílet ${isReel ? "reel" : "do Instagramu"}`}
                        </button>
                    )}

                    {/* Desktop hint — no file-share support (and can't publish-now) */}
                    {!shareSupported && !canAutoPublish && (
                        <div className="rounded-sm border border-white/10 bg-[#0f0f0f] p-3 text-center">
                            <p className="text-[11px] text-white/60 leading-relaxed">
                                📱 Pro přímé sdílení do Instagramu otevři tuto stránku <strong className="text-white/80">na telefonu</strong>.
                                Tady na počítači použij <strong className="text-white/80">Kopírovat popisek</strong> + <strong className="text-white/80">Uložit obrázek</strong>.
                            </p>
                        </div>
                    )}

                    {error && (
                        <p className="text-[11px] text-red-400 leading-relaxed text-center">{error}</p>
                    )}

                    {/* Caption — the paste source */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-bold text-white/50 uppercase tracking-widest">Popisek</span>
                            <button
                                onClick={() => copyToClipboard(fullText, "caption")}
                                className="text-[10px] font-bold uppercase tracking-widest text-aisummit-cinnabar hover:text-orange-400 transition-colors"
                            >
                                {copiedField === "caption" ? "✅ Zkopírováno!" : "📋 Kopírovat popisek"}
                            </button>
                        </div>
                        <div className="rounded-sm border border-white/10 bg-[#0f0f0f] p-3 max-h-40 overflow-y-auto">
                            <p className="text-xs text-white/70 leading-relaxed whitespace-pre-wrap select-text">
                                {fullText || "Bez textu"}
                            </p>
                        </div>
                    </div>

                    {/* Fallback actions */}
                    <div className="grid grid-cols-2 gap-2">
                        {hasShareableMedia && (
                            <button onClick={saveImages} className={btnGhost}>
                                ⬇️ {isReel ? "Stáhnout video" : isCarousel ? "Uložit slidy" : "Uložit obrázek"}
                            </button>
                        )}
                        <a
                            href="https://www.instagram.com/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`${btnGhost} ${hasShareableMedia ? "" : "col-span-2"}`}
                        >
                            ↗ Otevřít Instagram
                        </a>
                    </div>

                    {/* Micro-guide */}
                    <div className="rounded-sm border border-white/5 bg-white/[0.02] p-3">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-white/40 mb-2">Jak na to</p>
                        <ol className="text-[11px] text-white/55 leading-relaxed space-y-1 list-decimal list-inside">
                            <li>Klepni <strong className="text-white/75">Sdílet do Instagramu</strong> → vyber Instagram.</li>
                            <li>V Instagramu podrž pole popisku → <strong className="text-white/75">Vložit</strong>.</li>
                            <li>Publikuj a vrať se sem.</li>
                        </ol>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-4 py-3 bg-[#050505] border-t border-white/10 flex items-center justify-between gap-2">
                    <button onClick={onClose} className="text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white/70 transition-colors">
                        Zavřít
                    </button>
                    {post.status !== "posted" && (
                        <button
                            onClick={() => onMarkedPosted(post.id)}
                            className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-all border border-emerald-500/20"
                        >
                            ✓ Označit jako publikováno
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body
    )
}
