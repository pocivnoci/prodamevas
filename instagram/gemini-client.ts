/**
 * Gemini Client — Wrapper for Google Generative AI
 * ==================================================
 * PRIMARY:  gemini-3.5-flash         — fastest frontier, agentic, reasoning
 * FALLBACK: gemini-2.5-flash-lite    — cheap stable fallback
 * IMAGE:    gemini-3-pro-image-preview (with refs) / imagen-4.0-ultra (without)
 */

import { GoogleGenAI, PersonGeneration } from "@google/genai"
import dotenv from "dotenv"

// Load env vars for CLI usage
dotenv.config({ path: ".env.local" })

const GEMINI_API_KEY = process.env.GEMINI_API_KEY

if (!GEMINI_API_KEY) {
    console.warn("⚠️ GEMINI_API_KEY is not set — generation functions will fail, but the app will still load.")
}

// Lazy initialization — don't crash the module if API key is missing.
// This allows the admin page (Posts, Ideas, Reviews tabs) to load even
// when GEMINI_API_KEY is not configured (e.g. on Vercel without the env var).
let _ai: GoogleGenAI | null = null

function getAI(): GoogleGenAI {
    if (!_ai) {
        const apiKey = process.env.GEMINI_API_KEY || GEMINI_API_KEY
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY is not set. Add it to Vercel Environment Variables.")
        }
        _ai = new GoogleGenAI({ apiKey })
    }
    return _ai
}

// Public accessor — used by autopilot.ts for direct model calls
const ai = new Proxy({} as GoogleGenAI, {
    get(_target, prop) {
        return (getAI() as any)[prop]
    },
})

// ============================================
// RETRY LOGIC — from shared utility
// ============================================

import { withRetry } from "../utils/retry"

// ============================================
// TEXT GENERATION (Gemini 3.5 Flash)
// ============================================

export async function generateText(
    prompt: string,
    options?: { responseSchema?: any; temperature?: number; model?: string }
): Promise<string> {
    const defaultModel = options?.model || "gemini-3.5-flash"
    try {
        return await withRetry(async () => {
            const response = await ai.models.generateContent({
                model: defaultModel,
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    ...(options?.responseSchema && { responseSchema: options.responseSchema }),
                    ...(options?.temperature !== undefined && { temperature: options.temperature }),
                },
            })

            const parts = response.candidates?.[0]?.content?.parts || []
            const textPart = parts.find((p: any) => p.text)
            const text = textPart?.text

            if (!text) throw new Error("Gemini returned no text")
            return text
        })
    } catch (err: any) {
        // Fallback to gemini-2.5-flash-lite on 503/429 errors
        if (err.status === 503 || err.status === 429 || err.message?.includes("503") || err.message?.includes("429") || err.message?.includes("quota") || err.message?.includes("high demand") || err.message?.includes("overloaded")) {
            console.warn(`⚠️ ${defaultModel} unavailable (${err.status}). Falling back to gemini-2.5-flash-lite...`)
            return await withRetry(async () => {
                const response = await ai.models.generateContent({
                    model: "gemini-2.5-flash-lite",
                    contents: prompt,
                    config: {
                        responseMimeType: "application/json",
                        ...(options?.responseSchema && { responseSchema: options.responseSchema }),
                        ...(options?.temperature !== undefined && { temperature: options.temperature }),
                    },
                })

                const parts = response.candidates?.[0]?.content?.parts || []
                const textPart = parts.find((p: any) => p.text)
                const text = textPart?.text

                if (!text) throw new Error("Gemini returned no text")
                return text
            }, 1) // Only retry once for the fallback
        }
        throw err
    }
}

// ============================================
// IMAGE GENERATION — Imagen 3
// ============================================

