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

// ─── Pillar Category ────────────────────────────────────────

/** Sub-category within a content pillar — specific content angle/theme */
export interface PillarCategory {
    /** URL-safe identifier, e.g. "soutez", "tip", "faq" */
    id: string
    /** Display name, e.g. "Soutěž" */
    label: string
    emoji: string
    /** AI prompt hint — what this category is about, angles to use */
    prompt?: string
    /** Weight within pillar (0-1, all categories should sum to ~1.0). Default = equal */
    weight?: number
    /** Preferred medium: undefined/"auto" = system decides */
    medium?: "auto" | "image" | "carousel"
    /** Preferred overlay style: undefined/"auto" = system decides based on post type */
    overlayStyle?: "auto" | "default" | "top" | "cover" | "editorial" | "centered" | "none"
    /** Preferred aspect ratio: undefined/"auto" = from config default */
    aspectRatio?: "auto" | "1:1" | "4:5" | "3:4"
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
    /** Sub-categories — specific content angles within this pillar */
    categories?: PillarCategory[]
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
    /** Primary brand accent color (hex, e.g. "#e63946") for keyword highlighting in overlay text.
     * When set, AI-selected accentWords in the headline will render in this color instead of white. */
    accentColor?: string
    /** Default text alignment for overlay (default: "center") */
    textAlign?: "left" | "center" | "right"
    /** Default headline scale multiplier (default: 1.0) */
    headlineScale?: number
    /** Typography vibe for the native design engine — style guidance, not a font file.
     * E.g. "bold condensed grotesque, uppercase" or "elegant high-contrast serif" */
    typographyStyle?: string
    /** Logo placement preference for the native design engine (default "auto" — AI Designer decides per post) */
    logoPlacement?: "auto" | "top-left" | "top-right" | "bottom-left" | "bottom-right"
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

export type AspectRatio = "1:1" | "4:5" | "3:4" | "4:3" | "9:16" | "16:9"
export type PostMedium = "image" | "carousel" | "reel"
export type OverlayStyle = "default" | "cover" | "step" | "minimal" | "none" | "centered" | "top" | "split" | "full-typo" | "editorial"

export interface PostFormat {
    /** Image/video aspect ratio */
    aspectRatio: AspectRatio
    /** Post type: single image, carousel, or reel */
    medium: PostMedium
    /** Text overlay style */
    overlayStyle: OverlayStyle
    /** Reel duration in seconds (default: 8, range: 5-8 for 1080p Veo 3.1) */
    reelDuration?: number
}

// ─── Audience Persona ───────────────────────────────────────

export interface AudiencePersona {
    /** Short label, e.g. "Začátečník", "Skeptik" */
    label: string
    /** Age range, e.g. "25-35" */
    ageRange: string
    /** What they struggle with / want */
    painPoints: string[]
    /** What content hooks work on them */
    triggers: string[]
    /** Preferred CTA approach */
    ctaStyle: "soft" | "medium" | "hard"
}

// ─── Image Brief (Shot List) ───────────────────────────────

/** AI-generated shot list item — tells client what photos to provide */
export interface ImageBriefItem {
    /** Category label, e.g. "Prostředí", "Produkty", "Tým" */
    category: string
    emoji: string
    /** How many photos recommended, e.g. "3-5 fotek" */
    count: string
    priority: 'must' | 'nice'
    /** Specific photo descriptions */
    items: string[]
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

    /** Industry/niche for context agent, e.g. "gastronomie", "e-commerce", "ubytování" */
    industry?: string
    /** City for weather + local context, e.g. "Český Krumlov", "Praha" */
    city?: string

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

    /** Products catalog (for merch/eshop clients) @deprecated Use ig_products table instead */
    products?: ProductInfo[]

    /** Cooldown in days before a product can be featured again (default: 14) */
    productCooldownDays?: number

    /** Post types this client uses */
    postTypes?: string[]

    /** What the brand is about — used in AI prompt instructions, e.g. "O TELEFONECH a screen time" or "O MERCHI a streetwearu" */
    contentFocus: string

    /** Logo watermark filename inside instagram/fonts/ dir, e.g. "logo-mobilnamiru.png" */
    logoFile?: string

    /** Visual rendering engine (default "native"):
     *  "native"  — Nano Banana Pro composes the full post incl. Czech typography + logo,
     *              verified by vision QA with corrective retry
     *  "overlay" — legacy: text-free AI background + Satori/Sharp text overlay */
    visualEngine?: "native" | "overlay"

    /** Veo tier for reel video generation (default "fast") */
    videoTier?: "lite" | "fast" | "premium"

    /** Gradient colors for text-overlay.ts (replaces hardcoded blue/purple) */
    overlayGradient?: OverlayGradient

