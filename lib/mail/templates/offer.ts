/**
 * Nabídka — podrobná, finální verze.
 * ==================================
 * Cold mail obchodního agenta (`lib/agents/sales/templates.ts`) je schválně krátký:
 * do 90 slov, bez obrázků, jediný úkol je proklik na ukázku. Tohle je **druhý krok** —
 * e-mail pro člověka, který se už ozval a chce vědět, co to stojí a co za to dostane.
 * Proto smí být dlouhý; nesmí být nepřesný.
 *
 * PROČ SE V TÉHLE ŠABLONĚ NEPÍŠE ANI JEDNO ČÍSLO RUČNĚ
 * ----------------------------------------------------
 * Nabídka je obchodní sdělení o ceně. Číslo opsané do textu zestárne při nejbližší
 * změně ceníku a nikdo se to nedozví — zákazník dostane cenu, kterou mu pokladna
 * neúčtuje. Všechno se proto dopočítává ze zdrojů pravdy:
 *
 *   ceny a kredity   → `FALLBACK_PLANS` (`lib/pricing.ts`), což je kopie ceníku v6
 *                      hlídaná asercí proti migraci `20260901_pricing_v6_kredity.sql`.
 *                      Šablona je čistá funkce a do DB sáhnout nesmí (aserce 29.1),
 *                      takže tohle je jediný správný zdroj — a je vynucený.
 *   co kredit koupí  → `creditExample()` z vah v `lib/credits.ts`
 *   délky období     → `BILLING_TERMS` + `termPrice()` / `termSavings()`
 *   nastavení značky → `CONSULTATION` včetně období, ke kterým je v ceně
 *   DPH a identita   → `lib/legal.ts` (aserce 29.8 hlídá, že u ceny věta o DPH je)
 *
 * REELS SE NESLIBUJÍ, DOKUD NEJEDOU
 * ---------------------------------
 * `REELS_ENABLED` potichu překlápí `reel` na `carousel`. Ceník to řeší odznakem
 * „připravujeme" a e-mail se chová stejně — nabídka, která slíbí video a pošle
 * karusel, je horší než nabídka, která video nezmíní.
 */

import { MEDIA_CREDITS } from "@/lib/credits"
import { vatNotice } from "@/lib/legal"
import { countLabel, CREDITS, MONTHS } from "@/lib/plural"
import {
    BILLING_TERMS, CONSULTATION, consultationIncluded, DEFAULT_TERM_MONTHS,
    EXTRA_CREDIT_HALERU, FALLBACK_PLANS, formatCzk, getTerm, lowestPriceClaim, monthlyEquivalent,
    normalizeTermMonths, termPrice, termSavings, type PricingPlan,
} from "@/lib/pricing"
import { button, callout, compact, divider, footnote, heading, list, paragraph, planCard } from "../blocks"
import { siteUrl } from "../links"
import { creditLine, pickPlan, planBullets, planHasReels, reelsLive } from "../plans"
import type { EmailTemplate } from "../template"

