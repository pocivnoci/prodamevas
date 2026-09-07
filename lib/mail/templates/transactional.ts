/**
 * Transakční zprávy — chodí samy, nikdy se nerozesílají hromadně.
 *
 * `kind: "transactional"` znamená, že se **neptáme na opt-out** a nenesou
 * odhlašovací odkaz: z potvrzení platby se odhlásit nejde. Proto tu taky nesmí
 * skončit nic marketingového — jinak by první stížnost padla na kanál, přes
 * který chodí doklady.
 */

import { vatNotice } from "@/lib/legal"
import { button, callout, compact, footnote, heading, list, paragraph, promoCode, stats } from "../blocks"
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

/**
 * Předání značky někomu, kdo ještě nemá účet.
 *
 * Chodí z `transferClientToUser`. Je v registru schválně: mail, který nejde
 * vidět v náhledové galerii, si nikdo nepřečte očima — a přesně tak se do něj
 * dostal rámeček s nadpisem „Slevový kód" u kódu, který žádnou slevu nenese.
 */
export const clientHandoff: EmailTemplate = {
    id: "client_handoff",
    label: "Předání značky — pozvánka",
    group: "transactional",
    kind: "transactional",
    fields: [
        { key: "brandName", label: "Název značky", type: "text", required: true },
        { key: "code", label: "Přístupový kód", type: "text", help: "Prázdné = rámeček s kódem se vynechá" },
        { key: "ctaUrl", label: "Odkaz na registraci", type: "url", required: true },
    ],
    sample: {
        brandName: "Květiny nad Museem",
        code: "ZNACKA-K7M2QP",
        ctaUrl: `${siteUrl()}/register?code=ZNACKA-K7M2QP&email=zakaznik%40firma.cz`,
    },
    build: v => ({
        subject: `${v.brandName} na vás čeká v Chrlitu`,
        eyebrow: "Předání značky",
        preheader: "Účet si založíte za minutu, značka je už nastavená.",
        blocks: compact([
            heading(`${v.brandName} je připravená`),
            paragraph(`Dobrý den,\n\nnastavili jsme za vás značku **${v.brandName}** — tón, témata i vizuál. Zbývá jediné: založit si účet, pod kterým vám bude patřit.`),
            button("Založit účet a převzít značku", v.ctaUrl),
            heading("Co uvidíte po přihlášení", 2),
            list([
                "Hotovou konfiguraci značky — nic nenastavujete znovu.",
                "Plán příspěvků a první vygenerované ukázky.",
                "Kalendář, ve kterém si termíny přehodíte, jak potřebujete.",
            ]),
            callout("info", "Účet si založte na **tuhle** adresu — značka se páruje podle e-mailu."),
            // Kód je záložní cesta, ne pointa: tlačítko výš ho vyplní samo.
            v.code && promoCode(v.code, "Odkaz výš ho vyplní sám. Tohle je pro případ, že byste registraci otevírali ručně.", "Přístupový kód"),
            paragraph("Tým Chrlit"),
        ]),
    }),
}

/** Zákazník účet má — jen se mu v něm objevila značka. Ať ví proč. */
export const clientHandoffDone: EmailTemplate = {
    id: "client_handoff_done",
    label: "Předání značky — hotovo",
    group: "transactional",
    kind: "transactional",
    fields: [
        { key: "brandName", label: "Název značky", type: "text", required: true },
        { key: "ctaUrl", label: "Odkaz do studia", type: "url", required: true },
    ],
    sample: {
        brandName: "Květiny nad Museem",
        ctaUrl: `${siteUrl()}/dashboard/instagram`,
    },
    build: v => ({
        subject: `${v.brandName} je ve vašem účtu`,
        eyebrow: "Předání značky",
        preheader: "Najdete ji v přepínači projektů hned po přihlášení.",
        blocks: [
            heading(`${v.brandName} je vaše`),
            paragraph(`Dobrý den,\n\nznačka **${v.brandName}** je od teď ve vašem účtu — najdete ji v přepínači projektů hned po přihlášení. Konfigurace i vygenerovaný obsah zůstávají, nic se nenastavuje znovu.`),
            button("Otevřít studio", v.ctaUrl),
            paragraph("Kdyby cokoli drhlo, stačí odpovědět na tenhle e-mail."),
        ],
    }),
}
