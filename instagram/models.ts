/**
 * Central AI model registry
 * =========================
 * Single source of truth for every model ID used in the engine.
 * Override any entry per-environment via env vars without a deploy:
 *   GEMINI_MODEL_<ACTION>            — primary model (e.g. GEMINI_MODEL_DESIGNER=gemini-3.5-flash)
 *   GEMINI_MODEL_<ACTION>_FALLBACK   — fallback model
 *
 * ⚠️ Deprecated, never use: gemini-2.0-flash, gemini-3-pro-preview (404'd "no longer
 *    available" 2026-06-18), imagen-4.0-ultra, gemini-3-pro-image-preview,
 *    gemini-3.1-flash-image-preview (shutdown June 25, 2026).
 *
 * The deep-quality Pro tier uses the `gemini-pro-latest` ALIAS (not a pinned preview ID):
 * Google auto-rotates it to the current GA Pro model, so a future shutdown won't 404 us
 * the way a pinned gemini-3-pro-preview just did. It currently resolves to
 * gemini-3.1-pro-preview.
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
     *  ⚠️ Fallback is a SECOND Pro (gemini-2.5-pro GA), NOT flash: these paths run through
     *  the quality ladder (generateTextQuality), which retries the top Pro hard on transient
     *  503/429 before ever dropping a tier — and the drop is still Pro-grade. Flash is banned
     *  here on purpose (flash captions = "shit posts"). See utils/retry.ts QualityUnavailableError. */
    textPro: { primary: "gemini-pro-latest", fallback: "gemini-2.5-pro" },
    /** AI Designer — full visual design briefs (low volume, high creative leverage).
     *  Primary gemini-pro-latest (newest Pro alias): best structured-creative reasoning →
     *  richer briefs → better native renders. Fallback is the GA Pro gemini-2.5-pro (never
     *  flash) — a degraded brief still has to be Pro-grade. Runs via the quality ladder. */
    designer: { primary: "gemini-pro-latest", fallback: "gemini-2.5-pro" },
    /** Vision: logo placement, brand asset tagging, overlay review — high-volume / cheap. */
    vision: { primary: "gemini-3.5-flash" },
    /** Vision QA judge — verifyNativeImage gate on the default native engine. Runs up to 2×
     *  per image on the render path; its judgment decides whether a malformed render (Czech
     *  typography / logo defects) gets a corrective edit or ships. gen-3 Pro catches subtle
     *  defects flash misses. Fallback is the GA Pro gemini-2.5-pro (never flash) via the quality
     *  ladder; only if BOTH Pro tiers are exhausted does QA fail-open (skip), never flash-judge. */
    visionQA: { primary: "gemini-pro-latest", fallback: "gemini-2.5-pro" },
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
