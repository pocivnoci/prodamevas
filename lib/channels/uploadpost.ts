/**
 * upload-post.com channel adapter — Instagram via a THIRD-PARTY Meta app.
 * =======================================================================
 *
 * Why this exists: publishing to a tenant's Instagram through our own Meta app
 * needs the `instagram_business_content_publish` scope, which is gated behind a
 * second App Review (see docs/META_APP_REVIEW_PLAN.md). upload-post already holds
 * an approved app, so a tenant can connect their account there and publish today.
 * This adapter is the bridge; `instagramAdapter` (transport `meta`) stays the target.
 *
 * Addressing model — the asymmetry vs. the Graph adapter:
 *   - the API key is GLOBAL (ours, one per installation, from env)
 *   - the per-tenant part is a PROFILE USERNAME, carried in `connection.accessToken`
 *   - a published post is addressed by its NATIVE Instagram id, same as on Graph,
 *     so metrics keep resolving after a tenant switches transport
 *
 * Shapes below were verified against the live API and upload-post's OpenAPI spec
 * (2026-08-31), not inferred from prose. Three things that cost a rewrite to learn:
 *   1. publish takes multipart/form-data, NOT JSON ("Username required in form data")
 *   2. the caption field is `title`, and the profile field is `user` (not `username`)
 *   3. per-post analytics is a BATCH endpoint keyed by native post id; the
 *      `request_id` from an async upload only polls upload status, never metrics
 */

import {
    type ChannelAdapter,
    type ChannelConnection,
    type ChannelMetrics,
    type ChannelMetricsResult,
    type ChannelPostMetrics,
    type ContentDraft,
    type FormattedContent,
    type PublishResult,
    ChannelNotEnabledError,
    ChannelPermanentError,
} from "./types"
import { uploadPostForm, uploadPostGet } from "./uploadpost-client"

const PHOTOS_PATH = "/api/upload_photos"
const CACHED_ANALYTICS_PATH = "/api/uploadposts/post-analytics/cached"
const STATUS_PATH = "/api/uploadposts/status"

/** How long to wait for a background hand-off to finish before giving up on
 *  learning the post id. Observed hand-offs complete in seconds. */
const STATUS_POLL_ATTEMPTS = 20
const STATUS_POLL_DELAY_MS = 3000

/** Default page size for a batch metrics read (endpoint max is 200). */
const ANALYTICS_PAGE = 100

/** Per-platform result of a synchronous publish, keyed by platform name. */
function readPlatformResult(json: any): any {
    return json?.results?.instagram ?? null
}

/**
 * upload-post's own id for a publish that was handed to its background worker.
 *
 * The hand-off is NOT opt-in: a plain synchronous request that runs long is
 * "durably handed off to the upload worker" and answers 200 with a message instead
 * of results. Missing this is dangerous rather than merely wrong — the post still
 * goes live, so treating it as a failure means the retry publishes it a second time.
 * The id sometimes arrives as a field and sometimes only inside the message text.
 */
function readHandoffRequestId(json: any): string | undefined {
    const direct = json?.request_id ?? json?.requestId
    if (direct) return String(direct)
    const m = String(json?.message || "").match(/request_id=([A-Za-z0-9_-]+)/)
    return m ? m[1] : undefined
}

/** Pull the Instagram row out of a status response, whatever it is wrapped in. */
function readStatusResult(json: any): any {
    const rows = Array.isArray(json?.results) ? json.results : []
    return rows.find((r: any) => r?.platform === "instagram") ?? rows[0] ?? null
}

/** Map upload-post's metric keys onto ChannelMetrics.
 *
 *  The spec says explicitly to "read the keys present rather than assuming a fixed
 *  schema" — keys vary per platform and change over time, so every field is optional
 *  and an absent one is left absent. That matters downstream: writeIGPostMetrics
 *  writes only what it is handed and never nulls, so a metric this transport does
 *  not carry keeps whatever the manual form recorded. */
function readMetrics(raw: any): ChannelMetrics {
    const m: ChannelMetrics = {}
    const src = raw ?? {}
    const num = (v: any): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)

    const map: [keyof ChannelMetrics, any][] = [
        ["likes", src.likes],
        ["comments", src.comments],
        ["shares", src.shares],
        ["saves", src.saves],
        ["reach", src.reach],
        ["impressions", src.impressions],
        ["views", src.views],
        // Instagram reports this as profileViews on upload-post's unified schema.
        ["profile_visits", src.profileViews ?? src.profile_visits],
    ]
    for (const [key, value] of map) {
        const n = num(value)
        if (n !== undefined) (m as any)[key] = n
    }
    return m
}

