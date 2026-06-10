/**
 * Shared TypeScript types for Instagram dashboard tab components.
 * Replaces `any` usage across PostsTab, GenerateTab, PerformanceTab, etc.
 */

// ═══════════════════════════════════════════════════════════
// DATABASE ENTITY TYPES
// ═══════════════════════════════════════════════════════════

// Shared entity types — single source of truth in lib/types/database.ts
export type { IGPost } from "@/lib/types/database"
import type { IGPostType as DBPostType } from "@/lib/types/database"
/** Post type definition from ig_post_types (+ resolved pillar for UI) */
export type IGPostType = DBPostType & { pillarId?: string | null }

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

/** Product from ig_products table */
export interface IGProduct {
    id: string
    name: string
    type: string | null
    slug: string
    variants: number | null
    price: string | null
    description: string | null
    image_urls: string[] | null
    created_at: string
}
