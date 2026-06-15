"use client"

import React, { useEffect, useState } from "react"
import Link from "next/link"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowRight, CheckCircle2, ChevronDown, Cpu, Camera, TrendingUp } from "lucide-react"
import { HeroPlayground, type PlaygroundPost } from "@/components/HeroPlayground"
import { SeedToFlower } from "@/components/SeedToFlower"
import { References } from "@/components/References"
import { WaitlistForm } from "@/components/WaitlistForm"
import { REFERENCE_BRANDS } from "@/lib/reference-data"

const PLACEHOLDER_SHOWCASE: PlaygroundPost[] = [
  {
    src: "/showcase-1.png",
    alt: "Příspěvek vygenerovaný v Chrlit pro kavárnu",
    industry: "☕ Kavárna",
    domain: "kavarna-uroh.cz",
    caption: "Pondělí se dá zvládnout dvěma způsoby. My doporučujeme ten s čerstvě praženou etiopskou. ☕ Do 10:00 ke každému cappuccinu domácí skořicový šnek za polovinu. Přijďte si pro lepší start týdne.",
    hashtags: "#kavarna #specialitycoffee #cappuccino #snidane #kavaspolu #domacipece #dobrerano",
  },
  {
    src: "/showcase-2.png",
    alt: "Příspěvek vygenerovaný v Chrlit pro kadeřnictví",
    industry: "✂️ Kadeřnictví",
    domain: "salon-lenka.cz",
    caption: "Proměna, ze které máme radost celý den. ✂️ Z dlouhých vlasů odvážný bob — a paní Lence neskutečně sluší. Chystáte změnu i vy? Na příští týden zbývají poslední tři volné termíny.",
    hashtags: "#kadernictvi #promena #novyucs #bob #vlasy #salon #objednejtese",
  },
  {
    src: "/showcase-3.png",
    alt: "Příspěvek vygenerovaný v Chrlit pro vinařství",
    industry: "🍷 Vinařství",
    domain: "vinarstvi-morava.cz",
    caption: "Ryzlink z loňské sklizně právě dozrál v lahvích. 🍷 Suchý, svěží, s tóny zeleného jablka — přesně takový, jaký z naší trati má být. V sobotu otevíráme sklep. Přijďte ochutnat jako první.",
    hashtags: "#vinarstvi #ryzlink #morava #vino #degustace #otevrenesklepy #ceskevino",
  },
]

