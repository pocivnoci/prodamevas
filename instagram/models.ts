/**
 * Central AI model registry
 * =========================
 * Single source of truth for every model ID used in the engine.
 * Override any entry per-environment via env vars without a deploy:
 *   GEMINI_MODEL_<ACTION>            — primary model (e.g. GEMINI_MODEL_DESIGNER=gemini-3.5-flash)
 *   GEMINI_MODEL_<ACTION>_FALLBACK   — fallback model
 *
 * ⚠️ Deprecated, never use: gemini-2.0-flash, gemini-3.1-pro-preview, imagen-4.0-ultra,
 *    gemini-3-pro-image-preview, gemini-3.1-flash-image-preview (shutdown June 25, 2026).
 */

export const MODELS = {
    /** General text agents: captions, ideas, critic, analysis, onboarding */
    text: { primary: "gemini-3.5-flash", fallback: "gemini-2.5-flash-lite" },
    /** AI Designer — full visual design briefs (low volume, high creative leverage).
     *  gemini-pro-latest = best available Pro (alias auto-tracks the latest Pro, so
     *  it survives preview rotation). gemini-3.1-pro never existed; gemini-3-pro-preview
     *  is already dead; gemini-3.1-pro-preview is deprecated (shutdown June 25, 2026). */
    designer: { primary: "gemini-pro-latest", fallback: "gemini-2.5-pro" },
    /** Vision: QA checks, logo placement, brand asset tagging, overlay review */
    vision: { primary: "gemini-3.5-flash" },
    /** Image generation — Nano Banana Pro GA (renders typography natively) */
    image: { primary: "gemini-3-pro-image", fallback: "gemini-3.1-flash-image" },
    /** Cheap image tier — Nano Banana 2 GA (supports 512px) */
    imageCheap: { primary: "gemini-3.1-flash-image" },
    /** Video tiers for reels */
    videoLite: { primary: "veo-3.1-lite-generate-preview" },
    videoFast: { primary: "veo-3.1-fast-generate-preview" },
    videoPremium: { primary: "veo-3.1-generate-preview" },
    /** Czech voiceover */
    tts: { primary: "gemini-3.1-flash-tts-preview", fallback: "gemini-2.5-flash-preview-tts" },
} as const

export type ModelAction = keyof typeof MODELS

export function getModel(action: ModelAction, tier: "primary" | "fallback" = "primary"): string {
    const envKey = `GEMINI_MODEL_${action.toUpperCase()}${tier === "fallback" ? "_FALLBACK" : ""}`
    const override = process.env[envKey]
    if (override) return override

    const entry: { primary: string; fallback?: string } = MODELS[action]
    if (tier === "fallback") {
        if (!entry.fallback) throw new Error(`Model action "${action}" has no fallback defined`)
        return entry.fallback
    }
    return entry.primary
}

export function hasFallback(action: ModelAction): boolean {
    return Boolean(process.env[`GEMINI_MODEL_${action.toUpperCase()}_FALLBACK`] || (MODELS[action] as { fallback?: string }).fallback)
}
