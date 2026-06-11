/**
 * Image Pipeline for Instagram Autopilot
 * Prompt refinement for images, carousels, and videos.
 * Art Director now receives Visual Memory from past top-performing posts.
 */

import { ai } from "./gemini-client"
import { getModel } from "./models"
import { getBrandMemories } from "./memory-agent"
import type { ClientConfig } from "./configs/types"

// ============================================
// VISUAL MEMORY FORMATTER
// ============================================

/**
 * Load and format visual memories for Art Director injection.
 * Returns an empty string if no visual memories exist yet.
 */
export async function getVisualMemoriesSection(): Promise<string> {
    try {
        const { getActiveProject } = await import("./service")
        getActiveProject() // will throw if not set — safe to catch
    } catch {
        return ""
    }

    const memories = await getBrandMemories(5)
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
// IMAGE PROMPT REFINEMENT
// ============================================

export async function refineImagePrompt(
    config: ClientConfig,
    captionData: { imagePrompt: string; hook: string; imageSubtext?: string },
    postType: string,
    bodyContext?: string,
    visualMemoriesSection?: string,
    overlayVariant?: string,
): Promise<string> {
    // MEME EXCEPTION
    if (postType === "meme") {
        const memePrompt = `
You are creating a MEME image for Instagram.

Raw idea: "${captionData.imagePrompt}"
Meme text (will be IN the image): "${captionData.hook}"

## YOUR TASK:
Create a meme-style BACKGROUND IMAGE — NO TEXT, NO WORDS, NO LETTERS in the image.
The image must be a relatable, funny visual scene that perfectly matches the meme concept below.
Text will be added programmatically on top — DO NOT render any text in the image.

Meme concept: "${captionData.imagePrompt}"
Visual mood: funny, relatable, meme-style

OUTPUT: Single detailed English image prompt (2-3 sentences). NO TEXT IN IMAGE.
`
        const response = await ai.models.generateContent({
            model: getModel("text"),
            contents: memePrompt,
        })
        const parts = response.candidates?.[0]?.content?.parts || []
        const textPart = parts.find((p: any) => p.text)
        const refined = textPart?.text
        return refined || captionData.imagePrompt
    }

    // Load visual memories if not provided
    const memSection = visualMemoriesSection ?? await getVisualMemoriesSection()

    // STANDARD POST
    const refinementPrompt = `
${buildFeedAesthetic(config)}
${memSection}
## YOUR TASK:
Take this raw image prompt and transform it into a DETAILED, professional image prompt.

Raw prompt: "${captionData.imagePrompt}"

HOOK TEXT: "${captionData.hook}"
Subtext: "${captionData.imageSubtext || ""}"
Post type: ${postType}
${bodyContext ? `Post body context: "${bodyContext}"` : ""}

## OUTPUT:
Return ONLY a single detailed English image generation prompt (NO JSON).

⚠️ CRITICAL RULES — MUST FOLLOW:
- ABSOLUTELY NO TEXT, NO WORDS, NO LETTERS, NO TYPOGRAPHY in the image
- NO signs, NO labels, NO overlays, NO captions
- The image is a pure BACKGROUND PHOTO — text will be added programmatically

🎯 VISUAL QUALITY RULES — WHAT MAKES A GREAT INSTAGRAM FEED:
- VARIETY is everything — each post should look DIFFERENT from the last
- Alternate between: people (emotions, candid), product close-ups (texture, detail), environments (mood, atmosphere), creative angles (aerial, macro, motion blur)
- NEVER generate boring static shots (laptop on desk, coffee cup, flat lay of random objects)
- Cinematic lighting: golden hour, dramatic shadows, rim light, neon glow
- Depth: foreground + subject + background layers, shallow DOF
- When people appear: show authentic expression, gesture, interaction
- When no people: make the composition visually striking and unexpected

🖼️ COMPOSITION FOR TEXT OVERLAY — CRITICAL:
Text will be overlaid on this image programmatically. The image must have CLEAR NEGATIVE SPACE (empty/uniform area) where the text will go.
${overlayVariant === "top" || overlayVariant === "editorial" ? "- Text will be placed at the TOP of the image → keep the TOP 35% of the image relatively clean/blurred/dark — put the main subject in the LOWER HALF" : overlayVariant === "centered" || overlayVariant === "full-typo" ? "- Text will be placed in the CENTER of the image → composition should frame around the edges, with the CENTER area relatively empty or with a subtle, uniform background" : overlayVariant === "split" ? "- Text will be placed in the UPPER-CENTER and BOTTOM of the image → keep those areas with uniform/dark backgrounds — put the main subject to the LEFT or RIGHT side" : "- Text will be placed at the BOTTOM of the image → keep the BOTTOM 35% of the image relatively clean/blurred/dark — put the main subject in the UPPER HALF"}
- NEVER place a face, product logo, or important detail where the text will go — it will be covered and unreadable
- Use depth of field to blur the text area naturally
- A dark gradient will be applied over the text area, so slightly darker tones there help readability

The prompt should be 2-3 sentences.
`

    const response = await ai.models.generateContent({
        model: getModel("text"),
        contents: refinementPrompt,
    })

    const parts = response.candidates?.[0]?.content?.parts || []
    const textPart = parts.find((p: any) => p.text)
    const refined = textPart?.text

    if (!refined) return captionData.imagePrompt
    return refined.replace(/^["']|["']$/g, "").trim()
}

// ============================================
// CAROUSEL PROMPT REFINEMENT
// ============================================

export async function refineCarouselPrompts(
    config: ClientConfig,
    allSlides: { headline: string; subtext: string; imagePrompt: string }[],
    visualTheme: string,
    postType: string
): Promise<string[]> {
    const slideSummary = allSlides.map((s, i) =>
        `Slide ${i === 0 ? "COVER" : String(i)}: headline="${s.headline}", subtext="${s.subtext}", rawPrompt="${s.imagePrompt}"`
    ).join("\n")

    // Inject visual memories for carousel cohesion
    const memSection = await getVisualMemoriesSection()

    const refinementPrompt = `
${buildFeedAesthetic(config)}
${memSection}
## YOUR TASK:
You are refining image prompts for an Instagram CAROUSEL (${allSlides.length} slides).
All slides MUST feel like ONE cohesive series — as if photographed in the same session.

Visual theme: "${visualTheme}"

## SLIDES:
${slideSummary}

## CRITICAL RULES FOR CAROUSEL COHESION:
1. ALL slides share the SAME environment/location — describe it consistently
2. ALL slides share the SAME lighting setup and color temperature
3. ALL slides share the SAME style (e.g. all editorial, all product close-up, all lifestyle)
4. ONLY camera angle and framing changes between slides (wide → medium → close-up → detail)
5. Consistent props, products, and brand elements across all slides
6. Camera progression should feel like moving THROUGH a scene, not jumping between locations

## ⚠️ ABSOLUTE REQUIREMENT — NO TEXT IN IMAGES:
- ABSOLUTELY NO TEXT, NO WORDS, NO LETTERS, NO TYPOGRAPHY in any slide
- NO signs, NO labels, NO overlays, NO captions, NO watermarks
- Each image is a pure BACKGROUND PHOTO — text is added programmatically via overlay

## 🖼️ COMPOSITION FOR TEXT OVERLAY:
- Text will be overlaid at the BOTTOM of each slide. The BOTTOM 35% must have CLEAR NEGATIVE SPACE.
- NEVER place faces, products, or important details in the bottom third — they will be covered by text.
- Put the main subject in the UPPER HALF of the frame. Use depth of field to blur the bottom area naturally.
- The COVER slide (first) has the largest text — it needs the MOST negative space at the bottom.

## OUTPUT:
Return a JSON array of exactly ${allSlides.length} strings, each a detailed image prompt.
Each prompt should be 2-3 sentences and end with "NO TEXT in image."
`

    try {
        const response = await ai.models.generateContent({
            model: getModel("text"),
            contents: refinementPrompt,
            config: { responseMimeType: "application/json" },
        })

        const parts = response.candidates?.[0]?.content?.parts || []
        const textPart = parts.find((p: any) => p.text)
        const text = textPart?.text || ""
        const parsed = JSON.parse(text)

        if (Array.isArray(parsed) && parsed.length === allSlides.length) {
            console.log(`   ✓ Carousel prompts unified (${parsed.length} slides, shared theme)`)
            return parsed.map((p: string) => p.replace(/^["']|["']$/g, "").trim())
        }

        console.warn("   ⚠️ Carousel prompt array length mismatch — falling back")
    } catch (err) {
        console.warn("   ⚠️ Carousel batch refinement failed — falling back:", err)
    }

    // Fallback: refine individually (reuse the already-loaded memories)
    const results: string[] = []
    for (const slide of allSlides) {
        const refined = await refineImagePrompt(
            config,
            { imagePrompt: slide.imagePrompt, hook: slide.headline, imageSubtext: slide.subtext },
            postType,
            undefined,
            memSection
        )
        results.push(refined)
    }
    return results
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
