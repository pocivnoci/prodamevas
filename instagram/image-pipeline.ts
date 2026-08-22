/**
 * Image Pipeline for Instagram Autopilot
 * Prompt refinement for images, carousels, and videos.
 * Art Director now receives Visual Memory from past top-performing posts.
 */

import { Type } from "@google/genai"
import { ai, generateTextQuality } from "./gemini-client"
import { getModel, hasFallback, getTemperature } from "./models"
import { isQualityUnavailable } from "../utils/retry"
import { judgeVision } from "./judge"

// Designer's quality ladder: [top Pro, GA Pro], never flash. Built once per call.
function designerLadder(): string[] {
    const models = [getModel("designer")]
    if (hasFallback("designer")) models.push(getModel("designer", "fallback"))
    return models
}
import { getBrandMemories } from "./memory-agent"
import type { ClientConfig } from "./configs/types"
import { buildPhotoFidelitySection } from "./photo-fidelity"
import { ARCHETYPE_GROUPS, type SlotIntent, type VisualMode } from "../lib/feed-pattern"
import type { CtaPolicy } from "./cta-policy"

// ============================================
// VISUAL MEMORY FORMATTER
// ============================================

/**
 * Load and format visual memories for Art Director injection.
 * Returns an empty string if no visual memories exist yet.
 */
export async function getVisualMemoriesSection(clientId?: string): Promise<string> {
    if (!clientId) {
        try {
            const { getActiveProject } = await import("./service")
            getActiveProject() // will throw if not set — safe to catch
        } catch {
            return ""
        }
    }

    // Typový filtr patří do dotazu, ne za něj: limit se aplikuje v SQL, takže
    // `getBrandMemories(5)` + `.filter(visual)` vracel prázdno, jakmile měl klient
    // 5 textových pamětí s vyšší confidence — a tahle sekce pak z promptu tiše zmizela.
    const visual = await getBrandMemories(5, clientId, undefined, undefined, ["visual"])

    if (visual.length === 0) return ""

    return `
## 💡 VISUAL MEMORY (co vizuálně fungovalo u této značky):
${visual.map(m => `- ${m.content} (confidence: ${(m.confidence * 100).toFixed(0)}%)`).join("\n")}
⚠️ Použij tyto vzorce jako inspiraci — nekopíruj doslova.
`
}

// ============================================
// (buildFeedAesthetic ODSTRANĚN — v8.7)
//
// Popisoval zrušený Satori overlay engine ("overlay covers the ENTIRE image at ~X
// opacity", "Text position: BOTTOM", "Aspect ratio: 1:1 square") a byl exportovaný,
// ale odnikud nevolaný. Brand kit dnes skládá generateDesignBrief níž; poměr stran
// řídí format-clamps.ts a rozhodně to není 1:1. Nevracet.
// ============================================
// AI DESIGNER — Native design engine
// (Nano Banana Pro renders the FULL post incl. Czech typography + logo;
//  this agent produces the structured design brief that drives it.)
// ============================================

/** Structural layout families the AI Designer rotates through — the enforced anti-repetition axis */
export const LAYOUT_ARCHETYPES = [
    "editorial-magazine",
    "poster-typography",
    "split-layout",
    "full-bleed-photo",
    "type-driven",
    "product-hero",
    "candid-lifestyle",
    "color-block-graphic",
] as const

export interface DesignBrief {
    /** Short creative concept name + 1-sentence idea — stored on the post for anti-repetition */
    concept: string
    /** One of LAYOUT_ARCHETYPES — recent archetypes are banned for the next post */
    layoutArchetype: string
    /** Full scene description in English: subject, environment, camera, lighting, depth */
    composition: string
    typography: {
        /** EXACT Czech hook text to render — copied verbatim, never paraphrased */
        headlineText: string
        /** EXACT Czech subtext (optional) */
        subtextText?: string
        /** e.g. "ultra-bold condensed sans, tight tracking, uppercase" */
        styleDescription: string
        /** e.g. "lower third, left-aligned, ~60% width" */
        placement: string
        /** Color/treatment incl. brand accent for key words */
        color: string
    }
    /** Palette + grading tied to brand colors */
    colorTreatment: string
    /** e.g. "top-right corner, ~12% width, subtle white version" */
    logoPlacement: string
    /** Where the image breathes so the text stays readable */
    negativeSpace: string
    /** Explicitly how this design differs from the recent briefs provided */
    divergenceNote: string
}

const DESIGN_BRIEF_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        concept: { type: Type.STRING },
        layoutArchetype: { type: Type.STRING, enum: [...LAYOUT_ARCHETYPES] },
        composition: { type: Type.STRING },
        typography: {
            type: Type.OBJECT,
            properties: {
                headlineText: { type: Type.STRING },
                subtextText: { type: Type.STRING },
                styleDescription: { type: Type.STRING },
                placement: { type: Type.STRING },
                color: { type: Type.STRING },
            },
            required: ["headlineText", "styleDescription", "placement", "color"],
        },
        colorTreatment: { type: Type.STRING },
        logoPlacement: { type: Type.STRING },
        negativeSpace: { type: Type.STRING },
        divergenceNote: { type: Type.STRING },
    },
    required: ["concept", "layoutArchetype", "composition", "typography", "colorTreatment", "logoPlacement", "negativeSpace", "divergenceNote"],
}

/** Product context for the AI Designer / native prompt — the post is built around a REAL item. */
export interface ProductBriefInfo {
    name: string
    type?: string
    description?: string
    /** true = an exact reference photo of this product is attached to the render call */
    hasReferencePhoto: boolean
}

/** User's own uploaded photo — the mandatory photographic base of this exact post. */
export interface UserPhotoBriefInfo {
    /** Vision-generated factual description of the photo (the designer is text-only and never sees it) */
    description?: string
}

/** Shared user-photo block for designer prompts (single image AND carousel cover).
 *  The designer never sees images, so the description is its only window into the photo. */
function buildUserPhotoSection(userPhoto?: UserPhotoBriefInfo, target: "post" | "cover" | "frame" = "post"): string {
    if (!userPhoto) return ""
    const noun = target === "cover" ? "COVER SLIDE" : target === "frame" ? "FIRST STORY FRAME" : "POST"
    const shortNoun = target === "cover" ? "cover" : target === "frame" ? "first frame" : "post"
    return `

## 📷 CLIENT'S OWN PHOTO — MANDATORY VISUAL BASE OF THIS ${noun}:
The client uploaded their OWN photo to be used in this exact ${shortNoun}. It is attached to the render call as a reference image labeled "CLIENT photo".
${userPhoto.description ? `What the photo shows: ${userPhoto.description}` : ""}
- Your composition MUST be built FROM this photo — describe how to use it whole as the base scene, or which part/crop of it to feature. NEVER invent a replacement scene.
- Creative freedom applies to grading, cropping, typography and graphic elements layered ON the photo — never to replacing its real content (people, place, subject stay as photographed).`
}

/** Shared product-fidelity block for designer prompts (single image AND carousel). */
function buildProductSection(product?: ProductBriefInfo): string {
    if (!product) return ""
    return `

## 🛍️ REAL PRODUCT — THE HERO OF THIS POST (mandatory):
This post sells the REAL product "${product.name}"${product.type ? ` (${product.type})` : ""}.
${product.description ? `Product: ${product.description}` : ""}
${product.hasReferencePhoto
    ? `An EXACT photo of this product is attached as a reference image labeled "EXACT product photo".
- The composition MUST feature THIS exact physical product as a clearly visible subject — worn by a person, flat lay, hanging, held — your choice of staging.
- The product's print/graphic, colors, cut and material must stay IDENTICAL to the reference photo. NEVER redesign, recolor, restyle or invent a different print.
- Creative freedom applies to everything AROUND the product (scene, model, lighting, mood, humor) — never to the product itself.`
    : `No reference photo is available — describe the product ONLY by its verified name/description above; do not invent visual details (print, colors) beyond them.`}`
}

