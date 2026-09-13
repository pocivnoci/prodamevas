/**
 * Znění zákaznických oznámení — čistá funkce, žádná DB.
 * =====================================================
 * Odděleno od `customer-notices.ts` schválně: ten modul sahá na Supabase (dedupe
 * přes `agent_actions`), takže by se text e-mailu nedal vyrenderovat v guardu ani
 * v `scripts/test-customer-notices.ts` bez `.env.local` — a přesně tam se pozná
 * prosáklé „undefined", cena bez věty o DPH nebo druhý hlas. Stejná dělba jako
 * `lib/mail/templates/*` versus `lib/notifications.ts`.
 *
 * Odkazy proto chodí z `lib/mail/links.ts`, ne z `lib/notifications.ts`.
 *
 * Jazyk příjemce: texty žijí v `messages/<locale>/notices.json` (namespace
 * `notices`); překladač `t` a `locale` sem posílá odesílající funkce
 * (`sendCustomerNotice` → `localeOfClientOwner`). Bez nich se renderuje česky,
 * takže aserce guardu nad českým zněním platí dál. Věta o DPH (`vatNotice`) a měna
 * (`formatCzk`) zůstávají české a v Kč — právní text a ceník nejsou překlad.
 */

import { MAX_BILLING_FAILURES } from "@/lib/billing-period"
import type { StudioSection } from "@/app/(dashboard)/StudioContext"
import { DEFAULT_UI_LOCALE, UI_LOCALE_TAGS, UI_TIME_ZONE, type UiLocale } from "@/lib/i18n/locales"
import { vatNotice } from "@/lib/legal"
import { mailTranslatorSync, type MailTranslator } from "@/lib/mail/i18n"
import { siteUrl, studioDeepLink } from "@/lib/mail/links"
import { formatCzk } from "@/lib/pricing"

export type NoticeKind =
    | "renewal_upcoming"
    | "charge_failed"
    | "manual_renew"
    | "expired"
    | "payment_recovered"
    | "generation_failed"
    | "publish_failed"
    | "facts_pending"

export interface NoticeVars {
    clientName?: string | null
    clientId?: string | null
    /** Haléře — formátuje se až v šabloně, nikdy se nepočítá v korunách. */
    amountHaleru?: number | null
    /**
     * Táž částka BEZ DPH. Uvádí se v závorce: ceník je B2B a zákazník se
     * dohodl na základu, ale z karty jde částka s daní — bez obou čísel
     * nesedí e-mail ani s ceníkem, ani s výpisem.
     */
    netHaleru?: number | null
    /** Datum už zformátované v jazyce příjemce, např. „3. 9. 2026". Když je `dateIso`, má přednost. */
    date?: string | null
    /** Datum události v ISO — šablona ho zformátuje v jazyce příjemce. */
    dateIso?: string | null
    /** Automatické stržení (má uložený token) vs. ruční obnova. */
    auto?: boolean
    /** Kolikátý pokus dunningu (1…`MAX_BILLING_FAILURES`). */
    attempt?: number
    /** Čeho se incident týká — „příspěvek plánovaný na 12. 8.". */
    what?: string | null
    /** Délka obnovovaného období v měsících — skloňuje šablona v jazyce příjemce. */
    termMonths?: number | null
    /** Už přeložený popisek období („na 12 měsíců"); `termMonths` má přednost. */
    termLabel?: string | null
    /** Proč to selhalo, jednou větou a bez technikálií. */
    reason?: string | null
    /** Kolik věcí se zprávy týká — „3 příspěvky čekají". Skloňuje šablona. */
    count?: number | null
}

// i18n-ignore-start: popisky pro adminský panel (label akce v `agent_actions`), zákazník je nevidí
export const KIND_LABELS: Record<NoticeKind, string> = {
    renewal_upcoming: "Blíží se obnova",
    charge_failed: "Platba selhala",
    manual_renew: "Ruční obnova",
    expired: "Předplatné vypršelo",
    payment_recovered: "Platba se podařila",
    generation_failed: "Generování selhalo",
    publish_failed: "Publikace selhala",
    facts_pending: "Příspěvky čekají na ověření faktů",
}
// i18n-ignore-end

