/**
 * Konec předplatného — obnova, neúspěšná platba, doběhlo, získání zpět.
 *
 * Všechny tři uvádějí částku. Je to schválně: zpráva „předplatné se obnoví"
 * bez čísla vede u delších období k tomu, že zákazníka o měsíc později
 * překvapí 19 900 Kč na výpisu a řeší se chargeback. Proto taky `pricing: true`
 * — aserce 29.8 pak vynutí větu o DPH.
 */

import { vatNotice } from "@/lib/legal"
import { button, callout, compact, footnote, heading, list, paragraph, promoCode } from "../blocks"
import { siteUrl } from "../links"
import type { EmailTemplate } from "../template"

export const subscriptionRenewal: EmailTemplate = {
    id: "subscription_renewal",
    label: "Předplatné — blíží se obnova",
    group: "subscription",
    kind: "transactional",
    pricing: true,
    fields: [
        { key: "planName", label: "Tarif", type: "text", required: true },
        { key: "price", label: "Částka", type: "text", required: true, placeholder: "1 990 Kč" },
        { key: "renewsOn", label: "Datum obnovy", type: "text", required: true },
        { key: "manageUrl", label: "Odkaz na správu předplatného", type: "url", required: true },
    ],
    sample: {
        planName: "Růst",
        price: "1 990 Kč",
        renewsOn: "5. 9. 2026",
        manageUrl: `${siteUrl()}/dashboard/instagram#billing`,
    },
    build: v => ({
        subject: `Předplatné ${v.planName} se obnoví ${v.renewsOn}`,
        eyebrow: "Předplatné",
        preheader: `${v.price} · ${v.renewsOn}`,
        blocks: [
            heading("Obnova předplatného"),
            paragraph(`Dobrý den,\n\nvaše předplatné **${v.planName}** se automaticky obnoví **${v.renewsOn}** a strhneme **${v.price}**. Nemusíte nic dělat.`),
            paragraph("Pokud pokračovat nechcete, zrušte obnovu ve studiu — do data obnovy funguje všechno dál."),
            button("Spravovat předplatné", v.manageUrl),
            footnote(vatNotice()),
        ],
    }),
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
        planName: "Růst",
        price: "1 990 Kč",
        attempt: "2",
        maxAttempts: "3",
        graceNote: "Účet zůstává aktivní ještě 3 dny.",
        payUrl: `${siteUrl()}/dashboard/instagram#billing`,
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
        planName: "Růst",
        price: "1 990 Kč měsíčně",
        renewUrl: `${siteUrl()}/dashboard/instagram#billing`,
    },
    build: v => ({
        subject: "Vaše předplatné skončilo",
        eyebrow: "Předplatné",
        preheader: "Data zůstávají uložená, generování je pozastavené.",
        blocks: [
            heading("Předplatné skončilo"),
            paragraph(`Dobrý den,\n\npředplatné **${v.planName}** doběhlo. Generování je pozastavené, ale **nic jsme nesmazali** — příspěvky, značka i nastavení na vás čekají.`),
            paragraph(`Obnovit můžete kdykoli za **${v.price}**; navážete přesně tam, kde jste skončil.`),
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
        intro: "Dobrý den,\n\nod té doby, co jste u nás skončil, Chrlit umí reely, stories i tiskové podklady. Rádi bychom vám to ukázali.",
        code: "ZPATKY",
        codeNote: "První měsíc zdarma",
        price: "1 990 Kč měsíčně",
        ctaUrl: `${siteUrl()}/dashboard/instagram#billing`,
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
