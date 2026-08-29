"use client"

/**
 * Detail příspěvku portfolia — obrázek/karusel/reel v plné velikosti a celý text.
 *
 * Vizuální jazyk je převzatý z lightboxu na landingu (`components/PostWall.tsx`),
 * aby web působil jako jedna věc. Ten ale umí jen jeden statický obrázek, takže
 * tady přibylo listování karuselu, video a navigace mezi příspěvky.
 *
 * Tři věci, které bez mobilu nedávají smysl a s ním jsou nutné:
 *
 *  1. `playsInline` na videu. Bez něj Safari na iPhonu vytrhne reel na celou
 *     obrazovku a uživatel vypadne z galerie.
 *  2. Zamknutý scroll `<body>`. Jinak se pod otevřeným detailem roluje stránka
 *     a po zavření je člověk jinde, než kde byl.
 *  3. Vrácení fokusu na dlaždici, ze které se otevíralo — jinak klávesnice
 *     i odečítač začínají zase od začátku stránky.
 *
 * Adresu (`#p=<id>`) řeší rodič, ne tenhle komponent: hash je vlastnost galerie,
 * ne jednoho otevřeného příspěvku.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { EASE_OUT } from "@/lib/motion"
import type { PortfolioPost } from "@/lib/portfolio-data"

const TYPE_LABEL: Record<PortfolioPost["mediaType"], string> = {
    reel: "Reel",
    carousel: "Karusel",
    post: "Příspěvek",
}

interface Props {
    post: PortfolioPost | null
    company: string
    /** Pořadí v aktuálně zobrazeném výběru — pro „x z y" a listování. */
    index: number
    total: number
    onClose: () => void
    onPrev: () => void
    onNext: () => void
}

