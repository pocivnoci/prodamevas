/**
 * Multi-Client Configuration Types
 * =================================
 * Complete type system for per-client brand configs.
 * Adding a new client = implementing this interface in configs/
 */

import type { BrandVoiceConfig } from "../types"
import type { FeedPatternId } from "../../lib/feed-pattern"
import type { MediumType } from "../../lib/credits"

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
    /** Preferred medium: undefined/"auto" = system decides.
     *  Deliberately narrower than PostMedium — steering the autopilot into a reel or a
     *  story from a pillar category is a content-plan decision, and plans don't carry
     *  stories yet. Widen together with content-plan-actions.ts. */
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
    /** Audience persona (by `label`) this pillar speaks to. Pins the target segment so the
     *  brand voice is coherent within a pillar instead of randomly switching personas per
     *  post. Falls back to a stable per-post-type persona when unset. See selectPersonaForPost. */
    targetPersona?: string
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
    /** @deprecated Legacy Satori text-overlay font override — the native engine renders its
     *  own typography (see typographyStyle). No longer read by the render pipeline. */
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
/** Defined by the credit table (lib/credits.ts) — every renderable medium is priced.
 *  Adding a medium there is what opens it here; there is no second list to sync. */
export type PostMedium = MediumType
export type OverlayStyle = "default" | "cover" | "step" | "minimal" | "none" | "centered" | "top" | "split" | "full-typo" | "editorial"

export interface PostFormat {
    /** Image/video aspect ratio */
    aspectRatio: AspectRatio
    /** Post type: single image, story set, carousel, or reel */
    medium: PostMedium
    /** Text overlay style */
    overlayStyle: OverlayStyle
    /** Reel duration in seconds (default: 8, range: 5-8 for 1080p Veo 3.1) */
    reelDuration?: number
}

/** Stropy délky kreativního briefu formátu — drží formát INVARIANTEM.
 *
 *  Původních 400/600/400 znaků si storyboard vynutilo samo: do takového prostoru model
 *  spolehlivě napíše scénář JEDNOHO konkrétního postu (včetně přesných replik a CTA),
 *  ten se pak vkládá do promptu u každého postu daného formátu a vrací se donekonečna.
 *  `PillarCategory.prompt` zůstává zdravý právě proto, že je to jedna věta.
 *
 *  Platí na AI-generované briefy (onboarding + fast-path v Nastavení). Ruční editaci
 *  uživatele neomezujeme — tam jen varuje `warnOnScenicFormats()`. */
export const FORMAT_BRIEF_LIMITS = {
    description: 160,
    structure: 220,
    visualStyle: 160,
} as const

/** A brand-specific post format generated at onboarding. Richer than a bare
 *  `postTypes` name: a creative BRIEF describing the format's MECHANISM —
 *  description (how the format works on the reader), structure (abstract beat
 *  sequence) and visualStyle (production qualities). The engine reads the def from
 *  config (source of truth); `ig_post_types` rows carry a copy for the UI picker.
 *
 *  ⚠️ INVARIANT: a format is a template instantiated by DOZENS of different posts.
 *  It must never carry a concrete scene, a proper name, a location, an occasion or
 *  finished copy — those belong to the IDEA (`ig_post_ideas`). See FORMAT_BRIEF_LIMITS. */
export interface PostTypeDef {
    /** snake_case slug, no diacritics — the pipeline key (config.postTypes, ig_post_types.name) */
    name: string
    display_name: string
    emoji: string
    /** Brand-specific: what the post shows + why it works for this brand */
    description: string
    /** Content skeleton the copywriter must follow — for carousels a slide-by-slide
     *  outline ("Slide 1: podmínky, Slide 2: výhra…"), for reels a scene arc, for
     *  images a caption arc. Empty = the medium's generic skeleton applies. */
    structure?: string
    /** How posts of this format should LOOK (composition, mood, props) — injected
     *  into the AI Designer brief alongside the brand kit. */
    visualStyle?: string
    /** Content pillar key this format belongs to */
    pillar: string
    medium: PostMedium
    aspectRatio: AspectRatio
    /** true = the post is built around a specific product (pulls from ig_products) */
    uses_product: boolean
    /** true = user-triggered only (Generate-tab picker); autopilot's random type
     *  selection and the content planner must never auto-pick it. Guards formats
     *  with real-world commitments — giveaways, contests, limited drops. */
    manualOnly?: boolean
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

/** A canonical "this is exactly how we sound" caption — the brand-voice anchor.
 *  Few-shot examples steer voice far more reliably than abstract trait lists. Seeded at
 *  onboarding from the brand's real top posts and grown by promoting A/B winners / top
 *  performers (human-curated). Injected into the copywriter prompt — see
 *  buildGoldExamplesSection in caption-generator.ts. */
export interface BrandVoiceExample {
    /** The exemplar caption text (real, approved). */
    caption: string
    /** Optional: why it's exemplary / when it applies — helps the model generalize. */
    note?: string
    /** Optional: the post type this exemplifies (used to prefer relevant examples). */
    postType?: string
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

