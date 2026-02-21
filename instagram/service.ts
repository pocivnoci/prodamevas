/**
 * Instagram Service - Helper functions for IG content management
 * Multi-tenant: all queries filter by client_id (uuid FK to clients table)
 */

import supabase from "../supabase/client";
import supabaseAdmin from "../supabase/admin";
import type { Tables, TablesInsert } from "../supabase/generated.types";

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
export type PostType = Tables<"ig_post_types">;
export type PostIdea = Tables<"ig_post_ideas">;
export type Review = Tables<"ig_reviews">;
export type Post = Tables<"ig_posts">;
export type ContentCalendar = Tables<"ig_content_calendar">;

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

    let query = supabase
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

export async function addIdea(idea: TablesInsert<"ig_post_ideas">): Promise<PostIdea> {
    const { data, error } = await supabaseAdmin
        .from("ig_post_ideas")
        .insert(idea)
        .select()
        .single();

    if (error) throw error;
    return data;
}

export async function batchInsertIdeas(ideas: TablesInsert<"ig_post_ideas">[]): Promise<number> {
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
    const query = supabase
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

export async function addReview(review: TablesInsert<"ig_reviews">): Promise<Review> {
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
    const { data, error } = await supabase
        .from("ig_posts")
        .select("*")
        .eq("client_id", getActiveProject())
        .order("created_at", { ascending: false })
        .limit(limit);

    if (error) throw error;
    return data ?? [];
}

export async function getPostsByStatus(status: "draft" | "ready" | "posted"): Promise<Post[]> {
    const { data, error } = await supabase
        .from("ig_posts")
        .select("*")
        .eq("status", status)
        .eq("client_id", getActiveProject())
        .order("scheduled_for", { ascending: true });

    if (error) throw error;
    return data ?? [];
}

export async function createPost(post: TablesInsert<"ig_posts">): Promise<Post> {
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
    const { data, error } = await supabase
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
// GENERATION LOG
// ============================================

export async function logGeneration(log: {
    postId: string;
    promptUsed: string;
    modelUsed: string;
    tokensUsed?: number;
    generationTimeMs?: number;
    error?: string;
}): Promise<void> {
    await supabaseAdmin
        .from("ig_generation_log")
        .insert({
            post_id: log.postId,
            prompt_used: log.promptUsed,
            model_used: log.modelUsed,
            tokens_used: log.tokensUsed,
            generation_time_ms: log.generationTimeMs,
            error: log.error
        });
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
