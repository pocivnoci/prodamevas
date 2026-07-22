/**
 * Post media URL parsing — client-safe module (no server imports).
 *
 * `ig_posts.image_url` is a pipe-joined list: carousel slides ("url|url|…")
 * or reel "videoUrl|coverUrl". The pipe alone is ambiguous — `media_type`
 * decides; pipe-sniffing is only the legacy fallback for rows without it.
 */

export interface PostMedia {
    kind: "image" | "carousel" | "reel"
    /** Reel only — the MP4. */
    videoUrl?: string
    /** Reel cover image; may be absent if cover generation failed. */
    coverUrl?: string
    /** Safe for <img>: cover for reels (never the .mp4), first slide/image otherwise. */
    thumbUrl: string | null
    /** All URLs: slides for carousel, single URL for image, [video, cover?] for reel. */
    urls: string[]
    slideCount: number
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
        }
    }

    if (mediaType === "carousel" || (!mediaType && urls.length > 1)) {
        return {
            kind: "carousel",
            thumbUrl: urls[0] ?? null,
            urls,
            slideCount: urls.length,
        }
    }

    return {
        kind: "image",
        thumbUrl: urls[0] ?? null,
        urls,
        slideCount: urls.length,
    }
}
