"use client"

import { useRef } from "react"

/**
 * Přehrávač reelu ve studiu. Do 9/2026 tu žádný nebyl — vygenerovaný reel se
 * ukazoval jen jako cover v `<img>` a MP4 šlo otevřít leda z holé URL.
 *
 * Dva režimy:
 *   - mřížka (`hoverPlay`): němé přehrání po najetí, poster = cover — karta
 *     zůstává klikatelná (otevře detail), video na sebe nebere kliknutí,
 *   - detail (`controls`): plné ovládání, zvuk zapnutý, kliknutí zůstává u videa.
 *
 * `preload="metadata"` schválně: mřížka s dvaceti reely nesmí stáhnout dvacet MP4.
 */
export function ReelPlayer({ videoUrl, coverUrl, controls = false, hoverPlay = false, className = "" }: {
    videoUrl: string
    coverUrl?: string
    controls?: boolean
    hoverPlay?: boolean
    className?: string
}) {
    const ref = useRef<HTMLVideoElement>(null)
    const play = () => { ref.current?.play().catch(() => { /* autoplay policy — tichý start může prohlížeč odmítnout */ }) }
    const stop = () => { const v = ref.current; if (!v) return; v.pause(); v.currentTime = 0 }

    return (
        <video
            ref={ref}
            playsInline
            preload="metadata"
            poster={coverUrl}
            muted={!controls}
            loop={hoverPlay}
            controls={controls}
            onMouseEnter={hoverPlay ? play : undefined}
            onMouseLeave={hoverPlay ? stop : undefined}
            onClick={controls ? (e) => e.stopPropagation() : undefined}
            className={`bg-black object-contain ${className}`}
        >
            <source src={videoUrl} type="video/mp4" />
        </video>
    )
}
