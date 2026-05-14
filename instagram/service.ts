/**
 * Instagram Service - Helper functions for IG content management
 * Multi-tenant: all queries filter by client_id (uuid FK to clients table)
 */

import supabaseAdmin from "../supabase/admin";

// ============================================
// MULTI-TENANT: Active client (uuid)
// ============================================

let _activeClientId: string | null = null

/** Set the active client uuid for all subsequent queries */
export function setActiveProject(clientId: string) {
    _activeClientId = clientId
}

/** Get the current active client uuid */
export function getActiveProject(): string {
    if (!_activeClientId) throw new Error("No active client set. Call setActiveProject(clientId) first.")
    return _activeClientId
}

// Type aliases for cleaner code
export type PostType = any;
export type PostIdea = any;
export type Review = any;
export type Post = any;
export type ContentCalendar = any;

// ============================================
// POST TYPES
// ============================================

export async function getActivePostTypes(allowedNames?: string[]): Promise<PostType[]> {
    let query = supabaseAdmin
        .from("ig_post_types")
        .select("*")
        .eq("is_active", true)
        .eq("client_id", getActiveProject())
        .order("name");

    // Multi-tenant: filter to only post types used by the active project
    if (allowedNames && allowedNames.length > 0) {
        query = query.in("name", allowedNames)
    }

    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
}

export async function getPostTypeByName(name: string): Promise<PostType | null> {
    const { data, error } = await supabaseAdmin
        .from("ig_post_types")
        .select("*")
        .eq("name", name)
        .eq("client_id", getActiveProject())
        .single();

    if (error) return null;
    return data;
}

/**
 * Auto-sync post types from client config into DB.
 * Creates any post types that exist in the config but are missing in ig_post_types.
 * Safe to call multiple times — idempotent (won't duplicate).
 */
export async function ensurePostTypes(
    config: {
        postTypes?: string[]
        contentPillars?: Record<string, { emoji: string; label: string; description: string; postTypes: string[] }>
        brandVoice?: { toneByPostType?: Record<string, unknown> }
    },
    clientId: string
): Promise<void> {
    const configTypes = config.postTypes ?? []
    if (configTypes.length === 0) return

    // Use admin client to bypass RLS for post type management
    const { data: existing, error } = await supabaseAdmin
        .from("ig_post_types")
        .select("name")
        .eq("client_id", clientId)

    if (error) {
        console.error("⚠️ Failed to check existing post types:", error.message)
        return
    }

    const existingNames = new Set((existing ?? []).map(t => t.name))
    const missing = configTypes.filter(name => !existingNames.has(name))

    if (missing.length === 0) return

    // Build a pillar lookup: postTypeName → { emoji, label }
    const pillarLookup = new Map<string, { emoji: string; label: string }>()
    if (config.contentPillars) {
        for (const pillar of Object.values(config.contentPillars)) {
            for (const pt of pillar.postTypes) {
                pillarLookup.set(pt, { emoji: pillar.emoji, label: pillar.label })
            }
        }
    }

    // Auto-generate display names and emojis from pillar data
    const rows = missing.map(name => {
        const pillar = pillarLookup.get(name)
        const displayName = name
            .split("_")
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ")

        return {
            client_id: clientId,
            name,
            display_name: pillar ? `${pillar.emoji} ${displayName}` : displayName,
            emoji: pillar?.emoji ?? "📝",
            description: pillar ? `${pillar.label} pillar` : null,
            frequency: "weekly" as const,
            is_active: true,
        }
    })

    const { error: insertError } = await supabaseAdmin
        .from("ig_post_types")
        .insert(rows)

    if (insertError) {
        console.error("⚠️ Failed to insert post types:", insertError.message)
    } else {
        console.log(`   ✅ Auto-created ${rows.length} post types: ${missing.join(", ")}`)
    }
}

// ============================================
// POST IDEAS
// ============================================

export async function getAvailableIdeas(category?: string): Promise<PostIdea[]> {
    const now = new Date();

    let query = supabaseAdmin
        .from("ig_post_ideas")
        .select("*")
        .eq("is_active", true)
        .eq("client_id", getActiveProject());

    if (category) {
        query = query.eq("category", category);
    }

    const { data, error } = await query.order("used_count", { ascending: true });

    if (error) throw error;

    // Filter out ideas that are still in cooldown
    return (data ?? []).filter(idea => {
        if (!idea.last_used_at) return true;
        const lastUsed = new Date(idea.last_used_at);
        const cooldownDays = idea.cooldown_days ?? 60;
        const cooldownEnd = new Date(lastUsed.getTime() + cooldownDays * 24 * 60 * 60 * 1000);
        return now > cooldownEnd;
    });
}

