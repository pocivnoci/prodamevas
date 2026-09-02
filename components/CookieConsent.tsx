"use client"

/**
 * Cookie lišta — reálný opt-in.
 * ═════════════════════════════
 * Do 9/2026 tu žádná nebyla a `GoogleAnalytics.tsx` posílal rovnou
 * `gtag('consent','default',{analytics_storage:'granted'})`. Souhlas natvrdo
 * udělený je z pohledu §89 odst. 3 zákona č. 127/2005 Sb. i GDPR to samé jako
 * žádný souhlas — a zásady zpracování přitom tvrdily, že analytické cookies
 * třetích stran vůbec nepoužíváme. Buď platí text, nebo kód; obojí zároveň ne.
 *
 * Jak to funguje teď:
 *   1. Výchozí stav je `denied` a nastavuje ho `GoogleAnalytics` JEŠTĚ PŘED
 *      načtením gtag.js — pořadí je podstatné, protože souhlas udělený až po
 *      prvním `config` volání nezabrání tomu prvnímu měření.
 *   2. Tahle lišta se ukáže jen tomu, kdo se ještě nerozhodl.
 *   3. Rozhodnutí se ukládá do `localStorage` a propíše se do Consent Mode.
 *
 * Odmítnutí je **rovnocenné tlačítko**, ne odkaz schovaný v patičce: souhlas
 * musí být svobodný, a design, kde je „Přijmout" nápadné a „Odmítnout" skryté,
 * svobodný není.
 *
 * `localStorage` může být nedostupný (privátní okno, zablokovaná data webu).
 * Každý přístup je proto v try/catch a při chybě se lišta chová jako u člověka,
 * který se ještě nerozhodl — tedy měření zůstane vypnuté. Selhat se má směrem
 * k soukromí.
 */

import { useSyncExternalStore, useCallback } from "react"
import Link from "next/link"

export const CONSENT_KEY = "chrlit-cookie-consent"

export type ConsentValue = "granted" | "denied"

/** Uložené rozhodnutí, nebo `null` když se člověk ještě nerozhodl. */
export function readConsent(): ConsentValue | null {
    try {
        const v = window.localStorage.getItem(CONSENT_KEY)
        return v === "granted" || v === "denied" ? v : null
    } catch {
        return null
    }
}

function writeConsent(v: ConsentValue): void {
    try {
        window.localStorage.setItem(CONSENT_KEY, v)
    } catch {
        /* Bez úložiště se rozhodnutí nezapamatuje — lišta se příště zeptá znovu.
           To je otravné, ale správné: alternativa je měřit bez souhlasu. */
    }
}

/** Propíše rozhodnutí do Google Consent Mode, pokud je gtag na stránce. */
function applyConsent(v: ConsentValue): void {
    const gtag = (window as unknown as { gtag?: (...a: unknown[]) => void }).gtag
    if (typeof gtag === "function") {
        gtag("consent", "update", { analytics_storage: v })
    }
}

/**
 * Odběratelé změny rozhodnutí. `useSyncExternalStore` je tu správný nástroj:
 * hodnota žije MIMO React (v `localStorage`) a na serveru neexistuje vůbec.
 * Čtení v efektu by znamenalo `setState` hned po prvním renderu, tedy zbytečné
 * překreslení a bliknutí lišty i u toho, kdo se dávno rozhodl.
 */
const listeners = new Set<() => void>()

function subscribe(fn: () => void): () => void {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
}

/** Na serveru se lišta nikdy nevykresluje — vrací se hodnota „už rozhodnuto". */
function serverSnapshot(): ConsentValue | null {
    return "denied"
}

export function CookieConsent() {
    const decided = useSyncExternalStore(subscribe, readConsent, serverSnapshot)

    const choose = useCallback((v: ConsentValue) => {
        writeConsent(v)
        applyConsent(v)
        listeners.forEach((fn) => fn())
    }, [])

    // Rozhodnuto (nebo server) → lišta se nezobrazuje.
    if (decided !== null) return null

    return (
        <div
            role="dialog"
            aria-live="polite"
            aria-label="Souhlas s cookies"
            className="fixed bottom-0 inset-x-0 z-[10000] border-t border-white/10 bg-[#050505]/95 backdrop-blur-sm"
        >
            <div className="max-w-5xl mx-auto px-6 py-5 flex flex-col md:flex-row md:items-center gap-4 md:gap-8">
                <div className="flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-2">
                        Cookies
                    </p>
                    <p className="text-xs text-white/70 leading-relaxed max-w-2xl">
                        Technicky nezbytné cookies pro přihlášení používáme vždy — bez nich by služba nefungovala.
                        Kromě nich bychom rádi měřili návštěvnost přes Google Analytics, abychom věděli, co na webu
                        opravit. To spustíme jen s vaším souhlasem a můžete ho kdykoli odvolat.{" "}
                        <Link href="/privacy" className="underline text-white/80 hover:text-white">
                            Zásady zpracování údajů
                        </Link>
                    </p>
                </div>
                <div className="flex gap-3 shrink-0">
                    <button
                        type="button"
                        onClick={() => choose("denied")}
                        className="px-5 py-2.5 text-[11px] font-bold uppercase tracking-widest border border-white/20 text-white/70 hover:text-white hover:border-white/40 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                    >
                        Odmítnout
                    </button>
                    <button
                        type="button"
                        onClick={() => choose("granted")}
                        className="px-5 py-2.5 text-[11px] font-bold uppercase tracking-widest bg-white text-black hover:bg-white/90 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                    >
                        Povolit měření
                    </button>
                </div>
            </div>
        </div>
    )
}
