"use client"

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { Maximize2, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react"

/**
 * Přehrávač reelu ve studiu. Do 9/2026 tu žádný nebyl — vygenerovaný reel se
 * ukazoval jen jako cover v `<img>` a MP4 šlo otevřít leda z holé URL.
 *
 * Dva režimy:
 *   - mřížka (`hoverPlay`): němé přehrání po najetí, poster = cover — karta
 *     zůstává klikatelná (otevře detail), video na sebe nebere kliknutí,
 *   - detail (`controls`): VLASTNÍ ovládání jako na Instagramu — klepnutí do videa
 *     přehraje/zastaví, zvuk vpravo nahoře, tenký posuvník dole, celá obrazovka.
 *     Nativní `controls` prohlížeče vypadaly na PC i mobilu cize (každý systém
 *     jinak) a na mobilu překrývaly spodní část obrazu.
 *
 * V detailu se video sází do obalu s poměrem 9:16 (`className` patří obalu), takže
 * ho prohlížeč nikdy neořízne ani neobalí černými pruhy: cover (poster) totiž
 * Chrome kreslí bez `object-fit` a v širokém boxu ho usekl.
 *
 * `preload="metadata"` schválně: mřížka s dvaceti reely nesmí stáhnout dvacet MP4.
 */
export function ReelPlayer({ videoUrl, coverUrl, controls = false, hoverPlay = false, autoPlay = controls, className = "" }: {
    videoUrl: string
    coverUrl?: string
    controls?: boolean
    hoverPlay?: boolean
    /** Detail: rozjet hned po otevření (se zvukem, když to prohlížeč pustí — kliknutí na kartu je gesto; jinak potichu). */
    autoPlay?: boolean
    className?: string
}) {
    const ref = useRef<HTMLVideoElement>(null)
    const [playing, setPlaying] = useState(false)
    const [ended, setEnded] = useState(false)
    const [muted, setMuted] = useState(!controls)
    const [current, setCurrent] = useState(0)
    const [duration, setDuration] = useState(0)

    const play = useCallback(() => { ref.current?.play().catch(() => { /* autoplay policy — tichý start může prohlížeč odmítnout */ }) }, [])
    const stop = useCallback(() => { const v = ref.current; if (!v) return; v.pause(); v.currentTime = 0 }, [])

    useEffect(() => {
        if (!controls || !autoPlay) return
        const v = ref.current
        if (!v) return
        v.muted = false
        v.play()
            .then(() => setMuted(false))
            .catch(() => {
                v.muted = true
                setMuted(true)
                v.play().catch(() => { /* ani potichu — zůstane tlačítko Přehrát */ })
            })
    }, [controls, autoPlay, videoUrl])

    if (!controls) {
        return (
            <video
                ref={ref}
                playsInline
                preload="metadata"
                poster={coverUrl}
                muted
                loop={hoverPlay}
                onMouseEnter={hoverPlay ? play : undefined}
                onMouseLeave={hoverPlay ? stop : undefined}
                className={`bg-black object-contain ${className}`}
            >
                <source src={videoUrl} type="video/mp4" />
            </video>
        )
    }

    const toggle = () => {
        const v = ref.current
        if (!v) return
        if (v.paused || v.ended) {
            if (v.ended) v.currentTime = 0
            v.play().catch(() => { /* prohlížeč přehrání odmítl — tlačítko zůstává */ })
        } else {
            v.pause()
        }
    }
    const toggleMute = () => {
        const v = ref.current
        if (!v) return
        v.muted = !v.muted
        setMuted(v.muted)
    }
    const seekAt = (clientX: number, track: HTMLElement) => {
        const v = ref.current
        if (!v || !duration) return
        const rect = track.getBoundingClientRect()
        const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
        v.currentTime = ratio * duration
        setCurrent(v.currentTime)
    }
    const onTrackDown = (e: ReactPointerEvent<HTMLDivElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        seekAt(e.clientX, e.currentTarget)
    }
    const onTrackMove = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (e.buttons & 1) seekAt(e.clientX, e.currentTarget)
    }
    const fullscreen = () => {
        const v = ref.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
        if (!v) return
        if (typeof v.requestFullscreen === "function") v.requestFullscreen().catch(() => { /* bez celé obrazovky se dá žít */ })
        else if (typeof v.webkitEnterFullscreen === "function") v.webkitEnterFullscreen()
    }
    const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`
    const pct = duration ? Math.min(100, (current / duration) * 100) : 0

    return (
        <div className={`relative overflow-hidden bg-black select-none ${className}`} onClick={(e) => e.stopPropagation()}>
            <video
                ref={ref}
                playsInline
                preload="metadata"
                poster={coverUrl}
                onClick={toggle}
                onPlay={() => { setPlaying(true); setEnded(false) }}
                onPause={() => setPlaying(false)}
                onEnded={() => { setPlaying(false); setEnded(true) }}
                onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
                onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
                onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
                className="w-full h-full object-contain cursor-pointer"
            >
                <source src={videoUrl} type="video/mp4" />
            </video>

            {/* Velké tlačítko uprostřed — jen když video stojí. */}
            {!playing && (
                <button
                    type="button"
                    onClick={toggle}
                    aria-label={ended ? "Přehrát znovu" : "Přehrát"}
                    className="absolute inset-0 flex items-center justify-center"
                >
                    <span className="w-16 h-16 rounded-full bg-black/55 border border-white/20 backdrop-blur-sm flex items-center justify-center text-white">
                        {ended ? <RotateCcw className="w-6 h-6" /> : <Play className="w-7 h-7 ml-1" fill="currentColor" />}
                    </span>
                </button>
            )}

            {/* Zvuk — vpravo nahoře jako na Instagramu. */}
            <button
                type="button"
                onClick={toggleMute}
                aria-label={muted ? "Zapnout zvuk" : "Vypnout zvuk"}
                title={muted ? "Zapnout zvuk" : "Vypnout zvuk"}
                className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/55 border border-white/15 backdrop-blur-sm flex items-center justify-center text-white/90 hover:bg-black/75 transition-colors"
            >
                {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>

            {/* Spodní lišta: přehrát, čas, posuvník, celá obrazovka. */}
            <div className="absolute inset-x-0 bottom-0 px-3 pb-2.5 pt-10 bg-gradient-to-t from-black/75 via-black/25 to-transparent flex items-center gap-2.5">
                <button type="button" onClick={toggle} aria-label={playing ? "Pozastavit" : "Přehrát"} className="w-8 h-8 flex items-center justify-center text-white/90 hover:text-white">
                    {playing ? <Pause className="w-4 h-4" fill="currentColor" /> : <Play className="w-4 h-4" fill="currentColor" />}
                </button>
                <span className="text-[10px] font-mono text-white/70 tabular-nums whitespace-nowrap">{fmt(current)} / {fmt(duration)}</span>
                <div
                    role="slider"
                    aria-label="Pozice ve videu"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(pct)}
                    onPointerDown={onTrackDown}
                    onPointerMove={onTrackMove}
                    className="relative flex-1 h-8 flex items-center cursor-pointer touch-none"
                >
                    <div className="w-full h-1 rounded-full bg-white/25">
                        <div className="h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
                    </div>
                </div>
                <button type="button" onClick={fullscreen} aria-label="Celá obrazovka" title="Celá obrazovka" className="w-8 h-8 flex items-center justify-center text-white/80 hover:text-white">
                    <Maximize2 className="w-4 h-4" />
                </button>
            </div>
        </div>
    )
}
