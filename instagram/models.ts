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
     *  onboarding analysis, product copy, context, ideas, memory, art-director.
     *  gemini-3.5-flash = newest-gen flash (still newer generation than the old
     *  gemini-2.5-pro), snappy UI. Use `textPro` only for deep in-job quality work where
     *  latency is hidden by the 800s budget. (Content-plan moved OFF this tier → `planner`.) */
    text: { primary: "gemini-3.5-flash", fallback: "gemini-2.5-flash" },
    /** Content-plan pipeline (strategist + concepts + revision) — Pro ladder on purpose.
     *  The plan used to be one flash call ("hotové za 5 s") and read like it; the plan is
     *  the strategic backbone of a whole campaign, so it earns Pro latency (~1-2 min with
     *  visible stage progress in the UI). Fallback is the GA Pro, never flash — same
     *  quality-ladder rule as textPro. Judged cross-family via judge.ts (Claude). */
    planner: { primary: "gemini-pro-latest", fallback: "gemini-2.5-pro" },
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
    /** Image generation — Nano Banana Pro GA (renders typography natively).
     *  ŽÁDNÝ fallback: dřív tu stál `gemini-3.1-flash-image` a jediné 503 stačilo,
     *  aby zákazník dostal flash render — navíc bez brandových referencí, protože
     *  ty umí jen Pro cesta — za plnou cenu. Když je Pro nedostupné, render se
     *  odloží a dokončí později (`QualityUnavailableError` → zaparkovaný job),
     *  nikdy nedegraduje. Vědomě levný tier je `imageCheap`. */
    image: { primary: "gemini-3-pro-image" },
    /** Cheap image tier — Nano Banana 2 GA (supports 512px) */
    imageCheap: { primary: "gemini-3.1-flash-image" },
    /** Video tiers for reels */
    videoLite: { primary: "veo-3.1-lite-generate-preview" },
    videoFast: { primary: "veo-3.1-fast-generate-preview" },
    videoPremium: { primary: "veo-3.1-generate-preview" },
    /** Czech voiceover */
    tts: { primary: "gemini-3.1-flash-tts-preview", fallback: "gemini-2.5-flash-preview-tts" },
    /** Cross-family JUDGE — Anthropic Claude for the Critic + Chief Editor (the design rule:
     *  writer family ≠ judge family). A different family from the Gemini copywriter removes
     *  self-preference bias and makes the quality gate a genuine second opinion. `claude-sonnet-5`
     *  = current Sonnet (intro pricing $2/$10 per MTok through 2026-08-31). Env override:
     *  GEMINI_MODEL_JUDGE. Only used when ANTHROPIC_API_KEY is set — otherwise the judge falls
     *  back to the Gemini `textPro` Pro ladder (unchanged behaviour). See instagram/judge.ts. */
    judge: { primary: "claude-sonnet-5" },
    /** Týmový agent v Telegramu — čte skupinovou konverzaci, koriguje tvrzení proti
     *  datům a překládá „schval to" na strukturovaný záměr. Claude, ne Gemini, ze
     *  dvou důvodů: kouká na KAŽDOU zprávu, takže rozhoduje hlavně „mlčet, nebo se
     *  ozvat" — a v tom je zdrženlivost cennější než výřečnost; a runtime už Claude
     *  má (soudce), takže to nepřidává další rodinu do provozu. Env override:
     *  GEMINI_MODEL_TEAMAGENT. Bez ANTHROPIC_API_KEY kanál jen mlčí (viz
     *  lib/agents/telegram-agent.ts) — brief a tlačítka fungují dál. */
    teamAgent: { primary: "claude-sonnet-5" },
    /** Text embeddings — brand-memory relevance retrieval + the consistency score
     *  (pipeline v2, Stage 3). Both IDs live-verified 2026-07-02 via ai.models.list()
     *  + a real embedContent call; gemini-embedding-2 = current GA, 001 = prior GA.
     *  Always requested at 768 dims (EMBEDDING_DIMS) — must match the pgvector columns. */
    embedding: { primary: "gemini-embedding-2", fallback: "gemini-embedding-001" },
} as const

