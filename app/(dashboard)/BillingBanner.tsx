"use client"

import { useLocale, useTranslations } from "next-intl"
import { useStudio, useStudioNavigate, type SubscriptionState } from "./StudioContext"
import { UI_LOCALE_TAGS, type UiLocale } from "@/lib/i18n/locales"

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

function fmtDate(iso: string | null, locale: string): string {
    if (!iso) return ""
    const d = new Date(iso)
    const tag = UI_LOCALE_TAGS[locale as UiLocale] ?? UI_LOCALE_TAGS.cs
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(tag, { day: "numeric", month: "numeric", year: "numeric" })
}

/** Stavy, pro které existuje text i CTA v messages (`shell.billing.<state>` / `<state>Cta`). */
const BANNER_STATES: Record<string, Tone> = {
    dunning: "danger",
    expired: "danger",
    grace: "warn",
    expiring_soon: "warn",
    cancelled: "info",
    gift_ending: "info",
}

export function BillingBanner() {
    const { subscription } = useStudio()
    // Sekce je stav (hash), ne query parametr: `?section=subscription` nikdo nečetl a
    // „subscription" ani není sekce — CTA na opravu karty vedlo na přehled.
    const navigate = useStudioNavigate()
    const t = useTranslations("shell.billing")
    const locale = useLocale()
    if (!subscription || subscription.billingState === "ok") return null

    const { tone, text, cta } = describe(subscription.billingState, {
        until: fmtDate(subscription.currentPeriodEnd, locale),
        attempt: subscription.billingFailures,
    }, t)

    return (
        <div className={`mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded border px-4 py-3 ${TONE[tone]}`}>
            <p className="text-xs font-medium leading-relaxed">{text}</p>
            <button
                type="button"
                onClick={() => navigate("settings")}
                className="ml-auto shrink-0 text-[10px] font-bold uppercase tracking-widest underline underline-offset-4 hover:opacity-80"
            >
                {cta}
            </button>
        </div>
    )
}

function describe(
    state: SubscriptionState["billingState"],
    vars: { until: string; attempt: number },
    t: ReturnType<typeof useTranslations<"shell.billing">>,
): { tone: Tone; text: string; cta: string } {
    const tone = BANNER_STATES[state]
    if (!tone) return { tone: "info", text: "", cta: "" }
    // `none` = sentinel pro ICU select: bez data se věta dokončí obecně („během pár dní").
    return {
        tone,
        text: t(state, { attempt: vars.attempt ?? 0, until: vars.until || "none" }),
        cta: t(`${state}Cta`),
    }
}
