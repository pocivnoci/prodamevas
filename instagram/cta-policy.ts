/**
 * CTA Policy — single source of truth for what a post's CTA may and must do.
 *
 * The pillar's ctaStrategy, the selected product and the reel/carousel format blocks
 * used to issue CONTRADICTORY CTA instructions from different prompt sections (the
 * product section demanded a website link while a REACH pillar forbade mentioning
 * the web, and format blocks hardcoded the website regardless of pillar). Every
 * prompt that talks about CTAs (mega prompt, critic, ranking judge, editorial board,
 * revisions) now derives its wording from one CtaPolicy resolved up front.
 *
 * Leaf module by design: no engine imports, so caption-generator, editorial-board
 * and autopilot can all import it without cycles.
 */

export type CtaMode = "hard" | "medium" | "soft" | "none"

export interface CtaPolicy {
    mode: CtaMode
    /** Ready-to-inject Czech instruction (one paragraph). */
    ctaInstruction: string
    /** How the selected product may appear in the copy. */
    productMention: "link" | "natural" | "none"
    /** Whether the website/URL may appear anywhere in the post. */
    allowWebsite: boolean
    /** `${website}/p/${slug}` — set only when productMention === "link". */
    productUrl?: string
    /** Pillar key, for prompt labeling (e.g. "reach"). */
    pillarLabel: string
}

const MODE_LABELS: Record<CtaMode, string> = {
    hard: "🎯 CONVERSION",
    medium: "📚 VALUE",
    soft: "🔥 REACH",
    none: "🤝 CONNECT",
}

/**
 * Resolve the CTA policy for one post. Deterministic and pure — the pillar always
 * wins on the MODE; the audience persona's ctaStyle only modulates the tone wording.
 * Product on a soft/none pillar → natural mention WITHOUT a link (this is the fix
 * for the old product-section-vs-REACH-pillar contradiction).
 */
export function resolveCtaPolicy(input: {
    pillarCtaStrategy?: CtaMode
    pillarKey?: string
    selectedProduct?: { name: string; slug: string } | null
    personaCtaStyle?: "soft" | "medium" | "hard"
    website: string
}): CtaPolicy {
    const requested: CtaMode = input.pillarCtaStrategy || "soft"
    // Bez adresy webu nemá „hard" ani „medium" kam odkazovat. Slíbit proklik, který
    // neexistuje, je horší než engagement CTA — a mlčky to spolknout by znamenalo psát
    // do postů odkaz „https:///p/tricko". Degradace je hlasitá, ne tichá.
    const hasWebsite = /^https?:\/\/[^/\s.]+\.[^/\s]+/.test((input.website || "").trim())
    const mode: CtaMode = !hasWebsite && (requested === "hard" || requested === "medium") ? "soft" : requested
    if (mode !== requested) {
        console.warn(`⚠️ CTA politika: pilíř chce ${requested}, ale klient nemá použitelnou adresu webu — jedu engagement (soft).`)
    }
    const allowWebsite = mode === "hard" || mode === "medium"
    const productMention: CtaPolicy["productMention"] = input.selectedProduct
        ? (allowWebsite ? "link" : "natural")
        : "none"
    const productUrl = productMention === "link" && input.selectedProduct
        ? `${input.website.replace(/\/+$/, "")}/p/${input.selectedProduct.slug}`
        : undefined

    const toneHint = input.personaCtaStyle === "hard"
        ? " Tón CTA: přímý a konkrétní."
        : input.personaCtaStyle === "medium"
            ? " Tón CTA: motivující — ukaž hodnotu."
            : input.personaCtaStyle === "soft"
                ? " Tón CTA: jemný — buduj důvěru, netlač."
                : ""

    const ctaInstruction = ({
        hard: `CTA přímo odkazuje na ${productUrl || input.website} a dává konkrétní důvod kliknout — benefit nebo zvědavost. Termín, sezónu ani omezené množství si NEVYMÝŠLEJ; zmiň je jen tehdy, když je zadání skutečně obsahuje.`,
        medium: `Hodnota první — CTA smí zmínit ${input.website} jako přirozený další krok, bez tlaku.`,
        soft: `CTA je čistě engagement: otázka, výzva ke komentáři, uložení nebo sdílení. Web ani URL NIKDE nezmiňuj.`,
        none: `Žádné CTA na web — post buduje vztah a komunitu. Web ani URL nikde nezmiňuj.`,
    } as const)[mode] + toneHint

    return {
        mode,
        ctaInstruction,
        productMention,
        allowWebsite,
        productUrl,
        pillarLabel: input.pillarKey || mode,
    }
}