export async function markIdeaAsUsed(ideaId: string): Promise<void> {
    // Get current count and increment
    const { data } = await supabaseAdmin
        .from("ig_post_ideas")
        .select("used_count")
        .eq("id", ideaId)
        .single();

    await supabaseAdmin
        .from("ig_post_ideas")
        .update({
            used_count: (data?.used_count ?? 0) + 1,
            last_used_at: new Date().toISOString()
        })
        .eq("id", ideaId);
}

export async function addIdea(idea: any): Promise<PostIdea> {
    const { data, error } = await supabaseAdmin
        .from("ig_post_ideas")
        .insert(idea)
        .select()
        .single();

    if (error) throw error;
    return data;
}

export async function batchInsertIdeas(ideas: any[]): Promise<number> {
    if (ideas.length === 0) return 0;
    // Inject client_id into all ideas
    const ideasWithClient = ideas.map(i => ({ ...i, client_id: getActiveProject() }))
    const { data, error } = await supabaseAdmin
        .from("ig_post_ideas")
        .insert(ideasWithClient)
        .select("id");

    if (error) throw error;
    return data?.length ?? 0;
}

// ============================================
// REVIEWS
// ============================================

export async function getApprovedReviews(): Promise<Review[]> {
    const query = supabaseAdmin
        .from("ig_reviews")
        .select("*")
        .eq("is_approved", true)
        .eq("client_id", getActiveProject())
        .is("used_at", null)
        .order("created_at", { ascending: false });

    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
}

export async function markReviewAsUsed(reviewId: string): Promise<void> {
    await supabaseAdmin
        .from("ig_reviews")
        .update({ used_at: new Date().toISOString() })
        .eq("id", reviewId);
}

export async function addReview(review: any): Promise<Review> {
    const { data, error } = await supabaseAdmin
        .from("ig_reviews")
        .insert(review)
        .select()
        .single();

    if (error) throw error;
    return data;
}

// ============================================
// POSTS
// ============================================

export async function getRecentPosts(limit: number = 30): Promise<Post[]> {
    const { data, error } = await supabaseAdmin
        .from("ig_posts")
        .select("*")
        .eq("client_id", getActiveProject())
        .order("created_at", { ascending: false })
        .limit(limit);

    if (error) throw error;
    return data ?? [];
}

export async function getPostsByStatus(status: "draft" | "ready" | "posted"): Promise<Post[]> {
    const { data, error } = await supabaseAdmin
        .from("ig_posts")
        .select("*")
        .eq("status", status)
        .eq("client_id", getActiveProject())
        .order("scheduled_for", { ascending: true });

    if (error) throw error;
    return data ?? [];
}

export async function createPost(post: any): Promise<Post> {
    const { data, error } = await supabaseAdmin
        .from("ig_posts")
        .insert({ ...post, client_id: getActiveProject() })
        .select()
        .single();

    if (error) throw error;
    return data;
}

export async function updatePostStatus(
    postId: string,
    status: "draft" | "ready" | "posted",
    postedAt?: string
): Promise<void> {
    const update: Partial<Post> = {
        status,
        updated_at: new Date().toISOString()
    };

    if (status === "posted") {
        update.posted_at = postedAt ?? new Date().toISOString();
    }

    await supabaseAdmin
        .from("ig_posts")
        .update(update)
        .eq("id", postId);
}

// ============================================
// CONTENT CALENDAR
// ============================================

export async function getCalendarForDateRange(
    startDate: string,
    endDate: string
): Promise<ContentCalendar[]> {
    const { data, error } = await supabaseAdmin
        .from("ig_content_calendar")
        .select("*, post:ig_posts!inner(*), post_type:ig_post_types(*)")
        .eq("post.client_id", getActiveProject())
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: true });

    if (error) throw error;
    return data ?? [];
}

