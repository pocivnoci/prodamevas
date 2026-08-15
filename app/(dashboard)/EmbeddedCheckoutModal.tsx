"use client"

/**
 * Pokladna uvnitř aplikace.
 * =========================
 * Odchod na hostovanou pokladnu se ukázal jako křehký ve třech kolech po sobě:
 * nové okno zahodil blokátor, pokus otevřít ho dřív než přijde odpověď selhal
 * v nainstalované aplikaci, a přesměrování celé karty uživatele z aplikace
 * vyhodí. Vestavěná pokladna žádnou navigaci nepotřebuje — a podle doporučení
 * Stripu je to rovnocenná první volba, ne ústupek.
 *
 * Serverová strana zůstala beze změny: týž webhook, týž podmíněný claim proti
 * dvojí aktivaci, týž doklad. Liší se jen to, kde se pokladna nakreslí.
 *
 * Stripe.js se MUSÍ načítat z js.stripe.com — kvůli PCI ho nejde přibalit do
 * vlastního bundlu. `loadStripe` se proto volá na úrovni modulu, aby se skript
 * stáhl jednou za relaci, ne při každém otevření pokladny.
 */

import { useEffect, useState } from "react"
import { loadStripe } from "@stripe/stripe-js"
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js"

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
/** null = klíč chybí → volající musí spadnout zpět na hostovanou pokladnu. */
const stripePromise = publishableKey ? loadStripe(publishableKey) : null

export function isEmbeddedCheckoutAvailable(): boolean {
    return stripePromise !== null
}

export function EmbeddedCheckoutModal({
    clientSecret,
    onClose,
}: {
    clientSecret: string
    onClose: () => void
}) {
    const [mounted, setMounted] = useState(false)
    useEffect(() => setMounted(true), [])

    // Escape zavírá; při otevřené pokladně se nesmí scrollovat pozadí, jinak
    // se na mobilu pod modálem posouvá studio.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
        window.addEventListener("keydown", onKey)
        const prev = document.body.style.overflow
        document.body.style.overflow = "hidden"
        return () => {
            window.removeEventListener("keydown", onKey)
            document.body.style.overflow = prev
        }
    }, [onClose])

    if (!stripePromise) return null

    return (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center">
            {/* Kliknutí na pozadí zavírá. Platba tím nezaniká — PENDING řádek
                v `payments` zůstává a reconciler se brány doptá sám. */}
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

            <div className="relative w-full sm:max-w-[560px] max-h-[92dvh] flex flex-col bg-[#0a0a0a] border border-white/10 rounded-t-sm sm:rounded-sm shadow-2xl">
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 shrink-0">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                        Platba
                    </span>
                    <button
                        onClick={onClose}
                        aria-label="Zavřít"
                        className="text-white/40 hover:text-white text-xs font-bold uppercase tracking-widest cursor-pointer"
                    >
                        Zavřít
                    </button>
                </div>

                {/* Stripe si vevnitř řídí vlastní výšku; scroll patří tomuhle obalu,
                    ať se na malém displeji dá dostat na tlačítko zaplatit. */}
                <div className="overflow-y-auto p-1 pb-[env(safe-area-inset-bottom)]">
                    {mounted && (
                        <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret }}>
                            <EmbeddedCheckout />
                        </EmbeddedCheckoutProvider>
                    )}
                </div>
            </div>
        </div>
    )
}
