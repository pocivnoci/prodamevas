/**
 * Multi-Client Configuration Types
 * =================================
 * Complete type system for per-client brand configs.
 * Adding a new client = implementing this interface in configs/
 */

import type { BrandVoiceConfig } from "../types"

// ─── Product ────────────────────────────────────────────────

export interface ProductInfo {
    name: string
    type: string
    /** URL slug on eshop, e.g. "triko-mrdke-gang-white-black" */
    slug: string
    variants?: number
    price?: string
    description?: string
    /** Cached CDN image URLs (populated by eshop-scraper) */
    imageUrls?: string[]
}

// ─── Content Pillar ─────────────────────────────────────────

export interface ContentPillar {
    emoji: string
    label: string
    description: string
    /** Post types that belong to this pillar */
    postTypes: string[]
    /** Ratio of total content (0.0–1.0, all pillars should sum to 1.0) */
    ratio: number
    /** CTA intensity for this pillar */
    ctaStrategy: "soft" | "medium" | "hard" | "none"
    /** KPIs to optimize for */
    kpi: string[]
    /** Optional prompt section for idea generation — examples, angles, tips */
    ideaPrompt?: string
}

// ─── Feed Aesthetic ─────────────────────────────────────────

export interface FeedAesthetic {
    /** Color palette description, e.g. "Deep blue (#1a1a3e) to purple (#4a0e78) gradient" */
    colorPalette: string
    /** Overlay opacity, e.g. "30-40%" */
    overlayOpacity: string
    /** Where text sits on image, e.g. "BOTTOM" */
    textPosition: string
    /** Font family, e.g. "SF Pro, Inter, Helvetica Neue" */
    font: string
    /** Overall visual feel, e.g. "Premium, Apple-style minimalism" */
    feel: string
    /** Phone model for consistency, e.g. "iPhone 17 Pro Max" */
    phoneModel: string
    /** Extra brand-specific visual instructions for the image prompt */
    customInstructions?: string
    /** Font family override for text overlay — must match font files in fonts/ dir.
     * Available: "Inter" (default), "BebasNeue" */
    fontOverride?: string
}

// ─── Overlay Gradient ───────────────────────────────────────

export interface OverlayGradient {
    /** Top color (hex), e.g. "#1a1a3e" */
    topColor: string
    /** Middle color (hex), e.g. "#2d1854" */
    midColor: string
    /** Bottom color (hex, same as top or different), e.g. "#1a1a3e" */
    bottomColor: string
}

// ─── Post Format ────────────────────────────────────────────

export type AspectRatio = "1:1" | "3:4" | "4:3" | "9:16" | "16:9"
export type PostMedium = "image" | "carousel" | "reel"
export type OverlayStyle = "default" | "cover" | "step" | "minimal" | "none"

export interface PostFormat {
    /** Image/video aspect ratio */
    aspectRatio: AspectRatio
    /** Post type: single image, carousel, or reel */
    medium: PostMedium
    /** Text overlay style */
    overlayStyle: OverlayStyle
}

// ─── Client Config ──────────────────────────────────────────

export interface ClientConfig {
    /** Unique client ID (used as project_id in DB) */
    id: string
    /** Display name */
    name: string
    /** Client website */
    website: string
    /** Instagram handle */
    instagram: string

    /** Brand voice configuration (persona, hooks, tones, anti-patterns) */
    brandVoice: BrandVoiceConfig

    /** Content pillars for Growth Engine */
    contentPillars: Record<string, ContentPillar>

    /** CTA text variations grouped by strategy level */
    ctaStrategies: Record<"soft" | "medium" | "hard" | "none", string[]>

    /** Visual identity for feed cohesion */
    feedAesthetic: FeedAesthetic

    /** Static week plan — array of post type names (Mon→Sun, 2 per day) */
    weekPlan: string[]

    /** Hashtag pools */
    hashtagPools: {
        core: string[]
        niche: string[]
        broad: string[]
        trending: string[]
        czech: string[]
    }

    /** Products catalog (for merch/eshop clients) */
    products?: ProductInfo[]

    /** Post types this client uses */
    postTypes?: string[]

    /** What the brand is about — used in AI prompt instructions, e.g. "O TELEFONECH a screen time" or "O MERCHI a streetwearu" */
    contentFocus: string

    /** Logo watermark filename inside instagram/fonts/ dir, e.g. "logo-mobilnamiru.png" */
    logoFile?: string

    /** Gradient colors for text-overlay.ts (replaces hardcoded blue/purple) */
    overlayGradient?: OverlayGradient

    /** Název Supabase public bucketu pro ukládání obrázků tohoto klienta (fallback: "audit-screenshots") */
    storageBucket?: string

    /** Per-post-type image description instructions for mega prompt */
    imageInstructions?: Record<string, string>

    /** Video script instructions (what to show, visual focus) */
    videoFocus?: string

    /** Per-post-type format overrides (aspect ratio, medium, overlay style) */
    postFormats?: Record<string, PostFormat>

    /** Default format when not specified per post type */
    defaultFormat?: PostFormat

    /** Character description for consistent person in AI-generated images.
     *  If set, this description is injected into every image prompt so
     *  Imagen generates the same recognizable person across all posts. */
    characterDescription?: string

    /** URLs to reference photos of the brand character.
     *  Used by Gemini 3 Pro Image for face/likeness consistency.
     *  Max 5 human images supported. Fetched at runtime. */
    characterReferenceImages?: string[]
}
