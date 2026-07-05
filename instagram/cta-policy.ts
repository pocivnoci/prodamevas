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
    const mode: CtaMode = input.pillarCtaStrategy || "soft"
    const allowWebsite = mode === "hard" || mode === "medium"
    const productMention: CtaPolicy["productMention"] = input.selectedProduct
        ? (allowWebsite ? "link" : "natural")
        : "none"
    const productUrl = productMention === "link" && input.selectedProduct
        ? `${input.website.replace(/\/+$/, "")}/p/${input.selectedProduct.slug}`
        : undefined

    const toneHint = input.personaCtaStyle === "hard"
        ? " Tón CTA: přímý a urgentní."
        : input.personaCtaStyle === "medium"
            ? " Tón CTA: motivující — ukaž hodnotu."
            : input.personaCtaStyle === "soft"
                ? " Tón CTA: jemný — buduj důvěru, netlač."
                : ""

    const ctaInstruction = ({
        hard: `CTA přímo odkazuje na ${productUrl || input.website} a dává konkrétní důvod jednat TEĎ — benefit, zvědavost nebo omezení.`,
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
        `## ${MODE_LABELS[policy.mode]} POST — CTA POLITIKA (JEDINÝ ZDROJ PRAVDY: při rozporu s čímkoli jiným v zadání platí TOHLE)`,
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
    ].filter(Boolean)
    return `## CTA POLITIKA POSTU (CTA hodnoť proti ní, ne proti obecným pravidlům)
**Režim:** ${MODE_LABELS[policy.mode]} (pilíř ${policy.pillarLabel.toUpperCase()})
${rules.map(r => `- ${r}`).join("\n")}`
}
