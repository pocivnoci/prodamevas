"use client"

import React, { useEffect, useState } from "react"
import Link from "next/link"
import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion"
import { Bot, PenTool, ArrowRight, CheckCircle2, Layers, Cpu } from "lucide-react"
import { LiveDemoWidget } from "@/components/LiveDemoWidget"
import { WaitlistForm } from "@/components/WaitlistForm"

const SHOWCASE_POSTS = [
  {
    src: "/showcase-1.png",
    alt: "Chrlit AI post — Challenge pro CEO",
    caption: "🎯 CHALLENGE: Změř si, kolik času ti tento týden reálně sežere tvorba obsahu. Výsledek tě překvapí. Získej zpět svůj čas jako CEO — nech AI pracovat za tebe.",
    hashtags: "#chrlit #aiobsah #ceo #productivita #marketing #autopilot #challenge",
  },
  {
    src: "/showcase-2.png",
    alt: "Chrlit AI post — Kreativní peklo",
    caption: "😱 Tvoje tvář, když klient pošle feedback 'Můžeme to udělat víc… pop?' Konec kreativního pekla. Chrlit generuje obsah, který sedí od první verze.",
    hashtags: "#chrlit #kreativnipeklo #socialmanager #aiobsah #meme #marketing",
  },
  {
    src: "/showcase-3.png",
    alt: "Chrlit AI post — Lepší vstup",
    caption: "🤖 Tvoje AI plive generické bláboly? Problém není v ní. Lepší vstup = lepší výstup. Chrlit analyzuje tvůj brand a generuje obsah, který mluví tvým jazykem.",
    hashtags: "#chrlit #ai #marketing #brandvoice #content #kvalitniobsah",
  },
]

