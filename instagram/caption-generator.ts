/**
 * Caption Generator for Instagram Autopilot
 * Schemas, mega prompt builder, config-driven helpers, quality gate.
 */

import { Type } from "@google/genai"
import { generateTextQuality } from "./gemini-client"
import { judgeText } from "./judge"
import { getModel, hasFallback, getTemperature } from "./models"
import type { ClientConfig, PostFormat, PostTypeDef, AudiencePersona, BrandVoiceExample } from "./configs/types"
import type { PostType, PostIdea, Review } from "./types"
import type { HookTemplate } from "./types"
import type { PerformanceInsight } from "./performance"
import { getPillarForType, createPillarMapper } from "./service"
import { buildPsychologistSection } from "./psychologist"
import { getMechanism } from "./mechanisms"
import { resolveCtaPolicy, buildCtaPolicySection, buildCtaPolicyJudgeBlock, type CtaPolicy } from "./cta-policy"

// ============================================
// COSTS
// ============================================

// Pricing as of June 2026 (verify against ai.google.dev/pricing on model changes):
// - Caption/critic/editorial run the Pro quality ladder (gemini-pro-latest → gemini-2.5-pro)
// - Gemini 3.1 Pro (AI Designer): $2.00/M input + $12/M output (~$0.03 per request)
// - Nano Banana Pro (gemini-3-pro-image, 2K): ~$0.134 per image — see instagram/models.ts
// - Veo 3.1: Lite ~$0.06/s · Fast $0.15/s · Standard $0.40/s
export const COSTS = {
    textGeneration: 0.025,
    promptRefinement: 0.025,
    designerBrief: 0.03,         // AI Designer (gemini-3.1-pro) structured design brief
    contextAgent: 0.025,         // 1× Gemini Flash for industry + local pulse
    imageGeneration: 0.134,      // Nano Banana Pro GA 2K
    imageQA: 0.01,               // flash vision verify (native engine)
    imageCorrectiveEdit: 0.134,  // corrective text/logo edit retry (native engine, worst case 1×)
    videoPerSecond: 0.15,        // @deprecated — use videoPerSecondByTier
    videoPerSecondByTier: { lite: 0.06, fast: 0.15, premium: 0.40 } as Record<"lite" | "fast" | "premium", number>,
    ttsVoiceover: 0.02,          // Gemini 3.1 Flash TTS (~$0.02 per request)
    perPost: 0.27,       // 3× text ($0.075) + context ($0.025) + designer ($0.03) + image ($0.134) + QA ($0.01)
    perStory: 0.56,      // 3× text + context + 1 designer (shared) + 3× image ($0.402) + 3× QA
    perCarousel: 0.75,   // 3× text + context + designer + 4× image ($0.536) + 4× QA + overhead
    perReel: 1.45,       // 3× text + context + Veo 3.1 Fast 8s ($1.20) + TTS ($0.02) + cover ($0.134) + QA
}

// ============================================
// FORMAT HELPERS
// ============================================

const DEFAULT_FORMAT: PostFormat = { aspectRatio: "4:5", medium: "image", overlayStyle: "default" }

export function getPostFormat(config: ClientConfig, typeName: string): PostFormat {
    // 1. Explicit per-type override (highest priority)
    if (config?.postFormats?.[typeName]) return config.postFormats[typeName]
    // 2. Convention-based: prefix determines medium
    if (typeName.startsWith("reel_")) return { aspectRatio: "9:16", medium: "reel", overlayStyle: "none" }
    if (typeName.startsWith("story_")) return { aspectRatio: "9:16", medium: "story", overlayStyle: "default" }
    if (typeName.startsWith("carousel_")) return { aspectRatio: "1:1", medium: "carousel", overlayStyle: "cover" }
    // 3. Client default format
    if (config?.defaultFormat) return config.defaultFormat
    return DEFAULT_FORMAT
}

/** The format's creative brief — the SOURCE OF TRUTH for description/structure/
 *  visualStyle. The `ig_post_types` DB row is a UI-picker copy that can drift;
 *  generation must prefer this and fall back to the row.
 *
 *  Když má formát přiřazený `mechanism`, brief se bere ze sdílené tabulky
 *  (`instagram/mechanisms.ts`) a per-klientská pole se ignorují. Důvod: formáty
 *  se generovaly per značku a měly být mechanismy — nebyly. Ani po přepsání
 *  promptu, zavedení stropů a strojové sanitizaci hotové copy do nich model
 *  propašoval téma („Průvodce ideálním tarifem"). Sdílená tabulka dělá z invariantu
 *  vlastnost konstrukce místo pravidla, které musí model dodržet.
 *
 *  `name`, `pillar`, `medium`, `aspectRatio`, `uses_product` i `manualOnly`
 *  zůstávají per klient — mechanismus mění POUZE text briefu. */
export function getPostTypeDef(config: ClientConfig, typeName: string): PostTypeDef | undefined {
    const def = (config?.postTypeDefs ?? []).find(d => d.name === typeName)
    if (!def) return undefined
    const mechanism = getMechanism(def.mechanism)
    if (!mechanism) return def
    return {
        ...def,
        description: mechanism.description,
        structure: mechanism.structure,
        visualStyle: mechanism.visualStyle,
    }
}

// ─── Smart Overlay Rotation ─────────────────────────────────

type ImageOverlayStyle = "default" | "centered" | "top" | "split" | "editorial"

/** Map post type name patterns to suitable overlay layouts */
const OVERLAY_POOLS: { pattern: RegExp; styles: ImageOverlayStyle[] }[] = [
    // Educational/how-to → structured layouts
    { pattern: /tip|how_to|edukace|navod|tutorial|hack/i, styles: ["split", "top", "editorial"] },
    // Meme/humor → bold, impactful
    { pattern: /meme|humor|vtip|quote/i, styles: ["centered", "editorial"] },
    // Product/sales → classic with product visible
    { pattern: /product|produkt|drop|limitka|nabidka/i, styles: ["default", "split"] },
    // Engagement/question → attention-grabbing
    { pattern: /engage|anketa|otazka|poll|cta/i, styles: ["centered", "top", "editorial"] },
    // Behind the scenes/personal → editorial feel
    { pattern: /bts|behind|personal|story|pribehy/i, styles: ["editorial", "top", "centered"] },
    // Review/testimonial → clean readability
    { pattern: /recenze|review|testimonial/i, styles: ["split", "editorial", "centered"] },
    // Stats/data → bold typography
    { pattern: /stat|data|cisla|numbers/i, styles: ["centered", "editorial"] },
]

/** All available styles for fallback rotation */
const ALL_IMAGE_STYLES: ImageOverlayStyle[] = ["default", "centered", "top", "split", "editorial"]

/**
 * Select an overlay variant based on post type + avoid repeating the last used layout.
 * Only called for image posts — carousels use cover/step, reels use none.
 */
export function selectOverlayVariant(
    typeName: string,
    recentOverlayStyles: string[] = [],
): ImageOverlayStyle {
    // Find matching pool for this post type
    let pool: ImageOverlayStyle[] = ALL_IMAGE_STYLES
    for (const entry of OVERLAY_POOLS) {
        if (entry.pattern.test(typeName)) {
            pool = entry.styles
            break
        }
    }

    // Filter out the last 2 used styles to avoid visual repetition
    const recentSet = new Set(recentOverlayStyles.slice(0, 2))
    let candidates = pool.filter(s => !recentSet.has(s))

    // If all filtered out (small pool), use full pool
    if (candidates.length === 0) candidates = pool

    // Pick randomly from candidates
    const selected = candidates[Math.floor(Math.random() * candidates.length)]
    return selected
}

/**
 * Determine reel duration from config or convention.
 * Veo 3.1 supports 5-8s at 1080p.
 */
export function getReelDuration(typeName: string, config?: ClientConfig): number {
    // 1. Explicit per-type config
    const typeFormat = config?.postFormats?.[typeName]
    if (typeFormat?.reelDuration) return Math.min(8, Math.max(5, typeFormat.reelDuration))

    // 2. Default format config
    if (config?.defaultFormat?.reelDuration) return Math.min(8, Math.max(5, config.defaultFormat.reelDuration))

    // 3. Convention-based
    if (typeName.includes("short") || typeName.includes("quick")) return 5
    if (typeName.includes("long") || typeName.includes("tutorial")) return 8

    return 8
}

export const IDEA_COOLDOWN_DAYS = 90



export function getToneDescription(config: ClientConfig, postType: string): string {
    const tone = config.brandVoice.toneByPostType[postType]
    if (!tone) return ""

    const descriptions: string[] = []

    if (tone.humorLevel >= 4) descriptions.push("vtipný a hravý")
    else if (tone.humorLevel >= 2) descriptions.push("lehce humorný")
    else descriptions.push("vážný a seriózní")

    if (tone.urgencyLevel >= 4) descriptions.push("naléhavý")
    else if (tone.urgencyLevel >= 2) descriptions.push("motivující")
    else descriptions.push("klidný")

    if (tone.intimacyLevel >= 4) descriptions.push("osobní a blízký")
    else if (tone.intimacyLevel >= 2) descriptions.push("přátelský")
    else descriptions.push("profesionální")

    if (tone.educationalLevel >= 4) descriptions.push("vzdělávací s konkrétními fakty")
    else if (tone.educationalLevel >= 2) descriptions.push("informativní")
    else descriptions.push("zábavný")

    return descriptions.join(", ")
}

export function getHookTemplates(config: ClientConfig, postType: string, count: number = 3): HookTemplate[] {
    const applicable = config.brandVoice.hookTemplates.filter(
        template => template.bestFor.includes(postType)
    )
    return applicable.sort(() => Math.random() - 0.5).slice(0, count)
}

export function getRandomCTAs(config: ClientConfig, count: number = 3): string[] {
    return [...config.brandVoice.ctaVariations]
        .sort(() => Math.random() - 0.5)
        .slice(0, count)
}

