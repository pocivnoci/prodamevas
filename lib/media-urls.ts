/**
 * Post media URL parsing — client-safe module (no server imports).
 *
 * `ig_posts.image_url` is a pipe-joined list: carousel slides ("url|url|…"),
 * story frames ("url|url|url") or reel "videoUrl|coverUrl". The pipe alone is
 * ambiguous — `media_type` decides; pipe-sniffing is only the legacy fallback
 * for rows written before the column existed (added 20260622 with no backfill).
 *
 * This is the ONLY allowed parser. Never `split("|")` on image_url elsewhere:
 * that is how an .mp4 ends up in an <img> and a 3-frame story gets labelled
 * "3 slidů".
 */

export type PostMediaKind = "image" | "carousel" | "reel" | "story"

/** Extensions the render pipeline actually produces for video (reel MP4s), plus the
 *  ones a hand-uploaded frame realistically arrives as. */
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".m4v", ".webm"]

/**
 * Is this URL a video rather than a still?
 *
 * Publishing needs this because the SAME medium can carry either: an Instagram story
 * frame is `image_url` or `video_url` depending on the bytes, and sending a video as
 * an image is not a soft failure — the platform rejects the container, or worse takes
 * the still and posts a frozen frame as the tenant's story.
 *
 * Lives here, beside parsePostMedia, because it reads the same convention (a public
 * Supabase URL whose extension is authoritative) and both channel adapters need it.
 * Query strings are stripped first: signed URLs carry `?token=…` after the extension.
 */
export function isVideoUrl(url: string | null | undefined): boolean {
    if (!url) return false
    const path = url.split(/[?#]/)[0].toLowerCase()
    return VIDEO_EXTENSIONS.some(ext => path.endsWith(ext))
}

export interface PostMedia {
    kind: PostMediaKind
    /** Reel only — the MP4. */
    videoUrl?: string
    /** Reel cover image; may be absent if cover generation failed. */
    coverUrl?: string
    /** Safe for <img>: cover for reels (never the .mp4), first slide/frame otherwise. */
    thumbUrl: string | null
    /** All URLs: slides for carousel, frames for story, single URL for image, [video, cover?] for reel. */
    urls: string[]
    /** Slides for a carousel, frames for a story. 0 for reels (they have no slides). */
    slideCount: number
    /** Frame shape the UI must render this in — feed media is 4:5, reels/stories are 9:16. */
    aspect: "feed" | "vertical"
}

export function parsePostMedia(
    imageUrl: string | null | undefined,
    mediaType?: string | null
): PostMedia {
    const urls = (imageUrl || "")
        .split("|")
        .map(u => u.trim())
        .filter(Boolean)

    if (mediaType === "reel") {
        const videoUrl = urls[0]
        const coverUrl = urls[1]
        return {
            kind: "reel",
            videoUrl,
            coverUrl,
            thumbUrl: coverUrl ?? null,
            urls,
            slideCount: 0,
            aspect: "vertical",
        }
    }

    if (mediaType === "story") {
        return {
            kind: "story",
            thumbUrl: urls[0] ?? null,
            urls,
            slideCount: urls.length,
            aspect: "vertical",
        }
    }

    // Legacy rows (media_type NULL) with a pipe are carousels — stories and reels
    // are both newer than the column, so the heuristic must stay carousel-biased.
    if (mediaType === "carousel" || (!mediaType && urls.length > 1)) {
        return {
            kind: "carousel",
            thumbUrl: urls[0] ?? null,
            urls,
            slideCount: urls.length,
            aspect: "feed",
        }
    }

    return {
        kind: "image",
        thumbUrl: urls[0] ?? null,
        urls,
        slideCount: urls.length,
        aspect: "feed",
    }
}
