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
import { getChannelAdapter } from "@/lib/channels"
import type { ChannelConnection, ChannelMetrics } from "@/lib/channels/types"

const IG_GRAPH_BASE = "https://graph.instagram.com"

/** How many recent posts a batch-reading transport covers per tenant per run.
 *  The bridge's analytics endpoint pages at 200; 100 keeps a tenant's sweep to a
 *  single request while still covering more than a month of any real cadence. */
const UPLOADPOST_POSTS_PER_SYNC = 100

export type IGPostMetricsInput = {
    likes: number
    comments: number
    saves: number
    reach: number
    shares: number
    profile_visits: number
    views: number
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
            .select("id, caption, likes, comments, saves, reach, shares, views, link_clicks, post_type_id, ig_post_types(name)")
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
                // Zhlédnutí jdou analyzátorovi jako kontext (jak velké publikum
                // příspěvek vůbec vidělo), ale do performance_score záměrně ne —
                // viz komentář u propagateMetricsToSources.
                views: p.views || 0,
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

    // The transport decides which adapter reads metrics. Without this the Graph
    // adapter would receive an upload-post profile username as an access token.
    const adapter = getChannelAdapter("instagram", conn.transport)
    const adapterSupportsBatch = typeof adapter.fetchMetricsBatch === "function"
    const channelConnection: ChannelConnection = {
        accessToken: conn.accessToken,
        externalUserId: conn.igUserId,
        transport: conn.transport,
    }

    // Cap each tenant at its most recent posts — that is where the learning signal
    // lives anyway, and the cron walks tenants sequentially inside one function budget.
    const budget = adapterSupportsBatch ? UPLOADPOST_POSTS_PER_SYNC : 100

    const { data: posts } = await supabaseAdmin
        .from("ig_posts")
        .select("id, caption, posted_at, ig_media_id, permalink, publish_request_id")
        .eq("client_id", clientId)
        .eq("status", "posted")
        .order("posted_at", { ascending: false })
        .limit(budget)
    if (!posts || posts.length === 0) return result

    // Caption matching is a GRAPH-only affair: it exists to link handoff posts the
    // user published by hand, and it needs the account's media list — which only the
    // Graph path can list. A batch transport already returns rows keyed by native id.
    let media: IgMedia[] = []
    if (!adapterSupportsBatch && posts.some(p => !p.ig_media_id)) {
        try {
            media = await listRecentMedia(conn.igUserId, conn.accessToken)
        } catch (err) {
            console.warn(`metrics-sync: media list failed for ${clientId}:`, (err as Error).message)
        }
    }

    // ── Gather: each transport resolves posts→numbers its own way. ──────────────
    // Both branches produce the SAME shape and nothing writes here, so the cascade
    // below stays single. A fork at the write would quietly halve what the engine
    // learns (CLAUDE.md: feedback loops are sacred).
    const pending: { postId: string; metrics: ChannelMetrics }[] = []

    if (adapter.fetchMetricsBatch) {
        // A publish that upload-post handed to its background worker returns without a
        // native id — the post goes live, we just don't know its id yet. Resolve those
        // first, or they can never be matched to their numbers.
        for (const post of posts) {
            if (post.ig_media_id || !post.publish_request_id) continue
            try {
                const { pollUploadStatus } = await import("@/lib/channels/uploadpost")
                const settled = await pollUploadStatus(String(post.publish_request_id))
                if (!settled?.platform_post_id) continue
                await supabaseAdmin.from("ig_posts").update({
                    ig_media_id: String(settled.platform_post_id),
                    ...(settled.post_url ? { permalink: String(settled.post_url) } : {}),
                }).eq("id", post.id)
                post.ig_media_id = String(settled.platform_post_id)
                result.matched++
            } catch (err) {
                console.warn(`metrics-sync: resolve id for ${post.id} failed:`, (err as Error).message)
            }
        }

        // Bridge shape: one request per tenant, keyed by native post id. Looping
        // per post would be both slower and rate-limited.
        let byId = new Map<string, { metrics: ChannelMetrics; permalink?: string }>()
        try {
            const batch = await adapter.fetchMetricsBatch(channelConnection, { limit: budget })
            byId = new Map(batch.map(b => [b.externalId, { metrics: b.metrics, permalink: b.permalink }]))
        } catch (err) {
            console.warn(`metrics-sync: batch read failed for ${clientId}:`, (err as Error).message)
        }

        for (const post of posts) {
            const mediaId = post.ig_media_id as string | null
            // Bridge posts get their native id at publish time. One without it was
            // published some other way (handoff, or before this transport existed) —
            // the manual MetricsInputForm still covers those.
            if (!mediaId) { result.skipped++; continue }
            const hit = byId.get(mediaId)
            if (!hit) { result.skipped++; continue }
            if (hit.permalink && !post.permalink) {
                await supabaseAdmin.from("ig_posts").update({ permalink: hit.permalink }).eq("id", post.id)
                result.matched++
            }
            pending.push({ postId: post.id, metrics: hit.metrics })
        }
    } else {
        for (const post of posts) {
            try {
                let mediaId = post.ig_media_id as string | null

                // Handoff/manual post: link it by caption match, then backfill.
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

                const { metrics } = await adapter.fetchMetrics(channelConnection, mediaId)
                pending.push({ postId: post.id, metrics })
            } catch (err) {
                console.warn(`metrics-sync: post ${post.id} failed:`, (err as Error).message)
                result.skipped++
            }
        }
    }

    // ── The one cascade. Both transports land here; nothing forks below. ────────
    let anySignificant = false
    for (const { postId, metrics: cm } of pending) {
        // Write only the fields the transport actually returned — a missing metric
        // must not overwrite what the manual form recorded.
        const metrics: Partial<IGPostMetricsInput> = {}
        if (cm.likes != null) metrics.likes = cm.likes
        if (cm.comments != null) metrics.comments = cm.comments
        if (cm.saves != null) metrics.saves = cm.saves
        if (cm.reach != null) metrics.reach = cm.reach
        if (cm.shares != null) metrics.shares = cm.shares
        if (cm.profile_visits != null) metrics.profile_visits = cm.profile_visits
        if (cm.views != null) metrics.views = cm.views
        if (Object.keys(metrics).length === 0) { result.skipped++; continue }

        const w = await writeIGPostMetrics(postId, metrics)
        if (w.ok) result.synced++
        if (w.significant) anySignificant = true
    }

    // Fire learning ONCE per sync — analyzeAndLearn is an AI call; per-post would thrash it.
    if (anySignificant) await fireMetricsLearning(clientId)

    return result
}
