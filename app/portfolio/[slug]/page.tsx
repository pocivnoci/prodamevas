/**
 * /portfolio/<slug> — všechny příspěvky jedné značky, celé.
 *
 * Zeď na landingu ukazuje jeden čtverec na příspěvek; tahle stránka je opak —
 * médium v plné velikosti, celý text, výzva k akci i hashtagy, aby si člověk mohl
 * příspěvek přečíst tak, jak by ho viděl na Instagramu.
 *
 * Karusel je pruh se `scroll-snap`, ne komponenta s JS: listování zvládne prohlížeč
 * sám a stránka může zůstat serverová. Reel je `<video controls>` s obálkou jako
 * `poster` — a když obálka chybí (render ji občas nevyrobí), přehrávač funguje dál.
 *
 * ⚠️ Uvedené firmy NEJSOU zákazníci. `PORTFOLIO_DISCLAIMER` je proto nahoře.
 */

import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { SiteHeader } from "@/components/SiteHeader"
import {
    PORTFOLIO_BRANDS,
    PORTFOLIO_DISCLAIMER,
    type PortfolioPost,
} from "@/lib/portfolio-data"

export function generateStaticParams() {
    return PORTFOLIO_BRANDS.filter(b => b.posts.length > 0).map(b => ({ slug: b.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const { slug } = await params
    const brand = PORTFOLIO_BRANDS.find(b => b.slug === slug)
    if (!brand) return {}
    return {
        title: `${brand.company} — ukázka obsahu | Chrlit`,
        description: `${brand.posts.length} příspěvků, které Chrlit vyrobil ze skutečného webu značky ${brand.company}. Nevyžádaný koncept, ne zakázka.`,
        alternates: { canonical: `https://chrlit.cz/portfolio/${brand.slug}` },
    }
}

const TYPE_LABEL: Record<PortfolioPost["mediaType"], string> = {
    reel: "Reel",
    carousel: "Karusel",
    post: "Příspěvek",
}

/** Médium příspěvku v plné velikosti. */
function Media({ post, alt }: { post: PortfolioPost; alt: string }) {
    if (post.mediaType === "reel" && post.videoUrl) {
        return (
            <video
                controls
                preload="none"
                poster={post.images[0]}
                className="w-full rounded-sm bg-white/5"
            >
                <source src={post.videoUrl} type="video/mp4" />
            </video>
        )
    }

    if (post.images.length > 1) {
        return (
            <div>
                <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory pb-2">
                    {post.images.map((src, i) => (
                        <img
                            key={i}
                            src={src}
                            alt={`${alt} — snímek ${i + 1} z ${post.images.length}`}
                            loading="lazy"
                            className="w-full shrink-0 snap-start rounded-sm bg-white/5"
                        />
                    ))}
                </div>
                <div className="text-[9px] font-bold uppercase tracking-widest text-white/30">
                    {post.images.length} snímků — posuňte do strany
                </div>
            </div>
        )
    }

    return <img src={post.images[0]} alt={alt} loading="lazy" className="w-full rounded-sm bg-white/5" />
}

export default async function BrandPortfolio({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params
    const brand = PORTFOLIO_BRANDS.find(b => b.slug === slug)
    if (!brand || brand.posts.length === 0) notFound()

    const others = PORTFOLIO_BRANDS.filter(b => b.slug !== slug && b.posts.length > 0)
    const host = (brand.website || "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")

    return (
        <div className="min-h-screen bg-[#050505] text-white">
            <SiteHeader />

            <div className="max-w-3xl mx-auto px-6 pt-32 pb-24">
                <Link
                    href="/portfolio"
                    className="text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white transition-colors mb-12 inline-block"
                >
                    ← Zpět na portfolio
                </Link>

                <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tighter mb-3">{brand.company}</h1>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold uppercase tracking-widest text-white/30 mb-8">
                    {brand.industry && <span>{brand.industry}</span>}
                    <span>· {brand.posts.length} příspěvků</span>
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

                <div className="border-l-2 border-white/20 bg-white/[0.03] px-5 py-4 mb-16">
                    <div className="text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1.5">
                        Nevyžádaný koncept
                    </div>
                    <p className="text-white/50 text-xs leading-relaxed">{PORTFOLIO_DISCLAIMER}</p>
                </div>

                <div className="space-y-16">
                    {brand.posts.map((post, i) => (
                        <article key={post.id} className="border-t border-white/5 pt-8">
                            <div className="flex items-center gap-3 text-[9px] font-bold uppercase tracking-widest text-white/30 mb-5">
                                <span className="text-white/50">{String(i + 1).padStart(2, "0")}</span>
                                <span>·</span>
                                <span>{TYPE_LABEL[post.mediaType]}</span>
                                {post.pillar && (
                                    <>
                                        <span>·</span>
                                        <span>{post.pillar}</span>
                                    </>
                                )}
                            </div>

                            <Media post={post} alt={`${brand.company}: ${post.hook}`} />

                            <div className="mt-6 space-y-4">
                                <h2 className="text-xl font-black text-white/90 leading-snug">{post.hook}</h2>

                                {post.body && (
                                    <p className="text-white/60 text-sm leading-relaxed whitespace-pre-wrap">{post.body}</p>
                                )}

                                {post.cta && (
                                    <div className="border-l-2 border-white/10 pl-4">
                                        <div className="text-[9px] font-bold uppercase tracking-widest text-white/30 mb-1">
                                            Výzva k akci
                                        </div>
                                        <p className="text-white/70 text-sm leading-relaxed break-words">{post.cta}</p>
                                    </div>
                                )}

                                {post.hashtags.length > 0 && (
                                    <p className="text-white/30 text-xs leading-relaxed break-words">
                                        {post.hashtags.join(" ")}
                                    </p>
                                )}
                            </div>
                        </article>
                    ))}
                </div>

                {others.length > 0 && (
                    <div className="mt-20 pt-8 border-t border-white/5">
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
        </div>
    )
}