// Hero playground uses REAL generated reference posts when available (written by
// scripts/export-references.ts), and falls back to the placeholders otherwise.
function hostFromUrl(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, "") } catch { return u.replace(/^https?:\/\//, "") }
}

const SHOWCASE_POSTS: PlaygroundPost[] = (() => {
  const withPosts = REFERENCE_BRANDS.filter((b) => b.posts.length > 0).slice(0, 4)
  if (withPosts.length === 0) return PLACEHOLDER_SHOWCASE
  return withPosts.map((b) => {
    const p = b.posts[0]
    return {
      src: p.imageUrl,
      alt: `Příspěvek vygenerovaný v Chrlit pro ${b.company}`,
      industry: `${b.emoji} ${b.industry.split("/").pop()?.trim() || b.industry}`,
      domain: hostFromUrl(b.website),
      caption: p.caption,
      hashtags: p.hashtags,
    }
  })
})()

export default function Home() {
  const [scrolled, setScrolled] = useState(false)

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
            <img src="/chrlit-logo-transparent.svg" alt="Chrlit" className="h-8" />
          </Link>

          <div className="flex items-center gap-6">
            <Link href="#reference" className="text-[10px] font-bold uppercase tracking-widest text-white/30 hover:text-white transition-colors hidden sm:block">
              Ukázky
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

      {/* HERO — the promise + the playable magic moment */}
      <section className="relative z-10 pt-32 pb-16 md:pt-44 md:pb-24 min-h-[92vh] flex items-center">
        <div className="max-w-7xl mx-auto px-6 w-full">
          <div className="grid lg:grid-cols-2 items-center gap-12 lg:gap-16">

            {/* LEFT — the promise + waitlist */}
            <motion.div
              className="flex flex-col items-start"
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, delay: 0.1 }}
            >
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-sm border border-emerald-500/20 text-emerald-400 text-[9px] font-bold uppercase tracking-widest mb-8 bg-emerald-500/5 backdrop-blur-sm">
                <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span></span>
                Brzy spouštíme · Waitlist otevřený
              </div>

              <h1 className="text-5xl md:text-6xl xl:text-7xl font-black tracking-tighter mb-6 text-white leading-[0.92] uppercase">
                Hotový Instagram.<br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-aisummit-cinnabar to-amber-500">
                  Aniž hnete prstem.
                </span>
              </h1>

              <p className="text-lg text-white/45 font-medium mb-8 max-w-md leading-relaxed">
                Profesionální příspěvky — fotky, texty i hashtagy. Hotové. Vy je jen zveřejníte.
              </p>

              <div id="waitlist" className="w-full sm:max-w-md mt-2 relative z-20">
                <WaitlistForm />
              </div>

              <p className="mt-5 text-[9px] uppercase tracking-widest font-bold text-white/25">
                3 posty zdarma na zkoušku · Bez kreditky · Zrušit kdykoliv
              </p>
            </motion.div>

            {/* RIGHT — the playable proof */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
            >
              <HeroPlayground posts={SHOWCASE_POSTS} />
            </motion.div>
          </div>
        </div>
      </section>

      {/* PROOF GALLERY — real generated posts, grouped by brand */}
      <References />

      {/* THE WOW — your brand, in everything, forever */}
      <section id="demo" className="relative py-28 border-t border-white/5 bg-[#0a0a0a] overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(192,57,43,0.05),transparent_70%)] pointer-events-none" />
        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <div className="text-center mb-14">
            <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-white/20 mb-4">Co vás odlišuje</p>
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter mb-4 text-white uppercase">Z jednoho semínka<br /><span className="text-aisummit-cinnabar">celý váš Instagram.</span></h2>
            <p className="text-white/50 font-medium text-lg max-w-2xl mx-auto">Vaše značka je semínko. Všechno, co z něj vyroste, vypadá jako vy — ne jako generická AI.</p>
          </div>
          <SeedToFlower />
        </div>
      </section>

      {/* WHAT YOU GET — three benefit cards (compact, value-framed) */}
      <section className="relative z-10 py-28 border-t border-white/5 bg-[#050505]">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14 max-w-2xl mx-auto">
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter mb-4 text-white uppercase">Co dostanete</h2>
            <p className="text-white/50 font-medium text-lg">Žádný program k učení. Jen hotový obsah, který vypadá profesionálně.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              { Icon: Cpu, title: "Měsíc obsahu dopředu", desc: "Desítky hotových příspěvků připravených k publikaci. Vy už jen klikáte." },
              { Icon: Camera, title: "Fotky produktů bez focení", desc: "Realistické vizuály vašich produktů. Bez fotografa, bez ateliéru." },
              { Icon: TrendingUp, title: "Učí se, co vaše lidi baví", desc: "Sleduje, co funguje — a každý další příspěvek je o kus lepší." },
            ].map(({ Icon, title, desc }, i) => (
              <motion.div
                key={i}
                className="group bg-[#0a0a0a] border border-white/10 rounded-sm p-8 hover:border-aisummit-cinnabar/30 transition-colors"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.5 }}
              >
                <div className="w-11 h-11 rounded-sm bg-white/5 flex items-center justify-center mb-6 border border-white/10 group-hover:bg-aisummit-cinnabar/20 group-hover:border-aisummit-cinnabar/30 transition-colors">
                  <Icon className="w-5 h-5 text-white group-hover:text-aisummit-cinnabar transition-colors" />
                </div>
                <h3 className="text-base font-black uppercase tracking-widest text-white mb-2">{title}</h3>
                <p className="text-white/40 text-sm leading-relaxed">{desc}</p>
              </motion.div>
            ))}
          </div>

          <p className="text-center mt-12 text-[9px] font-bold uppercase tracking-[0.3em] text-white/20">
            Funguje pro kavárny · hotely · e-shopy · salóny · vinařství · fitness · řemeslníky
          </p>
        </div>
      </section>

      {/* STAKES + ANCHOR — loss aversion, one clean price anchor */}
      <section className="relative z-10 py-28 border-t border-white/5 bg-[#050505] overflow-hidden">
        <div className="absolute top-0 left-1/2 w-[700px] h-[400px] bg-aisummit-cinnabar/5 blur-[140px] rounded-full pointer-events-none" style={{ transform: 'translateX(-50%)' }} />
        <div className="max-w-4xl mx-auto px-6 text-center relative z-10">
          <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-white/20 mb-5">Zatímco váháte</p>
          <h2 className="text-4xl md:text-6xl font-black tracking-tighter text-white uppercase leading-[0.95] mb-6">
            Vaši zákazníci scrollují.<br /><span className="text-aisummit-cinnabar">Konkurence postuje.</span>
          </h2>
          <p className="text-white/50 font-medium text-lg max-w-xl mx-auto">
            Jediný, kdo na Instagramu mlčí, jste vy. Ne protože nechcete — protože na to není čas. Chrlit ten čas vrací.
          </p>

          {/* the anchor */}
          <div className="mt-14 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
            <div className="bg-[#0a0a0a] border border-white/5 rounded-sm p-8">
              <div className="text-[10px] font-black uppercase tracking-widest text-white/25 mb-3">Agentura</div>
              <div className="text-3xl md:text-4xl font-black text-white/40 line-through decoration-white/20">15–20 000 Kč</div>
              <div className="text-white/25 text-[10px] font-bold uppercase tracking-widest mt-2">měsíčně</div>
            </div>
            <div className="bg-[#0a0a0a] border-2 border-aisummit-cinnabar/30 rounded-sm p-8 relative overflow-hidden shadow-[0_0_60px_rgba(230,57,70,0.12)]">
              <div className="absolute top-0 right-0 w-[200px] h-[200px] bg-aisummit-cinnabar/10 blur-[60px] rounded-full pointer-events-none" />
              <div className="relative z-10">
                <div className="text-[10px] font-black uppercase tracking-widest text-aisummit-cinnabar mb-3">Chrlit</div>
                <div className="text-3xl md:text-4xl font-black text-white">od 490 Kč</div>
                <div className="text-aisummit-cinnabar/60 text-[10px] font-bold uppercase tracking-widest mt-2">měsíčně</div>
              </div>
            </div>
          </div>
          <p className="mt-6 text-white/30 text-sm font-bold">Za cenu jednoho oběda měsíčně.</p>
        </div>
      </section>

      {/* PRICING — three tiers, no mechanism */}
      <section id="pricing" className="relative py-28 border-t border-white/5 bg-[#050505]">
        <div className="absolute top-0 left-1/2 w-[800px] h-[400px] bg-aisummit-cinnabar/5 blur-[150px] rounded-full pointer-events-none" style={{ transform: 'translateX(-50%)' }} />
        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter mb-4 text-white uppercase">Kolik to stojí?<br /><span className="text-aisummit-cinnabar">Míň, než si myslíte.</span></h2>
            <p className="text-white/50 font-medium text-lg max-w-xl mx-auto">Vyberte si podle toho, jak často chcete postovat. Bez smluv, bez závazků.</p>
          </div>

          <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
            {[
              {
                name: "Start",
                tagline: "Nakopni profil",
                price: 490,
                highlight: false,
                features: [
                  "~4 příspěvky týdně",
                  "Unikátní AI obrázky",
                  "Carousel posty",
                  "Nápady na obsah",
                ],
              },
              {
                name: "Růst",
                tagline: "Rosteme spolu",
                price: 990,
                highlight: true,
                features: [
                  "Obsah na každý den",
                  "Vše ze Start",
                  "Reels — AI video",
                  "A/B varianty příspěvků",
                  "Sledování růstu followerů",
                ],
              },
              {
                name: "Dominance",
                tagline: "Ovládni svůj trh",
                price: 1990,
                highlight: false,
                features: [
                  "Maximum obsahu",
                  "Vše z Růst",
                  "Produktové vizualizace",
                  "Prioritní generování",
                ],
              },
            ].map((plan) => (
              <div
                key={plan.name}
                className={`rounded-sm bg-[#0a0a0a] p-8 relative overflow-hidden flex flex-col ${
                  plan.highlight
                    ? "border-2 border-aisummit-cinnabar shadow-[0_0_80px_rgba(230,57,70,0.12)]"
                    : "border border-white/10"
                }`}
              >
                {plan.highlight && (
                  <>
                    <div className="absolute inset-0 bg-gradient-to-b from-aisummit-cinnabar/5 via-transparent to-transparent pointer-events-none" />
                    <span className="absolute top-4 right-4 text-[8px] bg-aisummit-cinnabar text-white px-2.5 py-1 rounded-full font-black uppercase tracking-widest">Nejoblíbenější</span>
                  </>
                )}

                <div className="relative z-10 mb-6">
                  <h3 className="text-xl font-black uppercase tracking-widest text-white mb-1">{plan.name}</h3>
                  <p className="text-aisummit-cinnabar/80 text-[10px] font-black uppercase tracking-widest">{plan.tagline}</p>
                </div>

                <div className="relative z-10 mb-1">
                  <span className="text-5xl font-black text-white">{plan.price.toLocaleString("cs")}</span>
                  <span className="text-white/40 text-lg font-black ml-2">Kč</span>
                </div>
                <p className="text-white/30 text-[10px] font-bold mb-8">měsíčně · bez závazku · zrušit kdykoliv</p>

                <ul className="space-y-2.5 mb-8 relative z-10 flex-1">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-center gap-2.5 text-xs text-white/70">
                      <CheckCircle2 className="w-3.5 h-3.5 text-aisummit-cinnabar shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>

                <Link
                  href="#waitlist"
                  className={`relative z-10 block text-center py-3.5 px-6 rounded-sm font-bold text-xs uppercase tracking-widest transition-all ${
                    plan.highlight
                      ? "bg-aisummit-cinnabar text-white hover:bg-aisummit-cinnabar/90 shadow-[0_0_30px_rgba(230,57,70,0.4)]"
                      : "bg-white/5 text-white/80 border border-white/10 hover:bg-white/10"
                  }`}
                >
                  Připojit se na Waitlist
                </Link>
              </div>
            ))}
          </div>

          <p className="text-center mt-12 text-[9px] text-white/25 font-bold uppercase tracking-widest">3 posty zdarma na zkoušku · Bez kreditky · Zrušit jedním klikem</p>
        </div>
      </section>

      {/* FAQ — only buying objections */}
      <section id="faq" className="relative py-28 border-t border-white/5 bg-[#0a0a0a]">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(192,57,43,0.04),transparent_60%)] pointer-events-none" />
        <div className="max-w-3xl mx-auto px-6 relative z-10">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter mb-4 text-white uppercase">Než se rozhodnete</h2>
          </div>
          <FaqAccordion />
        </div>
      </section>

      {/* CTA */}
      <section className="relative py-36 overflow-hidden z-10 border-t border-white/5 bg-[#050505]">
        <div className="absolute top-1/2 left-1/2 w-[600px] h-[600px] bg-aisummit-cinnabar/10 blur-[120px] rounded-full pointer-events-none" style={{ transform: 'translate(-50%, -50%)' }} />

        <div className="relative z-10 max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-5xl md:text-7xl font-black tracking-tighter mb-6 text-white uppercase leading-[0.9]">Váš web už máte.<br /> <span className="text-aisummit-cinnabar">Zbytek uděláme my.</span></h2>
          <p className="text-base text-white/40 font-medium mb-12 max-w-xl mx-auto">Vaši zákazníci jsou na Instagramu. Dostaneme vás tam — bez práce.</p>

          <Link href="#waitlist" className="group relative inline-flex items-center justify-center px-10 py-5 bg-white text-black rounded-sm font-black text-sm hover:bg-white/90 transition-all uppercase tracking-widest shadow-[0_0_40px_rgba(255,255,255,0.2)]">
            Připojit se na Waitlist <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
          </Link>

          <p className="mt-6 text-[9px] uppercase tracking-widest font-bold text-white/30">3 posty zdarma na zkoušku. Žádná kreditka. Zrušit kdykoliv.</p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-white/5 bg-[#020202] py-16 relative z-10">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-6">
              <img src="/chrlit-logo-transparent.svg" alt="Chrlit" className="h-6" />
            </div>
            <p className="text-white/30 text-xs font-medium max-w-sm leading-relaxed">Hotový Instagram bez grafika, bez agentury, bez stresu. Vy zveřejníte, my uděláme zbytek.</p>
          </div>
          <div>
            <h4 className="font-bold mb-5 text-white/70 tracking-widest uppercase text-[10px]">Produkt</h4>
            <ul className="space-y-3 text-[10px] tracking-wider uppercase text-white/30 font-bold">
              <li><Link href="#reference" className="hover:text-white transition-colors">Ukázky</Link></li>
              <li><Link href="#pricing" className="hover:text-white transition-colors">Ceník</Link></li>
              <li><Link href="#faq" className="hover:text-white transition-colors">FAQ</Link></li>
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
          <div className="mt-2 md:mt-0">Hotový Instagram z vašeho webu</div>
        </div>
      </footer>
    </main>
  )
}

