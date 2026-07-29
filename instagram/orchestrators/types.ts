/**
 * Shared types for media orchestrators (image, carousel, reel).
 * Extracted from autopilot.ts to enable clean dependency injection.
 */

import type { ClientConfig, PostFormat } from "../configs/types"
import type { PostType } from "../types"
import type { DesignBrief } from "../image-pipeline"
import type { SlotIntent } from "../../lib/feed-pattern"

export type ProgressReporter = (stage: string, progress: number, message: string) => Promise<void>

export interface CaptionData {
    /** Angle commit — 1 Czech sentence the copywriter declared before writing (originality anchor). */
    angle?: string
    hook: string
    body?: string
    cta: string
    hashtags: string[]
    imagePrompt?: string
    imageSubtext?: string
    accentWords?: string[]
    videoScript?: string
    scenes?: { timeRange: string; visual: string; camera: string; mood: string; narration?: string; soundEffect?: string }[]
    caption?: string
    slides?: { headline: string; subtext: string; imagePrompt: string }[]
    /** Story only — 1-3 vertical frames INCLUDING the first (frames[0].headline === hook). */
    frames?: { headline: string; subtext: string; imagePrompt: string }[]
    visualTheme?: string
}

export interface ProductSpecs {
    volume?: string
    application?: string
    surface?: string
    claims?: string[]
}

export interface SelectedProduct {
    name: string
    type: string
    slug: string
    price?: string
    description?: string
    imageUrls?: string[]
    /** Product-line membership — lets copy say "krok 3 z 5" instead of guessing */
    lineId?: string
    lineName?: string
    lineStep?: number
    lineRole?: string
    /** Verified facts (objem, aplikace, povrch, claims) — grounding, not invention */
    specs?: ProductSpecs
}

export interface RenderContext {
    config: ClientConfig
    captionData: CaptionData
    format: PostFormat
    selectedType: PostType
    report: ProgressReporter
    selectedProduct?: SelectedProduct
    linkedProductId?: string
    clientUuid: string
    /** Style fingerprints of recent posts' design briefs — anti-repetition input for the AI Designer */
    recentBriefs?: string[]
    /** Layout archetypes of the most recent posts — hard-banned for the next design brief */
    recentArchetypes?: string[]
    /** This post's cell in the feed pattern — narrows the designer to that slot's archetype
     *  family so the profile grid forms a deliberate rhythm (see lib/feed-pattern.ts). */
    slotIntent?: SlotIntent
    /** User's own uploaded photo (public URL) — the render must be visibly built from it */
    userPhotoUrl?: string
    /** Vision description of that photo — the text-only AI Designer's window into it */
    userPhotoDescription?: string
}

export interface RenderResult {
    imageUrl?: string
    cost: number
    /** e.g. "native:<concept-slug>" or "overlay:<variant>" — stored as ig_posts.image_style */
    imageStyle?: string
    /** Full design brief (native engine) — stored as ig_posts.design_brief */
    designBrief?: DesignBrief
    /** Native QA outcome: pass | retry_pass | fallback | overlay */
    qaStatus?: string
    /** The image model tier that actually rendered the SHIPPED buffer (e.g. "gemini-3-pro-image"
     *  or the fallback "gemini-3.1-flash-image") — truthful even when a mid-generation 503
     *  silently dropped to the weaker fallback tier. Distinct from the static getModel("image"). */
    imageModel?: string
}
