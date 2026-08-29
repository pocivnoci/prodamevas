"use client"

/**
 * Mřížka příspěvků ve stylu instagramového profilu.
 *
 * Proč mřížka a ne výpis: prospekt si nekupuje texty, kupuje si vzhled feedu.
 * Svislý výpis dvaceti příspěvků v plné velikosti mu ho neukáže — ukáže mu
 * dvacet obrazovek scrollu. Mřížka ho ukáže na první.
 *
 * Dlaždice sdílí třídy s `tabs/FeedTab.tsx`, aby aplikace a web vypadaly jako
 * jedna věc. Celý příspěvek se otevře v `PostModal`.
 *
 * **Hash v adrese je tu kvůli mobilu.** Otevřený příspěvek zapíše `#p=<id>`,
 * takže systémové tlačítko zpět (a swipe na iOS) ho zavře místo toho, aby
 * odešlo ze stránky — bez toho je galerie na telefonu past. Bonusem jde poslat
 * odkaz na konkrétní příspěvek.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { PortfolioPost } from "@/lib/portfolio-data"
import { PostModal } from "./PostModal"

type Filter = "all" | "post" | "carousel" | "reel"

const FILTERS: { id: Filter; label: string }[] = [
    { id: "all", label: "Vše" },
    { id: "post", label: "Příspěvky" },
    { id: "carousel", label: "Karusely" },
    { id: "reel", label: "Reely" },
]

/** Vrstvené čtverce — stejný signál, jaký má karusel na Instagramu. */
function CarouselIcon() {
    return (
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="8" y="3" width="13" height="13" rx="2" />
            <path d="M3 8v11a2 2 0 0 0 2 2h11" />
        </svg>
    )
}

function ReelIcon() {
    return (
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
            <path d="M8 5v14l11-7z" />
        </svg>
    )
}

export function PostGrid({ posts, company }: { posts: PortfolioPost[]; company: string }) {
    const [filter, setFilter] = useState<Filter>("all")
    const [openId, setOpenId] = useState<string | null>(null)
    /** Dlaždice, ze které se otevíralo — fokus se na ni po zavření vrátí. */
    const triggerRef = useRef<HTMLButtonElement | null>(null)
    /** Zapsali jsme hash my? Když ne (přišlo se přímým odkazem), zpět by odešlo z webu. */
    const pushedRef = useRef(false)

    const shown = useMemo(
        () => (filter === "all" ? posts : posts.filter(p => p.mediaType === filter)),
        [posts, filter]
    )

    const counts = useMemo(() => ({
        all: posts.length,
        post: posts.filter(p => p.mediaType === "post").length,
        carousel: posts.filter(p => p.mediaType === "carousel").length,
        reel: posts.filter(p => p.mediaType === "reel").length,
    }), [posts])

    // Přímý odkaz `#p=<id>` i tlačítko zpět. Jeden zdroj pravdy: hash.
    useEffect(() => {
        const sync = () => {
            const m = window.location.hash.match(/^#p=(.+)$/)
            setOpenId(m ? decodeURIComponent(m[1]) : null)
        }
        sync()
        window.addEventListener("popstate", sync)
        window.addEventListener("hashchange", sync)
        return () => {
            window.removeEventListener("popstate", sync)
            window.removeEventListener("hashchange", sync)
        }
    }, [])

    const open = (post: PortfolioPost, el: HTMLButtonElement) => {
        triggerRef.current = el
        pushedRef.current = true
        window.history.pushState(null, "", `#p=${encodeURIComponent(post.id)}`)
        setOpenId(post.id)
    }

    const close = useCallback(() => {
        if (pushedRef.current) {
            pushedRef.current = false
            window.history.back()   // popstate hash smaže a `sync` zavře
        } else {
            // Přišlo se přímým odkazem — zpět by odvedlo pryč z webu.
            window.history.replaceState(null, "", window.location.pathname)
            setOpenId(null)
        }
        triggerRef.current?.focus()
    }, [])

    const openIndex = shown.findIndex(p => p.id === openId)
    const openPost = openIndex >= 0 ? shown[openIndex] : null

    // Když filtr vyřadí právě otevřený příspěvek, nemá smysl ho držet otevřený.
    useEffect(() => {
        if (openId && openIndex === -1) close()
    }, [openId, openIndex, close])

    const step = (delta: number) => {
        if (openIndex < 0 || shown.length === 0) return
        const next = shown[(openIndex + delta + shown.length) % shown.length]
        window.history.replaceState(null, "", `#p=${encodeURIComponent(next.id)}`)
        setOpenId(next.id)
    }

    return (
        <div>
            {/* Přepínač formátů — u dvaceti příspěvků na značku je to potřeba */}
            <div className="flex flex-wrap gap-2 mb-4">
                {FILTERS.filter(f => f.id === "all" || counts[f.id] > 0).map(f => (
                    <button
                        key={f.id}
                        onClick={() => setFilter(f.id)}
                        aria-pressed={filter === f.id}
                        className={`text-[10px] font-bold uppercase tracking-widest px-4 py-2.5 rounded-sm border transition-colors cursor-pointer ${
                            filter === f.id
                                ? "bg-aisummit-cinnabar/20 text-aisummit-cinnabar border-aisummit-cinnabar/30"
                                : "border-white/5 hover:border-white/20 bg-[#0a0a0a] text-white/50 hover:text-white"
                        }`}
                    >
                        {f.label} <span className="tabular-nums opacity-60">{counts[f.id]}</span>
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-3 gap-px bg-white/5">
                {shown.map(post => (
                    <button
                        key={post.id}
                        onClick={e => open(post, e.currentTarget)}
                        aria-label={`Otevřít příspěvek: ${post.hook}`}
                        className="relative aspect-square overflow-hidden group cursor-pointer bg-[#0a0a0a] focus-visible:outline-2 focus-visible:outline-aisummit-cinnabar focus-visible:outline-offset-[-2px]"
                    >
                        {/* Jeden reel obálku nemá — render ji občas nevyrobí. Přehrát
                            se dá pořád, takže se nezahazuje; jen dostane placeholder
                            místo rozbitého obrázku. */}
                        {post.images[0] ? (
                            <img
                                src={post.images[0]}
                                alt=""
                                loading="lazy"
                                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center bg-white/[0.03] text-white/25">
                                <ReelIcon />
                            </div>
                        )}

                        {/* Rohový odznak formátu — jako na Instagramu */}
                        {post.mediaType === "carousel" && (
                            <div className="absolute top-1.5 right-1.5 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">
                                <CarouselIcon />
                            </div>
                        )}
                        {post.mediaType === "reel" && (
                            <div className="absolute top-1.5 right-1.5 flex items-center gap-1 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">
                                <span className="text-[7px] font-black tracking-[0.15em] bg-black/50 px-1 py-0.5 rounded-sm">
                                    BETA
                                </span>
                                <ReelIcon />
                            </div>
                        )}

                        {/* Scrim s hookem — na dotyk se neukáže, proto jen doplněk pro myš */}
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                            <span className="text-white text-[10px] font-bold leading-tight line-clamp-3 text-left">
                                {post.hook}
                            </span>
                        </div>
                    </button>
                ))}
            </div>

            <PostModal
                post={openPost}
                company={company}
                index={openIndex < 0 ? 0 : openIndex}
                total={shown.length}
                onClose={close}
                onPrev={() => step(-1)}
                onNext={() => step(1)}
            />
        </div>
    )
}
