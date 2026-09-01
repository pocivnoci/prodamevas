"use client"

import React, { useEffect, useState } from "react"
import Link from "next/link"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import { ArrowRight, Camera, Check, CheckCircle2, ChevronDown, Clock, Cpu, Menu, TrendingUp, X } from "lucide-react"
import { PostWall, type WallPost } from "@/components/PostWall"
import { SeedToFlower } from "@/components/SeedToFlower"
import { WaitlistForm } from "@/components/WaitlistForm"
import { Reveal } from "@/components/Reveal"
import { fadeUp, SPRING, EASE_OUT } from "@/lib/motion"
import { creditExample } from "@/lib/credits"
import { REFERENCE_BRANDS } from "@/lib/reference-data"
import { LEGAL, formatAddress, vatNotice } from "@/lib/legal"
import {
  BILLING_TERMS,
  DEFAULT_TERM_MONTHS,
  PLAN_COPY,
  formatCzk,
  formatCzkAmount,
  getTerm,
  lowestPriceClaim,
  monthlyEquivalent,
  termLabel,
  termPrice,
  termSavings,
  type PricingPlan,
  type TermMonths,
} from "@/lib/pricing"

function hostFromUrl(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, "") } catch { return u.replace(/^https?:\/\//, "") }
}

// Featured mix on the landing: 2 strongest local-SMB demos + 2 modern startup/app
// demos — proof that speaks to both audiences. Falls back gracefully if a featured
// brand has no posts yet (e.g. startups not generated).
const FEATURED_SLUGS = ["kavarna-zrno", "vinarstvi-pod-strani", "flowtask", "brevia"]

const FEATURED_BRANDS = (() => {
  const withPosts = REFERENCE_BRANDS.filter((b) => b.posts.length > 0)
  const curated = FEATURED_SLUGS
    .map((s) => withPosts.find((b) => b.slug === s))
    .filter((b): b is (typeof withPosts)[number] => Boolean(b))
  return curated.length > 0 ? curated : withPosts.slice(0, 4)
})()

// The post wall shows REAL posts the Chrlit engine generated for Chrlit's OWN
// brand (dogfood). Falls back to the featured demo brands if that data is missing.
const toWall = (b: (typeof REFERENCE_BRANDS)[number]): WallPost[] =>
  b.posts.map((p) => ({
    imageUrl: p.imageUrl,
    caption: p.caption,
    hashtags: p.hashtags,
    company: b.company,
    emoji: b.emoji,
    handle: hostFromUrl(b.website).split(".")[0],
  }))

const WALL_POSTS: WallPost[] = (() => {
  const own = REFERENCE_BRANDS.find((b) => b.slug === "chrlit")
  if (own && own.posts.length > 0) return toWall(own)
  // fallback: round-robin across featured demo brands
  const perBrand = FEATURED_BRANDS.map(toWall)
  const out: WallPost[] = []
  for (let i = 0; out.length < perBrand.reduce((n, a) => n + a.length, 0); i++) {
    for (const arr of perBrand) if (arr[i]) out.push(arr[i])
  }
  return out
})()

/**
 * Landing.
 *
 * Ceny chodí PROPS Z DB (`app/page.tsx` je server komponenta) — tenhle soubor si
 * je nesmí psát sám. Do minule tu byly natvrdo v poli a dashboard je četl z
 * `subscription_plans`, takže se ceník dal změnit na jednom místě a na druhém
 * dál lhát. Pravidlo pro období (kolik měsíců se platí) žije v `lib/pricing.ts`
 * a sdílí ho landing, dashboard i cron obnovy.
 */
export function Landing({
  plans,
  /** Stav `REELS_ENABLED` ze serveru. Vypnuté reels se na kartách ukážou jako
   *  „připravujeme" — prodávat médium, které se potichu překlopí na carousel,
   *  je jediný nález ceníkového auditu, který byl skutečný mis-sale. */
  reelsEnabled,
}: {
  plans: readonly PricingPlan[]
  reelsEnabled: boolean
}) {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [term, setTerm] = useState<TermMonths>(DEFAULT_TERM_MONTHS)
  // Vybraný tarif si drží formulář waitlistu, aby se pozvánka dala poslat rovnou
  // s tím, co si člověk vybral, místo doptávání.
  const [pickedPlan, setPickedPlan] = useState<string | null>(null)
  const onPickPlan = (planId: string, months: TermMonths) => {
    setPickedPlan(planId)
    setTerm(months)
  }
  const reduce = useReducedMotion()

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  return (
    <main className="min-h-screen bg-aisummit-bg text-aisummit-text selection:bg-aisummit-cinnabar/30 selection:text-white overflow-hidden font-sans">

      {/* BACKGROUND EFFECTS */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden transform-gpu">
        <div className="hidden md:block absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-aisummit-glow/10 rounded-full blur-[120px] opacity-40"></div>
        <div className="hidden md:block absolute top-[20%] right-[-10%] w-[40%] h-[60%] bg-emerald-500/5 rounded-full blur-[120px] opacity-30"></div>
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:3rem_3rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]"></div>
      </div>

      {/* HEADER */}
      <motion.header
        className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${scrolled ? 'bg-[#050505]/80 backdrop-blur-xl border-b border-white/5' : 'bg-transparent pt-6'}`}
        initial={reduce ? false : { y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.6, ease: EASE_OUT }}
      >
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <img src="/chrlit-logo-transparent.svg" alt="Chrlit" className="h-8" />
          </Link>

          <div className="flex items-center gap-2 sm:gap-6">
            <Link href="/portfolio" className="text-[10px] font-bold uppercase tracking-widest text-white/30 hover:text-white transition-colors hidden sm:block">
              Portfolio
            </Link>
            <Link href="#reference" className="text-[10px] font-bold uppercase tracking-widest text-white/30 hover:text-white transition-colors hidden sm:block">
              Ukázky
            </Link>
            <Link href="#pricing" className="text-[10px] font-bold uppercase tracking-widest text-white/30 hover:text-white transition-colors hidden sm:block">
              Ceník
            </Link>
            <Link href="/login" className="text-[10px] font-bold uppercase tracking-widest text-white/50 hover:text-white transition-colors hidden sm:block">
              Přihlásit se
            </Link>
            <Link href="#waitlist" className="group relative inline-flex items-center gap-2 text-[10px] font-bold px-5 py-2.5 bg-white/10 hover:bg-white text-white hover:text-black rounded-sm transition-all uppercase tracking-widest">
              Připojit se
              <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
            </Link>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={menuOpen ? "Zavřít menu" : "Otevřít menu"}
              aria-expanded={menuOpen}
              className="sm:hidden inline-flex items-center justify-center w-11 h-11 -mr-2 text-white/70 hover:text-white transition-colors"
            >
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={reduce ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={reduce ? undefined : { opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: EASE_OUT }}
              className="sm:hidden overflow-hidden bg-[#050505]/95 backdrop-blur-xl border-b border-white/5"
            >
              <nav className="max-w-7xl mx-auto px-6 py-3 flex flex-col">
                {[
                  { href: "/portfolio", label: "Portfolio" },
                  { href: "#reference", label: "Ukázky" },
                  { href: "#pricing", label: "Ceník" },
                  { href: "/login", label: "Přihlásit se" },
                ].map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setMenuOpen(false)}
                    className="py-3 text-[11px] font-bold uppercase tracking-widest text-white/50 hover:text-white transition-colors border-b border-white/5 last:border-0"
                  >
                    {l.label}
                  </Link>
                ))}
              </nav>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.header>

      {/* HERO — the promise + waitlist, centered */}
      <section className="relative z-10 pt-32 pb-16 md:pt-40 md:pb-20 min-h-[78dvh] flex items-center">
        <div className="max-w-3xl mx-auto px-6 w-full">
          <motion.div
            className="flex flex-col items-center text-center"
            initial={reduce ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1, ease: EASE_OUT }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-sm border border-emerald-500/20 text-emerald-400 text-[9px] font-bold uppercase tracking-widest mb-8 bg-emerald-500/5 backdrop-blur-sm">
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]"></span>
              Brzy spouštíme · Waitlist otevřený
            </div>

            <h1 className="text-5xl md:text-6xl xl:text-7xl font-black tracking-tighter mb-6 text-white leading-[0.92] uppercase">
              Hotový Instagram.<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-aisummit-cinnabar to-amber-500">
                Bez práce.
              </span>
            </h1>

            <p className="text-lg text-white/45 font-medium mb-8 max-w-md leading-relaxed">
              Profesionální příspěvky — fotky, texty i hashtagy. Hotové. A zveřejní se samy ve chvíli, kterou naplánujete.
            </p>

            <div id="waitlist" className="w-full sm:max-w-md mt-2 relative z-20">
              <WaitlistForm planId={pickedPlan} termMonths={term} />
            </div>

            <p className="mt-5 text-[9px] uppercase tracking-widest font-bold text-white/25">
              3 posty zdarma · Bez kreditky · Bez časového limitu
            </p>
          </motion.div>
        </div>
      </section>

      {/* PROOF — full-width wall of real generated posts (click to open) */}
      <PostWall posts={WALL_POSTS} />

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

          <Reveal stagger className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              { Icon: Cpu, title: "Měsíc obsahu dopředu", desc: "Desítky hotových příspěvků a termín ke každému. Propojíte Instagram a Chrlit je zveřejní sám — nebo počkají, až je potvrdíte." },
              { Icon: Camera, title: "Fotky produktů bez focení", desc: "Realistické vizuály vašich produktů. Bez fotografa, bez ateliéru." },
              { Icon: TrendingUp, title: "Učí se, co vaše lidi baví", desc: "Označíte, co fungovalo — a další příspěvky tím směrem ladí. Čím víc mu řeknete, tím přesnější je." },
            ].map(({ Icon, title, desc }, i) => (
              <motion.div
                key={i}
                className="group bg-[#0a0a0a] border border-white/10 rounded-sm p-8 hover:border-aisummit-cinnabar/30 transition-colors"
                variants={fadeUp}
                whileHover={reduce ? undefined : { y: -3 }}
                whileTap={reduce ? undefined : { scale: 0.99 }}
                transition={SPRING}
              >
                <div className="w-11 h-11 rounded-sm bg-white/5 flex items-center justify-center mb-6 border border-white/10 group-hover:bg-aisummit-cinnabar/20 group-hover:border-aisummit-cinnabar/30 transition-colors">
                  <Icon className="w-5 h-5 text-white group-hover:text-aisummit-cinnabar transition-colors" />
                </div>
                <h3 className="text-base font-black uppercase tracking-widest text-white mb-2">{title}</h3>
                <p className="text-white/40 text-sm leading-relaxed">{desc}</p>
              </motion.div>
            ))}
          </Reveal>

          <p className="text-center mt-12 text-[9px] font-bold uppercase tracking-[0.3em] text-white/20">
            Funguje pro kavárny · hotely · e-shopy · salóny · vinařství · fitness · aplikace · startupy
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
                {/* Číslo se bere z ceníku (lib/pricing.ts), ne z ruky — jinak
                    zůstane po každé změně ceníku viset stará hodnota. */}
                <div className="text-3xl md:text-4xl font-black text-white">od {formatCzk(monthlyEquivalent(plans[0]?.monthlyHaleru ?? 99000, DEFAULT_TERM_MONTHS))}</div>
                <div className="text-aisummit-cinnabar/60 text-[10px] font-bold uppercase tracking-widest mt-2">měsíčně při roční platbě</div>
              </div>
            </div>
          </div>
          <p className="mt-6 text-white/30 text-sm font-bold">Za cenu jednoho oběda měsíčně.</p>
        </div>
      </section>

      {/* QUALIFIER — sits right before pricing on purpose: the price lands on someone who
          has already decided it's for them, and saying out loud who we're NOT for is what
          makes the left-hand column believable. Every "nesedne" item is a real product
          limit, not fake modesty — don't soften them into non-claims. */}
      <section id="pro-koho" className="relative z-10 py-28 border-t border-white/5 bg-[#0a0a0a]">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-14 max-w-2xl mx-auto">
            <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-white/20 mb-5">Upřímně</p>
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter mb-4 text-white uppercase">Není to pro každého</h2>
            <p className="text-white/50 font-medium text-lg">Radši vám to řekneme teď než po zaplacení.</p>
          </div>

          <Reveal stagger className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* FIT */}
            <motion.div variants={fadeUp} className="bg-[#050505] border border-emerald-400/20 rounded-sm p-8">
              <div className="flex items-center gap-3 mb-7">
                <div className="w-9 h-9 rounded-sm bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                </div>
                <h3 className="text-base font-black uppercase tracking-widest text-white">Sedne vám, když</h3>
              </div>
              <ul className="space-y-5">
                {[
                  ["Nemáte čas postovat", "Vedete firmu. Instagram je to, co zbyde — a většinou nezbyde nic."],
                  ["Váš profil usnul", "Poslední příspěvek před půl rokem. Zákazník to čte jako zavřeno."],
                  ["Agentura je mimo rozpočet", "15–20 tisíc měsíčně nedává smysl, ale mlčet taky ne."],
                  ["Nemáte fotografa ani ateliér", "Vizuály produktů vzniknou bez focení. Vlastní fotky můžete přidat."],
                  ["Chcete mít poslední slovo", "Bez potvrzení neodejde nic. Automatické publikování si zapnete, až budete chtít."],
                ].map(([t, d]) => (
                  <li key={t} className="flex gap-3">
                    <Check className="w-3.5 h-3.5 text-emerald-400/60 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-white text-sm font-bold leading-snug">{t}</p>
                      <p className="text-white/40 text-sm leading-relaxed mt-1">{d}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-7 pt-6 border-t border-white/5 text-white/30 text-[11px] leading-relaxed">
                Web ani nepotřebujete — když ho nemáte, projdeme s vámi pár otázek a značku se naučíme z nich.
              </p>
            </motion.div>

            {/* NOT A FIT */}
            <motion.div variants={fadeUp} className="bg-[#050505] border border-white/10 rounded-sm p-8">
              <div className="flex items-center gap-3 mb-7">
                <div className="w-9 h-9 rounded-sm bg-white/5 border border-white/10 flex items-center justify-center">
                  <X className="w-4 h-4 text-white/40" />
                </div>
                <h3 className="text-base font-black uppercase tracking-widest text-white/70">Nesedne vám, když</h3>
              </div>
              <ul className="space-y-5">
                {[
                  ["Chcete obsah i na Facebook nebo TikTok", "Chrlit dělá Instagram. Na jinou síť zatím nepublikuje."],
                  ["Máte grafika a vlastní art direction", "Když máte funkční vizuální systém, budeme si spíš překážet."],
                  ["Potřebujete reportáž z akce", "Nikdo k vám nepřijede fotit včerejší svatbu ani otevíračku."],
                  ["Čekáte 10 000 sledujících za měsíc", "Tohle je pravidelnost, ne růstový trik. Účet roste pomalu."],
                  ["Chcete řídit každý pixel", "Layout navrhuje AI. Můžete ho přegenerovat nebo připomínkovat — ne sázet ručně."],
                ].map(([t, d]) => (
                  <li key={t} className="flex gap-3">
                    <X className="w-3.5 h-3.5 text-white/25 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-white/70 text-sm font-bold leading-snug">{t}</p>
                      <p className="text-white/35 text-sm leading-relaxed mt-1">{d}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-7 pt-6 border-t border-white/5 text-white/30 text-[11px] leading-relaxed">
                Jestli vás tahle strana vystihuje, nekupujte to. Ušetříme oba čas.
              </p>
            </motion.div>
          </Reveal>
        </div>
      </section>

      {/* PRICING — three tiers, no mechanism */}
      <section id="pricing" className="relative py-28 border-t border-white/5 bg-[#050505]">
        <div className="absolute top-0 left-1/2 w-[800px] h-[400px] bg-aisummit-cinnabar/5 blur-[150px] rounded-full pointer-events-none" style={{ transform: 'translateX(-50%)' }} />
        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter mb-4 text-white uppercase">Kolik to stojí?<br /><span className="text-aisummit-cinnabar">Míň, než si myslíte.</span></h2>
            <p className="text-white/50 font-medium text-lg max-w-xl mx-auto">Vyberte si podle toho, jak často chcete postovat. Čím delší období, tím míň platíte — a rok máte za deset měsíců.</p>
          </div>

          {/* Přepínač období. Předvybraný je ROK: karta pak ukazuje nejnižší
              možnou měsíční cenu, což je nižší číslo než dnešních 990 — delší
              závazek tedy cenu opticky nezvedá, naopak. */}
          <div className="flex justify-center mb-10">
            <div className="grid grid-cols-2 sm:flex bg-[#0a0a0a] p-1 rounded-sm border border-white/10 gap-1">
              {BILLING_TERMS.map((t) => {
                const active = t.months === term
                return (
                  <button
                    key={t.months}
                    onClick={() => setTerm(t.months)}
                    className={`px-4 sm:px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest rounded-sm transition-all flex items-center justify-center gap-2 ${
                      active
                        ? "bg-aisummit-cinnabar/20 text-aisummit-cinnabar border border-aisummit-cinnabar/30"
                        : "text-white/40 hover:text-white border border-transparent"
                    }`}
                  >
                    {t.label}
                    {t.badge && (
                      <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-bold ${
                        active ? "bg-emerald-500/20 text-emerald-400" : "bg-white/5 text-white/30"
                      }`}>
                        {t.badge}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 items-stretch">
            {plans.map((plan) => {
              const copy = PLAN_COPY[plan.id] || { tagline: "", bullets: [] }
              const highlight = Boolean(copy.highlight)
              const perMonth = monthlyEquivalent(plan.monthlyHaleru, term)
              const total = termPrice(plan.monthlyHaleru, term)
              const saved = termSavings(plan.monthlyHaleru, term)
              return (
              <div
                key={plan.id}
                className={`rounded-sm bg-[#0a0a0a] p-8 relative overflow-hidden flex flex-col ${
                  highlight
                    ? "border-2 border-aisummit-cinnabar shadow-[0_0_80px_rgba(230,57,70,0.12)]"
                    : "border border-white/10"
                }`}
              >
                {highlight && (
                  <>
                    <div className="absolute inset-0 bg-gradient-to-b from-aisummit-cinnabar/5 via-transparent to-transparent pointer-events-none" />
                    <span className="absolute top-4 right-4 text-[8px] bg-aisummit-cinnabar text-white px-2.5 py-1 rounded-full font-black uppercase tracking-widest">Nejoblíbenější</span>
                  </>
                )}

                <div className="relative z-10 mb-6">
                  <h3 className="text-xl font-black uppercase tracking-widest text-white mb-1">{plan.name}</h3>
                  <p className="text-aisummit-cinnabar/80 text-[10px] font-black uppercase tracking-widest">{copy.tagline}</p>
                </div>

                {/* Velkým je vždy MĚSÍČNÍ cena — to je číslo, které lidi mezi
                    tarify porovnávají. Celková částka patří pod ni, ne místo ní. */}
                <div className="relative z-10 mb-1">
                  <span className="text-5xl font-black text-white">{formatCzkAmount(perMonth)}</span>
                  <span className="text-white/40 text-lg font-black ml-2">Kč/měs</span>
                </div>
                <p className="text-white/30 text-[10px] font-bold mb-1">
                  {term === 1
                    ? `měsíčně · ${getTerm(term).note}`
                    : `${formatCzk(total)} jednorázově ${termLabel(term)} · ${getTerm(term).note}`}
                </p>
                <p className="text-[10px] font-bold mb-7 h-4">
                  {saved > 0 && <span className="text-emerald-400">Ušetříte {formatCzk(saved)}</span>}
                </p>

                <ul className="space-y-2.5 mb-8 relative z-10 flex-1">
                  {/* Kredity chodí z DB, přepočet na kusy z vah v lib/credits.ts.
                      Cena, objem ani váha kreditu se nesmí psát na dvou místech —
                      do teď tu stálo jen „20 kreditů" a kupující netušil, že
                      carousel stojí tři. */}
                  <li className="flex items-start gap-2.5 text-xs text-white/70">
                    <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-aisummit-cinnabar shrink-0" />
                    <span>
                      {plan.creditsPerMonth} kreditů měsíčně
                      <span className="block text-[10px] text-white/35 font-medium mt-0.5">
                        {creditExample(plan.creditsPerMonth, { reels: reelsEnabled && plan.allowsReels })}
                      </span>
                    </span>
                  </li>
                  {copy.bullets.map((bullet, i) => {
                    const text = typeof bullet === "string" ? bullet : bullet.text
                    const pending = typeof bullet !== "string" && !reelsEnabled
                    return (
                      <li
                        key={i}
                        className={`flex items-center gap-2.5 text-xs ${pending ? "text-white/30" : "text-white/70"}`}
                      >
                        {pending ? (
                          <Clock className="w-3.5 h-3.5 text-white/25 shrink-0" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5 text-aisummit-cinnabar shrink-0" />
                        )}
                        {text}
                        {pending && (
                          <span className="text-[8px] uppercase tracking-widest font-bold text-white/40 border border-white/15 rounded-sm px-1.5 py-0.5 shrink-0">
                            připravujeme
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>

                {/* Volba tarifu a období jde s uživatelem dál — do waitlistu
                    (a přes něj do pozvánky), aby se ho nikdo neptal podruhé. */}
                <Link
                  href={`#waitlist?tarif=${plan.id}&obdobi=${term}`}
                  onClick={() => onPickPlan(plan.id, term)}
                  className={`relative z-10 block text-center py-3.5 px-6 rounded-sm font-bold text-xs uppercase tracking-widest transition-all ${
                    highlight
                      ? "bg-aisummit-cinnabar text-white hover:bg-aisummit-cinnabar/90 shadow-[0_0_30px_rgba(230,57,70,0.4)]"
                      : "bg-white/5 text-white/80 border border-white/10 hover:bg-white/10"
                  }`}
                >
                  Připojit se na Waitlist
                </Link>
              </div>
              )
            })}
          </div>

          <p className="text-center mt-12 text-[9px] text-white/25 font-bold uppercase tracking-widest">3 posty zdarma · Bez kreditky · Bez časového limitu</p>
          {term > 1 && (
            <p className="text-center mt-3 text-[9px] text-emerald-400/70 font-bold uppercase tracking-widest">
              Garance vrácení peněz do 30 dnů · bez udání důvodu
            </p>
          )}
          {/* Povinná informace o DPH — u neplátce nesmí cena vypadat jako „bez DPH". */}
          <p className="text-center mt-3 text-[9px] text-white/20 font-bold uppercase tracking-widest">{vatNotice()}</p>
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

          <p className="mt-6 text-[9px] uppercase tracking-widest font-bold text-white/30">3 posty zdarma. Žádná kreditka. Bez časového limitu.</p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-white/5 bg-[#020202] py-16 relative z-10">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-6">
              <img src="/chrlit-logo-transparent.svg" alt="Chrlit" className="h-6" />
            </div>
            <p className="text-white/30 text-xs font-medium max-w-sm leading-relaxed">Hotový Instagram bez grafika, bez agentury, bez stresu. Propojíte účet, my uděláme zbytek.</p>
          </div>
          <div>
            <h4 className="font-bold mb-5 text-white/70 tracking-widest uppercase text-[10px]">Produkt</h4>
            <ul className="space-y-3 text-[10px] tracking-wider uppercase text-white/30 font-bold">
              <li><Link href="/portfolio" className="hover:text-white transition-colors">Portfolio</Link></li>
              <li><Link href="#reference" className="hover:text-white transition-colors">Ukázky</Link></li>
              <li><Link href="#pricing" className="hover:text-white transition-colors">Ceník</Link></li>
              <li><Link href="/blog" className="hover:text-white transition-colors">Blog</Link></li>
              <li><Link href="/aplikace" className="hover:text-white transition-colors">Do telefonu</Link></li>
              <li><Link href="#faq" className="hover:text-white transition-colors">FAQ</Link></li>
              <li><Link href="/login" className="hover:text-white transition-colors text-white/60">Přihlášení</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-bold mb-5 text-white/70 tracking-widest uppercase text-[10px]">Právní</h4>
            <ul className="space-y-3 text-[10px] tracking-wider uppercase text-white/30 font-bold">
              <li><Link href="/terms" className="hover:text-white transition-colors">Obchodní podmínky</Link></li>
              <li><Link href="/privacy" className="hover:text-white transition-colors">Zpracování dat</Link></li>
              <li><a href={`mailto:${LEGAL.email}`} className="hover:text-white transition-colors">Kontakt</a></li>
            </ul>
            {/* Identifikace prodávajícího — povinný údaj (§435 obč. zák.), ne dekorace. */}
            <div className="mt-6 space-y-1 text-[9px] tracking-wider text-white/20 font-bold uppercase not-italic">
              <p>{LEGAL.name}</p>
              <p>IČO {LEGAL.ico}</p>
              <p>{formatAddress()}</p>
            </div>
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
    a: "Když má Chrlit publikovat za vás, tak ano. Účet propojíte přes upload-post.com — přihlásíte se na jejich stránce ke svému Instagramu, k vašemu heslu se nedostaneme a propojení kdykoliv zrušíte jedním klikem. Musí to být profesní účet, Business nebo Creator; osobní účet Instagram k publikování nepustí. Bez propojení Chrlit funguje dál: posty si stáhnete a zveřejníte sami.",
  },
  {
    q: "Zveřejňuje Chrlit příspěvky sám?",
    a: "Jen když mu to dovolíte. Ve výchozím stavu vám plán připraví a čeká, až ho potvrdíte. Jedním přepínačem v nastavení zapnete automatické publikování — pak příspěvky odcházejí samy podle kalendáře, zhruba dva týdny dopředu, a do každého, který ještě nevyšel, můžete zasáhnout. Vypnout to jde stejně rychle.",
  },
  {
    q: "Můžu to zrušit kdykoliv?",
    a: "Ano. U měsíčního předplatného zrušíte jedním klikem a doběhne do konce zaplaceného měsíce. U delších období (3, 6 nebo 12 měsíců) platíte dopředu — a máte 30 dní na to si to rozmyslet: napište nám a peníze vám vrátíme bez udání důvodu. Na vyzkoušení máte 3 posty zdarma, bez kreditky a bez časového limitu.",
  },
  {
    q: "Proč se vyplatí platit na delší období?",
    a: "Za rok zaplatíte deset měsíců — dva jsou zdarma. Za půl roku ušetříte 10 %, za čtvrt roku 5 %. Navíc máte cenu zamčenou na celé období: i kdybychom ceník zdražili, vás se to dotkne až při další obnově. Kredity se přitom obnovují každý měsíc stejně jako u měsíčního plánu.",
  },
  {
    q: "Co se stane s nevyčerpanými kredity?",
    a: "Kredity se obnovují každý měsíc a nevyčerpané propadají — i u ročního předplatného. Píšeme to naplno, protože je lepší to vědět předem: tarif si vybírejte podle toho, kolik reálně stihnete zveřejnit, ne kolik byste teoreticky mohli.",
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
