"use client"

import React, { useEffect, useState } from "react"
import Link from "next/link"
import { motion, useScroll, useTransform } from "framer-motion"
import { Sparkles, Zap, Bot, PenTool, LayoutTemplate, TrendingUp, Presentation, ArrowRight, Play, CheckCircle2 } from "lucide-react"
import { LogoPV } from "@/components/LogoPV"

export default function Home() {
  const [scrolled, setScrolled] = useState(false)
  const { scrollYProgress } = useScroll()
  const opacity = useTransform(scrollYProgress, [0, 0.05], [1, 0])

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  return (
    <main className="min-h-screen bg-aisummit-bg text-aisummit-text selection:bg-aisummit-cinnabar/30 selection:text-white overflow-hidden font-sans">

      {/* DYNAMIC BACKGROUND */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-aisummit-glow/10 rounded-full blur-[150px] opacity-70 mix-blend-screen animate-pulse" style={{ animationDuration: '8s' }}></div>
        <div className="absolute top-[20%] right-[-10%] w-[40%] h-[60%] bg-aisummit-glow/10 rounded-full blur-[150px] opacity-60 mix-blend-screen animate-pulse" style={{ animationDuration: '12s' }}></div>
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]"></div>
      </div>

      {/* HEADER */}
      <motion.header
        className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${scrolled ? 'bg-aisummit-bg/90 backdrop-blur-md border-b border-white/10 shadow-sm' : 'bg-transparent pt-4'}`}
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative w-10 h-10 bg-aisummit-cinnabar rounded flex items-center justify-center overflow-hidden">
              <LogoPV className="relative z-10 text-white w-6 h-6" />
            </div>
            <span className="font-bold tracking-tighter text-xl text-aisummit-text uppercase">Prodáme<span className="text-aisummit-cinnabar">Vás</span></span>
          </div>
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-white/60">
            <Link href="#features" className="hover:text-white transition-colors uppercase tracking-wider text-xs">Platforma</Link>
            <Link href="#how-it-works" className="hover:text-white transition-colors uppercase tracking-wider text-xs">Ukázka</Link>
            <Link href="#pricing" className="hover:text-white transition-colors uppercase tracking-wider text-xs">Ceník</Link>
          </nav>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm font-medium text-white/60 hover:text-white transition-colors hidden sm:block uppercase tracking-wider text-xs">
              Přihlásit se
            </Link>
            <Link href="/register" className="group relative inline-flex items-center gap-2 text-sm font-bold px-6 py-3 bg-aisummit-cinnabar text-white rounded-sm overflow-hidden transition-all hover:bg-aisummit-cinnabar/90 uppercase tracking-widest">
              <span>Začít zdarma</span>
            </Link>
          </div>
        </div>
      </motion.header>

      {/* HERO SECTION */}
      <section className="relative z-10 pt-32 pb-20 md:pt-48 md:pb-40 min-h-screen flex items-center">
        <div className="max-w-7xl mx-auto px-6 w-full">
          <div className="flex flex-col lg:flex-row items-center gap-16">

            {/* Left Column (Copy) */}
            <motion.div
              className="lg:w-1/2 flex flex-col items-start text-left"
              initial={{ opacity: 0, x: -50 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
            >
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-sm border border-white/10 text-aisummit-cinnabar text-[10px] font-bold uppercase tracking-[0.3em] mb-8 bg-white/5 backdrop-blur-sm">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-aisummit-cinnabar opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-aisummit-cinnabar"></span>
                </span>
                Tech-Summit AI
              </div>

              <h1 className="text-6xl md:text-8xl font-black tracking-tighter mb-8 text-aisummit-text leading-[0.9] uppercase">
                INSTAGRAM <br />
                <span className="text-aisummit-cinnabar">
                  AUTOPILOT
                </span>
              </h1>

              <p className="text-lg md:text-xl text-white/50 font-medium mb-12 max-w-xl">
                10,000+ možností. 2 minuty na nastavení. Náš inteligentní systém funguje jako váš osobní AI architekt, stavějící monumentální obsahovou strategii bez halucinací.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
                <Link href="/register" className="group relative inline-flex items-center justify-center gap-3 px-10 py-5 bg-aisummit-cinnabar text-white rounded-sm font-bold text-lg transition-all hover:bg-aisummit-cinnabar/90 uppercase tracking-widest">
                  Spustit Autopilota <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </Link>
                <Link href="#demo" className="group inline-flex items-center justify-center gap-3 px-10 py-5 bg-transparent border border-white/20 hover:border-white/50 text-white rounded-sm font-bold uppercase tracking-widest transition-all">
                  Přehrát Demo
                </Link>
              </div>

              <div className="mt-10 flex items-center gap-8 text-xs font-bold uppercase tracking-wider text-white/40">
                <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-aisummit-cinnabar" /> 14 Days Free</div>
                <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-aisummit-cinnabar" /> No Credit Card</div>
              </div>
            </motion.div>

            {/* Right Column (Hero Graphic/App Preview) */}
            <motion.div
              className="lg:w-1/2 relative perspective-1000"
              initial={{ opacity: 0, scale: 0.9, rotateY: 20 }}
              animate={{ opacity: 1, scale: 1, rotateY: 0 }}
              transition={{ duration: 1, delay: 0.3, type: "spring", bounce: 0.4 }}
            >
              <div className="relative rounded-sm border border-white/10 bg-[#0a0a0a] overflow-hidden shadow-2xl transform-gpu rotate-x-12 rotate-y-[-10deg] scale-105 group hover:rotate-0 hover:scale-100 transition-all duration-700">
                {/* Mac OS Header */}
                <div className="h-10 border-b border-white/5 bg-[#0f0f0f] px-4 flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-white/20"></div>
                    <div className="w-3 h-3 rounded-full bg-white/20"></div>
                    <div className="w-3 h-3 rounded-full bg-white/20"></div>
                  </div>
                  <div className="mx-auto px-4 py-1 text-[10px] text-white/40 font-bold tracking-[0.2em] uppercase">Control Panel</div>
                </div>

                {/* Fake App Content */}
                <div className="p-6 h-[400px] flex gap-6 relative bg-[#050505]">
                  {/* Fake Sidebar */}
                  <div className="w-1/4 flex flex-col gap-4 border-r border-white/5 pr-4">
                    <div className="h-6 w-full rounded-sm bg-white/5 animate-pulse"></div>
                    <div className="h-6 w-3/4 rounded-sm bg-white/5"></div>
                    <div className="h-6 w-5/6 rounded-sm bg-white/5"></div>
                    <div className="h-6 w-2/3 rounded-sm bg-white/5"></div>
                    <div className="h-px w-full bg-white/10 my-4"></div>
                    <div className="h-10 w-full rounded-sm bg-aisummit-cinnabar shadow-md font-bold text-[10px] text-white flex items-center justify-center tracking-[0.2em] uppercase">+ Init Sequence</div>
                  </div>
                  {/* Fake Main Area */}
                  <div className="flex-1 flex flex-col gap-4">
                    <div className="flex justify-between items-center mb-2">
                      <div className="h-10 w-1/3 rounded-sm bg-white/5"></div>
                      <div className="h-8 px-4 rounded-sm bg-aisummit-cinnabar/10 border border-aisummit-cinnabar/30 flex items-center justify-center text-aisummit-cinnabar text-[10px] uppercase tracking-widest font-bold shadow-sm">Online</div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="h-32 rounded-sm bg-[#0a0a0a] border border-white/10 shadow-sm relative overflow-hidden transition-colors">
                        <div className="absolute inset-x-0 bottom-0 h-10 bg-[#0f0f0f] p-2 flex items-center border-t border-white/5"><div className="w-5 h-5 rounded-sm text-[10px] bg-white/10 text-white flex items-center justify-center">⚙️</div><div className="ml-2 h-2 w-1/2 bg-white/20 rounded-sm"></div></div>
                      </div>
                      <div className="h-32 rounded-sm bg-[#0a0a0a] border border-white/10 shadow-sm relative overflow-hidden transition-colors delay-75">
                        <div className="absolute inset-x-0 bottom-0 h-10 bg-white/80 backdrop-blur-md p-2 flex items-center border-t border-zinc-100"><div className="w-5 h-5 rounded-[0.4rem] text-[10px] bg-rose-50 text-rose-500 flex items-center justify-center border border-rose-100">✨</div><div className="ml-2 h-2 w-3/4 bg-zinc-200 rounded-full"></div></div>
                      </div>
                    </div>
                    <div className="flex-1 mt-2 rounded-[1.5rem] bg-white border border-zinc-100 shadow-sm p-5 flex flex-col gap-4">
                      <div className="h-3 w-full bg-zinc-100 rounded-full"></div>
                      <div className="h-3 w-5/6 bg-zinc-100 rounded-full"></div>
                      <div className="h-3 w-4/6 bg-zinc-100 rounded-full"></div>
                    </div>
                  </div>

                  {/* Glow overlay effect on hover */}
                  <div className="absolute inset-0 bg-gradient-to-tr from-rose-500/0 via-amber-500/0 to-sky-500/0 group-hover:from-rose-500/[0.03] group-hover:via-amber-500/[0.03] group-hover:to-sky-500/[0.02] transition-all duration-700 pointer-events-none"></div>
                </div>
              </div>

              {/* Floating badges */}
              <motion.div
                className="absolute -right-6 top-10 bg-white border border-zinc-200/60 rounded-3xl p-5 shadow-[0_8px_30px_rgba(0,0,0,0.08)] backdrop-blur-xl flex items-center gap-4"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 1, duration: 0.5 }}
              >
                <div className="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center"><CheckCircle2 className="w-6 h-6 text-emerald-500" /></div>
                <div>
                  <p className="text-zinc-900 font-bold text-sm">30 Postů vygenerováno</p>
                  <p className="text-zinc-500 text-xs mt-0.5">Ušetřeno: 12 hodin práce</p>
                </div>
              </motion.div>
            </motion.div>
          </div>
        </div>

        {/* Scroll indicator */}
        <motion.div
          className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
          style={{ opacity }}
        >
          <span className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-bold">Objevte víc</span>
          <div className="w-px h-10 bg-gradient-to-b from-white/20 to-transparent"></div>
        </motion.div>
      </section>

      {/* BENTO GRID (FEATURES) */}
      <section id="features" className="relative z-10 max-w-7xl mx-auto px-6 py-32">
        <div className="mb-20">
          <h2 className="text-5xl md:text-6xl font-black tracking-tighter mb-6 text-aisummit-text leading-[1.1] uppercase">Vše, co potřebuje <br /><span className="text-white/40">moderní značka.</span></h2>
          <p className="text-xl text-white/50 font-medium max-w-2xl leading-relaxed">Zahodili jsme složité nástroje. ProdámeVás je postavené na jedné věci: generování prémiových výsledků, které nevypadají jako od AI.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 md:auto-rows-[300px]">

          {/* Big Feature 1 */}
          <div className="md:col-span-2 md:row-span-2 group relative overflow-hidden rounded-sm bg-[#0a0a0a] border border-white/10 p-10 flex flex-col justify-end transition-all shadow-md hover:border-white/20 duration-500">
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

            {/* Abstract Graphic */}
            <div className="absolute top-10 right-10 w-56 h-56 bg-aisummit-cinnabar/10 rounded-full blur-[80px] group-hover:bg-aisummit-cinnabar/20 transition-all duration-700" />
            <Bot className="absolute top-12 right-12 w-32 h-32 text-aisummit-cinnabar/30 group-hover:scale-110 group-hover:rotate-12 transition-all duration-700" />

            <div className="relative z-10">
              <div className="w-14 h-14 rounded-sm bg-white/5 flex items-center justify-center mb-8 border border-white/10 group-hover:border-aisummit-cinnabar/50 group-hover:bg-aisummit-cinnabar/10 transition-colors">
                <Sparkles className="w-6 h-6 text-aisummit-cinnabar" />
              </div>
              <h3 className="text-3xl font-bold uppercase tracking-widest mb-4 text-white group-hover:text-aisummit-cinnabar transition-colors">Kognitivní Autopilot</h3>
              <p className="text-white/50 text-lg font-medium leading-relaxed max-w-md">Gemini Pro 1.5 analyzuje vaši tóninu komunikace, historii z Instagram API a strategické pilíře. Pak chrlí měsíce obsahu naprosto bez halucinací.</p>
            </div>
          </div>

          {/* Feature 2 */}
          <div className="md:col-span-2 group relative overflow-hidden rounded-sm bg-[#0a0a0a] border border-white/10 p-10 shadow-md hover:border-white/20 transition-all duration-500">
            <div className="absolute inset-0 bg-gradient-to-br from-aisummit-glow/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="absolute top-0 right-0 w-40 h-40 bg-aisummit-glow/20 rounded-full blur-[60px] opacity-0 group-hover:opacity-100 transition-all duration-700"></div>
            <LayoutTemplate className="w-10 h-10 text-aisummit-glow mb-6 relative z-10" />
            <h3 className="text-2xl font-bold uppercase tracking-widest text-white mb-3 relative z-10">Multi-tenant Architektura</h3>
            <p className="text-white/50 font-medium leading-relaxed relative z-10">Spravujete 10 klientů? Žádný problém. Náš systém striktně odděluje znalostní sady, loga a data per projekt. Přepínání na jedno kliknutí.</p>
          </div>

          {/* Feature 3 */}
          <div className="md:col-span-1 group relative overflow-hidden rounded-sm bg-[#0a0a0a] border border-white/10 p-8 shadow-md hover:border-white/20 transition-all duration-500 flex flex-col justify-center">
            <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity" />
            <PenTool className="w-8 h-8 text-white mb-5 relative z-10" />
            <h3 className="text-xl font-bold uppercase tracking-widest text-white mb-2 relative z-10">Design <br />& Mockupy</h3>
            <p className="text-white/50 text-sm font-medium relative z-10">Generátor vymyslí potisk produktu a ihned ho nasadí na fotorealistický obal, láhev nebo billboard.</p>
          </div>

          {/* Feature 4 */}
          <div className="md:col-span-1 group relative overflow-hidden rounded-sm bg-aisummit-cinnabar border border-aisummit-cinnabar p-8 shadow-md hover:bg-aisummit-cinnabar/90 transition-all duration-500 flex items-center justify-center text-center">
            <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="relative z-10">
              <TrendingUp className="w-10 h-10 text-white mb-5 mx-auto" />
              <h3 className="text-4xl font-black text-white mb-2">+380%</h3>
              <p className="text-white/80 text-xs font-bold uppercase tracking-[0.2em]">Dosah Klientů</p>
            </div>
          </div>

        </div>
      </section>

      {/* CTA SECTION */}
      <section className="relative py-48 overflow-hidden z-10 border-t border-white/10 mt-12 bg-aisummit-bg">
        <div className="absolute inset-0 bg-aisummit-bg z-0" />

        {/* Soft aurora orb */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-aisummit-glow/10 blur-[150px] rounded-full pointer-events-none mix-blend-screen" />

        {/* Grid lines */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:4rem_4rem]"></div>

        <div className="relative z-10 max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-6xl md:text-8xl font-black tracking-tighter mb-8 text-white uppercase leading-[0.9]">Nenechte utéct <br /> <span className="text-aisummit-cinnabar">konkurenci.</span></h2>
          <p className="text-xl text-white/50 font-medium mb-14 max-w-2xl mx-auto">Váš první plně automatizovaný měsíc obsahu na Instagram čeká na vygenerování. Zapojte se a zničte tvůrčí blok.</p>

          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <Link href="/register" className="group relative inline-flex items-center justify-center px-12 py-6 bg-aisummit-cinnabar text-white rounded-sm font-bold text-lg hover:bg-aisummit-cinnabar/90 transition-all uppercase tracking-widest shadow-xl">
              Vytvořit účet zdarma
              <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="relative z-10 border-t border-white/10 bg-[#050505] py-20">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="md:col-span-2">
            <div className="flex items-center gap-3 mb-8">
              <div className="relative w-10 h-10 rounded bg-aisummit-cinnabar flex items-center justify-center overflow-hidden">
                <LogoPV className="relative z-10 text-white w-5 h-5" />
              </div>
              <span className="font-bold tracking-tighter text-xl text-white uppercase">Prodáme<span className="text-aisummit-cinnabar">Vás</span></span>
            </div>
            <p className="text-white/50 font-medium max-w-sm leading-relaxed">Prémiový SaaS nástroj pro automatizaci a akceleraci firemních sociálních sítí. Využíváme ty nejlepší AI modely na trhu pro dosažení dokonalých výsledků.</p>
          </div>
          <div>
            <h4 className="font-bold mb-6 text-white tracking-widest uppercase text-xs">Produkt</h4>
            <ul className="space-y-4 text-xs tracking-wider uppercase text-white/40 font-bold">
              <li><Link href="#features" className="hover:text-aisummit-cinnabar transition-colors">Platforma</Link></li>
              <li><Link href="#pricing" className="hover:text-aisummit-cinnabar transition-colors">Ceník</Link></li>
              <li><Link href="#" className="hover:text-aisummit-cinnabar transition-colors">Agenturní API</Link></li>
              <li><Link href="/login" className="hover:text-white transition-colors text-white/80">Přihlášení klienta</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-bold mb-6 text-white tracking-widest uppercase text-xs">Právní</h4>
            <ul className="space-y-4 text-xs tracking-wider uppercase text-white/40 font-bold">
              <li><Link href="#" className="hover:text-aisummit-cinnabar transition-colors">Obchodní podmínky</Link></li>
              <li><Link href="#" className="hover:text-aisummit-cinnabar transition-colors">Zpracování dat</Link></li>
              <li><Link href="#" className="hover:text-aisummit-cinnabar transition-colors">Cookies politika</Link></li>
            </ul>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-6 pt-12 mt-16 border-t border-white/10 flex flex-col md:flex-row justify-between items-center text-[10px] text-white/30 font-bold tracking-[0.2em] uppercase">
          <p>© 2026 ProdámeVás.cz SaaS AI</p>
          <div className="mt-4 md:mt-0 flex gap-6">
            <span>Tech-Summit Edition _0.1</span>
          </div>
        </div>
      </footer>
    </main>
  )
}