/**
 * Choose the audience persona for a post DETERMINISTICALLY (was random every post).
 * Random per-post selection made the brand "speak to" a different segment each time —
 * pain points, triggers and CTA intensity whiplashed, so the feed read as incoherent.
 * Now:
 *   1. a post's content pillar can pin a target persona (ContentPillar.targetPersona → label);
 *   2. otherwise the SAME post type always addresses the SAME persona (stable hash),
 * so a viewer sees one consistent voice. Variety still comes from the pillar/topic mix,
 * not from randomly re-segmenting the audience. Pass an explicit override to force one.
 */
export function selectPersonaForPost(config: ClientConfig, postTypeName: string): AudiencePersona | undefined {
    const personas = config.audiencePersonas
    if (!personas || personas.length === 0) return undefined

    // 1. Explicit pillar → persona pin
    const pillarKey = getPillarForType(config, postTypeName)
    const targetLabel = config.contentPillars?.[pillarKey]?.targetPersona
    if (targetLabel) {
        const pinned = personas.find(p => p.label === targetLabel)
        if (pinned) return pinned
    }

    // 2. Stable fallback — same post type → same persona (deterministic, no per-post RNG)
    let hash = 0
    for (let i = 0; i < postTypeName.length; i++) hash = (hash * 31 + postTypeName.charCodeAt(i)) >>> 0
    return personas[hash % personas.length]
}

/**
 * Few-shot VOICE ANCHOR — the strongest single lever for voice consistency.
 * Abstract trait lists ("friendly, authentic") drift post-to-post; concrete "this is exactly
 * how we sound" examples don't. Prefers examples tagged with the current post type, then fills
 * with general ones, and truncates each so the prompt stays bounded. Returns "" when the brand
 * has no curated examples yet, so cold-start brands degrade gracefully.
 */
export function buildGoldExamplesSection(config: ClientConfig, postTypeName: string, max = 4, truncateAt = 400): string {
    const examples: BrandVoiceExample[] = config.brandVoiceExamples || []
    if (examples.length === 0) return ""

    // Relevance-first: same post type before general
    const matching = examples.filter(e => e.postType === postTypeName)
    const rest = examples.filter(e => e.postType !== postTypeName)
    const chosen = [...matching, ...rest].slice(0, max).filter(e => e.caption?.trim())
    if (chosen.length === 0) return ""

    const lines = chosen.map((e, i) => {
        const text = e.caption.length > truncateAt ? e.caption.slice(0, truncateAt) + "…" : e.caption
        return `${i + 1}. "${text}"${e.note ? `\n   → ${e.note}` : ""}`
    }).join("\n")

    return `
## ✍️ ZLATÝ STANDARD — TAKHLE ZNÍ NAŠE ZNAČKA (VOICE ANCHOR)
Tohle jsou schválené ukázky, které PŘESNĚ vystihují náš hlas, rytmus a energii. Napodob jejich
TÓN, stavbu vět a tempo — NE jejich téma ani konkrétní obsah.

${lines}

⚠️ Nový post musí znít, jako by ho psal stejný autor jako tyhle ukázky: stejný hlas, jiné téma.
`
}

/**
 * Resolve the CTA policy for one post from config (pillar ctaStrategy + selected
 * product + audience persona tone). Lives here — not in cta-policy.ts — because it
 * needs getPillarForType/selectPersonaForPost; cta-policy stays an import leaf.
 */
export function resolveCtaPolicyForPost(
    config: ClientConfig,
    postTypeName: string,
    selectedProduct?: { name: string; slug: string } | null,
): CtaPolicy {
    const pillarKey = getPillarForType(config, postTypeName)
    return resolveCtaPolicy({
        pillarCtaStrategy: config.contentPillars[pillarKey]?.ctaStrategy,
        pillarKey,
        selectedProduct,
        personaCtaStyle: selectPersonaForPost(config, postTypeName)?.ctaStyle,
        website: config.website,
    })
}

// ============================================
// SCHEMAS
// ============================================

export function buildCaptionSchema(config: ClientConfig) {
    return {
        type: Type.OBJECT,
        properties: {
            angle: {
                type: Type.STRING,
                description: "PRVNÍ krok: 1 česká věta — jaký úhel volíš a čím se liší od nedávných postů",
            },
            hook: {
                type: Type.STRING,
                description: "First sentence that stops scrolling — bold, shocking (max 15 words). NO EMOJI in hook.",
            },
            body: {
                type: Type.STRING,
                description: `Main text (max ${PROMPT_LIMITS.bodyWords} words).`,
            },
            cta: {
                type: Type.STRING,
                description: "Call to action — řiď se sekcí CTA POLITIKA v promptu",
            },
            hashtags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "8-10 relevant hashtags",
            },
            imagePrompt: {
                type: Type.STRING,
                description: "English prompt for Nano Banana Pro image generation. Create VARIED visuals — alternate between: (A) people in authentic situations with real emotions, (B) dramatic product/detail close-ups, (C) atmospheric environments/lifestyle scenes, (D) creative compositions with unexpected angles. NEVER repeat the same visual style twice in a row. Avoid boring static shots (laptop on desk, coffee on table). Style: photorealistic, editorial, cinematic lighting. NO TEXT in image. 2-3 sentences.",
            },
            imageSubtext: {
                type: Type.STRING,
                description: `Subtext below hook (benefit, max ${PROMPT_LIMITS.coverSubtextWords} words, Czech)`,
            },
            accentWords: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "2-3 key words/phrases FROM the hook that should be visually highlighted (each 1-2 words, Czech, must be exact substring of hook)",
            },
        },
        required: ["angle", "hook", "body", "cta", "hashtags", "imagePrompt", "imageSubtext", "accentWords"],
        propertyOrdering: ["angle", "hook", "body", "cta", "hashtags", "imagePrompt", "imageSubtext", "accentWords"],
    }
}

export function buildVideoSchema(config: ClientConfig) {
    return {
        type: Type.OBJECT,
        properties: {
            angle: {
                type: Type.STRING,
                description: "PRVNÍ krok: 1 česká věta — jaký úhel volíš a čím se liší od nedávných postů",
            },
            hook: {
                type: Type.STRING,
                description: "Opening problem/question (2-4 words, punchy, Czech). NO EMOJI.",
            },
            scenes: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        timeRange: {
                            type: Type.STRING,
                            description: "Time range for this scene (e.g. '0-2s', '2-5s', '5-8s')",
                        },
                        visual: {
                            type: Type.STRING,
                            description: "What happens visually — detailed description of the scene content, subjects, actions, environment",
                        },
                        camera: {
                            type: Type.STRING,
                            description: "Camera movement (e.g. 'slow dolly in', 'handheld tracking shot', 'static close-up', 'smooth pan left', 'aerial descending')",
                        },
                        mood: {
                            type: Type.STRING,
                            description: "Mood and lighting (e.g. 'warm golden hour, soft bokeh', 'dramatic side lighting, moody', 'bright natural daylight, energetic')",
                        },
                        // narration + soundEffect MUSÍ být ve schématu, i když si o ně prompt říká.
                        // responseSchema je whitelist, ne minimum: pole, které schéma nedeklaruje,
                        // model nevrátí (ověřeno voláním gemini-pro-latest, 2026-08-05). Bez nich
                        // byly `scenes[].narration` vždy prázdné → generateVoiceover se nikdy
                        // nezavolal, scenesToSubtitles neměl co vykreslit a celý FFmpeg krok
                        // v reel-orchestrator.ts se přeskočil. Reel odjel němý a bez titulků.
                        narration: {
                            type: Type.STRING,
                            description: "Český text pro voiceover téhle scény (1-2 věty, přirozená mluvená řeč). Čte se nahlas — piš, jak se mluví, ne jak se píše.",
                        },
                        soundEffect: {
                            type: Type.STRING,
                            description: "Ambient sound or effect for this scene, in English (e.g. 'city ambience', 'coffee pouring', 'wind in trees')",
                        },
                    },
                    required: ["timeRange", "visual", "camera", "mood", "narration", "soundEffect"],
                },
                description: "3-4 detailed scenes for Veo 3.1 video generation. Each scene must specify what happens, camera movement, mood, Czech narration and a sound effect.",
            },
            videoScript: {
                type: Type.STRING,
                description: "Fallback: single-string summary of all scenes for Veo 3.1 (used if scenes parsing fails)",
            },
            caption: {
                type: Type.STRING,
                description: "Instagram caption for the Reel (max 100 words, Czech)",
            },
            cta: {
                type: Type.STRING,
                description: "CTA — řiď se sekcí CTA POLITIKA v promptu",
            },
            hashtags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "8-10 relevant hashtags",
            },
        },
        required: ["angle", "hook", "scenes", "caption", "cta", "hashtags"],
        propertyOrdering: ["angle", "hook", "scenes", "videoScript", "caption", "cta", "hashtags"],
    }
}

