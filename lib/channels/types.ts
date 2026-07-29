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
    /** The media object to treat as THE post — for a multi-object publish (story set)
     *  this is the FIRST one: the natural anchor for the permalink and for metrics. */
    externalId: string
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
    accessToken: string
    externalUserId: string
}

export interface ChannelAdapter {
    channel: Channel
    constraints: ChannelConstraints
    /** Adapt a channel-agnostic draft into this channel's body+media. */
    formatDraft(draft: ContentDraft): FormattedContent
    /** Publish to the channel. May throw NotEnabledError until the channel is live. */
    publish(connection: ChannelConnection, content: FormattedContent): Promise<PublishResult>
    /** Pull post metrics from the channel. */
    fetchMetrics(connection: ChannelConnection, externalId: string): Promise<ChannelMetrics>
}

/** Thrown by adapters whose publish/metrics aren't enabled yet (e.g. awaiting App Review). */
export class ChannelNotEnabledError extends Error {
    constructor(channel: Channel, what: string) {
        super(`Channel '${channel}' ${what} not enabled yet.`)
        this.name = "ChannelNotEnabledError"
    }
}
