"use client"

import { motion, AnimatePresence } from "framer-motion"
import { useState, useEffect, useRef } from "react"

const CENTER = {
  label: "Brand Engine",
  desc: "Jádro systému. AI analyzuje vaši značku, produkty a cílovou skupinu — vytvoří unikátní DNA vašeho obsahu.",
}

const PETALS = [
  { label: "Váš Brand", desc: "AI naskenuje váš web a extrahuje barvy, produkty, tón komunikace a cílovou skupinu. Žádné vyplňování formulářů." },
  { label: "Tvorba", desc: "Engine generuje captiony, vizuály a hashtagy přesně ve vašem stylu — měsíce obsahu za minuty." },
  { label: "Dosah", desc: "Příspěvky oslovují vaše publikum. Systém automaticky měří reach, imprese a kliknutí." },
  { label: "Reakce", desc: "Liky, komentáře, uložení, sdílení — každá interakce se zapíše jako datový bod do pamětí systému." },
  { label: "Analýza", desc: "Neural Brand Engine rozpozná vítězné vzorce. Jaký háček, jaký vizuál, jaké CTA přináší výsledky." },
  { label: "Učení", desc: "Systém adaptuje strategii. Přebírá úspěšné vzorce, opouští slabé. Každý cyklus = lepší obsah." },
]

