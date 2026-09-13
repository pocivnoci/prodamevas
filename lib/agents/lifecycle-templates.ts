/**
 * Znění lifecycle e-mailů — čistá funkce, žádná DB.
 * =================================================
 * Oddělené od `lifecycle.ts` ze stejného důvodu jako `notice-templates.ts`:
 * sken kandidátů sahá na Supabase, ale text e-mailu musí jít vyrenderovat
 * v guardu bez `.env.local`. Tam se totiž pozná prosáklé „?", rodové příčestí
 * i druhý hlas — a jinde se to nepozná vůbec, protože tyhle zprávy nejsou
 * v registru šablon.
 *
 * Jazyk příjemce: texty jsou v `messages/<locale>/notices.json` pod
 * `lifecycle.<kind>`; `t` a `locale` dodá odesílatel (`sendLifecycleEmail` →
 * `localeOfClientOwner`). Bez nich čeština — guard i náhledy renderují zdroj.
 */

import type { StudioSection } from "@/app/(dashboard)/StudioContext"
import { DEFAULT_UI_LOCALE, type UiLocale } from "@/lib/i18n/locales"
import { mailTranslatorSync, type MailTranslator } from "@/lib/mail/i18n"
import { siteUrl, studioDeepLink } from "@/lib/mail/links"

export type LifecycleKind =
    | "activation_nudge" | "credit_low" | "winback" | "waitlist_drip"
    | "dormant" | "ig_disconnected"

/**
 * Jeden hlas pro všechny zprávy: vykání, mluví firma („my"), otevírá „Dobrý den,",
 * podepisuje „Tým Chrlit" a **nikdy nepoužije rodové příčestí o adresátovi**
 * („založil jste si") — e-mail neví, komu píše, a půlce příjemců se netrefí do
 * rodu. Do 9/2026 se tyhle zprávy od zbytku pošty lišily ve všech čtyřech bodech
 * najednou, takže od téže firmy chodily dva různé hlasy.
 *
 * Název značky stojí VŽDY v apozici za pomlčkou, nikdy uvnitř věty: čeština názvy
 * skloňuje a my je skloňovat neumíme („nevzniklo pro Kavárna Alchymista").
 *
 * `null` = zprávu neposílat. Chybějící čísla u docházejících kreditů nejsou
 * kosmetická vada: „zbývá málo z ?" je horší než mlčení.
 */
export function buildLifecycleEmail(
    kind: LifecycleKind,
    vars: { clientName?: string | null; clientId?: string | null; creditsRemaining?: number; creditsTotal?: number },
    t?: MailTranslator,
    locale: UiLocale = DEFAULT_UI_LOCALE,
): { subject: string; body: string } | null {
    const tr = t ?? mailTranslatorSync(locale, "notices")
    const brand = vars.clientName?.trim() || null
    /** „ — Kavárna Alchymista" v apozici za předmětem, nebo nic. */
    const withTag = (subject: string) => (brand ? `${subject} — ${brand}` : subject)
    const studio = (section: StudioSection) =>
        vars.clientId ? studioDeepLink(vars.clientId, section) : `${siteUrl()}/dashboard/instagram`
    const strong = (chunks: string) => `<strong>${chunks}</strong>`
    /** Značka ve větě jen jako `<strong>` uvnitř select větve — bez ní věta drží i tak. */
    const brandVars = { hasBrand: brand ? "yes" : "no", brand: brand ?? "", strong }
    const cta = (section: StudioSection, key: string) => `<a href="${studio(section)}">${tr(key)}</a>`
    /** Pozdrav, odstavce, podpis — týž hlas jako zákaznická oznámení. */
    const compose = (...paragraphs: string[]) =>
        [tr("common.greeting"), ...paragraphs, tr("common.signature")].join("\n\n")

    switch (kind) {
        case "activation_nudge":
            return {
                subject: withTag(tr("lifecycle.activation_nudge.subject")),
                body: compose(
                    tr.markup("lifecycle.activation_nudge.body", brandVars),
                    tr("lifecycle.activation_nudge.next"),
                    cta("plan", "common.cta.openStudio"),
                ),
            }
        case "credit_low": {
            // Bez obou čísel by ve zprávě zůstalo „málo z ?". Radši nic.
            if (typeof vars.creditsRemaining !== "number" || typeof vars.creditsTotal !== "number") return null
            return {
                subject: withTag(tr("lifecycle.credit_low.subject")),
                body: compose(
                    tr.markup("lifecycle.credit_low.body", {
                        ...brandVars,
                        remaining: vars.creditsRemaining,
                        total: Number(vars.creditsTotal),
                    }),
                    cta("settings", "common.cta.manageSubscription"),
                ),
            }
        }
        case "winback":
            return {
                subject: withTag(tr("lifecycle.winback.subject")),
                body: compose(
                    tr.markup("lifecycle.winback.body", brandVars),
                    cta("settings", "common.cta.renewSubscription"),
                ),
            }
        case "dormant":
            return {
                subject: withTag(tr("lifecycle.dormant.subject")),
                body: compose(
                    tr.markup("lifecycle.dormant.body", brandVars),
                    tr("lifecycle.dormant.next"),
                    cta("plan", "common.cta.generateContent"),
                ),
            }
        case "ig_disconnected":
            return {
                subject: withTag(tr("lifecycle.ig_disconnected.subject")),
                body: compose(
                    tr.markup("lifecycle.ig_disconnected.body", brandVars),
                    tr("lifecycle.ig_disconnected.next"),
                    cta("settings", "common.cta.connectInstagram"),
                ),
            }
        case "waitlist_drip":
            return {
                subject: tr("lifecycle.waitlist_drip.subject"),
                body: compose(
                    tr("lifecycle.waitlist_drip.body"),
                    tr("lifecycle.waitlist_drip.next"),
                ),
            }
    }
}
