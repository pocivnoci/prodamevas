/**
 * Transakční zprávy — chodí samy, nikdy se nerozesílají hromadně.
 *
 * `kind: "transactional"` znamená, že se **neptáme na opt-out** a nenesou
 * odhlašovací odkaz: z potvrzení platby se odhlásit nejde. Proto tu taky nesmí
 * skončit nic marketingového — jinak by první stížnost padla na kanál, přes
 * který chodí doklady.
 *
 * Texty jdou z `messages/<locale>/mail.json` (`mail.templates.<id>.*`, sdílené
 * `mail.common.*`) — e-mail mluví jazykem příjemce. Popisky formuláře a ukázková
 * data čte jen správce v Mailingu, ty zůstávají česky.
 */

import { vatNotice } from "@/lib/legal"
import { button, callout, compact, footnote, heading, list, paragraph, promoCode, stats } from "../blocks"
import { siteUrl } from "../links"
import { sampleCredits, samplePlanName, samplePrice } from "../plans"
import { withGreeting, type EmailTemplate } from "../template"

export const welcome: EmailTemplate = {
    id: "welcome",
    // i18n-ignore-start: popisky formuláře v Mailingu a ukázková data — čte je jen správce
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
    // i18n-ignore-end
    build: (v, t) => ({
        subject: v.headline,
        eyebrow: t("templates.welcome.eyebrow"),
        preheader: t("templates.welcome.preheader"),
        blocks: [
            heading(v.headline),
            paragraph(withGreeting(t, t("templates.welcome.intro"))),
            heading(t("templates.welcome.stepsHeading"), 2),
            list([
                t("templates.welcome.step1"),
                t("templates.welcome.step2"),
                t("templates.welcome.step3"),
            ], true),
            button(t("templates.welcome.cta"), v.ctaUrl),
            paragraph(t("common.replyHint")),
        ],
    }),
}

export const receipt: EmailTemplate = {
    id: "receipt",
    // i18n-ignore-start: popisky formuláře v Mailingu a ukázková data — čte je jen správce
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
        planName: `Tarif ${samplePlanName()}`,
        price: samplePrice(),
        credits: sampleCredits(),
        periodEnd: "5. 9. 2026",
        ctaUrl: `${siteUrl()}/dashboard/instagram`,
    },
    // i18n-ignore-end
    build: (v, t) => ({
        subject: t("templates.receipt.subject", { planName: v.planName }),
        eyebrow: t("templates.receipt.eyebrow"),
        preheader: `${v.price} · ${v.planName}`,
        blocks: compact([
            heading(t("templates.receipt.heading")),
            paragraph(withGreeting(t, t("templates.receipt.intro", { price: v.price, planName: v.planName }))),
            (v.credits || v.periodEnd) && stats([
                ...(v.credits ? [{ label: t("templates.receipt.credits"), value: v.credits }] : []),
                ...(v.periodEnd ? [{ label: t("templates.receipt.periodEnd"), value: v.periodEnd }] : []),
            ]),
            button(t("common.openStudio"), v.ctaUrl),
            paragraph(t("templates.receipt.invoiceNote")),
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
    // i18n-ignore-start: popisky formuláře v Mailingu a ukázková data — čte je jen správce
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
    // i18n-ignore-end
    build: (v, t) => ({
        subject: t("templates.client_handoff.subject", { brandName: v.brandName }),
        eyebrow: t("common.handoff"),
        preheader: t("templates.client_handoff.preheader"),
        blocks: compact([
            heading(t("templates.client_handoff.heading", { brandName: v.brandName })),
            paragraph(withGreeting(t, t("templates.client_handoff.intro", { brandName: v.brandName }))),
            button(t("templates.client_handoff.cta"), v.ctaUrl),
            heading(t("templates.client_handoff.afterLoginHeading"), 2),
            list([
                t("templates.client_handoff.afterLogin1"),
                t("templates.client_handoff.afterLogin2"),
                t("templates.client_handoff.afterLogin3"),
            ]),
            callout("info", t("templates.client_handoff.sameEmail")),
            // Kód je záložní cesta, ne pointa: tlačítko výš ho vyplní samo. Popisek
            // říká, že jde o vstupní kód — výchozí popisek rámečku mluví o slevě.
            v.code && promoCode(v.code, t("templates.client_handoff.codeNote"), t("common.accessCode")),
            paragraph(t("common.signature")),
        ]),
    }),
}

/** Zákazník účet má — jen se mu v něm objevila značka. Ať ví proč. */
export const clientHandoffDone: EmailTemplate = {
    id: "client_handoff_done",
    // i18n-ignore-start: popisky formuláře v Mailingu a ukázková data — čte je jen správce
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
    // i18n-ignore-end
    build: (v, t) => ({
        subject: t("templates.client_handoff_done.subject", { brandName: v.brandName }),
        eyebrow: t("common.handoff"),
        preheader: t("templates.client_handoff_done.preheader"),
        blocks: [
            heading(t("templates.client_handoff_done.heading", { brandName: v.brandName })),
            paragraph(withGreeting(t, t("templates.client_handoff_done.intro", { brandName: v.brandName }))),
            button(t("common.openStudio"), v.ctaUrl),
            paragraph(t("common.replyHint")),
        ],
    }),
}
