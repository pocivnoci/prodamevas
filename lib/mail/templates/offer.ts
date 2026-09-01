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

import { creditExample, MEDIA_CREDITS } from "@/lib/credits"
import { vatNotice } from "@/lib/legal"
import { countLabel, CREDITS, MONTHS } from "@/lib/plural"
import {
    BILLING_TERMS, CONSULTATION, consultationIncluded, DEFAULT_TERM_MONTHS,
    EXTRA_CREDIT_HALERU, FALLBACK_PLANS, formatCzk, getTerm, monthlyEquivalent,
    normalizeTermMonths, PLAN_COPY, termPrice, termSavings, type PricingPlan,
} from "@/lib/pricing"
import { button, callout, compact, divider, footnote, heading, list, paragraph, planCard } from "../blocks"
import { siteUrl } from "../links"
import type { EmailTemplate } from "../template"

/** Jedou reels doopravdy? Stejná otázka, jakou si klade ceník na landingu. */
const reelsLive = (): boolean => process.env.REELS_ENABLED === "1"

/** Nabízí tenhle tarif reels *a* jsou zapnuté? Obojí musí platit. */
const planHasReels = (plan: PricingPlan): boolean => plan.allowsReels && reelsLive()

/**
 * Tarif podle toho, co obchodník napsal do formuláře. Diakritika ani velikost
 * písmen nerozhoduje — „dominance" i „Dominance" musí najít totéž.
 *
 * Když se nic netrefí, padá to na tarif označený v `PLAN_COPY` jako `highlight`
 * (dnes Růst), ne na první v poli: doporučený tarif je obchodní rozhodnutí, které
 * už jednou padlo na ceníku, a nabídka ho nemá přebíjet nedopatřením.
 */
function pickPlan(name: string): PricingPlan {
    const norm = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    const wanted = norm(name)
    const byName = wanted && FALLBACK_PLANS.find(p => norm(p.name) === wanted || norm(p.id) === wanted)
    if (byName) return byName
    const highlighted = FALLBACK_PLANS.find(p => PLAN_COPY[p.id]?.highlight)
    return highlighted ?? FALLBACK_PLANS[0]
}

/** Odrážky tarifu z ceníkové kopie; reels si nesou přiznání, když jsou vypnuté. */
function planBullets(plan: PricingPlan): string[] {
    return (PLAN_COPY[plan.id]?.bullets ?? []).map(b =>
        typeof b === "string" ? b : reelsLive() ? b.text : `${b.text} (připravujeme)`,
    )
}

/** „70 kreditů měsíčně — ≈ 70 obrázků nebo 23 carouselů" */
function creditLine(plan: PricingPlan): string {
    return `${countLabel(plan.creditsPerMonth, CREDITS)} měsíčně — ${creditExample(plan.creditsPerMonth, { reels: planHasReels(plan) })}`
}

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
                    "**Schválíte a zveřejníte.** Přístup k vašemu Instagramu k tomu nepotřebujeme — poslední slovo máte vy.",
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
                    "**Bez přístupu k vašemu Instagramu.** Propojit jde volitelně jen kvůli statistikám.",
                ]),

                v.expiresOn && callout("warning", `Tahle nabídka platí do **${v.expiresOn}**.`, "Do kdy"),

                button(v.ctaLabel || "Vyzkoušet zdarma", v.ctaUrl, "accent"),
                paragraph("Kdyby cokoliv chybělo, stačí odpovědět na tenhle e-mail.\n\nTým Chrlit"),
                footnote(vatNotice()),
            ]),
        }
    },
}
