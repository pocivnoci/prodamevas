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
 */

import type { EmailTemplate, RenderedTemplate, TemplateVars } from "./template"
import { renderTemplate } from "./template"
import { announcement, news } from "./templates/news"
import { promo } from "./templates/promo"
import {
    subscriptionChargeFailed, subscriptionExpired, subscriptionRenewal, subscriptionWinback,
} from "./templates/subscription"
import { receipt, welcome } from "./templates/transactional"
import { waitlistInvite, waitlistWelcome } from "./templates/waitlist"

export interface RegisteredTemplate extends EmailTemplate {
    /** Šablona + proměnné → hotová zpráva. `sample` stačí předat rovnou. */
    render(vars: TemplateVars, unsubscribeEmail?: string): RenderedTemplate
}

const ALL: EmailTemplate[] = [
    waitlistWelcome,
    waitlistInvite,
    news,
    announcement,
    promo,
    subscriptionRenewal,
    subscriptionChargeFailed,
    subscriptionExpired,
    subscriptionWinback,
    welcome,
    receipt,
]

export const EMAIL_TEMPLATES: RegisteredTemplate[] = ALL.map(t => ({
    ...t,
    render: (vars, unsubscribeEmail) => renderTemplate(t, vars, unsubscribeEmail),
}))

/** Šablony nabízené k hromadnému odeslání v Mailingu. */
export const BROADCAST_TEMPLATES = EMAIL_TEMPLATES.filter(t => t.broadcast)

export function getTemplate(id: string): RegisteredTemplate | null {
    return EMAIL_TEMPLATES.find(t => t.id === id) ?? null
}

/** Lidský název skupiny — používá picker i galerie. */
export const GROUP_LABELS: Record<EmailTemplate["group"], string> = {
    waitlist: "Waitlist",
    subscription: "Předplatné",
    news: "Novinky",
    promo: "Akce",
    transactional: "Transakční",
}
