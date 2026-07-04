import Link from "next/link"
import type { Metadata } from "next"
import { getAllArticleMeta } from "@/lib/blog"
import { SiteHeader } from "@/components/SiteHeader"

export const metadata: Metadata = {
    title: "Blog — Instagram pro malé firmy | Chrlit",
    description: "Praktické návody pro majitele kaváren, salónů, e-shopů a dalších malých firem: jak na Instagram bez agentury, bez focení a bez stresu.",
    alternates: { canonical: "https://chrlit.cz/blog" },
    openGraph: {
        title: "Blog Chrlit — Instagram pro malé firmy",
        description: "Praktické návody, jak rozjet Instagram firmy bez agentury.",
        url: "https://chrlit.cz/blog",
        type: "website",
    },
}

function formatDate(iso: string): string {
    if (!iso) return ""
    try {
        return new Date(iso).toLocaleDateString("cs-CZ", { day: "numeric", month: "long", year: "numeric" })
    } catch {
        return iso
    }
}

export default function BlogIndex() {
    const articles = getAllArticleMeta()

    return (
        <div className="min-h-screen bg-[#050505] text-white">
            <SiteHeader />
            <div className="max-w-3xl mx-auto px-6 pt-32 pb-24">
                <Link href="/" className="text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white transition-colors mb-12 inline-block">
                    ← Zpět na hlavní stránku
                </Link>

                <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tighter mb-4">Blog</h1>
                <p className="text-white/40 text-sm font-bold uppercase tracking-widest mb-16">
                    Instagram pro malé firmy — návody bez vaty
                </p>

                {articles.length === 0 ? (
                    <p className="text-white/40 text-sm">Zatím tu nic není. Brzy přidáme první články.</p>
                ) : (
                    <div className="space-y-4">
                        {articles.map(a => (
                            <Link
                                key={a.slug}
                                href={`/blog/${a.slug}`}
                                className="block border border-white/5 hover:border-white/15 bg-[#0a0a0a] rounded-sm p-6 transition-colors group"
                            >
                                <div className="flex items-center gap-3 text-[9px] font-bold uppercase tracking-widest text-white/30 mb-2">
                                    <span>{formatDate(a.date)}</span>
                                    <span>·</span>
                                    <span>{a.readingMinutes} min čtení</span>
                                </div>
                                <h2 className="text-lg font-black text-white/90 group-hover:text-white leading-snug mb-1.5">{a.title}</h2>
                                <p className="text-white/40 text-sm leading-relaxed">{a.description}</p>
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
