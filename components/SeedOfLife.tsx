"use client"

import { motion, AnimatePresence } from "framer-motion"
import { useState, useEffect, useRef } from "react"

const STEPS = [
  { label: "Váš Brand", desc: "AI analyzuje váš web, extrahuje barvy, produkty a tón komunikace.", color: "#e63946" },
  { label: "Tvorba", desc: "Engine generuje captiony, vizuály a hashtagy přesně ve vašem stylu.", color: "#e63946" },
  { label: "Dosah", desc: "Příspěvky oslovují vaše publikum. Systém měří reach a imprese.", color: "#e63946" },
  { label: "Reakce", desc: "Liky, komentáře, uložení, sdílení — každá interakce je datový bod.", color: "#e63946" },
  { label: "Analýza", desc: "Neural Brand Engine rozpozná vítězné vzorce — co funguje a proč.", color: "#e63946" },
  { label: "Učení", desc: "Systém adaptuje strategii. Přebírá úspěšné vzorce, opouští slabé.", color: "#e63946" },
]

export function SeedOfLife() {
  const [activeStep, setActiveStep] = useState(-1)
  const [animationComplete, setAnimationComplete] = useState(false)
  const [isInView, setIsInView] = useState(false)
  const sectionRef = useRef<HTMLDivElement>(null)

  // Intersection observer to start animation when in view
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isInView) {
          setIsInView(true)
        }
      },
      { threshold: 0.3 }
    )
    if (sectionRef.current) observer.observe(sectionRef.current)
    return () => observer.disconnect()
  }, [isInView])

  // Sequential animation: center circle, then 6 petals one by one
  useEffect(() => {
    if (!isInView) return

    // Step -1 is initial state, 0 = center circle, 1-6 = petal circles
    const timers: NodeJS.Timeout[] = []

    // Center appears at 0.5s
    timers.push(setTimeout(() => setActiveStep(0), 500))

    // Each petal appears every 1.5s
    for (let i = 1; i <= 6; i++) {
      timers.push(setTimeout(() => setActiveStep(i), 500 + i * 1500))
    }

    // Mark complete after all circles
    timers.push(setTimeout(() => setAnimationComplete(true), 500 + 6 * 1500 + 1000))

    return () => timers.forEach(clearTimeout)
  }, [isInView])

  // Seed of Life geometry: center + 6 circles on its circumference
  const cx = 210, cy = 210, r = 75

  const circles = [
    { x: cx, y: cy }, // center
    ...Array.from({ length: 6 }, (_, i) => ({
      x: cx + r * Math.cos((i * 60 - 90) * Math.PI / 180),
      y: cy + r * Math.sin((i * 60 - 90) * Math.PI / 180),
    }))
  ]

  return (
    <div ref={sectionRef} className="flex flex-col items-center gap-12 max-w-5xl mx-auto">
      {/* SVG Seed of Life */}
      <div className="relative w-[340px] h-[340px] md:w-[420px] md:h-[420px]">
        <svg viewBox="0 0 420 420" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="sol-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#e63946" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#e63946" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Background glow */}
          <motion.circle
            cx={cx} cy={cy} r="190"
            fill="url(#sol-glow)"
            initial={{ opacity: 0 }}
            animate={isInView ? { opacity: 1 } : {}}
            transition={{ duration: 2 }}
          />

          {/* Draw circles sequentially */}
          {circles.map((c, i) => (
            <motion.circle
              key={i}
              cx={c.x} cy={c.y} r={r}
              fill="none"
              stroke={i === 0 ? "#e63946" : "rgba(255,255,255,0.15)"}
              strokeWidth={i === 0 ? 2.5 : 1.5}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={activeStep >= i ? { pathLength: 1, opacity: 1 } : {}}
              transition={{ duration: 1.2, ease: "easeInOut" }}
              strokeDasharray="1"
              style={{ pathLength: 0 }}
            />
          ))}

          {/* Vesica piscis intersection fills — appear after corresponding circles */}
          {circles.slice(1).map((c, i) => (
            <motion.circle
              key={`fill-${i}`}
              cx={c.x} cy={c.y} r={r}
              fill="rgba(230,57,70,0.04)"
              stroke="none"
              initial={{ opacity: 0 }}
              animate={activeStep >= i + 1 ? { opacity: 1 } : {}}
              transition={{ duration: 0.8, delay: 0.5 }}
            />
          ))}

          {/* Active circle highlight glow */}
          {activeStep >= 1 && activeStep <= 6 && (
            <motion.circle
              cx={circles[activeStep].x}
              cy={circles[activeStep].y}
              r={r + 5}
              fill="none"
              stroke="#e63946"
              strokeWidth="1"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: [0, 0.5, 0], scale: [0.95, 1.05, 0.95] }}
              transition={{ duration: 2, repeat: Infinity }}
              style={{ transformOrigin: `${circles[activeStep].x}px ${circles[activeStep].y}px` }}
            />
          )}

          {/* Center heartbeat — after all circles drawn */}
          {animationComplete && (
            <>
              <motion.circle
                cx={cx} cy={cy} r="6"
                fill="#e63946"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
              <motion.circle
                cx={cx} cy={cy} r="6"
                fill="none" stroke="#e63946" strokeWidth="1"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0.5, 0], r: [6, 50] }}
                transition={{ duration: 2.5, repeat: Infinity }}
              />

              {/* Slow rotation overlay */}
              <motion.circle
                cx={cx} cy={cy} r={r * 2 + 10}
                fill="none" stroke="rgba(230,57,70,0.06)" strokeWidth="1"
                strokeDasharray="4 8"
                animate={{ rotate: 360 }}
                transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
                style={{ transformOrigin: `${cx}px ${cy}px` }}
              />
            </>
          )}
        </svg>

        {/* Step counter overlay */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <AnimatePresence mode="wait">
            {activeStep === 0 && (
              <motion.div
                key="center"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="text-center"
              >
                <div className="text-aisummit-cinnabar text-[10px] font-black uppercase tracking-widest">Engine</div>
                <div className="text-white/20 text-[8px] font-bold mt-1">Jádro systému</div>
              </motion.div>
            )}
            {activeStep >= 1 && activeStep <= 6 && (
              <motion.div
                key={`step-${activeStep}`}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="text-center"
              >
                <div className="text-white text-[10px] font-black uppercase tracking-widest">{activeStep}/6</div>
              </motion.div>
            )}
            {animationComplete && (
              <motion.div
                key="complete"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center"
              >
                <div className="text-aisummit-cinnabar text-[10px] font-black uppercase tracking-widest">∞ Loop</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Active step description — large, below the SVG */}
      <div className="h-28 w-full max-w-lg flex items-start justify-center">
        <AnimatePresence mode="wait">
          {activeStep === 0 && (
            <motion.div
              key="desc-center"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="text-center"
            >
              <h4 className="text-lg font-black uppercase tracking-widest text-aisummit-cinnabar mb-2">Váš Brand Engine</h4>
              <p className="text-sm text-white/50 leading-relaxed">Vše začíná jádrem — AI analyzuje vaši značku, produkty a cílovou skupinu. Vytvoří unikátní DNA vašeho obsahu.</p>
            </motion.div>
          )}
          {activeStep >= 1 && activeStep <= 6 && (
            <motion.div
              key={`desc-${activeStep}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="text-center"
            >
              <h4 className="text-lg font-black uppercase tracking-widest text-white mb-2">{STEPS[activeStep - 1].label}</h4>
              <p className="text-sm text-white/50 leading-relaxed">{STEPS[activeStep - 1].desc}</p>
            </motion.div>
          )}
          {animationComplete && (
            <motion.div
              key="desc-complete"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center"
            >
              <h4 className="text-lg font-black uppercase tracking-widest text-aisummit-cinnabar mb-2">Nekonečný cyklus zlepšování</h4>
              <p className="text-sm text-white/50 leading-relaxed">Každý nový cyklus = chytřejší obsah. Systém se učí z vašich reálných výsledků a neustále se zdokonaluje. Čím déle běží, tím lepší posty produkuje.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Progress dots */}
      <div className="flex items-center gap-2">
        {Array.from({ length: 7 }, (_, i) => (
          <motion.div
            key={i}
            className={`w-2 h-2 rounded-full transition-colors duration-500 ${
              activeStep >= i ? (i === 0 ? "bg-aisummit-cinnabar" : "bg-white/60") : "bg-white/10"
            }`}
            animate={activeStep === i ? { scale: [1, 1.4, 1] } : {}}
            transition={{ duration: 0.6 }}
          />
        ))}
      </div>
    </div>
  )
}