/** Output dimensionality for all embeddings — MUST match vector(768) columns in Supabase. */
export const EMBEDDING_DIMS = 768

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

/**
 * Temperature policy — the creativity↔consistency dial, separated by ROLE.
 * =======================================================================
 * Set EXPLICITLY because Gemini's default (~1.0, the most random setting) is wrong for
 * two of our roles:
 *  - JUDGES (Critic, Chief Editor, plan review) must be near-deterministic — the SAME
 *    caption has to earn the SAME score, or the quality gate can't enforce brand
 *    consistency (a noisy judge waves through off-brand posts on a lucky roll).
 *  - The COPYWRITER was running at ~1.0 → over-random voice post-to-post. Bounded
 *    creativity (0.75) keeps it lively without whiplash.
 * Idea/review brainstorming KEEPS high entropy (divergence is the point there).
 * Override per-environment without a deploy via GEMINI_TEMP_<ROLE> (e.g. GEMINI_TEMP_JUDGE=0.1).
 */
export const TEMPERATURES = {
    /** Critic, Chief Editor, plan/post review — reliability over creativity. */
    judge: 0.25,
    /** Copywriter + feedback revision — creative but bounded (was the ~1.0 default). */
    copywriter: 0.75,
    /** Ideas / reviews / context pulse — divergence is desirable. */
    creative: 0.9,
    /** AI Designer brief — art-directed but coherent: rotate the layout, not the brand vibe. */
    designer: 0.6,
} as const

export type TemperatureRole = keyof typeof TEMPERATURES

export function getTemperature(role: TemperatureRole): number {
    const override = process.env[`GEMINI_TEMP_${role.toUpperCase()}`]
    if (override !== undefined && override !== "") {
        const n = Number(override)
        if (!Number.isNaN(n)) return n
    }
    return TEMPERATURES[role]
}

/**
 * Thinking budget policy — kolik smí model „přemýšlet" před odpovědí.
 * =================================================================
 * Stejný tvar jako TEMPERATURES, protože jde o tutéž věc: rozhodnutí per ROLE, které
 * se nemá schovávat v call site.
 *
 *   -1 = dynamické (model si rozhodne sám — výchozí chování)
 *    0 = vypnuté
 *   >0 = strop v tokenech
 *
 * Thinking tokeny se účtují sazbou výstupu a přidávají latenci. U vysokoobjemových
 * mechanických kroků (roztřídit obrázek, vytáhnout souřadnice loga) nepřinášejí nic —
 * u soudce a copywritera naopak nesou přesně tu kvalitu, za kterou produkt platí Pro
 * tier. **Pro tierům rozpočet nesnižuj bez měření**; tichá degradace kvality je přesně
 * to, co se tu jinde nepřipouští (viz `generateTextQuality`).
 *
 * Override bez deploye: GEMINI_THINK_<ROLE> (např. GEMINI_THINK_CHEAP=0).
 */
export const THINKING = {
    /** Kritik, šéfredaktor, hodnocení plánu — úsudek stojí na uvažování. */
    judge: -1,
    /** Copywriter — caption je 80 % textové kvality produktu. */
    copywriter: -1,
    /** AI Designer brief — kompozice je taky úvaha. */
    designer: -1,
    /** Mechanické flash kroky: tagování assetů, detekce plochy pro logo, kontextový
     *  pulz. Odpověď je klasifikace nebo pár souřadnic — přemýšlení tu platíš bez
     *  protihodnoty. */
    cheap: 0,
} as const

export type ThinkingRole = keyof typeof THINKING

export function getThinkingBudget(role: ThinkingRole): number {
    const override = process.env[`GEMINI_THINK_${role.toUpperCase()}`]
    if (override !== undefined && override !== "") {
        const n = Number(override)
        if (Number.isInteger(n)) return n
    }
    return THINKING[role]
}