    /** Název Supabase public bucketu pro ukládání obrázků tohoto klienta (fallback: "audit-screenshots") */
    storageBucket?: string

    /** Per-post-type image description instructions for mega prompt */
    imageInstructions?: Record<string, string>

    /** Video script instructions (what to show, visual focus) */
    videoFocus?: string

    /** TTS voice preset for voiceover (Gemini TTS voice name, e.g. "Kore", "Puck", "Charon") */
    ttsVoice?: string

    /** Per-post-type format overrides (aspect ratio, medium, overlay style) */
    postFormats?: Record<string, PostFormat>

    /** Default format when not specified per post type */
    defaultFormat?: PostFormat

    /** Character description for consistent person in AI-generated images.
     *  If set, this description is injected into every image prompt so
     *  Imagen generates the same recognizable person across all posts. */
    characterDescription?: string

    /** Audience personas — AI tailors content tone, hooks, and CTAs per persona.
     *  Generated during onboarding based on business type and target audience. */
    audiencePersonas?: AudiencePersona[]

    /** Psycholog — vrství prodejní psychologii (persuaze, emoce, CTA) do copywriterova
     *  promptu. Deterministické, žádné AI volání. Default true; nastav false pro vypnutí. */
    psychologist?: boolean

    /** AI-doporučený styl komunikace pro tohoto KONKRÉTNÍHO klienta — vygenerováno na
     *  konci onboardingu (generateConfigCore), zobrazeno v review kroku a uloženo do
     *  configu. Zatím display/reference pro klienta; engine ho přímo nečte. */
    communicationStyle?: {
        headline: string
        rationale: string
        dos: string[]
        donts: string[]
    }

    /** @deprecated Use brandReferenceImages instead */
    characterReferenceImages?: string[]

    /** Brand reference photos (scraped during onboarding, or uploaded manually).
     *  Used as visual references for AI image generation.
     *  Supports both legacy flat URLs and new tagged objects.
     *  Up to 30 images stored in Supabase storage. */
    brandReferenceImages?: (string | BrandImage)[]

    /** AI-generated shot list — what photos the client should provide.
     *  Generated during onboarding, displayed in BrandTab as "what’s missing". */
    imageBrief?: ImageBriefItem[]

    /** Snapshot from the onboarding IG scrape — cold-start baseline for
     *  planning (bestPostingTimes → planWeek) and performance context
     *  until the engine has its own metrics. */
    igBaseline?: {
        followerCount: number
        avgEngagementRate: number
        topHashtags: string[]
        contentMix: Record<string, number>
        bestPostingTimes?: string[]
        /** ISO timestamp of the scrape */
        scrapedAt: string
    }

    /** Marks a fictional demo/reference brand (seeded via scripts/seed-reference-clients.ts).
     *  Its generated posts are surfaced as case-study references on the marketing site.
     *  Not a real paying customer. */
    isReference?: boolean
}

// ─── Brand Image Type ────────────────────────────────────────────────

/** Tagged brand reference image with AI-generated metadata */
export interface BrandImage {
    /** Public URL in Supabase storage */
    url: string
    /** AI-generated tags: exterior, interior, bedroom, bathroom, kitchen, living,
     *  pool, restaurant, team, product, logo, food, nature, detail, lobby, garden */
    tags: string[]
    /** AI-generated one-sentence description in Czech */
    description: string
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Canonical way to read brand reference image URLs from any config object.
 * Handles both legacy flat string arrays AND new BrandImage objects.
 * Returns flat array of URL strings.
 * 
 * ALWAYS use this instead of accessing the fields directly.
 */
export function getConfigBrandImages(config: ClientConfig | Record<string, any> | null | undefined): string[] {
    const objects = getConfigBrandImageObjects(config)
    return objects.map(img => img.url)
}

/**
 * Get brand reference images as full BrandImage objects (with tags + description).
 * Normalizes legacy string entries into BrandImage objects with empty metadata.
 */
export function getConfigBrandImageObjects(config: ClientConfig | Record<string, any> | null | undefined): BrandImage[] {
    if (!config) return []
    const primary = (config as any).brandReferenceImages
    const legacy = (config as any).characterReferenceImages

    let raw: (string | BrandImage)[] = []
    if (Array.isArray(primary) && primary.length > 0) {
        raw = primary
    } else if (Array.isArray(legacy) && legacy.length > 0) {
        raw = legacy
    }

    // Normalize: strings → BrandImage with empty metadata
    return raw.map(item => {
        if (typeof item === 'string') {
            return { url: item, tags: [], description: '' }
        }
        return item as BrandImage
    })
}
