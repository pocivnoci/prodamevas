import Link from "next/link"
import { LEGAL, formatAddress } from "@/lib/legal"

/**
 * Patička pro veřejné podstránky.
 *
 * Landing má vlastní, bohatší (`components/Landing.tsx`); podstránky do teď
 * neměly **žádnou**. Z portfolia se tak nedalo dostat na obchodní podmínky ani
 * na identifikaci prodávajícího — a ta je povinný údaj (§435 obč. zák.), ne
 * dekorace. Návštěvník, který přijde na `/portfolio` z odkazu, jinak nemá
 * jak zjistit, kdo mu vlastně co prodává.
 *
 * Kotvy míří na `/#…`, ne na `#…`: na podstránce by samotný hash nikam nevedl.
 */
export function SiteFooter() {
    return (
        <footer className="border-t border-white/5 bg-[#020202] py-16">
            <div className="max-w-6xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-10">
                <div className="col-span-2">
                    <img src="/chrlit-logo-transparent.svg" alt="Chrlit" className="h-6 mb-5" />
                    <p className="text-white/30 text-xs font-medium max-w-sm leading-relaxed">
                        Hotový Instagram bez grafika, bez agentury, bez stresu. Vy zveřejníte, my uděláme zbytek.
                    </p>
                </div>

                <div>
                    <h4 className="font-bold mb-5 text-white/70 tracking-widest uppercase text-[10px]">Produkt</h4>
                    <ul className="space-y-3 text-[10px] tracking-wider uppercase text-white/30 font-bold">
                        <li><Link href="/portfolio" className="hover:text-white transition-colors">Portfolio</Link></li>
                        <li><Link href="/#reference" className="hover:text-white transition-colors">Ukázky</Link></li>
                        <li><Link href="/#pricing" className="hover:text-white transition-colors">Ceník</Link></li>
                        <li><Link href="/blog" className="hover:text-white transition-colors">Blog</Link></li>
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
                    <div className="mt-6 space-y-1 text-[9px] tracking-wider text-white/25 font-bold uppercase not-italic">
                        <p>{LEGAL.name}</p>
                        <p>IČO {LEGAL.ico}</p>
                        <p>{formatAddress()}</p>
                    </div>
                </div>
            </div>

            <div className="max-w-6xl mx-auto px-6 pt-10 mt-12 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-2 text-[9px] text-white/25 font-bold tracking-[0.2em] uppercase">
                <p>© {new Date().getFullYear()} Chrlit.cz</p>
                <div>Hotový Instagram z vašeho webu</div>
            </div>
        </footer>
    )
}
