"use client"

/**
 * HeroPlayground — the 5-second "magic moment".
 *
 * The visitor picks a business (or just watches it auto-run on first view) and
 * sees a finished Instagram post APPEAR — image fades in, caption types itself
 * out. It SHOWS the value (a polished post) without ever explaining the how:
 * one neutral "working" beat, then the result. Pure front-end simulation — no
 * backend, no credits. Reuses the canned showcase posts derived from the real
 * reference brands.
 */

import { motion, AnimatePresence } from "framer-motion"
import { useState, useEffect, useRef, useCallback } from "react"
import { Cpu, ArrowDown, Sparkles } from "lucide-react"

export type PlaygroundPost = {
  src: string
  alt: string
  industry: string
  domain: string
  caption: string
  hashtags: string
}

type Stage = "idle" | "working" | "done"

export function HeroPlayground({ posts }: { posts: PlaygroundPost[] }) {
  const [active, setActive] = useState(0)
  const [stage, setStage] = useState<Stage>("idle")
  const [typed, setTyped] = useState("")
  const rootRef = useRef<HTMLDivElement>(null)
  const started = useRef(false)

  const post = posts[active] ?? posts[0]

  const run = useCallback((i: number) => {
    setActive(i)
    setTyped("")
    setStage("working")
  }, [])

  // Auto-run the first post when the section scrolls into view — it demonstrates
  // itself once, then invites clicks.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !started.current) {
          started.current = true
          run(0)
          obs.disconnect()
        }
      },
      { threshold: 0.4 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [run])

  // working → done
  useEffect(() => {
    if (stage !== "working") return
    const t = setTimeout(() => setStage("done"), 1900)
    return () => clearTimeout(t)
  }, [stage, active])

  // typewriter for the caption once done
  useEffect(() => {
    if (stage !== "done") return
    const full = post.caption
    let i = 0
    const id = setInterval(() => {
      i += 2
      setTyped(full.slice(0, i))
      if (i >= full.length) clearInterval(id)
    }, 16)
    return () => clearInterval(id)
  }, [stage, post.caption])

  const handle = post.domain.split(".")[0]

  return (
    <div ref={rootRef} className="relative w-full max-w-md mx-auto lg:max-w-none">

      {/* INPUT — the website bar */}
      <div className="bg-[#0a0a0a] border border-white/10 rounded-sm overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5 bg-white/[0.02]">
          <span className="w-2 h-2 rounded-full bg-white/10" />
          <span className="w-2 h-2 rounded-full bg-white/10" />
          <span className="w-2 h-2 rounded-full bg-white/10" />
          <AnimatePresence mode="wait">
            <motion.div
              key={post.domain}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="ml-2 flex-1 flex items-center gap-2 px-3 py-1 rounded-sm bg-black/40 border border-white/5"
            >
              <span className="text-emerald-400/60 text-[9px]">🔒</span>
              <span className="text-white/40 text-[10px] font-mono truncate">{post.domain}</span>
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="px-4 py-3 flex items-center justify-between">
          <span className="text-[8px] font-black uppercase tracking-[0.3em] text-white/25">Váš web</span>
          <span className="text-[8px] font-bold uppercase tracking-widest text-white/15">{post.industry}</span>
        </div>
      </div>

      {/* TRANSFORM — the Chrlit pulse */}
      <div className="flex flex-col items-center py-3 relative">
        <div className="absolute inset-x-0 top-0 h-full w-px bg-gradient-to-b from-white/10 to-aisummit-cinnabar/30 left-1/2 -translate-x-1/2" />
        <motion.div
          className="relative z-10 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-aisummit-cinnabar/10 border border-aisummit-cinnabar/30 backdrop-blur-sm"
          animate={stage === "working" ? { scale: [1, 1.06, 1] } : { y: [0, 4, 0] }}
          transition={{ duration: stage === "working" ? 0.9 : 2, repeat: Infinity, ease: "easeInOut" }}
        >
          <Cpu className="w-3 h-3 text-aisummit-cinnabar" />
          <span className="text-[9px] font-black uppercase tracking-widest text-aisummit-cinnabar">
            {stage === "working" ? "Chrlit tvoří…" : "Chrlit"}
          </span>
          {stage !== "working" && <ArrowDown className="w-3 h-3 text-aisummit-cinnabar" />}
        </motion.div>
      </div>

      {/* OUTPUT — the finished post */}
      <div className="bg-[#0a0a0a] border-2 border-aisummit-cinnabar/30 rounded-sm overflow-hidden shadow-[0_0_60px_rgba(230,57,70,0.12)]">
        {/* IG header */}
        <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-white/5">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-aisummit-cinnabar to-amber-500 flex items-center justify-center">
            <img src="/chrlit-icon.png" alt="" className="w-4 h-4 object-contain" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="block text-white/80 text-[11px] font-bold truncate">{handle}</span>
            <span className="block text-white/30 text-[8px] uppercase tracking-widest">Sponzorováno</span>
          </div>
          <span className="text-white/20 text-lg leading-none">···</span>
        </div>

        {/* image area — skeleton while working, real image when done */}
        <div className="relative aspect-square bg-black/40">
          <AnimatePresence mode="wait">
            {stage === "done" ? (
              <motion.img
                key={post.src}
                src={post.src}
                alt={post.alt}
                initial={{ opacity: 0, scale: 1.04 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <motion.div
                key="skeleton"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex flex-col items-center justify-center gap-3"
              >
                {/* shimmer */}
                {stage === "working" && (
                  <motion.div
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-aisummit-cinnabar/10 to-transparent"
                    animate={{ x: ["-100%", "100%"] }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                  />
                )}
                <Sparkles className={`w-6 h-6 ${stage === "working" ? "text-aisummit-cinnabar animate-pulse" : "text-white/15"}`} />
                <span className="text-[9px] font-black uppercase tracking-[0.3em] text-white/25 px-6 text-center">
                  {stage === "working" ? "Tvořím váš příspěvek" : "Vyberte obor a sledujte"}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
          {stage === "done" && (
            <span className="absolute top-3 right-3 z-10 px-2 py-1 bg-black/70 backdrop-blur-sm border border-white/10 rounded-sm text-[8px] font-black uppercase tracking-widest text-white/80">
              Vygenerováno AI
            </span>
          )}
        </div>

        {/* caption */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-4 mb-2 text-white/40">
            <span className="text-sm">♥</span>
            <span className="text-sm">💬</span>
            <span className="text-sm">➤</span>
          </div>
          <p className="text-white/55 text-[11px] leading-relaxed min-h-[3.4rem] line-clamp-3">
            {stage === "done" ? (
              <>
                <span className="text-white/80 font-bold">{handle}</span> {typed}
                {typed.length < post.caption.length && (
                  <span className="inline-block w-1.5 h-3 -mb-0.5 ml-0.5 bg-aisummit-cinnabar animate-pulse" />
                )}
              </>
            ) : (
              <span className="text-white/20">{stage === "working" ? "Píšu text ve vašem stylu…" : "Text příspěvku se objeví tady."}</span>
            )}
          </p>
          <AnimatePresence>
            {stage === "done" && typed.length >= post.caption.length && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-aisummit-cinnabar/50 text-[9px] font-bold mt-1.5 line-clamp-1"
              >
                {post.hashtags}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* SAMPLE CHIPS — the clicking */}
      <div className="mt-5">
        <p className="text-center text-[8px] font-black uppercase tracking-[0.3em] text-white/20 mb-1">
          Klikněte na obor — ukázka hotového příspěvku
        </p>
        <p className="text-center text-[8px] font-medium tracking-wide text-white/15 mb-3 normal-case">
          Skutečné výstupy. Tvorba zabere pár minut práce stroje — ne váš večer.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {posts.map((p, i) => (
            <button
              key={i}
              onClick={() => run(i)}
              aria-label={`Ukázka: ${p.industry}`}
              className={`px-3 py-1.5 rounded-sm border text-[10px] font-bold tracking-wide transition-all ${
                i === active
                  ? "border-aisummit-cinnabar/50 bg-aisummit-cinnabar/10 text-white"
                  : "border-white/10 bg-white/[0.02] text-white/40 hover:text-white hover:border-white/30"
              }`}
            >
              {p.industry}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
