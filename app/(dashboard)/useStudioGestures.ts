"use client"

import { useEffect, useRef, type RefObject } from "react"
import { useStudio, useStudioNavigate, type StudioSection } from "./StudioContext"
import { SWIPE_ORDER } from "./nav"

/**
 * Dotyková gesta studia: přejíždění mezi hlavními sekcemi a tažení pro obnovení.
 *
 * Obojí je za `GESTURES_ENABLED`. Gesta jsou nejkřehčí část mobilního UI —
 * kolidují se scrollem, s vnořenými posuvnými pásy i se systémovými gesty
 * telefonu. Když se ukáže, že víc škodí než pomáhají, vypnou se jedním řádkem
 * bez revertu zbytku.
 *
 * Obě gesta sahají na DOM přímo, **ne přes stav Reactu**. Prst pošle desítky
 * událostí za vteřinu a překreslení by pokaždé znamenalo přerenderovat celý
 * otevřený tab — GenerateTab má 140 kB zdrojáku.
 */
export const GESTURES_ENABLED = true

/** Sekce, ze kterých se nesmí odejít omylem — drží rozepsaný stav. */
const NO_GESTURE_SECTIONS: StudioSection[] = ["generate", "settings", "onboard"]

/**
 * Leží bod doteku uvnitř něčeho, co se samo posouvá do stran?
 *
 * Tohle je jádro celé věci. Studio má vodorovné pásy s čipy, karusel návrhů
 * i širokou tabulku — a bude jich přibývat. Seznam výjimek by zastaral, takže
 * se místo něj ptáme DOM: má některý předek víc obsahu, než se do něj vejde,
 * a posouvá se? Pak gesto vůbec nezaložíme a nechá se scrollovat jemu.
 */
function insideHorizontalScroller(target: EventTarget | null, root: HTMLElement): boolean {
    let el = target as HTMLElement | null
    while (el && el !== root) {
        if (el.scrollWidth > el.clientWidth + 1) {
            const overflowX = getComputedStyle(el).overflowX
            if (overflowX === "auto" || overflowX === "scroll") return true
        }
        el = el.parentElement
    }
    return false
}

/** Textová pole si drží vlastní výběr a kurzor — gesto by ho přebilo. */
function isTextEntry(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null
    return !!el?.closest?.("input, textarea, select, [contenteditable='true']")
}

/** Otevřený modál zamyká scroll na body; dokud drží, gesta mlčí. */
function modalOpen(): boolean {
    return document.body.style.overflow === "hidden"
}

function gesturesAllowed(section: StudioSection): boolean {
    return GESTURES_ENABLED && !NO_GESTURE_SECTIONS.includes(section) && !modalOpen()
}

