/**
 * /portfolio — přehled značek, pro které engine vyrobil ukázkový obsah.
 *
 * Data jsou statická (`lib/portfolio-data.ts`, generuje `scripts/export-portfolio.ts`),
 * takže stránka nesahá při requestu na databázi ani na engine. Čte je přes
 * `lib/portfolio.ts` — ten vyřadí formáty, které nejsou v nabídce (reely).
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
import { PORTFOLIO_VISIBLE_BRANDS, PORTFOLIO_DISCLAIMER, PORTFOLIO_MIXED_DISCLAIMER, portfolioRelationship, type PortfolioBrand } from "@/lib/portfolio"
import { countLabel, POSTS, CAROUSELS, IMAGES, BRANDS } from "@/lib/plural"

const COVER = PORTFOLIO_VISIBLE_BRANDS.flatMap(b => b.posts).find(p => p.images[0])?.images[0]

export const metadata: Metadata = {
    title: "Portfolio — ukázky obsahu pro známé značky | Chrlit",
    description:
        "Příspěvky, které Chrlit vyrobil ze skutečných webů známých českých značek — texty, obrázky i karusely. Nevyžádané koncepty, ne zakázky.",
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
        carousel: b.posts.filter(p => p.mediaType === "carousel").length,
        post: b.posts.filter(p => p.mediaType === "post").length,
    }
}

/**
 * Náhledy do dlaždice. Tři, ne čtyři: na mobilu je karta široká celou obrazovku
 * a čtyři výřezy vedle sebe už nejdou přečíst.
 */
function previews(b: PortfolioBrand, n: number) {
    const out: string[] = []
    for (const p of b.posts) {
        if (p.images[0]) out.push(p.images[0])
        if (out.length >= n) break
    }
    return out
}

export default function PortfolioIndex() {
    const brands = PORTFOLIO_VISIBLE_BRANDS
    // Výhrada nad výlohou se řídí tím, co v ní SKUTEČNĚ je. Text „firmy nejsou
    // zákazníky" nesmí viset nad stránkou, kde je jeden z nich klient.
    const hasClients = brands.some(b => portfolioRelationship(b) === "client")
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
                        {hasClients ? "Jak to číst" : "Nevyžádané koncepty"}
                    </div>
                    <p className="text-white/50 text-xs leading-relaxed">
                        {hasClients ? PORTFOLIO_MIXED_DISCLAIMER : PORTFOLIO_DISCLAIMER}
                    </p>
                </div>

                {brands.length === 0 ? (
                    <p className="text-white/40 text-sm">Portfolio se právě připravuje. Zkuste to za chvíli.</p>
                ) : (
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {brands.map(b => {
                            const isClient = portfolioRelationship(b) === "client"
                            const c = counts(b)
                            const thumbs = previews(b, 3)
                            return (
                                <Link
                                    key={b.slug}
                                    href={`/portfolio/${b.slug}`}
                                    className="block border border-white/5 hover:border-white/15 bg-[#0a0a0a] rounded-sm overflow-hidden transition-colors group"
                                >
                                    <div className="grid grid-cols-3 gap-px bg-white/5">
                                        {thumbs.map((src, i) => (
                                            <div key={i} className="relative aspect-square bg-white/5">
                                                <img
                                                    src={src}
                                                    alt=""
                                                    loading="lazy"
                                                    className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                                                />
                                            </div>
                                        ))}
                                    </div>
                                    <div className="p-5">
                                        <h2 className="text-lg font-black text-white/90 group-hover:text-white leading-snug mb-1">
                                            {b.company}
                                        </h2>
                                        <div className="flex items-center gap-2 flex-wrap mb-3">
                                            <span className="text-[9px] font-bold uppercase tracking-widest text-white/30">
                                                {b.industry || "—"}
                                            </span>
                                            {/* Vztah ke značce patří na dlaždici, ne jen do detailu:
                                                kdo si výlohu jen prolistuje, musí vidět rozdíl mezi
                                                nevyžádaným konceptem a prací pro klienta. */}
                                            <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm border ${isClient ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400/80" : "border-white/10 bg-white/5 text-white/40"}`}>
                                                {isClient ? "Klient" : "Koncept"}
                                            </span>
                                        </div>
                                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px] font-bold uppercase tracking-widest text-white/40 tabular-nums">
                                            <span className="text-white/60">{countLabel(b.posts.length, POSTS)}</span>
                                            {c.post > 0 && <span>· {countLabel(c.post, IMAGES)}</span>}
                                            {c.carousel > 0 && <span>· {countLabel(c.carousel, CAROUSELS)}</span>}
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