export async function schedulePost(
    date: string,
    postId: string,
    timeSlot: string = "afternoon"
): Promise<ContentCalendar> {
    const { data, error } = await supabaseAdmin
        .from("ig_content_calendar")
        .insert({
            date,
            post_id: postId,
            time_slot: timeSlot
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

// ============================================
// GENERATION LOG (with Critic feedback)
// ============================================

export async function logGeneration(log: {
    postId: string;
    promptUsed: string;
    modelUsed: string;
    tokensUsed?: number;
    generationTimeMs?: number;
    error?: string;
    criticScore?: number;
    criticKeep?: string[];
    criticFix?: string[];
}): Promise<void> {
    await supabaseAdmin
        .from("ig_generation_log")
        .insert({
            post_id: log.postId,
            client_id: getActiveProject(),
            prompt_used: log.promptUsed,
            model_used: log.modelUsed,
            tokens_used: log.tokensUsed,
            generation_time_ms: log.generationTimeMs,
            error: log.error,
            critic_score: log.criticScore,
            critic_keep: log.criticKeep,
            critic_fix: log.criticFix,
        });
}

// ============================================
// FEEDBACK LOOP — Performance scoring
// ============================================

/**
 * Update performance scores for ideas and reviews based on post metrics.
 * Called when metrics are entered for published posts.
 * This is the key feedback loop: Metrics → Ideas/Reviews → Future selection.
 */
export async function propagateMetricsToSources(): Promise<{ ideasUpdated: number; reviewsUpdated: number }> {
    const clientId = getActiveProject()

    // Get posts that have metrics AND linked ideas/reviews
    const { data: posts } = await supabaseAdmin
        .from("ig_posts")
        .select("id, idea_id, review_id, likes, comments, saves, reach, shares, link_clicks")
        .eq("client_id", clientId)
        .eq("status", "posted")
        .not("likes", "is", null)

    if (!posts || posts.length === 0) return { ideasUpdated: 0, reviewsUpdated: 0 }

    let ideasUpdated = 0
    let reviewsUpdated = 0

    // Group metrics by idea_id
    const ideaMetrics: Record<string, number[]> = {}
    const reviewMetrics: Record<string, number[]> = {}

    for (const post of posts) {
        const engagement = (post.likes || 0) + (post.comments || 0) * 3 + (post.saves || 0) * 5
        if (post.idea_id) {
            if (!ideaMetrics[post.idea_id]) ideaMetrics[post.idea_id] = []
            ideaMetrics[post.idea_id].push(engagement)
        }
        if (post.review_id) {
            if (!reviewMetrics[post.review_id]) reviewMetrics[post.review_id] = []
            reviewMetrics[post.review_id].push(engagement)
        }
    }

    // Update idea performance scores
    for (const [ideaId, scores] of Object.entries(ideaMetrics)) {
        const avgScore = scores.reduce((s, v) => s + v, 0) / scores.length
        await supabaseAdmin
            .from("ig_post_ideas")
            .update({
                performance_score: avgScore,
                times_used_with_metrics: scores.length,
            })
            .eq("id", ideaId)
        ideasUpdated++
    }

    // Update review performance scores
    for (const [reviewId, scores] of Object.entries(reviewMetrics)) {
        const avgScore = scores.reduce((s, v) => s + v, 0) / scores.length
        await supabaseAdmin
            .from("ig_reviews")
            .update({
                performance_score: avgScore,
                times_used_with_metrics: scores.length,
            })
            .eq("id", reviewId)
        reviewsUpdated++
    }

    return { ideasUpdated, reviewsUpdated }
}

/**
 * Get ideas weighted by performance score.
 * High-performing ideas are 3x more likely to be selected.
 * Ideas with no metrics yet get a fair chance too.
 */
export async function getWeightedIdeas(limit = 5): Promise<PostIdea[]> {
    const clientId = getActiveProject()

    // Get all available ideas (respecting cooldown)
    const cooldownDate = new Date()
    cooldownDate.setDate(cooldownDate.getDate() - 90) // 90-day cooldown

    const { data: ideas } = await supabaseAdmin
        .from("ig_post_ideas")
        .select("*")
        .eq("client_id", clientId)
        .eq("is_active", true)
        .or(`last_used_at.is.null,last_used_at.lt.${cooldownDate.toISOString()}`)
        .order("performance_score", { ascending: false })
        .limit(50)

    if (!ideas || ideas.length === 0) return []

    // Weighted random selection: top performers get 3x weight
    const avgScore = ideas.reduce((s, i) => s + (i.performance_score || 0), 0) / ideas.length
    const weighted = ideas.flatMap(idea => {
        const score = idea.performance_score || 0
        if (score > avgScore * 1.5) return [idea, idea, idea] // 3x weight
        if (score > avgScore) return [idea, idea]              // 2x weight
        return [idea]                                          // 1x weight (default/no data)
    })

    // Shuffle and pick
    const shuffled = weighted.sort(() => Math.random() - 0.5)
    return shuffled.slice(0, limit)
}

/**
 * Get reviews weighted by performance score.
 */
export async function getWeightedReviews(limit = 3): Promise<Review[]> {
    const clientId = getActiveProject()

    const { data: reviews } = await supabaseAdmin
        .from("ig_reviews")
        .select("*")
        .eq("client_id", clientId)
        .eq("is_approved", true)
        .or("used_at.is.null,used_at.lt." + new Date(Date.now() - 30 * 86400000).toISOString())
        .order("performance_score", { ascending: false })
        .limit(20)

    if (!reviews || reviews.length === 0) return []

    const avgScore = reviews.reduce((s, r) => s + (r.performance_score || 0), 0) / reviews.length
    const weighted = reviews.flatMap(review => {
        const score = review.performance_score || 0
        if (score > avgScore * 1.5) return [review, review, review]
        if (score > avgScore) return [review, review]
        return [review]
    })

    const shuffled = weighted.sort(() => Math.random() - 0.5)
    return shuffled.slice(0, limit)
}

// ============================================
// DUPLICATE CHECKING
// ============================================

export async function checkForDuplicateContent(caption: string): Promise<boolean> {
    // Get recent posts and check for similarity
    const recentPosts = await getRecentPosts(50);

    // Simple similarity check - can be enhanced with embeddings later
    const normalizedCaption = caption.toLowerCase().trim();

    for (const post of recentPosts) {
        const normalizedExisting = post.caption.toLowerCase().trim();

        // Check for exact match
        if (normalizedCaption === normalizedExisting) {
            return true;
        }

        // Check for high similarity (>80% character overlap)
        const similarity = calculateSimilarity(normalizedCaption, normalizedExisting);
        if (similarity > 0.8) {
            return true;
        }
    }

    return false;
}

function calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const editDistance = levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str1.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= str2.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= str1.length; i++) {
        for (let j = 1; j <= str2.length; j++) {
            const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }

    return matrix[str1.length][str2.length];
}

// ============================================
// HOOK & BODY DEDUP (moved from dedup.ts)
// ============================================

/** Extract normalized topic keywords from a caption */
export function extractTopicKeywords(text: string): Set<string> {
    return new Set(
        text.toLowerCase()
            .replace(/[^a-záčďéěíňóřšťúůýž\s]/g, "")
            .split(/\s+/)
            .filter(w => w.length > 4)
    )
}

/** Check if two hooks are too similar (word overlap > threshold) */
export function isHookSimilar(newHook: string, existingHook: string, threshold = 0.5): boolean {
    const a = newHook.toLowerCase().trim()
    const b = existingHook.toLowerCase().trim()
    if (a === b) return true

    const wordsA = new Set(a.split(/\s+/))
    const wordsB = b.split(/\s+/)
    const overlap = wordsB.filter(w => wordsA.has(w)).length
    return overlap / Math.max(wordsA.size, wordsB.length) > threshold
}

/** Check if body content overlaps too much with recent posts */
export function isBodySimilar(newBody: string, recentBodies: string[], threshold = 0.4): boolean {
    const newKeywords = extractTopicKeywords(newBody)
    if (newKeywords.size === 0) return false

    return recentBodies.some(existing => {
        const existingKeywords = extractTopicKeywords(existing)
        if (existingKeywords.size === 0) return false
        const overlap = [...newKeywords].filter(w => existingKeywords.has(w)).length
        return overlap / Math.max(newKeywords.size, existingKeywords.size) > threshold
    })
}

// ============================================
// PILLAR MAPPING (consolidated from 5 duplicates)
// ============================================

import type { ClientConfig } from "./configs/types"

/** Get the pillar key for a given post type name */
export function getPillarForType(config: ClientConfig, typeName: string): string {
    for (const [pillar, pillarConfig] of Object.entries(config.contentPillars)) {
        if (pillarConfig.postTypes.includes(typeName)) return pillar
    }
    return Object.keys(config.contentPillars)[0]
}

/** Create a bound pillar mapper for a given config (eliminates repeated lambda) */
export function createPillarMapper(config: ClientConfig): (typeName: string) => string {
    return (typeName: string) => getPillarForType(config, typeName)
}


