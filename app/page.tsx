"use client"

import React, { useEffect, useState } from "react"
import Link from "next/link"
import { motion, useScroll, useTransform } from "framer-motion"
import { Sparkles, Bot, PenTool, TrendingUp, ArrowRight, CheckCircle2, Layers, Cpu } from "lucide-react"
import { LogoPV } from "@/components/LogoPV"
import { SeedOfLife } from "@/components/SeedOfLife"

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
      
      {/* BACKGROUND EFFECTS */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden transform-gpu">
        <div className="hidden md:block absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-aisummit-glow/10 rounded-full blur-[120px] opacity-40 animate-pulse" style={{ animationDuration: '8s' }}></div>
        <div className="hidden md:block absolute top-[20%] right-[-10%] w-[40%] h-[60%] bg-emerald-500/5 rounded-full blur-[120px] opacity-30 animate-pulse" style={{ animationDuration: '12s' }}></div>
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:3rem_3rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]"></div>
      </div>

      {/* HEADER */}
      <motion.header 
        className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${scrolled ? 'bg-[#050505]/80 backdrop-blur-xl border-b border-white/5' : 'bg-transparent pt-6'}`}
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LogoPV className="w-8 h-8 rounded-sm" />
            <span className="font-black tracking-tighter text-lg uppercase">Chr<span className="text-aisummit-cinnabar">lit</span></span>
          </div>
          
          <div className="flex items-center gap-6">
            <Link href="/login" className="text-[10px] font-bold uppercase tracking-widest text-white/50 hover:text-white transition-colors hidden sm:block">
              Přihlásit se
            </Link>
            <Link href="/register" className="group relative inline-flex items-center gap-2 text-[10px] font-bold px-6 py-2.5 bg-white/10 hover:bg-white text-white hover:text-black rounded-sm transition-all uppercase tracking-widest">
              Začít zdarma
            </Link>
          </div>
        </div>
      </motion.header>

      {/* HERO SECTION */}
      <section className="relative z-10 pt-40 pb-20 md:pt-52 md:pb-32 min-h-[90vh] flex items-center">
        <div className="max-w-7xl mx-auto px-6 w-full">
          <div className="flex flex-col lg:flex-row items-center gap-16">
            
            {/* COPY */}
            <motion.div 
              className="lg:w-1/2 flex flex-col items-start"
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, delay: 0.1 }}
            >
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-sm border border-emerald-500/20 text-emerald-400 text-[9px] font-bold uppercase tracking-widest mb-8 bg-emerald-500/5 backdrop-blur-sm">
                <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span></span>
                Obsah na měsíc za pár minut
              </div>

              <h1 className="text-6xl md:text-[5.5rem] font-black tracking-tighter mb-6 text-white leading-[0.9] uppercase">
                POSTY NA<br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-aisummit-cinnabar to-amber-500">
                  INSTAGRAM?
                </span>
                <br />
                <span className="text-white/30 text-4xl md:text-5xl">Hotovo.</span>
              </h1>
              
              <p className="text-lg text-white/40 font-medium mb-10 max-w-lg leading-relaxed">
                Zadejte web svého podnikání. AI pochopí váš styl, vytvoří texty, obrázky i hashtagy — a vy máte měsíc obsahu připravený k publikaci. Bez grafika, bez copywritera.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
                <Link href="/register" className="group relative inline-flex items-center justify-center gap-3 px-8 py-4 bg-aisummit-cinnabar text-white rounded-sm font-black text-sm transition-all hover:bg-aisummit-cinnabar/90 uppercase tracking-widest shadow-[0_0_30px_rgba(230,57,70,0.3)]">
                  Vyzkoušet zdarma <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Link>
                <Link href="#demo" className="group inline-flex items-center justify-center gap-3 px-8 py-4 bg-transparent border border-white/10 hover:border-white/30 hover:bg-white/5 text-white rounded-sm font-bold uppercase tracking-widest transition-all text-sm">
                  Ukázat jak to funguje ↓
                </Link>
              </div>

              <div className="mt-8 flex items-center gap-6 text-[9px] font-bold uppercase tracking-widest text-white/30">
                <div className="flex items-center gap-2"><CheckCircle2 className="w-3 h-3 text-emerald-500" /> 7 Dní Trial Zdarma</div>
                <div className="flex items-center gap-2"><CheckCircle2 className="w-3 h-3 text-emerald-500" /> Bez kreditky</div>
              </div>
            </motion.div>
            {/* WORKFLOW ANIMATION */}
            <motion.div 
              className="lg:w-1/2 relative w-full"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
            >
              <div className="space-y-3">
                {/* Step 1 — web */}
                <motion.div 
                  className="rounded-sm border border-white/10 bg-[#0a0a0a] p-5 flex items-center gap-4 group hover:border-white/20 transition-all"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4, duration: 0.5 }}
                >
                  <div className="w-10 h-10 shrink-0 rounded-sm bg-aisummit-cinnabar/15 border border-aisummit-cinnabar/25 flex items-center justify-center">
                    <span className="text-aisummit-cinnabar font-black text-sm">01</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-bold text-sm">Zadáte web vašeho podnikání</p>
                    <p className="text-white/30 text-[10px] mt-0.5">chrlit.cz</p>
                  </div>
                  <div className="px-2 py-0.5 bg-emerald-500/15 border border-emerald-500/25 rounded-sm text-emerald-400 text-[8px] font-bold uppercase shrink-0">Hotovo ✓</div>
                </motion.div>

                {/* Connector */}
                <div className="flex justify-center">
                  <div className="w-px h-4 bg-gradient-to-b from-white/10 to-white/5"></div>
                </div>

                {/* Step 2 — analysis */}
                <motion.div 
                  className="rounded-sm border border-white/10 bg-[#0a0a0a] p-5 flex items-center gap-4 group hover:border-white/20 transition-all"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.7, duration: 0.5 }}
                >
                  <div className="w-10 h-10 shrink-0 rounded-sm bg-amber-500/15 border border-amber-500/25 flex items-center justify-center">
                    <span className="text-amber-400 font-black text-sm">02</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-bold text-sm">AI analyzuje váš brand</p>
                    <p className="text-white/30 text-[10px] mt-0.5">Barvy · Tón komunikace · Produkty · Cílovka</p>
                  </div>
                  <div className="px-2 py-0.5 bg-emerald-500/15 border border-emerald-500/25 rounded-sm text-emerald-400 text-[8px] font-bold uppercase shrink-0">Hotovo ✓</div>
                </motion.div>

                {/* Connector */}
                <div className="flex justify-center">
                  <div className="w-px h-4 bg-gradient-to-b from-white/10 to-white/5"></div>
                </div>

                {/* Step 3 — generation */}
                <motion.div 
                  className="rounded-sm border border-aisummit-cinnabar/30 bg-[#0a0a0a] p-5 group"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 1.0, duration: 0.5 }}
                >
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-10 h-10 shrink-0 rounded-sm bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
                      <span className="text-emerald-400 font-black text-sm">03</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-bold text-sm">Dostanete hotový obsah</p>
                      <p className="text-white/30 text-[10px] mt-0.5">30 postů · texty · obrázky · hashtagy</p>
                    </div>
                  </div>
                  {/* Mini post preview */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-sm bg-gradient-to-br from-aisummit-cinnabar/20 to-amber-500/10 border border-white/5 p-2.5">
                      <p className="text-white/60 text-[9px] leading-relaxed">☕ Pon-dělní inspirace? U nás to není jen káva — je to rituál...</p>
                      <p className="text-aisummit-cinnabar/50 text-[8px] mt-1.5 font-bold">#chrlit #obsah</p>
                    </div>
                    <div className="rounded-sm bg-gradient-to-br from-blue-600/15 to-emerald-500/10 border border-white/5 p-2.5">
                      <p className="text-white/60 text-[9px] leading-relaxed">🚀 Jak vyřešit správu sociálních sítí za zlomek nákladů?</p>
                      <p className="text-blue-400/50 text-[8px] mt-1.5 font-bold">#ai #marketing</p>
                    </div>
                    <div className="rounded-sm bg-gradient-to-br from-purple-600/15 to-pink-500/10 border border-white/5 p-2.5">
                      <p className="text-white/60 text-[9px] leading-relaxed">🎯 3 tipy, jak zvýšit engagement na Instagramu...</p>
                      <p className="text-purple-400/50 text-[8px] mt-1.5 font-bold">#instagram #tipy</p>
                    </div>
                  </div>
                </motion.div>
              </div>
              
              {/* Floating Stat */}
              <motion.div 
                className="absolute -bottom-4 -right-4 bg-[#0f0f0f] border border-white/10 rounded-sm p-4 shadow-2xl backdrop-blur-xl flex items-center gap-4 z-20"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 1.5, duration: 0.5 }}
              >
                <div className="w-10 h-10 rounded-sm bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-emerald-500" />
                </div>
                <div>
                  <p className="text-white font-black text-sm uppercase tracking-widest">30 Postů</p>
                  <p className="text-white/40 text-[9px] uppercase tracking-widest mt-0.5">Vygenerováno za ~30 min</p>
                </div>
              </motion.div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* BENTO GRID */}
      <section id="features" className="relative z-10 max-w-7xl mx-auto px-6 py-32">
        <div className="mb-20 text-center max-w-3xl mx-auto">
          <h2 className="text-4xl md:text-5xl font-black tracking-tighter mb-6 text-white uppercase">Co dostanete<br /><span className="text-white/30">za pár kliků.</span></h2>
          <p className="text-white/50 font-medium text-lg">Žádné složité nástroje. Řeknete nám o svém podnikání a Chrlit vám dodá hotový obsah — texty, obrázky, hashtagy. Vypadá to profesionálně, ne jako od robota.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:auto-rows-[320px]">
          
          {/* Box 1: Kognitivní Autopilot */}
          <div className="md:col-span-2 group relative overflow-hidden rounded-sm bg-[#0a0a0a] border border-white/10 p-10 flex flex-col justify-end transition-colors hover:border-white/30">
            <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-aisummit-cinnabar/5 rounded-full blur-[80px] group-hover:bg-aisummit-cinnabar/10 transition-colors duration-700 pointer-events-none" />
            <Bot className="absolute top-10 right-10 w-24 h-24 text-white/5 group-hover:scale-110 group-hover:text-aisummit-cinnabar/20 transition-all duration-700" />
            
            <div className="relative z-10">
              <div className="w-12 h-12 rounded-sm bg-white/5 flex items-center justify-center mb-6 border border-white/10 group-hover:bg-aisummit-cinnabar/20 group-hover:border-aisummit-cinnabar/30 transition-colors">
                <Cpu className="w-5 h-5 text-white group-hover:text-aisummit-cinnabar" />
              </div>
              <h3 className="text-2xl font-black uppercase tracking-widest mb-3 text-white">Celý měsíc obsahu za vás</h3>
              <p className="text-white/40 text-sm font-medium max-w-md leading-relaxed">AI se naučí váš styl komunikace, vaše barvy, vaši cílovku — a pak vygeneruje desítky hotových postů. Texty, obrázky, hashtagy. Stačí publikovat.</p>
            </div>
          </div>

          {/* Box 2: Design & Mockupy */}
          <div className="md:col-span-1 group relative overflow-hidden rounded-sm bg-[#0a0a0a] border border-white/10 p-10 transition-colors hover:border-white/30 flex flex-col justify-end">
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent z-10" />
            <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1618365908648-e71bc5716c11?q=80&w=800&auto=format&fit=crop')] bg-cover bg-center opacity-20 group-hover:opacity-40 group-hover:scale-105 transition-all duration-700" />
            
            <div className="relative z-20">
              <PenTool className="w-6 h-6 text-emerald-400 mb-4" />
              <h3 className="text-xl font-black uppercase tracking-widest text-white mb-2">Produktové vizualizace</h3>
              <p className="text-white/60 text-xs font-medium">Máte nápad na produkt? AI navrhne design a ukáže vám realistický mockup — tričko, hrnek, krabičku. Bez grafika.</p>
            </div>
          </div>

          {/* Box 3: Multi-tenant */}
          <div className="md:col-span-1 group relative overflow-hidden rounded-sm bg-[#0a0a0a] border border-white/10 p-10 transition-colors hover:border-white/30">
            <Layers className="w-6 h-6 text-amber-500 mb-6" />
            <h3 className="text-xl font-black uppercase tracking-widest text-white mb-3">Víc značek? Žádný problém</h3>
            <p className="text-white/40 text-xs font-medium leading-relaxed">Spravujete obsah pro více firem nebo klientů? Každý projekt má vlastní nastavení, loga a styl. Přepínáte jedním klikem.</p>
          </div>

          {/* Box 4: Performance */}
          <div className="md:col-span-2 group relative overflow-hidden rounded-sm bg-aisummit-cinnabar border border-aisummit-cinnabar p-10 transition-colors flex items-center justify-between">
            <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors" />
            
            <div className="relative z-10">
              <h3 className="text-3xl font-black uppercase tracking-widest text-white mb-2">Ví, co funguje</h3>
              <p className="text-white/80 text-sm font-medium max-w-sm">Chrlit sleduje, které posty zaujaly vaše publikum — a příští obsah podle toho přizpůsobí. Čím víc ho používáte, tím lepší výsledky.</p>
            </div>

            <div className="relative z-10 text-right">
              <div className="text-6xl font-black text-white">24/7</div>
              <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/60 mt-2">Nepřetržitý provoz</div>
            </div>
          </div>

        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="relative py-32 border-t border-white/5 bg-[#050505]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center gap-16">
            <div className="md:w-1/3">
              <h2 className="text-3xl font-black uppercase tracking-tighter text-white mb-4">Tři kroky.<br/>Hotový Instagram.</h2>
              <p className="text-white/40 text-sm">Žádné promptování, žádné složité nastavování. Prostě zadáte web, počkáte minutu a máte obsah.</p>
            </div>
            
            <div className="md:w-2/3 grid grid-cols-1 sm:grid-cols-3 gap-6">
              {[
                { step: "01", title: "Zadejte web", desc: "AI prozkoumá váš web, pochopí čím se zabýváte, jaké máte barvy a styl." },
                { step: "02", title: "Vyberte, co chcete", desc: "Posty na Instagram? Produktové nápady? Vizualizace? Vyberte si a nechte AI pracovat." },
                { step: "03", title: "Hotovo", desc: "Za pár minut máte hotové posty s obrázky, texty a hashtagy. Stačí publikovat." }
              ].map((item, i) => (
                <div key={i} className="bg-[#0a0a0a] border border-white/5 p-6 rounded-sm relative">
                  <div className="text-4xl font-black text-white/5 absolute top-4 right-4">{item.step}</div>
                  <div className="w-8 h-8 rounded-sm bg-white/5 text-white flex items-center justify-center font-bold text-xs mb-6 border border-white/10">{item.step}</div>
                  <h4 className="text-sm font-black uppercase tracking-widest text-white mb-2">{item.title}</h4>
                  <p className="text-xs text-white/40 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* DEMO SECTION — Seed of Life: Self-Learning Loop */}
      <section id="demo" className="relative py-32 border-t border-white/5 bg-[#0a0a0a] overflow-hidden">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter mb-4 text-white uppercase">Čím víc tvoříte,<br /><span className="text-aisummit-cinnabar">tím lepší obsah dostáváte.</span></h2>
            <p className="text-white/50 font-medium text-lg max-w-2xl mx-auto">Chrlit se učí z vašich výsledků. Každý like, každý uložený příspěvek — to vše pomáhá AI lépe pochopit vaše publikum a tvořit přesnější obsah.</p>
          </div>
          <SeedOfLife />
        </div>
      </section>


      {/* PRICING SECTION */}
      <section id="pricing" className="relative py-32 border-t border-white/5 bg-[#050505]">
        <div className="absolute top-0 left-1/2 w-[800px] h-[400px] bg-aisummit-cinnabar/5 blur-[150px] rounded-full pointer-events-none" style={{ transform: 'translateX(-50%)' }} />
        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter mb-4 text-white uppercase">Kolik ušetříte<br /><span className="text-aisummit-cinnabar">oproti agentuře?</span></h2>
            <p className="text-white/50 font-medium text-lg max-w-xl mx-auto">Social media manažer stojí 25 000 Kč měsíčně. Chrlit zvládne to samé od 490 Kč — a pracuje 24 hodin denně.</p>
            <div className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-sm border border-emerald-500/30 bg-emerald-500/10 backdrop-blur-sm">
              <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span></span>
              <span className="text-emerald-400 text-sm font-black">Kreditový systém — platíte jen za to, co skutečně použijete</span>
            </div>
          </div>

          {/* Plan cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 max-w-7xl mx-auto items-stretch">

            {/* ─── STARTER ─── */}
            <div className="rounded-sm border border-white/10 bg-[#0a0a0a] p-6 flex flex-col relative overflow-hidden group hover:border-white/20 transition-all">
              <div className="mb-6">
                <h3 className="text-lg font-black uppercase tracking-widest text-white mb-1">Starter</h3>
                <p className="text-white/40 text-[10px] font-medium">Pro začínající tvůrce</p>
              </div>
              <div className="mb-1">
                <span className="text-4xl font-black text-white">490</span>
                <span className="text-white/40 text-sm font-black ml-1">Kč</span>
              </div>
              <p className="text-white/30 text-[10px] font-bold mb-6">měsíčně · bez závazku</p>
              <div className="bg-white/5 rounded-sm px-3 py-2 mb-6 border border-white/5">
                <span className="text-white font-black text-sm">20</span>
                <span className="text-white/40 text-[10px] font-bold ml-1">kreditů/měs</span>
                <span className="text-white/20 text-[9px] block">~24 Kč/kredit</span>
              </div>
              <ul className="space-y-2.5 mb-8 flex-1">
                {[
                  { t: "1 projekt", on: true },
                  { t: "Posty s AI obrázky", on: true },
                  { t: "AI captiony + hashtagy", on: true },
                  { t: "Základní analytika", on: true },
                  { t: "Varianty příspěvků", on: false },
                  { t: "Produktový pipeline", on: false },
                ].map((f, i) => (
                  <li key={i} className={`flex items-center gap-2.5 text-xs ${f.on ? 'text-white/60' : 'text-white/20 line-through'}`}>
                    <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${f.on ? 'text-white/30' : 'text-white/10'}`} />
                    {f.t}
                  </li>
                ))}
              </ul>
              <Link href="/register" className="block text-center py-3 px-4 rounded-sm border border-white/15 text-white/60 font-bold text-[10px] uppercase tracking-widest hover:bg-white/5 hover:text-white transition-all">
                Začít
              </Link>
            </div>

            {/* ─── CREATOR ─── */}
            <div className="rounded-sm border border-white/10 bg-[#0a0a0a] p-6 flex flex-col relative overflow-hidden group hover:border-white/20 transition-all">
              <div className="mb-6">
                <h3 className="text-lg font-black uppercase tracking-widest text-white mb-1">Creator</h3>
                <p className="text-white/40 text-[10px] font-medium">Pro freelancery a kreativce</p>
              </div>
              <div className="mb-1">
                <span className="text-4xl font-black text-white">990</span>
                <span className="text-white/40 text-sm font-black ml-1">Kč</span>
              </div>
              <p className="text-white/30 text-[10px] font-bold mb-6">měsíčně · bez závazku</p>
              <div className="bg-white/5 rounded-sm px-3 py-2 mb-6 border border-white/5">
                <span className="text-white font-black text-sm">50</span>
                <span className="text-white/40 text-[10px] font-bold ml-1">kreditů/měs</span>
                <span className="text-white/20 text-[9px] block">~20 Kč/kredit · dobíjecí 5 Kč/ks</span>
              </div>
              <ul className="space-y-2.5 mb-8 flex-1">
                {[
                  { t: "2 projekty", on: true },
                  { t: "Vše ze Starter", on: true },
                  { t: "Varianty příspěvků", on: true },
                  { t: "Produktové nápady AI", on: true },
                  { t: "Dobíjecí kredity", on: true },
                  { t: "Design + Mockupy", on: false },
                ].map((f, i) => (
                  <li key={i} className={`flex items-center gap-2.5 text-xs ${f.on ? 'text-white/60' : 'text-white/20 line-through'}`}>
                    <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${f.on ? 'text-amber-500/60' : 'text-white/10'}`} />
                    {f.t}
                  </li>
                ))}
              </ul>
              <Link href="/register" className="block text-center py-3 px-4 rounded-sm border border-white/15 text-white/60 font-bold text-[10px] uppercase tracking-widest hover:bg-white/5 hover:text-white transition-all">
                Začít tvořit
              </Link>
            </div>

            {/* ─── BUSINESS (FEATURED) ─── */}
            <div className="rounded-sm border-2 border-aisummit-cinnabar bg-[#0a0a0a] p-6 flex flex-col relative overflow-hidden group sm:scale-[1.03] shadow-[0_0_60px_rgba(230,57,70,0.15)]">
              <div className="absolute top-0 right-0 bg-aisummit-cinnabar text-white text-[8px] font-black uppercase tracking-widest px-3 py-1">Nejoblíbenější</div>
              <div className="absolute inset-0 bg-gradient-to-b from-aisummit-cinnabar/5 via-transparent to-transparent pointer-events-none" />
              <div className="relative z-10 mb-6">
                <h3 className="text-lg font-black uppercase tracking-widest text-white mb-1">Business</h3>
                <p className="text-white/40 text-[10px] font-medium">Pro firmy — plný pipeline</p>
              </div>
              <div className="relative z-10 mb-1">
                <span className="text-4xl font-black text-white">1 890</span>
                <span className="text-white/40 text-sm font-black ml-1">Kč</span>
              </div>
              <p className="text-white/30 text-[10px] font-bold mb-6">měsíčně · bez závazku</p>
              <div className="relative z-10 bg-aisummit-cinnabar/10 rounded-sm px-3 py-2 mb-6 border border-aisummit-cinnabar/20">
                <span className="text-white font-black text-sm">120</span>
                <span className="text-white/60 text-[10px] font-bold ml-1">kreditů/měs</span>
                <span className="text-white/30 text-[9px] block">~16 Kč/kredit · dobíjecí 4 Kč/ks</span>
              </div>
              <ul className="space-y-2.5 mb-8 flex-1 relative z-10">
                {[
                  { t: "5 projektů" },
                  { t: "Vše z Creator" },
                  { t: "Design pro tisk + Mockupy" },
                  { t: "Vizualizace produktů" },
                  { t: "Business Brief PDF" },
                  { t: "Plná analytika" },
                ].map((f, i) => (
                  <li key={i} className="flex items-center gap-2.5 text-xs text-white/80">
                    <CheckCircle2 className="w-3.5 h-3.5 text-aisummit-cinnabar shrink-0" />
                    {f.t}
                  </li>
                ))}
              </ul>
              <Link href="/register" className="relative z-10 block text-center py-3 px-4 rounded-sm bg-aisummit-cinnabar text-white font-bold text-[10px] uppercase tracking-widest hover:bg-aisummit-cinnabar/90 transition-all shadow-[0_0_25px_rgba(230,57,70,0.4)]">
                Vyzkoušet 7 dní zdarma
              </Link>
            </div>

            {/* ─── PRO ─── */}
            <div className="rounded-sm border border-white/10 bg-[#0a0a0a] p-6 flex flex-col relative overflow-hidden group hover:border-white/20 transition-all">
              <div className="mb-6">
                <h3 className="text-lg font-black uppercase tracking-widest text-white mb-1">Pro</h3>
                <p className="text-white/40 text-[10px] font-medium">Maximální objem + priorita</p>
              </div>
              <div className="mb-1">
                <span className="text-4xl font-black text-white">3 790</span>
                <span className="text-white/40 text-sm font-black ml-1">Kč</span>
              </div>
              <p className="text-white/30 text-[10px] font-bold mb-6">měsíčně · bez závazku</p>
              <div className="bg-white/5 rounded-sm px-3 py-2 mb-6 border border-white/5">
                <span className="text-white font-black text-sm">260</span>
                <span className="text-white/40 text-[10px] font-bold ml-1">kreditů/měs</span>
                <span className="text-white/20 text-[9px] block">~15 Kč/kredit · dobíjecí 3.5 Kč/ks</span>
              </div>
              <ul className="space-y-2.5 mb-8 flex-1">
                {[
                  { t: "10 projektů" },
                  { t: "Vše z Business" },
                  { t: "Prioritní generování ⚡" },
                  { t: "260 kreditů měsíčně" },
                  { t: "Nejlevnější dobíjecí kredity" },
                ].map((f, i) => (
                  <li key={i} className="flex items-center gap-2.5 text-xs text-white/60">
                    <CheckCircle2 className="w-3.5 h-3.5 text-blue-400/60 shrink-0" />
                    {f.t}
                  </li>
                ))}
              </ul>
              <Link href="/register" className="block text-center py-3 px-4 rounded-sm border border-white/15 text-white/60 font-bold text-[10px] uppercase tracking-widest hover:bg-white/5 hover:text-white transition-all">
                Začít s Pro
              </Link>
            </div>

            {/* ─── AGENCY ─── */}
            <div className="rounded-sm border border-white/10 bg-[#0a0a0a] p-6 flex flex-col relative overflow-hidden group hover:border-emerald-500/30 transition-all">
              <div className="absolute top-0 right-0 bg-emerald-500/10 text-emerald-400 text-[8px] font-black uppercase tracking-widest px-3 py-1 border-l border-b border-emerald-500/20">Agentury</div>
              <div className="mb-6">
                <h3 className="text-lg font-black uppercase tracking-widest text-white mb-1">Agency</h3>
                <p className="text-white/40 text-[10px] font-medium">Pro agentury a velké týmy</p>
              </div>
              <div className="mb-1">
                <span className="text-4xl font-black text-white">7 990</span>
                <span className="text-white/40 text-sm font-black ml-1">Kč</span>
              </div>
              <p className="text-white/30 text-[10px] font-bold mb-6">měsíčně · bez závazku</p>
              <div className="bg-emerald-500/5 rounded-sm px-3 py-2 mb-6 border border-emerald-500/10">
                <span className="text-white font-black text-sm">600</span>
                <span className="text-white/40 text-[10px] font-bold ml-1">kreditů/měs</span>
                <span className="text-white/20 text-[9px] block">~13 Kč/kredit · dobíjecí 3 Kč/ks</span>
              </div>
              <ul className="space-y-2.5 mb-8 flex-1">
                {[
                  { t: "25 projektů" },
                  { t: "Vše z Pro" },
                  { t: "600 kreditů měsíčně" },
                  { t: "Prioritní generování ⚡" },
                  { t: "Přednostní podpora do 4h" },
                ].map((f, i) => (
                  <li key={i} className="flex items-center gap-2.5 text-xs text-white/60">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    {f.t}
                  </li>
                ))}
              </ul>
              <Link href="/register" className="block text-center py-3 px-4 rounded-sm border border-emerald-500/30 text-emerald-400 font-bold text-[10px] uppercase tracking-widest hover:bg-emerald-500/10 hover:text-emerald-300 transition-all">
                Začít s Agency
              </Link>
            </div>

          </div>

          {/* Credit costs table */}
          <div className="mt-16 max-w-3xl mx-auto">
            <h3 className="text-center text-sm font-black uppercase tracking-widest text-white/40 mb-6">Kolik stojí jednotlivé AI akce</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { icon: "📸", label: "Post", credits: "1 kredit" },
                { icon: "🔄", label: "Varianta", credits: "1 kredit" },
                { icon: "💡", label: "Nápady", credits: "2 kredity" },
                { icon: "🎨", label: "Vizualizace", credits: "2 kredity" },
                { icon: "👕", label: "Design", credits: "3 kredity" },
                { icon: "📦", label: "Mockup", credits: "2 kredity" },
                { icon: "📄", label: "Business Brief", credits: "5 kreditů" },
                { icon: "💡", label: "Nápady na posty", credits: "1 kredit" },
              ].map((a, i) => (
                <div key={i} className="bg-[#0a0a0a] border border-white/5 rounded-sm px-3 py-2.5 flex items-center gap-2.5">
                  <span className="text-base">{a.icon}</span>
                  <div>
                    <span className="text-[10px] text-white/50 font-bold block">{a.label}</span>
                    <span className="text-[10px] text-aisummit-cinnabar font-black">{a.credits}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Trust line */}
          <p className="text-center mt-12 text-[9px] text-white/25 font-bold uppercase tracking-widest">7 dní trial zdarma · Zrušit kdykoliv · Bez kreditky na trial · Fakturace měsíčně</p>
        </div>
      </section>

      {/* CTA SECTION */}
      <section className="relative py-40 overflow-hidden z-10 border-t border-white/5 bg-[#050505]">
        <div className="absolute top-1/2 left-1/2 w-[600px] h-[600px] bg-aisummit-cinnabar/10 blur-[120px] rounded-full pointer-events-none" style={{ transform: 'translate(-50%, -50%)' }} />
        
        <div className="relative z-10 max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-5xl md:text-7xl font-black tracking-tighter mb-6 text-white uppercase leading-[0.9]">Váš Instagram<br /> <span className="text-aisummit-cinnabar">si zaslouží víc.</span></h2>
          <p className="text-base text-white/40 font-medium mb-12 max-w-xl mx-auto">Přestaňte trávit hodiny vymýšlením co postovat. Nechte AI udělat těžkou práci — vy se soustřeďte na to, co umíte nejlíp.</p>

          <Link href="/register" className="group relative inline-flex items-center justify-center px-10 py-5 bg-white text-black rounded-sm font-black text-sm hover:bg-white/90 transition-all uppercase tracking-widest shadow-[0_0_40px_rgba(255,255,255,0.2)]">
            Vytvořit účet zdarma
            <ArrowRight className="w-4 h-4 ml-3 group-hover:translate-x-1 transition-transform" />
          </Link>
          
          <p className="mt-6 text-[9px] uppercase tracking-widest font-bold text-white/30">7 dní zdarma. Žádná kreditka. Zrušit kdykoliv.</p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-white/5 bg-[#020202] py-16 relative z-10">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-6">
              <LogoPV className="w-6 h-6 rounded-sm" />
              <span className="font-black tracking-tighter text-base text-white uppercase">Chr<span className="text-aisummit-cinnabar">lit</span></span>
            </div>
            <p className="text-white/30 text-xs font-medium max-w-sm leading-relaxed">Obsah na sociální sítě, který vypadá profesionálně — bez grafika, bez copywritera, bez stresu.</p>
          </div>
          <div>
            <h4 className="font-bold mb-5 text-white/70 tracking-widest uppercase text-[10px]">Produkt</h4>
            <ul className="space-y-3 text-[10px] tracking-wider uppercase text-white/30 font-bold">
              <li><Link href="#features" className="hover:text-white transition-colors">Platforma</Link></li>
              <li><Link href="#pricing" className="hover:text-white transition-colors">Ceník</Link></li>
              <li><Link href="/login" className="hover:text-white transition-colors text-white/60">Přihlášení</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-bold mb-5 text-white/70 tracking-widest uppercase text-[10px]">Právní</h4>
            <ul className="space-y-3 text-[10px] tracking-wider uppercase text-white/30 font-bold">
              <li><Link href="/terms" className="hover:text-white transition-colors">Obchodní podmínky</Link></li>
              <li><Link href="/privacy" className="hover:text-white transition-colors">Zpracování dat</Link></li>
            </ul>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-6 pt-10 mt-12 border-t border-white/5 flex flex-col md:flex-row justify-between items-center text-[9px] text-white/20 font-bold tracking-[0.2em] uppercase">
          <p>© 2026 Chrlit.cz</p>
          <div className="mt-2 md:mt-0">Tech-Summit Edition _0.2</div>
        </div>
      </footer>
    </main>
  )
}