/**
 * The feed-pattern slot directive. Tells the designer that this post occupies a specific cell
 * in a deliberate grid rhythm — WITHOUT cancelling the divergence rules above it: the pattern
 * fixes the family, divergence still varies everything inside it.
 */
function buildSlotIntentSection(slotIntent: SlotIntent | undefined, fa: ClientConfig["feedAesthetic"]): string {
    if (!slotIntent) return ""
    const modeBrief: Record<VisualMode, string> = {
        photo: "A PHOTOGRAPH-LED post. The photographic scene carries the whole frame; type is an overlay on it.",
        typography: "A TYPOGRAPHY-LED post. The words ARE the image — big, confident, designed type is the subject, not a caption sitting on a picture. A photo may support it or be absent entirely.",
        graphic: "A GRAPHIC post. Built from designed shapes, colour fields and type — a designed object, not a photograph with text on it.",
    }
    const accentLine = slotIntent.accent
        ? `\n⭐ This is an ACCENT cell in the rhythm: make the brand accent colour (${fa.accentColor || "the palette's boldest colour"}) the dominant treatment of the frame — it should read as a colour block from across the room.`
        : ""
    return `
## FEED PATTERN SLOT — ${slotIntent.visualMode.toUpperCase()}:
The brand's profile grid follows a deliberate rhythm, and this post occupies a "${slotIntent.visualMode}" cell.
${modeBrief[slotIntent.visualMode]}${accentLine}
⚠️ This constrains the FAMILY of layout, not the design itself: you must still diverge from the
recent posts above in composition, crop, scale, colour treatment and type handling. Same family,
different skeleton — two posts in the same family must never look like copies of each other.
`
}

/**
 * Composition rules. The default PHOTO-FIRST / NO-EMPTY-VOIDS rules exist to stop the model
 * defaulting to lazy text-on-a-dark-rectangle. But a typography or graphic slot is REQUIRED to
 * be type/shape-dominant — applying the photo rules there would forbid the very thing the slot
 * asks for, so those slots get their own rules against the same failure mode.
 */
function buildCompositionRules(slotIntent: SlotIntent | undefined): string {
    const mode = slotIntent?.visualMode
    if (mode === "typography") {
        return `- 🔤 TYPE IS THE SUBJECT: the headline must own the frame — huge, deliberate, expertly set.
  Treat it as a designed poster, not a photo with a caption.
- ⛔ NOT LAZY: a typographic poster is NOT text dumped on a flat dark rectangle. It needs real
  design — considered scale contrast, structure, texture/grain, colour fields, or a photographic
  element used as a graphic component. It must look designed by a human, never like a default slide.`
    }
    if (mode === "graphic") {
        return `- 🎨 DESIGNED OBJECT: build the frame from colour fields, shapes and type — a graphic composition
  with real structure (grid, geometry, layered forms), not a photo with a filter.
- ⛔ NOT LAZY: flat empty canvases are still forbidden. Colour blocking must be intentional and
  layered — texture, depth, overlap, tension. It must look art-directed, never like a blank slide.
- 📐 FILL THE FRAME: every region must be doing work — no large dead corner or empty half where
  the composition simply ran out. If a big area reads as leftover background rather than a
  deliberate rest, redesign it: extend a shape through it, crop tighter, or scale the type up.`
    }
    // photo slot, or no pattern at all — the original rules, unchanged.
    return `- 📸 PHOTO-FIRST: the image MUST be dominated by a real, rich photographic scene with a clear
  subject (people, products, places, action). The photo is the hero — NOT a backdrop.
- ⛔ NO EMPTY VOIDS: do NOT design large flat/solid color blocks, "deep charcoal voids", or
  mostly-empty dark canvases. Negative space for text = a CLEAN/DARKENED REGION OF THE PHOTO
  ITSELF (e.g. blurred or shadowed part of the scene), never a separate empty panel. Reserve at
  most ~one-third of the frame for text; the rest must show the photograph.`
}