// ─── FAQ Accordion ──────────────────────────────────────────
// Only buying-objection questions — the "how it works" detail intentionally lives
// inside the product, not on the landing page.

const FAQ_ITEMS = [
  {
    q: "Nepozná se, že to dělá AI?",
    a: "Ne. Každý příspěvek dostane unikátní obrázek ve vašich barvách a text psaný vaším tónem. Vypadá jako od profesionálního social media manažera, ne jako generický AI obsah.",
  },
  {
    q: "Musím něco umět?",
    a: "Vůbec ne. Zadáte adresu svého webu, Chrlit si ji přečte a o zbytek se postará. Žádné psaní zadání, žádné složité nastavování.",
  },
  {
    q: "Potřebuje to přístup k mému Instagramu?",
    a: "Ne. Chrlit nepotřebuje přístup k vašemu účtu. Obsah si stáhnete nebo zkopírujete a zveřejníte sami. Vaše data jsou v bezpečí.",
  },
  {
    q: "Můžu to zrušit kdykoliv?",
    a: "Ano. Žádné smlouvy, žádné závazky — zrušíte jedním klikem. Na vyzkoušení máte 3 posty zdarma, bez kreditky.",
  },
]

function FaqAccordion() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  return (
    <div className="space-y-2">
      {FAQ_ITEMS.map((item, i) => {
        const isOpen = openIndex === i
        return (
          <div
            key={i}
            className={`border rounded-sm overflow-hidden transition-colors duration-300 ${
              isOpen ? "border-white/15 bg-white/[0.03]" : "border-white/5 bg-[#050505] hover:border-white/10"
            }`}
          >
            <button
              onClick={() => setOpenIndex(isOpen ? null : i)}
              className="w-full flex items-center justify-between px-6 py-5 text-left cursor-pointer group"
            >
              <span className={`text-sm font-bold transition-colors ${isOpen ? "text-white" : "text-white/60 group-hover:text-white/80"}`}>
                {item.q}
              </span>
              <motion.div
                animate={{ rotate: isOpen ? 180 : 0 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="ml-4 flex-shrink-0"
              >
                <ChevronDown className={`w-4 h-4 transition-colors ${isOpen ? "text-aisummit-cinnabar" : "text-white/20"}`} />
              </motion.div>
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <div className="px-6 pb-5 border-t border-white/5">
                    <p className="text-white/40 text-sm leading-relaxed pt-4">{item.a}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      })}
    </div>
  )
}
