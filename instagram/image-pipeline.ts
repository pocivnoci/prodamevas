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

    const memories = await getBrandMemories(5, clientId)
    const visual = memories.filter(m => m.memory_type === "visual")

    if (visual.length === 0) return ""

    return `
## 💡 VISUAL MEMORY (co vizuálně fungovalo u této značky):
${visual.map(m => `- ${m.content} (confidence: ${(m.confidence * 100).toFixed(0)}%)`).join("\n")}
⚠️ Použij tyto vzorce jako inspiraci — nekopíruj doslova.
`
}

// ============================================
// FEED AESTHETIC BUILDER
// ============================================

export function buildFeedAesthetic(config: ClientConfig): string {
    const fa = config.feedAesthetic
    return `
You are an expert Instagram visual designer. Your job is to create a DETAILED, 
HIGH QUALITY image prompt for Nano Banana Pro (Google's best image model).

## BRAND VISUAL IDENTITY (must be consistent across ALL posts):
- Color palette: ${fa.colorPalette}
- The overlay covers the ENTIRE image at ~${fa.overlayOpacity} opacity (photo clearly visible beneath)
- Text position: ${fa.textPosition} of image
- Font: ${fa.font}
- Overall feel: ${fa.feel}
- Aspect ratio: 1:1 square
${fa.customInstructions || ""}

## IMAGE QUALITY REQUIREMENTS:
- Photorealistic, professional editorial photography quality
- VISUAL VARIETY is key — alternate between people shots, product details, environments, creative angles
- When featuring people: authentic emotions, candid body language, real interactions
- When featuring products: dramatic close-ups, interesting textures, creative compositions
- Good lighting (golden hour, studio, or dramatic natural)
- Sharp focus, shallow depth of field where appropriate  
- Modern, aspirational lifestyle aesthetic — NOT stock photo vibes
- Dynamic angles: low angle, over-shoulder, close-up details, environmental portraits, bird’s eye
- 2K resolution output
${config.characterDescription ? `
## BRAND CHARACTER:
${config.characterDescription}
When the post is about the brand or lifestyle, include this character in the scene.
` : fa.phoneModel && fa.phoneModel !== "none" ? `
## PHONE CONSISTENCY:
- When showing a smartphone, ALWAYS depict a ${fa.phoneModel}
` : ""}
`
}

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
function buildUserPhotoSection(userPhoto?: UserPhotoBriefInfo, target: "post" | "cover" = "post"): string {
    if (!userPhoto) return ""
    return `

## 📷 CLIENT'S OWN PHOTO — MANDATORY VISUAL BASE OF THIS ${target === "cover" ? "COVER SLIDE" : "POST"}:
The client uploaded their OWN photo to be used in this exact ${target === "cover" ? "cover" : "post"}. It is attached to the render call as a reference image labeled "CLIENT photo".
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
}): Promise<DesignBrief> {
    const { config, clientId, captionData, postType, recentBriefs } = params
    const banned = (params.bannedArchetypes ?? []).filter(a => (LAYOUT_ARCHETYPES as readonly string[]).includes(a))
    const allowedArchetypes = (LAYOUT_ARCHETYPES as readonly string[]).filter(a => !banned.includes(a))
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
- Post type: ${postType}
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

## LAYOUT ARCHETYPE (rotation is ENFORCED in code — violations get rejected):
Set layoutArchetype to ONE of: ${allowedArchetypes.join(", ")}.
${banned.length ? `🚫 FORBIDDEN for this post (used by the latest posts): ${banned.join(", ")}.` : ""}
The feed must stay ON-BRAND (same palette, mood, typography family) while each post
changes the STRUCTURE — layout, text scale/placement, photo vs. graphic balance.
Cohesive vibe, different skeleton.

## DESIGN RULES:
- typography.headlineText and typography.subtextText must be the EXACT Czech strings above,
  character-for-character including diacritics (ě š č ř ž ý á í é ů ú). NEVER translate or rephrase.
- Typography is a DESIGN ELEMENT — vary scale, weight, placement, alignment between posts.
- 📸 PHOTO-FIRST: the image MUST be dominated by a real, rich photographic scene with a clear
  subject (people, products, places, action). The photo is the hero — NOT a backdrop.
- ⛔ NO EMPTY VOIDS: do NOT design large flat/solid color blocks, "deep charcoal voids", or
  mostly-empty dark canvases. Negative space for text = a CLEAN/DARKENED REGION OF THE PHOTO
  ITSELF (e.g. blurred or shadowed part of the scene), never a separate empty panel. Reserve at
  most ~one-third of the frame for text; the rest must show the photograph.
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

    // Enforce the archetype rotation — the prompt alone is not enough, the model
    // happily writes a new concept sentence on top of the same layout.
    if (brief.layoutArchetype && banned.includes(brief.layoutArchetype)) {
        console.warn(`   ⚠️ Designer reused banned archetype "${brief.layoutArchetype}" — regenerating`)
        const retryRaw = await generateTextQuality(
            designerPrompt + `\n\n⚠️ REJECTED: your previous brief used layoutArchetype "${brief.layoutArchetype}", which is FORBIDDEN. Produce a NEW brief with layoutArchetype strictly from: ${allowedArchetypes.join(", ")} — and a composition that actually matches it.`,
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
    return brief
}

/**
 * Convert a DesignBrief into the final Nano Banana Pro image prompt.
 */
export function buildNativeImagePrompt(brief: DesignBrief, config: ClientConfig, product?: ProductBriefInfo, userPhoto?: UserPhotoBriefInfo): string {
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

    return `Design a complete, finished Instagram post image — a professional brand visual with typography composited into the design (like a finished poster from a top design studio).

## SCENE / COMPOSITION:
${brief.composition}
${productBlock}${userPhotoBlock}

## NEGATIVE SPACE:
${brief.negativeSpace}

## TYPOGRAPHY (render INSIDE the image):
- Headline text — render this EXACT Czech text, character-for-character, including all diacritics (ě š č ř ž ý á í é ů ú): "${t.headlineText}"
${t.subtextText ? `- Subtext — render this EXACT Czech text verbatim: "${t.subtextText}"` : ""}
- Type style: ${t.styleDescription}
- Placement: ${t.placement}
- Color treatment: ${t.color}
⚠️ The Czech text must be reproduced with PERFECT spelling — every háček and čárka exactly as written. Do not add any other text, words, watermarks or labels anywhere in the image.

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
}): Promise<{ designSystem: string; briefs: DesignBrief[] }> {
    const { config, clientId, allSlides, visualTheme, postType, recentBriefs } = params
    const banned = (params.bannedArchetypes ?? []).filter(a => (LAYOUT_ARCHETYPES as readonly string[]).includes(a))
    const allowedArchetypes = (LAYOUT_ARCHETYPES as readonly string[]).filter(a => !banned.includes(a))
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
Post type: ${postType}
${slideSummary}
${buildProductSection(params.product)}${buildUserPhotoSection(params.userPhoto, "cover")}

## RECENT POST DESIGNS — THE CAROUSEL MUST DIVERGE FROM ALL OF THEM:
${recentBriefs.length ? recentBriefs.map((b, i) => `${i + 1}. ${b}`).join("\n") : "(no history yet)"}

## RULES:
1. First define ONE design system: same typography style, same palette/grading, same logo treatment
   across ALL slides — the carousel must feel like one cohesive editorial piece.
2. Same environment/lighting across slides; ONLY camera angle and framing changes (wide → medium → close-up).
3. Each slide's typography.headlineText / subtextText must be the EXACT Czech strings above,
   character-for-character including diacritics (ě š č ř ž ý á í é ů ú). NEVER translate or rephrase.
4. The COVER has the boldest typography; inner slides are calmer and consistent.
5. Diverge hard from the recent designs (layout, type placement, concept).
6. Set ONE layoutArchetype for the whole carousel (same value on every brief), chosen from:
   ${allowedArchetypes.join(", ")}.${banned.length ? `\n   🚫 FORBIDDEN (used by the latest posts): ${banned.join(", ")}.` : ""}
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
    return parsed
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
    expected: { headline: string; subtext?: string; logoExpected: boolean },
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

    const qaPrompt = `You are a strict QA inspector for AI-designed Instagram posts in CZECH.

Expected headline text (must match EXACTLY, including Czech diacritics ě š č ř ž ý á í é ů ú):
"${expected.headline}"
${expected.subtext ? `Expected subtext (must match EXACTLY):\n"${expected.subtext}"` : ""}
${expected.logoExpected ? "A brand logo MUST be present somewhere in the image." : ""}
${productCheck}
${userPhotoCheck}

Check:
1. Read ALL text rendered in the first image. Does the headline match the expected text character-for-character? Watch for: missing/wrong diacritics, swapped letters, duplicated words, gibberish, extra unwanted text.
${expected.subtext ? "2. Does the subtext match exactly?" : ""}
${expected.logoExpected ? "3. Is the brand logo present and not deformed?" : ""}
4. Is all text clearly readable (contrast, not cut off at edges)?
${productRef ? `5. Does the product in the first image faithfully match the reference product photo (second image)? Compare the print/graphic, colors and cut.` : ""}
${userPhotoRef ? `6. Is the first image visibly built from the client's photo (the LAST attached image) — same real scene/subject, possibly regraded/cropped/extended?` : ""}

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

export async function refineVideoPrompt(
    config: ClientConfig,
    videoData: {
        hook: string
        scenes?: VideoScene[]
        videoScript?: string   // legacy fallback
    },
    postType: string,
    duration: number
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
- Final 2-3 seconds MUST include ${config.website} branding (text on screen or product placement)
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

    const response = await ai.models.generateContent({
        model: getModel("text"),
        contents: refinementPrompt,
    })

    const parts = response.candidates?.[0]?.content?.parts || []
    const textPart = parts.find((p: any) => p.text)
    const refined = textPart?.text

    if (!refined) return videoData.videoScript || videoData.scenes?.map(s => s.visual).join(". ") || ""
    return refined.replace(/^["']|["']$/g, "").trim()
}