/**
 * Wait for a handed-off upload to settle. Returns the Instagram row once the job
 * reports `completed`/`failed`, or null if it is still running when we run out of
 * patience — which the caller must treat as "published, id unknown", never as a
 * failure to retry.
 */
export async function pollUploadStatus(requestId: string): Promise<any | null> {
    for (let attempt = 0; attempt < STATUS_POLL_ATTEMPTS; attempt++) {
        const json = await uploadPostGet(`${STATUS_PATH}?request_id=${encodeURIComponent(requestId)}`, "status")
        const state = String(json?.status || "")
        if (state === "completed" || state === "failed" || state === "error") {
            return readStatusResult(json)
        }
        await new Promise(r => setTimeout(r, STATUS_POLL_DELAY_MS))
    }
    return null
}

export const uploadPostAdapter: ChannelAdapter = {
    channel: "instagram",
    transport: "uploadpost",

    // Same shape the engine already renders for Instagram — the network's rules do
    // not change just because a different pipe carries the post.
    constraints: {
        maxCaptionChars: 2200,
        supportsHashtags: true,
        hashtagSweetSpot: [8, 15],
        mediaTypes: ["image", "carousel"], // widened once reels are proven end-to-end
        aspectRatios: ["1:1", "4:5", "9:16"],
    },

    formatDraft(draft: ContentDraft): FormattedContent {
        // Identical to instagramAdapter: caption, blank line, hashtags. Deliberately
        // duplicated rather than shared — if the two transports ever need to differ,
        // that must be a visible edit here, not a surprise in a shared helper.
        const tags = draft.hashtags.length ? `\n\n${draft.hashtags.join(" ")}` : ""
        const body = `${draft.caption}${tags}`.slice(0, this.constraints.maxCaptionChars)
        return { channel: "instagram", body, mediaUrls: draft.mediaUrls, mediaType: draft.mediaType }
    },

    async publish(connection: ChannelConnection, content: FormattedContent): Promise<PublishResult> {
        const profile = connection.accessToken // the per-tenant profile username
        const caption = content.body.slice(0, this.constraints.maxCaptionChars)
        const mediaUrls = content.mediaUrls.filter(Boolean)

        if (!profile) {
            throw new ChannelPermanentError("upload-post: chybí profil tenanta na řádku připojení.")
        }
        if (mediaUrls.length === 0) {
            throw new ChannelPermanentError("upload-post: žádné mediální URL k publikování.")
        }

        switch (content.mediaType) {
            case "reel":
            case "video":
            case "story":
                // Not proven end-to-end yet. Refusing loudly beats silently posting a
                // reel's cover image as a feed post and calling it a success.
                throw new ChannelNotEnabledError("instagram", `publikování '${content.mediaType}'`, "uploadpost")

            case "text":
                throw new ChannelPermanentError("upload-post: Instagram vyžaduje médium, text-only post nelze publikovat.")

            case "image":
            case "carousel": {
                const form = new FormData()
                form.append("user", profile)
                form.append("platform[]", "instagram")
                // A carousel is simply several photos[] entries in one call. The API
                // fetches each URL itself, so our public Supabase links go straight in
                // and it transcodes (the response's `changes` lists what it did — which
                // is also why WebP is not the problem here that it is on Graph).
                for (const url of mediaUrls) form.append("photos[]", url)
                // `title` is the caption field. `caption` is silently ignored.
                form.append("title", caption)

                // Deliberately SYNCHRONOUS (no async_upload): the sync response carries
                // the native post_id and permalink, so ig_media_id is correct the moment
                // the row flips to `posted`. Async would hand back a request_id that only
                // polls upload status and is useless for metrics.
                const json = await uploadPostForm(PHOTOS_PATH, form, content.mediaType)

                let ig = readPlatformResult(json)

                if (!ig) {
                    // No per-platform results: the request was handed to the background
                    // worker. From here the post WILL go live, so every path below must
                    // avoid raising a retryable error — a retry would double-post.
                    const requestId = readHandoffRequestId(json)
                    if (!requestId) {
                        throw new Error(`upload-post: odpověď neobsahuje ani výsledek, ani request_id: ${JSON.stringify(json).slice(0, 300)}`)
                    }

                    const settled = await pollUploadStatus(requestId)
                    if (!settled) {
                        // Still running. Report success WITHOUT a native id: the caller
                        // records the post as published and keeps `providerRef`, which
                        // metrics-sync uses later to resolve the id. Failing here would
                        // re-arm a post that is already on its way to the profile.
                        return { providerRef: requestId }
                    }
                    if (settled.success === false || settled.error_message) {
                        throw new ChannelPermanentError(
                            `upload-post: Instagram odmítl příspěvek: ${String(settled.error_message || "neznámý důvod").slice(0, 300)}`,
                        )
                    }
                    return {
                        externalId: settled.platform_post_id ? String(settled.platform_post_id) : undefined,
                        permalink: settled.post_url ? String(settled.post_url) : undefined,
                        providerRef: requestId,
                    }
                }

                if (ig.success === false || ig.error) {
                    // The HTTP call succeeded but Instagram refused the post. Retrying
                    // an outright rejection just burns the budget and delays the truth.
                    throw new ChannelPermanentError(`upload-post: Instagram odmítl příspěvek: ${String(ig.error || "neznámý důvod").slice(0, 300)}`)
                }

                const postId = ig.post_id ? String(ig.post_id) : undefined
                if (!postId) {
                    // Without the native id we cannot ever match this post to its metrics.
                    throw new Error(`upload-post: odpověď neobsahuje post_id: ${JSON.stringify(ig).slice(0, 300)}`)
                }

                return {
                    externalId: postId,
                    permalink: ig.url ? String(ig.url) : undefined,
                    // upload-post's own handle for the publish — recorded for support and
                    // for retry/unpublish calls. Metrics do NOT use it.
                    providerRef: ig.publish_id ? String(ig.publish_id) : undefined,
                }
            }

            default: {
                // Exhaustiveness: a new MediaType becomes a build error here, never a
                // silently mishandled post.
                const _never: never = content.mediaType
                throw new Error(`upload-post: neošetřený typ média '${_never}'`)
            }
        }
    },

    /**
     * Batch read — the only per-post analytics upload-post offers.
     *
     * One request covers a whole tenant, which is why metrics-sync prefers this over
     * looping `fetchMetrics`. Numbers come from upload-post's snapshot cache, and
     * `capturedAt` says how stale each row is; nothing refreshes it in the background.
     */
    async fetchMetricsBatch(
        connection: ChannelConnection,
        opts?: { limit?: number; since?: string },
    ): Promise<ChannelPostMetrics[]> {
        const profile = connection.accessToken
        if (!profile) throw new ChannelPermanentError("upload-post: chybí profil tenanta na řádku připojení.")

        const out: ChannelPostMetrics[] = []
        const limit = Math.min(opts?.limit ?? ANALYTICS_PAGE, 200)
        let cursor: string | undefined

        // Paginate, but bounded: a runaway cursor loop inside a cron would eat the
        // whole function budget and starve every tenant after this one.
        for (let page = 0; page < 10; page++) {
            const params = new URLSearchParams({
                user: profile,
                platform: "instagram",
                limit: String(limit),
            })
            if (opts?.since) params.set("since", opts.since)
            if (cursor) params.set("cursor", cursor)

            const json = await uploadPostGet(`${CACHED_ANALYTICS_PATH}?${params}`, "analytics")

            for (const row of json?.posts ?? []) {
                const id = row?.post_id
                if (!id) continue
                out.push({
                    externalId: String(id),
                    metrics: readMetrics(row?.metrics),
                    permalink: row?.post_url ? String(row.post_url) : undefined,
                    capturedAt: row?.captured_at ? String(row.captured_at) : undefined,
                })
            }

            if (!json?.has_more || !json?.next_cursor) break
            cursor = String(json.next_cursor)
        }

        return out
    },

    /**
     * Single-post read, kept so the adapter satisfies the interface and so a caller
     * that only wants one post is not forced to page the whole account. It is served
     * from the same batch endpoint, so prefer fetchMetricsBatch for a sweep.
     */
    async fetchMetrics(connection: ChannelConnection, externalId: string): Promise<ChannelMetricsResult> {
        const all = await this.fetchMetricsBatch!(connection)
        const hit = all.find(p => p.externalId === externalId)
        if (!hit) return { metrics: {} }
        return { metrics: hit.metrics, nativeId: hit.externalId, permalink: hit.permalink }
    },
}
