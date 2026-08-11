/**
 * HikerAPI Instagram scraper — shared by onboarding enrichment and the
 * weekly growth-snapshot cron. Server-only (service key in env).
 * Fail-open: returns null on any error; callers continue without IG data.
 */

const HIKERAPI_BASE = 'https://api.hikerapi.com'
const HIKERAPI_TIMEOUT = 15_000

/**
 * Klíč se čte AŽ PŘI VOLÁNÍ, ne při načtení modulu.
 *
 * Modulová konstanta zamrzne na hodnotě, kterou má env v okamžiku importu. V Nextu
 * to nevadí, ale `tsx` skripty (dry-run obchodního agenta, utility) načítají
 * `.env.local` až v těle skriptu — a scraper pak tvrdil „HIKERAPI_KEY not set",
 * přestože klíč byl k dispozici.
 *
 * Zároveň se odmítne zástupný text: `.env.local` obsahoval `[SET_ME]`, což je
 * neprázdný řetězec, takže starý guard `if (!KEY)` ho pustil dál a každé volání
 * skončilo Unauthorized. Tiché plýtvání requestem je horší než jasné „nenastaveno".
 */
function hikerKey(): string {
    const raw = (process.env.HIKERAPI_KEY || '').trim()
    if (!raw || raw.startsWith('[') || raw.toUpperCase().includes('SET_ME')) return ''
    return raw
}

export interface IgProfileData {
    username: string
    fullName: string
    biography: string
    followerCount: number
    followingCount: number
    mediaCount: number
    isBusinessAccount: boolean
    businessCategory?: string
    externalUrl?: string
    profilePicUrl?: string
    recentPosts: {
        caption: string
        likeCount: number
        commentCount: number
        timestamp: string
        mediaUrl?: string
        mediaType: 'image' | 'video' | 'carousel'
    }[]
}

export async function fetchInstagramProfile(
    handle: string,
    options?: { includePosts?: boolean }
): Promise<IgProfileData | null> {
    const key = hikerKey()
    if (!key) {
        console.warn('⚠️ HIKERAPI_KEY není nastavený (nebo je to zástupný text) — přeskakuji IG scraping')
        return null
    }
    const includePosts = options?.includePosts ?? true

    // Normalize handle: remove @ prefix
    const username = handle.replace(/^@/, '').trim().toLowerCase()
    if (!username) return null

    try {
        // 1. Fetch profile
        const profileRes = await fetch(
            `${HIKERAPI_BASE}/v1/user/by/username?username=${encodeURIComponent(username)}`,
            {
                headers: { 'x-access-key': key, 'accept': 'application/json' },
                signal: AbortSignal.timeout(HIKERAPI_TIMEOUT),
            }
        )

        if (!profileRes.ok) {
            const errBody = await profileRes.text().catch(() => '')
            console.warn(`⚠️ HikerAPI profile ${profileRes.status}: ${errBody.slice(0, 200)}`)
            return null
        }

        const profile = await profileRes.json()
        if (!profile.pk && !profile.username) {
            console.warn('⚠️ HikerAPI: empty profile response')
            return null
        }

        const userId = profile.pk || profile.id

        // 2. Fetch recent posts (gql endpoint, up to 12)
        let recentPosts: IgProfileData['recentPosts'] = []
        if (userId && includePosts) {
            try {
                const mediasRes = await fetch(
                    `${HIKERAPI_BASE}/gql/user/medias?user_id=${userId}&flat=true`,
                    {
                        headers: { 'x-access-key': key, 'accept': 'application/json' },
                        signal: AbortSignal.timeout(HIKERAPI_TIMEOUT),
                    }
                )

                if (mediasRes.ok) {
                    const mediasData = await mediasRes.json()
                    // Flatten — response can be { items: [...] } or direct array
                    const items = Array.isArray(mediasData) ? mediasData : (mediasData.items || mediasData.edges || [])

                    recentPosts = items.slice(0, 12).map((item: any) => {
                        const node = item.node || item
                        const captionText = typeof node.caption === 'string' ? node.caption
                            : node.caption?.text
                            || node.edge_media_to_caption?.edges?.[0]?.node?.text || ''
                        // HikerAPI uses '1ltaken_at' (unix seconds) or taken_at_timestamp
                        const ts = node['1ltaken_at'] || node.taken_at_timestamp || node.taken_at
                        return {
                            caption: captionText,
                            likeCount: node.like_count || node.edge_liked_by?.count || 0,
                            commentCount: node.comment_count || node.edge_media_to_comment?.count || 0,
                            timestamp: typeof ts === 'number'
                                ? new Date(ts * 1000).toISOString()
                                : (ts || ''),
                            mediaUrl: node.display_url || node.image_versions2?.candidates?.[0]?.url || undefined,
                            mediaType: node.media_type === 8 || node.__typename === 'GraphSidecar' ? 'carousel'
                                : node.media_type === 2 || node.__typename === 'GraphVideo' ? 'video'
                                    : 'image' as const,
                        }
                    })
                }
            } catch (mediaErr) {
                console.warn('⚠️ HikerAPI medias fetch failed:', (mediaErr as Error).message)
            }
        }

        return {
            username: profile.username || username,
            fullName: profile.full_name || '',
            biography: profile.biography || '',
            followerCount: profile.follower_count || 0,
            followingCount: profile.following_count || 0,
            mediaCount: profile.media_count || 0,
            isBusinessAccount: profile.is_business || false,
            businessCategory: profile.business_category_name || profile.category_name || undefined,
            externalUrl: profile.external_url || undefined,
            profilePicUrl: profile.profile_pic_url_hd || profile.profile_pic_url || undefined,
            recentPosts,
        }
    } catch (error) {
        console.warn('⚠️ fetchInstagramProfile error:', (error as Error).message)
        return null
    }
}

/**
 * Estimate a brand's real posting cadence (posts per week) from the timestamps of its recent
 * posts. Used at onboarding to seed `ClientConfig.postsPerWeek`, so the content plan reflects how
 * often the brand actually posts instead of assuming one post per day.
 *
 * Rate = posts ÷ span, computed over the window of valid timestamps. Clamped to 2–7 (below 2 the
 * plan is too thin to be useful; Instagram rarely rewards more than daily). Returns null when
 * there isn't enough signal (<2 dated posts, or all posts share one instant) so the caller can
 * fall back to the default.
 */
export function estimatePostsPerWeek(timestamps: (string | undefined | null)[]): number | null {
    const ms = (timestamps || [])
        .map(t => (t ? Date.parse(t) : NaN))
        .filter(n => Number.isFinite(n))
        .sort((a, b) => b - a)
    if (ms.length < 2) return null

    const spanDays = (ms[0] - ms[ms.length - 1]) / 86_400_000
    if (spanDays <= 0) return null

    // (n−1) gaps span `spanDays` → posts/week = 7 × gaps ÷ span.
    const perWeek = (7 * (ms.length - 1)) / spanDays
    return Math.min(7, Math.max(2, Math.round(perWeek)))
}
