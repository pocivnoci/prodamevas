/**
 * Instagram Service - Helper functions for IG content management
 * Multi-tenant: all queries filter by client_id (uuid FK to clients table)
 * Uses AsyncLocalStorage for request-scoped tenant isolation (safe in serverless).
 */

import supabaseAdmin from "../supabase/admin";
import { AsyncLocalStorage } from "node:async_hooks";

// ============================================
// MULTI-TENANT: Active client (uuid)
// Request-scoped via AsyncLocalStorage to prevent race conditions
// ============================================

const clientStorage = new AsyncLocalStorage<string>()

/**
 * Set the active client uuid for the current request.
 *
 * Writes into AsyncLocalStorage scoped to THIS request's async-execution context
 * (via enterWith) — NOT a module-global. That is what prevents cross-tenant
 * contamination when Fluid Compute runs concurrent requests in one instance: a
 * module-level `let` would let tenant A's continuation read tenant B's value.
 *
 * Prefer withActiveProject() for new code — explicit .run() scoping is the
 * gold standard; this remains for entry points not yet wrapped.
 */
export function setActiveProject(clientId: string) {
    clientStorage.enterWith(clientId)
}

/** Get the current request's active client uuid (request-scoped via AsyncLocalStorage). */
export function getActiveProject(): string {
    const fromStorage = clientStorage.getStore()
    if (fromStorage) return fromStorage
    throw new Error("No active client set. Wrap work in withActiveProject(clientId, fn) or call setActiveProject(clientId) first.")
}

