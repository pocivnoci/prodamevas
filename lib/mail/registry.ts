/**
 * Registr šablon — jediný seznam, ze kterého čte všechno ostatní.
 * ===============================================================
 * Picker v Mailingu, náhledová galerie i aserce sekce 29 berou šablony odsud.
 * Nová šablona se tedy přidá **na jedno místo** a hned se objeví v panelu,
 * v náhledu i v testech; zapomenout ji někam dopsat nejde.
 *
 * Registr, ne re-export barrel: `lib/notifications.ts` si tenhle modul nesmí
 * natáhnout (uzavřelo by to cyklus přes `layout.ts`), a cron lambdy, které
 * dělají `await import("@/lib/email")`, nemají důvod tahat s sebou všechny
 * šablony. Vzor je `lib/channels/index.ts`.
 *
 * `render`/`draft` jen propouštějí `locale` do `renderTemplate`/`buildTemplate`
 * — bez něj čeština, takže volající, který jazyk příjemce nezná, dostane to,
 * co dřív.
 */

import type { UiLocale } from "@/lib/i18n/locales"
import type { EmailTemplate, RenderedTemplate, TemplateDraft, TemplateVars } from "./template"
import { buildTemplate, renderTemplate } from "./template"
import { announcement, news } from "./templates/news"
import { coldOffer, offer, offerFollowup } from "./templates/offer"
import { promo } from "./templates/promo"
import {
    subscriptionChargeFailed, subscriptionExpired, subscriptionRenewal, subscriptionWinback,
} from "./templates/subscription"
import { clientHandoff, clientHandoffDone, receipt, welcome } from "./templates/transactional"
import { waitlistInvite, waitlistWelcome } from "./templates/waitlist"

export interface RegisteredTemplate extends EmailTemplate {
    /**
     * Šablona + proměnné → hotová zpráva v jazyce příjemce (bez `locale` čeština).
     * `sample` stačí předat rovnou.
     */
    render(vars: TemplateVars, unsubscribeEmail?: string, locale?: UiLocale): RenderedTemplate
    /** Totéž bez slupky — předmět a bloky pro `sendNotification({ blocks })`. */
    draft(vars: TemplateVars, locale?: UiLocale): TemplateDraft
}

const ALL: EmailTemplate[] = [
    waitlistWelcome,
    waitlistInvite,
    news,
    announcement,
    promo,
    coldOffer,
    offer,
    offerFollowup,
    subscriptionRenewal,
    subscriptionChargeFailed,
    subscriptionExpired,
    subscriptionWinback,
    welcome,
    receipt,
    clientHandoff,
    clientHandoffDone,
]

export const EMAIL_TEMPLATES: RegisteredTemplate[] = ALL.map(t => ({
    ...t,
    render: (vars, unsubscribeEmail, locale) => renderTemplate(t, vars, unsubscribeEmail, locale),
    draft: (vars, locale) => buildTemplate(t, vars, locale),
}))

/** Šablony nabízené k hromadnému odeslání v Mailingu. */
export const BROADCAST_TEMPLATES = EMAIL_TEMPLATES.filter(t => t.broadcast)

export function getTemplate(id: string): RegisteredTemplate | null {
    return EMAIL_TEMPLATES.find(t => t.id === id) ?? null
}

/** Lidský název skupiny — používá adminský náhled (`scripts/preview-emails.ts`). */
// i18n-ignore-start: popisky skupin pro správce (náhledová galerie), ne pro zákazníka
export const GROUP_LABELS: Record<EmailTemplate["group"], string> = {
    waitlist: "Waitlist",
    subscription: "Předplatné",
    news: "Novinky",
    promo: "Akce",
    transactional: "Transakční",
}
// i18n-ignore-end
