/**
 * Instagram metrics ingestion (roadmap step 3 — closes the learning loop).
 * ======================================================================
 * Pulls real engagement from a connected Instagram account via the Graph API,
 * matches it to our posts, writes it, and fires the SAME learning trigger the
 * manual MetricsInputForm uses. Session-less by design (takes clientId) so the
 * daily cron and the on-demand button share one path.
 *
 * Auth note: the apply-primitives here are intentionally UNGUARDED — callers must
 * already own the client (the UI action wraps them in requireClientAccess; the
 * cron owns the connection it just read). They therefore must NOT be re-exported
 * from a "use server" file, or they'd become public, auth-less endpoints.
 */

import supabaseAdmin from "@/supabase/admin"
import { withRetry } from "@/utils/retry"
import { getConnection } from "./ig-connection"
import { instagramAdapter } from "@/lib/channels/instagram"

const IG_GRAPH_BASE = "https://graph.instagram.com"

export type IGPostMetricsInput = {
    likes: number
    comments: number
    saves: number
    reach: number
    shares: number
    profile_visits: number
    link_clicks: number
}

// ── Session-less apply primitives (shared by the UI action + the cron) ──────

/**
 * Write metrics to a post and report whether they changed significantly. NO auth,
 * NO learning — the caller decides when to fire learning (once, not per post).
 * Partial: only provided fields are written, so we never zero-out a metric the API
 * didn't return.
 */
export async function writeIGPostMetrics(
    postId: string,
    metrics: Partial<IGPostMetricsInput>,
): Promise<{ ok: boolean; significant: boolean; clientId: string | null }> {
    const { data: post } = await supabaseAdmin
        .from("ig_posts")
        .select("client_id, likes, saves, comments")
        .eq("id", postId)
        .single()
    if (!post) return { ok: false, significant: false, clientId: null }

    const { error } = await supabaseAdmin
        .from("ig_posts")
        .update({ ...metrics, updated_at: new Date().toISOString() })
        .eq("id", postId)
    if (error) return { ok: false, significant: false, clientId: post.client_id }

    // Same significance gate as the manual path: only meaningful changes are worth
    // re-learning. A missing field contributes zero delta.
    const likesDelta = metrics.likes != null ? Math.abs(metrics.likes - (post.likes || 0)) : 0
    const savesDelta = metrics.saves != null ? Math.abs(metrics.saves - (post.saves || 0)) : 0
    const commentsDelta = metrics.comments != null ? Math.abs(metrics.comments - (post.comments || 0)) : 0
    const significant = likesDelta >= 5 || savesDelta >= 2 || commentsDelta >= 3
    return { ok: true, significant, clientId: post.client_id }
}

/**
 * Fire the metrics→learning loop for a client ONCE. Emits the `metrics.updated`
 * domain event whose subscriber runs propagateMetricsToSources + analyzeAndLearn
 * (lib/events/subscribers). This is byte-for-byte the cascade the manual path has
 * always used — do NOT reimplement it here (CLAUDE.md: feedback loops are sacred).
 */
export async function fireMetricsLearning(clientId: string): Promise<void> {
    try {
        const { data: postsWithMetrics } = await supabaseAdmin
            .from("ig_posts")
            .select("id, caption, likes, comments, saves, reach, shares, link_clicks, post_type_id, ig_post_types(name)")
            .eq("client_id", clientId)
            .eq("status", "posted")
            .not("likes", "is", null)
            .gt("likes", 0)
            .order("created_at", { ascending: false })
            .limit(30)

        if (postsWithMetrics && postsWithMetrics.length >= 3) {
            const learnData = postsWithMetrics.map(p => ({
                id: p.id,
                caption: p.caption || "",
                post_type_name: (p.ig_post_types as any)?.name,
                likes: p.likes || 0,
                comments: p.comments || 0,
                saves: p.saves || 0,
                reach: p.reach || 0,
                shares: p.shares || 0,
                link_clicks: p.link_clicks || 0,
            }))

            const { waitUntil } = await import("@vercel/functions")
            await import("@/lib/events/subscribers")
            const { emit } = await import("@/lib/events")
            waitUntil(
                emit("metrics.updated", { clientId, payload: { learnData } })
                    .catch(err => console.warn("⚠️ metrics.updated emit failed (non-fatal):", err?.message)),
            )
        }
    } catch (learnErr: any) {
        console.warn("⚠️ Learning check failed:", learnErr?.message)
    }
}

// ── Graph helpers ───────────────────────────────────────────────────────────

async function graphGet(path: string, accessToken: string): Promise<any> {
    const sep = path.includes("?") ? "&" : "?"
    return withRetry(async () => {
        const res = await fetch(`${IG_GRAPH_BASE}/${path}${sep}access_token=${encodeURIComponent(accessToken)}`)
        if (!res.ok) throw new Error(`IG metrics GET ${path} ${res.status}: ${await res.text()}`)
        return res.json()
    }, 2, "ig-metrics-get")
}

