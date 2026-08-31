/**
 * Channel adapter seam (core hardening Fáze 5).
 * =============================================
 * The content brain (research → copy → critic → render) is channel-agnostic; only
 * the OUTPUT shape and the publish/metrics APIs differ per channel. A ChannelAdapter
 * captures exactly those differences, so adding LinkedIn/Facebook later is
 * "implement the interface", not a rewrite.
 *
 * Scope note: this carves the seam (interface + Instagram impl + registry + a
 * `channel` discriminator on posts). It does NOT yet rewire the live generation
 * pipeline through formatDraft — that migration is a follow-up, kept separate to
 * avoid destabilizing the working IG flow.
 */

import type { MediumType } from "@/lib/credits"

export type Channel = "instagram" | "linkedin" | "facebook"

/**
 * HOW we reach a channel — orthogonal to WHICH channel it is.
 *
 * `meta`       — our own Meta app, Graph API direct. Publishing to a TENANT account
 *                needs the `instagram_business_content_publish` scope (2nd App Review).
 * `uploadpost` — upload-post.com, which already owns an approved Meta app. The bridge
 *                that lets tenant profiles publish before our own review clears.
 *
 * Never guessed at runtime. A connection row records the transport it was created
 * with and publishing reads it back — a guessed transport would mean handing the
 * Graph API something that is not a Graph token. Same reasoning as "chybějící
 * identifikátor nikdy nedefaultuj na skutečného tenanta" in CLAUDE.md.
 */
export type Transport = "meta" | "uploadpost"

/** What a channel can be asked to publish. Deliberately a SUPERSET of the engine's
 *  MediumType — it also carries shapes other channels need (bare `video`, text-only
 *  posts) that the IG pipeline never produces. The guard below makes the subset
 *  relation a compile error to break, so a new engine medium can't reach a channel
 *  adapter as an unhandled string. */
export type MediaType = "image" | "carousel" | "reel" | "story" | "video" | "text"

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _EveryMediumIsPublishable = MediumType extends MediaType ? true : never

/** What a channel allows — used to validate/shape generation output. */
export interface ChannelConstraints {
    maxCaptionChars: number
    supportsHashtags: boolean
    /** Recommended hashtag count range, when supported. */
    hashtagSweetSpot?: [number, number]
    mediaTypes: MediaType[]
    aspectRatios: string[]
}

/** Channel-agnostic output of the content pipeline. */
export interface ContentDraft {
    caption: string
    hashtags: string[]
    mediaUrls: string[]
    mediaType: MediaType
}

/** Draft formatted for a specific channel (ready to publish/copy out). */
export interface FormattedContent {
    channel: Channel
    body: string
    mediaUrls: string[]
    mediaType: MediaType
}

export interface PublishResult {
    /** The NATIVE platform id of the object to treat as THE post — for a multi-object
     *  publish (story set) the FIRST one: the natural anchor for permalink and metrics.
     *
     *  Optional because not every transport knows the native id at publish time.
     *  upload-post accepts the post and only reports `platform_post_id` once the
     *  network has actually taken it. When absent, metrics-sync backfills it — the
     *  same mechanism that already backfills handoff posts by caption match. */
    externalId?: string
    /** The TRANSPORT's own handle for this publish (upload-post: `request_id`).
     *
     *  Kept beside `externalId` rather than folded into it: the native id must stay
     *  transport-independent, or metrics stop resolving for old posts the moment a
     *  tenant switches transport. */
    providerRef?: string
    permalink?: string
    /** Every media object created, in order. Only multi-object publishes set this. */
    externalIds?: string[]
    /**
     * Set when SOME objects published and a later one failed.
     *
     * This exists because `ig_posts` has a single `ig_media_id` and no per-object
     * cursor: re-arming such a post would republish the objects that already went
     * live (up to MAX_ATTEMPTS times). A partial publish is therefore TERMINAL —
     * the caller records it as `posted` with the error in `publish_error` and never
     * retries. If a resume cursor is ever added, it belongs here.
     */
    partial?: { publishedCount: number; total: number; error: string }
}

export interface ChannelMetrics {
    likes?: number
    comments?: number
    shares?: number
    saves?: number
    reach?: number
    impressions?: number
    /** Profile visits attributed to the post (available for some media types). */
    profile_visits?: number
    /** Reel/video views (impressions was renamed to views on newer IG API versions). */
    views?: number
}

/** Minimal shape of a stored connection (lib/connections / ig-connection). */
export interface ChannelConnection {
    /** The per-tenant credential. `meta`: the decrypted IG access token.
     *  `uploadpost`: the upload-post profile username — the API key is global,
     *  so the profile IS the per-tenant part of the address. */
    accessToken: string
    /** `meta`: the IG user id. `uploadpost`: the connected IG handle. */
    externalUserId: string
    /** Which adapter may act on this connection. Read from the DB, never inferred. */
    transport: Transport
}

/** What a metrics read yields: the numbers, plus any identity the transport can
 *  report alongside them.
 *
 *  `nativeId`/`permalink` exist so a post whose native id was unknown at publish
 *  time gets backfilled from the SAME response that carried its metrics — one
 *  round trip instead of two, which matters under upload-post's 100-per-5-minutes
 *  live analytics limit. */
export interface ChannelMetricsResult {
    metrics: ChannelMetrics
    nativeId?: string
    permalink?: string
}

export interface ChannelAdapter {
    channel: Channel
    /** Which transport this implementation speaks. Registry key is `${channel}:${transport}`. */
    transport: Transport
    constraints: ChannelConstraints
    /** Adapt a channel-agnostic draft into this channel's body+media. */
    formatDraft(draft: ContentDraft): FormattedContent
    /** Publish to the channel. May throw NotEnabledError until the channel is live. */
    publish(connection: ChannelConnection, content: FormattedContent): Promise<PublishResult>
    /** Pull post metrics. `externalId` is whatever THIS transport addresses a post by:
     *  `meta` → the native IG media id, `uploadpost` → the `request_id` from publish. */
    fetchMetrics(connection: ChannelConnection, externalId: string): Promise<ChannelMetricsResult>
}

/** Thrown by adapters whose publish/metrics aren't enabled yet (e.g. awaiting App Review,
 *  or a medium the transport has not been proven to handle). */
export class ChannelNotEnabledError extends Error {
    constructor(channel: Channel, what: string, transport?: Transport) {
        super(`Channel '${channel}'${transport ? ` via '${transport}'` : ""} ${what} not enabled yet.`)
        this.name = "ChannelNotEnabledError"
    }
}

/**
 * Thrown for a failure that retrying cannot fix: the tenant revoked the connection
 * at the provider, the media was rejected as invalid, the account is ineligible.
 *
 * The publisher retries anything it does not recognise, which is the right default
 * for network faults — but it means an adapter has to SAY when a retry is pointless,
 * or a dead post burns MAX_ATTEMPTS ticks and reports a misleading error.
 */
export class ChannelPermanentError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "ChannelPermanentError"
    }
}
