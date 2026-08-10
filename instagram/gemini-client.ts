/**
 * Gemini API Client
 * =================
 * All model IDs live in the central registry: instagram/models.ts
 * (env-overridable via GEMINI_MODEL_<ACTION>[_FALLBACK]).
 */

import { GoogleGenAI } from "@google/genai"
import { getModel } from "./models"
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

import { withRetry, withQualityRetry, QualityUnavailableError, isPermanentModelError } from "../utils/retry"
import { recordUsage, recordUnits } from "./usage-meter"
import { getThinkingBudget } from "./models"

/**
 * Thinking budget do configu volání. Záporná hodnota (dynamické) a `undefined` se
 * NEPOSÍLAJÍ vůbec — je to výchozí chování modelu a modely bez thinking režimu by na
 * neznámém poli mohly spadnout. Politika per role je v `instagram/models.ts`.
 */
function thinkingCfg(budget?: number): Record<string, unknown> {
    return budget === undefined || budget < 0 ? {} : { thinkingConfig: { thinkingBudget: budget } }
}

// ============================================
// TEXT GENERATION (Gemini 3.5 Flash)
// ============================================

export async function generateText(
    prompt: string,
    options?: { responseSchema?: any; temperature?: number; model?: string; fallbackModel?: string; thinkingBudget?: number }
): Promise<string> {
    const defaultModel = options?.model || getModel("text")
    const fallbackModel = options?.fallbackModel || getModel("text", "fallback")
    try {
        return await withRetry(async () => {
            const response = await ai.models.generateContent({
                model: defaultModel,
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    ...(options?.responseSchema && { responseSchema: options.responseSchema }),
                    ...(options?.temperature !== undefined && { temperature: options.temperature }),
                    ...thinkingCfg(options?.thinkingBudget),
                },
            })

            recordUsage(defaultModel, response.usageMetadata, "text")

            const parts = response.candidates?.[0]?.content?.parts || []
            const textPart = parts.find((p: any) => p.text)
            const text = textPart?.text

            if (!text) throw new Error("Gemini returned no text")
            return text
        })
    } catch (err: any) {
        // Fallback on overload (503/429) AND on 404/not-found — an invalid or
        // unavailable model ID must degrade gracefully, not crash the pipeline.
        const m = err.message || ""
        if (err.status === 503 || err.status === 429 || err.status === 404 || m.includes("503") || m.includes("429") || m.includes("404") || m.includes("not found") || m.includes("NOT_FOUND") || m.includes("quota") || m.includes("high demand") || m.includes("overloaded")) {
            console.warn(`⚠️ ${defaultModel} unavailable (${err.status}). Falling back to ${fallbackModel}...`)
            return await withRetry(async () => {
                const response = await ai.models.generateContent({
                    model: fallbackModel,
                    contents: prompt,
                    config: {
                        responseMimeType: "application/json",
                        ...(options?.responseSchema && { responseSchema: options.responseSchema }),
                        ...(options?.temperature !== undefined && { temperature: options.temperature }),
                        ...thinkingCfg(options?.thinkingBudget),
                    },
                })

                recordUsage(fallbackModel, response.usageMetadata, "text:fallback")

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
// QUALITY LADDER (text) — for quality-critical paths only
// ============================================

/**
 * Run a prompt down an ordered ladder of QUALITY models (e.g. [gemini-pro-latest,
 * gemini-2.5-pro]). For each model it retries HARD on transient overload (503/429)
 * for minutes before moving on — because a busy Pro model is still the right model.
 * A dead model (404) is logged loudly and skipped (never silently masked). If EVERY
 * model is exhausted it throws QualityUnavailableError — callers must then defer
 * (campaigns) or fail (single posts), NEVER degrade to flash.
 *
 * This is the deliberate opposite of generateText(), whose fast tier may fall back
 * to flash. Use this for copywriter / designer / vision-QA.
 */
export async function generateTextQuality(
    prompt: string,
    options: { models: string[]; responseSchema?: any; temperature?: number; label?: string; images?: { buffer: Buffer; mimeType?: string; label?: string }[]; onModelUsed?: (model: string) => void; json?: boolean; thinkingBudget?: number }
): Promise<string> {
    const wantJson = options.json !== false // default: JSON output
    const models = options.models.filter(Boolean)
    if (models.length === 0) throw new Error("generateTextQuality: no models provided")
    const label = options.label || "quality-text"

    // Build contents: optional images (for vision-QA) then the prompt.
    const contents: any = options.images?.length
        ? [{
            role: "user",
            parts: [
                ...options.images.flatMap(img => [
                    ...(img.label ? [{ text: img.label }] : []),
                    { inlineData: { mimeType: img.mimeType || "image/png", data: img.buffer.toString("base64") } },
                ]),
                { text: prompt },
            ],
        }]
        : prompt

    const callModel = async (model: string): Promise<string> => {
        const response = await ai.models.generateContent({
            model,
            contents,
            config: {
                ...(wantJson && { responseMimeType: "application/json" }),
                ...(options.responseSchema && { responseSchema: options.responseSchema }),
                ...(options.temperature !== undefined && { temperature: options.temperature }),
                ...thinkingCfg(options.thinkingBudget),
            },
        })
        recordUsage(model, response.usageMetadata, label)
        const text = response.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text
        if (!text) throw new Error("Gemini returned no text")
        return text
    }

    let lastError: unknown = null
    for (let i = 0; i < models.length; i++) {
        const model = models[i]
        const isLastTier = i === models.length - 1
        try {
            const out = await withQualityRetry(() => callModel(model), { label: `${label}:${model}` })
            // Log the WINNING model so observability reflects reality (the model_used DB
            // field used to hardcode the flash tier even when a Pro model ran).
            console.log(`   🧠 ${label}: ${model}${i > 0 ? ` (tier ${i + 1})` : ""}`)
            options.onModelUsed?.(model)
            return out
        } catch (err: any) {
            lastError = err
            if (isPermanentModelError(err)) {
                // Dead/invalid model ID — surface loudly so it gets fixed (this is exactly
                // how gemini-3-pro-preview silently rotted behind a flash fallback before).
                console.error(`🚨 ${label}: model "${model}" is permanently unavailable (${String(err?.message || err).substring(0, 100)}) — check instagram/models.ts`)
            } else {
                console.warn(`⚠️ ${label}: "${model}" exhausted transient retries${isLastTier ? "" : " — dropping to next Pro tier"}`)
            }
        }
    }
    throw new QualityUnavailableError(`${label}: all Pro tiers exhausted [${models.join(", ")}]: ${String((lastError as any)?.message || lastError).substring(0, 120)}`)
}

// ============================================
// IMAGE GENERATION — Nano Banana (Gemini native image models)
// Replaces deprecated Imagen 4 Ultra (shutdown June 24, 2026)
// ============================================

export async function generateImage(
    prompt: string,
    options: { aspectRatio?: "1:1" | "3:4" | "4:3" | "9:16" | "16:9" } = {}
): Promise<Buffer> {
    const { aspectRatio = "1:1" } = options

    // Primary: Nano Banana Pro (highest quality)
    try {
        return await withRetry(async () => {
            const response = await ai.models.generateContent({
                model: getModel("image"),
                contents: [{ text: prompt }],
                config: {
                    responseModalities: ["IMAGE"],
                    // ⚠️ Do NOT set imageConfig.imageSize ("2K"/"4K") — it makes gemini-3-pro-image
                    // return a blurry, defocused blob (verified). aspectRatio alone → sharp renders.
                    imageConfig: {
                        aspectRatio,
                    },
                } as any,
            })

            recordUsage(getModel("image"), response.usageMetadata, "image")

            const parts = response.candidates?.[0]?.content?.parts || []
            for (const part of parts) {
                if ((part as any).inlineData?.data) {
                    return Buffer.from((part as any).inlineData.data, "base64")
                }
            }
            throw new Error("Nano Banana Pro returned no image data")
        }, 1) // max 1 retry
    } catch (err: any) {
        // Fallback: Nano Banana 2 (faster, cheaper)
        const msg = String(err?.message || "")
        if (msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("overloaded") || msg.includes("no image data")) {
            console.log("⚠️ Nano Banana Pro unavailable — falling back to Nano Banana 2...")
            return await withRetry(async () => {
                const response = await ai.models.generateContent({
                    model: getModel("image", "fallback"),
                    contents: [{ text: prompt }],
                    config: {
                        responseModalities: ["IMAGE"],
                        imageConfig: {
                            aspectRatio, // no imageSize — "2K" blurs the output
                        },
                    } as any,
                })
                recordUsage(getModel("image", "fallback"), response.usageMetadata, "image:fallback")
                const parts = response.candidates?.[0]?.content?.parts || []
                for (const part of parts) {
                    if ((part as any).inlineData?.data) {
                        return Buffer.from((part as any).inlineData.data, "base64")
                    }
                }
                throw new Error("Nano Banana 2 fallback returned no image data")
            }, 1)
        }
        throw err
    }
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
        /** Called with the model ID that actually produced the image (primary or fallback) —
         *  lets callers log the TRUE tier used instead of assuming the static primary model. */
        onModel?: (model: string) => void
    } = {}
): Promise<Buffer> {
    const { aspectRatio = "3:4" } = options // resolution intentionally unused — imageSize blurs output

    // Build contents array: text prompt + labeled reference images.
    // Labels must be interleaved as text parts — the model can't see
    // what a reference means otherwise (e.g. "brand logo" vs "product").
    const contents: any[] = [
        { text: prompt },
    ]

    referenceImages.forEach((ref, i) => {
        contents.push({ text: `Reference image ${i + 1} (${ref.label || "reference"}):` })
        contents.push({
            inlineData: {
                mimeType: ref.mimeType || "image/jpeg",
                data: ref.buffer.toString("base64"),
            },
        })
    })

    const callModel = async (model: string): Promise<Buffer> => {
        const response = await ai.models.generateContent({
            model,
            contents,
            config: {
                responseModalities: ["IMAGE"],
                imageConfig: {
                    aspectRatio: aspectRatio, // no imageSize — "2K"/"4K" blurs gemini-3-pro-image
                },
            } as any,
        })

        recordUsage(model, response.usageMetadata, "image:refs")

        const parts = response.candidates?.[0]?.content?.parts || []
        for (const part of parts) {
            if ((part as any).inlineData?.data) {
                options.onModel?.(model)
                return Buffer.from((part as any).inlineData.data, "base64")
            }
        }
        throw new Error("Image generation with references returned no image data")
    }

    try {
        return await withRetry(() => callModel(getModel("image")), 1)
    } catch (err: any) {
        const msg = String(err?.message || "")
        if (msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("overloaded") || msg.includes("no image data")) {
            console.log("⚠️ Nano Banana Pro (references) unavailable — falling back to Nano Banana 2...")
            return withRetry(() => callModel(getModel("image", "fallback")), 1)
        }
        throw err
    }
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
        /** Called with the model ID that actually produced the edit (primary or fallback). */
        onModel?: (model: string) => void
    } = {}
): Promise<Buffer> {
    const { mimeType = "image/jpeg", aspectRatio = "1:1" } = options // resolution unused — imageSize blurs output

    const callModel = async (model: string): Promise<Buffer> => {
        const response = await ai.models.generateContent({
            model,
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
                    aspectRatio, // no imageSize — "2K"/"4K" blurs gemini-3-pro-image
                },
            } as any,
        })

        recordUsage(model, response.usageMetadata, "image:edit")

        const parts = response.candidates?.[0]?.content?.parts || []
        for (const part of parts) {
            if ((part as any).inlineData?.data) {
                options.onModel?.(model)
                return Buffer.from((part as any).inlineData.data, "base64")
            }
        }
        throw new Error("Image editing returned no image data")
    }

    try {
        return await withRetry(() => callModel(getModel("image")), 1)
    } catch (err: any) {
        const msg = String(err?.message || "")
        if (msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("overloaded") || msg.includes("no image data")) {
            console.log("⚠️ Nano Banana Pro (edit) unavailable — falling back to Nano Banana 2...")
            return withRetry(() => callModel(getModel("image", "fallback")), 1)
        }
        throw err
    }
}

