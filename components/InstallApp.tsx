"use client"

import { useSyncExternalStore } from "react"

/**
 * Instalace na plochu. Chrlit je progresivní webová aplikace — dá se přidat na
 * plochu telefonu i počítače a chová se pak jako běžná appka. Jenže to nikdo
 * neuhodne, takže to tady říkáme nahlas.
 *
 * Prohlížeče se dělí na dva světy:
 *  - **Chromium** pošle `beforeinstallprompt`, což umíme rovnou nabídnout jako
 *    tlačítko. Událost přiletí dřív, než se React namountuje, proto ji odchytává
 *    skript v `app/layout.tsx` a odkládá do `window.__chrlitInstall`.
 *  - **Safari** (a tedy celý iPhone) žádnou takovou událost nemá. Tam zbývá
 *    jediné: ukázat, kde je Sdílet → Přidat na plochu.
 *
 * Stav čteme přes `useSyncExternalStore`, protože nežije v Reactu — sedí
 * v `window`, v `matchMedia` a v `localStorage`.
 */

type BeforeInstallPromptEvent = Event & {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

declare global {
    interface Window {
        __chrlitInstall?: BeforeInstallPromptEvent | null
    }
}

const DISMISS_KEY = "chrlit_install_dismissed"
/** Vlastní událost — localStorage ani `window.__chrlitInstall` samy nekřičí. */
const CHANGED = "chrlit:install-changed"

/** `"ssr"` drží stránku prázdnou, dokud se nepotká se skutečným prohlížečem. */
type InstallState = "ssr" | "installed" | "prompt" | "ios" | "other"

function subscribe(onChange: () => void): () => void {
    const media = window.matchMedia("(display-mode: standalone)")
    media.addEventListener("change", onChange)
    window.addEventListener("beforeinstallprompt", onChange)
    window.addEventListener("appinstalled", onChange)
    window.addEventListener("storage", onChange)
    window.addEventListener(CHANGED, onChange)
    return () => {
        media.removeEventListener("change", onChange)
        window.removeEventListener("beforeinstallprompt", onChange)
        window.removeEventListener("appinstalled", onChange)
        window.removeEventListener("storage", onChange)
        window.removeEventListener(CHANGED, onChange)
    }
}

function readState(): InstallState {
    const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        // Safari na iOS jde vlastní cestou a `display-mode` nehlásí.
        (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    if (standalone) return "installed"

    if (window.__chrlitInstall) return "prompt"

    const ua = window.navigator.userAgent
    const isIos = /iPad|iPhone|iPod/.test(ua) ||
        // iPadOS se od Safari na macOS liší jen dotykem.
        (/Macintosh/.test(ua) && window.navigator.maxTouchPoints > 1)
    return isIos ? "ios" : "other"
}

function readDismissed(): boolean {
    try {
        return localStorage.getItem(DISMISS_KEY) === "1"
    } catch {
        return false // anonymní okno — pruh se vrátí, to nevadí
    }
}

/** Snapshoty musí vracet primitivum, jinak by se React točil dokola. */
function useInstallState(): InstallState {
    return useSyncExternalStore(subscribe, readState, () => "ssr" as const)
}

function useDismissed(): boolean {
    return useSyncExternalStore(subscribe, readDismissed, () => true)
}

function dismiss(): void {
    try { localStorage.setItem(DISMISS_KEY, "1") } catch { /* anonymní okno */ }
    window.dispatchEvent(new Event(CHANGED))
}

async function runInstall(): Promise<void> {
    const evt = window.__chrlitInstall
    if (!evt) return
    await evt.prompt()
    const { outcome } = await evt.userChoice
    // Prompt je jednorázový — druhé volání vyhodí výjimku, tak ho zahazujeme.
    window.__chrlitInstall = null
    if (outcome === "accepted") dismiss()
    window.dispatchEvent(new Event(CHANGED))
}

/** Ikonka „Sdílet" ze Safari — bez ní iOS návod nikdo netrefí. */
function ShareIcon() {
    return (
        <svg className="inline w-3.5 h-3.5 mx-0.5 -mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L8 8m4-4 4 4M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
        </svg>
    )
}

/**
 * Nenápadný pruh v dashboardu. Zavře se natrvalo — pobízet k instalaci podruhé
 * je otravné.
 */
export function InstallBanner() {
    const state = useInstallState()
    const dismissed = useDismissed()

    if (dismissed || state === "ssr" || state === "installed" || state === "other") return null

    return (
        <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-sm border border-white/10 bg-[#0a0a0a] px-4 py-3">
            <div className="flex-1 min-w-[220px]">
                <p className="text-[9px] font-bold uppercase tracking-widest text-white/40">Chrlit v telefonu</p>
                <p className="mt-1 text-xs text-white/60">
                    {state === "prompt"
                        ? "Přidejte si studio na plochu — otevírá se pak na jedno ťuknutí, bez hledání v prohlížeči."
                        : <>Přidejte si studio na plochu: v Safari ťukněte na <ShareIcon /> <strong className="text-white/80">Sdílet</strong> a zvolte <strong className="text-white/80">Přidat na plochu</strong>.</>}
                </p>
            </div>
            {state === "prompt" && (
                <button
                    onClick={runInstall}
                    className="rounded-sm bg-aisummit-cinnabar px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white transition-all hover:bg-aisummit-cinnabar/90 cursor-pointer"
                >
                    Nainstalovat
                </button>
            )}
            <button
                onClick={dismiss}
                aria-label="Skrýt nabídku instalace"
                className="text-[9px] font-bold uppercase tracking-widest text-white/25 hover:text-white/60 transition-colors cursor-pointer"
            >
                Skrýt
            </button>
        </div>
    )
}

/** Velké tlačítko na stránce s návodem. Když prohlížeč instalaci neumí, mlčí. */
export function InstallButton() {
    const state = useInstallState()

    if (state === "installed") {
        return (
            <p className="inline-block rounded-sm border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-xs font-bold uppercase tracking-widest text-emerald-400">
                ✓ Aplikace je nainstalovaná
            </p>
        )
    }

    if (state !== "prompt") return null

    return (
        <button
            onClick={runInstall}
            className="w-full sm:w-auto rounded-sm bg-aisummit-cinnabar px-6 py-3.5 text-[11px] font-black uppercase tracking-widest text-white shadow-[0_0_20px_rgba(229,83,63,0.2)] transition-all hover:bg-aisummit-cinnabar/90 cursor-pointer"
        >
            Nainstalovat Chrlit →
        </button>
    )
}