export function buildCarouselSchema(config: ClientConfig) {
    return {
        type: Type.OBJECT,
        properties: {
            angle: {
                type: Type.STRING,
                description: "PRVNÍ krok: 1 česká věta — jaký úhel volíš a čím se liší od nedávných postů",
            },
            hook: {
                type: Type.STRING,
                description: `Cover slide headline (max ${PROMPT_LIMITS.coverHeadlineWords} words, Czech, punchy). ZADNE EMOJI.`,
            },
            accentWords: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "2-3 key words/phrases FROM the hook that should be visually highlighted (each 1-2 words, Czech, must be exact substring of hook)",
            },
            imageSubtext: {
                type: Type.STRING,
                description: `Cover slide subtext - brief benefit or teaser (max ${PROMPT_LIMITS.coverSubtextWords} words, Czech, e.g. 'Navod krok za krokem')`,
            },
            slides: {
                type: Type.ARRAY,
                // minItems/maxItems dělá z počtu slidů STRUKTURÁLNÍ omezení. Dřív ho
                // držela jen věta v description — tedy pouhé přání, které volný text
                // `structure` z configu ("Slide 7 CTA") beztrestně přebil.
                minItems: String(PROMPT_LIMITS.carouselInnerMin),
                maxItems: String(PROMPT_LIMITS.carouselInnerMax),
                items: {
                    type: Type.OBJECT,
                    properties: {
                        headline: { type: Type.STRING, description: `Step headline (max ${PROMPT_LIMITS.slideHeadlineWords} words, Czech, e.g. 'Krok 1: Otevri Nastaveni')` },
                        subtext: { type: Type.STRING, description: `Step detail - exact path or explanation (max ${PROMPT_LIMITS.slideSubtextWords} words, Czech)` },
                        imagePrompt: { type: Type.STRING, description: "English image prompt for this step - MUST share the same environment/setting as all other slides. NO TEXT, NO WORDS, NO LETTERS in image. Pure background photo." },
                    },
                    required: ["headline", "subtext", "imagePrompt"],
                },
                description: `${PROMPT_LIMITS.carouselInnerMin} to ${PROMPT_LIMITS.carouselInnerMax} steps that walk through ONE topic step-by-step (cover slide introduces the topic). Use ${PROMPT_LIMITS.carouselInnerMin} for simple topics, more for richer ones.`,
            },
            body: {
                type: Type.STRING,
                description: `Full caption for the post (max ${PROMPT_LIMITS.bodyWords} words, Czech)`,
            },
            cta: {
                type: Type.STRING,
                description: "CTA — řiď se sekcí CTA POLITIKA v promptu",
            },
            hashtags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "8-10 relevant hashtags",
            },
            imagePrompt: {
                type: Type.STRING,
                description: "English image prompt for cover slide background - sets the visual theme for ALL slides",
            },
            visualTheme: {
                type: Type.STRING,
                description: "Shared visual theme for ALL slides in 1 sentence (e.g. 'Dark urban street scene with neon reflections under moody studio lighting'). All slide imagePrompts MUST stay within this theme.",
            },
        },
        required: ["angle", "hook", "imageSubtext", "slides", "body", "cta", "hashtags", "imagePrompt", "visualTheme"],
        propertyOrdering: ["angle", "hook", "accentWords", "imageSubtext", "slides", "body", "cta", "hashtags", "imagePrompt", "visualTheme"],
    }
}

/** Hard cap on story frames. Three is where a viewer's patience runs out, and it
 *  also keeps the render inside the same QA/edit budget a carousel gets. */
export const MAX_STORY_FRAMES = 3

/**
 * Tvrdé limity promptu — JEDINÝ zdroj pravdy.
 * ===========================================
 * Každé z těchhle čísel se dřív psalo ručně dvakrát: jednou do textu promptu a jednou
 * do `description` ve schématu. Nic je nedrželo u sebe, takže se tiše rozešla —
 * u `subtext` slidu říkal prompt „max 12 slov" a schéma „max 20 words" o tomtéž poli.
 * Model pak dostal dvě čísla a musel si vybrat.
 *
 * Je to stejná třída chyby jako pravidlo „schéma a prompt se mění SPOLU" (§16, tam
 * šlo o chybějící pole, tady o rozcházející se hodnoty). Proto se obojí interpoluje
 * odsud a `scripts/test-prompt-assembly.ts` navíc tvrdí, že se čísla rovnají.
 *
 * ⚠️ Nepiš limit natvrdo do promptu ani do schématu. Přidej ho sem.
 */
export const PROMPT_LIMITS = {
    /** Pole `hook` = headline cover slidu. Cover nese míň textu než vnitřní slide. */
    coverHeadlineWords: 8,
    /** Podtext coveru (`imageSubtext`). */
    coverSubtextWords: 8,
    /** Headline vnitřního slidu. */
    slideHeadlineWords: 6,
    /** Detail vnitřního slidu. Krátce schválně: text se vypaluje do obrázku a česká
     *  diakritika je přesně to, na čem render selhává. Naměřeno 2026-08-10 na
     *  chrlit/tahak_pro_obory — v šestnáctislovném podtextu skončil v obraze překlep
     *  („NESMYSKNÉ"), korektivní edit ho neopravil a slide odešel jako native_forced.
     *  Ten pokus o opravu stál $0,134, tedy 13 % ceny celého postu.
     *  Celý návod patří do captionu, ne na slide — slide je plakát. */
    slideSubtextWords: 12,
    /** Hlavní caption. */
    bodyWords: 120,
    /** Vnitřní slidy karuselu (BEZ coveru). Strop 6 = 7 slidů celkem: cover + 4 kroky
     *  + „chyby" + CTA. Přesně tolik chce reálná `structure` formátu krok_za_krokem;
     *  dřívější strop 5 ji strukturálně nešlo splnit, přestože byla vložená jako
     *  „závazná". Pozor na cenu: každý slide je samostatná generace obrázku. */
    carouselInnerMin: 3,
    carouselInnerMax: 6,
} as const

/** Kolik slidů smí mít karusel celkem (cover + vnitřní) — pro validaci `structure`. */
export const CAROUSEL_MAX_TOTAL_SLIDES = PROMPT_LIMITS.carouselInnerMax + 1

/**
 * Story set — 1 to 3 vertical 9:16 frames.
 *
 * `frames` deliberately includes frame 1, unlike the carousel's cover/slides split:
 * a story has no cover asymmetry (nothing lands in the profile grid), and splitting
 * would make a 1-frame story a hook plus an empty array — a special case in every
 * downstream loop. `hook` stays required because it is load-bearing elsewhere (the
 * caption assembly, the critic, the dedup check, the post card title); autopilot
 * enforces `frames[0].headline === hook` in code, the same verbatim doctrine the
 * design brief uses for typography.
 */
export function buildStorySchema(config: ClientConfig) {
    return {
        type: Type.OBJECT,
        properties: {
            angle: {
                type: Type.STRING,
                description: "PRVNÍ krok: 1 česká věta — jaký úhel volíš a čím se liší od nedávných postů",
            },
            hook: {
                type: Type.STRING,
                description: "Headline of frame 1 — the thumb-stopper (max 5 words, Czech). NO EMOJI, NO hashtags.",
            },
            frames: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        headline: { type: Type.STRING, description: "Frame headline (max 5 words, Czech). Read at arm's length in under 2 seconds — short beats clever." },
                        subtext: { type: Type.STRING, description: "One supporting line (max 10 words, Czech). May be empty for a pure-statement frame." },
                        imagePrompt: { type: Type.STRING, description: "English image prompt for this frame's background. Vertical 9:16 composition. NO TEXT, NO WORDS, NO LETTERS in image — the typography is rendered separately." },
                    },
                    required: ["headline", "subtext", "imagePrompt"],
                },
                description: "1 to 3 frames INCLUDING the first. 3 = hook / payoff / CTA, 2 = hook / CTA, 1 = single statement with the CTA in its subtext. Frame count follows the content — never pad.",
            },
            body: {
                type: Type.STRING,
                description: `Shrnutí storky pro majitele účtu — co říká a proč, jedním odstavcem (max 60 slov, česky). Tento text se na Instagram NEPOSÍLÁ (stories nemají popisek); slouží do přehledu v aplikaci, do e-mailu s kampaní a pro ruční sdílení.`,
            },
            cta: {
                type: Type.STRING,
                description: "CTA rendered INTO the last frame — řiď se sekcí CTA POLITIKA v promptu. Musí být soběstačné (story přes API nemá odkazový sticker): 'napiš nám do zpráv', 'odpověz na storku'. NIKDY 'swipe up' ani URL.",
            },
            hashtags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "8-10 relevant hashtags. Ukládají se k příspěvku pro přehled a ruční sdílení — NIKDY se nevykreslují do snímku.",
            },
        },
        required: ["angle", "hook", "frames", "body", "cta", "hashtags"],
        propertyOrdering: ["angle", "hook", "frames", "body", "cta", "hashtags"],
    }
}

// ============================================
// WEEK PLANNER
// ============================================