    /** Canonical voice examples ("this is exactly how we sound") — few-shot anchor injected
     *  into every caption prompt. The strongest lever for post-to-post voice consistency.
     *  Empty = cold start (section skipped gracefully). See validateConfig() default. */
    brandVoiceExamples?: BrandVoiceExample[]

    /** Content pillars for Growth Engine */
    contentPillars: Record<string, ContentPillar>

    /** CTA text variations grouped by strategy level */
    ctaStrategies: Record<"soft" | "medium" | "hard" | "none", string[]>

    /** Visual identity for feed cohesion */
    feedAesthetic: FeedAesthetic

    /** Visual rhythm of the profile GRID (see lib/feed-pattern.ts). Deliberately top-level and
     *  not part of feedAesthetic: feedAesthetic describes a single image and is poured into the
     *  designer prompt verbatim, whereas this decides — per grid position — which family of
     *  layouts a post may use. Seeded at onboarding from the brand's real feed, user-editable.
     *  validateConfig clamps unknown values to "none". */
    feedPattern?: FeedPatternId

    /** Static week plan — array of post type names (Mon→Sun, 2 per day) */
    weekPlan: string[]

    /** Real posting cadence (posts per week). Seeded at onboarding from the brand's actual
     *  IG history (median gap between recent posts, clamped 2–7); defaults to 4 when unknown.
     *  Content-plan length derives from this (duration × postsPerWeek) — a "week" is this many
     *  posts, NOT 7. See validateConfig() for the safe default. */
    postsPerWeek?: number

    /** Auto-publish: when true AND a live Instagram connection exists, the daily
     *  auto-publish agent arms `ready` posts → `scheduled` on `postsPerWeek` cadence,
     *  maintaining a bounded forward buffer (see lib/agents/auto-publish.ts). The
     *  account then posts hands-free. OFF by default — arming stays a human step
     *  (ready→scheduled) for every tenant that hasn't opted in. Reels are never
     *  auto-armed (no auto-publish video path). validateConfig defaults false. */
    autoPublish?: boolean

    /** Idea-bank auto-replenishment: the daily-ops agent tops the available
     *  (active, off-cooldown) pool of ig_post_ideas up to a cadence-derived runway
     *  when it drops low (free, bounded — see lib/agents/idea-replenish.ts). ON by
     *  default: new ideas are inert bank rows the user can deactivate in the Nápady
     *  tab. Set false to opt a client out. validateConfig defaults true. */
    autoReplenishIdeas?: boolean

    /** Preferred posting times ("HH:MM", Prague LOCAL) for auto-publish + plan spread.
     *  Empty/undefined → engine defaults (09:00/17:00/19:00). A 2×/day cadence uses the
     *  first two, a ≤daily cadence rotates through them. See lib/schedule-planner.ts. */
    postingTimes?: string[]

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

    /** Post types this client uses (names — pipeline contract) */
    postTypes?: string[]

    /** Brand-specific post formats (richer than `postTypes`): display name +
     *  description per format. Generated at onboarding, persisted to ig_post_types,
     *  shown in the Generate-tab format picker. Empty = legacy generic behaviour. */
    postTypeDefs?: PostTypeDef[]

    /** What the brand is about — used in AI prompt instructions, e.g. "O TELEFONECH a screen time" or "O MERCHI a streetwearu" */
    contentFocus: string

    /** Logo filename, loaded from instagram/assets/ or Supabase storage (see logo-loader.ts),
     *  e.g. "logo-mobilnamiru.png" */
    logoFile?: string

    /** Veo tier for reel video generation (default "fast") */
    videoTier?: "lite" | "fast" | "premium"

    /** @deprecated Legacy Satori text-overlay gradient — the native engine renders its own
     *  typography. Kept so old configs don't lose data; no longer read by the render pipeline. */
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
