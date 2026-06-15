"use client"

/**
 * SeedToFlower — the brand's uniqueness told through sacred geometry.
 *
 * One seed (your website) blooms into the Seed of Life (your brand DNA, 6 facets)
 * and then into the full Flower of Life (your whole content universe). The defining
 * property of the Flower of Life — the same pattern repeats at every scale — is the
 * exact metaphor for Chrlit: your brand DNA lives inside every single post. That is
 * what separates it from generic AI.
 *
 * Geometry is generated on the real triangular lattice where circle spacing equals
 * the circle radius, so every circle passes through its neighbours' centres (the
 * mathematical definition of the figure). 1 + 6 + 12 = 19 circles.
 */

import { motion, AnimatePresence } from "framer-motion"
import { useState, useEffect, useRef } from "react"

const VB = 440
const CX = 220
const CY = 220
const R = 60 // circle radius == lattice spacing — the Flower of Life condition
const SQRT3 = Math.sqrt(3)

type Phase = "pre" | "seed" | "dna" | "flower" | "alive"
type Circle = { key: string; ring: 0 | 1 | 2; x: number; y: number; angle: number; bloomIndex: number }

// Sort circles within a ring starting from the top, going clockwise — for a pleasing bloom.
function topClockwise(angle: number): number {
  let a = angle + Math.PI / 2
  if (a < 0) a += Math.PI * 2
  return a
}

// Build the 19 circle centres from axial lattice coords (a·e1 + b·e2).
const FLOWER: Circle[] = (() => {
  const raw: Omit<Circle, "bloomIndex" | "key">[] = []
  for (let a = -2; a <= 2; a++) {
    for (let b = -2; b <= 2; b++) {
      const ring = (Math.abs(a) + Math.abs(b) + Math.abs(a + b)) / 2
      if (ring <= 2) {
        const x = CX + a * R + b * (R / 2)
        const y = CY + b * (R * SQRT3 / 2)
        raw.push({ ring: ring as 0 | 1 | 2, x, y, angle: Math.atan2(y - CY, x - CX) })
      }
    }
  }
  const out: Circle[] = []
  ;([0, 1, 2] as const).forEach((ring) => {
    raw
      .filter((c) => c.ring === ring)
      .sort((p, q) => topClockwise(p.angle) - topClockwise(q.angle))
      .forEach((c, i) => out.push({ ...c, bloomIndex: i, key: `${ring}-${i}` }))
  })
  return out
})()

// ─── Meaning attached to each circle ────────────────────────────────

const BRAND = {
  title: "Vaše značka",
  desc: "Jádro, ze kterého roste všechno ostatní.",
}

// 6 petals of the Seed of Life = the facets of your brand DNA (top, clockwise)
const DNA: { title: string; desc: string }[] = [
  { title: "Barvy", desc: "Vaše paleta v každém vizuálu." },
  { title: "Tón", desc: "Váš hlas v každém slově." },
  { title: "Produkty", desc: "To, co prodáváte — i bez focení." },
  { title: "Publikum", desc: "Vaši lidé. Ne kdokoliv." },
  { title: "Příběh", desc: "Proč vás lidi mají rádi." },
  { title: "Hodnoty", desc: "Čím se lišíte od ostatních." },
]

// 12 outer circles = the fruits of the flower — the content that grows
const CONTENT = ["Příspěvek", "Reel", "Carousel", "Příběh", "Caption", "Hashtagy", "Vizuál", "Nápad", "CTA", "Téma", "Plán", "Varianta"]
const CONTENT_DESC = "Roste z vaší DNA — a vypadá jako vy."

const PHASE_INFO: Record<Exclude<Phase, "pre">, { tag: string; title: string; desc: string; accent: string }> = {
  seed: {
    tag: "Semínko",
    title: "Vy",
    desc: "Všechno začíná jedním bodem — vámi.",
    accent: "#e63946",
  },
  dna: {
    tag: "Sémě života",
    title: "Vaše DNA",
    desc: "To, co dělá váš obsah vaším.",
    accent: "#f59e0b",
  },
  flower: {
    tag: "Květ života",
    title: "Celá zahrada obsahu",
    desc: "Z jednoho semínka desítky příspěvků. A každý vypadá jako vy.",
    accent: "#10b981",
  },
  alive: {
    tag: "∞ Živé",
    title: "Nikdy nezastaví",
    desc: "Čím déle roste, tím víc kvete. Pořád jako vy.",
    accent: "#e63946",
  },
}

