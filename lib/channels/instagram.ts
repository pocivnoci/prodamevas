/**
 * Instagram channel adapter — the first ChannelAdapter implementation.
 * Constraints + draft formatting + publishing are live. `publish()` pushes an
 * image, carousel, or reel to a connected Instagram Business account via the Graph
 * API (container → publish). Reels use a REELS container with video_url + cover_url
 * and a longer transcode-poll window; `fetchMetrics` reads counts + insights.
 *
 * Publishing requires the `instagram_business_content_publish` scope (2nd App
 * Review). Until that clears, it only works for the chrlit account whose connecting
 * user is an admin/tester of the Meta app — which is exactly what dogfooding needs.
 */

import { withRetry } from "@/utils/retry"
import {
    type ChannelAdapter,
    type ContentDraft,
    type FormattedContent,
    type ChannelConnection,
    type ChannelMetrics,
    type PublishResult,
    ChannelNotEnabledError,
} from "./types"

// Same host + (unversioned) policy as instagram/ig-connection.ts — "Instagram API
// with Instagram Login". Content Publishing lives under the IG user node here.
const IG_GRAPH_BASE = "https://graph.instagram.com"

// A media container (especially carousel children) can take a moment to become
// publishable. Poll status_code up to this many times before giving up.
const CONTAINER_POLL_ATTEMPTS = 10
const CONTAINER_POLL_DELAY_MS = 3000

// A REELS container transcodes the uploaded video server-side, which takes minutes —
// poll far longer and slower than for images (≈5 min total).
const REEL_POLL_ATTEMPTS = 60
const REEL_POLL_DELAY_MS = 5000

// Per-media insights we try to read (likes/comments come from direct fields below).
// IG 400s the WHOLE request if any one metric is invalid for the media type / API
// version, so fetchMetrics batches first then falls back per-metric (see below).
const MEDIA_INSIGHT_METRICS = ["reach", "saved", "shares", "profile_visits"] as const

