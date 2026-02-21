/**
 * Instagram Module - Type Definitions
 * ====================================
 * Type system for Instagram content automation
 */

import type { Tables } from "../supabase/generated.types"

// ============================================
// DATABASE TYPES (re-export for convenience)
// ============================================

export type PostType = Tables<"ig_post_types">
export type PostIdea = Tables<"ig_post_ideas">
export type Review = Tables<"ig_reviews">
export type Post = Tables<"ig_posts">
export type ContentCalendar = Tables<"ig_content_calendar">

// ============================================
// GENERATION PIPELINE TYPES
// ============================================

/**
 * Options for content generation
 */
export interface GenerateOptions {
    /** Specific post type (tip_nastaveni, statistika, etc.) */
    type?: string
    /** Idea category filter (nastaveni, produktivita, wellbeing) */
    category?: string
    /** Optional topic override */
    topic?: string
    /** Scheduled publication date */
    scheduledFor?: string
    /** Generate without saving to database */
    dryRun?: boolean
    /** Skip image generation (saves API costs) */
    skipImage?: boolean
}

// ============================================
// BRAND VOICE TYPES
// ============================================

/** Emotional trigger types for hooks */
export type EmotionalHook = "curiosity" | "fear" | "hope" | "humor" | "urgency" | "empathy"

/**
 * Tone modifiers for different post types
 */
export type ToneModifier = {
    humorLevel: 1 | 2 | 3 | 4 | 5  // 1 = serious, 5 = very funny
    urgencyLevel: 1 | 2 | 3 | 4 | 5  // 1 = relaxed, 5 = urgent
    intimacyLevel: 1 | 2 | 3 | 4 | 5  // 1 = formal, 5 = very personal
    educationalLevel: 1 | 2 | 3 | 4 | 5  // 1 = entertainment, 5 = deep education
}

/**
 * Hook template with example
 */
export interface HookTemplate {
    /** Template pattern with {{placeholders}} */
    pattern: string
    /** Example of filled template */
    example: string
    /** Best for which post types */
    bestFor: string[]
    /** Emotional trigger */
    trigger: EmotionalHook
}

/**
 * Complete brand voice configuration
 */
export interface BrandVoiceConfig {
    /** Brand persona description */
    persona: string
    /** Core values */
    values: string[]
    /** Voice characteristics */
    voiceTraits: string[]
    /** Things to avoid */
    antiPatterns: string[]
    /** Hook templates */
    hookTemplates: HookTemplate[]
    /** CTA variations */
    ctaVariations: string[]
    /** Tone modifiers per post type */
    toneByPostType: Record<string, ToneModifier>
}
