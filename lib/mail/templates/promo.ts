/**
 * Reklama a akce.
 *
 * Jediná rodina, kde se cena čeká vždy — proto `pricing: true` a povinná věta
 * o DPH v patičce. Naléhavost se píše jako konkrétní datum, ne jako „už jen
 * chvíli": lhůta, kterou nejde ověřit, snižuje důvěru víc, než kolik přinese.
 */

import { vatNotice } from "@/lib/legal"
import { button, callout, compact, footnote, heading, paragraph, planCard, promoCode } from "../blocks"
import { siteUrl } from "../links"
import { markdownToBlocks } from "../markdown"
import type { EmailTemplate } from "../template"

export const promo: EmailTemplate = {
    id: "promo",
    label: "Akce / promo",
    group: "promo",
    kind: "notification",
    pricing: true,
    broadcast: true,
    fields: [
        { key: "eyebrow", label: "Označení akce", type: "text", placeholder: "Letní akce" },
        { key: "headline", label: "Nadpis", type: "text", required: true },
        { key: "intro", label: "Úvodní odstavec", type: "textarea", required: true },
        { key: "code", label: "Slevový kód", type: "text" },
        { key: "codeNote", label: "Co kód dělá", type: "text", placeholder: "−30 % na první tři měsíce" },
        { key: "body", label: "Podrobnosti", type: "textarea", help: "Značkování jako u novinek." },
        { key: "planName", label: "Tarif v kartě", type: "text" },
        { key: "planPrice", label: "Cena v kartě", type: "text", placeholder: "1 393 Kč" },
        { key: "planPeriod", label: "Za jaké období", type: "text", placeholder: "měsíčně místo 1 990 Kč" },
        { key: "planFeatures", label: "Co tarif obsahuje", type: "textarea", help: "Jedna položka na řádek." },
        { key: "expiresOn", label: "Platí do", type: "text", placeholder: "31. 8. 2026" },
        { key: "ctaLabel", label: "Text tlačítka", type: "text" },
        { key: "ctaUrl", label: "Odkaz tlačítka", type: "url", required: true },
    ],
    sample: {
        eyebrow: "Letní akce",
        headline: "Tři měsíce za cenu dvou",
        intro: "Dobrý den,\n\ndo konce srpna dáváme na všechny tarify 30 %. Cena se zamkne na celé období — nezdraží ani po akci.",
        code: "LETO30",
        codeNote: "−30 % na první tři měsíce",
        body: "## Co za to dostanete\n- Hotové příspěvky včetně fotek a hashtagů\n- Reely s voiceoverem a titulky\n- Kalendář, který se plní sám",
        planName: "Růst",
        planPrice: "1 393 Kč",
        planPeriod: "měsíčně místo 1 990 Kč",
        planFeatures: "45 kreditů měsíčně\nReely a stories\nPlán na celý měsíc dopředu",
        expiresOn: "31. 8. 2026",
        ctaLabel: "Využít akci",
        ctaUrl: `${siteUrl()}/cenik`,
    },
    build: v => ({
        subject: v.headline,
        eyebrow: v.eyebrow || "Akce",
        preheader: v.codeNote || "Nabídka platí omezenou dobu.",
        blocks: compact([
            heading(v.headline),
            paragraph(v.intro),
            v.code && promoCode(v.code, v.codeNote || undefined),
            ...(v.body ? markdownToBlocks(v.body) : []),
            v.planName && v.planPrice && planCard({
                name: v.planName,
                price: v.planPrice,
                period: v.planPeriod || "",
                features: (v.planFeatures || "").split("\n").map(f => f.trim()).filter(Boolean),
                ctaLabel: "Vybrat tarif",
                ctaUrl: v.ctaUrl,
                highlight: true,
            }),
            v.expiresOn && callout("warning", `Nabídka platí do **${v.expiresOn}**.`, "Do kdy"),
            button(v.ctaLabel || "Využít akci", v.ctaUrl, "accent"),
            footnote(vatNotice()),
        ]),
    }),
}