// ============================================
// VISION ANALYSIS (Gemini 1.5 Pro)
// ============================================

export async function detectLogoPlacementArea(imageBuffer: Buffer): Promise<{ x: number; y: number; w: number; h: number } | null> {
    return withRetry(async () => {
        const response = await ai.models.generateContent({
            model: getModel("vision"),
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
                // Výstup jsou čtyři souřadnice — přemýšlení tu nemá co zlepšit.
                ...thinkingCfg(getThinkingBudget("cheap")),
            } as any,
        })

        recordUsage(getModel("vision"), response.usageMetadata, "vision:logo-area")

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
// MULTI-IMAGE VISION ANALYSIS
// ============================================

/**
 * Send multiple images + a text prompt to the vision model, get JSON text back.
 * Used e.g. by feed-vision.ts to analyze a scraped Instagram feed during onboarding.
 */
export async function analyzeImagesWithText(
    images: { buffer: Buffer; mimeType?: string; label?: string }[],
    prompt: string,
    options?: { responseSchema?: any; temperature?: number; thinkingBudget?: number }
): Promise<string> {
    if (images.length === 0) throw new Error("analyzeImagesWithText: no images provided")

    const parts: any[] = []
    for (const img of images) {
        if (img.label) parts.push({ text: img.label })
        parts.push({
            inlineData: {
                mimeType: img.mimeType || "image/jpeg",
                data: img.buffer.toString("base64"),
            },
        })
    }
    parts.push({ text: prompt })

    return withRetry(async () => {
        const response = await ai.models.generateContent({
            model: getModel("vision"),
            contents: [{ role: "user", parts }],
            config: {
                responseMimeType: "application/json",
                ...(options?.responseSchema && { responseSchema: options.responseSchema }),
                ...(options?.temperature !== undefined && { temperature: options.temperature }),
                ...thinkingCfg(options?.thinkingBudget),
            },
        })

        recordUsage(getModel("vision"), response.usageMetadata, "vision")
        const text = response.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text
        if (!text) throw new Error("Gemini vision returned no text")
        return text
    })
}

// ============================================
// VIDEO GENERATION — Veo 3.1 (Reels)
// ============================================

export type VideoTier = "lite" | "fast" | "premium"

export async function generateVideo(
    prompt: string,
    options: {
        duration?: number        // seconds (4-8 for 1080p)
        aspectRatio?: "9:16" | "16:9" | "1:1"
        tier?: VideoTier        // lite = Veo 3.1 Lite (cheapest), fast = Veo 3.1 Fast, premium = Veo 3.1 Standard
        referenceImages?: { buffer: Buffer; mimeType?: string }[]  // up to 3 reference images
    } = {}
): Promise<Buffer> {
    const { duration = 8, aspectRatio = "9:16", tier = "fast", referenceImages } = options

    const model = tier === "lite"
        ? getModel("videoLite")
        : tier === "premium"
            ? getModel("videoPremium")
            : getModel("videoFast")

    // Build reference images for Veo (brand photos, product shots, spaces)
    const refImages = referenceImages?.slice(0, 3).map(ref => ({
        image: {
            imageBytes: ref.buffer.toString("base64"),
            mimeType: ref.mimeType || "image/jpeg",
        },
    }))

    let operation = await ai.models.generateVideos({
        model,
        prompt,
        ...(refImages?.length ? { referenceImages: refImages } : {}),
        config: {
            durationSeconds: duration,
            aspectRatio,
            resolution: "1080p",
            numberOfVideos: 1,
        },
    } as any)

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

    // Veo se účtuje za vteřinu vygenerovaného videa a operace nenese usageMetadata —
    // bez tohohle by reel (nejdražší médium) vycházel v telemetrii na nulu.
    recordUnits(model, "seconds", duration, "video")

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

// ============================================
// VOICEOVER — Gemini 3.1 Flash TTS (Czech)
// ============================================

export async function generateVoiceover(
    narrationText: string,
    options: {
        voice?: string        // Preset voice name (default: "Kore")
        mood?: string         // e.g. "professional", "excited", "calm"
        audioTags?: string[]  // expressive delivery tags, e.g. ["warm pace", "smiling"] (Gemini 3.1 TTS supports 200+)
    } = {}
): Promise<Buffer> {
    const { voice = "Kore", mood, audioTags } = options

    // Prepend mood + audio tags for expressive delivery
    const tags = [mood, ...(audioTags || [])].filter(Boolean)
    const textWithMood = tags.length
        ? `${tags.map(t => `[${t}]`).join("")} ${narrationText}`
        : narrationText

    const callModel = async (model: string): Promise<Buffer> => {
        const response = await ai.models.generateContent({
            model,
            contents: textWithMood,
            config: {
                responseModalities: ["AUDIO"] as any,
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: {
                            voiceName: voice,
                        },
                    },
                },
            } as any,
        })

        recordUsage(model, response.usageMetadata, "tts")

        const audioPart = response.candidates?.[0]?.content?.parts?.[0]
        const inlineData = (audioPart as any)?.inlineData

        if (!inlineData?.data) {
            throw new Error("TTS returned no audio data")
        }

        return Buffer.from(inlineData.data, "base64")
    }

    try {
        return await callModel(getModel("tts"))
    } catch (err) {
        console.warn(`⚠️ ${getModel("tts")} failed — falling back to ${getModel("tts", "fallback")}...`, err)
        return callModel(getModel("tts", "fallback"))
    }
}

// ============================================
// EMBEDDINGS (pipeline v2 — memory relevance + consistency score)
// ============================================

/**
 * Embed a batch of texts at EMBEDDING_DIMS (768) — must match the pgvector columns.
 * Primary/fallback per the model registry. Callers treat embeddings as best-effort:
 * throw here, fail-open there (a post must never fail over an embedding).
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
    const { EMBEDDING_DIMS } = await import("./models")
    const call = async (model: string) => {
        const res = await ai.models.embedContent({
            model,
            contents: texts,
            config: { outputDimensionality: EMBEDDING_DIMS },
        })
        const vectors = (res.embeddings || []).map(e => e.values || [])
        if (vectors.length !== texts.length || vectors.some(v => v.length !== EMBEDDING_DIMS)) {
            throw new Error(`embedContent returned ${vectors.length}/${texts.length} vectors`)
        }
        return vectors
    }
    try {
        return await call(getModel("embedding"))
    } catch (err) {
        console.warn(`⚠️ ${getModel("embedding")} embed failed — falling back to ${getModel("embedding", "fallback")}`, (err as Error)?.message?.substring(0, 80))
        return call(getModel("embedding", "fallback"))
    }
}

export async function embedText(text: string): Promise<number[]> {
    const [vec] = await embedTexts([text])
    return vec
}

/** Cosine similarity — used for the brand-consistency score (both vectors 768d). */
export function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i]
        na += a[i] * a[i]
        nb += b[i] * b[i]
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb)
    return denom === 0 ? 0 : dot / denom
}

export { ai }
