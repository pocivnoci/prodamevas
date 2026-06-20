import Link from "next/link"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getArticle, getArticleSlugs } from "@/lib/blog"

const SITE = "https://chrlit.cz"

export function generateStaticParams() {
    return getArticleSlugs().map(slug => ({ slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const { slug } = await params
    const a = getArticle(slug)
    if (!a) return { title: "Článek nenalezen | Chrlit" }
    const url = `${SITE}/blog/${a.slug}`
    return {
        title: `${a.title} | Chrlit`,
        description: a.description,
        keywords: a.keywords,
        alternates: { canonical: url },
        openGraph: {
            title: a.title,
            description: a.description,
            url,
            type: "article",
            publishedTime: a.date || undefined,
            images: a.ogImage ? [a.ogImage] : undefined,
        },
        twitter: { card: "summary_large_image", title: a.title, description: a.description },
    }
}

function formatDate(iso: string): string {
    if (!iso) return ""
    try {
        return new Date(iso).toLocaleDateString("cs-CZ", { day: "numeric", month: "long", year: "numeric" })
    } catch {
        return iso
    }
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params
    const article = getArticle(slug)
    if (!article) notFound()

    const url = `${SITE}/blog/${article.slug}`
    const jsonLd = {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: article.title,
        description: article.description,
        datePublished: article.date || undefined,
        author: { "@type": "Organization", name: article.author },
        publisher: { "@type": "Organization", name: "Chrlit", url: SITE },
        mainEntityOfPage: url,
        keywords: article.keywords.join(", "),
    }

    return (
        <div className="min-h-screen bg-[#050505] text-white">
            {/* JSON-LD Article schema for rich results */}
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

            <article className="max-w-3xl mx-auto px-6 py-24">
                <Link href="/blog" className="text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white transition-colors mb-12 inline-block">
                    ← Všechny články
                </Link>

                <div className="flex items-center gap-3 text-[9px] font-bold uppercase tracking-widest text-white/30 mb-4">
                    <span>{formatDate(article.date)}</span>
                    <span>·</span>
                    <span>{article.readingMinutes} min čtení</span>
                </div>

                <div className="blog-article" dangerouslySetInnerHTML={{ __html: article.html }} />

                {/* CTA */}
                <div className="mt-16 pt-10 border-t border-white/10 text-center">
                    <p className="text-white/50 text-sm mb-5">Chcete měsíc Instagramu ze svého webu?</p>
                    <Link
                        href="/#waitlist"
                        className="inline-flex items-center px-8 py-4 bg-white text-black rounded-sm font-black text-xs uppercase tracking-widest hover:bg-white/90 transition-all"
                    >
                        3 posty zdarma vyzkoušet
                    </Link>
                    <p className="mt-4 text-[9px] uppercase tracking-widest font-bold text-white/25">Bez kreditky · Bez časového limitu</p>
                </div>
            </article>
        </div>
    )
}
