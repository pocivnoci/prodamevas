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
    /** General text agents: captions, ideas, critic, editorial board, context,
     *  content plan, onboarding analysis — the whole brain. Primary = gemini-3-pro-preview
     *  (newest GA-track Pro on the key; gen-3, far stronger than the old gen-2.5 Pro).
     *  Confirmed live (NOT the deprecated gemini-3.1-pro-preview). Timeout raised to 800s
     *  on Vercel gives Pro room to finish. Fast gemini-3.5-flash fallback (newer gen than
     *  the old primary, so no quality cliff) keeps things working on Pro 503/429/404. */
    text: { primary: "gemini-3-pro-preview", fallback: "gemini-3.5-flash" },
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
