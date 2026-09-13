/**
 * Konec předplatného — obnova, neúspěšná platba, doběhlo, získání zpět.
 *
 * Všechny tři uvádějí částku. Je to schválně: zpráva „předplatné se obnoví"
 * bez čísla vede u delších období k tomu, že zákazníka o měsíc později
 * překvapí 19 900 Kč na výpisu a řeší se chargeback. Proto taky `pricing: true`
 * — aserce 29.8 pak vynutí větu o DPH.
 *
 * Číslo se ale nepíše ručně: `sample` je v Mailingu předvyplnění formuláře, ne
 * náhled, takže cena z ceníku v5 („1 990 Kč" u Růstu) odsud odcházela zákazníkům
 * o tisícovku pod skutečností. Bere se z `../plans` — hlídá aserce 29.17.
 *
 * Texty jdou z `messages/<locale>/mail.json` (`mail.templates.<id>.*`) — e-mail
 * mluví jazykem příjemce; věta o DPH a měna zůstávají české (`vatNotice`,
 * `formatCzk`). Popisky formuláře a ukázky čte jen správce, zůstávají česky.
 */

import { vatNotice } from "@/lib/legal"
import { MAX_BILLING_FAILURES } from "@/lib/billing-period"
import { formatCzk, normalizeTermMonths, termPrice } from "@/lib/pricing"
import { button, callout, compact, footnote, heading, list, paragraph, promoCode } from "../blocks"
import { siteUrl } from "../links"
import { pickPlan, reelsLive, samplePlanName, samplePrice, samplePriceMonthly } from "../plans"
import { withGreeting, type EmailTemplate } from "../template"

export const subscriptionRenewal: EmailTemplate = {
    id: "subscription_renewal",
    // i18n-ignore-start: popisky formuláře v Mailingu a ukázková data — čte je jen správce
    label: "Předplatné — blíží se obnova",
    group: "subscription",
    kind: "transactional",
    pricing: true,
    fields: [
        { key: "planName", label: "Tarif", type: "text", required: true },
        { key: "termMonths", label: "Období (1, 3, 6 nebo 12)", type: "text", placeholder: "12", help: "Cena za období se dopočítá z ceníku, nepíše se ručně." },
        { key: "price", label: "Částka", type: "text", placeholder: samplePrice(), help: "Použije se jen bez vyplněného období — jinak cenu určí ceník." },
        { key: "renewsOn", label: "Datum obnovy", type: "text", required: true },
        { key: "manageUrl", label: "Odkaz na správu předplatného", type: "url", required: true },
    ],
    sample: {
        planName: samplePlanName(),
        termMonths: "1",
        // Ukázka je v Mailingu předvyplnění formuláře, takže musí sedět
        // s ceníkem — u měsíčního období je cena období rovna měsíční sazbě.
        price: samplePrice(),
        renewsOn: "5. 9. 2026",
        manageUrl: `${siteUrl()}/dashboard/instagram#settings`,
    },
    // i18n-ignore-end
    // Strhává se cena ZAPLACENÉHO OBDOBÍ, ne měsíční sazba tarifu. Do 9/2026 tu
    // stála měsíční cena jako cena obnovy, takže roční zákazník četl 2 999 Kč
    // a z karty mu odešlo 29 990 Kč — přesně ten rozdíl na výpisu, kvůli kterému
    // se z obnovy stane chargeback. Číslo proto pochází z ceníku (`termPrice`),
    // ne z ruky.
    build: (v, t) => {
        // Vyplněné období = cenu určuje ceník, ne ruka. Ručně psaná částka se
        // uplatní jen tam, kde období není (jednorázová domluva) — jinak by
        // stačilo zapomenout ji přepsat a roční zákazník by četl měsíční sazbu.
        const hasTerm = /^(1|3|6|12)$/.test((v.termMonths || "").trim())
        const term = normalizeTermMonths(v.termMonths || "1")
        const plan = pickPlan(v.planName || "")
        const price = hasTerm
            ? formatCzk(termPrice(plan.monthlyHaleru, term))
            : v.price?.trim() || formatCzk(plan.monthlyHaleru)
        return {
            subject: t("templates.subscription_renewal.subject", { planName: v.planName, renewsOn: v.renewsOn }),
            eyebrow: t("common.subscription"),
            preheader: `${price} · ${v.renewsOn}`,
            blocks: [
                heading(t("templates.subscription_renewal.heading")),
                // Délka období se skloňuje v messages (ICU plural); bez vyplněného
                // období se dovětek „na N měsíců" vynechá (větev `=1` je prázdná).
                paragraph(withGreeting(t, t("templates.subscription_renewal.intro", {
                    planName: v.planName,
                    renewsOn: v.renewsOn,
                    price,
                    term: hasTerm ? term : 1,
                }))),
                paragraph(t("templates.subscription_renewal.cancelHint")),
                button(t("templates.subscription_renewal.cta"), v.manageUrl),
                footnote(vatNotice()),
            ],
        }
    },
}