export function buildSmartWeekPlan(config: ClientConfig, performance: PerformanceInsight, count: number = 14): string[] {
    if (performance.avgEngagement === 0) {
        const wp = config.weekPlan
        if (!wp || wp.length === 0) return []
        // Cold start (no performance data yet): rotate the starting offset so two plans
        // don't open with the identical type rhythm every time. The weekPlan's intended
        // sequence/proportions are preserved — only the entry point shifts.
        const offset = Math.floor(Math.random() * wp.length)
        const staticPlan: string[] = []
        for (let i = 0; i < count; i++) {
            staticPlan.push(wp[(i + offset) % wp.length])
        }
        return staticPlan
    }

    const ratios: Record<string, number> = {}
    for (const [key, pillar] of Object.entries(config.contentPillars || {})) {
        ratios[key] = pillar.ratio
    }

    // Data-driven ratio adaptation — aggressive, not timid
    if (performance.pillarPerformance) {
        const pp = performance.pillarPerformance
        const avg = performance.avgEngagement

        for (const name of Object.keys(ratios)) {
            if (!pp[name] || pp[name].avgScore === 0) continue

            const pillarAvg = pp[name].avgScore
            if (pillarAvg > avg * 1.5) {
                // Top performer: boost ratio by 50%
                ratios[name] = Math.min(0.6, ratios[name] * 1.5)
                console.log(`   📈 ${name}: ratio ×1.5 (${pillarAvg.toFixed(0)} vs avg ${avg.toFixed(0)})`)
            } else if (pillarAvg < avg * 0.5) {
                // Underperformer: cut ratio in half
                ratios[name] = Math.max(0.05, ratios[name] * 0.5)
                console.log(`   📉 ${name}: ratio ×0.5 (${pillarAvg.toFixed(0)} vs avg ${avg.toFixed(0)})`)
            }
        }

        // Normalize so ratios sum to ~1.0
        const totalRatio = Object.values(ratios).reduce((s, r) => s + r, 0)
        if (totalRatio > 0) {
            for (const key of Object.keys(ratios)) {
                ratios[key] = ratios[key] / totalRatio
            }
        }
    }

    // Manual-only formats (giveaways, contests) are user-triggered only — never planned.
    const manualOnlyNames = new Set((config.postTypeDefs ?? []).filter(d => d.manualOnly).map(d => d.name))

    // Per-FORMAT engagement (measured, name-keyed — see analyzePerformance.typePerformance).
    // Within a pillar, proven formats earn more slots; unmeasured ones keep a fair chance
    // (neutral 1.0), weak ones shrink but never disappear (min one slot in the rotation).
    const typePerf = performance.typePerformance || {}
    const clientAvg = performance.avgEngagement || 0
    const typeWeight = (t: string): number => {
        const p = typePerf[t]
        if (!p || p.posts < 2 || clientAvg <= 0) return 1
        return Math.min(1.6, Math.max(0.5, p.avgScore / clientAvg))
    }

    const plan: string[] = []
    for (const [pillar, ratio] of Object.entries(ratios)) {
        const pillarCount = Math.max(1, Math.round(count * ratio))
        const types = (config.contentPillars[pillar]?.postTypes || []).filter(t => !manualOnlyNames.has(t))
        if (types.length === 0) continue
        // Deterministic weighted rotation, interleaved: round-robin passes where a format
        // stays in later passes only if its weight earns it (all-neutral ⇒ exactly the old
        // round-robin, so cold start behaves identically).
        const remaining = [...types]
            .sort((a, b) => typeWeight(b) - typeWeight(a))
            .map(t => ({ t, n: Math.max(1, Math.round(typeWeight(t) * 2)) }))
        const rotation: string[] = []
        while (remaining.some(r => r.n > 0)) {
            for (const r of remaining) {
                if (r.n > 0) { rotation.push(r.t); r.n-- }
            }
        }
        for (let i = 0; i < pillarCount && plan.length < count; i++) {
            plan.push(rotation[i % rotation.length])
        }
    }

    while (plan.length < count) {
        plan.push(config.weekPlan[plan.length % config.weekPlan.length])
    }

    const _getPillarForType = createPillarMapper(config)
    const byPillar: Record<string, string[]> = Object.fromEntries(Object.keys(config.contentPillars || {}).map(k => [k, []]))
    for (const type of plan) {
        const pillar = _getPillarForType(type)
        if (!byPillar[pillar]) {
            byPillar[pillar] = []
        }
        byPillar[pillar].push(type)
    }

    const interleaved: string[] = []
    const pillarKeys = Object.keys(config.contentPillars || {})
    let pillarOrder = pillarKeys.flatMap(k => {
        const r = config.contentPillars[k]?.ratio || 0
        return Array(Math.max(1, Math.round(r * 10))).fill(k)
    })
    
    // Fallback if pillarOrder is empty
    if (pillarOrder.length === 0) {
        pillarOrder = Object.keys(byPillar)
    }

    let pillarIdx = 0
    while (interleaved.length < count) {
        if (pillarOrder.length > 0) {
            const p = pillarOrder[pillarIdx % pillarOrder.length]
            if (byPillar[p] && byPillar[p].length > 0) {
                interleaved.push(byPillar[p].shift()!)
            }
        }
        pillarIdx++
        if (pillarIdx > count * 10) break
    }

    // Fallback: if interleaving fell short due to empty pillar queues, fill from plan
    while (interleaved.length < count) {
        interleaved.push(plan[interleaved.length % plan.length])
    }

    return interleaved.slice(0, count)
}

// ============================================
// MEGA PROMPT BUILDER
// ============================================