export const offer: EmailTemplate = {
    id: "offer",
    label: "Nabídka (podrobná)",
    group: "promo",
    kind: "notification",
    pricing: true,
    broadcast: true,
    fields: [
        { key: "company", label: "Název značky", type: "text", placeholder: "Kavárna Alchymista", help: "Doplní se do předmětu za pomlčku — čeština názvy skloňuje, apozice ne." },
        { key: "headline", label: "Nadpis", type: "text", required: true },
        { key: "intro", label: "Úvodní odstavec", type: "textarea", required: true },
        { key: "plan", label: "Doporučený tarif", type: "text", placeholder: "Růst", help: "Start · Růst · Dominance · Impérium. Prázdné = doporučený z ceníku." },
        { key: "termMonths", label: "Období (1, 3, 6 nebo 12)", type: "text", placeholder: "12", help: "Cena za období se dopočítá z ceníku, nepíše se ručně." },
        { key: "previewUrl", label: "Odkaz na ukázku", type: "url", help: "Ukázka vygenerovaná z webu klienta. Nechat prázdné, když žádná není." },
        { key: "expiresOn", label: "Nabídka platí do", type: "text", placeholder: "30. 9. 2026", help: "Konkrétní datum, ne „už jen chvíli“." },
        { key: "ctaLabel", label: "Text tlačítka", type: "text" },
        { key: "ctaUrl", label: "Odkaz tlačítka", type: "url", required: true },
    ],
    sample: {
        company: "Kavárna Alchymista",
        headline: "Instagram, který se plní sám",
        intro: "Dobrý den,\n\nděkujeme za zájem. Posíláme, jak to funguje a co to stojí — všechno na jednom místě, ať se nemusíte nikam proklikávat.",
        plan: "Růst",
        termMonths: "12",
        previewUrl: "",
        expiresOn: "",
        ctaLabel: "Vyzkoušet zdarma",
        ctaUrl: `${siteUrl()}/register`,
    },
    build: v => {
        const plan = pickPlan(v.plan || "")
        const term = normalizeTermMonths(v.termMonths || String(DEFAULT_TERM_MONTHS))
        const { badge, note } = getTerm(term)

        const perMonth = formatCzk(monthlyEquivalent(plan.monthlyHaleru, term))
        const total = termPrice(plan.monthlyHaleru, term)
        const saved = termSavings(plan.monthlyHaleru, term)

        // Karta ukazuje cenu ZA MĚSÍC i u delšího období — to je číslo, které si
        // člověk porovná s agenturou. Jednorázová částka pak stojí pod kartou celá,
        // aby nebyla schovaná: platí se hned a v plné výši.
        const period = term === 1
            ? `měsíčně · ${note}`
            : `měsíčně při platbě na ${countLabel(term, MONTHS)}`

        return {
            subject: v.company ? `Nabídka pro vás — ${v.company}` : "Nabídka: hotový Instagram bez agentury",
            eyebrow: "Nabídka",
            preheader: `Tarif ${plan.name} od ${perMonth} měsíčně · garance vrácení peněz do 30 dnů`,
            blocks: compact([
                heading(v.headline),
                paragraph(v.intro),

                v.previewUrl && paragraph(`Ukázka vygenerovaná přímo z vašeho webu: [podívat se](${v.previewUrl})`),

                heading("Jak to funguje", 2),
                list([
                    "**Zadáte adresu webu.** Chrlit si ho přečte a naučí se vaši značku — barvy, tón, produkty.",
                    "**Dostanete hotové příspěvky.** Text, obrázek, hashtagy i termín. Carousely a stories taky.",
                    "**Zveřejní se to samo.** Propojíte Instagram přes upload-post.com a Chrlit publikuje podle kalendáře — nebo počká, až každý příspěvek potvrdíte.",
                ], true),

                divider(),

                heading(`Doporučujeme tarif ${plan.name}`, 2),
                planCard({
                    name: plan.name,
                    price: perMonth,
                    period,
                    features: [creditLine(plan), ...planBullets(plan)],
                    ctaLabel: "Začít",
                    ctaUrl: v.ctaUrl,
                    highlight: true,
                }),
                term > 1 && paragraph(
                    `Za ${countLabel(term, MONTHS)} zaplatíte jednorázově **${formatCzk(total)}** — ` +
                    `proti měsíčnímu placení ušetříte **${formatCzk(saved)}**${badge ? ` (${badge})` : ""}. ` +
                    `Cena je zamčená na celé období, i kdybychom mezitím ceník zdražili.`,
                ),
                consultationIncluded(term) && callout(
                    "success",
                    `K tomuhle období dostanete **${CONSULTATION.name}** (${CONSULTATION.durationMinutes} minut, jinak ${formatCzk(CONSULTATION.priceHaleru)}) **v ceně**. ` +
                    `Ze schůzky odchází nastavený profil, ne jenom rada.`,
                    "V ceně navíc",
                ),

                heading("Celý ceník", 2),
                list(FALLBACK_PLANS.map(p =>
                    `**${p.name}** — ${formatCzk(p.monthlyHaleru)} měsíčně · ${creditLine(p)}`,
                )),
                paragraph(
                    `Delší období se platí dopředu a je levnější: ` +
                    BILLING_TERMS.filter(t => t.badge).map(t => `${countLabel(t.months, MONTHS)} ${t.badge}`).join(" · ") +
                    ". Kredity se obnovují každý měsíc stejně jako u měsíčního placení.",
                ),

                heading("Co je kredit", 2),
                list([
                    `Obrázkový příspěvek — ${countLabel(MEDIA_CREDITS.image, CREDITS)}`,
                    `Story — ${countLabel(MEDIA_CREDITS.story, CREDITS)}`,
                    `Carousel — ${countLabel(MEDIA_CREDITS.carousel, CREDITS)}`,
                    // Reel se v ceníku kreditů objeví, jen když ho engine opravdu vyrobí.
                    ...(reelsLive() ? [`Reel — ${countLabel(MEDIA_CREDITS.reel, CREDITS)} (od tarifu Dominance výš)`] : []),
                    `Kredity navíc se dají dokoupit po ${formatCzk(EXTRA_CREDIT_HALERU)} za kredit`,
                ]),
                paragraph(
                    "Kredity se obnovují každý měsíc a **nevyčerpané propadají** — i u ročního předplatného. " +
                    "Píšeme to naplno: tarif si vybírejte podle toho, kolik reálně stihnete zveřejnit.",
                ),

                divider(),

                heading("Čím neriskujete", 2),
                list([
                    "**3 příspěvky zdarma** na vyzkoušení — bez kreditky a bez časového limitu.",
                    "**Garance vrácení peněz do 30 dnů** od první platby, bez udání důvodu. Platí i pro roční předplatné.",
                    "**Měsíční předplatné zrušíte jedním klikem**, doběhne do konce zaplaceného období.",
                    "**Nic neodejde bez vašeho svolení.** Automatické publikování je přepínač, který zapnete, až budete chtít.",
                ]),

                v.expiresOn && callout("warning", `Tahle nabídka platí do **${v.expiresOn}**.`, "Do kdy"),

                button(v.ctaLabel || "Vyzkoušet zdarma", v.ctaUrl, "accent"),
                paragraph("Kdyby cokoliv chybělo, stačí odpovědět na tenhle e-mail.\n\nTým Chrlit"),
                footnote(vatNotice()),
            ]),
        }
    },
}

