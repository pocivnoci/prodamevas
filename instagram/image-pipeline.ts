/**
 * Image Pipeline for Instagram Autopilot
 * Prompt refinement for images, carousels, and videos.
 */

import { ai } from "./gemini-client"
import type { ClientConfig } from "./configs/types"

// ============================================
// FEED AESTHETIC BUILDER
// ============================================

export function buildFeedAesthetic(config: ClientConfig): string {
    const fa = config.feedAesthetic
    return `
You are an expert Instagram visual designer. Your job is to create a DETAILED, 
HIGH QUALITY image prompt for Imagen 4 Ultra (Google's best image model).

## BRAND VISUAL IDENTITY (must be consistent across ALL posts):
- Color palette: ${fa.colorPalette}
- The overlay covers the ENTIRE image at ~${fa.overlayOpacity} opacity (photo clearly visible beneath)
- Text position: ${fa.textPosition} of image
- Font: ${fa.font}
- Overall feel: ${fa.feel}
- Aspect ratio: 1:1 square
${fa.customInstructions || ""}

## IMAGE QUALITY REQUIREMENTS:
- Photorealistic, professional photography quality
- Good lighting (natural or studio)
- Sharp focus, shallow depth of field where appropriate  
- Modern, aspirational lifestyle aesthetic
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
    bodyContext?: string
): Promise<string> {
    // MEME EXCEPTION
    if (postType === "meme") {
        const memePrompt = `
You are creating a MEME image for Instagram.

Raw idea: "${captionData.imagePrompt}"
Meme text (will be IN the image): "${captionData.hook}"

## YOUR TASK:
Create a funny, relatable meme-style image prompt.

REQUIREMENTS:
- Include the text "${captionData.hook}" directly in the image
- Use classic meme formats
- Keep it simple and authentic
- Style: meme aesthetic

OUTPUT: Single detailed English image generation prompt (2-3 sentences).
`
        const response = await ai.models.generateContent({
            model: "gemini-3.1-pro-preview",
            contents: memePrompt,
        })
        const refined = response.candidates?.[0]?.content?.parts?.[0]?.text
        return refined || captionData.imagePrompt
    }

    // STANDARD POST
    const refinementPrompt = `
${buildFeedAesthetic(config)}

## YOUR TASK:
Take this raw image prompt and transform it into a DETAILED, professional image prompt.

Raw prompt: "${captionData.imagePrompt}"

HOOK TEXT: "${captionData.hook}"
Subtext: "${captionData.imageSubtext || ""}"
Post type: ${postType}
${bodyContext ? `Post body context: "${bodyContext}"` : ""}

## OUTPUT:
Return ONLY a single detailed English image generation prompt (NO JSON).
DO NOT include any text rendering instructions.
Be specific about:
1. Background scene
2. Lighting and mood
3. Camera angle and composition
4. Overall aesthetic quality

The prompt should be 2-3 sentences.
`

    const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: refinementPrompt,
    })

    const refined = response.candidates?.[0]?.content?.parts?.[0]?.text
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

    const refinementPrompt = `
${buildFeedAesthetic(config)}

## YOUR TASK:
You are refining image prompts for an Instagram CAROUSEL (${allSlides.length} slides).
All slides MUST feel like ONE cohesive series.

Visual theme: "${visualTheme}"

## SLIDES:
${slideSummary}

## CRITICAL RULES FOR CAROUSEL COHESION:
1. ALL slides share the SAME environment/location
2. ALL slides share the SAME lighting
3. ALL slides share the SAME color temperature
4. ONLY camera angle changes between slides
5. Consistent props/products across slides
6. Camera feels like moving THROUGH the scene

## OUTPUT:
Return a JSON array of exactly ${allSlides.length} strings.
`

    try {
        const response = await ai.models.generateContent({
            model: "gemini-3.1-pro-preview",
            contents: refinementPrompt,
            config: { responseMimeType: "application/json" },
        })

        const text = response.candidates?.[0]?.content?.parts?.[0]?.text || ""
        const parsed = JSON.parse(text)

        if (Array.isArray(parsed) && parsed.length === allSlides.length) {
            console.log(`   ✓ Carousel prompts unified (${parsed.length} slides, shared theme)`)
            return parsed.map((p: string) => p.replace(/^["']|["']$/g, "").trim())
        }

        console.warn("   ⚠️ Carousel prompt array length mismatch — falling back")
    } catch (err) {
        console.warn("   ⚠️ Carousel batch refinement failed — falling back:", err)
    }

    // Fallback: refine individually
    const results: string[] = []
    for (const slide of allSlides) {
        const refined = await refineImagePrompt(
            config,
            { imagePrompt: slide.imagePrompt, hook: slide.headline, imageSubtext: slide.subtext },
            postType
        )
        results.push(refined)
    }
    return results
}

// ============================================
// VIDEO PROMPT REFINEMENT
// ============================================

export async function refineVideoPrompt(
    config: ClientConfig,
    videoData: { hook: string; videoScript: string },
    postType: string,
    duration: number
): Promise<string> {
    const refinementPrompt = `
You are a professional video director for Instagram Reels.
Transform this raw script into a DETAILED Veo 3.1 video generation prompt.

Raw script: "${videoData.videoScript}"
Hook text: "${videoData.hook}"
Duration: ${duration} seconds
Post type: ${postType}

## REQUIREMENTS:
- 9:16 vertical format
- 1080p resolution
- ${config.videoFocus || 'Professional content with smooth camera movements'}
- Final 2-3 seconds MUST show ${config.website} branding

## STRUCTURE:
Scene 1 (0-2s): Hook visual
Scene 2 (2-${duration - 3}s): Solution
Scene 3 (${duration - 3}-${duration}s): Result + CTA

## OUTPUT:
Return a single detailed English video generation prompt (2-4 sentences).
`

    const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: refinementPrompt,
    })

    const refined = response.candidates?.[0]?.content?.parts?.[0]?.text
    if (!refined) return videoData.videoScript
    return refined.replace(/^["']|["']$/g, "").trim()
}
