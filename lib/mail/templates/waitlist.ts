/**
 * Waitlist — „jste na seznamu" a „máte přístup".
 *
 * Tón kopíruje web: vykání, krátké věty, žádná omáčka. Pozvánka pojmenuje,
 * jak dlouho člověk čekal — kdo se zapsal před šesti týdny, si to pamatuje líp
 * než my, a předstírat opak působí lacině.
 *
 * ROD ADRESÁTA NEZNÁME — a nesmí být z e-mailu poznat, že jsme si ho tipli.
 * „Zapsal jste se k nám" je půlce příjemců špatně (jméno v seznamu rod neříká
 * a odhadovat ho nebudeme). Vykání to nezachrání: pomocné sloveso je množné,
 * ale příčestí singulární a rodové. Věta se proto skládá tak, aby v ní příčestí
 * o adresátovi vůbec nebylo — přítomný čas („čekáte") funguje pro všechny.
 * Hlídá aserce 29.18.
 *
 * Texty jdou z `messages/<locale>/mail.json` (`mail.templates.<id>.*`); počet dní
 * čekání skloňuje ICU plural v messages, šablona předává jen číslo. Popisky
 * formuláře a ukázky čte jen správce v Mailingu, zůstávají česky.
 */

import { button, callout, compact, heading, list, paragraph, promoCode } from "../blocks"
import { siteUrl } from "../links"
import { withGreeting, type EmailTemplate } from "../template"

export const waitlistWelcome: EmailTemplate = {
    id: "waitlist_welcome",
    // i18n-ignore-start: popisky formuláře v Mailingu a ukázková data — čte je jen správce
    label: "Waitlist — potvrzení zápisu",
    group: "waitlist",
    kind: "notification",
    broadcast: true,
    fields: [
        { key: "headline", label: "Nadpis", type: "text", required: true },
        { key: "intro", label: "Úvodní odstavec", type: "textarea", required: true },
        { key: "ctaUrl", label: "Odkaz tlačítka", type: "url", required: true },
    ],
    sample: {
        headline: "Jste na seznamu",
        intro: "Dobrý den,\n\ndíky za zájem o Chrlit. Zapsali jsme vás na waitlist — jakmile uvolníme další místa, ozveme se jako prvním.",
        ctaUrl: `${siteUrl()}/ukazky`,
    },
    // i18n-ignore-end
    build: (v, t) => ({
        subject: v.headline,
        eyebrow: t("templates.waitlist_welcome.eyebrow"),
        preheader: t("templates.waitlist_welcome.preheader"),
        blocks: compact([
            heading(v.headline),
            paragraph(v.intro),
            heading(t("templates.waitlist_welcome.nextHeading"), 2),
            list([
                t("templates.waitlist_welcome.next1"),
                t("templates.waitlist_welcome.next2"),
                t("templates.waitlist_welcome.next3"),
            ]),
            v.ctaUrl && button(t("templates.waitlist_welcome.cta"), v.ctaUrl),
            paragraph(t("common.signature")),
        ]),
    }),
}

export const waitlistInvite: EmailTemplate = {
    id: "waitlist_invite",
    // i18n-ignore-start: popisky formuláře v Mailingu a ukázková data — čte je jen správce
    label: "Waitlist — pozvánka s kódem",
    group: "waitlist",
    kind: "notification",
    broadcast: true,
    fields: [
        { key: "headline", label: "Nadpis", type: "text", required: true },
        { key: "code", label: "Přístupový kód", type: "text", required: true },
        { key: "waitedDays", label: "Čeká dní", type: "text", help: "Prázdné = věta se vynechá. Skloní se samo." },
        { key: "expiresNote", label: "Platnost kódu", type: "text" },
        { key: "ctaUrl", label: "Odkaz na registraci", type: "url", required: true },
    ],
    sample: {
        headline: "Máte přístup do Chrlitu",
        code: "VIP100",
        waitedDays: "26",
        expiresNote: "Kód platí 14 dní.",
        ctaUrl: `${siteUrl()}/register`,
    },
    // i18n-ignore-end
    build: (v, t) => {
        const days = waitedDays(v.waitedDays)
        return {
            subject: v.headline,
            eyebrow: t("templates.waitlist_invite.eyebrow"),
            preheader: t("templates.waitlist_invite.preheader", { code: v.code }),
            blocks: compact([
                heading(v.headline),
                paragraph(withGreeting(
                    t,
                    // Bez rodových příčestí o adresátovi („zapsal jste se") — e-mail
                    // neví, komu píše, a půlce příjemců se netrefí do rodu.
                    days
                        ? t("templates.waitlist_invite.introWaited", { days })
                        : t("templates.waitlist_invite.intro"),
                )),
                promoCode(v.code, v.expiresNote || undefined, t("common.accessCode")),
                button(t("templates.waitlist_invite.cta"), v.ctaUrl),
                callout("info", t("templates.waitlist_invite.codeHint")),
                paragraph(t("common.signature")),
            ]),
        }
    },
}

/**
 * Počet dní z toho, co obchodník napsal do formuláře. Pole je text (jako všechna
 * ostatní), takže se sem dostane i prázdno nebo překlep — a „před 1 dny" nebo
 * „0 dní" v pozvánce vypadá jako rozbitá šablona. Co není kladné číslo, větu
 * o čekání vynechá. Skloňování („26 dní") dělá ICU plural v messages.
 */
function waitedDays(raw: string | undefined): number | null {
    const days = Number.parseInt((raw ?? "").trim(), 10)
    return Number.isFinite(days) && days > 0 ? days : null
}