export async function generateImage(
    prompt: string,
    options: { aspectRatio?: "1:1" | "3:4" | "4:3" | "9:16" | "16:9" } = {}
): Promise<Buffer> {
    const { aspectRatio = "1:1" } = options

    return withRetry(async () => {
        const response = await ai.models.generateImages({
            model: "imagen-4.0-ultra-generate-001",
            prompt,
            config: {
                numberOfImages: 1,
                aspectRatio,
                personGeneration: PersonGeneration.ALLOW_ADULT,
            },
        })

        const generated = response.generatedImages?.[0]
        if (!generated?.image?.imageBytes) {
            throw new Error("Imagen 3 returned no image data")
        }

        return Buffer.from(generated.image.imageBytes, "base64")
    })
}

/**
 * Generate image with reference photos (Gemini 3.1 Pro Image)
 * 
 * Supports inline reference images for character/product consistency.
 * The model preserves the likeness of products from reference images
 * while placing them in the described scene.
 */
export async function generateImageWithReferences(
    prompt: string,
    referenceImages: { buffer: Buffer; mimeType?: string; label?: string }[],
    options: {
        aspectRatio?: string
        resolution?: "1K" | "2K" | "4K"
    } = {}
): Promise<Buffer> {
    const { aspectRatio = "3:4", resolution = "2K" } = options

    return withRetry(async () => {
        // Build contents array: text prompt + reference images as inlineData
        const contents: any[] = [
            { text: prompt },
        ]

        for (const ref of referenceImages) {
            const mimeType = ref.mimeType || "image/jpeg"
            contents.push({
                inlineData: {
                    mimeType,
                    data: ref.buffer.toString("base64"),
                },
            })
        }

        const response = await ai.models.generateContent({
            model: "gemini-3-pro-image-preview",
            contents,
            config: {
                responseModalities: ["IMAGE"],
                imageConfig: {
                    imageSize: resolution,
                    aspectRatio: aspectRatio,
                },
            } as any,
        })

        // Extract image from response parts
        const parts = response.candidates?.[0]?.content?.parts || []

        for (const part of parts) {
            if ((part as any).inlineData?.data) {
                return Buffer.from((part as any).inlineData.data, "base64")
            }
        }

        throw new Error("Gemini 3 Pro Image returned no image data")
    })
}

// ============================================
// IMAGE EDITING — Modify existing real photos
// ============================================

/**
 * Edit an existing real photo using AI.
 * 
 * CRITICAL DIFFERENCE from generateImageWithReferences:
 * - generateImageWithReferences: creates NEW image inspired by style
 * - editExistingImage: modifies the ACTUAL photo (adds elements, changes mood)
 * 
 * Use for location-based brands (hotels, restaurants, apartments):
 * "Vezmi tuto reálnou fotku apartmánu a přidej psa na postel"
 * → Result = real apartment with AI-added dog
 */
export async function editExistingImage(
    originalImage: Buffer,
    editPrompt: string,
    options: {
        mimeType?: string
        aspectRatio?: string
        resolution?: "1K" | "2K" | "4K"
    } = {}
): Promise<Buffer> {
    const { mimeType = "image/jpeg", aspectRatio = "1:1", resolution = "2K" } = options

    return withRetry(async () => {
        const response = await ai.models.generateContent({
            model: "gemini-3-pro-image-preview",
            contents: [
                {
                    role: "user",
                    parts: [
                        {
                            inlineData: {
                                mimeType,
                                data: originalImage.toString("base64"),
                            },
                        },
                        {
                            text: editPrompt,
                        },
                    ],
                },
            ],
            config: {
                responseModalities: ["IMAGE"],
                imageConfig: {
                    imageSize: resolution,
                    aspectRatio,
                },
            } as any,
        })

        const parts = response.candidates?.[0]?.content?.parts || []
        for (const part of parts) {
            if ((part as any).inlineData?.data) {
                return Buffer.from((part as any).inlineData.data, "base64")
            }
        }

        throw new Error("Image editing returned no image data")
    })
}

// ============================================
// VISION ANALYSIS (Gemini 1.5 Pro)
// ============================================