/**
 * Připomenutí nabídky.
 * ====================
 * Druhý dotek po `offer`. Schválně **neopakuje ceník** — cena už jednou odešla
 * a druhé znění téhož čísla je jen další místo, které při přecenění zestárne.
 * Follow-up má jediný úkol: dát člověku snadné „ano", snadné „ne" a nechat ho
 * být, když neodpoví.
 *
 * Vykání a žádný nátlak: „poslední šance" a odpočty do téhle značky nepatří,
 * a u obchodního sdělení, které chodí na adresu z vizitky, je tón to jediné,
 * co odlišuje nabídku od spamu.
 *
 * JEDEN HLAS NA CELÝ E-MAIL
 * -------------------------
 * Follow-up je druhý dotek téhož rozhovoru, takže musí znít jako týž odesílatel
 * jako `coldOffer`. Do 9/2026 se v něm lámaly tři najednou: nadpis „Ozývám se
 * zpátky" a „nechci ji nechat zapadnout" (já), „posílali jsme" a „vygenerovali
 * jsme" (my) a podpis „Tým Chrlit" (někdo třetí). Konvence je stejná jako
 * u prvního oslovení: **mluví firma, podepisuje se člověk** — a proto tu jsou
 * `senderName` a `senderPhone`, ne obecná patička. Hlídá aserce 29.19.
 */