export function buildMegaPrompt(
    config: ClientConfig,
    postType: PostType,
    idea: PostIdea | null,
    review: Review | null,
    recentCaptions: string[],
    performance: PerformanceInsight,
    userTopic?: string,
    selectedProduct?: { name: string; type: string; slug: string; price?: string; description?: string },
    formatOverride?: PostFormat,
    /** Hook the user approved in the content plan. Binds the copywriter: keep its angle/promise,
     *  sharpen the wording — don't silently invent a different hook. */
    approvedHook?: string,
    /** Pre-resolved CTA policy (single source of truth for CTA/website/product-link rules).
     *  Derived internally when omitted — pass it from the caller to guarantee writer/judge parity. */
    ctaPolicy?: CtaPolicy
): string {
    const bv = config.brandVoice
    const toneDesc = getToneDescription(config, postType.name)
    const hookTemplates = getHookTemplates(config, postType.name, 4)
    const policy = ctaPolicy ?? resolveCtaPolicyForPost(config, postType.name, selectedProduct)

    // Audience persona targeting — DETERMINISTIC per post type/pillar (not random), so the
    // brand voice stays coherent post-to-post instead of re-segmenting the audience each time.
    const selectedPersona = selectPersonaForPost(config, postType.name)
    let personaSection = ""
    if (selectedPersona) {
        const persona = selectedPersona
        personaSection = `
## 🎯 CÍLOVÁ PERSONA PRO TENTO POST
**Segment:** ${persona.label} (${persona.ageRange} let)
**Pain points:** ${persona.painPoints.join(", ")}
**Co na ně funguje:** ${persona.triggers.join(", ")}

**INSTRUKCE:** Hook, tón body a CTA MUSÍ být přizpůsobeny PŘESNĚ pro tuto personu.
- Hook musí rezonovat s jejich pain points
- Body musí používat jejich triggery
- Tón CTA přizpůsob personě (${persona.ctaStyle}) — REŽIM CTA (web vs. engagement) ale určuje výhradně CTA POLITIKA níže
`
    }

    // Psycholog — prodejní psychologie do copywritingu (deterministická vrstva, žádné AI volání).
    // Vypnutelné přes config.psychologist === false. Viz instagram/psychologist.ts.
    const psychologySection = config.psychologist !== false ? buildPsychologistSection(selectedPersona) : ""

    // Canonical voice examples — the few-shot anchor that keeps the brand sounding like itself.
    const goldExamplesSection = buildGoldExamplesSection(config, postType.name)

    // avgEngagement > 0 je PODMÍNKA EXISTENCE téhle sekce, ne jen jednoho jejího řádku.
    // analyzePerformance počítá engagement z metrik; post bez metrik má 0, takže u klienta,
    // který metriky nezadává, byly "bestHooks" prostě posledních 5 postů a "topPatterns"
    // výsledek substringového testu nad nimi. Copywriter pak dostal "Zlaté hooky (nejlepší
    // dosah)" o postech s nulovým naměřeným dosahem a instrukci držet jejich rytmus —
    // přímo proti sekci "NEOPAKUJ SE" o pár řádků níž, která ty samé posty zakazuje.
    // Stejnou podmínku má buildSmartWeekPlan (viz cold-start větev výše).
    let learningSection = ""
    if (performance.avgEngagement > 0 && (performance.topPatterns.length > 0 || performance.bestHooks.length > 0)) {
        learningSection = `
## 📊 DATA Z REÁLNÉHO VÝKONU (PRIORITA 4)
Toto jsou historicky nejúspěšnější formáty pro tuto značku. Stavěj na nich:

${performance.topPatterns.length > 0 ? `**Top Fungující Vzorce:** ${performance.topPatterns.join(", ")}` : ""}
${performance.bestHooks.length > 0 ? `**Zlaté Hooky (Nejlepší dosah):**\n${performance.bestHooks.map(h => `- "${h}"`).join("\n")}` : ""}
${performance.avgEngagement > 0 ? `**Průměrný Engagement (Benchmarking):** ${performance.avgEngagement.toFixed(0)} bodů` : ""}

**INSTRUKCE:** NEKOPÍRUJ tyto přesné fráze doslovně, ale použij stejnou psychologii, strukturu a rytmus.
Vzorec znamená ZPŮSOB, jak to funguje — ne šablonu k zopakování. Když stejný vzorec
najdeš i mezi posledními posty níž, sekce NEOPAKUJ SE má přednost: použij jeho
psychologii, ale jinou formu.
`
    }

    let productsSection = ""
    if (selectedProduct) {
        // A specific product was pre-selected — force the AI to use it
        productsSection = `
## 🎯 VYBRANÝ PRODUKT (PRIORITA 2 — NEMĚŇ PRODUKT!)
**Název:** ${selectedProduct.name}
**Typ:** ${selectedProduct.type}
${selectedProduct.description ? `**Popis:** ${selectedProduct.description}` : ""}
${selectedProduct.price ? `**Cena:** ${selectedProduct.price}` : ""}
${policy.productMention === "link" ? `**URL:** ${policy.productUrl}` : ""}

### POVINNÉ:
- Caption MUSÍ být o tomto KONKRÉTNÍM produktu: **${selectedProduct.name}**
${policy.productMention === "link"
    ? `- V CTA MUSÍ být odkaz: ${policy.productUrl}`
    : `- Produkt zmiň přirozeně v textu (příběh, zkušenost) — BEZ odkazu a BEZ webu. CTA řídí CTA POLITIKA níže.`}
- V imagePrompt MUSÍŠ popsat PŘESNĚ tento produkt (jeho barvu, design, styl)
- NESMÍŠ zmiňovat žádný jiný produkt!
`
    }
    // No product → AI generates generic branded content (no product list dump)


    const postFormat = formatOverride || getPostFormat(config, postType.name)
    // Config def = source of truth for the format's creative brief (description /
    // structure / visualStyle); the DB row is a drift-prone copy kept for the picker.
    const typeDef = getPostTypeDef(config, postType.name)
    const formatDescription = typeDef?.description || postType.description

    return `
${bv.persona}

## TVŮJ ÚKOL
Vytvoř kompletní Instagram post ve formátu: **${postType.emoji || "📱"} ${postType.display_name}**
${formatDescription ? `**Jak tenhle formát funguje:** ${formatDescription}

⚠️ Tohle je MECHANISMUS formátu, ne téma postu. Formát říká, JAK obsah podat.
CO je obsahem, určuje námět / zadané téma níž. Formát se použije na stovky různých
témat — nikdy z něj nedělej pořád tentýž příspěvek.` : ""}

Brand: ${config.name} | Web: ${config.website} | IG: ${config.instagram}
Značka je o tomhle: ${config.contentFocus}

## 🧭 PRIORITY (při konfliktu instrukcí VŽDY vyhrává nižší číslo)
1. Zadané téma od uživatele / schválený hook
2. Vybraný produkt + CTA politika
3. Brand voice, persona a zlatý standard
4. Learning data (reálný výkon, brand memory, feedback kritika)
5. Kontext a inspirace (hooky, nápady, recenze)

## BRAND VOICE
${bv.voiceTraits.map(t => `- ${t}`).join("\n")}

### JAZYK
Piš česky, moderní hovorovou češtinou. Krátké věty. Přímé. Bez keců.

### ZAKÁZÁNO
${bv.antiPatterns.map(p => p).join("\n")}

### ⚠️ NIKDY NEPŘEKLÁDEJ ANGLICKÉ NÁZVY!
Názvy produktů, kolekcí a brand names ponechej V ANGLIČTINĚ! Příklady:
- ✅ "Zero Fucks Given" — SPRÁVNĚ (originální název)
- ❌ "Nula fucků na rozdávání" — ŠPATNĚ (přeložený do CZ)

## TÓN: ${toneDesc}

${productsSection}
${idea && !userTopic ? (() => {
    // Resolve category context from idea's subcategory
    const pillarKey = getPillarForType(config, postType.name)
    const pillarConfig = config.contentPillars[pillarKey]
    const ideaCategory = idea.subcategory && pillarConfig?.categories?.find(c => c.id === idea.subcategory)
    const categoryContext = ideaCategory
        ? `\n**Kategorie:** ${ideaCategory.emoji} ${ideaCategory.label}${ideaCategory.prompt ? `\n**Úhel:** ${ideaCategory.prompt}` : ""}\nPost MUSÍ odpovídat tomuto typu obsahu.`
        : `Kategorie: ${idea.category}, Platforma: ${idea.subcategory || "general"}`
    return `## ZDROJOVÝ NÁPAD
**${idea.title}**: ${idea.content}
${categoryContext}
`
})() : ""}
${userTopic ? `## 🎯 ZADANÉ TÉMA OD UŽIVATELE (PRIORITA 1)
**Post MUSÍ být PŘESNĚ o tomto tématu:** ${userTopic}
` : ""}
${approvedHook ? `## ✅ SCHVÁLENÝ HOOK Z PLÁNU (PRIORITA 1 — uživatel ho schválil, VYCHÁZEJ Z NĚJ, NEPŘEPISUJ od nuly!)
**Schválený hook:** "${approvedHook}"

ZÁVAZNÉ:
- Tohle je směr, který uživatel SCHVÁLIL. Zachovej jeho jádro: stejný úhel, stejný příslib, stejnou konkrétnost (čísla, jména, fakta).
- Smíš ho vypilovat na Pro úroveň — rytmus, údernost, formulaci, diakritiku — ale uživatel MUSÍ svůj schválený nápad ve finálním hooku poznat.
- NEVYMÝŠLEJ jiné téma ani jiný úhel. Když je hook slabý, ZESIL ho, nenahrazuj jiným nápadem.
` : ""}
${review ? `## RECENZE K VYUŽITÍ
"${review.quote}" — ${review.customer_initials || "Zákazník"}
` : ""}
${goldExamplesSection}
${learningSection}
${personaSection}
${psychologySection}
## INSPIRACE PRO HOOKY
${hookTemplates.map(h => `- Vzor: "${h.pattern}" → Příklad: "${h.example}" (trigger: ${h.trigger})`).join("\n")}

${buildCtaPolicySection(policy, config.ctaStrategies[policy.mode] || [], config.contentPillars[policy.pillarLabel]?.description)}

## ⚠️ NEOPAKUJ SE! Tyto příspěvky (včetně draftů) už existují — NESMÍŠ opakovat stejné TÉMA ani stejný HOOK:
${recentCaptions.map((c, i) => {
    // Show hook + body summary so AI sees the full topic, not just the hook
    return `${i + 1}. "${c}"`
}).join("\n")}

### PRAVIDLA DEDUPLIKACE:
- Pokud existující post mluví o konkrétním místě/faktu (např. "Česká Kamenice"), NESMÍŠ o tom samém místě/faktu psát znovu
- Pokud existující post používá stejný formát (např. "POV:", "3 důvody proč..."), použij JINÝ formát
- Pokud existující posty pokrývají určitá témata, přijď s ÚPLNĚ jiným úhlem pohledu

## 🎯 ÚHEL (ANGLE COMMIT — PRVNÍ KROK)
Než napíšeš první slovo: vyber JEDEN úhel a zapiš ho do pole "angle" (1 česká věta — jaký úhel volíš a čím se liší od postů výše). Celý post pak drž V TOMTO úhlu.

${postFormat.medium === "reel" ? `
## 🎬 INSTAGRAM REEL — FULL VIDEO PRODUCTION
Toto je Instagram Reel (krátké video, ${postFormat.reelDuration || 8} sekund).
Video bude generováno AI (Veo 3.1) s nativním zvukem + český voiceover z narrace.

### PRAVIDLA PRO REELS:
- **HOOK** musí být v prvních 1.5 sekundách — vizuálně i textově zaujmout
- **PACING** musí být dynamický — žádné statické záběry delší než 3s
- Každá scéna MUSÍ mít narration text (bude přečtený česky jako voiceover)
- Camera movements musí být plynulé a profesionální
- Poslední scéna MUSÍ obsahovat CTA${policy.allowWebsite ? ` s ${config.website}` : " — engagement výzvu (otázka / uložit / sdílet), BEZ webu"}

${typeDef?.structure ? `### 🧩 RYTMUS TOHOTO FORMÁTU (sled beatů — tempo, ne obsah):
${typeDef.structure}

Kostra říká, JAK se příběh odvíjí. CO se v něm odehrává, určuje NÁMĚT výše.
Pokud kostra zmiňuje konkrétní scénu, rekvizitu nebo znění věty, ber to jen jako
ukázku tempa — NEZOPAKUJ ji, přenes na ni svůj námět.

### ČASOVÁNÍ SCÉN (${postFormat.reelDuration || 8}s video — timing dodrž, sled beatů podle rytmu výše):` : `### STRUKTURA SCÉN (${postFormat.reelDuration || 8}s video):`}
${(postFormat.reelDuration || 8) <= 5 ? `
- Scene 1 (0-1.5s): HOOK — dramatický vizuál, narration = problém/otázka
- Scene 2 (1.5-3.5s): VALUE — řešení/produkt v akci
- Scene 3 (3.5-5s): CTA — ${policy.allowWebsite ? `result + ${config.website}` : "výsledek + engagement výzva (BEZ webu)"}
` : `
- Scene 1 (0-2s): HOOK — dramatický vizuál, narration = problém/otázka
- Scene 2 (2-${(postFormat.reelDuration || 8) - 3}s): VALUE — hlavní obsah, důkaz, ukázka
- Scene 3 (${(postFormat.reelDuration || 8) - 3}-${postFormat.reelDuration || 8}s): CTA — ${policy.allowWebsite ? `výsledek + ${config.website}` : "výsledek + engagement výzva (BEZ webu)"}
`}

### CAMERA MOVEMENTS (vybírej z těchto):
dolly in, dolly out, slow pan left/right, tracking shot, static close-up, 
overhead/bird's eye, low angle hero shot, smooth orbit, rack focus, handheld natural

### MOOD/LIGHTING (vybírej z těchto):
golden hour warmth, dramatic side-lighting, bright natural daylight, moody cinematic,
neon glow, studio softbox, high-contrast editorial, morning mist, backlit silhouette

### SOUND EFFECTS (pro Veo 3.1 nativní audio):
Do každé scény přidej zvukový efekt/atmosféru — např. "city ambience", "door opening",
"coffee pouring", "keyboard typing", "wind in trees", "footsteps on gravel"

${config.videoFocus ? `### BRAND VIDEO STYLE:\n${config.videoFocus}\n` : ""}

## VÝSTUP — vrať POUZE validní JSON:
{
  "angle": "1 věta — zvolený úhel a čím se liší od nedávných postů",
  "hook": "Opening problem/question (2-4 slova, punchy, česky). ŽÁDNÉ EMOJI.",
  "scenes": [
    {
      "timeRange": "0-2s",
      "visual": "Detailed English description of what happens visually",
      "camera": "camera movement type",
      "mood": "lighting and mood description", 
      "narration": "Český text pro voiceover (1-2 věty, přirozená řeč)",
      "soundEffect": "ambient sound or effect for this scene"
    }
  ],
  "videoScript": "Fallback: single summary of all scenes in English",
  "caption": "Instagram caption pro Reel (max 100 slov, česky).",
  "cta": "${policy.allowWebsite ? `MUSÍ obsahovat ${config.website}` : "engagement CTA — BEZ webu a BEZ URL"}",
  "hashtags": ["8-10", "relevantních", "hashtagů"]
}
` : postFormat.medium === "carousel" ? `
## 📸 CAROUSEL POST (${PROMPT_LIMITS.carouselInnerMin + 1}-${CAROUSEL_MAX_TOTAL_SLIDES} slidů) — PŘÍBĚH, KTERÝ NUTÍ SWIPOVAT

${typeDef?.structure ? `### 🧩 RYTMUS TOHOTO FORMÁTU (sled beatů — tempo, ne obsah):
${typeDef.structure}

Kostra určuje dramaturgii a počet beatů. CO je na slidech, určuje NÁMĚT výše.
Pokud kostra zmiňuje konkrétní scénu, rekvizitu nebo znění věty, ber to jen jako
ukázku tempa — NEZOPAKUJ ji, přenes na ni svůj námět.
` : `### DRAMATURGIE (POVINNÁ):
1. **Slide 1 (COVER):** otevřená smyčka — slib, otázka nebo napětí, které se vyřeší až UVNITŘ karuselu. Cover NIKDY neprozrazuje pointu.
2. **Vnitřní slidy:** každý slide = přesně JEDNA myšlenka, která posouvá příběh dál. Slide bez nové myšlenky NEEXISTUJE — výplňový slide smaž.
3. **Švy mezi slidy:** každý vnitřní slide končí důvodem swipnout dál (nedokončená pointa, mikro-napětí, "a teď to nejlepší").
4. **Předposlední slide:** PAYOFF — splnění slibu z coveru. Tady je hodnota.
5. **Poslední slide:** shrnutí jednou větou + CTA${policy.allowWebsite ? ` na ${config.website}` : " (engagement — BEZ webu)"}.
`}
### TEXT NA SLIDECH (tvrdá pravidla):
- Slide je PLAKÁT, ne odstavec: headline max ${PROMPT_LIMITS.slideHeadlineWords} slov, subtext max ${PROMPT_LIMITS.slideSubtextWords} slov. Detaily patří do caption.
${typeDef?.structure
    ? `- Počet slidů urči podle STRUKTURY výše — drž se jejího počtu beatů. Strop je ${CAROUSEL_MAX_TOTAL_SLIDES} vč. coveru.`
    : `- Počet slidů podle obsahu (${PROMPT_LIMITS.carouselInnerMin + 1}-${CAROUSEL_MAX_TOTAL_SLIDES} vč. coveru) — nikdy nenatahuj. Radši ${PROMPT_LIMITS.carouselInnerMin + 1} silné než ${CAROUSEL_MAX_TOTAL_SLIDES} vycpaných.`}
- Slidy čte člověk za 2 sekundy — každé slovo si musí místo zasloužit.

## VÝSTUP — vrať POUZE validní JSON:
{
  "angle": "1 věta — zvolený úhel a čím se liší od nedávných postů",
  "hook": "Cover headline (max ${PROMPT_LIMITS.coverHeadlineWords} slov, česky). ŽÁDNÉ EMOJI.",
  "accentWords": ["2-3 klíčová slova Z HOOKU k vizuálnímu zvýraznění (přesný podřetězec hooku)"],
  "slides": [
    { "headline": "max ${PROMPT_LIMITS.slideHeadlineWords} slov...", "subtext": "max ${PROMPT_LIMITS.slideSubtextWords} slov...", "imagePrompt": "English prompt..." },
    { "headline": "...", "subtext": "...", "imagePrompt": "English prompt..." },
    { "headline": "...", "subtext": "...", "imagePrompt": "English prompt..." }
  ],  // ${PROMPT_LIMITS.carouselInnerMin}-${PROMPT_LIMITS.carouselInnerMax} vnitřních slidů podle toho, co obsah unese${typeDef?.structure ? " — drž strukturu formátu výše" : " — drž dramaturgii výše"}
  "body": "Hlavní caption (max ${PROMPT_LIMITS.bodyWords} slov) — sem patří ÚPLNÝ postup. Slidy nesou plakátovou verzi, caption ten návod dopoví: konkrétní kroky, čísla, časy, pořadí.",
  "cta": "${policy.allowWebsite ? `CTA směřující na ${config.website}` : "engagement CTA — BEZ webu a BEZ URL"}",
  "hashtags": ["8-10", "hashtagů"],
  "imagePrompt": "English prompt for COVER slide background.",
  "visualTheme": "Shared visual theme for ALL slides."
}
` : postFormat.medium === "story" ? `
## 📱 INSTAGRAM STORY (1-3 svislé snímky) — RYCHLÝ ZÁSAH, KTERÝ ZMIZÍ

Story je 1-3 svislé obrazovky 9:16, které po 24 hodinách zmizí. Divák je drží
palcem nad tlačítkem "další" a čte je ve stoje, na světle, za necelé 2 sekundy.
Nejde do feedu ani do mřížky profilu — nemá popisek, nemá odkaz, nemá čas.

${typeDef?.structure ? `### 🧩 RYTMUS TOHOTO FORMÁTU (sled beatů — tempo, ne obsah):
${typeDef.structure}

Kostra určuje sled a počet snímků. CO na nich je, určuje NÁMĚT výše.
Pokud kostra zmiňuje konkrétní scénu nebo znění věty, ber to jen jako ukázku
tempa — NEZOPAKUJ ji, přenes na ni svůj námět.
` : `### DRAMATURGIE PODLE POČTU SNÍMKŮ (počet řídí OBSAH, ne naopak):
- **3 snímky:** HOOK (zastav palec) → PAYOFF (ta jedna věc, kterou chci sdělit) → CTA
- **2 snímky:** HOOK → CTA
- **1 snímek:** jedno tvrzení, CTA v subtextu
Když téma unese jen dvě obrazovky, udělej dvě. Vycpaný třetí snímek je horší než žádný.
`}
### TEXT NA SNÍMCÍCH (tvrdá pravidla):
- Headline **max 5 slov**, subtext **max 10 slov**. Story se čte na délku paže.
- Text musí být větší a stručnější než u feedového postu — ne odstavec, ale nápis.
- **ZAKÁZÁNO v textu snímku:** hashtagy, URL, "swipe up", "odkaz v biu".
  Story publikovaná přes API nemá odkazový sticker, takže CTA musí být soběstačné:
  ${policy.allowWebsite ? `zmínka o ${config.website} patří do řeči, ne jako proklik` : "engagement výzva"} —
  "napiš nám do zpráv", "odpověz na tuhle storku", "ulož si to".
- Poslední snímek nese CTA a musí působit jako konec, ne jako přerušení.

### POLE "body" — NEJDE NA INSTAGRAM:
Stories nemají popisek. Do "body" napiš shrnutí pro majitele účtu (max 60 slov):
co storka říká a proč. Zobrazí se v přehledu appky a v e-mailu s kampaní.

## VÝSTUP — vrať POUZE validní JSON:
{
  "angle": "1 věta — zvolený úhel a čím se liší od nedávných postů",
  "hook": "Headline PRVNÍHO snímku (max 5 slov, česky). ŽÁDNÉ EMOJI.",
  "frames": [
    { "headline": "max 5 slov — shodný s hookem", "subtext": "max 10 slov", "imagePrompt": "English prompt, vertical 9:16, NO TEXT" },
    { "headline": "...", "subtext": "...", "imagePrompt": "English prompt..." }
  ],  // 1-3 snímky VČETNĚ prvního${typeDef?.structure ? " — drž strukturu formátu výše" : " — drž dramaturgii výše"}
  "body": "Shrnutí pro majitele účtu (max 60 slov) — na Instagram se neposílá.",
  "cta": "${policy.allowWebsite ? "CTA — web zmíněný v řeči, NIKDY jako proklik" : "engagement CTA — BEZ webu a BEZ URL"}",
  "hashtags": ["8-10", "hashtagů"]  // ukládají se k příspěvku, NEVYKRESLUJÍ se do snímku
}
` : `
${typeDef?.structure ? `## 🧩 RYTMUS TOHOTO FORMÁTU (sled beatů — tempo, ne obsah):
${typeDef.structure}

Kostra určuje stavbu caption. CO se v ní říká, určuje NÁMĚT výše.
Pokud kostra zmiňuje konkrétní scénu nebo znění věty, ber to jen jako ukázku
tempa — NEZOPAKUJ ji, přenes na ni svůj námět.
` : ""}
## 🎨 VIZUÁL
Layout, typografii, umístění loga i poměr stran určuje AI Designer v dalším kroku.
Ty popiš POUZE SCÉNU: co je na fotce, kdo/co je subjekt, prostředí, světlo, nálada.
Nepiš, kde má být text ani jak má vypadat — o to se nestarej.

- **Feel značky:** ${config.feedAesthetic.feel}

### Typ-specifické foto:
${(() => {
            // Format visualStyle (config def) wins; imageInstructions is the legacy per-type fallback.
            const instructions = config.imageInstructions || {}
            const typeInstr = typeDef?.visualStyle || instructions[postType.name] || instructions._default || "STANDARD: Pozadí: relevantní lifestyle fotka."
            return `**${postType.name.toUpperCase()}:**\n${typeInstr}`
        })()}

## VÝSTUP — vrať POUZE validní JSON:
{
  "angle": "1 věta — zvolený úhel a čím se liší od nedávných postů",
  "hook": "První věta co zastaví scrollování (max 15 slov). ŽÁDNÉ EMOJI.",
  "body": "Hlavní text (max ${PROMPT_LIMITS.bodyWords} slov).",
  "cta": "CTA podle CTA POLITIKY výše",
  "hashtags": ["8-10", "relevantních", "hashtagů"],
  "imagePrompt": "English prompt for AI image generation. NO TEXT in image!",
  "imageSubtext": "Podtext dole pod hookem (max ${PROMPT_LIMITS.coverSubtextWords} slov, česky)"
}
`}
`.trim()
        // Volitelné sekce (produkt, nápad, téma, schválený hook) se skládají jako
        // `${cond ? "…" : ""}` na vlastních řádcích, takže když jich pár chybí naráz,
        // zůstane po nich až sedm prázdných řádků za sebou. Nic to nerozbíjí, jen se
        // za to platí a prompt se hůř čte při ladění. Slepit je až tady je bezpečnější
        // než přestavovat celý literál.
        .replace(/\n{3,}/g, "\n\n")
}