export function SeedOfLife() {
  const [activeStep, setActiveStep] = useState(-1)
  const [animationComplete, setAnimationComplete] = useState(false)
  const [isInView, setIsInView] = useState(false)
  const [hoveredCircle, setHoveredCircle] = useState<number | null>(null)
  const sectionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && !isInView) setIsInView(true) },
      { threshold: 0.3 }
    )
    if (sectionRef.current) observer.observe(sectionRef.current)
    return () => observer.disconnect()
  }, [isInView])

  useEffect(() => {
    if (!isInView) return
    const timers: NodeJS.Timeout[] = []
    timers.push(setTimeout(() => setActiveStep(0), 400))
    for (let i = 1; i <= 6; i++) {
      timers.push(setTimeout(() => setActiveStep(i), 400 + i * 1400))
    }
    timers.push(setTimeout(() => setAnimationComplete(true), 400 + 6 * 1400 + 800))
    return () => timers.forEach(clearTimeout)
  }, [isInView])

  const cx = 210, cy = 210, r = 75

  const circles = [
    { x: cx, y: cy }, // center
    ...Array.from({ length: 6 }, (_, i) => ({
      x: cx + r * Math.cos((i * 60 - 90) * Math.PI / 180),
      y: cy + r * Math.sin((i * 60 - 90) * Math.PI / 180),
    }))
  ]

  // Which circle is "active" for the description panel — hover takes priority
  const displayCircle = hoveredCircle !== null ? hoveredCircle : (animationComplete ? 0 : activeStep)

  const getLabel = (i: number) => i === 0 ? CENTER.label : PETALS[i - 1].label
  const getDesc = (i: number) => i === 0 ? CENTER.desc : PETALS[i - 1].desc

  const isVisible = (i: number) => activeStep >= i

  return (
    <div ref={sectionRef} className="flex flex-col items-center gap-10 max-w-5xl mx-auto">
      {/* SVG */}
      <div className="relative w-[340px] h-[340px] md:w-[460px] md:h-[460px]">
        <svg viewBox="0 0 420 420" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="sol-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#e63946" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#e63946" stopOpacity="0" />
            </radialGradient>
            <filter id="glow-filter">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* Background glow */}
          <motion.circle cx={cx} cy={cy} r="200" fill="url(#sol-glow)"
            initial={{ opacity: 0 }} animate={isInView ? { opacity: 1 } : {}} transition={{ duration: 2 }}
          />

          {/* Rotating outer ring — infinite loop metaphor */}
          {animationComplete && (
            <motion.circle cx={cx} cy={cy} r={r * 2 + 12}
              fill="none" stroke="rgba(230,57,70,0.07)" strokeWidth="1" strokeDasharray="5 9"
              animate={{ rotate: 360 }} transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
              style={{ transformOrigin: `${cx}px ${cy}px` }}
            />
          )}

          {/* Vesica piscis fills — subtle */}
          {circles.slice(1).map((c, i) => isVisible(i + 1) && (
            <motion.circle key={`fill-${i}`} cx={c.x} cy={c.y} r={r}
              fill={hoveredCircle === i + 1 ? "rgba(230,57,70,0.10)" : "rgba(230,57,70,0.04)"}
              stroke="none"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}
            />
          ))}

          {/* Main circles — drawn sequentially, hoverable */}
          {circles.map((c, i) => {
            const visible = isVisible(i)
            const isHovered = hoveredCircle === i
            const isCenter = i === 0

            return (
              <g key={i}>
                {/* Invisible hit area — larger for easier hover */}
                {visible && (
                  <circle
                    cx={c.x} cy={c.y} r={r + 10}
                    fill="transparent" stroke="none"
                    style={{ cursor: "pointer" }}
                    onMouseEnter={() => setHoveredCircle(i)}
                    onMouseLeave={() => setHoveredCircle(null)}
                  />
                )}

                {/* Circle stroke */}
                <motion.circle
                  cx={c.x} cy={c.y} r={r}
                  fill="none"
                  stroke={
                    isHovered ? "#e63946" :
                    isCenter ? "rgba(230,57,70,0.8)" :
                    "rgba(255,255,255,0.14)"
                  }
                  strokeWidth={isHovered ? 2.5 : isCenter ? 2 : 1.5}
                  filter={isHovered ? "url(#glow-filter)" : undefined}
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={visible ? { pathLength: 1, opacity: 1 } : {}}
                  transition={{ duration: 1.1, ease: "easeInOut" }}
                  style={{ cursor: "pointer" }}
                />

                {/* Label inside circle — visible on hover or when it's the active animation step */}
                <AnimatePresence>
                  {visible && (isHovered || (!animationComplete && activeStep === i)) && (
                    <motion.g key={`label-${i}`}
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <text
                        x={c.x} y={c.y - 5}
                        textAnchor="middle" dominantBaseline="middle"
                        fill={isCenter ? "#e63946" : "rgba(255,255,255,0.9)"}
                        fontSize="11" fontWeight="900" letterSpacing="0.1em"
                        style={{ textTransform: "uppercase", fontFamily: "inherit", pointerEvents: "none" }}
                      >{getLabel(i)}</text>
                      {isHovered && (
                        <text
                          x={c.x} y={c.y + 10}
                          textAnchor="middle" dominantBaseline="middle"
                          fill="rgba(255,255,255,0.3)"
                          fontSize="7" fontWeight="700"
                          style={{ fontFamily: "inherit", pointerEvents: "none" }}
                        >najeď pro více</text>
                      )}
                    </motion.g>
                  )}
                </AnimatePresence>

                {/* Pulsing ring on hovered circle */}
                {isHovered && (
                  <motion.circle cx={c.x} cy={c.y} r={r}
                    fill="none" stroke="#e63946" strokeWidth="1"
                    initial={{ opacity: 0.6, scale: 1 }}
                    animate={{ opacity: 0, scale: 1.15 }}
                    transition={{ duration: 1.2, repeat: Infinity }}
                    style={{ transformOrigin: `${c.x}px ${c.y}px` }}
                  />
                )}
              </g>
            )
          })}

          {/* Center heartbeat dot */}
          {animationComplete && (
            <>
              <motion.circle cx={cx} cy={cy} r="5" fill="#e63946"
                animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 2, repeat: Infinity }}
              />
              <motion.circle cx={cx} cy={cy} r="5" fill="none" stroke="#e63946" strokeWidth="1"
                animate={{ opacity: [0.4, 0], r: [5, 45] } as any} transition={{ duration: 2.5, repeat: Infinity }}
              />
            </>
          )}
        </svg>

        {/* Center overlay label (when nothing hovered, animation done) */}
        {animationComplete && hoveredCircle === null && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center">
              <div className="text-aisummit-cinnabar text-[10px] font-black uppercase tracking-widest">∞ Loop</div>
              <div className="text-white/20 text-[8px] font-bold mt-0.5">najeď na kruh</div>
            </motion.div>
          </div>
        )}
      </div>

      {/* Description panel — updates on hover */}
      <div className="w-full max-w-xl min-h-[100px] flex items-start justify-center">
        <AnimatePresence mode="wait">
          {displayCircle >= 0 && (
            <motion.div
              key={`desc-${displayCircle}-${hoveredCircle}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="text-center"
            >
              <h4 className={`text-xl font-black uppercase tracking-widest mb-3 ${displayCircle === 0 ? "text-aisummit-cinnabar" : "text-white"}`}>
                {getLabel(displayCircle)}
              </h4>
              <p className="text-sm text-white/50 leading-relaxed max-w-md mx-auto">
                {getDesc(displayCircle)}
              </p>
            </motion.div>
          )}
          {displayCircle < 0 && (
            <motion.div key="waiting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center">
              <p className="text-xs text-white/20 font-bold uppercase tracking-widest">Animace se spouští...</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Progress dots */}
      <div className="flex items-center gap-2.5">
        {Array.from({ length: 7 }, (_, i) => (
          <motion.button
            key={i}
            className={`w-2 h-2 rounded-full transition-all duration-300 ${
              hoveredCircle === i ? "bg-aisummit-cinnabar scale-150" :
              activeStep >= i ? (i === 0 ? "bg-aisummit-cinnabar/60" : "bg-white/50") :
              "bg-white/10"
            }`}
            animate={activeStep === i && hoveredCircle === null ? { scale: [1, 1.5, 1] } : {}}
            transition={{ duration: 0.5 }}
            onMouseEnter={() => activeStep >= i ? setHoveredCircle(i) : undefined}
            onMouseLeave={() => setHoveredCircle(null)}
          />
        ))}
      </div>
    </div>
  )
}
