/**
 * Shared TypeScript types for Instagram dashboard tab components.
 * Replaces `any` usage across PostsTab, GenerateTab, PerformanceTab, etc.
 */

// ═══════════════════════════════════════════════════════════
// DATABASE ENTITY TYPES
// ═══════════════════════════════════════════════════════════

/** Instagram post from ig_posts table (with joined post type) */
export interface IGPost {
    id: string
    caption: string | null
    hashtags: string[] | null
    image_url: string | null
    image_prompt: string | null
    status: "draft" | "ready" | "posted" | "archived"
    content_pillar: string | null
    quality_score: number | null
    created_at: string
    likes: number | null
    comments: number | null
    shares: number | null
    saves: number | null
    reach: number | null
    profile_visits: number | null
    link_clicks: number | null
    feedback: string | null
    revision_of: string | null
    ig_post_types?: {
        display_name: string
        emoji: string
    } | null
}


/** Post type definition from ig_post_types */
export interface IGPostType {
    id: string
    name: string
    display_name: string
    emoji: string
    is_active: boolean
    pillarId?: string
}

/** Post format settings per type */
export interface IGPostFormat {
    aspectRatio: string
    medium: string
    overlayStyle: string
}

/** Content category/pillar */
export interface IGCategory {
    id: string
    emoji: string
    label: string
}

/** Generation log entry */
export interface IGLog {
    id: string
    type: string
    status: string
    caption_preview: string | null
    image_url: string | null
    error_message: string | null
    created_at: string
    duration_ms: number | null
}

/** Idea entry */
export interface IGIdea {
    id: string
    title: string
    description: string | null
    category: string | null
    status: string
    created_at: string
}

/** Review entry */
export interface IGReview {
    id: string
    text: string
    author: string | null
    rating: number | null
    status: string
    approved: boolean
    created_at: string
}