// ============================================
// QUALITY GATE — Multi-Agent Dialog
// ============================================

export interface QualityGateResult {
    overall: number
    hookScore: number
    bodyScore: number
    ctaScore: number
    originalityScore: number
    feedback: {
        keep: string[]
        fix: string[]
    }
}

/**
 * Calibration anchors — pin the judge's absolute scale so a "9" means the same
 * thing across sessions and model families (Claude/Gemini). Shared by scorePost
 * and rankDrafts.
 */
const SCORE_ANCHORS = `
## KALIBRACE — kotvy hodnocení (drž svá skóre konzistentní s nimi):
**Kotva 9/10:** Hook: "Zavřeli jsme náš nejprodávanější produkt. Schválně." — konkrétní, vyvolá zvědavost bez clickbaitu; body vypráví důvod s konkrétním detailem a přizná i nevýhodu; CTA přirozeně zve na web s jasným benefitem.
**Kotva 6/10:** Hook: "Věděli jste, že kvalita je u nás na prvním místě?" — generická řečnická otázka, nulové napětí; body popisuje místo aby ukázalo, samé obecnosti; CTA "sledujte nás pro víc tipů" bez webu a bez důvodu.
**Kotva 3/10:** Hook: "U nás najdete širokou nabídku kvalitních produktů pro každého." — reklamní fráze, nikdo se nezastaví; body je výčet vlastností bez příběhu a bez důkazu; CTA "navštivte náš web" bez jediného důvodu proč.`

