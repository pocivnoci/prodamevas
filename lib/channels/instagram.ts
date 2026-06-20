/**
 * Instagram channel adapter — the first ChannelAdapter implementation.
 * Constraints + draft formatting are live; publish/fetchMetrics are stubbed until
 * the `instagram_business_content_publish` / `..._manage_insights` App Review
 * clears and the Graph API calls are wired (roadmap steps 2 & 3).
 */

import {
    type ChannelAdapter,
    type ContentDraft,
    type FormattedContent,
    type ChannelConnection,
    ChannelNotEnabledError,
} from "./types"

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

    async publish(_connection: ChannelConnection, _content: FormattedContent) {
        // Needs instagram_business_content_publish (2nd App Review) + Graph API container→publish.
        throw new ChannelNotEnabledError("instagram", "publishing")
    },

    async fetchMetrics(_connection: ChannelConnection, _externalId: string) {
        // Needs instagram_business_manage_insights + media insights call (roadmap step 3).
        throw new ChannelNotEnabledError("instagram", "metrics")
    },
}
