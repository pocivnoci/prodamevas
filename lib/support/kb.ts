/**
 * Znalostní báze agenta podpory — složená z kódu, nikdy z ruky.
 * ============================================================
 * Jeden text, který agent (ElevenLabs Agents Platform) čte jako svá fakta.
 * Skládá se ze STEJNÝCH zdrojů, z jakých se vykresluje nápověda a ceník:
 * `lib/support/faq.ts`, `lib/pricing.ts`, `lib/credits.ts`, `lib/legal.ts`.
 *
 * **Proč to není napsaný dokument.** Nápověda tu jednou ceny měla natvrdo,
 * přecenění na v6 je přežilo a zákazník v ní čítal jinou cenu, než mu naúčtovala
 * pokladna. Báze podpory je ten samý problém o úroveň hůř: lhala by ústy, které
 * zní jako firma, a nikdo by se to nedozvěděl. Proto je to funkce nad daty a
 * `scripts/test-support-kb.ts` hlídá, že složený text nese aktuální čísla.
 *
 * **Fakta, ne instrukce.** Co agent smí a nesmí slibovat, patří do systémového
 * promptu agenta, ne sem. Kdyby pravidla („nikdy neslibuj refundaci") žila
 * v bázi, jsou z nich vyhledatelná fakta, která umí model odcitovat i obejít.
 *
 * Builder je **čistý**: nečte disk ani env. Průvodce (`docs/*.md`) mu podává
 * volající, aby ho guard mohl spustit bez souborů a bez sítě.
 */

import { FALLBACK_PLANS, EXTRA_CREDIT_HALERU, formatCzk } from "@/lib/pricing"
import { MEDIA_CREDITS, MEDIA_LABELS_CZ, ACTION_CREDITS, ALL_MEDIA } from "@/lib/credits"
import { FAQ_CATEGORIES } from "@/lib/support/faq"
import { LEGAL, formatIdentityLine, vatNotice, legalIdentityGaps, CONSUMER_AUTHORITY } from "@/lib/legal"

/** Průvodce nebo článek přiložený k bázi — obsah čte volající z disku. */
export interface SupportGuide {
    title: string
    markdown: string
}

export interface BuildSupportKbOptions {
    guides?: SupportGuide[]
    /** Datum sestavení v textu. Parametr kvůli testu, který potřebuje stabilní výstup. */
    builtAt?: Date
}

/** České názvy akcí, které se účtují kreditem. Klient je zná z UI pod těmi jmény. */
const ACTION_LABELS_CZ: Partial<Record<keyof typeof ACTION_CREDITS, string>> = {
    post_edit: "Úprava hotového příspěvku",
    idea_generate: "Generování nápadů",
    product_ideas: "Produktové nápady",
    product_visual: "Produktová vizualizace",
    product_design: "Design pro tisk",
    product_mockup: "Mockup",
    product_brief: "Business Brief",
    product_line: "Celá produktová řada",
}

function plansSection(): string {
    const rows = FALLBACK_PLANS.map(p =>
        `| ${p.name} | ${formatCzk(p.monthlyHaleru)} / měsíc | ${p.creditsPerMonth} kreditů | ${p.allowsReels ? "ano" : "ne"} |`,
    )
    return [
        "## Tarify",
        "",
        "Ceny jsou měsíční a bez delšího období. Při platbě na 3 měsíce je sleva 5 %,",
        "na 6 měsíců 10 % a na 12 měsíců zákazník platí deset měsíců ze dvanácti.",
        "",
        "| Tarif | Cena | Kredity / měsíc | Reels |",
        "|---|---|---|---|",
        ...rows,
        "",
        `Extra kredit nad rámec tarifu: ${formatCzk(EXTRA_CREDIT_HALERU)} za kus.`,
        "Nevyčerpané kredity se do dalšího měsíce nepřevádějí.",
    ].join("\n")
}

function creditsSection(): string {
    const media = ALL_MEDIA.map(m => `| ${MEDIA_LABELS_CZ[m]} | ${MEDIA_CREDITS[m]} |`)
    const actions = Object.entries(ACTION_CREDITS)
        .filter(([key]) => ACTION_LABELS_CZ[key as keyof typeof ACTION_CREDITS])
        .map(([key, n]) => `| ${ACTION_LABELS_CZ[key as keyof typeof ACTION_CREDITS]} | ${n} |`)
    return [
        "## Kolik co stojí kreditů",
        "",
        "| Médium | Kredity |",
        "|---|---|",
        ...media,
        "",
        "| Akce | Kredity |",
        "|---|---|",
        ...actions,
        "",
        "Každá verze v „dvě verze příspěvku na výběr“ je plnohodnotný příspěvek a účtuje se",
        "jako on — dvě verze carouselu tedy stojí dvojnásobek ceny carouselu.",
    ].join("\n")
}

function faqSection(): string {
    const out: string[] = ["## Časté dotazy"]
    for (const cat of FAQ_CATEGORIES) {
        out.push("", `### ${cat.label}`)
        for (const item of cat.items) {
            out.push("", `**${item.q}**`, "", item.a)
        }
    }
    return out.join("\n")
}

/**
 * Firemní údaje. Když identita není doplněná (`legalIdentityGaps()`), sekce se
 * vynechá celá — placeholder „DOPLNIT“ v ústech podpory je horší než mlčení
 * a klient se na IČO zeptá jednou za život.
 */
function legalSection(): string | null {
    if (legalIdentityGaps().length > 0) return null
    return [
        "## Kdo službu poskytuje",
        "",
        formatIdentityLine(),
        "",
        vatNotice(),
        "",
        `Dozorový orgán pro spotřebitele: ${CONSUMER_AUTHORITY.name} (${CONSUMER_AUTHORITY.web}).`,
        `Kontakt na podporu: ${LEGAL.email}.`,
    ].join("\n")
}

function guidesSection(guides: SupportGuide[]): string | null {
    if (guides.length === 0) return null
    return guides.map(g => [`## ${g.title}`, "", g.markdown.trim()].join("\n")).join("\n\n")
}

/**
 * Složí celou bázi. Deterministické: stejný kód a stejní průvodci = stejný text,
 * takže jde porovnat, jestli se od poslední synchronizace něco změnilo.
 */
export function buildSupportKnowledgeBase(opts: BuildSupportKbOptions = {}): string {
    const builtAt = opts.builtAt ?? new Date()
    const head = [
        "# Chrlit Studio — fakta pro podporu",
        "",
        `Sestaveno automaticky ${builtAt.toLocaleDateString("cs-CZ")} z kódu aplikace`,
        "(`lib/support/kb.ts`). Needitovat ručně — při další synchronizaci se změna ztratí.",
        "Čísla jsou platná k datu sestavení; zdroj pravdy je vždy aplikace.",
    ].join("\n")

    return [
        head,
        plansSection(),
        creditsSection(),
        faqSection(),
        guidesSection(opts.guides ?? []),
        legalSection(),
    ]
        .filter((s): s is string => Boolean(s))
        .join("\n\n")
        .trimEnd() + "\n"
}
