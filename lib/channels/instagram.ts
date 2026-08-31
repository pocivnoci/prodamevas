/**
 * Instagram channel adapter — the first ChannelAdapter implementation.
 * Constraints + draft formatting + publishing are live. `publish()` pushes an
 * image or carousel to a connected Instagram Business account via the Graph API
 * (container → publish). Reels/video publishing is deferred (no video storage yet)
 * and `fetchMetrics` is still stubbed until the insights call lands (roadmap step 3).
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
    type ChannelMetricsResult,
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
 * ERROR/EXPIRED via status_code. Cheap insurance for images, necessary for carousels.
 */
async function waitForContainer(containerId: string, accessToken: string): Promise<void> {
    for (let attempt = 0; attempt < CONTAINER_POLL_ATTEMPTS; attempt++) {
        const json = await graphGet(`${containerId}?fields=status_code`, accessToken)
        const code = json?.status_code
        if (code === "FINISHED") return
        if (code === "ERROR" || code === "EXPIRED") {
            throw new Error(`IG container ${containerId} status ${code}`)
        }
        await new Promise(r => setTimeout(r, CONTAINER_POLL_DELAY_MS))
    }
    throw new Error(`IG container ${containerId} not FINISHED after ${CONTAINER_POLL_ATTEMPTS} polls`)
}

/** Publish a finished container; returns the published media id. */
async function publishContainer(igUserId: string, accessToken: string, creationId: string): Promise<string> {
    const json = await graphPost(`${igUserId}/media_publish`, { creation_id: creationId, access_token: accessToken })
    if (!json?.id) throw new Error(`IG media_publish returned no id: ${JSON.stringify(json)}`)
    return String(json.id)
}

export const instagramAdapter: ChannelAdapter = {
    channel: "instagram",
    transport: "meta",
    constraints: {
        maxCaptionChars: 2200,
        supportsHashtags: true,
        hashtagSweetSpot: [8, 15],
        mediaTypes: ["image", "story", "carousel", "reel"],
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

        let creationId: string

        // Exhaustive on mediaType. The old shape had an `else` that treated anything
        // non-carousel as a plain feed image — which would have silently posted a STORY
        // to the feed, permanently, on a customer's real account. A new medium must be
        // a build error here, not a wrong post.
        switch (content.mediaType) {
            case "reel":
            case "video":
                // Reels/video publishing is deferred (no video storage path yet).
                throw new ChannelNotEnabledError("instagram", "reel/video publishing")

            case "story": {
                // One STORIES container per frame, published in order. Stories have no
                // carousel form and Instagram ignores `caption` on them, so neither is sent.
                const ids: string[] = []
                for (const [i, url] of mediaUrls.entries()) {
                    try {
                        const frameId = await createContainer(igUserId, accessToken, {
                            media_type: "STORIES",
                            image_url: url,
                        })
                        await waitForContainer(frameId, accessToken)
                        ids.push(await publishContainer(igUserId, accessToken, frameId))
                    } catch (err: any) {
                        // Frame 1 failing means nothing shipped — a clean retry is correct.
                        if (i === 0) throw err
                        // A LATER frame failing is not retryable: ig_posts has one
                        // ig_media_id and no per-frame cursor, so re-arming would
                        // republish the frames already live. Report partial success and
                        // let the caller close the post out.
                        return {
                            externalId: ids[0],
                            externalIds: ids,
                            partial: {
                                publishedCount: ids.length,
                                total: mediaUrls.length,
                                error: err?.message || String(err),
                            },
                        }
                    }
                }
                let storyPermalink: string | undefined
                try {
                    const meta = await graphGet(`${ids[0]}?fields=permalink`, accessToken)
                    storyPermalink = meta?.permalink || undefined
                } catch {
                    /* stories expire in 24h — a permalink is a nicety at best */
                }
                return { externalId: ids[0], externalIds: ids, permalink: storyPermalink }
            }

            case "carousel":
                if (mediaUrls.length > 1) {
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
                    break
                }
                // A one-slide carousel degrades to a normal image post.
                creationId = await createContainer(igUserId, accessToken, { image_url: mediaUrls[0], caption })
                break

            case "image":
            case "text":
                creationId = await createContainer(igUserId, accessToken, { image_url: mediaUrls[0], caption })
                break

            default: {
                const _never: never = content.mediaType
                throw new ChannelNotEnabledError("instagram", `media type ${String(_never)}`)
            }
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

    async fetchMetrics(connection: ChannelConnection, externalId: string): Promise<ChannelMetricsResult> {
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

        // For `meta` the caller already holds the native id (it passed it in), so there
        // is nothing to backfill — only the numbers come back.
        return { metrics }
    },
}