export async function generateDesignBrief(params: {
    config: ClientConfig
    clientId: string
    captionData: { hook: string; imageSubtext?: string; imagePrompt?: string; body?: string; accentWords?: string[] }
    postType: string
    /** Style fingerprints of the last ~6 posts (concept | layout | text placement | color) — the designer must diverge from ALL of them */
    recentBriefs: string[]
    /** Layout archetypes used by the most recent posts — hard-banned for this one */
    bannedArchetypes?: string[]
    visualMemoriesSection?: string
    /** The real product this post is built around (uses_product formats) — drives fidelity rules */
    product?: ProductBriefInfo
    /** The client's own uploaded photo — the composition must be built from it */
    userPhoto?: UserPhotoBriefInfo
    /** This post's slot in the feed pattern — narrows the archetype set to the slot's family
     *  (see lib/feed-pattern.ts). Absent (or pattern "none") = full creative freedom. */
    slotIntent?: SlotIntent
    /** The format's creative brief (config.postTypeDefs) — what this post type IS and how
     *  it should LOOK. Without it the designer only ever saw the bare slug. */
    formatBrief?: { description?: string; visualStyle?: string }
}): Promise<DesignBrief> {
    const { config, clientId, captionData, postType, recentBriefs, slotIntent, formatBrief } = params
    const banned = (params.bannedArchetypes ?? []).filter(a => (LAYOUT_ARCHETYPES as readonly string[]).includes(a))
    // The feed pattern picks the FAMILY of layouts; the rotation ban still keeps this post off
    // the archetypes its neighbours just used, but only WITHIN that family. If the ban would
    // empty the family (typography only has two archetypes, so two typo posts in a row does
    // it), the pattern wins — a broken grid rhythm is more visible than a repeated archetype,
    // and the recentBriefs divergence rules still force a different composition.
    const patternGroup = slotIntent ? ARCHETYPE_GROUPS[slotIntent.visualMode] : null
    const archetypePool = (patternGroup ?? LAYOUT_ARCHETYPES) as readonly string[]
    const afterBan = archetypePool.filter(a => !banned.includes(a))
    const allowedArchetypes = afterBan.length > 0 ? afterBan : [...archetypePool]
    // Only the bans that actually bite: bans outside the slot's family are noise, and when the
    // ban was dropped to keep the pattern intact, listing it would contradict the allowed set.
    const effectiveBans = banned.filter(a => archetypePool.includes(a) && !allowedArchetypes.includes(a))
    const fa = config.feedAesthetic
    const memSection = params.visualMemoriesSection ?? await getVisualMemoriesSection(clientId)
    const fidelitySection = buildPhotoFidelitySection(config)

    const designerPrompt = `
You are a world-class Instagram art director designing a COMPLETE post visual.
The image model (Nano Banana Pro) will render the ENTIRE composition from your brief —
photo, typography AND logo — in one pass. Design like a human designer in Figma would.

## BRAND KIT:
- Color palette: ${fa.colorPalette}
- Brand accent color: ${fa.accentColor || "none — pick a tasteful accent from the palette"}
- Overall feel: ${fa.feel}
- Typography vibe: ${fa.typographyStyle || `inspired by ${fa.font} — but you may choose any typography style that fits the brand`}
- Logo placement preference: ${fa.logoPlacement && fa.logoPlacement !== "auto" ? fa.logoPlacement : "your choice — vary it between posts"}
${fa.customInstructions || ""}
${config.characterDescription ? `- Brand character: ${config.characterDescription}` : ""}
${memSection}

## THIS POST:
- Post type: ${postType}${formatBrief?.description ? ` — ${formatBrief.description}` : ""}
${formatBrief?.visualStyle ? `- Format visual style (the brand defined how this post type should LOOK — follow it): ${formatBrief.visualStyle}` : ""}
- Headline (Czech, render EXACTLY as written): "${captionData.hook}"
${captionData.imageSubtext ? `- Subtext (Czech, render EXACTLY as written): "${captionData.imageSubtext}"` : ""}
${captionData.accentWords?.length ? `- Accent words (highlight these within the headline): ${captionData.accentWords.join(", ")}` : ""}
${captionData.imagePrompt ? `- Copywriter's raw visual idea: "${captionData.imagePrompt}"` : ""}
${captionData.body ? `- Post body context: "${captionData.body.substring(0, 300)}"` : ""}
${buildProductSection(params.product)}${buildUserPhotoSection(params.userPhoto)}

## RECENT POST DESIGNS — YOU MUST DIVERGE FROM ALL OF THEM:
${recentBriefs.length ? recentBriefs.map((b, i) => `${i + 1}. ${b}`).join("\n") : "(no history yet — total creative freedom)"}
⚠️ HARD RULE: do NOT repeat the layout, text placement, typography style, or visual concept
of any recent design above. Same shit different day is FORBIDDEN.

${buildSlotIntentSection(slotIntent, fa)}
## LAYOUT ARCHETYPE (rotation is ENFORCED in code — violations get rejected):
Set layoutArchetype to ONE of: ${allowedArchetypes.join(", ")}.
${effectiveBans.length ? `🚫 FORBIDDEN for this post (used by the latest posts): ${effectiveBans.join(", ")}.` : ""}
The feed must stay ON-BRAND (same palette, mood, typography family) while each post
changes the STRUCTURE — layout, text scale/placement, photo vs. graphic balance.
Cohesive vibe, different skeleton.

## DESIGN RULES:
- typography.headlineText and typography.subtextText must be the EXACT Czech strings above,
  character-for-character including diacritics (ě š č ř ž ý á í é ů ú). NEVER translate or rephrase.
- Typography is a DESIGN ELEMENT — vary scale, weight, placement, alignment between posts.
${buildCompositionRules(slotIntent)}
- Logo: small, tasteful, never dominating. Vary corners/positions unless brand preference is fixed.
- Photography quality: editorial, cinematic lighting, real depth — no stock-photo vibes.
${fidelitySection}

Return ONLY the JSON design brief.`

    const raw = await generateTextQuality(designerPrompt, {
        models: designerLadder(),
        responseSchema: DESIGN_BRIEF_SCHEMA,
        temperature: getTemperature("designer"),
        label: "designer",
    })

    let brief = JSON.parse(raw) as DesignBrief
    if (!brief?.concept || !brief?.composition || !brief?.typography?.headlineText) {
        throw new Error("AI Designer returned incomplete design brief")
    }

    // Enforce the archetype rotation AND the feed-pattern slot — the prompt alone is not
    // enough, the model happily writes a new concept sentence on top of the same layout.
    // Checking membership of allowedArchetypes (rather than the ban list) covers both at once:
    // a pattern violation is as rejectable as a repeat, and when the ban was dropped to keep
    // the pattern intact, the "banned" archetype is legitimately allowed and must not trip this.
    if (brief.layoutArchetype && !allowedArchetypes.includes(brief.layoutArchetype)) {
        console.warn(`   ⚠️ Designer returned out-of-set archetype "${brief.layoutArchetype}"${slotIntent ? ` (slot: ${slotIntent.visualMode})` : ""} — regenerating`)
        const retryRaw = await generateTextQuality(
            designerPrompt + `\n\n⚠️ REJECTED: your previous brief used layoutArchetype "${brief.layoutArchetype}", which is NOT ALLOWED for this post. Produce a NEW brief with layoutArchetype strictly from: ${allowedArchetypes.join(", ")} — and a composition that actually matches it.`,
            { models: designerLadder(), responseSchema: DESIGN_BRIEF_SCHEMA, temperature: getTemperature("designer"), label: "designer-rearchetype" }
        )
        try {
            const retry = JSON.parse(retryRaw) as DesignBrief
            if (retry?.concept && retry?.composition && retry?.typography?.headlineText) {
                brief = retry
            }
        } catch {
            // keep the original brief — a repeated archetype beats a failed generation
        }
    }

    // Verbatim typography guard — enforced in code, never trusted to the model. The brief's
    // strings ARE the render prompt; when the designer paraphrases or drops diacritics here
    // (observed 2026-07-07: subtextText "Zase jen dalsi fotka s cinkou?"), the fresh-regen
    // retry reuses the poisoned prompt, so no retry can ever render the right text. QA
    // compares against captionData — aligning the prompt to the same source makes
    // "rendered text == expected text" achievable by construction.
    if (brief.typography.headlineText !== captionData.hook) {
        console.warn(`   ⚠️ Designer paraphrased headlineText — restoring verbatim hook`)
        brief.typography.headlineText = captionData.hook
    }
    const expectedSubtext = captionData.imageSubtext || undefined
    if ((brief.typography.subtextText || undefined) !== expectedSubtext) {
        console.warn(`   ⚠️ Designer altered subtextText — enforcing verbatim copy`)
        brief.typography.subtextText = expectedSubtext
    }
    return brief
}

/**
 * Convert a DesignBrief into the final Nano Banana Pro image prompt.
 */
export function buildNativeImagePrompt(
    brief: DesignBrief,
    config: ClientConfig,
    product?: ProductBriefInfo,
    userPhoto?: UserPhotoBriefInfo,
    /** One extra string the render is ALLOWED to draw beyond the brief's typography —
     *  today only the carousel's "N/M" slide indicator. Without this the same prompt said
     *  "do not add any other text anywhere" and then, appended by the carousel orchestrator,
     *  "render a small 1/5 indicator" — a contradiction the model could only lose, and one
     *  QA then flagged as unwanted extra text, burning the carousel-wide edit budget. */
    allowedExtraText?: string,
    /** Značka má přiloženou referenci konkrétního člověka (štítek `person`).
     *  Zapíná blok o věrnosti tváři a o fotografickém realismu.
     *  POSLEDNÍ parametr schválně — carousel i story předávají allowedExtraText
     *  pozičně, takže vsunutí před něj by jim navázalo indikátor slajdu sem. */
    hasPersonPhoto?: boolean,
): string {
    const t = brief.typography
    const hasLogo = Boolean(config.logoFile)

    const productBlock = product?.hasReferencePhoto ? `

## PRODUCT FIDELITY (highest priority — overrides creative interpretation):
The attached reference image labeled "EXACT product photo: ${product.name}" shows the REAL product this post sells.
- Reproduce this product 100% faithfully: identical print/graphic, identical colors, identical cut and material.
- The product must be clearly visible and recognizable in the final image.
- Do NOT redesign, recolor, simplify or reinterpret any part of the product. Style the SCENE around it, never the product itself.` : ""

    const userPhotoBlock = userPhoto ? `

## CLIENT PHOTO FIDELITY (highest priority — overrides creative interpretation):
The attached reference image labeled "CLIENT photo" is the client's REAL photo and MUST be the photographic base of this post.
- Build the final image FROM this photo: use it whole, or a deliberate crop/part of it, as the dominant visual.
- Keep its real content faithful — the people, place, subject and details stay as photographed. Do NOT replace the scene with an invented one.
- Allowed: color grading to match the brand, cropping/reframing, extending the background, and compositing the typography/logo over it.
- Forbidden: redrawing the photo as an illustration, swapping its subject, or using it only as loose style inspiration.` : ""

    // Tvář značky. Vlastní blok, ne odstavec v QUALITY: obličej je to jediné, u čeho
    // divák AI pozná okamžitě — vygumovaná kůže, souměrné rysy, skleněné oči. A model
    // má vestavěný sklon člověka „vylepšit", což je přesně to, co ho prozradí.
    const personBlock = hasPersonPhoto ? `

## REAL PERSON FIDELITY (highest priority — overrides creative interpretation):
An attached reference labeled "REAL PERSON" is a photograph of the actual human who represents this brand.
- If this post's composition includes a person representing the brand, it MUST be THIS person: same facial structure, features, hair, skin tone and age. Portrait reference, never style inspiration.
- Do NOT beautify, slim, de-age, symmetrise or otherwise "improve" them. Keep asymmetry, skin texture, pores, fine lines, stray hairs — that imperfection is what makes a photograph read as real.
- Photographic realism is mandatory: skin with visible texture and natural subsurface variation, no waxy or plastic sheen, no airbrushed smoothing, no artificial glow, real catchlights in the eyes, anatomically correct hands and fingers.
- Light must behave like real light: one dominant source, consistent shadow direction and falloff, natural colour temperature. No impossible rim-light halos.
- If the face cannot be rendered convincingly at this size or angle, reframe so the face is not the subject (hands, back, over-shoulder, mid-distance, cropped at the chin) — that is ALWAYS better than inventing a different face.
- If the composition contains no person at all, ignore this reference entirely; do not add a person just because the photo is attached.` : ""

    return `Design a complete, finished Instagram post image — a professional brand visual with typography composited into the design (like a finished poster from a top design studio).

## SCENE / COMPOSITION:
${brief.composition}
${productBlock}${userPhotoBlock}${personBlock}

## NEGATIVE SPACE:
${brief.negativeSpace}

## TYPOGRAPHY (render INSIDE the image):
- Headline text — render this EXACT Czech text, character-for-character, including all diacritics (ě š č ř ž ý á í é ů ú): "${t.headlineText}"
${t.subtextText ? `- Subtext — render this EXACT Czech text verbatim: "${t.subtextText}"` : ""}
- Type style: ${t.styleDescription}
- Placement: ${t.placement}
- Color treatment: ${t.color}
⚠️ The Czech text must be reproduced with PERFECT spelling — every háček and čárka exactly as written. Do not add any other text, words, watermarks or labels anywhere in the image${allowedExtraText ? `, with ONE exception: a small, subtle "${allowedExtraText}" indicator styled to match the design system` : ""}.

## COLOR / GRADING:
${brief.colorTreatment}

${hasLogo ? `## LOGO:
Reproduce the attached brand logo image faithfully (exact shapes and colors, no redrawing) at: ${brief.logoPlacement}. Keep it small and subtle.` : ""}

## QUALITY:
Editorial photography quality, cinematic lighting, real depth of field. The final result must look like a finished, art-directed brand post — not a photo with text slapped on it.`
}

/**
 * One designer call for a whole carousel: a shared design system
 * (typography / palette / logo treatment stay constant, only framing varies)
 * + one DesignBrief per slide — the native carousel design agent.
 */
export async function generateCarouselDesignBriefs(params: {
    config: ClientConfig
    clientId: string
    allSlides: { headline: string; subtext: string; imagePrompt: string }[]
    visualTheme: string
    postType: string
    recentBriefs: string[]
    bannedArchetypes?: string[]
    accentWords?: string[]
    /** The real product this carousel is built around (uses_product formats) — drives fidelity rules */
    product?: ProductBriefInfo
    /** The client's own uploaded photo — the COVER must be built from it */
    userPhoto?: UserPhotoBriefInfo
    /** Feed-pattern slot for the COVER — the cover is the cell that shows up in the grid. */
    slotIntent?: SlotIntent
    /** The format's creative brief (config.postTypeDefs) — see generateDesignBrief. */
    formatBrief?: { description?: string; visualStyle?: string }
}): Promise<{ designSystem: string; briefs: DesignBrief[] }> {
    const { config, clientId, allSlides, visualTheme, postType, recentBriefs, slotIntent, formatBrief } = params
    const banned = (params.bannedArchetypes ?? []).filter(a => (LAYOUT_ARCHETYPES as readonly string[]).includes(a))
    // Same family/ban resolution as the single-image designer (see generateDesignBrief). One
    // archetype covers the whole carousel, and it's the cover that lands in the profile grid.
    const patternGroup = slotIntent ? ARCHETYPE_GROUPS[slotIntent.visualMode] : null
    const archetypePool = (patternGroup ?? LAYOUT_ARCHETYPES) as readonly string[]
    const afterBan = archetypePool.filter(a => !banned.includes(a))
    const allowedArchetypes = afterBan.length > 0 ? afterBan : [...archetypePool]
    const fa = config.feedAesthetic
    const memSection = await getVisualMemoriesSection(clientId)

    const slideSummary = allSlides.map((s, i) =>
        `Slide ${i === 0 ? "COVER" : String(i)}: headline="${s.headline}", subtext="${s.subtext}", visual idea="${s.imagePrompt}"`
    ).join("\n")

    const prompt = `
You are a world-class Instagram art director designing a COMPLETE carousel (${allSlides.length} slides).
The image model (Nano Banana Pro) renders each slide ENTIRELY from your briefs — photo, Czech typography AND logo.

## BRAND KIT:
- Color palette: ${fa.colorPalette}
- Brand accent color: ${fa.accentColor || "pick a tasteful accent from the palette"}
- Overall feel: ${fa.feel}
- Typography vibe: ${fa.typographyStyle || `inspired by ${fa.font}`}
${fa.customInstructions || ""}
${memSection}

## CAROUSEL:
Visual theme: "${visualTheme}"
Post type: ${postType}${formatBrief?.description ? ` — ${formatBrief.description}` : ""}
${formatBrief?.visualStyle ? `Format visual style (the brand defined how this post type should LOOK — follow it): ${formatBrief.visualStyle}` : ""}
${slideSummary}
${params.accentWords?.length ? `Accent words (highlight these within the COVER headline, same as a single-image post): ${params.accentWords.join(", ")}` : ""}
${buildProductSection(params.product)}${buildUserPhotoSection(params.userPhoto, "cover")}

## RECENT POST DESIGNS — THE CAROUSEL MUST DIVERGE FROM ALL OF THEM:
${recentBriefs.length ? recentBriefs.map((b, i) => `${i + 1}. ${b}`).join("\n") : "(no history yet)"}
${buildSlotIntentSection(slotIntent, fa)}
## RULES:
1. First define ONE design system: same typography style, same palette/grading, same logo treatment
   across ALL slides — the carousel must feel like one cohesive editorial piece.
2. Same environment/lighting across slides; ONLY camera angle and framing changes (wide → medium → close-up).
3. Each slide's typography.headlineText / subtextText must be the EXACT Czech strings above,
   character-for-character including diacritics (ě š č ř ž ý á í é ů ú). NEVER translate or rephrase.
4. The COVER has the boldest typography; inner slides are calmer and consistent.
5. Diverge hard from the recent designs (layout, type placement, concept).
6. Set ONE layoutArchetype for the whole carousel (same value on every brief), chosen from:
   ${allowedArchetypes.join(", ")}.${banned.filter(a => archetypePool.includes(a) && !allowedArchetypes.includes(a)).length ? `\n   🚫 FORBIDDEN (used by the latest posts): ${banned.filter(a => archetypePool.includes(a) && !allowedArchetypes.includes(a)).join(", ")}.` : ""}
   Stay on-brand (palette, mood, type family) — change the STRUCTURE, not the brand.

Return JSON: { "designSystem": "one paragraph describing the shared system", "briefs": [one design brief per slide, in order] }`

    const raw = await generateTextQuality(prompt, {
        models: designerLadder(),
        responseSchema: {
            type: Type.OBJECT,
            properties: {
                designSystem: { type: Type.STRING },
                briefs: { type: Type.ARRAY, items: DESIGN_BRIEF_SCHEMA },
            },
            required: ["designSystem", "briefs"],
        },
        temperature: getTemperature("designer"),
        label: "carousel-designer",
    })

    const parsed = JSON.parse(raw) as { designSystem: string; briefs: DesignBrief[] }
    if (!parsed?.designSystem || !Array.isArray(parsed.briefs) || parsed.briefs.length !== allSlides.length) {
        throw new Error(`Carousel designer returned ${parsed?.briefs?.length ?? 0} briefs, expected ${allSlides.length}`)
    }

    // Same verbatim typography guard as generateDesignBrief, per slide — the briefs drive
    // every slide's render prompt while QA expects allSlides' strings; enforcing equality
    // in code closes that loop deterministically.
    parsed.briefs.forEach((b, i) => {
        const slide = allSlides[i]
        if (b.typography.headlineText !== slide.headline) {
            console.warn(`   ⚠️ Slide ${i}: designer paraphrased headline — restoring verbatim`)
            b.typography.headlineText = slide.headline
        }
        const expectedSub = slide.subtext || undefined
        if ((b.typography.subtextText || undefined) !== expectedSub) {
            b.typography.subtextText = expectedSub
        }
    })
    return parsed
}

/**
 * Instagram's own UI covers the top and bottom of a story: the profile row and close
 * button up top, the reply bar and share row at the bottom. Anything placed there is
 * invisible to the viewer — and unlike a feed crop, the author never sees it happen.
 *
 * Expressed in PERCENTAGES so it survives any render resolution. Injected in three
 * places, and all three matter: the designer prompt (so the placement is AUTHORED
 * inside the band), every frame's render prompt, and QA (so the ship-best ladder can
 * actually correct it — `editExistingImage` is very good at "move this text up").
 */
export const STORY_SAFE_ZONE_RULE = `## STORY LAYOUT — TWO HARD CONSTRAINTS:

### 1. NEVER DRAW INSTAGRAM'S INTERFACE
This artwork is the story CONTENT. Instagram draws its own interface on top of it at
display time. You must NOT render any of it: no reply/message input bar, no "Reply"
or "Send message" pill, no heart / send / share / camera icons, no profile avatar or
username row, no close (X) button, no segment progress bars, no "swipe up" chevron,
no phone status bar (clock, battery, signal). Any of these appearing IN the artwork is
a hard failure — the published story would show two overlapping interfaces.

### 2. KEEP TEXT AND LOGO IN THE MIDDLE 70% OF THE HEIGHT
- The FIRST line of typography must START no higher than 18% down the frame, and the
  LAST line must END no lower than 82%. The logo obeys the same bounds.
- Think of it as a wide horizontal band across the middle of the frame: text lives
  inside that band, nothing else does. Do not top-align or bottom-align the type block.
- Photography, gradients and colour fields SHOULD still run full-bleed to all four
  edges — only TEXT and the LOGO are constrained.
- Keep 8% side margins on text as well; stories are watched on phones, often in cases.`

/**
 * Design a complete story set — ONE designer call, one shared design system.
 *
 * Deliberately not `generateCarouselDesignBriefs`: that prompt hardcodes carousel
 * semantics that are actively wrong here ("the COVER has the boldest typography",
 * "same environment across slides, only the camera angle changes") and the carousel
 * orchestrator stamps an "N/M" slide indicator on every render. A story set has no
 * cover/inner asymmetry, each frame may cut to a new scene, and it must never carry
 * a page counter.
 *
 * Also not three independent `generateDesignBrief` calls: a story is tapped through
 * as one continuous piece, so it is MORE cohesion-sensitive than a carousel, not less.
 */
export async function generateStoryDesignBriefs(params: {
    config: ClientConfig
    clientId: string
    frames: { headline: string; subtext: string; imagePrompt: string }[]
    postType: string
    recentBriefs: string[]
    bannedArchetypes?: string[]
    /** The real product this story is built around (uses_product formats). */
    product?: ProductBriefInfo
    /** The client's own uploaded photo — frame 1 must be built from it. */
    userPhoto?: UserPhotoBriefInfo
    /** The format's creative brief (config.postTypeDefs) — see generateDesignBrief. */
    formatBrief?: { description?: string; visualStyle?: string }
}): Promise<{ designSystem: string; briefs: DesignBrief[] }> {
    const { config, clientId, frames, postType, recentBriefs, formatBrief } = params
    const banned = (params.bannedArchetypes ?? []).filter(a => (LAYOUT_ARCHETYPES as readonly string[]).includes(a))
    // No slotIntent: a story never occupies a cell in the profile grid, so the feed
    // pattern has no say here — the designer gets the full archetype pool minus bans.
    const afterBan = (LAYOUT_ARCHETYPES as readonly string[]).filter(a => !banned.includes(a))
    const allowedArchetypes = afterBan.length > 0 ? afterBan : [...LAYOUT_ARCHETYPES]
    const fa = config.feedAesthetic
    const memSection = await getVisualMemoriesSection(clientId)

    const frameSummary = frames.map((f, i) =>
        `Frame ${i + 1}${i === 0 ? " (HOOK)" : i === frames.length - 1 ? " (CTA)" : ""}: headline="${f.headline}", subtext="${f.subtext}", visual idea="${f.imagePrompt}"`
    ).join("\n")

    const prompt = `
You are a world-class Instagram art director designing a COMPLETE story set (${frames.length} vertical frame${frames.length > 1 ? "s" : ""}).
The image model (Nano Banana Pro) renders each frame ENTIRELY from your briefs — photo, Czech typography AND logo.
Format: 9:16 vertical, full screen on a phone, seen for under 2 seconds each.

## BRAND KIT:
- Color palette: ${fa.colorPalette}
- Brand accent color: ${fa.accentColor || "pick a tasteful accent from the palette"}
- Overall feel: ${fa.feel}
- Typography vibe: ${fa.typographyStyle || `inspired by ${fa.font}`}
${fa.customInstructions || ""}
${memSection}

## STORY SET:
Post type: ${postType}${formatBrief?.description ? ` — ${formatBrief.description}` : ""}
${formatBrief?.visualStyle ? `Format visual style (the brand defined how this post type should LOOK — follow it): ${formatBrief.visualStyle}` : ""}
${frameSummary}
${buildProductSection(params.product)}${buildUserPhotoSection(params.userPhoto, "frame")}

## RECENT POST DESIGNS — THE STORY MUST DIVERGE FROM ALL OF THEM:
${recentBriefs.length ? recentBriefs.map((b, i) => `${i + 1}. ${b}`).join("\n") : "(no history yet)"}

${STORY_SAFE_ZONE_RULE}

## RULES:
1. First define ONE design system: same typography style, same palette/grading, same logo
   treatment across ALL frames — the set must read as one continuous piece when tapped through.
2. Unlike a carousel, each frame MAY cut to a different scene or subject — a story is a
   sequence of moments, not one shoot from three angles. Keep the SYSTEM constant, not the set.
3. Each frame's typography.headlineText / subtextText must be the EXACT Czech strings above,
   character-for-character including diacritics (ě š č ř ž ý á í é ů ú). NEVER translate or rephrase.
4. Type must be noticeably LARGER than on a feed post — a story is read at arm's length, in
   daylight, in under 2 seconds. Headline ≥ 7% of frame height.
5. Frame 1 is the hook and carries the boldest type. The LAST frame carries the CTA and must
   have obvious visual finality (a closing gesture, not a cliffhanger).
6. NO slide indicators, NO page counters, NO "swipe" arrows — this is not a carousel.
7. Diverge hard from the recent designs (layout, type placement, concept).
8. Set ONE layoutArchetype for the whole set (same value on every brief), chosen from:
   ${allowedArchetypes.join(", ")}.${banned.filter(a => !allowedArchetypes.includes(a)).length ? `\n   🚫 FORBIDDEN (used by the latest posts): ${banned.filter(a => !allowedArchetypes.includes(a)).join(", ")}.` : ""}
   Stay on-brand (palette, mood, type family) — change the STRUCTURE, not the brand.

Return JSON: { "designSystem": "one paragraph describing the shared system", "briefs": [one design brief per frame, in order] }`

    const raw = await generateTextQuality(prompt, {
        models: designerLadder(),
        responseSchema: {
            type: Type.OBJECT,
            properties: {
                designSystem: { type: Type.STRING },
                briefs: { type: Type.ARRAY, items: DESIGN_BRIEF_SCHEMA },
            },
            required: ["designSystem", "briefs"],
        },
        temperature: getTemperature("designer"),
        label: "story-designer",
    })

    const parsed = JSON.parse(raw) as { designSystem: string; briefs: DesignBrief[] }
    if (!parsed?.designSystem || !Array.isArray(parsed.briefs) || parsed.briefs.length !== frames.length) {
        throw new Error(`Story designer returned ${parsed?.briefs?.length ?? 0} briefs, expected ${frames.length}`)
    }

    // Verbatim typography guard — identical doctrine to generateDesignBrief and the
    // carousel designer: the briefs drive each render prompt while QA expects the
    // copywriter's strings, so equality is enforced in code, not hoped for.
    parsed.briefs.forEach((b, i) => {
        const frame = frames[i]
        if (b.typography.headlineText !== frame.headline) {
            console.warn(`   ⚠️ Frame ${i + 1}: designer paraphrased headline — restoring verbatim`)
            b.typography.headlineText = frame.headline
        }
        const expectedSub = frame.subtext || undefined
        if ((b.typography.subtextText || undefined) !== expectedSub) {
            b.typography.subtextText = expectedSub
        }
    })
    return parsed
}

// ============================================
// USER-DRIVEN EDIT — targeted retouch, never a re-design
// ============================================

/** Normalized selection box on the image, origin top-left, all values 0..1. */
export interface EditRegion {
    x: number
    y: number
    w: number
    h: number
}

/** Coarse human name for where a box sits — models follow "the upper-right area"
 *  far more reliably than bare percentages, so we give them both. */
function regionName(r: EditRegion): string {
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    // A selection covering most of the frame isn't a location, it's the whole picture
    if (r.w >= 0.8 && r.h >= 0.8) return "almost the entire frame"
    const vertical = cy < 0.34 ? "upper" : cy > 0.66 ? "lower" : "middle"
    const horizontal = cx < 0.34 ? "left" : cx > 0.66 ? "right" : "centre"
    if (vertical === "middle" && horizontal === "centre") return "the centre of the frame"
    if (vertical === "middle") return `the ${horizontal} side, vertically centred`
    if (horizontal === "centre") return `the ${vertical} centre`
    return `the ${vertical}-${horizontal} area`
}

const pct = (v: number) => `${Math.round(clamp01(v) * 100)}%`
function clamp01(v: number): number {
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0
}

/** Clamp a raw selection into the frame and drop degenerate (zero-area) boxes. */
export function normalizeEditRegion(r?: Partial<EditRegion> | null): EditRegion | undefined {
    if (!r || r.x == null || r.y == null || r.w == null || r.h == null) return undefined
    // Reject non-finite coordinates outright rather than letting clamp01 turn them into
    // zeros — that would quietly aim the edit at the top-left corner instead of telling
    // the caller there is no usable selection.
    if (![r.x, r.y, r.w, r.h].every(v => Number.isFinite(v))) return undefined
    const x = clamp01(r.x)
    const y = clamp01(r.y)
    const w = clamp01(Math.min(r.w, 1 - x))
    const h = clamp01(Math.min(r.h, 1 - y))
    if (w < 0.01 || h < 0.01) return undefined
    return { x, y, w, h }
}

/**
 * Prompt for editing a FINISHED post image on the user's instruction.
 *
 * Deliberately shaped like editPrintDesign's edit (instruction first, preservation
 * clause second) rather than like a design brief. The whole point of this path is
 * that the user said "move the headline up" and got a completely different photo,
 * layout and concept back — because revisePost re-ran generateDesignBrief. Nothing
 * here may invite a new design; the words "create", "design" and "generate" are
 * kept out on purpose, and the preservation clause is unconditional.
 *
 * Pure function — tested by scripts/test-post-edit-prompt.ts.
 */
export function buildPostEditPrompt(p: {
    /** What the user wants changed, verbatim (Czech is fine — the model is multilingual) */
    instruction: string
    /** Optional "don't touch" list from the user */
    preserve?: string
    /** Optional marked area; when absent the instruction applies to the whole frame */
    region?: EditRegion
    /** Headline burnt into the image — must survive an edit character-for-character */
    hook?: string
}): string {
    const blocks: string[] = [
        `Apply this change to the image: ${p.instruction.trim()}`,
    ]

    const region = normalizeEditRegion(p.region)
    if (region) {
        blocks.push(
            `APPLY THE CHANGE ONLY inside this region of the frame: horizontally from ` +
            `${pct(region.x)} to ${pct(region.x + region.w)}, vertically from ${pct(region.y)} ` +
            `to ${pct(region.y + region.h)}, measured from the top-left corner — ` +
            `${regionName(region)}.\n` +
            `Everything outside that region must stay pixel-identical to the input image.`
        )
    }

    if (p.preserve?.trim()) {
        blocks.push(`KEEP UNCHANGED — the user explicitly asked you not to touch this: ${p.preserve.trim()}`)
    }

    blocks.push(
        `Keep the composition, framing, photo, colors, typography style, logo and layout ` +
        `EXACTLY the same. This is a targeted retouch of an existing finished design, ` +
        `not a new design. Do not re-photograph, re-stage or re-compose the scene. ` +
        `Do not swap the subject, the background or the color palette.`
    )

    blocks.push(
        p.hook?.trim()
            ? `All Czech text must keep its exact spelling and diacritics. The headline must read ` +
              `character-for-character: "${p.hook.trim()}"${/nadpis|headline|titul|text/i.test(p.instruction) ? " — unless the change above explicitly rewords it." : "."}`
            : `All Czech text must keep its exact spelling and diacritics.`
    )

    return blocks.join("\n\n")
}

// ============================================
// NATIVE IMAGE QA — vision verification
// ============================================

export interface NativeImageQA {
    ok: boolean
    /** rendered text == expected, diacritics included */
    textAccurate: boolean
    /** what the model actually reads in the image */
    renderedText?: string
    logoPresent: boolean
    /** false ONLY when a product reference was provided and the rendered product doesn't match it */
    productAccurate?: boolean
    /** false ONLY when a client photo was provided and the render is not visibly built from it */
    photoUsed?: boolean
    issues: string[]
    /** corrective instruction for the retry edit */
    fixHint?: string
    /** How bad the failure is (absent/"ok" when qa.ok is true). "cosmetic" = a minor slip
     *  (e.g. one missing diacritic) that's still fully legible — shippable as a last resort.
     *  "severe" = overlapping/duplicated/garbled/unreadable text or a wrong logo — must not
     *  ship silently; the orchestrator spends one more bounded attempt on these. */
    severity?: "ok" | "cosmetic" | "severe"
}

/** QA badness score — lower is better. A wrong product or an ignored client photo is the
 *  worst outcome; a severe rendering failure (garbled/unreadable text) outweighs a merely
 *  cosmetic one. Lets the orchestrators pick the best native attempt when none passes
 *  cleanly (ship-best-native: we never drop to a Satori overlay). */
export function qaScore(qa: NativeImageQA): number {
    if (qa.ok) return 0
    return (qa.productAccurate === false ? 100 : 0)
        + (qa.photoUsed === false ? 100 : 0)
        + (qa.severity === "severe" ? 50 : 0)
        + (qa.issues?.length || 1)
}

/**
 * Verify a natively-designed image: exact Czech text + logo presence, and — when a
 * product reference photo is provided — that the rendered product matches it
 * (print, colors, cut). Fail-open: a QA infrastructure error never blocks generation.
 */
export async function verifyNativeImage(
    imageBuffer: Buffer,
    expected: {
        headline: string
        subtext?: string
        logoExpected: boolean
        /** Story frames only — also verify nothing sits under Instagram's own UI bands.
         *  Graded "cosmetic": the text is legible, just misplaced, and a corrective
         *  edit fixes it. "severe" stays reserved for garbled/unreadable typography. */
        safeZone?: boolean
        /** Text the render was explicitly asked to draw on TOP of the brief's typography
         *  (carousel "N/M"). QA must not report it as unwanted extra text — that failure
         *  is free, unfixable by an edit, and spends the shared correction budget. */
        allowedExtraText?: string
    },
    /** mode "require" (default): the product must appear AND match. Mode "if-present"
     *  (carousel slides): a slide may legitimately not show the product, but a
     *  different/invented product design is a FAIL. */
    productRef?: { buffer: Buffer; mimeType?: string; name: string; mode?: "require" | "if-present" },
    /** the client's own uploaded photo — the render must be visibly built from it */
    userPhotoRef?: { buffer: Buffer; mimeType?: string },
): Promise<NativeImageQA> {
    const productCheck = productRef ? `
PRODUCT FIDELITY: The second attached image is the REAL product photo of "${productRef.name}".
${productRef.mode === "if-present"
    ? `IF the generated image depicts this product (or anything resembling it — a t-shirt, garment, item of the same kind), it must be THIS exact product: identical print/graphic, identical colors, identical cut. A stylized, recolored, redesigned or invented product design is a FAIL (productAccurate=false). If no such product appears in the image at all, that is acceptable (productAccurate=true).`
    : `The generated post (first image) MUST show THIS exact product: identical print/graphic, identical colors, identical cut. A stylized, recolored, redesigned or invented product is a FAIL — and so is a post where the product is completely absent.`}` : ""

    const userPhotoCheck = userPhotoRef ? `
CLIENT PHOTO USAGE: The LAST attached image is the client's own photo that the post MUST be visibly built from.
The generated post (first image) must use this photo — whole or a recognizable crop/part of it — as its photographic base. Color grading, reframing, background extension and text/logo composited over it are all fine. A completely different or invented scene that merely resembles the photo's style is a FAIL (photoUsed=false).` : ""

    const safeZoneCheck = expected.safeZone ? `
STORY FRAME CHECKS (this is a 9:16 Instagram STORY, not a feed post):
(a) FAKE INTERFACE — does the image contain any drawn Instagram UI: a reply/message input
bar or pill, heart / send / share / camera icons, a profile avatar or username row, a close
(X) button, segment progress bars, a "swipe up" chevron, or a phone status bar (clock,
battery, signal)? Instagram draws its real interface on top at display time, so any of this
inside the artwork means the published story shows TWO overlapping interfaces. This is a
"severe" FAIL — report it in issues and set ok=false.
(b) SAFE ZONE — do ALL text and the logo sit between 15% and 85% of the frame HEIGHT?
Instagram's own chrome covers those bands, so anything there is invisible. Photography may
run to the edges; text and the logo may not. Grade a safe-zone miss as "cosmetic" (the text
is legible, just misplaced) unless (a) also fired.` : ""

    const qaPrompt = `You are a strict QA inspector for AI-designed Instagram posts in CZECH.

Expected headline text (must match EXACTLY, including Czech diacritics ě š č ř ž ý á í é ů ú):
"${expected.headline}"
${expected.subtext ? `Expected subtext (must match EXACTLY):\n"${expected.subtext}"` : ""}
${expected.logoExpected ? "A brand logo MUST be present somewhere in the image." : ""}
${expected.allowedExtraText ? `A small "${expected.allowedExtraText}" indicator is EXPECTED in this image (it was requested on purpose). Do NOT report it as unwanted or extra text.` : ""}
${productCheck}
${userPhotoCheck}
${safeZoneCheck}

Check:
1. Read ALL text rendered in the first image. Does the headline match the expected text character-for-character? Watch for: missing/wrong diacritics, swapped letters, duplicated words, gibberish, extra unwanted text${expected.allowedExtraText ? ` (the "${expected.allowedExtraText}" indicator does NOT count as unwanted)` : ""}.
${expected.subtext ? "2. Does the subtext match exactly?" : ""}
${expected.logoExpected ? "3. Is the brand logo present and not deformed?" : ""}
4. Is all text clearly readable (contrast, not cut off at edges)?
${productRef ? `5. Does the product in the first image faithfully match the reference product photo (second image)? Compare the print/graphic, colors and cut.` : ""}
${userPhotoRef ? `6. Is the first image visibly built from the client's photo (the LAST attached image) — same real scene/subject, possibly regraded/cropped/extended?` : ""}
${expected.safeZone ? `7. Run BOTH story frame checks above: (a) no drawn Instagram interface anywhere in the image, (b) all text and the logo between 15% and 85% of the frame height.` : ""}

If NOT ok, also grade how bad it is:
- "cosmetic" — a minor slip (e.g. one missing/wrong diacritic) but every word is still fully legible and correctly identifiable.
- "severe" — overlapping or duplicated text, gibberish, unreadable letters, or a deformed/wrong logo. A human could not confidently read the intended words.

Return ONLY valid JSON:
{
  "ok": true/false,
  "textAccurate": true/false,
  "renderedText": "the text you actually read in the image",
  "logoPresent": true/false,
  ${productRef ? `"productAccurate": true/false,\n  ` : ""}${userPhotoRef ? `"photoUsed": true/false,\n  ` : ""}"issues": ["specific problems, empty if ok"],
  "severity": "ok" | "cosmetic" | "severe",
  "fixHint": "if NOT ok — one concrete instruction for an image-edit model to fix it (e.g. 'correct the headline to ... keeping the same style and position') — empty string if ok"
}`

    // Quality ladder: Pro QA judge → GA Pro, each retried hard on transient. If BOTH
    // Pro tiers are exhausted, QA fails OPEN (skipped) — never flash-judges. Skipping QA
    // beats blocking a render or trusting a weaker model's verdict on Czech typography.
    const images = [{ buffer: imageBuffer, mimeType: "image/png" }]
    if (productRef) images.push({ buffer: productRef.buffer, mimeType: productRef.mimeType || "image/jpeg" })
    if (userPhotoRef) images.push({ buffer: userPhotoRef.buffer, mimeType: userPhotoRef.mimeType || "image/jpeg" })

    // Cross-family: Claude Sonnet 5 judges Gemini's own render when enabled (closes the
    // self-preference gap — Gemini grading Gemini's typography is the same bias the text
    // judge was built to avoid), else the Gemini Pro QA ladder → GA Pro fallback → fail
    // open. A Pro 503 must never silently skip QA — degrade to GA Pro before giving up.
    let text: string
    try {
        text = await judgeVision(qaPrompt, images, { label: "vision-qa" })
    } catch (err: any) {
        if (isQualityUnavailable(err)) {
            console.warn("   ⚠️ Native image QA: both Pro tiers exhausted — fail-open (QA skipped)")
        } else {
            console.warn(`   ⚠️ Native image QA failed (fail-open): ${String(err?.message || err).substring(0, 80)}`)
        }
        return { ok: true, textAccurate: true, logoPresent: true, issues: [] }
    }

    try {
        const parsed = JSON.parse(text.replace(/```(?:json)?/g, "").trim())
        return {
            ok: !!parsed.ok,
            textAccurate: !!parsed.textAccurate,
            renderedText: parsed.renderedText || undefined,
            logoPresent: !!parsed.logoPresent,
            productAccurate: productRef ? parsed.productAccurate !== false : undefined,
            photoUsed: userPhotoRef ? parsed.photoUsed !== false : undefined,
            issues: parsed.issues || [],
            severity: parsed.ok ? "ok" : (parsed.severity === "severe" ? "severe" : "cosmetic"),
            fixHint: parsed.fixHint || undefined,
        }
    } catch {
        return { ok: true, textAccurate: true, logoPresent: true, issues: [] }
    }
}