/** Přejíždění mezi sekcemi spodní lišty. Gesto se navěsí na `ref`. */
export function useSwipeSections(ref: RefObject<HTMLElement | null>) {
    const { activeSection } = useStudio()
    const navigate = useStudioNavigate()

    // Aktivní sekce se čte uvnitř posluchačů — ref, ať se nemusí převěšovat
    // při každém přepnutí tabu. Zápis patří do efektu: React 19 zakazuje sahat
    // na refy při renderu a o commit pozdější hodnota tu nevadí, dřív než se
    // překreslí se nikdo prstem netrefí.
    const sectionRef = useRef(activeSection)
    useEffect(() => { sectionRef.current = activeSection }, [activeSection])

    useEffect(() => {
        const root = ref.current
        if (!root || !GESTURES_ENABLED) return

        let startX = 0, startY = 0
        let pointerId: number | null = null
        /** null = ještě nerozhodnuto, false = patří scrollu, true = naše */
        let claimed: boolean | null = null

        const paint = (dx: number) => {
            root.style.transform = dx ? `translateX(${dx}px)` : ""
            root.style.transition = dx ? "none" : "transform .2s ease-out"
        }

        const reset = () => { pointerId = null; claimed = null; paint(0) }

        const onDown = (e: PointerEvent) => {
            if (pointerId !== null || !e.isPrimary) return
            if (!gesturesAllowed(sectionRef.current)) return
            if (isTextEntry(e.target) || insideHorizontalScroller(e.target, root)) return
            // Systémové „zpět" na iOS začíná u kraje — tam se neplete.
            if (e.clientX < 24 || e.clientX > window.innerWidth - 24) return

            pointerId = e.pointerId
            startX = e.clientX
            startY = e.clientY
            claimed = null
        }

        const onMove = (e: PointerEvent) => {
            if (e.pointerId !== pointerId) return
            const dx = e.clientX - startX
            const dy = e.clientY - startY

            if (claimed === null) {
                // Jednosměrný zámek: jakmile gesto připadne svislému scrollu,
                // už si ho nevezme zpátky, i kdyby prst zahnul do strany.
                if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return
                claimed = Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5
                if (!claimed) { pointerId = null; return }
            }

            const idx = SWIPE_ORDER.indexOf(sectionRef.current)
            const atEdge = (dx > 0 && idx <= 0) || (dx < 0 && idx >= SWIPE_ORDER.length - 1)
            // Na kraji jde potáhnout jen symbolicky — signál „dál to nejde".
            paint(dx / (atEdge ? 8 : 3))
        }

        const onUp = (e: PointerEvent) => {
            if (e.pointerId !== pointerId) return
            const dx = e.clientX - startX
            const idx = SWIPE_ORDER.indexOf(sectionRef.current)
            const claimedNow = claimed

            reset()

            if (claimedNow && idx >= 0 && Math.abs(dx) > window.innerWidth * 0.25) {
                const next = SWIPE_ORDER[idx + (dx < 0 ? 1 : -1)]
                if (next) navigate(next)
            }
        }

        root.addEventListener("pointerdown", onDown, { passive: true })
        root.addEventListener("pointermove", onMove, { passive: true })
        root.addEventListener("pointerup", onUp, { passive: true })
        root.addEventListener("pointercancel", reset, { passive: true })
        return () => {
            root.removeEventListener("pointerdown", onDown)
            root.removeEventListener("pointermove", onMove)
            root.removeEventListener("pointerup", onUp)
            root.removeEventListener("pointercancel", reset)
            root.style.transform = ""
            root.style.transition = ""
        }
    }, [ref, navigate])
}

/**
 * Tažení pro obnovení — **jen v aplikaci přidané na plochu**.
 *
 * V prohlížeči má iOS i Chrome vlastní tažení, které stránku načte znovu.
 * Soupeřit s ním by znamenalo udělat z obsahu vlastní scroll kontejner, což by
 * rozbilo zamykání scrollu v modálech. Manifest má `display: standalone`, takže
 * na ploše nativní tažení chybí a tohle ho nahradí — bez načtení celé stránky.
 */
export function usePullToRefresh(indicatorRef: RefObject<HTMLElement | null>, onRefresh: () => void) {
    const { activeSection } = useStudio()

    const sectionRef = useRef(activeSection)
    const refreshRef = useRef(onRefresh)
    useEffect(() => { sectionRef.current = activeSection }, [activeSection])
    useEffect(() => { refreshRef.current = onRefresh }, [onRefresh])

    useEffect(() => {
        if (!GESTURES_ENABLED) return
        const standalone = window.matchMedia("(display-mode: standalone)").matches
            || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
        if (!standalone) return

        const THRESHOLD = 64
        let startY = 0
        let pull = 0
        let active = false

        const paint = () => {
            const el = indicatorRef.current
            if (!el) return
            el.style.transform = `translateY(${pull}px)`
            el.style.opacity = String(Math.min(1, pull / THRESHOLD))
            el.style.transition = active ? "none" : "transform .25s ease-out, opacity .25s ease-out"
        }

        const onStart = (e: TouchEvent) => {
            if (window.scrollY > 0) return
            if (!gesturesAllowed(sectionRef.current)) return
            startY = e.touches[0].clientY
            active = true
        }

        const onMove = (e: TouchEvent) => {
            if (!active) return
            const dy = e.touches[0].clientY - startY
            if (dy <= 0) { active = false; pull = 0; paint(); return }
            pull = Math.min(dy * 0.4, 96)
            paint()
        }

        const onEnd = () => {
            if (!active) return
            active = false
            const fired = pull >= THRESHOLD
            pull = 0
            paint()
            if (fired) refreshRef.current()
        }

        window.addEventListener("touchstart", onStart, { passive: true })
        window.addEventListener("touchmove", onMove, { passive: true })
        window.addEventListener("touchend", onEnd, { passive: true })
        window.addEventListener("touchcancel", onEnd, { passive: true })
        return () => {
            window.removeEventListener("touchstart", onStart)
            window.removeEventListener("touchmove", onMove)
            window.removeEventListener("touchend", onEnd)
            window.removeEventListener("touchcancel", onEnd)
        }
    }, [indicatorRef])
}
