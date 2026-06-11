/**
 * Shared types for media orchestrators (image, carousel, reel).
 * Extracted from autopilot.ts to enable clean dependency injection.
 */

import type { ClientConfig, PostFormat } from "../configs/types"
import type { PostType } from "../types"
import type { DesignBrief } from "../image-pipeline"

export type ProgressReporter = (stage: string, progress: number, message: string) => Promise<void>

export interface CaptionData {
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
    visualTheme?: string
}

export interface SelectedProduct {
    name: string
    type: string
    slug: string
    price?: string
    description?: string
    imageUrls?: string[]
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
    /** Concept strings of recent posts' design briefs — anti-repetition input for the AI Designer */
    recentBriefs?: string[]
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
}