// ============================================
// VIDEO PROMPT REFINEMENT
// ============================================

interface VideoScene {
    timeRange: string
    visual: string
    camera: string
    mood: string
    narration?: string
    soundEffect?: string
}

/**
 * Turn the copywriter's structured scenes into ONE Veo prompt.
 *
 * This is the only creative step between the copywriter and the video, so it runs on
 * the same Pro ladder as every other creative stage (it used the flash `text` tier via
 * a raw `generateContent` call, i.e. no hard retry, no fallback, no
 * QualityUnavailableError). It also honours the post's CtaPolicy: the branding line
 * used to hardcode `config.website` into the last seconds regardless of pillar, which
 * put a URL on screen for exactly the REACH/CONNECT posts whose policy forbids it —
 * in the one place no text critic ever looks.
 */
export async function refineVideoPrompt(
    config: ClientConfig,
    videoData: {
        hook: string
        scenes?: VideoScene[]
        videoScript?: string   // legacy fallback
    },
    postType: string,
    duration: number,
    ctaPolicy?: CtaPolicy
): Promise<string> {
    const memSection = await getVisualMemoriesSection()

    // Build scene breakdown for the prompt
    const scenesText = videoData.scenes?.length
        ? videoData.scenes.map((s, i) =>
            `Scene ${i + 1} (${s.timeRange}):
  - Visual: ${s.visual}
  - Camera: ${s.camera}
  - Mood/Lighting: ${s.mood}
  - Audio: ${s.soundEffect || "ambient"}
  - Narration hint: "${s.narration || ""}"`
        ).join("\n\n")
        : `Raw script: "${videoData.videoScript || ""}"`

    // The pillar's CTA policy decides whether a URL may appear on screen at all.
    // Default (no policy passed) stays on the safe side: brand feel, no URL.
    const closingBrandRule = ctaPolicy && !ctaPolicy.allowWebsite
        ? `Land on a clear, stable brand moment (product, logo mark or signature visual). ` +
          `⛔ NO website address, NO URL, NO domain name anywhere on screen at any point — ` +
          `this post's CTA policy (${ctaPolicy.pillarLabel.toUpperCase()}) forbids it.`
        : `MUST include ${config.website} branding (text on screen or product placement).`

    const refinementPrompt = `
You are a world-class video director creating an Instagram Reel.
Transform these scene descriptions into a SINGLE, DETAILED Veo 3.1 video generation prompt.
${memSection}

## INPUT SCENES:
${scenesText}

## HOOK TEXT: "${videoData.hook}"
## DURATION: ${duration} seconds
## POST TYPE: ${postType}

## CRITICAL REQUIREMENTS:
- 9:16 vertical format, 1080p resolution
- ${config.videoFocus || "Professional content with smooth, cinematic camera movements"}
- EVERY camera transition must be SMOOTH — no jump cuts unless for dramatic effect
- Lighting must be consistent within scenes, with natural transitions between them
- Final 2-3 seconds: ${closingBrandRule}
- Audio: include ambient sounds and effects described in scenes (${videoData.scenes?.map(s => s.soundEffect).filter(Boolean).join(", ") || "natural ambient"})

## CAMERA CHOREOGRAPHY:
Describe camera movement as a CONTINUOUS FLOW through the scenes:
- Start with the hook (${videoData.scenes?.[0]?.camera || "dramatic opening"})
- Transition smoothly through middle scenes
- End with a clear, stable shot for CTA

## OUTPUT:
Return a SINGLE detailed English video generation prompt (4-6 sentences).
Include specific camera movements, lighting setup, subject actions, and audio cues.
The prompt must read like a professional shot list compressed into prose.
`

    // Prose out, not JSON → json: false. Same textPro ladder as the copywriter.
    const videoDirectorLadder = [getModel("textPro")]
    if (hasFallback("textPro")) videoDirectorLadder.push(getModel("textPro", "fallback"))

    let refined: string | undefined
    try {
        refined = await generateTextQuality(refinementPrompt, {
            models: videoDirectorLadder,
            json: false,
            temperature: getTemperature("designer"),
            label: "video-director",
        })
    } catch (err) {
        // Both Pro tiers exhausted. Falling through to the raw script is the truthful
        // outcome (a flash rewrite would be a silent quality drop), but say so.
        console.warn("   ⚠️ Video director (Pro ladder) nedostupný — používám surový scénář:", err)
    }

    if (!refined?.trim()) return videoData.videoScript || videoData.scenes?.map(s => s.visual).join(". ") || ""
    return refined.replace(/^["']|["']$/g, "").trim()
}
