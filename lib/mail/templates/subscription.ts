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
 */

import { vatNotice } from "@/lib/legal"
import { MAX_BILLING_FAILURES } from "@/lib/billing-period"
import { formatCzk, normalizeTermMonths, termLabel, termPrice } from "@/lib/pricing"
import { button, callout, compact, footnote, heading, list, paragraph, promoCode } from "../blocks"
import { siteUrl } from "../links"
import { pickPlan, reelsLive, samplePlanName, samplePrice, samplePriceMonthly } from "../plans"
import type { EmailTemplate } from "../template"

export const subscriptionRenewal: EmailTemplate = {
    id: "subscription_renewal",
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
    // Strhává se cena ZAPLACENÉHO OBDOBÍ, ne měsíční sazba tarifu. Do 9/2026 tu
    // stála měsíční cena jako cena obnovy, takže roční zákazník četl 2 999 Kč
    // a z karty mu odešlo 29 990 Kč — přesně ten rozdíl na výpisu, kvůli kterému
    // se z obnovy stane chargeback. Číslo proto pochází z ceníku (`termPrice`),
    // ne z ruky.
    build: v => {
        // Vyplněné období = cenu určuje ceník, ne ruka. Ručně psaná částka se
        // uplatní jen tam, kde období není (jednorázová domluva) — jinak by
        // stačilo zapomenout ji přepsat a roční zákazník by četl měsíční sazbu.
        const hasTerm = /^(1|3|6|12)$/.test((v.termMonths || "").trim())
        const term = normalizeTermMonths(v.termMonths || "1")
        const plan = pickPlan(v.planName || "")
        const price = hasTerm
            ? formatCzk(termPrice(plan.monthlyHaleru, term))
            : v.price?.trim() || formatCzk(plan.monthlyHaleru)
        const forTerm = hasTerm && term > 1 ? ` ${termLabel(term)}` : ""
        return {
            subject: `Předplatné ${v.planName} se obnoví ${v.renewsOn}`,
            eyebrow: "Předplatné",
            preheader: `${price} · ${v.renewsOn}`,
            blocks: [
                heading("Obnova předplatného"),
                paragraph(`Dobrý den,\n\nvaše předplatné **${v.planName}** se automaticky obnoví **${v.renewsOn}** a strhneme **${price}**${forTerm}. Nemusíte nic dělat.`),
                paragraph("Pokud pokračovat nechcete, zrušte obnovu ve studiu — do data obnovy funguje všechno dál."),
                button("Spravovat předplatné", v.manageUrl),
                footnote(vatNotice()),
            ],
        }
    },
}

export const subscriptionChargeFailed: EmailTemplate = {
    id: "subscription_charge_failed",
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
    build: v => ({
        subject: "Platbu se nepodařilo strhnout",
        eyebrow: "Předplatné",
        preheader: `Pokus ${v.attempt} z ${v.maxAttempts} · ${v.price}`,
        blocks: compact([
            heading("Platba neprošla"),
            paragraph(`Dobrý den,\n\nnepodařilo se nám strhnout **${v.price}** za tarif **${v.planName}** (pokus ${v.attempt} z ${v.maxAttempts}).`),
            v.graceNote && callout("warning", v.graceNote, "Zatím se nic neděje"),
            heading("Nejčastější důvody", 2),
            list(["Expirovaná karta", "Nedostatek prostředků", "Banka zablokovala opakovanou platbu"]),
            button("Zaplatit teď", v.payUrl, "accent"),
            footnote(vatNotice()),
        ]),
    }),
}

export const subscriptionExpired: EmailTemplate = {
    id: "subscription_expired",
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
    build: v => ({
        subject: "Vaše předplatné skončilo",
        eyebrow: "Předplatné",
        preheader: "Data zůstávají uložená, generování je pozastavené.",
        blocks: [
            heading("Předplatné skončilo"),
            paragraph(`Dobrý den,\n\npředplatné **${v.planName}** doběhlo. Generování je pozastavené, ale **nic jsme nesmazali** — příspěvky, značka i nastavení na vás čekají.`),
            paragraph(`Obnovit můžete kdykoli za **${v.price}**; navážete přesně v místě, kde se generování zastavilo.`),
            button("Obnovit předplatné", v.renewUrl, "accent"),
            footnote(vatNotice()),
        ],
    }),
}

export const subscriptionWinback: EmailTemplate = {
    id: "subscription_winback",
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
    build: v => ({
        subject: v.headline,
        eyebrow: "Nabídka",
        preheader: v.codeNote || "Máme pro vás nabídku na návrat.",
        blocks: compact([
            heading(v.headline),
            paragraph(v.intro),
            v.code && promoCode(v.code, v.codeNote || undefined),
            paragraph(`Běžná cena tarifu je **${v.price}**. Zrušit jde kdykoli.`),
            button("Vrátit se do Chrlitu", v.ctaUrl, "accent"),
            footnote(vatNotice()),
        ]),
    }),
}