const APP_URL = () => siteUrl()
const link = (clientId: string | null | undefined, section: StudioSection) =>
    clientId ? studioDeepLink(clientId, section) : `${APP_URL()}/dashboard/instagram`

/**
 * Datum v jazyce příjemce — „3. 9. 2026" / „3 September 2026". Pražský čas jako
 * v dashboardu, aby konec období připadl na týž den, který zákazník vidí ve studiu.
 * Rozbité datum vrací prázdno — šablona pak řekne „brzy" místo „Invalid Date".
 */
export function formatNoticeDate(iso: string, locale: UiLocale): string {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ""
    return new Intl.DateTimeFormat(UI_LOCALE_TAGS[locale], {
        day: "numeric",
        month: locale === "cs" ? "numeric" : "long",
        year: "numeric",
        timeZone: UI_TIME_ZONE,
    }).format(d)
}

/** Tagy pro `t.markup` — zpráva nese `<strong>`, odkaz skládá kód (URL není překlad). */
const strong = (chunks: string) => `<strong>${chunks}</strong>`
const anchor = (href: string, label: string) => `<a href="${href}">${label}</a>`

// ── Šablony ─────────────────────────────────────────────────────────────────

/**
 * `t` a `locale` patří k sobě — odesílatel je bere z `mailTranslatorSync(locale,
 * "notices")` a `localeOfClientOwner`. Bez nich čeština (guard, náhledy).
 */