export const subscriptionChargeFailed: EmailTemplate = {
    id: "subscription_charge_failed",
    // i18n-ignore-start: popisky formuláře v Mailingu a ukázková data — čte je jen správce
    label: "Předplatné — platba neprošla",
    group: "subscription",
    kind: "transactional",
    pricing: true,
    fields: [
        { key: "planName", label: "Tarif", type: "text", required: true },
        { key: "price", label: "Částka", type: "text", required: true },
        { key: "attempt", label: "Pokus č.", type: "text", required: true },
        { key: "maxAttempts", label: "Z celkem pokusů", type: "text", required: true },
        { key: "graceNote", label: "Do kdy to jde spravit", type: "text" },
        { key: "payUrl", label: "Odkaz na zaplacení", type: "url", required: true },
    ],
    sample: {
        planName: samplePlanName(),
        price: samplePrice(),
        attempt: "2",
        maxAttempts: String(MAX_BILLING_FAILURES),
        graceNote: "Účet zůstává aktivní ještě 3 dny.",
        payUrl: `${siteUrl()}/dashboard/instagram#settings`,
    },
    // i18n-ignore-end
    build: (v, t) => ({
        subject: t("templates.subscription_charge_failed.subject"),
        eyebrow: t("common.subscription"),
        preheader: t("templates.subscription_charge_failed.preheader", { attempt: v.attempt, maxAttempts: v.maxAttempts, price: v.price }),
        blocks: compact([
            heading(t("templates.subscription_charge_failed.heading")),
            paragraph(withGreeting(t, t("templates.subscription_charge_failed.intro", {
                price: v.price,
                planName: v.planName,
                attempt: v.attempt,
                maxAttempts: v.maxAttempts,
            }))),
            v.graceNote && callout("warning", v.graceNote, t("templates.subscription_charge_failed.graceTitle")),
            heading(t("templates.subscription_charge_failed.reasonsHeading"), 2),
            list([
                t("templates.subscription_charge_failed.reason1"),
                t("templates.subscription_charge_failed.reason2"),
                t("templates.subscription_charge_failed.reason3"),
            ]),
            button(t("templates.subscription_charge_failed.cta"), v.payUrl, "accent"),
            footnote(vatNotice()),
        ]),
    }),
}

export const subscriptionExpired: EmailTemplate = {
    id: "subscription_expired",
    // i18n-ignore-start: popisky formuláře v Mailingu a ukázková data — čte je jen správce
    label: "Předplatné — doběhlo",
    group: "subscription",
    kind: "transactional",
    pricing: true,
    fields: [
        { key: "planName", label: "Tarif", type: "text", required: true },
        { key: "price", label: "Cena za obnovení", type: "text", required: true },
        { key: "renewUrl", label: "Odkaz na obnovení", type: "url", required: true },
    ],
    sample: {
        planName: samplePlanName(),
        price: samplePriceMonthly(),
        renewUrl: `${siteUrl()}/dashboard/instagram#settings`,
    },
    // i18n-ignore-end
    build: (v, t) => ({
        subject: t("templates.subscription_expired.subject"),
        eyebrow: t("common.subscription"),
        preheader: t("templates.subscription_expired.preheader"),
        blocks: [
            heading(t("templates.subscription_expired.heading")),
            paragraph(withGreeting(t, t("templates.subscription_expired.intro", { planName: v.planName }))),
            paragraph(t("templates.subscription_expired.renew", { price: v.price })),
            button(t("templates.subscription_expired.cta"), v.renewUrl, "accent"),
            footnote(vatNotice()),
        ],
    }),
}

export const subscriptionWinback: EmailTemplate = {
    id: "subscription_winback",
    // i18n-ignore-start: popisky formuláře v Mailingu a ukázková data — čte je jen správce
    label: "Předplatné — nabídka na návrat",
    group: "subscription",
    kind: "notification",
    pricing: true,
    broadcast: true,
    fields: [
        { key: "headline", label: "Nadpis", type: "text", required: true },
        { key: "intro", label: "Úvodní odstavec", type: "textarea", required: true },
        { key: "code", label: "Slevový kód", type: "text" },
        { key: "codeNote", label: "Popis slevy", type: "text" },
        { key: "price", label: "Cena po slevě", type: "text", required: true },
        { key: "ctaUrl", label: "Odkaz", type: "url", required: true },
    ],
    sample: {
        headline: "Vracíme vám měsíc zdarma",
        // Reels se smějí nabídnout jen když jedou — `REELS_ENABLED` je potichu
        // překlápí na karusel a nabídka na návrat, která slíbí video a pošle
        // karusel, získá zákazníka zpátky přesně na jeden měsíc. Totéž pravidlo
        // jako v `templates/offer.ts` (aserce 29.14).
        intro: `Dobrý den,\n\nod vašeho odchodu Chrlit umí ${reelsLive() ? "reely, stories" : "stories"} i tiskové podklady. Rádi bychom vám to ukázali.`,
        code: "ZPATKY",
        codeNote: "První měsíc zdarma",
        price: samplePriceMonthly(),
        ctaUrl: `${siteUrl()}/dashboard/instagram#settings`,
    },
    // i18n-ignore-end
    build: (v, t) => ({
        subject: v.headline,
        eyebrow: t("templates.subscription_winback.eyebrow"),
        preheader: v.codeNote || t("templates.subscription_winback.preheader"),
        blocks: compact([
            heading(v.headline),
            paragraph(v.intro),
            v.code && promoCode(v.code, v.codeNote || undefined),
            paragraph(t("templates.subscription_winback.price", { price: v.price })),
            button(t("templates.subscription_winback.cta"), v.ctaUrl, "accent"),
            footnote(vatNotice()),
        ]),
    }),
}
