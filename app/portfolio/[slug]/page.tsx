/**
 * /portfolio/<slug> — příspěvky jedné značky jako instagramový profil.
 *
 * Do minule to byl svislý výpis v plné velikosti: 18–23 příspěvků, tedy přes
 * dvacet obrazovek scrollu bez navigace. Prospekt si ale nekupuje texty, kupuje
 * si vzhled feedu — a ten mřížka ukáže na první obrazovce. Celý příspěvek
 * (karusel, text, výzva, hashtagy) se otevře po kliknutí.
 *
 * Stránka zůstává SERVEROVÁ a interaktivitu předává do `components/portfolio/`.
 * Je to konvence celého webu: mimo dashboard není v `app/` ani jedno
 * `"use client"` — viz `components/PostWall.tsx` na landingu.
 *
 * ⚠️ Uvedené firmy NEJSOU zákazníci. `PORTFOLIO_DISCLAIMER` je proto nahoře.
 *
 * Příspěvky chodí přes `lib/portfolio.ts`, ne rovnou z exportu — formáty mimo
 * nabídku (reely) se na web nedostanou.
 */

import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { SiteHeader } from "@/components/SiteHeader"
import { SiteFooter } from "@/components/SiteFooter"
import { PostGrid } from "@/components/portfolio/PostGrid"
import { PORTFOLIO_VISIBLE_BRANDS, PORTFOLIO_DISCLAIMER, PORTFOLIO_CLIENT_NOTE, portfolioRelationship } from "@/lib/portfolio"
import { countLabel, POSTS, CAROUSELS, IMAGES } from "@/lib/plural"

export function generateStaticParams() {
    return PORTFOLIO_VISIBLE_BRANDS.map(b => ({ slug: b.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const { slug } = await params
    const brand = PORTFOLIO_VISIBLE_BRANDS.find(b => b.slug === slug)
    if (!brand) return {}

    // Vizuální portfolio se bez náhledu sdílí jako prázdná karta — vezmi první snímek.
    const cover = brand.posts.find(p => p.images[0])?.images[0]

    return {
        title: `${brand.company} — ukázka obsahu | Chrlit`,
        description: `${countLabel(brand.posts.length, POSTS)}, které Chrlit vyrobil ze skutečného webu značky ${brand.company}. Nevyžádaný koncept, ne zakázka.`,
        alternates: { canonical: `https://chrlit.cz/portfolio/${brand.slug}` },
        openGraph: {
            title: `${brand.company} očima Chrlitu`,
            description: `Jak by vypadal Instagram značky ${brand.company}. Nevyžádaný koncept.`,
            url: `https://chrlit.cz/portfolio/${brand.slug}`,
            type: "website",
            ...(cover ? { images: [{ url: cover }] } : {}),
        },
    }
}

export default async function BrandPortfolio({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params
    const brand = PORTFOLIO_VISIBLE_BRANDS.find(b => b.slug === slug)
    if (!brand) notFound()
    // Vztah ke značce rozhoduje o výhradě: u klienta by věta „není zákazníkem"
    // byla lež, u nevyžádaného konceptu je naopak povinná.
    const isClient = portfolioRelationship(brand) === "client"

    const others = PORTFOLIO_VISIBLE_BRANDS.filter(b => b.slug !== slug)
    const host = (brand.website || "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")

    const n = {
        carousel: brand.posts.filter(p => p.mediaType === "carousel").length,
        post: brand.posts.filter(p => p.mediaType === "post").length,
    }

    return (
        <div className="min-h-screen bg-[#050505] text-white">
            <SiteHeader />

            <div className="max-w-3xl mx-auto px-6 pt-32 pb-20">
                <Link
                    href="/portfolio"
                    className="text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white transition-colors mb-10 inline-block"
                >
                    ← Zpět na portfolio
                </Link>

                {/* Hlavička jako profil */}
                <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tighter mb-3">{brand.company}</h1>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold uppercase tracking-widest text-white/30 mb-4">
                    {brand.industry && <span>{brand.industry}</span>}
                    {host && (
                        <>
                            <span>·</span>
                            <a
                                href={brand.website}
                                target="_blank"
                                rel="noopener noreferrer nofollow"
                                className="text-white/50 hover:text-white transition-colors"
                            >
                                {host}
                            </a>
                        </>
                    )}
                </div>

                {/* Počty ve stylu profilových statistik */}
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-[10px] font-bold uppercase tracking-widest text-white/40 mb-8 tabular-nums">
                    <span className="text-white/70">{countLabel(brand.posts.length, POSTS)}</span>
                    {n.post > 0 && <span>{countLabel(n.post, IMAGES)}</span>}
                    {n.carousel > 0 && <span>{countLabel(n.carousel, CAROUSELS)}</span>}
                </div>

                {/* JEDEN disclaimer. Dřív tu byly dva skoro stejné boxy a k tomu odznak
                    u každého reelu — trojí opakování téhož ještě před prvním obrázkem. */}
<div className={`border-l-2 px-5 py-4 mb-8 ${isClient ? "border-emerald-500/40 bg-emerald-500/[0.04]" : "border-white/20 bg-white/[0.03]"}`}>
                    <div className={`text-[9px] font-bold uppercase tracking-widest mb-1.5 ${isClient ? "text-emerald-400/70" : "text-white/40"}`}>
                        {isClient ? "Práce pro klienta" : "Nevyžádaný koncept"}
                    </div>
                    <p className="text-white/50 text-xs leading-relaxed">
                        {isClient ? PORTFOLIO_CLIENT_NOTE : PORTFOLIO_DISCLAIMER}
                    </p>
                </div>

                <PostGrid posts={brand.posts} company={brand.company} />

                {/* CTA v okamžiku největšího zájmu — dřív stránka končila zdí pilulek */}
                <div className="mt-16 pt-10 border-t border-white/5 text-center">
                    <h2 className="text-2xl font-black uppercase tracking-tighter mb-3">
                        Chcete tohle pro svoji značku?
                    </h2>
                    <p className="text-white/40 text-sm leading-relaxed max-w-md mx-auto mb-6">
                        Zadejte svůj web a uvidíte první příspěvky dřív, než se rozhodnete.
                    </p>
                    <Link
                        href="/#waitlist"
                        className="inline-flex items-center px-8 py-4 bg-white text-black rounded-sm font-black text-xs uppercase tracking-widest hover:bg-white/90 transition-all"
                    >
                        Zkusit na svém webu
                    </Link>
                </div>

                {others.length > 0 && (
                    <div className="mt-16 pt-8 border-t border-white/5">
                        <div className="text-[9px] font-bold uppercase tracking-widest text-white/30 mb-4">
                            Další značky
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {others.map(o => (
                                <Link
                                    key={o.slug}
                                    href={`/portfolio/${o.slug}`}
                                    className="text-[10px] font-bold uppercase tracking-widest px-4 py-2.5 border border-white/5 hover:border-white/20 bg-[#0a0a0a] text-white/50 hover:text-white rounded-sm transition-colors"
                                >
                                    {o.company}
                                </Link>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <SiteFooter />
        </div>
    )
}
