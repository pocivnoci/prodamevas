"use client"

/**
 * PostWall — a full-width "wall of proof": two rows of REAL posts the Chrlit engine
 * already generated (lib/reference-data.ts), scrolling continuously in opposite
 * directions. Hover pauses a row; clicking any post opens it full-screen. Under
 * prefers-reduced-motion the rows don't auto-scroll but stay swipeable + clickable.
 */

import { useEffect, useState } from "react"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import { EASE_OUT } from "@/lib/motion"

export type WallPost = {
  imageUrl: string
  caption: string
  hashtags: string
  company: string
  emoji: string
  handle: string
}

function Card({ post, onOpen }: { post: WallPost; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      aria-label={`Zobrazit příspěvek — ${post.company}`}
      className="snap-start shrink-0 relative h-56 md:h-72 rounded-sm overflow-hidden border border-white/10 hover:border-white/30 transition-colors group/card bg-black/40 cursor-pointer"
    >
      <img
        src={post.imageUrl}
        alt={`Příspěvek vygenerovaný v Chrlit pro ${post.company}`}
        loading="lazy"
        draggable={false}
        className="h-full w-auto object-cover block"
      />
      {/* brand chip */}
      <div className="absolute inset-x-0 bottom-0 px-2.5 py-2 bg-gradient-to-t from-black/80 to-transparent flex items-center gap-1.5 pointer-events-none">
        <span className="text-sm leading-none">{post.emoji}</span>
        <span className="text-[9px] font-black uppercase tracking-widest text-white/85 truncate">{post.company}</span>
      </div>
      {/* hover scrim */}
      <div className="absolute inset-0 bg-black/0 group-hover/card:bg-black/40 transition-all flex items-center justify-center">
        <span className="opacity-0 group-hover/card:opacity-100 px-3 py-1.5 border border-white/30 rounded-sm backdrop-blur-sm text-white/90 text-[9px] font-black uppercase tracking-widest transition-all">
          Zobrazit
        </span>
      </div>
    </button>
  )
}

function Row({ posts, dir, reduce, onOpen }: { posts: WallPost[]; dir: "l" | "r"; reduce: boolean; onOpen: (p: WallPost) => void }) {
  if (reduce) {
    // No auto-scroll — a normal swipeable strip.
    return (
      <div className="flex gap-3 overflow-x-auto pb-1 snap-x [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {posts.map((p, i) => <Card key={i} post={p} onOpen={() => onOpen(p)} />)}
      </div>
    )
  }
  const dur = Math.max(28, posts.length * 7)
  // Content is duplicated; the keyframes translate by -50% (= exactly one set) for a seamless loop.
  return (
    <div className="overflow-hidden">
      <div
        className="flex gap-3 w-max hover:[animation-play-state:paused]"
        style={{ animation: `pw-${dir} ${dur}s linear infinite` }}
      >
        {[...posts, ...posts].map((p, i) => <Card key={i} post={p} onOpen={() => onOpen(p)} />)}
      </div>
    </div>
  )
}

export function PostWall({ posts }: { posts: WallPost[] }) {
  const reduce = useReducedMotion() ?? false
  const [selected, setSelected] = useState<WallPost | null>(null)

  // Esc closes the lightbox.
  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelected(null) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selected])

  if (posts.length === 0) return null

  // Split into two rows (alternating) so each row is varied across brands.
  const rowA = posts.filter((_, i) => i % 2 === 0)
  const rowB = posts.filter((_, i) => i % 2 === 1)

  return (
    <section id="reference" className="relative z-10 py-16 md:py-20 border-t border-white/5 bg-[#050505] overflow-hidden">
      {/* marquee keyframes (scoped) */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes pw-l { from { transform: translateX(0) } to { transform: translateX(-50%) } }
        @keyframes pw-r { from { transform: translateX(-50%) } to { transform: translateX(0) } }
      `}} />

      <div className="text-center mb-8 px-6">
        <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-white/20 mb-2">Náš vlastní Instagram · 100 % od Chrlit</p>
        <h2 className="text-2xl md:text-3xl font-black tracking-tighter text-white uppercase">
          Tohle si Chrlit vytvořil sám. <span className="text-aisummit-cinnabar">Klikni a prohlédni.</span>
        </h2>
      </div>

      <div className="space-y-3">
        <Row posts={rowA} dir="l" reduce={reduce} onOpen={setSelected} />
        <Row posts={rowB} dir="r" reduce={reduce} onOpen={setSelected} />
      </div>

      {/* Lightbox — full image + caption */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={() => setSelected(null)}
          >
            <motion.div
              initial={reduce ? false : { scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={reduce ? undefined : { scale: 0.95, y: 20 }}
              transition={{ duration: 0.25, ease: EASE_OUT }}
              className="bg-[#0a0a0a] border border-white/10 rounded-sm max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="shrink-0 bg-black flex items-center justify-center">
                <img src={selected.imageUrl} alt={selected.company} className="w-auto max-w-full max-h-[60vh] object-contain" />
              </div>
              <div className="p-5 overflow-y-auto">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-base">{selected.emoji}</span>
                  <span className="px-2 py-1 bg-white/5 border border-white/10 rounded-sm text-[9px] font-black uppercase tracking-widest text-white/70">{selected.company}</span>
                  <span className="text-white/20 text-[9px] ml-auto">Vygenerováno AI</span>
                </div>
                <p className="text-white/60 text-sm leading-relaxed whitespace-pre-line">{selected.caption}</p>
                {selected.hashtags && (
                  <p className="text-aisummit-cinnabar/50 text-[10px] font-bold mt-3">{selected.hashtags}</p>
                )}
              </div>
              <div className="px-5 py-3 border-t border-white/5 shrink-0">
                <button onClick={() => setSelected(null)} className="text-[9px] font-black uppercase tracking-widest text-white/30 hover:text-white transition-colors cursor-pointer">
                  ✕ Zavřít
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