/** POST to a Graph edge with form-encoded params; throws on non-2xx (retried by caller). */
async function graphPost(path: string, params: Record<string, string>): Promise<any> {
    const body = new URLSearchParams(params)
    return withRetry(async () => {
        const res = await fetch(`${IG_GRAPH_BASE}/${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
        })
        if (!res.ok) throw new Error(`IG publish POST ${path} ${res.status}: ${await res.text()}`)
        return res.json()
    }, 2, `ig-publish-${path.split("/").pop()}`)
}

async function graphGet(path: string, accessToken: string): Promise<any> {
    const sep = path.includes("?") ? "&" : "?"
    return withRetry(async () => {
        const res = await fetch(`${IG_GRAPH_BASE}/${path}${sep}access_token=${encodeURIComponent(accessToken)}`)
        if (!res.ok) throw new Error(`IG publish GET ${path} ${res.status}: ${await res.text()}`)
        return res.json()
    }, 2, "ig-publish-get")
}

/** Create a single media container; returns its id. */
async function createContainer(
    igUserId: string,
    accessToken: string,
    params: Record<string, string>,
): Promise<string> {
    const json = await graphPost(`${igUserId}/media`, { ...params, access_token: accessToken })
    if (!json?.id) throw new Error(`IG container create returned no id: ${JSON.stringify(json)}`)
    return String(json.id)
}

/**
 * Wait until a container is FINISHED (publishable). IG returns IN_PROGRESS/FINISHED/
 * ERROR/EXPIRED via status_code. Cheap insurance for images, necessary for carousels,
 * and mandatory for reels (video transcoding takes minutes → longer poll window).
 */
async function waitForContainer(
    containerId: string,
    accessToken: string,
    opts: { attempts?: number; delayMs?: number } = {},
): Promise<void> {
    const attempts = opts.attempts ?? CONTAINER_POLL_ATTEMPTS
    const delayMs = opts.delayMs ?? CONTAINER_POLL_DELAY_MS
    for (let attempt = 0; attempt < attempts; attempt++) {
        // `status` carries a human-readable reason on ERROR — surface it for diagnostics.
        const json = await graphGet(`${containerId}?fields=status_code,status`, accessToken)
        const code = json?.status_code
        if (code === "FINISHED") return
        if (code === "ERROR" || code === "EXPIRED") {
            throw new Error(`IG container ${containerId} status ${code}${json?.status ? `: ${json.status}` : ""}`)
        }
        await new Promise(r => setTimeout(r, delayMs))
    }
    throw new Error(`IG container ${containerId} not FINISHED after ${attempts} polls`)
}

/** Publish a finished container; returns the published media id. */
async function publishContainer(igUserId: string, accessToken: string, creationId: string): Promise<string> {
    const json = await graphPost(`${igUserId}/media_publish`, { creation_id: creationId, access_token: accessToken })
    if (!json?.id) throw new Error(`IG media_publish returned no id: ${JSON.stringify(json)}`)
    return String(json.id)
}

export const instagramAdapter: ChannelAdapter = {
    channel: "instagram",
    constraints: {
        maxCaptionChars: 2200,
        supportsHashtags: true,
        hashtagSweetSpot: [8, 15],
        mediaTypes: ["image", "carousel", "reel"],
        aspectRatios: ["1:1", "4:5", "9:16"],
    },

    formatDraft(draft: ContentDraft): FormattedContent {
        // IG: caption then a blank line then hashtags (the convention the engine already uses).
        const tags = draft.hashtags.length ? `\n\n${draft.hashtags.join(" ")}` : ""
        const body = `${draft.caption}${tags}`.slice(0, this.constraints.maxCaptionChars)
        return { channel: "instagram", body, mediaUrls: draft.mediaUrls, mediaType: draft.mediaType }
    },

    async publish(connection: ChannelConnection, content: FormattedContent): Promise<PublishResult> {
        const igUserId = connection.externalUserId
        const accessToken = connection.accessToken
        const caption = content.body.slice(0, this.constraints.maxCaptionChars)
        const mediaUrls = content.mediaUrls.filter(Boolean)

        if (mediaUrls.length === 0) {
            throw new Error("IG publish: žádné mediální URL k publikování.")
        }

        // Non-reel video publishing isn't wired (no such media type flows here today).
        if (content.mediaType === "video") {
            throw new ChannelNotEnabledError("instagram", "video publishing")
        }

        let creationId: string

        if (content.mediaType === "reel") {
            // Reel: mediaUrls = [videoUrl, coverUrl?] (parsePostMedia ordering). REELS
            // container transcodes server-side, so poll long (waitForContainer w/ REEL opts).
            const [videoUrl, coverUrl] = mediaUrls
            creationId = await createContainer(igUserId, accessToken, {
                media_type: "REELS",
                video_url: videoUrl,
                caption,
                share_to_feed: "true",
                ...(coverUrl ? { cover_url: coverUrl } : { thumb_offset: "0" }),
            })
            await waitForContainer(creationId, accessToken, { attempts: REEL_POLL_ATTEMPTS, delayMs: REEL_POLL_DELAY_MS })
            const mediaId = await publishContainer(igUserId, accessToken, creationId)
            let permalink: string | undefined
            try {
                const meta = await graphGet(`${mediaId}?fields=permalink`, accessToken)
                permalink = meta?.permalink || undefined
            } catch { /* permalink is a nicety */ }
            return { externalId: mediaId, permalink }
        }

        if (content.mediaType === "carousel" && mediaUrls.length > 1) {
            // 1) a child container per slide (no caption on children)
            const childIds: string[] = []
            for (const url of mediaUrls) {
                const childId = await createContainer(igUserId, accessToken, {
                    image_url: url,
                    is_carousel_item: "true",
                })
                await waitForContainer(childId, accessToken)
                childIds.push(childId)
            }
            // 2) the parent carousel container (caption lives here)
            creationId = await createContainer(igUserId, accessToken, {
                media_type: "CAROUSEL",
                children: childIds.join(","),
                caption,
            })
        } else {
            // Single image (carousel with one slide degrades to a normal image post).
            creationId = await createContainer(igUserId, accessToken, {
                image_url: mediaUrls[0],
                caption,
            })
        }

        // 3) wait for the (parent) container to be publishable, then publish.
        await waitForContainer(creationId, accessToken)
        const mediaId = await publishContainer(igUserId, accessToken, creationId)

        // 4) best-effort permalink for the dashboard "view on Instagram" link.
        let permalink: string | undefined
        try {
            const meta = await graphGet(`${mediaId}?fields=permalink`, accessToken)
            permalink = meta?.permalink || undefined
        } catch {
            /* permalink is a nicety, never fail a published post over it */
        }

        return { externalId: mediaId, permalink }
    },

    async fetchMetrics(connection: ChannelConnection, externalId: string): Promise<ChannelMetrics> {
        const accessToken = connection.accessToken
        const metrics: ChannelMetrics = {}

        // 1) Public counts are direct fields (cheap, no insights permission needed).
        try {
            const f = await graphGet(`${externalId}?fields=like_count,comments_count`, accessToken)
            if (typeof f?.like_count === "number") metrics.likes = f.like_count
            if (typeof f?.comments_count === "number") metrics.comments = f.comments_count
        } catch {
            /* counts are best-effort; the insights below carry the engagement signal */
        }

        // 2) Insights (reach/saved/shares/profile_visits) — need manage_insights scope.
        const applyInsights = (data: any[]) => {
            for (const row of data || []) {
                const val = row?.values?.[0]?.value
                if (typeof val !== "number") continue
                if (row.name === "saved") metrics.saves = val
                else if (row.name === "reach") metrics.reach = val
                else if (row.name === "shares") metrics.shares = val
                else if (row.name === "profile_visits") metrics.profile_visits = val
            }
        }
        try {
            const ins = await graphGet(`${externalId}/insights?metric=${MEDIA_INSIGHT_METRICS.join(",")}`, accessToken)
            applyInsights(ins?.data)
        } catch {
            // Batch failed (a metric is unsupported for this media type). Retry each on
            // its own so one bad metric never costs us the others.
            for (const metric of MEDIA_INSIGHT_METRICS) {
                try {
                    const ins = await graphGet(`${externalId}/insights?metric=${metric}`, accessToken)
                    applyInsights(ins?.data)
                } catch {
                    /* unsupported for this media — skip */
                }
            }
        }

        return metrics
    },
}
