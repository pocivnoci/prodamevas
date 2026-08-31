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
 * Addressing model — the important asymmetry vs. the Graph adapter:
 *   - the API key is GLOBAL (ours, one per installation, from env)
 *   - the per-tenant part is a PROFILE USERNAME, carried in `connection.accessToken`
 *   - a published post is addressed by upload-post's `request_id` (→ `providerRef`),
 *     while the NATIVE Instagram media id arrives later as `platform_post_id`
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️  UNVERIFIED UNTIL FÁZE 0 (scripts/spike-uploadpost.ts) HAS BEEN RUN.
 *
 * The profile and analytics endpoints below are taken from upload-post's published
 * docs. The PUBLISH endpoint's exact path and field names are NOT documented
 * publicly at the level of detail this file needs, and carousel support is not
 * confirmed at all. Everything the spike must pin down is gathered in PUBLISH_API
 * and the response readers, so confirming it is an edit in one place — not a hunt.
 * Do not enable this transport for a paying tenant before the spike is green.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
    type ChannelAdapter,
    type ChannelConnection,
    type ChannelMetrics,
    type ChannelMetricsResult,
    type ContentDraft,
    type FormattedContent,
    type PublishResult,
    ChannelNotEnabledError,
    ChannelPermanentError,
} from "./types"
import { uploadPostGet, uploadPostJson } from "./uploadpost-client"

/** Endpoints the spike must confirm. Kept together so confirming them is one edit. */
const PUBLISH_API = {
    /** Multi-photo publish. Carousel = several urls in one call — THE open question. */
    photos: "/api/upload_photos",
    /** Video publish (reels). Only reachable once the spike proves it. */
    video: "/api/upload",
    /** Field names on the publish request. */
    fields: {
        profile: "user",
        platforms: "platform",
        caption: "caption",
        photos: "photos",
        video: "video",
    },
} as const

/** Documented endpoints — these came from upload-post's API reference. */
const ANALYTICS_PATH = (requestId: string) => `/api/uploadposts/post-analytics/${encodeURIComponent(requestId)}`

/** Live analytics is rate limited to 100 requests / 5 minutes across the whole key.
 *  Callers sweeping many posts must respect this; see metrics-sync's per-run cap. */
export const UPLOADPOST_LIVE_ANALYTICS_LIMIT = { requests: 100, windowMs: 5 * 60 * 1000 }

/**
 * Pull upload-post's own handle for a publish out of a response.
 *
 * Defensive on purpose: the API is async and documents `request_id` at the top
 * level, but wraps per-platform detail in a `results`/`platforms` map whose exact
 * nesting the spike must confirm. Losing this id means losing the ability to read
 * the post's metrics forever, so we look in every plausible place rather than
 * trusting one shape.
 */
function readRequestId(json: any): string | undefined {
    const direct = json?.request_id ?? json?.requestId ?? json?.id
    if (direct) return String(direct)
    const ig = json?.results?.instagram ?? json?.platforms?.instagram
    const nested = ig?.request_id ?? ig?.requestId
    return nested ? String(nested) : undefined
}

/** Native Instagram media id, when the response already carries it. */
function readNativeId(json: any): string | undefined {
    const ig = json?.results?.instagram ?? json?.platforms?.instagram ?? json
    const id = ig?.platform_post_id ?? ig?.post_id ?? ig?.media_id
    return id ? String(id) : undefined
}

function readPermalink(json: any): string | undefined {
    const ig = json?.results?.instagram ?? json?.platforms?.instagram ?? json
    const url = ig?.post_url ?? ig?.permalink ?? ig?.url
    return url ? String(url) : undefined
}

/** Map upload-post's unified metric names onto ChannelMetrics. */
function readMetrics(raw: any): ChannelMetrics {
    const m: ChannelMetrics = {}
    const num = (v: any): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)
    const src = raw?.post_metrics ?? raw?.metrics ?? raw ?? {}

    const likes = num(src.likes)
    const comments = num(src.comments)
    const shares = num(src.shares)
    const saves = num(src.saves)
    const reach = num(src.reach)
    const impressions = num(src.impressions)
    const views = num(src.views)

    if (likes !== undefined) m.likes = likes
    if (comments !== undefined) m.comments = comments
    if (shares !== undefined) m.shares = shares
    if (saves !== undefined) m.saves = saves
    if (reach !== undefined) m.reach = reach
    if (impressions !== undefined) m.impressions = impressions
    if (views !== undefined) m.views = views
    // `profile_visits` is not part of upload-post's unified schema. Leaving the field
    // absent (rather than 0) matters: writeIGPostMetrics only writes what it is given
    // and never nulls, so a missing metric keeps whatever the manual form recorded.
    return m
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
        mediaTypes: ["image", "carousel"], // widened once Fáze 0 proves reel/story
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

        const { fields } = PUBLISH_API

        switch (content.mediaType) {
            case "reel":
            case "video":
            case "story":
                // Not proven by Fáze 0 yet. Refusing loudly beats silently posting the
                // cover image as a feed post and calling it a reel.
                throw new ChannelNotEnabledError("instagram", `publikování '${content.mediaType}'`, "uploadpost")

            case "text":
                throw new ChannelPermanentError("upload-post: Instagram vyžaduje médium, text-only post nelze publikovat.")

            case "image":
            case "carousel": {
                const json = await uploadPostJson(
                    PUBLISH_API.photos,
                    {
                        [fields.profile]: profile,
                        [fields.platforms]: ["instagram"],
                        [fields.caption]: caption,
                        [fields.photos]: mediaUrls,
                    },
                    content.mediaType,
                )

                const providerRef = readRequestId(json)
                if (!providerRef) {
                    // Without it we can never read this post's metrics. Treat it as a
                    // failure rather than recording a post we've gone blind to.
                    throw new Error(
                        `upload-post: odpověď publikace neobsahuje request_id: ${JSON.stringify(json).slice(0, 300)}`,
                    )
                }

                return {
                    providerRef,
                    externalId: readNativeId(json), // often absent — metrics-sync backfills
                    permalink: readPermalink(json),
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
     * `externalId` here is upload-post's `request_id` (the transport's handle), NOT
     * the native media id — that is the whole reason ig_posts carries both.
     */
    async fetchMetrics(_connection: ChannelConnection, externalId: string): Promise<ChannelMetricsResult> {
        const json = await uploadPostGet(`${ANALYTICS_PATH(externalId)}?platform=instagram`, "analytics")

        const ig = json?.platforms?.instagram ?? json?.instagram ?? json

        return {
            metrics: readMetrics(ig),
            nativeId: readNativeId(ig),
            permalink: readPermalink(ig),
        }
    },
}