export function PostModal({ post, company, index, total, onClose, onPrev, onNext }: Props) {
    const reduce = useReducedMotion()
    const stripRef = useRef<HTMLDivElement>(null)
    const [slide, setSlide] = useState(0)

    // Nový příspěvek začíná vždy prvním snímkem — jinak by si karusel pamatoval
    // pozici z předchozího a otevřel se „uprostřed".
    useEffect(() => {
        setSlide(0)
        stripRef.current?.scrollTo({ left: 0, behavior: "auto" })
    }, [post?.id])

    // Klávesy: Esc zavírá, šipky listují MEZI PŘÍSPĚVKY (ne mezi snímky) —
    // snímky se listují prstem nebo tečkami, protože karusel má vlastní scroll.
    useEffect(() => {
        if (!post) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose()
            else if (e.key === "ArrowLeft") onPrev()
            else if (e.key === "ArrowRight") onNext()
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [post, onClose, onPrev, onNext])

    // Zámek scrollu pod otevřeným detailem.
    useEffect(() => {
        if (!post) return
        const prev = document.body.style.overflow
        document.body.style.overflow = "hidden"
        return () => { document.body.style.overflow = prev }
    }, [post])

    /** Aktivní snímek se počítá z pozice scrollu — pruh je nativní, žádná knihovna. */
    const onScroll = useCallback(() => {
        const el = stripRef.current
        if (!el || el.clientWidth === 0) return
        setSlide(Math.round(el.scrollLeft / el.clientWidth))
    }, [])

    const goToSlide = (i: number) => {
        const el = stripRef.current
        if (!el) return
        el.scrollTo({ left: i * el.clientWidth, behavior: reduce ? "auto" : "smooth" })
    }

    return (
        <AnimatePresence>
            {post && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2, ease: EASE_OUT }}
                    className="fixed inset-0 z-[100] flex items-center justify-center sm:p-4 bg-black/80 backdrop-blur-sm"
                    onClick={onClose}
                >
                    <motion.div
                        role="dialog"
                        aria-modal="true"
                        aria-label={`${company}: ${post.hook}`}
                        initial={reduce ? false : { scale: 0.96, y: 16 }}
                        animate={{ scale: 1, y: 0 }}
                        exit={reduce ? undefined : { scale: 0.96, y: 16 }}
                        transition={{ duration: 0.25, ease: EASE_OUT }}
                        className="bg-[#0a0a0a] sm:border sm:border-white/10 sm:rounded-sm w-full sm:max-w-lg h-full sm:h-auto sm:max-h-[92vh] overflow-hidden flex flex-col"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Lišta — na mobilu jediná cesta ven, proto nahoře a s velkým cílem */}
                        <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-white/5">
                            <span className="text-[9px] font-bold uppercase tracking-widest text-white/40">
                                {TYPE_LABEL[post.mediaType]}
                            </span>
                            {post.mediaType === "reel" && (
                                <span className="px-2 py-0.5 bg-white/10 text-white/70 rounded-sm text-[8px] tracking-[0.2em]">
                                    BETA
                                </span>
                            )}
                            <span className="text-[9px] font-bold uppercase tracking-widest text-white/25 ml-auto tabular-nums">
                                {index + 1} / {total}
                            </span>
                            <button
                                onClick={onClose}
                                aria-label="Zavřít"
                                className="w-9 h-9 -mr-2 flex items-center justify-center text-white/40 hover:text-white transition-colors cursor-pointer"
                            >
                                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M18 6 6 18M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className="overflow-y-auto flex-1">
                            {/* ── Médium ── */}
                            <div className="bg-black relative">
                                {post.mediaType === "reel" && post.videoUrl ? (
                                    <video
                                        controls
                                        playsInline
                                        preload="none"
                                        poster={post.images[0]}
                                        className="w-full aspect-[9/16] max-h-[70vh] object-contain bg-black"
                                    >
                                        <source src={post.videoUrl} type="video/mp4" />
                                    </video>
                                ) : post.images.length > 1 ? (
                                    <>
                                        <div
                                            ref={stripRef}
                                            onScroll={onScroll}
                                            className="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide"
                                        >
                                            {post.images.map((src, i) => (
                                                <img
                                                    key={i}
                                                    src={src}
                                                    alt={`Snímek ${i + 1} z ${post.images.length}`}
                                                    loading={i === 0 ? "eager" : "lazy"}
                                                    className="w-full shrink-0 snap-start object-contain max-h-[70vh]"
                                                />
                                            ))}
                                        </div>
                                        {/* Tečky — zároveň ovládání, ne jen indikátor */}
                                        <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-1.5">
                                            {post.images.map((_, i) => (
                                                <button
                                                    key={i}
                                                    onClick={() => goToSlide(i)}
                                                    aria-label={`Snímek ${i + 1}`}
                                                    aria-current={i === slide}
                                                    className={`h-1.5 rounded-full transition-all cursor-pointer ${
                                                        i === slide ? "w-5 bg-white" : "w-1.5 bg-white/40 hover:bg-white/70"
                                                    }`}
                                                />
                                            ))}
                                        </div>
                                    </>
                                ) : (
                                    <img
                                        src={post.images[0]}
                                        alt={post.hook}
                                        className="w-full object-contain max-h-[70vh]"
                                    />
                                )}
                            </div>

                            {/* ── Text ── */}
                            <div className="p-5 space-y-4">
                                <h2 className="text-lg font-black text-white/90 leading-snug">{post.hook}</h2>

                                {post.body && (
                                    <p className="text-white/60 text-sm leading-relaxed whitespace-pre-wrap">{post.body}</p>
                                )}

                                {post.cta && (
                                    <div className="border-l-2 border-white/10 pl-4">
                                        <div className="text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1">
                                            Výzva k akci
                                        </div>
                                        <p className="text-white/70 text-sm leading-relaxed break-words">{post.cta}</p>
                                    </div>
                                )}

                                {post.hashtags.length > 0 && (
                                    <p className="text-white/50 text-xs leading-relaxed break-words">
                                        {post.hashtags.join(" ")}
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Listování mezi příspěvky — palcem dosažitelné, dole */}
                        <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-t border-white/5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                            <button
                                onClick={onPrev}
                                className="text-[10px] font-bold uppercase tracking-widest px-4 py-2.5 border border-white/5 hover:border-white/20 bg-[#0a0a0a] text-white/50 hover:text-white rounded-sm transition-colors cursor-pointer"
                            >
                                ← Předchozí
                            </button>
                            <button
                                onClick={onNext}
                                className="text-[10px] font-bold uppercase tracking-widest px-4 py-2.5 border border-white/5 hover:border-white/20 bg-[#0a0a0a] text-white/50 hover:text-white rounded-sm transition-colors cursor-pointer"
                            >
                                Další →
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
