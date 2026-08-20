/**
 * Waitlist — „jste na seznamu" a „máte přístup".
 *
 * Tón kopíruje web: vykání, krátké věty, žádná omáčka. Pozvánka pojmenuje,
 * jak dlouho člověk čekal — kdo se zapsal před šesti týdny, si to pamatuje líp
 * než my, a předstírat opak působí lacině.
 */

import { button, callout, compact, heading, list, paragraph, promoCode } from "../blocks"
import { siteUrl } from "../links"
import type { EmailTemplate } from "../template"

export const waitlistWelcome: EmailTemplate = {
    id: "waitlist_welcome",
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
    build: v => ({
        subject: v.headline,
        eyebrow: "Waitlist",
        preheader: "Máme vás na seznamu. Ozveme se, jakmile uvolníme místa.",
        blocks: compact([
            heading(v.headline),
            paragraph(v.intro),
            heading("Co bude dál", 2),
            list([
                "Ozveme se e-mailem s přístupovým kódem.",
                "Zadáte web a Chrlit se naučí vaši značku.",
                "První tři příspěvky máte zdarma — bez kreditky.",
            ]),
            v.ctaUrl && button("Prohlédnout ukázky", v.ctaUrl),
            paragraph("Tým Chrlit"),
        ]),
    }),
}

export const waitlistInvite: EmailTemplate = {
    id: "waitlist_invite",
    label: "Waitlist — pozvánka s kódem",
    group: "waitlist",
    kind: "notification",
    broadcast: true,
    fields: [
        { key: "headline", label: "Nadpis", type: "text", required: true },
        { key: "code", label: "Přístupový kód", type: "text", required: true },
        { key: "waitedDays", label: "Čekal(a) dní", type: "text", help: "Prázdné = věta se vynechá" },
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
    build: v => ({
        subject: v.headline,
        eyebrow: "Pozvánka",
        preheader: `Váš kód ${v.code} je připravený.`,
        blocks: compact([
            heading(v.headline),
            paragraph(
                v.waitedDays
                    ? `Dobrý den,\n\nzapsal jste se k nám před ${v.waitedDays} dny a teď jsme na vás vyšli. Uvolnilo se místo — kód níž vám otevře přístup.`
                    : "Dobrý den,\n\nuvolnilo se místo. Kód níž vám otevře přístup do Chrlitu.",
            ),
            promoCode(v.code, v.expiresNote || undefined),
            button("Aktivovat přístup", v.ctaUrl),
            callout("info", "Kód zadáte při registraci. Když ho ztratíte, napište nám a pošleme nový."),
            paragraph("Tým Chrlit"),
        ]),
    }),
}
