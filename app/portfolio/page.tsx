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
import { PORTFOLIO_BRANDS, PORTFOLIO_DISCLAIMER, type PortfolioBrand } from "@/lib/portfolio-data"

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
    },
}

function counts(b: PortfolioBrand) {
    return {
        reel: b.posts.filter(p => p.mediaType === "reel").length,
        carousel: b.posts.filter(p => p.mediaType === "carousel").length,
        post: b.posts.filter(p => p.mediaType === "post").length,
    }
}

/** Náhledy do dlaždice — první snímky, které značka má. */
function previews(b: PortfolioBrand, n: number): string[] {
    const out: string[] = []
    for (const p of b.posts) {
        if (p.images[0]) out.push(p.images[0])
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

            <div className="max-w-6xl mx-auto px-6 pt-32 pb-24">
                <Link
                    href="/"
                    className="text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white transition-colors mb-12 inline-block"
                >
                    ← Zpět na hlavní stránku
                </Link>

                <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tighter mb-4">Portfolio</h1>
                <p className="text-white/40 text-sm font-bold uppercase tracking-widest mb-8">
                    {total} příspěvků · {brands.length} značek · texty, obrázky, karusely i reely
                </p>
                <p className="text-white/30 text-xs mb-8">
                    Video reely jsou označené jako beta — zkoušíme je a zatím nejsou v nabídce.
                </p>

                <p className="text-white/60 text-sm leading-relaxed max-w-2xl mb-6">
                    Tohle nejsou mockupy. Každou značku se engine naučil z jejího skutečného webu — barvy,
                    produkty, tón — a pak jí napsal a nakreslil obsah na měsíc dopředu. Klikni na značku
                    a projdi si celé příspěvky včetně textů.
                </p>

                <div className="border-l-2 border-white/20 bg-white/[0.03] px-5 py-4 mb-16 max-w-2xl">
                    <div className="text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1.5">
                        Nevyžádané koncepty
                    </div>
                    <p className="text-white/50 text-xs leading-relaxed">{PORTFOLIO_DISCLAIMER}</p>
                </div>

                {brands.length === 0 ? (
                    <p className="text-white/40 text-sm">
                        Portfolio zatím není vygenerované. Spusť <code className="text-white/60">scripts/seed-portfolio-clients.ts</code>.
                    </p>
                ) : (
                    <div className="grid sm:grid-cols-2 gap-4">
                        {brands.map(b => {
                            const c = counts(b)
                            const thumbs = previews(b, 4)
                            return (
                                <Link
                                    key={b.slug}
                                    href={`/portfolio/${b.slug}`}
                                    className="block border border-white/5 hover:border-white/15 bg-[#0a0a0a] rounded-sm overflow-hidden transition-colors group"
                                >
                                    <div className="grid grid-cols-4 gap-px bg-white/5">
                                        {thumbs.map((src, i) => (
                                            <img
                                                key={i}
                                                src={src}
                                                alt=""
                                                loading="lazy"
                                                className="w-full aspect-square object-cover bg-white/5 opacity-80 group-hover:opacity-100 transition-opacity"
                                            />
                                        ))}
                                    </div>
                                    <div className="p-5">
                                        <h2 className="text-lg font-black text-white/90 group-hover:text-white leading-snug mb-1">
                                            {b.company}
                                        </h2>
                                        <div className="text-[9px] font-bold uppercase tracking-widest text-white/30 mb-3">
                                            {b.industry || "—"}
                                        </div>
                                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px] font-bold uppercase tracking-widest text-white/40">
                                            <span>{b.posts.length} příspěvků</span>
                                            {c.reel > 0 && <span>· {c.reel} reel (beta)</span>}
                                            {c.carousel > 0 && <span>· {c.carousel} karusel</span>}
                                            {c.post > 0 && <span>· {c.post} obrázek</span>}
                                        </div>
                                    </div>
                                </Link>
                            )
                        })}
                    </div>
                )}

                <div className="mt-16 pt-8 border-t border-white/5">
                    <p className="text-white/40 text-sm leading-relaxed max-w-2xl">
                        Chcete vidět, co by engine napsal vaší značce?{" "}
                        <Link href="/#waitlist" className="text-white hover:underline">
                            Zadejte svůj web
                        </Link>{" "}
                        a dostanete první příspěvky, než se rozhodnete.
                    </p>
                </div>
            </div>
        </div>
    )
}
