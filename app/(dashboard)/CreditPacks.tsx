"use client"

/**
 * Dobití kreditů.
 * ===============
 * Žije samostatně, protože se ukazuje na DVOU místech a obě jsou důležité:
 *
 *   – v paywall okně, tedy přesně tam, kde člověk narazil na nedostatek kreditů,
 *   – v Nastavení, kde si to jde udělat dopředu.
 *
 * Do minula aplikace na čtyřech místech slibovala „dobijte si kredity za 49 Kč/ks"
 * a žádná cesta k nákupu neexistovala — tlačítko jen přepnulo do Nastavení, kde
 * byl ceník tarifů. Slib, který se nedá splnit, přicházel ve chvíli, kdy je
 * zákazník zablokovaný uprostřed práce.
 *
 * O platebních branách komponenta nic neví (stejně jako ceník) — posílá `planId`
 * do `/api/payments/create` a bránu vybírá server.
 */

import { useState } from "react"
import { openCheckoutWindow } from "@/lib/open-checkout"
import { useStudio } from "@/app/(dashboard)/StudioContext"
import { CREDIT_PACKS, CREDIT_PACK_PREFIX, EXTRA_CREDIT_HALERU, creditPackPrice, formatCzk } from "@/lib/pricing"

export function CreditPacks({ compact = false }: { compact?: boolean }) {
    const { projectId, subscription } = useStudio()
    const [busy, setBusy] = useState<number | null>(null)
    const [error, setError] = useState<string | null>(null)

    const unit = subscription?.extraCreditPrice ?? EXTRA_CREDIT_HALERU

    const buy = async (credits: number) => {
        if (!projectId) return
        setBusy(credits); setError(null)
        // Okno napřed, ještě před `await` — jinak ho blokátor zahodí a kliknutí
        // vypadá jako by nic neudělalo. Viz lib/open-checkout.ts.
        const checkout = openCheckoutWindow()
        try {
            const resp = await fetch("/api/payments/create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ planId: `${CREDIT_PACK_PREFIX}${credits}`, clientSlug: projectId }),
            })
            const data = await resp.json()
            if (data.redirectUrl) {
                // Odsud se odchází na bránu, takže tahle komponenta se odmountuje
                // a plánovat na ni obnovu stavu nemá smysl — po návratu z brány se
                // studio načte znovu a stav si natáhne samo.
                checkout.go(data.redirectUrl)
            } else {
                checkout.abort()
                setError(data.error || "Platbu se nepodařilo založit.")
            }
        } catch {
            checkout.abort()
            setError("Platbu se nepodařilo založit.")
        } finally {
            setBusy(null)
        }
    }

    return (
        <div>
            <div className={`grid grid-cols-3 gap-2 ${compact ? "" : "sm:gap-3"}`}>
                {CREDIT_PACKS.map(credits => (
                    <button
                        key={credits}
                        onClick={() => buy(credits)}
                        disabled={busy !== null}
                        className={`rounded-sm border border-white/10 bg-[#080808] hover:border-white/25 hover:bg-white/5 transition-all disabled:opacity-50 ${compact ? "px-2 py-3" : "px-3 py-4"}`}
                    >
                        <span className="block text-xl font-black text-white leading-none">{credits}</span>
                        <span className="block text-[8px] font-bold uppercase tracking-widest text-white/30 mt-1">kreditů</span>
                        <span className="block text-[10px] font-bold text-white/60 mt-2">
                            {busy === credits ? "…" : formatCzk(creditPackPrice(credits, unit))}
                        </span>
                    </button>
                ))}
            </div>
            {/* Cena za kus je stejná u všech balíčků — schválně. Množstevní sleva
                by dokupování udělala výhodnější než přechod o tarif výš. */}
            <p className="text-[9px] text-white/25 font-bold uppercase tracking-widest mt-2 text-center">
                {formatCzk(unit)} za kredit · platí do konce měsíčního období
            </p>
            {error && <p className="text-[10px] text-red-400 mt-2 text-center">{error}</p>}
        </div>
    )
}
