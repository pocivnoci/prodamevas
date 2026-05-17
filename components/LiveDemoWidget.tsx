"use client"

import React, { useState, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"

const STEPS = [
  { icon: "🔍", label: "Analyzuji web...", duration: 1200 },
  { icon: "🎨", label: "Extrahuji barvy a styl...", duration: 1000 },
  { icon: "✍️", label: "Generuji caption...", duration: 1400 },
  { icon: "🖼️", label: "Tvořím vizuál...", duration: 1200 },
  { icon: "✅", label: "Hotovo!", duration: 600 },
]

const DEMO_RESULTS = [
  {
    domain: "kavarna",
    colors: ["#2C1810", "#D4A574", "#F5E6D3"],
    caption: "☕ Každé ráno začíná rituálem. Tím naším je perfektní espresso z čerstvě pražených zrn — a ten tvůj?",
    hashtags: "#kavarna #espresso #rannikava #coffeelovers",
    industry: "Kavárna & Coffee shop",
  },
  {
    domain: "fitness",
    colors: ["#1a1a2e", "#e94560", "#0f3460"],
    caption: "💪 3 měsíce zpátky jsi chtěl začít. Dneska je ten den, kdy přestaneš scrollovat a začneš makat.",
    hashtags: "#fitness #motivace #trenink #gym",
    industry: "Fitness & Wellness",
  },
  {
    domain: "hotel",
    colors: ["#0a3d62", "#f6b93b", "#e8dcc4"],
    caption: "🏔️ Probudíte se a za oknem Krkonoše. Snídaně už voní. Někdy je luxus prostě... klid.",
    hashtags: "#hotel #krkonose #dovolena #relaxace",
    industry: "Hotelnictví & Turismus",
  },
]

export function LiveDemoWidget() {
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle")
  const [currentStep, setCurrentStep] = useState(0)
  const [result, setResult] = useState(DEMO_RESULTS[0])
  const [typedCaption, setTypedCaption] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const runDemo = () => {
    if (phase === "running") return
    const rand = DEMO_RESULTS[Math.floor(Math.random() * DEMO_RESULTS.length)]
    setResult(rand)
    setPhase("running")
    setCurrentStep(0)
    setTypedCaption("")

    let step = 0
    const advance = () => {
      if (step < STEPS.length - 1) {
        step++
        setCurrentStep(step)
        setTimeout(advance, STEPS[step].duration)
      } else {
        setPhase("done")
      }
    }
    setTimeout(advance, STEPS[0].duration)
  }

  // Typing effect for caption
  useEffect(() => {
    if (phase !== "done") return
    const caption = result.caption
    let i = 0
    const interval = setInterval(() => {
      setTypedCaption(caption.slice(0, i + 1))
      i++
      if (i >= caption.length) clearInterval(interval)
    }, 18)
    return () => clearInterval(interval)
  }, [phase, result.caption])

  return (
    <div className="max-w-3xl mx-auto">
      {/* Input */}
      <div className="relative mb-8">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              type="text"
              placeholder="Zadejte web svého podnikání..."
              className="w-full bg-[#111] border border-white/10 rounded-sm px-5 py-4 text-white text-sm font-medium placeholder:text-white/20 focus:outline-none focus:border-aisummit-cinnabar/50 transition-colors"
              onKeyDown={(e) => e.key === "Enter" && runDemo()}
              disabled={phase === "running"}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-white/10 text-[9px] font-bold uppercase tracking-widest">
              demo
            </div>
          </div>
          <button
            onClick={runDemo}
            disabled={phase === "running"}
            className="px-6 py-4 bg-aisummit-cinnabar text-white font-black text-xs uppercase tracking-widest rounded-sm hover:bg-aisummit-cinnabar/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shadow-[0_0_20px_rgba(230,57,70,0.3)]"
          >
            {phase === "running" ? "Generuji..." : "Vyzkoušet →"}
          </button>
        </div>
      </div>

      {/* Progress */}
      <AnimatePresence>
        {phase === "running" && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="bg-[#0a0a0a] border border-white/5 rounded-sm p-6 mb-6"
          >
            <div className="space-y-3">
              {STEPS.map((step, i) => (
                <div key={i} className={`flex items-center gap-3 transition-all duration-300 ${i <= currentStep ? "opacity-100" : "opacity-20"}`}>
                  <span className="text-base w-6 text-center">{i < currentStep ? "✓" : step.icon}</span>
                  <span className={`text-xs font-bold ${i < currentStep ? "text-emerald-400" : i === currentStep ? "text-white" : "text-white/30"}`}>
                    {step.label}
                  </span>
                  {i === currentStep && i < STEPS.length - 1 && (
                    <div className="ml-2 w-3 h-3 border-2 border-aisummit-cinnabar border-t-transparent rounded-full animate-spin" />
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Result */}
      <AnimatePresence>
        {phase === "done" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="bg-[#0a0a0a] border border-white/10 rounded-sm overflow-hidden"
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-aisummit-cinnabar/20 rounded-sm flex items-center justify-center text-aisummit-cinnabar text-xs font-black">AI</div>
                <div>
                  <div className="text-white text-xs font-black">{result.industry}</div>
                  <div className="text-white/30 text-[9px] font-bold uppercase tracking-widest">Vygenerovaný post</div>
                </div>
              </div>
              <div className="flex gap-1.5">
                {result.colors.map((c, i) => (
                  <div key={i} className="w-5 h-5 rounded-full border border-white/10" style={{ background: c }} title={c} />
                ))}
              </div>
            </div>

            {/* Caption */}
            <div className="px-6 py-5">
              <p className="text-white/70 text-sm leading-relaxed min-h-[3rem]">
                {typedCaption}
                {typedCaption.length < result.caption.length && (
                  <span className="inline-block w-0.5 h-4 bg-aisummit-cinnabar ml-0.5 animate-pulse" />
                )}
              </p>
              <p className="text-aisummit-cinnabar/40 text-[10px] font-bold mt-3">{result.hashtags}</p>
            </div>

            {/* CTA */}
            <div className="px-6 py-4 border-t border-white/5 bg-white/[0.02]">
              <a
                href="/register"
                className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-aisummit-cinnabar hover:text-white transition-colors"
              >
                Chci tohle pro svou firmu →
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