export function buildCustomerNotice(
    kind: NoticeKind,
    vars: NoticeVars,
    t?: MailTranslator,
    locale: UiLocale = DEFAULT_UI_LOCALE,
): { subject: string; body: string } {
    const tr = t ?? mailTranslatorSync(locale, "notices")
    const name = vars.clientName || tr("common.yourAccount")
    // Předplatné žije v sekci Nastavení — „subscription" není sekce a hash na ni
    // parseHash tiše překlopil na dashboard; každé „Spravovat předplatné →" tak
    // zákazníka poslalo na přehled.
    const sub = link(vars.clientId, "settings")
    const cal = link(vars.clientId, "calendar")

    /**
     * Haléře na koruny umí jedině `formatCzk()` (`lib/pricing.ts`). Lokální kopie
     * dělení stem se tu jednou už rozešla se zbytkem aplikace zaokrouhlením a
     * zákazník dostal e-mail s „3 628,79 Kč".
     */
    const czk = (haleru?: number | null) =>
        typeof haleru === "number" ? formatCzk(haleru) : tr("common.amountPerPlan")

    /** „36 288 Kč (29 990 Kč bez DPH)" — jen když se ta dvě čísla liší. */
    const priceWithNet = (): string => {
        const gross = czk(vars.amountHaleru)
        if (typeof vars.amountHaleru !== "number" || typeof vars.netHaleru !== "number") return gross
        if (vars.netHaleru === vars.amountHaleru) return gross
        return tr("common.priceWithNet", { gross, net: czk(vars.netHaleru) })
    }

    /**
     * Věta o DPH pod zprávou, ve které padlo číslo. Cena bez upřesnění vypadá
     * u plátce jako konečná — a zákazník pak na výpisu najde o pětinu víc.
     */
    const vatFootnote = typeof vars.amountHaleru === "number" ? `\n\n<small>${vatNotice()}</small>` : ""

    /** Pozdrav, odstavce, podpis — jeden hlas pro všechna oznámení. */
    const compose = (...paragraphs: string[]) =>
        [tr("common.greeting"), ...paragraphs, tr("common.signature")].join("\n\n")

    // Datum a délka období se skládají v jazyce příjemce; hotový text (`date`,
    // `termLabel`) je záloha pro volající, kteří ho už mají.
    const date = (vars.dateIso ? formatNoticeDate(vars.dateIso, locale) : "") || vars.date || ""
    const when = date ? "dated" : "soon"
    const term = typeof vars.termMonths === "number" && vars.termMonths > 0
        ? ` ${tr("common.term", { months: vars.termMonths })}`
        : vars.termLabel ? ` ${vars.termLabel}` : ""
    const hasWhat = vars.what ? "yes" : "no"
    const hasReason = vars.reason ? "yes" : "no"
    const incidentVars = { hasWhat, what: vars.what ?? "", name, hasReason, reason: vars.reason ?? "", strong }

    switch (kind) {
        case "renewal_upcoming": {
            // Předmět nesmí tvrdit „za 3 dny": u víceměsíčního období chodí
            // upozornění měsíc dopředu (renewalNoticeDays), protože nečekaných
            // 19 900 Kč na výpisu je nejlevnější cesta k chargebacku.
            return vars.auto
                ? {
                    subject: date ? tr("renewal_upcoming.auto.subjectDated", { date }) : tr("renewal_upcoming.auto.subject"),
                    body: compose(
                        tr.markup("renewal_upcoming.auto.body", { when, date, price: priceWithNet(), term, name, strong }),
                        tr("renewal_upcoming.auto.change"),
                        anchor(sub, tr("common.cta.manageSubscription")),
                    ) + vatFootnote,
                }
                : {
                    subject: date ? tr("renewal_upcoming.manual.subjectDated", { date }) : tr("renewal_upcoming.manual.subject"),
                    body: compose(
                        tr.markup("renewal_upcoming.manual.body", { when, date, name, strong }),
                        anchor(sub, tr("common.cta.renewSubscription")),
                    ),
                }
        }

        case "charge_failed":
            // Počet pokusů je tentýž, podle kterého dunning končí — natvrdo psaná
            // trojka by po změně `MAX_BILLING_FAILURES` slibovala jiný počet, než
            // kolik jich zákazník dostane.
            return {
                subject: tr("charge_failed.subject"),
                body: compose(
                    tr.markup("charge_failed.body", {
                        hasPrice: typeof vars.amountHaleru === "number" ? "yes" : "no",
                        price: priceWithNet(),
                        name,
                        attempt: vars.attempt ?? 0,
                        max: MAX_BILLING_FAILURES,
                        strong,
                    }),
                    anchor(sub, tr("common.cta.checkSubscription")),
                ) + vatFootnote,
            }

        case "manual_renew":
            return {
                subject: tr("manual_renew.subject"),
                body: compose(
                    tr.markup("manual_renew.body", { name, strong }),
                    anchor(sub, tr("common.cta.renewSubscription")),
                ),
            }

        case "expired":
            return {
                subject: tr("expired.subject"),
                body: compose(
                    tr.markup("expired.body", { name, strong }),
                    anchor(sub, tr("common.cta.renewSubscription")),
                ),
            }

        case "payment_recovered":
            return {
                subject: tr("payment_recovered.subject"),
                body: compose(
                    tr.markup("payment_recovered.body", { name, strong }),
                    anchor(sub, tr("common.cta.showSubscription")),
                ),
            }

        // ── Tichý support: produkt se přiznává sám ───────────────────────────
        // Zákazník u toho nebyl, takže se to jinak nedozví — a co se nedozví,
        // na to se druhý den ptá e-mailem. Levnější je říct to první.
        case "generation_failed":
            return {
                subject: tr("generation_failed.subject"),
                body: compose(
                    tr.markup("generation_failed.body", incidentVars),
                    tr("generation_failed.retry"),
                    anchor(cal, tr("common.cta.showCalendar")),
                ),
            }

        // Auto-publikování zadrželo příspěvek, protože v něm zůstalo tvrzení bez
        // opory. Chodí JEDNOU DENNĚ a souhrnně: jeden e-mail na příspěvek by z
        // opatrnosti udělal spam a klient by si příště vypnul kontrolu, ne text.
        case "facts_pending": {
            const count = typeof vars.count === "number" && vars.count > 0 ? vars.count : 1
            return {
                subject: tr("facts_pending.subject", { count }),
                body: compose(
                    tr.markup("facts_pending.body", { name, count, strong }),
                    tr("facts_pending.howTo", { count }),
                    anchor(cal, tr("common.cta.openCalendar")),
                ),
            }
        }

        case "publish_failed":
            return {
                subject: tr("publish_failed.subject"),
                body: compose(
                    tr.markup("publish_failed.body", incidentVars),
                    tr("publish_failed.next"),
                    anchor(cal, tr("common.cta.openCalendar")),
                ),
            }
    }
}