export async function detectLogoPlacementArea(imageBuffer: Buffer): Promise<{ x: number; y: number; w: number; h: number } | null> {
    return withRetry(async () => {
        const response = await ai.models.generateContent({
            // Nejchytřejší Vision model pro absolutní detail
            model: "gemini-3.5-flash",
            contents: [
                {
                    inlineData: {
                        mimeType: "image/png",
                        data: imageBuffer.toString("base64")
                    }
                },
                { text: 'You are a computer vision layout tool. Analyze this product image (which has size 1024x1024 pixels). Identify the optimal central, front-facing, blank area ON THE PHYSICAL MATERIAL OF THE PRODUCT ITSELF where a primary brand logo should be printed. CRITICAL: The bounding box MUST BE ON THE SOLID SURFACE OF THE PRODUCT. Do NOT place the logo floating in the background, in empty space, or in gaps between multiple items. Based on a 1024x1024 coordinate system (where 0,0 is top-left), return EXACTLY ONE JSON object with the bounding box coordinates and dimensions in pixels. The format MUST be: { "x": number, "y": number, "w": number, "h": number }. Do NOT return any markdown, text, or explanations. Only the JSON.' }
            ],
            config: {
                // responseMimeType enforces JSON output
                responseMimeType: "application/json",
            } as any,
        })

        try {
            const text = response.candidates?.[0]?.content?.parts?.[0]?.text
            if (!text) return null
            const cleanText = text.replace(/```(?:json)?/g, '').trim()
            const parsed = JSON.parse(cleanText)

            if (typeof parsed.x === 'number' && typeof parsed.y === 'number' &&
                typeof parsed.w === 'number' && typeof parsed.h === 'number') {
                return parsed
            }
            return null
        } catch (e) {
            console.warn(`   ⚠️ Vision placement failed: ${e}`)
            return null
        }
    })
}

// ============================================
// VIDEO GENERATION — Veo 3.1 (Reels)
// ============================================

export async function generateVideo(
    prompt: string,
    options: {
        duration?: number        // seconds (4-8 for 1080p)
        aspectRatio?: "9:16" | "16:9" | "1:1"
        fast?: boolean          // true = Veo 3.1 Fast ($0.15/s), false = Standard ($0.40/s)
    } = {}
): Promise<Buffer> {
    const { duration = 8, aspectRatio = "9:16", fast = true } = options

    const model = fast
        ? "veo-3.1-fast-generate-preview"
        : "veo-3.1-generate-preview"

    let operation = await ai.models.generateVideos({
        model,
        prompt,
        config: {
            durationSeconds: duration,
            aspectRatio,
            resolution: "1080p",
            numberOfVideos: 1,
        },
    })

    // Poll operation until complete (Veo takes 2-5 minutes)
    console.log("   ⏳ Veo 3.1 generating video (this takes 2-5 min)...")
    while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 10000)) // Poll every 10s
        operation = await ai.operations.getVideosOperation({ operation })
    }

    const video = operation.response?.generatedVideos?.[0]?.video
    if (!video) {
        throw new Error("Veo 3.1 returned no video data")
    }

    // Check for inline video bytes first
    if ((video as any).videoBytes) {
        return Buffer.from((video as any).videoBytes, "base64")
    }

    // Download video from URI (add API key for auth)
    if (!video.uri) {
        throw new Error("Veo 3.1 returned no video URI or bytes")
    }

    const apiKey = process.env.GEMINI_API_KEY
    const downloadUrl = video.uri.includes("?")
        ? `${video.uri}&key=${apiKey}`
        : `${video.uri}?key=${apiKey}`

    const videoResponse = await fetch(downloadUrl)
    if (!videoResponse.ok) {
        throw new Error(`Failed to download video: ${videoResponse.status} ${videoResponse.statusText}`)
    }

    const arrayBuffer = await videoResponse.arrayBuffer()

    return Buffer.from(arrayBuffer)
}

export { ai }
