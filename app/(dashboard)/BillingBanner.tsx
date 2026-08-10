"use client"

import Link from "next/link"
import { useStudio, type SubscriptionState } from "./StudioContext"

/**
 * Pruh nad obsahem, když je něco s předplatným.
 *
 * Existuje proto, že jediné místo, kde se stav fakturace dal zjistit, byl malý
 * štítek v sekci Předplatné — kam se zákazník doklikne teprve tehdy, když už ho
 * něco donutilo hledat. „Selhala vám karta" se nemá dozvídat až tím, že mu
 * přestanou chodit příspěvky.
 *
 * Komponenta nerozhoduje o ničem: `billingState` počítá server
 * (`deriveBillingState` v lib/billing-period.ts). Kdyby si pravidla držel i
 * React, začne dřív nebo později tvrdit něco jiného než e-maily.
 */

type Tone = "warn" | "danger" | "info"

const TONE: Record<Tone, string> = {
    danger: "border-red-500/30 bg-red-500/10 text-red-200",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    info: "border-white/10 bg-white/5 text-white/70",
}

function fmtDate(iso: string | null): string {
    if (!iso) return ""
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" })
}

export function BillingBanner() {
    const { subscription, projectId } = useStudio()
    if (!subscription || subscription.billingState === "ok") return null

    const until = fmtDate(subscription.currentPeriodEnd)
    const href = `/dashboard/instagram?section=subscription${projectId ? `&project=${projectId}` : ""}`

    const { tone, text, cta } = describe(subscription.billingState, {
        until,
        attempt: subscription.billingFailures,
    })

    return (
        <div className={`mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded border px-4 py-3 ${TONE[tone]}`}>
            <p className="text-xs font-medium leading-relaxed">{text}</p>
            <Link
                href={href}
                className="ml-auto shrink-0 text-[10px] font-bold uppercase tracking-widest underline underline-offset-4 hover:opacity-80"
            >
                {cta}
            </Link>
        </div>
    )
}

function describe(
    state: SubscriptionState["billingState"],
    vars: { until: string; attempt: number },
): { tone: Tone; text: string; cta: string } {
    switch (state) {
        case "dunning":
            return {
                tone: "danger",
                text: `Platbu za předplatné se nepodařilo strhnout${vars.attempt ? ` (pokus ${vars.attempt} ze 3)` : ""}. Zkontrolujte prosím kartu — po třetím neúspěchu se generování zastaví.`,
                cta: "Zkontrolovat platbu",
            }
        case "expired":
            return {
                tone: "danger",
                text: "Předplatné vypršelo a generování je pozastavené. Vaše data i naučená značka zůstávají uložené.",
                cta: "Obnovit předplatné",
            }
        case "grace":
            return {
                tone: "warn",
                text: `Zaplacené období skončilo${vars.until ? ` ${vars.until}` : ""}. Ještě pár dní běžíte v odkladu, než se obnova dokončí.`,
                cta: "Zobrazit předplatné",
            }
        case "expiring_soon":
            return {
                tone: "warn",
                text: `Předplatné se obnovuje${vars.until ? ` ${vars.until}` : " během pár dní"}.`,
                cta: "Spravovat plán",
            }
        case "cancelled":
            return {
                tone: "info",
                text: `Předplatné jste zrušili — běží ještě do${vars.until ? ` ${vars.until}` : " konce období"}. Do té doby ho můžete kdykoli obnovit.`,
                cta: "Obnovit",
            }
        default:
            return { tone: "info", text: "", cta: "" }
    }
}
