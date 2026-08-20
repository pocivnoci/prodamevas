/**
 * Transakční zprávy — chodí samy, nikdy se nerozesílají hromadně.
 *
 * `kind: "transactional"` znamená, že se **neptáme na opt-out** a nenesou
 * odhlašovací odkaz: z potvrzení platby se odhlásit nejde. Proto tu taky nesmí
 * skončit nic marketingového — jinak by první stížnost padla na kanál, přes
 * který chodí doklady.
 */

import { vatNotice } from "@/lib/legal"
import { button, compact, footnote, heading, list, paragraph, stats } from "../blocks"
import { siteUrl } from "../links"
import type { EmailTemplate } from "../template"

export const welcome: EmailTemplate = {
    id: "welcome",
    label: "Uvítání po registraci",
    group: "transactional",
    kind: "transactional",
    fields: [
        { key: "headline", label: "Nadpis", type: "text", required: true },
        { key: "ctaUrl", label: "Odkaz do studia", type: "url", required: true },
    ],
    sample: {
        headline: "Vítejte v Chrlitu",
        ctaUrl: `${siteUrl()}/onboarding`,
    },
    build: v => ({
        subject: v.headline,
        eyebrow: "Účet je aktivní",
        preheader: "Zadejte web a Chrlit se naučí vaši značku.",
        blocks: [
            heading(v.headline),
            paragraph("Dobrý den,\n\núčet máte hotový. Zbývá jediné — ukázat Chrlitu, jak vypadá vaše značka."),
            heading("Tři kroky", 2),
            list([
                "Zadáte adresu svého webu.",
                "Chrlit si z něj vytáhne tón, barvy a produkty.",
                "Vygenerujete první příspěvky — tři jsou zdarma.",
            ], true),
            button("Spustit nastavení", v.ctaUrl),
            paragraph("Kdyby cokoli drhlo, stačí odpovědět na tenhle e-mail."),
        ],
    }),
}

export const receipt: EmailTemplate = {
    id: "receipt",
    label: "Potvrzení platby",
    group: "transactional",
    kind: "transactional",
    pricing: true,
    fields: [
        { key: "planName", label: "Co bylo zaplaceno", type: "text", required: true },
        { key: "price", label: "Částka", type: "text", required: true },
        { key: "credits", label: "Kreditů k dispozici", type: "text" },
        { key: "periodEnd", label: "Předplaceno do", type: "text" },
        { key: "ctaUrl", label: "Odkaz do studia", type: "url", required: true },
    ],
    sample: {
        planName: "Tarif Růst",
        price: "1 990 Kč",
        credits: "45",
        periodEnd: "5. 9. 2026",
        ctaUrl: `${siteUrl()}/dashboard/instagram`,
    },
    build: v => ({
        subject: `Platba přijata — ${v.planName}`,
        eyebrow: "Potvrzení platby",
        preheader: `${v.price} · ${v.planName}`,
        blocks: compact([
            heading("Platba proběhla"),
            paragraph(`Dobrý den,\n\nděkujeme. Přijali jsme **${v.price}** za **${v.planName}**. Všechno je aktivní.`),
            (v.credits || v.periodEnd) && stats([
                ...(v.credits ? [{ label: "Kreditů", value: v.credits }] : []),
                ...(v.periodEnd ? [{ label: "Předplaceno do", value: v.periodEnd }] : []),
            ]),
            button("Otevřít studio", v.ctaUrl),
            paragraph("Daňový doklad dorazí zvlášť během pár minut."),
            footnote(vatNotice()),
        ]),
    }),
}