/**
 * Full mega-prompt block (replaces the old per-pillar IIFE + `## MOŽNÉ CTA` pool).
 * ctaPool = config.ctaStrategies[policy.mode].
 */
export function buildCtaPolicySection(policy: CtaPolicy, ctaPool: string[], pillarGoal?: string): string {
    const lines = [
        // Nárok je ZÁMĚRNĚ zúžený na doménu téhle sekce. Dřív zněl „při rozporu
        // s čímkoli jiným v zadání platí TOHLE", což si odporovalo se seznamem PRIORIT
        // o pár set řádků výš, kde je CTA politika až druhá za zadaným tématem. Dvě
        // různá pravidla pro řešení konfliktů v jednom promptu = model si vybere sám.
        // Uvnitř své domény (CTA, odkazy, web) politika vyhrává dál a beze změny.
        `## ${MODE_LABELS[policy.mode]} POST — CTA POLITIKA (ZDROJ PRAVDY PRO CTA: při rozporu v otázce CTA, odkazů a zmínek webu platí TOHLE)`,
        `**Pilíř:** ${policy.pillarLabel.toUpperCase()}${pillarGoal ? ` | **Cíl:** ${pillarGoal}` : ""}`,
        policy.ctaInstruction,
        policy.productMention === "link"
            ? `**Produkt:** V CTA MUSÍ být odkaz ${policy.productUrl} + konkrétní důvod kliknout TEĎ.`
            : "",
        policy.productMention === "natural"
            ? `**Produkt:** Zmiň produkt PŘIROZENĚ v příběhu (zkušenost, detail, moment) — BEZ odkazu a BEZ webu. CTA zůstává engagement.`
            : "",
        !policy.allowWebsite
            ? `**Zákaz:** NIKDE v postu (hook, body, CTA, scény) nezmiňuj web ani URL.`
            : "",
        // Prompt si o vymyšlenou urgenci dřív sám říkal („důvod jednat TEĎ —
        // benefit, zvědavost nebo omezení" + tón „urgentní"), zatímco kritik ji
        // srážel jako rozpor s brand voice. Pisatel a soudce si odporovali a
        // v auditu 115 postů to byla nejčastější vada — 8 z 16 slabých postů.
        `**Zákaz vymyšlené naléhavosti:** Nevyráběj časový tlak ani vzácnost, které v zadání nejsou — „poslední šance“, „než bude pozdě“, „řemeslníci nepočkají“, „stihněte to ještě před sezónou“, „právě teď“. Skutečný termín, sezónu nebo limit smíš zmínit JEN tehdy, když je zadání obsahuje. Naléhavost bez opory čtenář pozná a značce ubírá důvěru — u zdravotních a finančních služeb je navíc nevhodná.`,
        ctaPool.length > 0
            ? `**Doporučené CTA (vyber nebo uprav):**\n${ctaPool.map(c => `- ${c}`).join("\n")}`
            : "",
    ].filter(Boolean)
    return lines.join("\n")
}

/**
 * Compact block for evaluation prompts (critic, ranking judge, editorial board,
 * revisions) — the judge scores the CTA against THIS policy, not against a
 * hardcoded "does it contain the website?" check.
 */
export function buildCtaPolicyJudgeBlock(policy: CtaPolicy): string {
    const rules = [
        policy.ctaInstruction,
        !policy.allowWebsite
            ? "Web/URL kdekoliv v postu = porušení politiky → ctaScore 0."
            : "",
        policy.mode === "hard"
            ? "CTA bez odkazu na web nebo bez důvodu kliknout = sraž ctaScore."
            : "",
        policy.productUrl
            ? `Produktový odkaz musí být přesně ${policy.productUrl}.`
            : "",
        policy.productMention === "natural"
            ? "Produkt má být zmíněn přirozeně BEZ odkazu — odkaz navíc = porušení politiky."
            : "",
        // Musí sedět se zákazem, který dostal pisatel o pár set řádků výš —
        // proto obojí z jednoho modulu. Kdyby to hlídal jen soudce, prompt by
        // dál vyráběl vady, které pak sám sráží.
        `Vymyšlená naléhavost nebo umělá vzácnost bez opory v zadání („poslední šance“, „nepočkají“, „ještě před sezónou“, „právě teď“) = sraž ctaScore.`,
    ].filter(Boolean)
    return `## CTA POLITIKA POSTU (CTA hodnoť proti ní, ne proti obecným pravidlům)
**Režim:** ${MODE_LABELS[policy.mode]} (pilíř ${policy.pillarLabel.toUpperCase()})
${rules.map(r => `- ${r}`).join("\n")}`
}