interface IgMedia {
    id: string
    caption: string | null
    timestamp: string | null
    permalink: string | null
    media_type: string | null
}

/** Recent media on the connected account, newest first (for matching + metrics). */
async function listRecentMedia(igUserId: string, accessToken: string, limit = 50): Promise<IgMedia[]> {
    const json = await graphGet(`${igUserId}/media?fields=id,caption,timestamp,permalink,media_type&limit=${limit}`, accessToken)
    return Array.isArray(json?.data) ? json.data : []
}

// ── Matching ────────────────────────────────────────────────────────────────

function normalizeCaption(s: string | null | undefined): string {
    return (s || "").toLowerCase().replace(/\s+/g, " ").trim()
}

/**
 * Match one of our posts to an IG media item. Our stored `caption` is WITHOUT
 * hashtags; the published IG caption is `caption + hashtags`, so we test prefix
 * containment on a strong (≥20-char) normalized slice and require a UNIQUE hit —
 * ambiguous matches are skipped (the manual form still covers them).
 */
function matchMedia(postCaption: string | null, media: IgMedia[]): IgMedia | null {
    const norm = normalizeCaption(postCaption)
    if (norm.length < 20) return null // too short to match safely
    const key = norm.slice(0, 60)
    const hits = media.filter(m => normalizeCaption(m.caption).startsWith(key))
    return hits.length === 1 ? hits[0] : null
}

// ── The sync ────────────────────────────────────────────────────────────────

export interface SyncResult {
    synced: number   // posts whose metrics we wrote
    matched: number  // handoff posts we newly linked to an ig_media_id
    skipped: number  // posted posts we couldn't link/measure
}

/**
 * Pull insights for a client's posted posts and feed the learning loop. Resolves
 * each post's IG media id (direct for auto-published, caption match for handoff
 * posts), fetches metrics, writes them, and fires learning ONCE if anything changed
 * significantly. Fail-open per post; takes clientId explicitly (no setActiveProject).
 */
export async function syncPostMetrics(clientId: string): Promise<SyncResult> {
    const result: SyncResult = { synced: 0, matched: 0, skipped: 0 }

    const conn = await getConnection(clientId)
    if (!conn || conn.status !== "connected") return result

    const { data: posts } = await supabaseAdmin
        .from("ig_posts")
        .select("id, caption, posted_at, ig_media_id")
        .eq("client_id", clientId)
        .eq("status", "posted")
        .order("posted_at", { ascending: false })
        .limit(100)
    if (!posts || posts.length === 0) return result

    // Only list media if at least one post still needs linking.
    let media: IgMedia[] = []
    if (posts.some(p => !p.ig_media_id)) {
        try {
            media = await listRecentMedia(conn.igUserId, conn.accessToken)
        } catch (err) {
            console.warn(`metrics-sync: media list failed for ${clientId}:`, (err as Error).message)
        }
    }

    let anySignificant = false

    for (const post of posts) {
        try {
            let mediaId = post.ig_media_id as string | null

            // Link handoff/manual posts by caption match; backfill id + permalink.
            if (!mediaId) {
                const hit = matchMedia(post.caption, media)
                if (!hit) { result.skipped++; continue }
                mediaId = hit.id
                await supabaseAdmin
                    .from("ig_posts")
                    .update({ ig_media_id: hit.id, permalink: hit.permalink || null })
                    .eq("id", post.id)
                result.matched++
            }

            const cm = await instagramAdapter.fetchMetrics(
                { accessToken: conn.accessToken, externalUserId: conn.igUserId },
                mediaId,
            )

            // Write only the fields the API actually returned.
            const metrics: Partial<IGPostMetricsInput> = {}
            if (cm.likes != null) metrics.likes = cm.likes
            if (cm.comments != null) metrics.comments = cm.comments
            if (cm.saves != null) metrics.saves = cm.saves
            if (cm.reach != null) metrics.reach = cm.reach
            if (cm.shares != null) metrics.shares = cm.shares
            if (cm.profile_visits != null) metrics.profile_visits = cm.profile_visits
            if (Object.keys(metrics).length === 0) { result.skipped++; continue }

            const w = await writeIGPostMetrics(post.id, metrics)
            if (w.ok) result.synced++
            if (w.significant) anySignificant = true
        } catch (err) {
            console.warn(`metrics-sync: post ${post.id} failed:`, (err as Error).message)
            result.skipped++
        }
    }

    // Fire learning ONCE per sync — analyzeAndLearn is an AI call; per-post would thrash it.
    if (anySignificant) await fireMetricsLearning(clientId)

    return result
}
