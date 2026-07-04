import Link from "next/link"

/**
 * Minimal marketing header for non-home public pages (blog, terms, privacy).
 * The homepage has its own animated `motion.header`; these static subpages had
 * only a lone "back" text link (QA #11), leaving no path into the main nav.
 *
 * Section links point at the homepage anchors (`/#…`); on click Next soft-navigates
 * home and scrolls to the section. The splash won't replay on that nav — the root
 * layout marks it seen for the session (QA #9).
 */
export function SiteHeader() {
    return (
        <header className="fixed top-0 inset-x-0 z-50 bg-[#050505]/80 backdrop-blur-xl border-b border-white/5">
            <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                <Link href="/" className="flex items-center gap-2">
                    <img src="/chrlit-logo-transparent.svg" alt="Chrlit" className="h-8" />
                </Link>

                <div className="flex items-center gap-2 sm:gap-6">
                    <Link href="/blog" className="text-[10px] font-bold uppercase tracking-widest text-white/30 hover:text-white transition-colors hidden sm:block">
                        Blog
                    </Link>
                    <Link href="/#reference" className="text-[10px] font-bold uppercase tracking-widest text-white/30 hover:text-white transition-colors hidden sm:block">
                        Ukázky
                    </Link>
                    <Link href="/#pricing" className="text-[10px] font-bold uppercase tracking-widest text-white/30 hover:text-white transition-colors hidden sm:block">
                        Ceník
                    </Link>
                    <Link href="/login" className="text-[10px] font-bold uppercase tracking-widest text-white/50 hover:text-white transition-colors hidden sm:block">
                        Přihlásit se
                    </Link>
                    <Link href="/#waitlist" className="inline-flex items-center gap-2 text-[10px] font-bold px-5 py-2.5 bg-white/10 hover:bg-white text-white hover:text-black rounded-sm transition-all uppercase tracking-widest">
                        Připojit se
                    </Link>
                </div>
            </div>
        </header>
    )
}