export const offerFollowup: EmailTemplate = {
    id: "offer_followup",
    label: "Nabídka — připomenutí (follow-up)",
    group: "promo",
    kind: "notification",
    broadcast: true,
    fields: [
        { key: "company", label: "Název značky", type: "text", placeholder: "Kavárna Alchymista", help: "Doplní se do předmětu za pomlčku." },
        { key: "sentOn", label: "Kdy odešla nabídka", type: "text", placeholder: "před týdnem", help: "Slovem, ne datem — „před týdnem“ zní jako člověk." },
        { key: "intro", label: "Úvodní odstavec", type: "textarea", required: true },
        { key: "previewUrl", label: "Odkaz na ukázku", type: "url", help: "Prázdné = odstavec o ukázce se vynechá." },
        { key: "senderName", label: "Podpis — jméno", type: "text", required: true, help: "Týž člověk, který posílal první oslovení." },
        { key: "senderPhone", label: "Podpis — telefon", type: "text" },
        { key: "ctaLabel", label: "Text tlačítka", type: "text" },
        { key: "ctaUrl", label: "Odkaz tlačítka", type: "url", required: true },
    ],
    sample: {
        company: "Kavárna Alchymista",
        sentOn: "před týdnem",
        intro: "Dobrý den,\n\nposílali jsme vám nabídku na Chrlit a nechceme ji nechat zapadnout. Nespěcháme — jen se ptáme, jestli je to pro vás téma, nebo to máme zavřít.",
        previewUrl: `${siteUrl()}/ukazky`,
        senderName: "Luděk Jasa",
        senderPhone: "+420 601 279 377",
        ctaLabel: "Domluvit 15 minut",
        ctaUrl: `${siteUrl()}/ukazky`,
    },
    build: v => ({
        subject: v.company ? `Ještě k nabídce — ${v.company}` : "Ještě k nabídce",
        eyebrow: "Připomenutí",
        preheader: "Stačí odpovědět jedním slovem — ano, nebo teď ne.",
        blocks: compact([
            heading("Ještě k té nabídce"),
            paragraph(v.intro),
            v.sentOn && paragraph(`Nabídku jsme posílali ${v.sentOn}. Podmínky se nezměnily — najdete je v tom původním e-mailu.`),
            v.previewUrl && paragraph(`Ukázka, kterou jsme pro vás vygenerovali, je pořád k vidění: ${v.previewUrl}`),
            button(v.ctaLabel || "Domluvit 15 minut", v.ctaUrl, "accent"),
            callout("info", "Když to teď není téma, stačí odepsat „teď ne\" a přestaneme se ozývat. Bez ptaní proč."),
            paragraph(compactText([
                "S pozdravem",
                v.senderName,
                v.senderPhone || null,
            ]).join("\n")),
        ]),
    }),
}

/**
 * První oslovení — text, kterým Luděk oslovuje firmy.
 * ===================================================
 * Je to jeho e-mail, jen v šabloně: aby šel poslat z Mailingu na ruční adresu,
 * nesl odhlašovací patičku a identifikaci podnikatele (obojí u obchodního sdělení
 * musí být) a aby čísla a sliby nezestárly v kopii, kterou nikdo nehlídá.
 *
 * TŘI VĚCI, KTERÉ SE PROTI PŮVODNÍMU ZNĚNÍ LIŠÍ — a proč:
 *
 * 1. **Reely se slibují jen když jedou.** `REELS_ENABLED` potichu překlápí `reel`
 *    na karusel. Nabídka, která slíbí video a pošle karusel, je horší než nabídka,
 *    která video nezmíní. Stejné pravidlo jako v `offer`.
 * 2. **Žádný slib dosahu.** „Obsah optimalizovaný pro dosah a fungování algoritmu"
 *    slibuje výsledek, který produkt nemůže ovlivnit — a `/ukazka` i ceník na tomtéž
 *    místě výslovně říkají opak („neslibujeme, že poroste dosah"). Zůstává to, co
 *    je pravda a je stejně silné: formáty a rytmus podle značky a učení z výkonu.
 * 3. **Cena se nepíše ručně.** „V řádu jednotek tisíc" zestárne při prvním přecenění;
 *    `lowestPriceClaim()` bere číslo z ceníku a `pricing: true` k němu přidá větu
 *    o DPH (aserce 29.8) — bez ní vypadá neplátce, jako by DPH zatajil.
 */
