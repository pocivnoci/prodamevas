/**
 * Feed Vision — visual analysis of a scraped Instagram feed (onboarding).
 * =======================================================================
 *
 * Downloads up to 8 post images from the (short-lived, signed) IG CDN URLs
 * and runs ONE multimodal Gemini call to extract a visual profile of the
 * brand's existing feed. The profile calibrates the native AI Designer
 * (typographyStyle, accentColor, logoPlacement, customInstructions) and
 * seeds `ig_brand_memory` so a new tenant doesn't start cold.
 *
 * Fail-open by design: any error returns null and onboarding continues —
 * same contract as the rest of the IG scraping path.
 */

import { Type } from "@google/genai"
import { analyzeImagesWithText } from "./gemini-client"
import { LAYOUT_ARCHETYPES } from "./image-pipeline"

const MAX_IMAGES = 8
const FETCH_TIMEOUT_MS = 10_000
/** Skip anything suspiciously small (icons/avatars) or huge */
const MIN_BYTES = 5_000
const MAX_BYTES = 8_000_000

export interface FeedVisualProfile {
    /** e.g. "bold condensed grotesque, uppercase" — goes to feedAesthetic.typographyStyle */
    typographyStyle: string
    /** Valid #hex only — observed dominant accent color of the feed */
    accentColorHex?: string
    /** Only set when the feed shows a consistent habit; otherwise undefined → "auto" */
    logoPlacementHabit?: "top-left" | "top-right" | "bottom-left" | "bottom-right"
    /** 1–2 Czech sentences describing the real visual style → customInstructions */
    visualStyleSummary: string
    /** Subset of LAYOUT_ARCHETYPES the brand already uses */
    dominantArchetypes: string[]
    /** 2–4 Czech observations of what visually works → seed 'visual' brand memories */
    visualStrengths: string[]
    /** 2–4 concrete Czech recommendations (keep/improve) → customInstructions */
    visualRecommendations: string[]
}

const FEED_VISUAL_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        typographyStyle: { type: Type.STRING },
        accentColorHex: { type: Type.STRING },
        logoPlacementHabit: { type: Type.STRING, enum: ["top-left", "top-right", "bottom-left", "bottom-right", "none"] },
        visualStyleSummary: { type: Type.STRING },
        dominantArchetypes: { type: Type.ARRAY, items: { type: Type.STRING, enum: [...LAYOUT_ARCHETYPES] } },
        visualStrengths: { type: Type.ARRAY, items: { type: Type.STRING } },
        visualRecommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: ["typographyStyle", "visualStyleSummary", "dominantArchetypes", "visualStrengths", "visualRecommendations"],
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

async function fetchImage(url: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
        if (!res.ok) return null
        const contentType = res.headers.get("content-type") || ""
        if (!contentType.startsWith("image/")) return null
        const buffer = Buffer.from(await res.arrayBuffer())
        if (buffer.length < MIN_BYTES || buffer.length > MAX_BYTES) return null
        return { buffer, mimeType: contentType.split(";")[0] }
    } catch {
        return null
    }
}

/**
 * Analyze the visual identity of a scraped IG feed.
 * `posts` come straight from IgProfileData.recentPosts (signed CDN URLs —
 * must be fetched now, while still valid).
 */
export async function analyzeFeedVisuals(
    posts: { mediaUrl?: string; likeCount: number; commentCount?: number; mediaType: string }[],
    brandName: string
): Promise<FeedVisualProfile | null> {
    try {
        const candidates = posts.filter(p => p.mediaUrl).slice(0, MAX_IMAGES)
        if (candidates.length === 0) return null

        const images: { buffer: Buffer; mimeType?: string; label?: string }[] = []
        for (const post of candidates) {
            const img = await fetchImage(post.mediaUrl!)
            if (img) {
                images.push({
                    ...img,
                    label: `Post ${images.length + 1} [${post.mediaType}] ❤️${post.likeCount}${post.commentCount ? ` 💬${post.commentCount}` : ""}:`,
                })
            }
        }
        if (images.length < 2) {
            console.warn(`⚠️ Feed vision: only ${images.length} image(s) downloadable — skipping`)
            return null
        }

        const prompt = `You are a senior Instagram art director auditing the existing feed of the brand "${brandName}".
Above are ${images.length} recent posts, each labeled with its engagement (likes/comments). Weight your conclusions toward the posts that perform best.

Return a JSON visual profile:
- typographyStyle: the typography style actually used on the feed, as design guidance in English (e.g. "bold condensed grotesque, uppercase, tight tracking"). If posts have no text, describe what WOULD fit this imagery.
- accentColorHex: the dominant accent/brand color visible across posts as a #hex value. Omit if there is no consistent accent.
- logoPlacementHabit: where the logo/watermark consistently sits ("top-left"|"top-right"|"bottom-left"|"bottom-right"), or "none" if absent/inconsistent.
- visualStyleSummary: 1–2 sentences IN CZECH describing the real visual style of the feed (photography, grading, mood, composition habits).
- dominantArchetypes: which of these layout archetypes the feed already uses: ${LAYOUT_ARCHETYPES.join(", ")}.
- visualStrengths: 2–4 observations IN CZECH of what visually works (tie to the high-engagement posts).
- visualRecommendations: 2–4 concrete recommendations IN CZECH — what to keep and what to improve for a stronger, more consistent feed.

Return ONLY the JSON.`

        const raw = await analyzeImagesWithText(images, prompt, { responseSchema: FEED_VISUAL_SCHEMA })
        const parsed = JSON.parse(raw)
        if (!parsed?.typographyStyle || !parsed?.visualStyleSummary) return null

        const profile: FeedVisualProfile = {
            typographyStyle: parsed.typographyStyle,
            accentColorHex: HEX_RE.test(parsed.accentColorHex || "") ? parsed.accentColorHex : undefined,
            logoPlacementHabit: ["top-left", "top-right", "bottom-left", "bottom-right"].includes(parsed.logoPlacementHabit)
                ? parsed.logoPlacementHabit
                : undefined,
            visualStyleSummary: parsed.visualStyleSummary,
            dominantArchetypes: (parsed.dominantArchetypes || []).filter((a: string) =>
                (LAYOUT_ARCHETYPES as readonly string[]).includes(a)
            ),
            visualStrengths: (parsed.visualStrengths || []).filter(Boolean).slice(0, 4),
            visualRecommendations: (parsed.visualRecommendations || []).filter(Boolean).slice(0, 4),
        }
        console.log(`   👁️ Feed vision: ${images.length} postů analyzováno — "${profile.visualStyleSummary.substring(0, 80)}..."`)
        return profile
    } catch (err) {
        console.warn(`⚠️ analyzeFeedVisuals failed: ${(err as Error).message?.substring(0, 100)}`)
        return null
    }
}
