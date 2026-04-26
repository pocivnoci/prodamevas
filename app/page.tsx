"use client"

import React, { useEffect, useState } from "react"
import Link from "next/link"
import { motion, useScroll, useTransform } from "framer-motion"
import { Sparkles, Bot, PenTool, TrendingUp, ArrowRight, CheckCircle2, Layers, Cpu, BarChart3, Activity } from "lucide-react"
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
            <div className="relative w-8 h-8 bg-aisummit-cinnabar rounded-sm flex items-center justify-center">
              <LogoPV className="text-white w-5 h-5" />
            </div>
            <span className="font-black tracking-tighter text-lg uppercase">Prodáme<span className="text-aisummit-cinnabar">Vás</span> <span className="text-white/30 text-xs font-mono ml-2 tracking-widest hidden sm:inline">STUDIO</span></span>
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
                Gemini 3.1 & Imagen 4 Ready
              </div>

              <h1 className="text-6xl md:text-[5.5rem] font-black tracking-tighter mb-6 text-white leading-[0.9] uppercase">
                INSTAGRAM <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-aisummit-cinnabar to-amber-500">
                  AUTOPILOT.
                </span>
              </h1>
              
              <p className="text-lg text-white/40 font-medium mb-10 max-w-lg leading-relaxed">
                Bez halucinací. Bez kompromisů. 10 000+ možností a 2 minuty na nastavení. Náš inteligentní systém funguje jako váš osobní AI architekt, stavějící monumentální obsahovou strategii za vás.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
                <Link href="/register" className="group relative inline-flex items-center justify-center gap-3 px-8 py-4 bg-aisummit-cinnabar text-white rounded-sm font-black text-sm transition-all hover:bg-aisummit-cinnabar/90 uppercase tracking-widest shadow-[0_0_30px_rgba(230,57,70,0.3)]">
                  Spustit Autopilota <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Link>
                <Link href="#demo" className="group inline-flex items-center justify-center gap-3 px-8 py-4 bg-transparent border border-white/10 hover:border-white/30 hover:bg-white/5 text-white rounded-sm font-bold uppercase tracking-widest transition-all text-sm">
                  Přehrát Demo
                </Link>
              </div>

              <div className="mt-8 flex items-center gap-6 text-[9px] font-bold uppercase tracking-widest text-white/30">
                <div className="flex items-center gap-2"><CheckCircle2 className="w-3 h-3 text-emerald-500" /> 14 Dní Zdarma</div>
                <div className="flex items-center gap-2"><CheckCircle2 className="w-3 h-3 text-emerald-500" /> Žádná karta</div>
              </div>
            </motion.div>

            {/* VISUAL MOCKUP */}
            <motion.div 
              className="lg:w-1/2 relative w-full"
              initial={{ opacity: 0, scale: 0.95, rotateY: 10 }}
              animate={{ opacity: 1, scale: 1, rotateY: 0 }}
              transition={{ duration: 1, delay: 0.2, type: "spring", bounce: 0.3 }}
            >
              <div className="relative rounded-sm border border-white/10 bg-[#050505] overflow-hidden shadow-2xl p-1 group">
                <div className="absolute inset-0 bg-gradient-to-br from-aisummit-cinnabar/10 via-transparent to-emerald-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
                <div className="rounded-sm overflow-hidden bg-[#0a0a0a] border border-white/5 relative z-10 h-[450px] flex flex-col">
                  {/* Top Bar */}
                  <div className="h-10 border-b border-white/5 bg-[#0f0f0f] px-4 flex items-center justify-between">
                    <div className="flex gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-white/20"></div>
                      <div className="w-2.5 h-2.5 rounded-full bg-white/20"></div>
                      <div className="w-2.5 h-2.5 rounded-full bg-white/20"></div>
                    </div>
                    <div className="text-[9px] font-mono text-white/30 uppercase tracking-widest flex items-center gap-2">
                      <Activity className="w-3 h-3 text-emerald-500" /> System Online
                    </div>
                  </div>
                  
                  {/* UI Body */}
                  <div className="flex flex-1 overflow-hidden">
                    {/* Sidebar */}
                    <div className="w-16 border-r border-white/5 flex flex-col items-center py-4 gap-6 bg-[#080808]">
                      <div className="w-8 h-8 rounded-sm bg-white/10 flex items-center justify-center"><Layers className="w-4 h-4 text-white/50" /></div>
                      <div className="w-8 h-8 rounded-sm bg-aisummit-cinnabar/20 text-aisummit-cinnabar flex items-center justify-center border border-aisummit-cinnabar/30 shadow-[0_0_15px_rgba(230,57,70,0.4)]"><Sparkles className="w-4 h-4" /></div>
                      <div className="w-8 h-8 rounded-sm bg-transparent flex items-center justify-center"><BarChart3 className="w-4 h-4 text-white/30" /></div>
                    </div>
                    
                    {/* Main */}
                    <div className="flex-1 p-6 flex flex-col gap-4 bg-[#0a0a0a]">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="h-3 w-32 bg-white/20 rounded-sm mb-2"></div>
                          <div className="h-2 w-48 bg-white/10 rounded-sm"></div>
                        </div>
                        <div className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[8px] font-bold uppercase tracking-widest rounded-sm">Generating</div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4 mt-4">
                        <div className="aspect-square bg-[#0f0f0f] border border-white/5 rounded-sm p-4 relative overflow-hidden flex flex-col justify-between">
                          <div className="h-2 w-1/2 bg-white/20 rounded-sm"></div>
                          <div className="space-y-2">
                            <div className="h-1.5 w-full bg-white/5 rounded-sm"></div>
                            <div className="h-1.5 w-4/5 bg-white/5 rounded-sm"></div>
                          </div>
                          <div className="absolute top-0 right-0 p-3"><Cpu className="w-4 h-4 text-white/20" /></div>
                        </div>
                        <div className="aspect-square bg-gradient-to-br from-aisummit-cinnabar/20 to-amber-500/10 border border-aisummit-cinnabar/20 rounded-sm relative overflow-hidden flex items-center justify-center">
                          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"></div>
                          <Sparkles className="w-8 h-8 text-white relative z-10 animate-pulse" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Floating Stat */}
              <motion.div 
                className="absolute -bottom-6 -right-6 bg-[#0f0f0f] border border-white/10 rounded-sm p-4 shadow-2xl backdrop-blur-xl flex items-center gap-4 z-20"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.8, duration: 0.5 }}
              >
                <div className="w-10 h-10 rounded-sm bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-emerald-500" />
                </div>
                <div>
                  <p className="text-white font-black text-sm uppercase tracking-widest">30 Postů</p>
                  <p className="text-white/40 text-[9px] uppercase tracking-widest mt-0.5">Vygenerováno za 2 min</p>
                </div>
              </motion.div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* SOCIAL PROOF */}
      <section className="border-y border-white/5 bg-[#0a0a0a]/50 backdrop-blur-sm py-12 relative z-10">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-8 opacity-40 grayscale hover:grayscale-0 transition-all duration-500">
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/50 whitespace-nowrap">Důvěřují nám vizionáři</div>
          <div className="flex items-center gap-12 md:gap-24 overflow-hidden">
            <span className="text-lg font-black tracking-widest uppercase">MobilNaMíru</span>
            <span className="text-lg font-black tracking-widest uppercase">HanzFans</span>
            <span className="text-lg font-black tracking-widest uppercase">Ríša Rybář</span>
          </div>
        </div>
      </section>

      {/* BENTO GRID */}
      <section id="features" className="relative z-10 max-w-7xl mx-auto px-6 py-32">
        <div className="mb-20 text-center max-w-3xl mx-auto">
          <h2 className="text-4xl md:text-5xl font-black tracking-tighter mb-6 text-white uppercase">Ukaž, nestřílej <br /><span className="text-white/30">naslepo.</span></h2>
          <p className="text-white/50 font-medium text-lg">Zahodili jsme složité nástroje. ProdámeVás je postavené na jedné věci: generování prémiových výsledků, které nevypadají jako od AI.</p>
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
              <h3 className="text-2xl font-black uppercase tracking-widest mb-3 text-white">Kognitivní Autopilot</h3>
              <p className="text-white/40 text-sm font-medium max-w-md leading-relaxed">Gemini 3.1 analyzuje vaši tóninu, historii z Instagram API a strategické pilíře. Pak chrlí měsíce obsahu naprosto bez halucinací.</p>
            </div>
          </div>

          {/* Box 2: Design & Mockupy */}
          <div className="md:col-span-1 group relative overflow-hidden rounded-sm bg-[#0a0a0a] border border-white/10 p-10 transition-colors hover:border-white/30 flex flex-col justify-end">
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent z-10" />
            <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1618365908648-e71bc5716c11?q=80&w=800&auto=format&fit=crop')] bg-cover bg-center opacity-20 group-hover:opacity-40 group-hover:scale-105 transition-all duration-700" />
            
            <div className="relative z-20">
              <PenTool className="w-6 h-6 text-emerald-400 mb-4" />
              <h3 className="text-xl font-black uppercase tracking-widest text-white mb-2">Design & Mockupy</h3>
              <p className="text-white/60 text-xs font-medium">Generátor vymyslí potisk a ihned ho nasadí na fotorealistický produkt pomocí Imagen 4.</p>
            </div>
          </div>

          {/* Box 3: Multi-tenant */}
          <div className="md:col-span-1 group relative overflow-hidden rounded-sm bg-[#0a0a0a] border border-white/10 p-10 transition-colors hover:border-white/30">
            <Layers className="w-6 h-6 text-amber-500 mb-6" />
            <h3 className="text-xl font-black uppercase tracking-widest text-white mb-3">Multi-tenant pro Agentury</h3>
            <p className="text-white/40 text-xs font-medium leading-relaxed">Spravujete 10 klientů? Systém striktně odděluje znalosti, loga a data per projekt. Přepínání na klik.</p>
          </div>

          {/* Box 4: Performance */}
          <div className="md:col-span-2 group relative overflow-hidden rounded-sm bg-aisummit-cinnabar border border-aisummit-cinnabar p-10 transition-colors flex items-center justify-between">
            <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors" />
            
            <div className="relative z-10">
              <h3 className="text-3xl font-black uppercase tracking-widest text-white mb-2">Neural Brand Engine</h3>
              <p className="text-white/80 text-sm font-medium max-w-sm">Analytika, která rozumí kontextu. Víme, jaký háček zafungoval a proč.</p>
            </div>

            <div className="relative z-10 text-right">
              <div className="text-6xl font-black text-white">+380%</div>
              <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/60 mt-2">Nárůst dosahu</div>
            </div>
          </div>

        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="relative py-32 border-t border-white/5 bg-[#050505]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center gap-16">
            <div className="md:w-1/3">
              <h2 className="text-3xl font-black uppercase tracking-tighter text-white mb-4">Frikce nula.<br/>Výsledek sto.</h2>
              <p className="text-white/40 text-sm">Zapomeňte na zdlouhavé psaní promptů. Celý proces jsme zredukovali na tři brutálně efektivní kroky.</p>
            </div>
            
            <div className="md:w-2/3 grid grid-cols-1 sm:grid-cols-3 gap-6">
              {[
                { step: "01", title: "Brand Voice", desc: "AI analyzuje váš tone of voice a vizuální identitu z pár příkladů." },
                { step: "02", title: "Ideace", desc: "Kognitivní engine vygeneruje obsahové pilíře a strategie." },
                { step: "03", title: "Autopilot", desc: "Systém chrlí hotové posty, mockupy a reels přímo do kalendáře." }
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

      {/* CTA SECTION */}
      <section className="relative py-40 overflow-hidden z-10 border-t border-white/5 bg-[#050505]">
        <div className="absolute top-1/2 left-1/2 w-[600px] h-[600px] bg-aisummit-cinnabar/10 blur-[120px] rounded-full pointer-events-none" style={{ transform: 'translate(-50%, -50%)' }} />
        
        <div className="relative z-10 max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-5xl md:text-7xl font-black tracking-tighter mb-6 text-white uppercase leading-[0.9]">Nenechte utéct <br /> <span className="text-aisummit-cinnabar">konkurenci.</span></h2>
          <p className="text-base text-white/40 font-medium mb-12 max-w-xl mx-auto">Váš první plně automatizovaný měsíc obsahu na Instagram čeká na vygenerování. Zničte tvůrčí blok ještě dnes.</p>

          <Link href="/register" className="group relative inline-flex items-center justify-center px-10 py-5 bg-white text-black rounded-sm font-black text-sm hover:bg-white/90 transition-all uppercase tracking-widest shadow-[0_0_40px_rgba(255,255,255,0.2)]">
            Vytvořit účet zdarma
            <ArrowRight className="w-4 h-4 ml-3 group-hover:translate-x-1 transition-transform" />
          </Link>
          
          <p className="mt-6 text-[9px] uppercase tracking-widest font-bold text-white/30">14 dní zdarma. Žádná kreditka. Možnost zrušit kdykoliv.</p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-white/5 bg-[#020202] py-16 relative z-10">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-6 h-6 bg-aisummit-cinnabar rounded-sm flex items-center justify-center">
                <LogoPV className="text-white w-3 h-3" />
              </div>
              <span className="font-black tracking-tighter text-base text-white uppercase">Prodáme<span className="text-aisummit-cinnabar">Vás</span></span>
            </div>
            <p className="text-white/30 text-xs font-medium max-w-sm leading-relaxed">Prémiový SaaS nástroj pro automatizaci firemních sociálních sítí poháněný modely Gemini a Imagen.</p>
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
              <li><Link href="#" className="hover:text-white transition-colors">Obchodní podmínky</Link></li>
              <li><Link href="#" className="hover:text-white transition-colors">Zpracování dat</Link></li>
            </ul>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-6 pt-10 mt-12 border-t border-white/5 flex flex-col md:flex-row justify-between items-center text-[9px] text-white/20 font-bold tracking-[0.2em] uppercase">
          <p>© 2026 ProdámeVás.cz</p>
          <div className="mt-2 md:mt-0">Tech-Summit Edition _0.2</div>
        </div>
      </footer>
    </main>
  )
}
