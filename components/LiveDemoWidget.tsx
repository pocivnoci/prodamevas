"use client"

import { motion, AnimatePresence } from "framer-motion"
import { useState, useEffect, useRef } from "react"

/* ─── Pipeline stages shown as orbiting nodes ─── */
const STAGES = [
  { icon: "🌐", label: "Sken webu", color: "#3b82f6" },
  { icon: "🎨", label: "Barvy & styl", color: "#f59e0b" },
  { icon: "🧠", label: "Brand DNA", color: "#8b5cf6" },
  { icon: "✍️", label: "Copywriting", color: "#10b981" },
  { icon: "🖼️", label: "Vizuál", color: "#ec4899" },
  { icon: "📦", label: "Hotový post", color: "#e63946" },
]

const DEMO_URL = "kavarna-u-mlyna.cz"

const DEMO_RESULT = {
  colors: ["#2C1810", "#D4A574", "#F5E6D3"],
  caption: "☕ Každé ráno začíná rituálem. Tím naším je perfektní espresso z čerstvě pražených zrn — a ten tvůj? Přijď si pro svůj šálek do Kavárny u Mlýna.",
  hashtags: "#kavarna #espresso #rannikava #coffeelovers #kavarnaUmlyna",
  brand: "Kavárna u Mlýna",
}