export default function Home() {
  const [scrolled, setScrolled] = useState(false)
  const [selectedShowcase, setSelectedShowcase] = useState<number | null>(null)
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
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-aisummit-cinnabar rounded-sm flex items-center justify-center text-white font-black text-sm">C</div>
            <span className="font-black tracking-tight text-xl text-white">chrl<span className="text-aisummit-cinnabar">it</span></span>
          </Link>
          
          <div className="flex items-center gap-6">
            <Link href="#demo" className="text-[10px] font-bold uppercase tracking-widest text-white/30 hover:text-white transition-colors hidden sm:block">
              Demo
            </Link>
            <Link href="#pricing" className="text-[10px] font-bold uppercase tracking-widest text-white/30 hover:text-white transition-colors hidden sm:block">
              Ceník
            </Link>
            <Link href="/login" className="text-[10px] font-bold uppercase tracking-widest text-white/50 hover:text-white transition-colors hidden sm:block">
              Přihlásit se
            </Link>
            <Link href="#waitlist" className="group relative inline-flex items-center gap-2 text-[10px] font-bold px-6 py-2.5 bg-white/10 hover:bg-white text-white hover:text-black rounded-sm transition-all uppercase tracking-widest">
              Připojit se
              <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
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
                CHRLÍME<br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-aisummit-cinnabar to-amber-500">
                  OBSAH.
                </span>
                <br />
                <span className="text-white/30 text-4xl md:text-5xl tracking-wide">Ale kvalitní.</span>
              </h1>
              
              <p className="text-lg text-white/40 font-medium mb-10 max-w-lg leading-relaxed">
                Zadejte web svého podnikání. AI pochopí váš styl, vytvoří texty, obrázky i hashtagy — a vy máte měsíc obsahu připravený k publikaci. Bez grafika, bez copywritera.
              </p>

              <div id="waitlist" className="w-full sm:w-auto mt-6 mb-8 relative z-20">
                <WaitlistForm />
              </div>
            </motion.div>
            {/* SHOWCASE — real Chrlit-generated posts */}
            <motion.div 
              className="lg:w-1/2 relative w-full"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
            >
              <div className="relative">
                {/* Label */}
                <div className="text-center mb-4">
                  <span className="text-[9px] font-bold uppercase tracking-[0.3em] text-white/20">Reálné výstupy z Chrlit · klikni pro detail</span>
                </div>

                {/* Instagram-style grid */}
                <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                  {SHOWCASE_POSTS.map((post, i) => (
                    <motion.div
                      key={i}
                      className="aspect-square rounded-sm overflow-hidden border border-white/5 group cursor-pointer relative"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.4 + i * 0.3, duration: 0.5 }}
                      onClick={() => setSelectedShowcase(i)}
                    >
                      <img 
                        src={post.src} 
                        alt={post.alt}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-300 flex items-center justify-center">
                        <span className="text-white/0 group-hover:text-white/80 text-[10px] font-black uppercase tracking-widest transition-all">Detail</span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Showcase Modal */}
      <AnimatePresence>
        {selectedShowcase !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={() => setSelectedShowcase(null)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-[#0a0a0a] border border-white/10 rounded-sm max-w-lg w-full overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <img 
                src={SHOWCASE_POSTS[selectedShowcase].src}
                alt={SHOWCASE_POSTS[selectedShowcase].alt}
                className="w-full aspect-square object-cover"
              />
              <div className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 bg-aisummit-cinnabar rounded-full flex items-center justify-center text-white text-[8px] font-black">C</div>
                  <span className="text-white/60 text-[10px] font-bold">chrlit.cz</span>
                  <span className="text-white/20 text-[9px] ml-auto">Vygenerováno AI</span>
                </div>
                <p className="text-white/60 text-sm leading-relaxed">{SHOWCASE_POSTS[selectedShowcase].caption}</p>
                <p className="text-aisummit-cinnabar/50 text-[10px] font-bold mt-3">{SHOWCASE_POSTS[selectedShowcase].hashtags}</p>
              </div>
              <div className="px-5 py-3 border-t border-white/5">
                <button onClick={() => setSelectedShowcase(null)} className="text-[9px] font-black uppercase tracking-widest text-white/30 hover:text-white transition-colors">
                  ✕ Zavřít
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* SOCIAL PROOF STRIP */}
      <section className="relative z-10 py-16 border-t border-white/5">
        <div className="max-w-5xl mx-auto px-6">
          <p className="text-center text-[9px] font-bold uppercase tracking-[0.3em] text-white/20 mb-8">Testujeme na firmách z různých oborů</p>
          <div className="flex flex-wrap justify-center gap-x-8 gap-y-3">
            {["🏨 Hotely", "🍷 Vinařství", "💇 Salóny", "🚚 Stěhování", "🎪 Zábava", "🏗️ Stavby", "☕ Kavárny", "🛒 E-shopy", "🏋️ Fitness", "📸 Fotografie"].map((item, i) => (
              <span key={i} className="text-white/25 text-xs font-bold tracking-wider hover:text-white/50 transition-colors">{item}</span>
            ))}
          </div>
        </div>
      </section>

      {/* TIME SAVED COMPARISON */}
      <section className="relative z-10 py-32 border-t border-white/5 bg-[#050505]">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter mb-4 text-white uppercase">Kolik času<br /><span className="text-aisummit-cinnabar">reálně ušetříte?</span></h2>
            <p className="text-white/50 font-medium text-lg max-w-2xl mx-auto">Spočítali jsme to. Tady je srovnání klasického přístupu vs. Chrlit — na reálných úkolech, které řešíte každý týden.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
            {/* Traditional */}
            <div className="bg-[#0a0a0a] border border-white/5 rounded-sm p-8">
              <div className="text-[10px] font-black uppercase tracking-widest text-white/20 mb-6">❌ Klasický přístup</div>
              <div className="space-y-4">
                {[
                  { task: "Vymyslet téma příspěvku", time: "30 min" },
                  { task: "Napsat caption + CTA", time: "45 min" },
                  { task: "Vytvořit vizuál (Canva/grafik)", time: "60 min" },
                  { task: "Vybrat hashtagy", time: "15 min" },
                  { task: "Naplánovat na měsíc (20 postů)", time: "~30 hodin" },
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between border-b border-white/5 pb-3">
                    <span className="text-white/40 text-xs">{item.task}</span>
                    <span className="text-white/60 text-xs font-black">{item.time}</span>
                  </div>
                ))}
              </div>
              <div className="mt-6 pt-4 border-t border-white/10">
                <span className="text-white/30 text-[10px] font-bold uppercase tracking-widest">Celkem na měsíc</span>
                <div className="text-3xl font-black text-white/80 mt-1">~30 hodin</div>
              </div>
            </div>

            {/* Chrlit */}
            <div className="bg-[#0a0a0a] border-2 border-aisummit-cinnabar/30 rounded-sm p-8 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-aisummit-cinnabar/5 blur-[80px] rounded-full pointer-events-none" />
              <div className="relative z-10">
                <div className="text-[10px] font-black uppercase tracking-widest text-aisummit-cinnabar mb-6">✓ S Chrlitem</div>
                <div className="space-y-4">
                  {[
                    { task: "AI navrhne témata z vašeho webu", time: "0 min" },
                    { task: "AI napíše caption ve vašem stylu", time: "0 min" },
                    { task: "AI vytvoří vizuál s vašimi barvami", time: "0 min" },
                    { task: "AI vybere hashtagy podle oboru", time: "0 min" },
                    { task: "20 postů na měsíc", time: "~15 min" },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center justify-between border-b border-white/5 pb-3">
                      <span className="text-white/50 text-xs">{item.task}</span>
                      <span className="text-emerald-400 text-xs font-black">{item.time}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-6 pt-4 border-t border-aisummit-cinnabar/20">
                  <span className="text-aisummit-cinnabar/50 text-[10px] font-bold uppercase tracking-widest">Celkem na měsíc</span>
                  <div className="text-3xl font-black text-aisummit-cinnabar mt-1">~15 minut</div>
                  <div className="text-emerald-400 text-[10px] font-black uppercase tracking-widest mt-1">Ušetříte 29+ hodin měsíčně</div>
                </div>
              </div>
            </div>
          </div>

          <p className="text-center text-white/20 text-[10px] font-bold uppercase tracking-widest">Čas je odhadován na základě průměrného social media manažera · 20 příspěvků/měsíc</p>
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

      {/* INTERACTIVE DEMO */}
      <section id="demo" className="relative py-32 border-t border-white/5 bg-[#0a0a0a] overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(192,57,43,0.05),transparent_70%)] pointer-events-none" />
        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <div className="text-center mb-12">
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter mb-4 text-white uppercase">Čím víc tvoříte,<br /><span className="text-aisummit-cinnabar">tím lepší obsah dostáváte.</span></h2>
            <p className="text-white/50 font-medium text-lg max-w-2xl mx-auto">Chrlit se učí z vašich výsledků. Každý like, každý uložený příspěvek — to vše pomáhá AI lépe pochopit vaše publikum. Spusťte ukázku a sledujte celý cyklus.</p>
          </div>
          <LiveDemoWidget />
        </div>
      </section>


      {/* PRICING SECTION */}
      <section id="pricing" className="relative py-32 border-t border-white/5 bg-[#050505]">
        <div className="absolute top-0 left-1/2 w-[800px] h-[400px] bg-aisummit-cinnabar/5 blur-[150px] rounded-full pointer-events-none" style={{ transform: 'translateX(-50%)' }} />
        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter mb-4 text-white uppercase">Kolik ušetříte<br /><span className="text-aisummit-cinnabar">oproti agentuře?</span></h2>
            <p className="text-white/50 font-medium text-lg max-w-xl mx-auto">Social media manažer stojí 25 000 Kč měsíčně. Chrlit zvládne to samé od 450 Kč — a pracuje 24 hodin denně.</p>
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
                <span className="text-4xl font-black text-white">450</span>
                <span className="text-white/40 text-sm font-black ml-1">Kč</span>
              </div>
              <p className="text-white/30 text-[10px] font-bold mb-6">měsíčně · bez závazku</p>
              <div className="bg-white/5 rounded-sm px-3 py-2 mb-6 border border-white/5">
                <span className="text-white font-black text-sm">30</span>
                <span className="text-white/40 text-[10px] font-bold ml-1">kreditů/měs</span>
                <span className="text-white/20 text-[9px] block">~15 Kč/kredit</span>
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
              <Link href="#waitlist" className="block text-center py-3 px-4 rounded-sm border border-white/15 text-white/60 font-bold text-[10px] uppercase tracking-widest hover:bg-white/5 hover:text-white transition-all">
                Připojit se
              </Link>
            </div>

            {/* ─── CREATOR ─── */}
            <div className="rounded-sm border border-white/10 bg-[#0a0a0a] p-6 flex flex-col relative overflow-hidden group hover:border-white/20 transition-all">
              <div className="mb-6">
                <h3 className="text-lg font-black uppercase tracking-widest text-white mb-1">Creator</h3>
                <p className="text-white/40 text-[10px] font-medium">Pro freelancery a kreativce</p>
              </div>
              <div className="mb-1">
                <span className="text-4xl font-black text-white">890</span>
                <span className="text-white/40 text-sm font-black ml-1">Kč</span>
              </div>
              <p className="text-white/30 text-[10px] font-bold mb-6">měsíčně · bez závazku</p>
              <div className="bg-white/5 rounded-sm px-3 py-2 mb-6 border border-white/5">
                <span className="text-white font-black text-sm">70</span>
                <span className="text-white/40 text-[10px] font-bold ml-1">kreditů/měs</span>
                <span className="text-white/20 text-[9px] block">~13 Kč/kredit · dobíjecí 5 Kč/ks</span>
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
              <Link href="#waitlist" className="block text-center py-3 px-4 rounded-sm border border-white/15 text-white/60 font-bold text-[10px] uppercase tracking-widest hover:bg-white/5 hover:text-white transition-all">
                Připojit se
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
                <span className="text-4xl font-black text-white">1 690</span>
                <span className="text-white/40 text-sm font-black ml-1">Kč</span>
              </div>
              <p className="text-white/30 text-[10px] font-bold mb-6">měsíčně · bez závazku</p>
              <div className="relative z-10 bg-aisummit-cinnabar/10 rounded-sm px-3 py-2 mb-6 border border-aisummit-cinnabar/20">
                <span className="text-white font-black text-sm">150</span>
                <span className="text-white/60 text-[10px] font-bold ml-1">kreditů/měs</span>
                <span className="text-white/30 text-[9px] block">~11 Kč/kredit · dobíjecí 4 Kč/ks</span>
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
              <Link href="#waitlist" className="relative z-10 block text-center py-3 px-4 rounded-sm bg-aisummit-cinnabar text-white font-bold text-[10px] uppercase tracking-widest hover:bg-aisummit-cinnabar/90 transition-all shadow-[0_0_25px_rgba(230,57,70,0.4)]">
                Připojit se
              </Link>
            </div>

            {/* ─── PRO ─── */}
            <div className="rounded-sm border border-white/10 bg-[#0a0a0a] p-6 flex flex-col relative overflow-hidden group hover:border-white/20 transition-all">
              <div className="mb-6">
                <h3 className="text-lg font-black uppercase tracking-widest text-white mb-1">Pro</h3>
                <p className="text-white/40 text-[10px] font-medium">Maximální objem + priorita</p>
              </div>
              <div className="mb-1">
                <span className="text-4xl font-black text-white">3 290</span>
                <span className="text-white/40 text-sm font-black ml-1">Kč</span>
              </div>
              <p className="text-white/30 text-[10px] font-bold mb-6">měsíčně · bez závazku</p>
              <div className="bg-white/5 rounded-sm px-3 py-2 mb-6 border border-white/5">
                <span className="text-white font-black text-sm">320</span>
                <span className="text-white/40 text-[10px] font-bold ml-1">kreditů/měs</span>
                <span className="text-white/20 text-[9px] block">~10 Kč/kredit · dobíjecí 3.5 Kč/ks</span>
              </div>
              <ul className="space-y-2.5 mb-8 flex-1">
                {[
                  { t: "10 projektů" },
                  { t: "Vše z Business" },
                  { t: "Prioritní generování ⚡" },
                  { t: "320 kreditů měsíčně" },
                  { t: "Nejlevnější dobíjecí kredity" },
                ].map((f, i) => (
                  <li key={i} className="flex items-center gap-2.5 text-xs text-white/60">
                    <CheckCircle2 className="w-3.5 h-3.5 text-blue-400/60 shrink-0" />
                    {f.t}
                  </li>
                ))}
              </ul>
              <Link href="#waitlist" className="block text-center py-3 px-4 rounded-sm border border-white/15 text-white/60 font-bold text-[10px] uppercase tracking-widest hover:bg-white/5 hover:text-white transition-all">
                Připojit se
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
                <span className="text-4xl font-black text-white">6 990</span>
                <span className="text-white/40 text-sm font-black ml-1">Kč</span>
              </div>
              <p className="text-white/30 text-[10px] font-bold mb-6">měsíčně · bez závazku</p>
              <div className="bg-emerald-500/5 rounded-sm px-3 py-2 mb-6 border border-emerald-500/10">
                <span className="text-white font-black text-sm">750</span>
                <span className="text-white/40 text-[10px] font-bold ml-1">kreditů/měs</span>
                <span className="text-white/20 text-[9px] block">~9 Kč/kredit · dobíjecí 3 Kč/ks</span>
              </div>
              <ul className="space-y-2.5 mb-8 flex-1">
                {[
                  { t: "25 projektů" },
                  { t: "Vše z Pro" },
                  { t: "750 kreditů měsíčně" },
                  { t: "Prioritní generování ⚡" },
                  { t: "Přednostní podpora do 4h" },
                ].map((f, i) => (
                  <li key={i} className="flex items-center gap-2.5 text-xs text-white/60">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    {f.t}
                  </li>
                ))}
              </ul>
              <Link href="#waitlist" className="block text-center py-3 px-4 rounded-sm border border-emerald-500/30 text-emerald-400 font-bold text-[10px] uppercase tracking-widest hover:bg-emerald-500/10 hover:text-emerald-300 transition-all">
                Připojit se
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

          <Link href="#waitlist" className="group relative inline-flex items-center justify-center px-10 py-5 bg-white text-black rounded-sm font-black text-sm hover:bg-white/90 transition-all uppercase tracking-widest shadow-[0_0_40px_rgba(255,255,255,0.2)]">
            Připojit se na Waitlist <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
          </Link>
          
          <p className="mt-6 text-[9px] uppercase tracking-widest font-bold text-white/30">7 dní zdarma. Žádná kreditka. Zrušit kdykoliv.</p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-white/5 bg-[#020202] py-16 relative z-10">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-6 h-6 bg-aisummit-cinnabar rounded-sm flex items-center justify-center text-white font-black text-[10px]">C</div>
              <span className="font-black tracking-tight text-base text-white">chrl<span className="text-aisummit-cinnabar">it</span></span>
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
          <p>© {new Date().getFullYear()} Chrlit.cz</p>
          <div className="mt-2 md:mt-0">Testováno na 10+ firmách z různých oborů</div>
        </div>
      </footer>
    </main>
  )
}