const STAGES = ["Semínko", "Sémě života", "Květ života"]
const FRUITS = [
  { word: "DOSAH", sub: "víc lidí vás vidí" },
  { word: "RŮST", sub: "organický nárůst" },
  { word: "PRODEJ", sub: "obsah, co konvertuje" },
  { word: "ÚSPORA", sub: "hodiny každý týden" },
]

const maxRing = (p: Phase) => (p === "pre" ? -1 : p === "seed" ? 0 : p === "dna" ? 1 : 2)
const stageOf = (p: Phase) => (p === "pre" || p === "seed" ? 0 : p === "dna" ? 1 : 2)

function infoFor(c: Circle): { title: string; desc: string } {
  if (c.ring === 0) return BRAND
  if (c.ring === 1) return DNA[c.bloomIndex] ?? BRAND
  return { title: CONTENT[c.bloomIndex] ?? "Obsah", desc: CONTENT_DESC }
}

export function SeedToFlower() {
  const [phase, setPhase] = useState<Phase>("pre")
  const [hovered, setHovered] = useState<string | null>(null)
  const [fruit, setFruit] = useState(0)
  const [runId, setRunId] = useState(0) // bump to replay
  const sectionRef = useRef<HTMLDivElement>(null)

  // Autoplay when scrolled into view (first time only)
  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setPhase((p) => (p === "pre" ? "seed" : p))
          observer.disconnect()
        }
      },
      { threshold: 0.35 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Drive the bloom: seed → dna → flower → alive
  useEffect(() => {
    if (phase === "pre" || phase === "alive") return
    const next: Record<string, Phase> = { seed: "dna", dna: "flower", flower: "alive" }
    const dur: Record<string, number> = { seed: 1500, dna: 2700, flower: 3000 }
    const t = setTimeout(() => setPhase(next[phase]), dur[phase])
    return () => clearTimeout(t)
  }, [phase, runId])

  // Cycle the fruits once alive
  useEffect(() => {
    if (phase !== "alive") return
    const i = setInterval(() => setFruit((f) => (f + 1) % FRUITS.length), 2400)
    return () => clearInterval(i)
  }, [phase])

  const replay = () => {
    setHovered(null)
    setFruit(0)
    setPhase("seed")
    setRunId((n) => n + 1)
  }

  const mr = maxRing(phase)
  const active = FLOWER.filter((c) => c.ring <= mr)
  const hoveredCircle = active.find((c) => c.key === hovered) ?? null
  const panel = hoveredCircle ? infoFor(hoveredCircle) : phase !== "pre" ? PHASE_INFO[phase] : null

  return (
    <div ref={sectionRef} className="flex flex-col items-center gap-8 max-w-5xl mx-auto">

      {/* ─── The mandala ─── */}
      <div className="relative w-[330px] h-[330px] sm:w-[420px] sm:h-[420px] md:w-[480px] md:h-[480px]">
        <svg viewBox={`0 0 ${VB} ${VB}`} className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="stf-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#e63946" stopOpacity="0.16" />
              <stop offset="60%" stopColor="#e63946" stopOpacity="0.03" />
              <stop offset="100%" stopColor="#e63946" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="stf-stroke" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ff6b6b" />
              <stop offset="55%" stopColor="#e63946" />
              <stop offset="100%" stopColor="#f59e0b" />
            </linearGradient>
            <filter id="stf-soft" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="3.5" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* ambient glow — breathes once alive */}
          <motion.circle
            cx={CX} cy={CY} r="210" fill="url(#stf-glow)"
            initial={{ opacity: 0 }}
            animate={{ opacity: phase === "pre" ? 0.25 : 1, scale: phase === "alive" ? [1, 1.04, 1] : 1 }}
            transition={{ opacity: { duration: 1.5 }, scale: { duration: 9, repeat: Infinity, ease: "easeInOut" } }}
            style={{ transformOrigin: `${CX}px ${CY}px` }}
          />

          {/* classic bounding rings */}
          <circle cx={CX} cy={CY} r={3 * R} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
          <circle cx={CX} cy={CY} r={3 * R + 8} fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />

          {/* rotating cosmic ring once the system is alive */}
          {phase === "alive" && (
            <>
              <motion.circle
                cx={CX} cy={CY} r={3 * R - 2}
                fill="none" stroke="rgba(230,57,70,0.10)" strokeWidth="1" strokeDasharray="4 10"
                animate={{ rotate: 360 }} transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
                style={{ transformOrigin: `${CX}px ${CY}px` }}
              />
              <motion.circle
                cx={CX} cy={CY} r={2.1 * R}
                fill="none" stroke="rgba(245,158,11,0.08)" strokeWidth="1" strokeDasharray="2 12"
                animate={{ rotate: -360 }} transition={{ duration: 90, repeat: Infinity, ease: "linear" }}
                style={{ transformOrigin: `${CX}px ${CY}px` }}
              />
            </>
          )}

          {/* GHOST layer — the latent pattern, always faintly present */}
          {FLOWER.map((c) => (
            <circle key={`ghost-${c.key}`} cx={c.x} cy={c.y} r={R} fill="none" stroke="rgba(255,255,255,0.045)" strokeWidth="1" />
          ))}

          {/* VESICA fills — overlapping translucent discs build the glowing lattice */}
          <AnimatePresence>
            {active.map((c) => (
              <motion.circle
                key={`fill-${c.key}`}
                cx={c.x} cy={c.y} r={R}
                fill={hovered === c.key ? "rgba(230,57,70,0.12)" : "rgba(230,57,70,0.045)"}
                stroke="none"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.7, delay: c.bloomIndex * 0.08 }}
              />
            ))}
          </AnimatePresence>

          {/* MAIN circles — draw on as they bloom */}
          <AnimatePresence>
            {active.map((c) => {
              const isHover = hovered === c.key
              const baseStroke = c.ring === 0 ? 2 : c.ring === 1 ? 1.5 : 1.1
              return (
                <motion.circle
                  key={`line-${c.key}`}
                  cx={c.x} cy={c.y} r={R}
                  fill="none"
                  stroke={isHover ? "#fff" : "url(#stf-stroke)"}
                  strokeWidth={isHover ? 2.6 : baseStroke}
                  strokeOpacity={c.ring === 2 && !isHover ? 0.55 : 1}
                  filter={isHover ? "url(#stf-soft)" : undefined}
                  initial={{ pathLength: 0, opacity: 0, scale: 0.5 }}
                  animate={{ pathLength: 1, opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  transition={{ duration: 0.95, delay: c.bloomIndex * 0.08, ease: [0.16, 1, 0.3, 1] }}
                  style={{ transformOrigin: `${c.x}px ${c.y}px` }}
                />
              )
            })}
          </AnimatePresence>

          {/* HOVER hit-areas + labels (on top, transparent) */}
          {active.map((c) => (
            <g key={`hit-${c.key}`}>
              <circle
                cx={c.x} cy={c.y} r={R * 0.62}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHovered(c.key)}
                onMouseLeave={() => setHovered((h) => (h === c.key ? null : h))}
              />
              <AnimatePresence>
                {hovered === c.key && (
                  <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                    <circle cx={c.x} cy={c.y} r={R} fill="none" stroke="#fff" strokeWidth="1" strokeOpacity="0.25" />
                    <text
                      x={c.x} y={c.y + 1} textAnchor="middle" dominantBaseline="middle"
                      fill="#fff" fontSize={c.ring === 2 ? 8 : 10} fontWeight="900" letterSpacing="0.08em"
                      style={{ textTransform: "uppercase", fontFamily: "inherit", pointerEvents: "none" }}
                    >
                      {infoFor(c).title}
                    </text>
                  </motion.g>
                )}
              </AnimatePresence>
            </g>
          ))}

          {/* CENTER core + heartbeat */}
          {phase !== "pre" && (
            <>
              <motion.circle
                cx={CX} cy={CY} r="6" fill="#e63946"
                animate={{ opacity: phase === "alive" ? [0.6, 1, 0.6] : 1 }}
                transition={{ duration: 2, repeat: Infinity }}
              />
              {phase === "alive" && (
                <motion.circle
                  cx={CX} cy={CY} r="6" fill="none" stroke="#e63946" strokeWidth="1"
                  initial={{ opacity: 0.5, scale: 1 }}
                  animate={{ opacity: 0, scale: 7 }}
                  transition={{ duration: 2.6, repeat: Infinity, ease: "easeOut" }}
                  style={{ transformOrigin: `${CX}px ${CY}px` }}
                />
              )}
            </>
          )}
        </svg>

        {/* center overlay label once alive */}
        <AnimatePresence>
          {phase === "alive" && !hoveredCircle && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
            >
              <div className="text-center mt-1">
                <div className="text-aisummit-cinnabar text-[10px] font-black uppercase tracking-[0.3em]">∞ Vaše DNA</div>
                <div className="text-white/25 text-[8px] font-bold uppercase tracking-widest mt-0.5">najeď na kruh</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ─── Narrative panel ─── */}
      <div className="w-full max-w-xl min-h-[120px] flex items-start justify-center px-4">
        <AnimatePresence mode="wait">
          {panel ? (
            <motion.div
              key={hoveredCircle ? `hover-${hoveredCircle}` : `phase-${phase}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="text-center"
            >
              {!hoveredCircle && (
                <div
                  className="text-[10px] font-black uppercase tracking-[0.3em] mb-3"
                  style={{ color: PHASE_INFO[phase as Exclude<Phase, "pre">].accent }}
                >
                  {PHASE_INFO[phase as Exclude<Phase, "pre">].tag}
                </div>
              )}
              <h4 className="text-xl md:text-2xl font-black uppercase tracking-widest mb-3 text-white">{panel.title}</h4>
              <p className="text-sm text-white/50 leading-relaxed max-w-md mx-auto">{panel.desc}</p>

              {phase === "alive" && !hoveredCircle && (
                <div className="mt-5 h-8 flex items-center justify-center gap-3">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={fruit}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.3 }}
                      className="flex items-center gap-3"
                    >
                      <span className="text-2xl font-black text-aisummit-cinnabar tracking-widest">{FRUITS[fruit].word}</span>
                      <span className="text-white/30 text-xs font-bold">{FRUITS[fruit].sub}</span>
                    </motion.div>
                  </AnimatePresence>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div key="pre" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center">
              <p className="text-xs text-white/25 font-bold uppercase tracking-[0.25em]">Sledujte, jak z vaší značky roste obsah…</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ─── Stage indicator ─── */}
      <div className="flex items-center gap-3">
        {STAGES.map((s, i) => {
          const reached = stageOf(phase) >= i
          const current = stageOf(phase) === i && phase !== "pre"
          return (
            <div key={s} className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className={`h-1.5 rounded-full transition-all duration-500 ${current ? "w-6 bg-aisummit-cinnabar" : reached ? "w-1.5 bg-aisummit-cinnabar/60" : "w-1.5 bg-white/10"}`} />
                <span className={`text-[9px] font-black uppercase tracking-widest transition-colors ${reached ? "text-white/60" : "text-white/20"}`}>{s}</span>
              </div>
              {i < STAGES.length - 1 && <span className="text-white/15 text-[9px]">→</span>}
            </div>
          )
        })}
      </div>

      {/* ─── The uniqueness punchline ─── */}
      <div className="text-center max-w-2xl mx-auto pt-2">
        <p className="text-[9px] font-black uppercase tracking-[0.3em] text-aisummit-cinnabar/70 mb-2">Stejný vzor v každém měřítku</p>
        <p className="text-base md:text-lg text-white/60 font-medium leading-relaxed">
          Vaše značka je v <span className="text-white">každém příspěvku</span>. To je rozdíl mezi generickou AI a obsahem, který vypadá jako vy.
        </p>
        {phase === "alive" && (
          <button
            onClick={replay}
            className="mt-6 px-5 py-2.5 text-[9px] font-black uppercase tracking-widest text-white/40 hover:text-white border border-white/10 hover:border-white/30 rounded-sm transition-colors"
          >
            ↻ Přehrát znovu
          </button>
        )}
      </div>
    </div>
  )
}