export const coldOffer: EmailTemplate = {
    id: "cold_offer",
    label: "Oslovení firmy (první dotek)",
    group: "promo",
    kind: "notification",
    broadcast: true,
    pricing: true,
    fields: [
        { key: "company", label: "Název firmy", type: "text", placeholder: "Kavárna Alchymista", help: "Doplní se do předmětu. Prázdné = obecný předmět." },
        { key: "senderName", label: "Podpis — jméno", type: "text", required: true },
        { key: "senderPhone", label: "Podpis — telefon", type: "text" },
        { key: "ctaUrl", label: "Odkaz tlačítka", type: "url", required: true, help: "Portfolio, nebo ukázka na míru, když už ji máš." },
        { key: "ctaLabel", label: "Text tlačítka", type: "text" },
    ],
    sample: {
        company: "Kavárna Alchymista",
        senderName: "Luděk Jasa",
        senderPhone: "+420 601 279 377",
        ctaUrl: `${siteUrl()}/portfolio`,
        ctaLabel: "Prohlédnout portfolio",
    },
    build: v => ({
        subject: v.company ? `Instagram za vás — ${v.company}` : "Instagram za vás",
        eyebrow: "Nabídka",
        preheader: "Tři ukázkové příspěvky pro vaši firmu, nezávazně.",
        blocks: compact([
            heading("Instagram, který se píše sám"),
            paragraph(
                "Dobrý den,\n\nrádi bychom vám představili řešení, které zjednoduší a zlevní správu firemního Instagramu. " +
                "Naše aplikace se z vašeho webu a Instagramu naučí vaši značku a připravuje obsah přímo na míru — texty i vizuály.",
            ),

            heading("Co pro vás vyrobí", 2),
            list(compactText([
                "Klasické příspěvky i carousely",
                reelsLive() ? "Reels" : null,
                "Texty a popisky ve vašem tónu",
                "Obsah, který se učí z výkonu vašich předchozích příspěvků",
                "Publikování ve zvolený čas — automaticky, když si to zapnete",
            ])),

            paragraph(
                "Výsledkem je správa Instagramu bez agentury, grafika a copywritera zvlášť. " +
                `Služba běží na měsíčním předplatném, ${lowestPriceClaim()}.`,
            ),

            callout("info", "**Zdarma a nezávazně vám připravíme 3 ukázkové příspěvky přímo pro vaši firmu**, ať vidíte výsledek na svém, ne na cizím."),

            button(v.ctaLabel || "Prohlédnout portfolio", v.ctaUrl, "accent"),

            paragraph(
                "Když vás to zaujme, stačí odpovědět na tenhle e-mail. Rádi se domluvíme i na krátké schůzce, " +
                "kde celý systém ukážeme naživo.",
            ),

            paragraph(compactText([
                "S pozdravem",
                v.senderName,
                v.senderPhone || null,
            ]).join("\n")),

            footnote(vatNotice()),
        ]),
    }),
}

/** Vyhodí prázdné řádky ze seznamu — `compact` pracuje s bloky, tohle s texty. */
function compactText(items: (string | null | undefined | false)[]): string[] {
    return items.filter((i): i is string => typeof i === "string" && i.trim().length > 0)
}
