"use client"

import { motion, AnimatePresence } from "framer-motion"
import { useState, useEffect, useRef } from "react"

/* ─── The full Chrlit pipeline — not just "make a post" ─── */
const PIPELINE = [
  {
    icon: "🌐",
    label: "Analýza značky",
    detail: "AI naskenuje váš web, rozpozná barvy, tón komunikace, produkty a cílovou skupinu. Žádné formuláře.",
    color: "#3b82f6",
    duration: 2800,
  },
  {
    icon: "🧬",
    label: "Brand DNA",
    detail: "Ze stovek datových bodů vznikne unikátní profil vaší značky — váš digitální otisk, který AI používá jako základ pro vše.",
    color: "#8b5cf6",
    duration: 2400,
  },
  {
    icon: "🎯",
    label: "Cílení na publikum",
    detail: "Systém vytvoří 3 persony vašich zákazníků — začátečníky, zvažující i připravené k nákupu. Každý post cílí na konkrétní skupinu.",
    color: "#f59e0b",
    duration: 2600,
  },
  {
    icon: "✍️",
    label: "Tvorba obsahu",
    detail: "Captiony, obrázky, hashtagy, CTA — vše v jednom. Ne generický AI výstup, ale obsah psaný vaším hlasem pro vaše lidi.",
    color: "#10b981",
    duration: 2200,
  },
  {
    icon: "📊",
    label: "Měření dosahu",
    detail: "Každý příspěvek se sleduje — liky, komentáře, sdílení, uložení. Data tečou zpět do systému jako palivo pro učení.",
    color: "#ec4899",
    duration: 2400,
  },
  {
    icon: "🧠",
    label: "Učení & adaptace",
    detail: "Neural Brand Engine rozpozná vítězné vzorce. Co funguje, zesílí. Co nefunguje, opustí. Každý cyklus = lepší výsledky.",
    color: "#e63946",
    duration: 3000,
  },
]

const RESULTS = [
  { word: "DOSAH", sub: "Víc lidí vidí váš obsah" },
  { word: "RŮST", sub: "Organický růst sledujících" },
  { word: "PRODEJ", sub: "Obsah, který konvertuje" },
  { word: "ÚSPORA", sub: "Hodiny času každý týden" },
]

