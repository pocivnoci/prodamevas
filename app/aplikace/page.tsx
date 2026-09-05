import type { Metadata } from "next"
import { SiteFooter } from "@/components/SiteFooter"
import Link from "next/link"
import { InstallButton } from "@/components/InstallApp"

export const metadata: Metadata = {
    title: "Chrlit do telefonu — instalace | Chrlit",
    description: "Jak si přidat Chrlit Studio na plochu telefonu nebo počítače. Bez stahování z obchodu, funguje na iPhonu i Androidu.",
    alternates: { canonical: "https://www.chrlit.cz/aplikace" },
}

const STEPS: { platform: string; note?: string; steps: string[] }[] = [
    {
        platform: "iPhone a iPad",
        note: "Musí to být Safari — v Chromu na iPhonu tahle volba není.",
        steps: [
            "Otevřete chrlit.cz v Safari.",
            "Ťukněte na ikonu Sdílet (čtvereček se šipkou nahoru, dole uprostřed).",
            "Sjeďte v nabídce dolů na „Přidat na plochu“.",
            "Potvrďte „Přidat“ vpravo nahoře.",
        ],
    },
    {
        platform: "Android",
        steps: [
            "Otevřete chrlit.cz v Chromu.",
            "Chrome sám nabídne „Instalovat aplikaci“ — nebo ťukněte na tři tečky vpravo nahoře.",
            "Zvolte „Instalovat aplikaci“ / „Přidat na plochu“.",
            "Potvrďte „Instalovat“.",
        ],
    },
    {
        platform: "Počítač",
        note: "Chrome, Edge nebo Arc. Ve Firefoxu a Safari na macOS instalace není.",
        steps: [
            "Otevřete chrlit.cz v Chromu nebo Edge.",
            "V adresním řádku vpravo klikněte na ikonu instalace (monitor se šipkou).",
            "Potvrďte „Instalovat“.",
        ],
    },
]

export default function InstallPage() {
    return (
        <div className="min-h-screen bg-[#050505] text-white">
            <div className="max-w-3xl mx-auto px-6 py-20">
                <Link href="/" className="text-[9px] font-bold uppercase tracking-widest text-white/30 hover:text-white transition-colors">
                    ← Zpět na Chrlit
                </Link>

                <h1 className="mt-8 text-3xl font-black uppercase tracking-widest">Chrlit do telefonu</h1>
                <p className="mt-4 text-sm text-white/50 leading-relaxed max-w-xl">
                    Chrlit se nestahuje z obchodu — přidáte si ho na plochu přímo z prohlížeče. Dostanete
                    ikonu vedle ostatních aplikací, otevírá se na celou obrazovku a chová se stejně jako
                    appka z obchodu. Zabere to dvě ťuknutí a nic to nestahuje.
                </p>

                <div className="mt-10">
                    <InstallButton />
                </div>

                <div className="mt-16 space-y-12">
                    {STEPS.map(({ platform, note, steps }) => (
                        <section key={platform}>
                            <h2 className="text-[11px] font-bold uppercase tracking-widest text-aisummit-cinnabar">{platform}</h2>
                            {note && <p className="mt-2 text-xs text-white/30">{note}</p>}
                            <ol className="mt-4 space-y-3">
                                {steps.map((step, i) => (
                                    <li key={step} className="flex gap-4 text-sm text-white/60">
                                        <span className="shrink-0 w-6 h-6 rounded-sm border border-white/10 bg-[#0a0a0a] flex items-center justify-center text-[10px] font-bold text-white/40">
                                            {i + 1}
                                        </span>
                                        <span className="pt-0.5 leading-relaxed">{step}</span>
                                    </li>
                                ))}
                            </ol>
                        </section>
                    ))}
                </div>

                <div className="mt-16 rounded-sm border border-white/10 bg-[#0a0a0a] p-6">
                    <h2 className="text-[10px] font-bold uppercase tracking-widest text-white/40">Proč to není v App Store?</h2>
                    <p className="mt-3 text-xs text-white/50 leading-relaxed">
                        Protože nemusí. Chrlit je plnohodnotná webová aplikace — přidáním na plochu získáte
                        totéž co stažením z obchodu, jen bez čekání na aktualizace. Vždycky máte poslední
                        verzi.
                    </p>
                </div>

                <div className="mt-10 text-center">
                    <Link href="/login" className="text-[10px] font-bold uppercase tracking-widest text-aisummit-cinnabar hover:text-aisummit-cinnabar/80 transition-colors">
                        Přihlásit se do studia →
                    </Link>
                </div>
            </div>
            <SiteFooter />
        </div>
    )
}