export async function scorePost(
    config: ClientConfig,
    captionData: {
        hook: string
        body?: string
        cta: string
        hashtags: string[]
        slides?: { headline: string; subtext: string }[]
        angle?: string
    },
    postTypeName?: string,
    /** CTA policy of the post — the judge scores the CTA against it (a REACH post
     *  must NOT contain the website; a CONVERSION post must). Neutral check when omitted. */
    ctaPolicy?: CtaPolicy
): Promise<{ score: number; feedback: string; detail?: QualityGateResult; judged: boolean }> {
    const isCarousel = captionData.slides && captionData.slides.length > 0

    let slidesSection = ""
    let carouselBodyNote = ""
    if (isCarousel && captionData.slides) {
        slidesSection = `\nSlides:\n${captionData.slides.map((s, i) => `  ${i + 1}. "${s.headline}" - ${s.subtext}`).join("\n")}`
        carouselBodyNote = " U karuselu: navazují slidy logicky na sebe a přiměje cover headline swipnout?"
    }

    const goldSection = buildGoldExamplesSection(config, postTypeName ?? "", 2, 250)

    const scorePrompt = `
Jsi přísný Instagram content reviewer pro značku "${config.name}" (${config.website}).
IG handle: ${config.instagram}

## BRAND VOICE (post MUSÍ odpovídat):
${config.brandVoice.persona ? `Persona: ${config.brandVoice.persona.substring(0, 700)}` : ""}
Tón: ${config.brandVoice.voiceTraits?.slice(0, 4).join(", ") || "autentický"}

## ANTI-PATTERNS (post NESMÍ obsahovat):
${config.brandVoice.antiPatterns?.slice(0, 8).join(", ") || "generické fráze"}
${goldSection ? `\nZlatý standard níže = kalibrace brand voice, NE šablona témat.\n${goldSection}` : ""}
${ctaPolicy ? `\n${buildCtaPolicyJudgeBlock(ctaPolicy)}\n` : ""}
## POST${postTypeName ? ` (typ: ${postTypeName})` : ""}:
Deklarovaný úhel: "${captionData.angle || "neuveden"}"
Hook: "${captionData.hook}"
Body: "${captionData.body || ""}"${slidesSection}
CTA: "${captionData.cta}"
Hashtags: ${captionData.hashtags.join(", ")}

## KRITÉRIA (celkem max 10 bodů):
1. **Hook (0-3 body):** Zastaví scrollování? Krátký (max 15 slov)? Bez emoji?
2. **Body (0-3 body):** Dává čtenáři konkrétní hodnotu, sedí k brand voice a personě výše, čte se lehce?${carouselBodyNote}
3. **CTA (0-2 body):** ${ctaPolicy ? "Plní CTA politiku výše a vede k akci?" : "Jasná výzva k akci odpovídající typu postu?"}
4. **Originalita (0-2 body):** Drží post deklarovaný úhel? Nepůsobí genericky? Nepoužívá anti-patterns?
${SCORE_ANCHORS}

## VÝSTUP — vrať POUZE validní JSON s touto strukturou (overall = přesný součet bodů za 4 kritéria — nic nepřičítej ani neodečítej):
{
  "overall": <číslo 1-10>,
  "hookScore": <číslo 0-3>,
  "bodyScore": <číslo 0-3>,
  "ctaScore": <číslo 0-2>,
  "originalityScore": <číslo 0-2>,
  "keep": ["co je dobré a NESMÍ se měnit, česky, max 2 položky"],
  "fix": ["co je špatně a MUSÍ se opravit, česky, max 2 položky. Prázdné pole pokud je vše OK."]
}
`

    try {
        // Critic is a quality GATE — it judges Pro-written captions, so it runs on the
        // same Pro ladder (a flash judge waves through weak posts). If both Pro tiers are
        // down it throws → the catch below passes the post through (don't block a
        // Pro-written caption just because the judge is briefly unavailable).
        // Cross-family judge: routes to Claude (Sonnet 5) when ANTHROPIC_API_KEY is set — a
        // different model family from the Gemini writer removes self-preference bias and makes the
        // gate a real second opinion; otherwise the Gemini Pro judge at low temperature (unchanged).
        const text = await judgeText(scorePrompt, { label: "critic" })
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        const result = JSON.parse(jsonMatch?.[0] || text)

        const hookScore = Math.min(3, Math.max(0, Number(result.hookScore) || 1))
        const bodyScore = Math.min(3, Math.max(0, Number(result.bodyScore) || 1))
        const ctaScore = Math.min(2, Math.max(0, Number(result.ctaScore) || 0))
        const originalityScore = Math.min(2, Math.max(0, Number(result.originalityScore) || 1))
        const detail: QualityGateResult = {
            // Enforced in code, not just in the prompt: judges still "vibe-correct" the
            // overall despite the pure-sum instruction (observed: subscores 10 → overall 8).
            overall: Math.min(10, Math.max(1, hookScore + bodyScore + ctaScore + originalityScore)),
            hookScore,
            bodyScore,
            ctaScore,
            originalityScore,
            feedback: {
                keep: Array.isArray(result.keep) ? result.keep : [],
                fix: Array.isArray(result.fix) ? result.fix : [],
            },
        }

        // Build human-readable summary
        const fixSummary = detail.feedback.fix.length > 0
            ? detail.feedback.fix.join("; ")
            : "Vše OK"

        return {
            score: detail.overall,
            feedback: fixSummary,
            detail,
            judged: true,
        }
    } catch {
        // The 7 stays — the caller's contract is unchanged and a judge outage must never
        // block a Pro-written caption. But `judged: false` makes the outage VISIBLE: without
        // it, ig_generation_log recorded a real-looking 7/10 for a post nobody ever scored,
        // indistinguishable from a genuinely mediocre one, and the editorial board was told
        // the same. Callers log critic_score as null when judged is false.
        return { score: 7, feedback: "Scoring failed - passing through", judged: false }
    }
}

/**
 * Best-of-2 ranking judge (pipeline v2). LLM judges are noisy at absolute scores
 * but reliable at pairwise comparison — so instead of repairing one draft over
 * ≤3 editorial rounds, the copywriter produces two drafts and the judge PICKS,
 * returning the winner's rubric + fix list (≤1 repair round follows if < 9).
 * One judgeText call (cross-family Claude / Gemini Pro fallback, same as scorePost).
 * Throws on parse/model failure — the caller falls back to the legacy repair path.
 */