export function LiveDemoWidget() {
  const [phase, setPhase] = useState<"idle" | "typing" | "scanning" | "done">("idle")
  const [typedUrl, setTypedUrl] = useState("")
  const [activeStage, setActiveStage] = useState(-1)
  const [typedCaption, setTypedCaption] = useState("")
  const [showResult, setShowResult] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const cx = 180, cy = 180, orbitR = 120, nodeR = 24

  const start = () => {
    if (phase !== "idle") return
    setPhase("typing")
    setTypedUrl("")
    setActiveStage(-1)
    setTypedCaption("")
    setShowResult(false)
  }

  // Phase 1: Auto-type URL
  useEffect(() => {
    if (phase !== "typing") return
    let i = 0
    const interval = setInterval(() => {
      setTypedUrl(DEMO_URL.slice(0, i + 1))
      i++
      if (i >= DEMO_URL.length) {
        clearInterval(interval)
        setTimeout(() => setPhase("scanning"), 400)
      }
    }, 60)
    return () => clearInterval(interval)
  }, [phase])

  // Phase 2: Pipeline stages
  useEffect(() => {
    if (phase !== "scanning") return
    setActiveStage(0)
    const timers: NodeJS.Timeout[] = []
    for (let i = 1; i < STAGES.length; i++) {
      timers.push(setTimeout(() => setActiveStage(i), i * 1200))
    }
    timers.push(setTimeout(() => {
      setShowResult(true)
      setPhase("done")
    }, STAGES.length * 1200 + 400))
    return () => timers.forEach(clearTimeout)
  }, [phase])

  // Phase 3: Type caption
  useEffect(() => {
    if (!showResult) return
    let i = 0
    const interval = setInterval(() => {
      setTypedCaption(DEMO_RESULT.caption.slice(0, i + 1))
      i++
      if (i >= DEMO_RESULT.caption.length) clearInterval(interval)
    }, 15)
    return () => clearInterval(interval)
  }, [showResult])

  const reset = () => {
    setPhase("idle")
    setTypedUrl("")
    setActiveStage(-1)
    setTypedCaption("")
    setShowResult(false)
  }

  return (
    <div ref={containerRef} className="flex flex-col items-center gap-8 max-w-4xl mx-auto">

      {/* Start button or URL display */}
      <div className="w-full max-w-md">
        {phase === "idle" ? (
          <motion.button
            onClick={start}
            className="w-full py-4 px-8 bg-aisummit-cinnabar text-white font-black text-sm uppercase tracking-widest rounded-sm hover:bg-aisummit-cinnabar/90 transition-all shadow-[0_0_30px_rgba(230,57,70,0.3)] flex items-center justify-center gap-3"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <span>▶</span> Spustit ukázku
          </motion.button>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-[#111] border border-white/10 rounded-sm px-5 py-3.5 flex items-center gap-3"
          >
            <span className="text-white/30 text-xs font-mono">https://</span>
            <span className="text-white font-mono text-sm font-bold">{typedUrl}</span>
            {phase === "typing" && (
              <span className="inline-block w-0.5 h-4 bg-aisummit-cinnabar animate-pulse" />
            )}
          </motion.div>
        )}
      </div>

      {/* Pipeline visualization */}
      <AnimatePresence>
        {(phase === "scanning" || phase === "done") && !showResult && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.5 }}
            className="relative"
          >
            <div className="relative w-[300px] h-[300px] md:w-[380px] md:h-[380px]">
              <svg viewBox="0 0 360 360" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <radialGradient id="demo-glow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#e63946" stopOpacity="0.12" />
                    <stop offset="100%" stopColor="#e63946" stopOpacity="0" />
                  </radialGradient>
                  <filter id="demo-filter">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                </defs>

                {/* Background glow */}
                <circle cx={cx} cy={cy} r="160" fill="url(#demo-glow)" />

                {/* Orbit ring */}
                <motion.circle
                  cx={cx} cy={cy} r={orbitR}
                  fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="4 8"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
                  style={{ transformOrigin: `${cx}px ${cy}px` }}
                />

                {/* Connection lines from center to active nodes */}
                {STAGES.map((stage, i) => {
                  const angle = (i * 60 - 90) * Math.PI / 180
                  const nx = cx + orbitR * Math.cos(angle)
                  const ny = cy + orbitR * Math.sin(angle)
                  return activeStage >= i ? (
                    <motion.line
                      key={`line-${i}`}
                      x1={cx} y1={cy} x2={nx} y2={ny}
                      stroke={stage.color} strokeWidth="1" strokeOpacity="0.3"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.5 }}
                    />
                  ) : null
                })}

                {/* Center node */}
                <motion.circle
                  cx={cx} cy={cy} r="20"
                  fill="rgba(230,57,70,0.15)" stroke="#e63946" strokeWidth="2"
                  animate={{ scale: [1, 1.05, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  style={{ transformOrigin: `${cx}px ${cy}px` }}
                />
                <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
                  fill="#e63946" fontSize="10" fontWeight="900" letterSpacing="0.05em"
                  style={{ fontFamily: "inherit" }}
                >AI</text>

                {/* Stage nodes */}
                {STAGES.map((stage, i) => {
                  const angle = (i * 60 - 90) * Math.PI / 180
                  const nx = cx + orbitR * Math.cos(angle)
                  const ny = cy + orbitR * Math.sin(angle)
                  const isActive = activeStage >= i
                  const isCurrent = activeStage === i

                  return (
                    <g key={i}>
                      {isActive && (
                        <>
                          <motion.circle
                            cx={nx} cy={ny} r={nodeR}
                            fill={isCurrent ? `${stage.color}22` : `${stage.color}11`}
                            stroke={stage.color}
                            strokeWidth={isCurrent ? 2 : 1}
                            filter={isCurrent ? "url(#demo-filter)" : undefined}
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ duration: 0.4, type: "spring" }}
                            style={{ transformOrigin: `${nx}px ${ny}px` }}
                          />
                          {isCurrent && (
                            <motion.circle
                              cx={nx} cy={ny} r={nodeR}
                              fill="none" stroke={stage.color} strokeWidth="1"
                              initial={{ scale: 1, opacity: 0.5 }}
                              animate={{ scale: 1.6, opacity: 0 }}
                              transition={{ duration: 1.5, repeat: Infinity }}
                              style={{ transformOrigin: `${nx}px ${ny}px` }}
                            />
                          )}
                          <text x={nx} y={ny + 1} textAnchor="middle" dominantBaseline="middle"
                            fontSize="14"
                          >{stage.icon}</text>
                        </>
                      )}
                      {!isActive && (
                        <circle cx={nx} cy={ny} r={nodeR}
                          fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="3 3"
                        />
                      )}
                    </g>
                  )
                })}
              </svg>
            </div>

            {/* Current stage label */}
            <div className="absolute bottom-0 left-0 right-0 text-center">
              <AnimatePresence mode="wait">
                {activeStage >= 0 && (
                  <motion.div
                    key={activeStage}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="flex items-center justify-center gap-2"
                  >
                    <span className="text-base">{STAGES[activeStage].icon}</span>
                    <span className="text-xs font-black uppercase tracking-widest" style={{ color: STAGES[activeStage].color }}>
                      {STAGES[activeStage].label}
                    </span>
                    <div className="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: `${STAGES[activeStage].color} transparent ${STAGES[activeStage].color} ${STAGES[activeStage].color}` }} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Result card */}
      <AnimatePresence>
        {showResult && (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, type: "spring" }}
            className="w-full max-w-lg bg-[#0a0a0a] border border-white/10 rounded-sm overflow-hidden"
          >
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 bg-aisummit-cinnabar/20 rounded-sm flex items-center justify-center text-aisummit-cinnabar text-[10px] font-black">AI</div>
                <div>
                  <div className="text-white text-xs font-black">{DEMO_RESULT.brand}</div>
                  <div className="text-white/25 text-[8px] font-bold uppercase tracking-widest">Vygenerovaný post</div>
                </div>
              </div>
              <div className="flex gap-1.5">
                {DEMO_RESULT.colors.map((c, i) => (
                  <motion.div
                    key={i}
                    className="w-4 h-4 rounded-full border border-white/10"
                    style={{ background: c }}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.2 + i * 0.1 }}
                  />
                ))}
              </div>
            </div>

            {/* Caption with typing */}
            <div className="px-5 py-4">
              <p className="text-white/60 text-sm leading-relaxed min-h-[3.5rem]">
                {typedCaption}
                {typedCaption.length < DEMO_RESULT.caption.length && (
                  <span className="inline-block w-0.5 h-4 bg-aisummit-cinnabar ml-0.5 animate-pulse" />
                )}
              </p>
              {typedCaption.length >= DEMO_RESULT.caption.length && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-aisummit-cinnabar/40 text-[10px] font-bold mt-2"
                >{DEMO_RESULT.hashtags}</motion.p>
              )}
            </div>

            {/* Bottom bar */}
            <div className="px-5 py-3 border-t border-white/5 bg-white/[0.02] flex items-center justify-between">
              <a href="/register" className="text-[10px] font-black uppercase tracking-widest text-aisummit-cinnabar hover:text-white transition-colors">
                Chci tohle pro svou firmu →
              </a>
              <button onClick={reset} className="text-[9px] font-bold uppercase tracking-widest text-white/20 hover:text-white/50 transition-colors">
                Spustit znovu
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
