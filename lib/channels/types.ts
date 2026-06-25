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

export type Channel = "instagram" | "linkedin" | "facebook"

export type MediaType = "image" | "carousel" | "reel" | "video" | "text"

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
    externalId: string
    permalink?: string
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