export function LiveDemoWidget() {
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle")
  const [activeStage, setActiveStage] = useState(-1)
  const [resultIndex, setResultIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const cx = 200, cy = 200, orbitR = 130, nodeR = 28

  const start = () => {
    if (phase !== "idle") return
    setPhase("running")
    setActiveStage(-1)
    setResultIndex(0)
  }

  // Pipeline stages — sequential, slow
  useEffect(() => {
    if (phase !== "running") return
    let step = 0
    let totalDelay = 600

    const timers: NodeJS.Timeout[] = []

    for (let i = 0; i < PIPELINE.length; i++) {
      timers.push(setTimeout(() => setActiveStage(i), totalDelay))
      totalDelay += PIPELINE[i].duration
    }

    timers.push(setTimeout(() => setPhase("done"), totalDelay + 600))

    return () => timers.forEach(clearTimeout)
  }, [phase])

  // Cycle results after done
  useEffect(() => {
    if (phase !== "done") return
    const interval = setInterval(() => {
      setResultIndex(i => (i + 1) % RESULTS.length)
    }, 2500)
    return () => clearInterval(interval)
  }, [phase])

  const reset = () => {
    setPhase("idle")
    setActiveStage(-1)
    setResultIndex(0)
  }

  return (
    <div ref={containerRef} className="max-w-5xl mx-auto">

      {/* Two-column: SVG left, detail right */}
      <div className="flex flex-col lg:flex-row items-center gap-8 lg:gap-16">

        {/* Left: Orbital SVG */}
        <div className="relative w-[320px] h-[320px] md:w-[420px] md:h-[420px] shrink-0">

          {phase === "idle" ? (
            /* Idle state — show outline + start button */
            <div className="w-full h-full flex flex-col items-center justify-center">
              <svg viewBox="0 0 400 400" className="w-full h-full opacity-30" xmlns="http://www.w3.org/2000/svg">
                <circle cx={cx} cy={cy} r={orbitR} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="4 8" />
                <circle cx={cx} cy={cy} r="22" fill="none" stroke="rgba(230,57,70,0.2)" strokeWidth="1.5" />
                {PIPELINE.map((_, i) => {
                  const angle = (i * 60 - 90) * Math.PI / 180
                  return <circle key={i} cx={cx + orbitR * Math.cos(angle)} cy={cy + orbitR * Math.sin(angle)} r={nodeR} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="3 3" />
                })}
              </svg>
              <motion.button
                onClick={start}
                className="absolute py-4 px-10 bg-aisummit-cinnabar text-white font-black text-sm uppercase tracking-widest rounded-sm hover:bg-aisummit-cinnabar/90 transition-all shadow-[0_0_40px_rgba(230,57,70,0.4)] flex items-center gap-3"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                <span className="text-lg">▶</span> Spustit ukázku
              </motion.button>
            </div>
          ) : (
            /* Running / Done state — animated orbital */
            <svg viewBox="0 0 400 400" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <radialGradient id="demo-glow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#e63946" stopOpacity="0.10" />
                  <stop offset="100%" stopColor="#e63946" stopOpacity="0" />
                </radialGradient>
                <filter id="node-glow">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>

              {/* Background glow */}
              <motion.circle cx={cx} cy={cy} r="180" fill="url(#demo-glow)"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.5 }}
              />

              {/* Orbit ring */}
              <motion.circle
                cx={cx} cy={cy} r={orbitR}
                fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="4 8"
                animate={{ rotate: 360 }}
                transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
                style={{ transformOrigin: `${cx}px ${cy}px` }}
              />

              {/* Connection lines */}
              {PIPELINE.map((stage, i) => {
                const angle = (i * 60 - 90) * Math.PI / 180
                const nx = cx + orbitR * Math.cos(angle)
                const ny = cy + orbitR * Math.sin(angle)
                return activeStage >= i ? (
                  <motion.line
                    key={`line-${i}`}
                    x1={cx} y1={cy} x2={nx} y2={ny}
                    stroke={stage.color} strokeWidth="1.5" strokeOpacity="0.2"
                    initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                    transition={{ duration: 0.8 }}
                  />
                ) : null
              })}

              {/* Vesica piscis fills between adjacent active circles */}
              {PIPELINE.map((stage, i) => {
                if (activeStage < i) return null
                const angle = (i * 60 - 90) * Math.PI / 180
                const nx = cx + orbitR * Math.cos(angle)
                const ny = cy + orbitR * Math.sin(angle)
                return (
                  <motion.circle key={`fill-${i}`} cx={nx} cy={ny} r={orbitR * 0.45}
                    fill={`${stage.color}08`} stroke="none"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}
                  />
                )
              })}

              {/* Center node */}
              <motion.circle cx={cx} cy={cy} r="24"
                fill="rgba(230,57,70,0.12)" stroke="#e63946" strokeWidth="2"
                animate={phase === "done" ? { scale: [1, 1.08, 1] } : {}}
                transition={{ duration: 2, repeat: Infinity }}
                style={{ transformOrigin: `${cx}px ${cy}px` }}
              />
              {phase === "done" && (
                <motion.circle cx={cx} cy={cy} r="24"
                  fill="none" stroke="#e63946" strokeWidth="1"
                  initial={{ scale: 1, opacity: 0.5 }}
                  animate={{ scale: 2, opacity: 0 }}
                  transition={{ duration: 2.5, repeat: Infinity }}
                  style={{ transformOrigin: `${cx}px ${cy}px` }}
                />
              )}
              <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
                fill="#e63946" fontSize="11" fontWeight="900" letterSpacing="0.08em"
                style={{ fontFamily: "inherit" }}
              >{phase === "done" ? "∞" : "AI"}</text>

              {/* Stage nodes */}
              {PIPELINE.map((stage, i) => {
                const angle = (i * 60 - 90) * Math.PI / 180
                const nx = cx + orbitR * Math.cos(angle)
                const ny = cy + orbitR * Math.sin(angle)
                const isActive = activeStage >= i
                const isCurrent = activeStage === i && phase === "running"

                return (
                  <g key={i}>
                    {isActive ? (
                      <>
                        <motion.circle cx={nx} cy={ny} r={nodeR}
                          fill={isCurrent ? `${stage.color}22` : `${stage.color}11`}
                          stroke={stage.color}
                          strokeWidth={isCurrent ? 2.5 : 1.5}
                          filter={isCurrent ? "url(#node-glow)" : undefined}
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ duration: 0.5, type: "spring" }}
                          style={{ transformOrigin: `${nx}px ${ny}px` }}
                        />
                        {isCurrent && (
                          <motion.circle cx={nx} cy={ny} r={nodeR}
                            fill="none" stroke={stage.color} strokeWidth="1"
                            initial={{ scale: 1, opacity: 0.6 }}
                            animate={{ scale: 1.8, opacity: 0 }}
                            transition={{ duration: 1.5, repeat: Infinity }}
                            style={{ transformOrigin: `${nx}px ${ny}px` }}
                          />
                        )}
                        <text x={nx} y={ny + 1} textAnchor="middle" dominantBaseline="middle" fontSize="16">
                          {stage.icon}
                        </text>
                        {/* Label below node */}
                        <text x={nx} y={ny + nodeR + 14} textAnchor="middle" dominantBaseline="middle"
                          fill={isCurrent ? stage.color : "rgba(255,255,255,0.3)"}
                          fontSize="7" fontWeight="800" letterSpacing="0.08em"
                          style={{ textTransform: "uppercase", fontFamily: "inherit" }}
                        >{stage.label}</text>
                      </>
                    ) : (
                      <circle cx={nx} cy={ny} r={nodeR}
                        fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="3 3"
                      />
                    )}
                  </g>
                )
              })}
            </svg>
          )}
        </div>

        {/* Right: Detail panel */}
        <div className="flex-1 min-h-[300px] flex flex-col justify-center">
          <AnimatePresence mode="wait">
            {phase === "idle" && (
              <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <p className="text-white/30 text-sm leading-relaxed">
                  Klikněte na <span className="text-aisummit-cinnabar font-bold">Spustit ukázku</span> a sledujte, jak Chrlit analyzuje značku, vytvoří strategii, generuje obsah a učí se z výsledků. Celý cyklus, který běží nepřetržitě.
                </p>
              </motion.div>
            )}

            {phase === "running" && activeStage >= 0 && (
              <motion.div
                key={`stage-${activeStage}`}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.4 }}
              >
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-2xl">{PIPELINE[activeStage].icon}</span>
                  <div>
                    <div className="text-xs font-black uppercase tracking-widest" style={{ color: PIPELINE[activeStage].color }}>
                      Krok {activeStage + 1}/{PIPELINE.length}
                    </div>
                    <h4 className="text-xl font-black text-white uppercase tracking-wider">
                      {PIPELINE[activeStage].label}
                    </h4>
                  </div>
                </div>
                <p className="text-white/50 text-sm leading-relaxed mb-6 max-w-md">
                  {PIPELINE[activeStage].detail}
                </p>
                {/* Progress bar */}
                <div className="w-full max-w-xs h-1 bg-white/5 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: PIPELINE[activeStage].color }}
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: PIPELINE[activeStage].duration / 1000, ease: "linear" }}
                  />
                </div>
                <div className="flex gap-2 mt-4">
                  {PIPELINE.map((s, i) => (
                    <div key={i} className={`w-2 h-2 rounded-full transition-all ${i <= activeStage ? "scale-100" : "scale-75 opacity-30"}`}
                      style={{ background: i <= activeStage ? s.color : "rgba(255,255,255,0.1)" }}
                    />
                  ))}
                </div>
              </motion.div>
            )}

            {phase === "done" && (
              <motion.div
                key="done"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
              >
                <div className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-3">✓ Cyklus kompletní</div>
                <h4 className="text-2xl font-black text-white uppercase tracking-wider mb-4">Systém běží nepřetržitě</h4>
                <p className="text-white/40 text-sm leading-relaxed mb-6 max-w-md">
                  Toto není jednorázová generace. Chrlit opakuje tento cyklus neustále — učí se, adaptuje, zlepšuje. Čím déle ho používáte, tím přesnější obsah dostáváte.
                </p>

                {/* Cycling result */}
                <div className="mb-6">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={resultIndex}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.3 }}
                      className="flex items-center gap-4"
                    >
                      <div className="text-3xl font-black text-aisummit-cinnabar tracking-widest">{RESULTS[resultIndex].word}</div>
                      <div className="text-white/30 text-xs font-bold">{RESULTS[resultIndex].sub}</div>
                    </motion.div>
                  </AnimatePresence>
                </div>

                <div className="flex gap-3">
                  <a href="/register" className="inline-flex items-center gap-2 px-6 py-3 bg-aisummit-cinnabar text-white font-black text-[10px] uppercase tracking-widest rounded-sm hover:bg-aisummit-cinnabar/90 transition-all shadow-[0_0_20px_rgba(230,57,70,0.3)]">
                    Chci tohle pro svou firmu →
                  </a>
                  <button onClick={reset} className="px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-white/20 hover:text-white/50 border border-white/5 rounded-sm transition-colors">
                    Znovu
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
