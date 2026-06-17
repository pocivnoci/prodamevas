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
    /** General text agents — the FAST tier for everything interactive/latency-sensitive:
     *  content-plan preview (fires several sequential calls), onboarding analysis, product
     *  copy, context, ideas, memory, art-director. gemini-3.5-flash = newest-gen flash
     *  (still newer generation than the old gemini-2.5-pro), snappy UI. Pro here made the
     *  whole dashboard lazy (multi-call previews on a slow Pro preview model). Use `textPro`
     *  only for deep in-job quality work where latency is hidden by the 800s budget. */
    text: { primary: "gemini-3.5-flash", fallback: "gemini-2.5-flash" },
    /** Deep quality tier — gen-3 Pro for the copywriter (the caption = 80% of text quality).
     *  Runs INSIDE the generation job (800s budget) so its latency never touches browsing.
     *  Fast gemini-3.5-flash fallback on Pro 503/deadline. */
    textPro: { primary: "gemini-3-pro-preview", fallback: "gemini-3.5-flash" },
    /** AI Designer — full visual design briefs (low volume, high creative leverage).
     *  Primary gemini-3-pro-preview: best structured-creative reasoning → richer briefs →
     *  better native renders. Fallback is FAST gemini-3.5-flash: if Pro 503s, flash still
     *  returns a brief so the native render continues instead of dropping to overlay. */
    designer: { primary: "gemini-3-pro-preview", fallback: "gemini-3.5-flash" },
    /** Vision: logo placement, brand asset tagging, overlay review — high-volume / cheap. */
    vision: { primary: "gemini-3.5-flash" },
    /** Vision QA judge — verifyNativeImage gate on the default native engine. Runs up to 2×
     *  per image on the render path; its judgment decides whether a malformed render (Czech
     *  typography / logo defects) gets a corrective edit or ships. gen-3 Pro catches subtle
     *  defects flash misses. FAST gemini-3.5-flash fallback so a Pro 503 never stalls render. */
    visionQA: { primary: "gemini-3-pro-preview", fallback: "gemini-3.5-flash" },
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
