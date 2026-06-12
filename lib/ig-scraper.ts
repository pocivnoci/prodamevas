/**
 * HikerAPI Instagram scraper — shared by onboarding enrichment and the
 * weekly growth-snapshot cron. Server-only (service key in env).
 * Fail-open: returns null on any error; callers continue without IG data.
 */

const HIKERAPI_KEY = process.env.HIKERAPI_KEY || ''
const HIKERAPI_BASE = 'https://api.hikerapi.com'
const HIKERAPI_TIMEOUT = 15_000

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
    if (!HIKERAPI_KEY) {
        console.warn('⚠️ HIKERAPI_KEY not set — skipping IG scraping')
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
                headers: { 'x-access-key': HIKERAPI_KEY, 'accept': 'application/json' },
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
                        headers: { 'x-access-key': HIKERAPI_KEY, 'accept': 'application/json' },
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
