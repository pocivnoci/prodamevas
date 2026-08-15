"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence, useDragControls } from "framer-motion"
import { Sparkles, MoreHorizontal } from "lucide-react"

import { useStudio, useStudioNavigate, type StudioSection } from "./StudioContext"
import { StudioNavPanel } from "./StudioNavPanel"
import { BOTTOM_NAV_LEFT, BOTTOM_NAV_RIGHT, navItem, navMatches } from "./nav"

/**
 * Spodní navigační lišta — **jen na telefonu**.
 *
 * Předtím vedla na mobilu veškerá navigace přes jediný hamburger v pravém horním
 * rohu, tedy z místa, kam se palcem nedosáhne. Čtyři nejčastější cíle jsou teď
 * na dosah a zbytek studia se otevírá zdola pod „Více".
 *
 * `z-40` je zvolené tak, aby lišta byla nad obsahem (`main` má `z-10`), ale pod
 * vším, co si žádá pozornost: modály `z-50`, backdrop sheetu `z-[55]`, paywall
 * `z-[99]`, detail příspěvku `z-[9999]`. Díky tomu se ve stávající z-index mapě
 * nemuselo nic posouvat.
 */

function NavSlot({ section, onNavigate }: { section: StudioSection; onNavigate: (s: StudioSection, active: boolean) => void }) {
    const { activeSection } = useStudio()
    const item = navItem(section)
    if (!item) return null

    const active = navMatches(item, activeSection)
    const Icon = item.icon

    return (
        <button
            onClick={() => onNavigate(section, active)}
            aria-current={active ? "page" : undefined}
            className={`relative flex flex-col items-center justify-center gap-1 h-full transition-colors cursor-pointer ${
                active ? "text-white" : "text-white/35 active:text-white/70"
            }`}
        >
            {active && (
                <span className="absolute top-0 inset-x-3 h-[2px] bg-aisummit-cinnabar shadow-[0_0_8px_rgba(230,57,70,0.7)]" />
            )}
            <Icon className={`w-5 h-5 transition-transform ${active ? "scale-110" : ""}`} />
            <span className="text-[9px] font-bold uppercase tracking-widest leading-none">
                {item.shortLabel ?? item.label}
            </span>
        </button>
    )
}

export function BottomNav() {
    const { activeSection, setGenerateIntent } = useStudio()
    const navigate = useStudioNavigate()
    const [sheetOpen, setSheetOpen] = useState(false)
    /** Tažení panelu spouští jen úchyt — viz `dragListener={false}` níž. */
    const dragControls = useDragControls()

    // Zavřít na Escape (hardwarová klávesnice u tabletu) a při odchodu ze sekce.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSheetOpen(false) }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [])

    const handleNavigate = (s: StudioSection, active: boolean) => {
        if (active) {
            // Ťuknutí na už otevřenou položku = zpátky nahoru. `replace`, aby se
            // historie neplnila stejným záznamem a tlačítko zpět dál fungovalo.
            window.scrollTo({ top: 0, behavior: "smooth" })
            navigate(s, { replace: true })
            return
        }
        navigate(s)
    }

    const generateActive = activeSection === "generate"

    return (
        <>
            <nav
                aria-label="Hlavní navigace"
                className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-[#050505]/95 backdrop-blur-2xl border-t border-white/5 pb-[env(safe-area-inset-bottom)]"
            >
                <div className="grid grid-cols-5 h-[var(--studio-navbar-h)]">
                    {BOTTOM_NAV_LEFT.map(s => (
                        <NavSlot key={s} section={s} onNavigate={handleNavigate} />
                    ))}

                    {/* Hlavní akce. Vystupuje z lišty, takže obal nesmí ořezávat
                        (`overflow-hidden`) a nesmí brát doteky mimo samotné tlačítko. */}
                    <div className="relative flex items-start justify-center pointer-events-none">
                        <button
                            onClick={() => { setGenerateIntent(null); navigate("generate") }}
                            aria-label="Generovat"
                            aria-current={generateActive ? "page" : undefined}
                            className={`pointer-events-auto -translate-y-5 w-14 h-14 rounded-sm flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer bg-gradient-to-br from-aisummit-cinnabar to-orange-600 text-white shadow-[0_0_24px_rgba(230,57,70,0.45)] active:scale-95 ${
                                generateActive ? "ring-2 ring-white/70" : ""
                            }`}
                        >
                            <Sparkles className="w-5 h-5" />
                            <span className="text-[7px] font-black uppercase tracking-widest leading-none">Tvořit</span>
                        </button>
                    </div>

                    {BOTTOM_NAV_RIGHT.map(s => (
                        <NavSlot key={s} section={s} onNavigate={handleNavigate} />
                    ))}

                    <button
                        onClick={() => setSheetOpen(true)}
                        aria-label="Další sekce"
                        aria-expanded={sheetOpen}
                        className={`flex flex-col items-center justify-center gap-1 h-full transition-colors cursor-pointer ${
                            sheetOpen ? "text-white" : "text-white/35 active:text-white/70"
                        }`}
                    >
                        <MoreHorizontal className="w-5 h-5" />
                        <span className="text-[9px] font-bold uppercase tracking-widest leading-none">Více</span>
                    </button>
                </div>
            </nav>

            <AnimatePresence>
                {sheetOpen && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setSheetOpen(false)}
                            className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-[55]"
                        />
                        <motion.div
                            // Panel vyjíždí zdola, tedy z místa, kde se ho člověk dotkl.
                            // Vyjíždění zleva by se spodní lištou nedávalo prostorový smysl
                            // a jeho horní položky by byly mimo dosah palce.
                            initial={{ y: "100%" }}
                            animate={{ y: 0 }}
                            exit={{ y: "100%" }}
                            transition={{ type: "spring", stiffness: 400, damping: 40 }}
                            drag="y"
                            // Táhne se JEN za úchyt, ne za celý panel. S taháním za
                            // celou plochu si framer-motion bral i svislé gesto uvnitř
                            // seznamu: kdo chtěl doscrollovat dolů, místo toho panel
                            // zavřel — a na položky na konci (Odhlásit se) se tím pádem
                            // vůbec nedalo dostat.
                            dragListener={false}
                            dragControls={dragControls}
                            dragConstraints={{ top: 0, bottom: 0 }}
                            dragElastic={{ top: 0, bottom: 0.4 }}
                            onDragEnd={(_, info) => {
                                if (info.offset.y > 100 || info.velocity.y > 500) setSheetOpen(false)
                            }}
                            className="lg:hidden fixed inset-x-0 bottom-0 z-[58] max-h-[85dvh] flex flex-col bg-[#050505]/98 backdrop-blur-2xl border-t border-white/10 rounded-t-sm pb-[env(safe-area-inset-bottom)]"
                        >
                            {/* Úchyt — zároveň značí, že se dá zavřít stažením dolů.
                                `touch-none` je nutné: bez něj prohlížeč gesto zpracuje
                                sám jako scroll a tažení se nespustí. */}
                            <div
                                onPointerDown={e => dragControls.start(e)}
                                className="shrink-0 py-3 flex justify-center cursor-grab active:cursor-grabbing touch-none"
                            >
                                <span className="w-10 h-1 rounded-full bg-white/20" />
                            </div>
                            <StudioNavPanel variant="sheet" onNavigate={() => setSheetOpen(false)} />
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </>
    )
}