/** Run a function with a request-scoped clientId (race-condition safe). Preferred. */
export function withActiveProject<T>(clientId: string, fn: () => T): T {
    return clientStorage.run(clientId, fn)
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
        postTypeDefs?: { name: string; display_name: string; emoji: string; description: string; uses_product?: boolean }[]
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

    // Prefer brand-specific metadata from postTypeDefs; fall back to pillar-derived.
    const defMap = new Map((config.postTypeDefs ?? []).map(d => [d.name, d]))
    const rows = missing.map(name => {
        const def = defMap.get(name)
        if (def) {
            return {
                client_id: clientId,
                name,
                display_name: def.emoji ? `${def.emoji} ${def.display_name}` : def.display_name,
                emoji: def.emoji || "📝",
                description: def.description || null,
                frequency: "weekly" as const,
                is_active: true,
                uses_product: def.uses_product ?? false,
            }
        }
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

/** Fetch a single idea, scoped to the active client — used when the user explicitly
 *  picked an idea in the UI. Returns null on cross-tenant/missing id (caller throws). */
export async function getIdeaById(ideaId: string): Promise<PostIdea | null> {
    const { data, error } = await supabaseAdmin
        .from("ig_post_ideas")
        .select("*")
        .eq("id", ideaId)
        .eq("client_id", getActiveProject())
        .maybeSingle();
    if (error) throw error;
    return data;
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

export async function markReviewAsUsed(reviewId: string): Promise<void> {
    await supabaseAdmin
        .from("ig_reviews")
        .update({ used_at: new Date().toISOString() })
        .eq("id", reviewId);
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

/**
 * How many posts the client's profile grid holds — the anchor for feed-pattern slot math
 * (a new post's chronological index IS this count).
 *
 * Takes clientId explicitly: this is engine code and must never depend on the module-global
 * active project (concurrent requests share a lambda and would cross tenants).
 *
 * The filter deliberately matches FeedTab's grid exactly (image_url present, nothing else),
 * so the pattern the preview draws and the pattern the engine generates against are computed
 * from the same set of posts. Diverge here and the ghost cells start lying.
 */
export async function countFeedPosts(clientId: string): Promise<number> {
    const { count, error } = await supabaseAdmin
        .from("ig_posts")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId)
        .not("image_url", "is", null)

    if (error) throw error
    return count ?? 0
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
    /** Native visual engine QA outcome: pass | retry_pass | fallback | overlay */
    qaStatus?: string;
    /** Caption path attribution (pipeline v2): 'repair' (legacy loop) | 'bestof2' */
    strategy?: string;
    /** Editor⇄copywriter rounds that actually ran */
    editorialRounds?: number;
    /** Post-editorial score (critic_score stays the PRE-editorial one) */
    finalScore?: number;
    /** Angle the copywriter committed to before writing (1 Czech sentence) */
    angle?: string;
    /** Format slug (ig_post_types.name) — lets the critic-feedback loop filter history
     *  per format instead of mixing scores across unrelated post types */
    postType?: string;
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
            qa_status: log.qaStatus,
            strategy: log.strategy,
            editorial_rounds: log.editorialRounds,
            final_score: log.finalScore,
            angle: log.angle,
            post_type: log.postType,
        });
}

/**
 * Brand-consistency score (pipeline v2, the L4 drift sensor).
 * Embeds the new caption (→ ig_posts.caption_embedding, which also grows the gold
 * pool for future posts), builds the gold-voice centroid from the client's
 * top-engagement embedded captions, and logs cosine(new, centroid) to
 * ig_generation_log.consistency_score. Fire-and-forget + fail-open: a post must
 * never fail (or slow down) over a drift metric.
 */
export async function scoreConsistencyAndEmbed(postId: string, clientId: string, caption: string): Promise<void> {
    try {
        const { embedText, cosineSimilarity } = await import("./gemini-client");
        const vec = await embedText(caption.substring(0, 2000));
        await supabaseAdmin
            .from("ig_posts")
            .update({ caption_embedding: JSON.stringify(vec) })
            .eq("id", postId);

        // Gold set = top-engagement captions with embeddings (A/B winners rise here
        // naturally — losers are status 'rejected' and never get metrics). Engagement
        // weighting matches propagateMetricsToSources (comments > saves > likes).
        const { data: candidates } = await supabaseAdmin
            .from("ig_posts")
            .select("caption_embedding, likes, comments, saves")
            .eq("client_id", clientId)
            .neq("id", postId)
            .not("caption_embedding", "is", null)
            .not("likes", "is", null)
            .limit(60);

        const scored = (candidates || [])
            .map(c => {
                let v: number[] | null = null;
                try { v = typeof c.caption_embedding === "string" ? JSON.parse(c.caption_embedding) : c.caption_embedding } catch { /* skip */ }
                return { v, e: (c.likes || 0) + 3 * (c.comments || 0) + 5 * (c.saves || 0) };
            })
            .filter((c): c is { v: number[]; e: number } => Array.isArray(c.v) && c.v.length > 0)
            .sort((a, b) => b.e - a.e)
            .slice(0, 20);

        if (scored.length < 3) return; // not enough gold voice yet — no score

        const dims = scored[0].v.length;
        const centroid = new Array(dims).fill(0);
        for (const s of scored) for (let i = 0; i < dims; i++) centroid[i] += s.v[i] / scored.length;

        const consistency = cosineSimilarity(vec, centroid);
        await supabaseAdmin
            .from("ig_generation_log")
            .update({ consistency_score: consistency })
            .eq("post_id", postId);
        console.log(`   🧭 Consistency score: ${consistency.toFixed(3)} (gold set: ${scored.length} postů)`);
    } catch (err: any) {
        console.warn(`⚠️ Consistency scoring skipped: ${err?.message?.substring(0, 80)}`);
    }
}

// ============================================
// FEEDBACK LOOP — Performance scoring
// ============================================

/**
 * Update performance scores for ideas and reviews based on post metrics.
 * Called when metrics are entered for published posts.
 * This is the key feedback loop: Metrics → Ideas/Reviews → Future selection.
 */
export async function propagateMetricsToSources(explicitClientId?: string): Promise<{ ideasUpdated: number; reviewsUpdated: number; typesUpdated: number }> {
    const clientId = explicitClientId || getActiveProject()

    // Get posts that have metrics AND linked ideas/reviews/types
    const { data: posts } = await supabaseAdmin
        .from("ig_posts")
        .select("id, idea_id, review_id, post_type_id, likes, comments, saves, reach, shares, link_clicks")
        .eq("client_id", clientId)
        .eq("status", "posted")
        .not("likes", "is", null)

    if (!posts || posts.length === 0) return { ideasUpdated: 0, reviewsUpdated: 0, typesUpdated: 0 }

    let ideasUpdated = 0
    let reviewsUpdated = 0
    let typesUpdated = 0

    // Group metrics by idea_id / review_id / post_type_id
    const ideaMetrics: Record<string, number[]> = {}
    const reviewMetrics: Record<string, number[]> = {}
    const typeMetrics: Record<string, number[]> = {}

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
        if (post.post_type_id) {
            if (!typeMetrics[post.post_type_id]) typeMetrics[post.post_type_id] = []
            typeMetrics[post.post_type_id].push(engagement)
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

    // Update FORMAT performance scores (ig_post_types) — closes the loop the hard rule
    // demands for every content source; feeds autopilot's weighted type selection.
    for (const [typeId, scores] of Object.entries(typeMetrics)) {
        const avgScore = scores.reduce((s, v) => s + v, 0) / scores.length
        await supabaseAdmin
            .from("ig_post_types")
            .update({
                performance_score: avgScore,
                times_used_with_metrics: scores.length,
            })
            .eq("id", typeId)
        typesUpdated++
    }

    return { ideasUpdated, reviewsUpdated, typesUpdated }
}

/**
 * Get ideas weighted by performance score.
 * High-performing ideas are 3x more likely to be selected.
 * Ideas with no metrics yet get a fair chance too.
 */
/**
 * Recency-decayed performance score. A win from last season counts less than a
 * fresh one — without this, old top performers dominate selection forever and
 * the feed converges to a stale local optimum. ~120-day half-life.
 */
function decayedScore(score: number, lastSignalAt: string | null | undefined): number {
    if (!score) return 0
    if (!lastSignalAt) return score
    const ageDays = (Date.now() - new Date(lastSignalAt).getTime()) / 86_400_000
    if (!Number.isFinite(ageDays) || ageDays <= 0) return score
    const HALF_LIFE_DAYS = 120
    return score * Math.pow(0.5, ageDays / HALF_LIFE_DAYS)
}

export async function getWeightedIdeas(limit = 5): Promise<PostIdea[]> {
    const clientId = getActiveProject()

    const { data: allIdeas } = await supabaseAdmin
        .from("ig_post_ideas")
        .select("*")
        .eq("client_id", clientId)
        .eq("is_active", true)
        .order("performance_score", { ascending: false })
        .limit(100)

    // Per-idea cooldown (same rule as getAvailableIdeas) — a hardcoded 90d here
    // used to silently override each idea's cooldown_days.
    const now = Date.now()
    const ideas = (allIdeas ?? []).filter(idea => {
        if (!idea.last_used_at) return true
        const cooldownDays = idea.cooldown_days ?? 90
        return now - new Date(idea.last_used_at).getTime() > cooldownDays * 86_400_000
    }).slice(0, 50)

    if (ideas.length === 0) return []

    // Effective score = recency-decayed performance. Compare against the average
    // of decayed scores so the threshold tracks the freshly-relevant winners.
    const scored = ideas.map(idea => ({
        idea,
        eff: decayedScore(idea.performance_score || 0, idea.last_used_at),
        unproven: !idea.times_used_with_metrics, // never measured = exploration candidate
    }))
    const avgScore = scored.reduce((s, x) => s + x.eff, 0) / scored.length

    // Weighted random selection with explicit exploration (optimism under
    // uncertainty): untested ideas get a guaranteed 2x shot instead of being
    // buried with proven low performers — that's what keeps the loop exploring.
    const weighted = scored.flatMap(({ idea, eff, unproven }) => {
        if (unproven) return [idea, idea]                  // exploration boost
        if (eff > avgScore * 1.5) return [idea, idea, idea] // 3x weight
        if (eff > avgScore) return [idea, idea]             // 2x weight
        return [idea]                                       // 1x weight (proven low)
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

    const scored = reviews.map(review => ({
        review,
        eff: decayedScore(review.performance_score || 0, review.used_at),
        unproven: !review.times_used_with_metrics,
    }))
    const avgScore = scored.reduce((s, x) => s + x.eff, 0) / scored.length
    const weighted = scored.flatMap(({ review, eff, unproven }) => {
        if (unproven) return [review, review]
        if (eff > avgScore * 1.5) return [review, review, review]
        if (eff > avgScore) return [review, review]
        return [review]
    })

    const shuffled = weighted.sort(() => Math.random() - 0.5)
    return shuffled.slice(0, limit)
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

// ============================================
// PRODUCT CATEGORIES (dynamic, per-client)
// ============================================

export interface ProductCategory {
    id: string
    client_id: string | null
    slug: string
    label: string
    icon: string
    design_guide: string
    mockup_prompt: string | null
    material_hint: string | null
    manufacturing_hint: string | null
    sort_order: number
    is_active: boolean
    created_at: string
}

/**
 * Live product catalog for AI prompt grounding — the single source of truth is the
 * ig_products TABLE (SettingsTab CRUD + the deep scraper write there); config.products
 * is a frozen onboarding snapshot (@deprecated in configs/types.ts). Grounding prompts
 * on the snapshot produced hooks naming deleted products while the engine then picked
 * a DIFFERENT live product at render time (caption/image mismatch in published posts).
 * Falls back to the passed config.products only when the table is empty (legacy clients
 * whose onboarding sync failed). Explicit clientId per the CLAUDE.md tenant rule.
 */
export async function getCatalogProducts(
    clientId: string,
    fallback?: { name: string; type?: string; slug?: string; price?: string; description?: string }[],
    limit = 20,
): Promise<{ name: string; type: string; slug: string; price?: string; description?: string }[]> {
    const { data } = await supabaseAdmin
        .from("ig_products")
        .select("name, type, slug, price, description")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(limit)

    if (data && data.length > 0) {
        return data.map(p => ({
            name: p.name,
            type: p.type || "product",
            slug: p.slug,
            price: p.price || undefined,
            description: p.description || undefined,
        }))
    }
    return (fallback || []).map(p => ({
        name: p.name,
        type: p.type || "product",
        slug: p.slug || "",
        price: p.price,
        description: p.description,
    }))
}

/**
 * Get product categories for the active client.
 * Returns client-specific categories if they exist,
 * otherwise falls back to global defaults (client_id IS NULL).
 */
export async function getProductCategories(clientId?: string): Promise<ProductCategory[]> {
    // If clientId provided, try client-specific first
    if (clientId) {
        const { data: clientCats } = await supabaseAdmin
            .from("ig_product_categories")
            .select("*")
            .eq("client_id", clientId)
            .eq("is_active", true)
            .order("sort_order")

        if (clientCats && clientCats.length > 0) {
            return clientCats as ProductCategory[]
        }
    }

    // Fallback to global defaults (client_id IS NULL)
    const { data: globalCats } = await supabaseAdmin
        .from("ig_product_categories")
        .select("*")
        .is("client_id", null)
        .eq("is_active", true)
        .order("sort_order")

    return (globalCats || []) as ProductCategory[]
}

/** Get a single product category by slug for the active client */
export async function getProductCategoryBySlug(slug: string, clientId?: string): Promise<ProductCategory | null> {
    const cid = clientId || getActiveProject()

    // Try client-specific first
    const { data: clientCat } = await supabaseAdmin
        .from("ig_product_categories")
        .select("*")
        .eq("client_id", cid)
        .eq("slug", slug)
        .eq("is_active", true)
        .limit(1)

    if (clientCat && clientCat.length > 0) return clientCat[0] as ProductCategory

    // Fallback to global
    const { data: globalCat } = await supabaseAdmin
        .from("ig_product_categories")
        .select("*")
        .is("client_id", null)
        .eq("slug", slug)
        .eq("is_active", true)
        .limit(1)

    return globalCat?.[0] as ProductCategory || null
}

/** Create a new product category for a client */
export async function createProductCategory(
    clientId: string,
    data: { slug: string; label: string; icon?: string; design_guide: string; mockup_prompt?: string; material_hint?: string; manufacturing_hint?: string }
): Promise<ProductCategory> {
    // Determine sort_order (append at end)
    const { data: existing } = await supabaseAdmin
        .from("ig_product_categories")
        .select("sort_order")
        .eq("client_id", clientId)
        .order("sort_order", { ascending: false })
        .limit(1)

    const nextOrder = (existing?.[0]?.sort_order ?? 0) + 1

    const { data: created, error } = await supabaseAdmin
        .from("ig_product_categories")
        .insert({
            client_id: clientId,
            slug: data.slug,
            label: data.label,
            icon: data.icon || "📦",
            design_guide: data.design_guide,
            mockup_prompt: data.mockup_prompt || null,
            material_hint: data.material_hint || null,
            manufacturing_hint: data.manufacturing_hint || null,
            sort_order: nextOrder,
        })
        .select()
        .single()

    if (error) throw error
    return created as ProductCategory
}

/** Update an existing product category */
export async function updateProductCategory(
    id: string,
    data: Partial<{ label: string; icon: string; design_guide: string; mockup_prompt: string; material_hint: string; manufacturing_hint: string; sort_order: number }>
): Promise<void> {
    const { error } = await supabaseAdmin
        .from("ig_product_categories")
        .update(data)
        .eq("id", id)

    if (error) throw error
}

/** Soft-delete a product category */
export async function deleteProductCategory(id: string): Promise<void> {
    const { error } = await supabaseAdmin
        .from("ig_product_categories")
        .update({ is_active: false })
        .eq("id", id)

    if (error) throw error
}