export async function rankDrafts(
    config: ClientConfig,
    draftA: { hook: string; body?: string; cta: string; hashtags: string[]; slides?: { headline: string; subtext: string }[]; angle?: string },
    draftB: { hook: string; body?: string; cta: string; hashtags: string[]; slides?: { headline: string; subtext: string }[]; angle?: string },
    postTypeName?: string,
    /** CTA policy of the post — same policy-aware CTA judging as scorePost. */
    ctaPolicy?: CtaPolicy,
): Promise<{ winner: "A" | "B"; score: number; loserScore: number; reason: string; detail: QualityGateResult }> {
    const renderDraft = (d: typeof draftA) => {
        const slides = d.slides?.length
            ? `\nSlides:\n${d.slides.map((s, i) => `  ${i + 1}. "${s.headline}" - ${s.subtext}`).join("\n")}`
            : ""
        return `Úhel: "${d.angle || "neuveden"}"\nHook: "${d.hook}"\nBody: "${d.body || ""}"${slides}\nCTA: "${d.cta}"\nHashtags: ${d.hashtags?.join(", ") || ""}`
    }

    const goldSection = buildGoldExamplesSection(config, postTypeName ?? "", 2, 250)

    const rankPrompt = `
Jsi přísný Instagram content reviewer pro značku "${config.name}" (${config.website}).
Copywriter napsal DVA návrhy stejného postu. Porovnej je a vyber LEPŠÍ.

## BRAND VOICE (post MUSÍ odpovídat):
${config.brandVoice.persona ? `Persona: ${config.brandVoice.persona.substring(0, 700)}` : ""}
Tón: ${config.brandVoice.voiceTraits?.slice(0, 4).join(", ") || "autentický"}

## ANTI-PATTERNS (post NESMÍ obsahovat):
${config.brandVoice.antiPatterns?.slice(0, 8).join(", ") || "generické fráze"}
${goldSection ? `\nZlatý standard níže = kalibrace brand voice, NE šablona témat.\n${goldSection}` : ""}
${ctaPolicy ? `\n${buildCtaPolicyJudgeBlock(ctaPolicy)}\n` : ""}
## NÁVRH A${postTypeName ? ` (typ: ${postTypeName})` : ""}:
${renderDraft(draftA)}

## NÁVRH B:
${renderDraft(draftB)}

## KRITÉRIA (celkem max 10 bodů, hodnoť OBA návrhy):
1. **Hook (0-3 body):** Zastaví scrollování? Krátký (max 15 slov)? Bez emoji?
2. **Body (0-3 body):** Dává čtenáři konkrétní hodnotu, sedí k brand voice a personě výše, čte se lehce?
3. **CTA (0-2 body):** ${ctaPolicy ? "Plní CTA politiku výše a vede k akci?" : "Jasná výzva k akci odpovídající typu postu?"}
4. **Originalita (0-2 body):** Drží návrh deklarovaný úhel? Nepůsobí genericky? Nepoužívá anti-patterns?
${SCORE_ANCHORS}

## VÝSTUP — vrať POUZE validní JSON (rubrika a keep/fix se týkají VÍTĚZE; skóre = přesný součet bodů za 4 kritéria):
{
  "winner": "A" | "B",
  "reason": "proč vyhrál, česky, 1 věta",
  "scoreA": <číslo 1-10>,
  "scoreB": <číslo 1-10>,
  "hookScore": <číslo 0-3>,
  "bodyScore": <číslo 0-3>,
  "ctaScore": <číslo 0-2>,
  "originalityScore": <číslo 0-2>,
  "keep": ["co je na vítězi dobré a NESMÍ se měnit, česky, max 2 položky"],
  "fix": ["co je na vítězi špatně a MUSÍ se opravit, česky, max 2 položky. Prázdné pole pokud je vše OK."]
}
`

    const text = await judgeText(rankPrompt, { label: "critic-rank" })
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    const result = JSON.parse(jsonMatch?.[0] || text)

    const winner: "A" | "B" = result.winner === "B" ? "B" : "A"
    const scoreA = Math.min(10, Math.max(1, Number(result.scoreA) || 5))
    const scoreB = Math.min(10, Math.max(1, Number(result.scoreB) || 5))

    const hookScore = Math.min(3, Math.max(0, Number(result.hookScore) || 1))
    const bodyScore = Math.min(3, Math.max(0, Number(result.bodyScore) || 1))
    const ctaScore = Math.min(2, Math.max(0, Number(result.ctaScore) || 0))
    const originalityScore = Math.min(2, Math.max(0, Number(result.originalityScore) || 1))
    // Winner's score = pure rubric sum, enforced in code (same rationale as scorePost);
    // the loser keeps the judge's raw comparative score (no rubric of its own).
    const score = Math.min(10, Math.max(1, hookScore + bodyScore + ctaScore + originalityScore))

    const detail: QualityGateResult = {
        overall: score,
        hookScore,
        bodyScore,
        ctaScore,
        originalityScore,
        feedback: {
            keep: Array.isArray(result.keep) ? result.keep : [],
            fix: Array.isArray(result.fix) ? result.fix : [],
        },
    }

    return {
        winner,
        score,
        loserScore: winner === "A" ? scoreB : scoreA,
        reason: String(result.reason || ""),
        detail,
    }
}

// ============================================
// CAPTION REVISION (user-feedback rewrite)
// ============================================

export interface ReviseCaptionInput {
    originalCaption: string
    originalHashtags: string[]
    postTypeDisplayName: string
    feedback: string
    product?: { name: string; slug: string; price?: string | null; description?: string | null } | null
    /** Engine post-type slug (ig_post_types.name). When present, the revision carries the
     *  post's CTA policy so a rewrite can't re-introduce a forbidden website link. */
    postTypeName?: string
    /** Text-only edit: the image is NOT being re-rendered, so the hook stays exactly as
     *  it is — it's burnt into the existing artwork and a "better" one would make the
     *  caption contradict the picture. Also drops imagePrompt/imageSubtext from the
     *  output schema, so a caption tweak can't hand the caller a re-roll trigger. */
    keepHook?: boolean
    /** The hook currently rendered in the image — passed verbatim when keepHook is set. */
    renderedHook?: string
}

export interface RevisedCaption {
    caption: string
    hashtags: string[]
    hook?: string
    imagePrompt?: string
    imageSubtext?: string
}

/**
 * Rewrite an existing caption according to user feedback, preserving brand voice.
 * Lives in the engine so revisions share the same validated ClientConfig
 * (brandVoice, hashtagPools) as regular generation.
 */
export async function reviseCaption(config: ClientConfig, input: ReviseCaptionInput): Promise<RevisedCaption> {
    const bv = config.brandVoice
    const policy = input.postTypeName ? resolveCtaPolicyForPost(config, input.postTypeName, input.product) : undefined
    const productSection = input.product
        ? (policy?.productMention === "natural"
            ? `\n## PRODUKT V PŘÍSPĚVKU\nNázev: ${input.product.name}\nCena: ${input.product.price || "neuvedena"}\nPopis: ${input.product.description || ""}\n⚠️ Produkt zmiňuj přirozeně BEZ odkazu a BEZ webu — CTA se řídí CTA politikou níže.\n`
            : `\n## PRODUKT V PŘÍSPĚVKU\nNázev: ${input.product.name}\nCena: ${input.product.price || "neuvedena"}\nPopis: ${input.product.description || ""}\nURL: ${config.website}/p/${input.product.slug}\n⚠️ Pokud feedback nemění produkt, zachovej odkaz na ${config.website}/p/${input.product.slug} v CTA.\n`)
        : ""
    const hashtagSection = config.hashtagPools
        ? `\n## HASHTAG POOLS (vyber z těchto):\n- Core: ${config.hashtagPools.core?.join(", ") || ""}\n- Niche: ${config.hashtagPools.niche?.slice(0, 5).join(", ") || ""}\n- Broad: ${config.hashtagPools.broad?.slice(0, 4).join(", ") || ""}\nPoužij 8-10 hashtagů, mix core + niche + relevantní z originálu.\n`
        : ""

    const prompt = `Jsi senior copywriter pro značku "${config.name}" (${config.website || ""}).

## BRAND PERSONA
${bv?.persona || "Profesionální a přátelský tón."}

## VOICE TRAITS
${(bv?.voiceTraits || []).map((t: string) => `- ${t}`).join("\n") || "- Autentický a přirozený"}

## ZAKÁZÁNO (NIKDY NEPOUŽÍVEJ)
${(bv?.antiPatterns || []).map((p: string) => `- ${p}`).join("\n") || "- Generické fráze, emoji spam"}

## TYP PŘÍSPĚVKU: ${input.postTypeDisplayName}
${productSection}${policy ? `\n${buildCtaPolicyJudgeBlock(policy)}\n` : ""}
## PŮVODNÍ CAPTION:
${input.originalCaption}

## PŮVODNÍ HASHTAGY: ${input.originalHashtags.join(" ")}
${hashtagSection}
## FEEDBACK OD KLIENTA:
"${input.feedback}"

## INSTRUKCE:
1. Přepiš caption PŘESNĚ podle feedbacku — ale zachovej brand voice a styl
2. ${input.keepHook
        ? `Hook je VYPÁLENÝ V OBRÁZKU a obrázek se teď nemění — vrať ho ZNAKOVĚ SHODNĚ: "${input.renderedHook || input.originalCaption.split("\n")[0]}". Uprav jen tělo, CTA a hashtagy.`
        : "Hook (první řádek) musí stále zastavit scrollování — max 15 slov, bez emoji"}
3. ${policy && !policy.allowWebsite ? "CTA zůstává engagement (komentář / uložení / sdílení) — NEPŘIDÁVEJ web ani URL" : `CTA musí směřovat na ${config.website || "web značky"}`}
4. Zachovej strukturu: hook → body → CTA → hashtags
5. Pokud feedback říká "zkrátit" — zkrať. Pokud "přidat humor" — přidej. Buď DOSLOVNÝ.
6. NIKDY nepřekládej anglické názvy produktů/kolekcí do češtiny
7. Měň POUZE to, co feedback žádá. Co feedback nezmiňuje, zůstává beze změny.

## VÝSTUP — vrať POUZE validní JSON:
${input.keepHook
        ? `{
  "caption": "kompletní nový text příspěvku (hook + body + CTA)",
  "hashtags": ["#hashtag1", "#hashtag2", "..."],
  "hook": "PŘESNĚ tentýž hook jako v původním příspěvku, znak po znaku"
}`
        : `{
  "caption": "kompletní nový text příspěvku (hook + body + CTA)",
  "hashtags": ["#hashtag1", "#hashtag2", "..."],
  "hook": "první řádek captiony — hook text pro overlay na obrázku (max 15 slov, bez emoji)",
  "imagePrompt": "English prompt for AI image generation — describe the background photo. NO TEXT in image. Photorealistic, editorial quality.",
  "imageSubtext": "krátký podtext pod hook na obrázku (max ${PROMPT_LIMITS.coverSubtextWords} slov, česky)"
}`}`

    // Copywriter = ~80% of text quality, so it runs the QUALITY LADDER: top Pro
    // (gemini-pro-latest) retried HARD on transient 503/429 for minutes, then the GA
    // Pro (gemini-2.5-pro) — NEVER flash. If both Pro tiers are truly exhausted it
    // throws QualityUnavailableError so the caller defers/fails instead of shipping a
    // flash-quality caption. In-job (800s budget), so the latency is hidden from the UI.
    const copyModels = [getModel("textPro")]
    if (hasFallback("textPro")) copyModels.push(getModel("textPro", "fallback"))

    const text = await generateTextQuality(prompt, { models: copyModels, label: "copywriter", temperature: getTemperature("copywriter") })

    let parsed: RevisedCaption
    try {
        parsed = JSON.parse(text.replace(/```json|```/g, "").trim())
    } catch {
        throw new Error("AI vrátilo neplatný JSON")
    }

    // Hard guard, same doctrine as the design brief's verbatim typography check: on a
    // text-only edit the image is not being re-rendered, so a drifted hook would leave
    // the caption saying one thing and the picture another. Asking politely isn't enough.
    if (input.keepHook) {
        parsed.hook = input.renderedHook || input.originalCaption.split("\n")[0]
        delete parsed.imagePrompt
        delete parsed.imageSubtext
    }

    return parsed
}
