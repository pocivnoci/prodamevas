/**
 * /portfolio — přehled značek, pro které engine vyrobil ukázkový obsah.
 *
 * Data jsou statická (`lib/portfolio-data.ts`, generuje `scripts/export-portfolio.ts`),
 * takže stránka nesahá při requestu na databázi ani na engine.
 *
 * ⚠️ Uvedené firmy NEJSOU zákazníci a o ničem nevědí. Popisek to musí říct —
 * proto `PORTFOLIO_DISCLAIMER` hned pod nadpisem, ne schovaný v patičce. Bez něj
 * stránka tvrdí obchodní vztah, který neexistuje.
 *
 * Fiktivní demo značky jsou jinde: zeď „Ukázky" na landingu (`lib/reference-data.ts`).
 */

import Link from "next/link"
import type { Metadata } from "next"
import { SiteHeader } from "@/components/SiteHeader"
import { SiteFooter } from "@/components/SiteFooter"
import { PORTFOLIO_BRANDS, PORTFOLIO_DISCLAIMER, type PortfolioBrand } from "@/lib/portfolio-data"
import { countLabel, POSTS, CAROUSELS, REELS, IMAGES, BRANDS } from "@/lib/plural"

const COVER = PORTFOLIO_BRANDS.flatMap(b => b.posts).find(p => p.images[0])?.images[0]

export const metadata: Metadata = {
    title: "Portfolio — ukázky obsahu pro známé značky | Chrlit",
    description:
        "Příspěvky, které Chrlit vyrobil ze skutečných webů známých českých značek — texty, obrázky, karusely i reely. Nevyžádané koncepty, ne zakázky.",
    alternates: { canonical: "https://chrlit.cz/portfolio" },
    openGraph: {
        title: "Portfolio Chrlit — obsah pro známé české značky",
        description: "Co engine vyrobí, když dostane skutečný web. Nevyžádané koncepty.",
        url: "https://chrlit.cz/portfolio",
        type: "website",
        ...(COVER ? { images: [{ url: COVER }] } : {}),
    },
}

function counts(b: PortfolioBrand) {
    return {
        reel: b.posts.filter(p => p.mediaType === "reel").length,
        carousel: b.posts.filter(p => p.mediaType === "carousel").length,
        post: b.posts.filter(p => p.mediaType === "post").length,
    }
}

/**
 * Náhledy do dlaždice. Tři, ne čtyři: na mobilu je karta široká celou obrazovku
 * a čtyři výřezy vedle sebe už nejdou přečíst.
 */
function previews(b: PortfolioBrand, n: number) {
    const out: { src: string; isReel: boolean }[] = []
    for (const p of b.posts) {
        if (p.images[0]) out.push({ src: p.images[0], isReel: p.mediaType === "reel" })
        if (out.length >= n) break
    }
    return out
}

export default function PortfolioIndex() {
    const brands = PORTFOLIO_BRANDS.filter(b => b.posts.length > 0)
    const total = brands.reduce((n, b) => n + b.posts.length, 0)

    return (
        <div className="min-h-screen bg-[#050505] text-white">
            <SiteHeader />

            <div className="max-w-6xl mx-auto px-6 pt-32 pb-20">
                <Link
                    href="/"
                    className="text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white transition-colors mb-10 inline-block"
                >
                    ← Zpět na hlavní stránku
                </Link>

                <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tighter mb-4">Portfolio</h1>
                <p className="text-white/40 text-sm font-bold uppercase tracking-widest mb-6">
                    {countLabel(total, POSTS)} · {countLabel(brands.length, BRANDS)}
                </p>

                <p className="text-white/60 text-sm leading-relaxed max-w-2xl mb-6">
                    Tohle nejsou mockupy. Každou značku se engine naučil z jejího skutečného webu — barvy,
                    produkty, tón — a pak jí napsal a nakreslil obsah na měsíc dopředu. Klikni na značku
                    a projdi si celé příspěvky včetně textů.
                </p>

                {/* Disclaimer až za sdělením: výhrada nesmí mít vyšší prioritu než to,
                    co stránka nabízí — ale musí být vidět dřív než první dlaždice. */}
                <div className="border-l-2 border-white/20 bg-white/[0.03] px-5 py-4 mb-12 max-w-2xl">
                    <div className="text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1.5">
                        Nevyžádané koncepty
                    </div>
                    <p className="text-white/50 text-xs leading-relaxed">
                        {PORTFOLIO_DISCLAIMER} Video reely jsou navíc beta — zkoušíme je a v nabídce zatím nejsou.
                    </p>
                </div>

                {brands.length === 0 ? (
                    <p className="text-white/40 text-sm">Portfolio se právě připravuje. Zkuste to za chvíli.</p>
                ) : (
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {brands.map(b => {
                            const c = counts(b)
                            const thumbs = previews(b, 3)
                            return (
                                <Link
                                    key={b.slug}
                                    href={`/portfolio/${b.slug}`}
                                    className="block border border-white/5 hover:border-white/15 bg-[#0a0a0a] rounded-sm overflow-hidden transition-colors group"
                                >
                                    <div className="grid grid-cols-3 gap-px bg-white/5">
                                        {thumbs.map((t, i) => (
                                            <div key={i} className="relative aspect-square bg-white/5">
                                                <img
                                                    src={t.src}
                                                    alt=""
                                                    loading="lazy"
                                                    className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                                                />
                                                {t.isReel && (
                                                    <svg
                                                        viewBox="0 0 24 24"
                                                        className="absolute top-1.5 right-1.5 w-3.5 h-3.5 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]"
                                                        fill="currentColor"
                                                    >
                                                        <path d="M8 5v14l11-7z" />
                                                    </svg>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    <div className="p-5">
                                        <h2 className="text-lg font-black text-white/90 group-hover:text-white leading-snug mb-1">
                                            {b.company}
                                        </h2>
                                        <div className="text-[9px] font-bold uppercase tracking-widest text-white/30 mb-3">
                                            {b.industry || "—"}
                                        </div>
                                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px] font-bold uppercase tracking-widest text-white/40 tabular-nums">
                                            <span className="text-white/60">{countLabel(b.posts.length, POSTS)}</span>
                                            {c.post > 0 && <span>· {countLabel(c.post, IMAGES)}</span>}
                                            {c.carousel > 0 && <span>· {countLabel(c.carousel, CAROUSELS)}</span>}
                                            {c.reel > 0 && <span>· {countLabel(c.reel, REELS)} (beta)</span>}
                                        </div>
                                    </div>
                                </Link>
                            )
                        })}
                    </div>
                )}

                <div className="mt-16 pt-10 border-t border-white/5 text-center">
                    <h2 className="text-2xl font-black uppercase tracking-tighter mb-3">
                        Chcete vidět svoji značku?
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
            </div>

            <SiteFooter />
        </div>
    )
}
