/**
 * Reklama a akce.
 *
 * Jediná rodina, kde se cena čeká vždy — proto `pricing: true` a povinná věta
 * o DPH v patičce. Naléhavost se píše jako konkrétní datum, ne jako „už jen
 * chvíli": lhůta, kterou nejde ověřit, snižuje důvěru víc, než kolik přinese.
 *
 * Ukázka se dopočítává z ceníku (`../plans`), protože `sample` je předvyplnění
 * formuláře, ne náhled. Ručně psaná verze slibovala u Růstu „Reely a stories" —
 * jenže reels od 9/2026 drží až Dominance, takže akce nabízela za peníze něco,
 * co ten tarif nedostane. Odrážky proto chodí z `PLAN_COPY` přes `planBullets()`,
 * kde je reels navíc hlídá `REELS_ENABLED`.
 */

import { DEFAULT_UI_LOCALE } from "@/lib/i18n/locales"
import { vatNotice } from "@/lib/legal"
import { formatCzk } from "@/lib/pricing"
import { button, callout, compact, footnote, heading, paragraph, planCard, promoCode } from "../blocks"
import { mailTranslatorSync } from "../i18n"
import { siteUrl } from "../links"
import { markdownToBlocks } from "../markdown"
import { creditLine, planBullets, recommendedPlan } from "../plans"
import type { EmailTemplate } from "../template"

/**
 * Sleva v ukázce. Jedno číslo, ze kterého se dopočítá cena i popisek — psaná
 * zvlášť by se rozešla, jako se rozešel nadpis „tři měsíce za cenu dvou" (−33 %)
 * s intrem, které slibovalo 30 %.
 */
const SAMPLE_DISCOUNT_PCT = 30

/** Ukázka i placeholdery vznikají při načtení modulu — česky, jako celá rozesílka. */
const csMail = mailTranslatorSync(DEFAULT_UI_LOCALE, "mail")

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
        { key: "planPrice", label: "Cena v kartě", type: "text", placeholder: samplePromo().price },
        { key: "planPeriod", label: "Za jaké období", type: "text", placeholder: samplePromo().period },
        { key: "planFeatures", label: "Co tarif obsahuje", type: "textarea", help: "Jedna položka na řádek." },
        { key: "expiresOn", label: "Platí do", type: "text", placeholder: "31. 8. 2026" },
        { key: "ctaLabel", label: "Text tlačítka", type: "text" },
        { key: "ctaUrl", label: "Odkaz tlačítka", type: "url", required: true },
    ],
    sample: {
        eyebrow: "Letní akce",
        headline: `Tři měsíce se slevou ${SAMPLE_DISCOUNT_PCT} %`,
        intro: `Dobrý den,\n\ndo konce srpna dáváme na všechny tarify ${SAMPLE_DISCOUNT_PCT} %. Cena se zamkne na celé období — nezdraží ani po akci.`,
        code: `LETO${SAMPLE_DISCOUNT_PCT}`,
        codeNote: `−${SAMPLE_DISCOUNT_PCT} % na první tři měsíce`,
        body: "## Co za to dostanete\n- Hotové příspěvky včetně fotek a hashtagů\n- Texty a popisky ve vašem tónu\n- Kalendář, který se plní sám",
        planName: samplePromo().name,
        planPrice: samplePromo().price,
        planPeriod: samplePromo().period,
        planFeatures: samplePromo().features,
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

/**
 * Ukázková akce dopočítaná z ceníku: název, zlevněná cena, „místo X" a odrážky
 * tarifu. Odrážky nezačínají kredity náhodou — je to jediné číslo, kterým se
 * tarify liší nejvíc, a `creditLine()` k němu rovnou napíše, co za ně zákazník
 * dostane.
 */
function samplePromo(): { name: string; price: string; period: string; features: string } {
    const plan = recommendedPlan()
    const discounted = Math.round(plan.monthlyHaleru * (100 - SAMPLE_DISCOUNT_PCT) / 100)
    return {
        name: plan.name,
        price: formatCzk(discounted),
        period: `měsíčně místo ${formatCzk(plan.monthlyHaleru)}`,
        features: [creditLine(plan, csMail), ...planBullets(plan, csMail)].join("\n"),
    }
}
