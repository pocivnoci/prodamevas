/**
 * Shared Database Types
 * =====================
 * Types matching Supabase schema for use across server actions and frontend.
 * Single source of truth — no more `any[]` in useState or return types.
 */

// ─── Post Status ─────────────────────────────────────────────

/** "plan_draft" is legacy — no longer minted (showcase posts are plain "draft" now); old rows are treated as drafts. */
export type IGPostStatus = "draft" | "ready" | "scheduled" | "posting" | "posted" | "failed" | "plan_locked" | "plan_draft"

// ─── IG Post ─────────────────────────────────────────────────

export interface IGPost {
    id: string
    client_id: string
    caption: string | null
    hashtags: string[] | null
    call_to_action: string | null
    image_prompt: string | null
    image_url: string | null
    image_style: string | null
    scheduled_for: string | null
    time_slot: string | null
    status: IGPostStatus | string
    content_pillar: string | null
    product_id: string | null
    likes: number | null
    comments: number | null
    saves: number | null
    reach: number | null
    shares: number | null
    profile_visits: number | null
    views: number | null
    link_clicks: number | null
    quality_score?: number | null
    feedback?: string | null
    revision_of?: string | null
    link_type?: "revision" | "variant" | null
    posted_at?: string | null
    // Publishing (ig-publisher cron)
    media_type?: string | null
    ig_media_id?: string | null
    permalink?: string | null
    publish_error?: string | null
    publish_attempts?: number | null
    created_at: string
    updated_at?: string
    // Joined relations
    ig_post_types?: { name?: string; display_name: string; emoji: string } | null
    /** Native image QA outcome from ig_generation_log ("pass" | "retry_pass" | "native_forced")
     *  — attached by getIGPostsList so the dashboard can flag posts whose image never passed
     *  vision QA cleanly (diacritics/garbled text) before a human publishes them. */
    qa_status?: string | null
    /** Výsledek faktické brány z ig_generation_log ("clean" | "repaired" | "flagged") —
     *  připojuje getIGPostsList, aby karta příspěvku uměla varovat, že v textu zůstalo
     *  nepodložené tvrzení. null = brána neproběhla, což NENÍ totéž co „v pořádku". */
    fact_status?: string | null
    /** Konkrétní nepodložená tvrzení k `fact_status = "flagged"` (tooltip na kartě). */
    fact_flags?: string[] | null
    /** Tvrzení doložená na webu i s odkazem (instagram/fact-web.ts) — panel „Ověřeno
     *  na webu" v detailu příspěvku. */
    fact_sources?: { claim: string; url: string; title?: string; quote?: string }[] | null
    /** Previous states, one pushed before each editPost() call (newest last, capped at 10).
     *  Only the length matters to the UI — it drives the "Vrátit zpět" button. */
    edit_history?: PostEditHistoryEntry[] | null
    /** Zdrojové artefakty reelu (`ig_posts.video_source`) — bez nich se titulky
     *  přerenderovat nedají. NULL u všeho, co není reel, a u reelů před 9/2026. */
    video_source?: ReelVideoSource | null
}

/** Jedna titulková karta tak, jak ji vidí uživatel: text a čas ve VÝSLEDNÉM videu. */
export interface ReelSubtitleCard {
    text: string
    start: number
    end: number
}

/**
 * Co po reelu zbude, aby šly titulky přerenderovat bez nového videa.
 *
 * IG u reelu nebere titulkovou stopu — titulky jsou vypálené do obrazu, takže
 * „přepiš titulek" = složit kompozici znovu (`instagram/reel-recompose.ts`).
 * K tomu je potřeba surové video ze Seedance a voiceover WAV; obojí se do 9/2026
 * zahazovalo hned po kompozici. Zdroj pravdy o tvaru sloupce je tenhle typ
 * (migrace `supabase/migrations/20260912_reel_video_source.sql`).
 */
export interface ReelVideoSource {
    /** Bucket značky (`config.storageBucket`) — obě cesty jsou relativní k němu. */
    bucket: string
    /** Surové MP4 ze Seedance, BEZ titulků a voiceoveru. Chybí, když bylo nad kvótou bucketu. */
    rawVideoPath?: string
    /** Složená voiceover stopa (WAV). Od 9/2026 se po kompozici nemaže. */
    voiceoverPath?: string
    /** Bucket voiceoveru, když se od `bucket` liší (klient si ho přenastavil mezi
     *  checkpointem a kompozicí). Prázdné = tentýž bucket. */
    voiceoverBucket?: string
    /** Věty narrace s časy — z nich se karty chunkují znovu, když se změní styl. */
    timeline: ReelSubtitleCard[]
    /** Karty, které se skutečně vypálily. Tohle edituje uživatel v detailu příspěvku. */
    cards: ReelSubtitleCard[]
    /** Zrychlení voiceoveru z časové osy (1 = žádné) — kompozice ho musí zopakovat. */
    atempo: number
    durationSeconds: number
    /** Styl titulků, se kterým se reel vyrenderoval (`SubtitleStyleConfig`). */
    subtitleStyle?: {
        preset: "classic" | "cards" | "minimal"
        position?: "bottom" | "center" | "top"
        size?: "s" | "m" | "l"
        color?: string
        accent?: string
    }
    /** Storyboard režiséra — kontext pro pozdější diagnostiku, kompozice ho nečte. */
    storyboard?: unknown
    /** `voiceover` = dnešní reel s namluvenou narrací. Připraveno na textový režim (R4). */
    mode: "voiceover" | "text"
}

/** One undo step for editPost() — the post's state BEFORE that edit was applied. */
export interface PostEditHistoryEntry {
    at: string
    /** `subtitles` = přerenderování titulků reelu (job `reel_recompose`, 0 kreditů). */
    scope: "text" | "image" | "both" | "subtitles"
    instruction: string
    preserve?: string | null
    region?: { x: number; y: number; w: number; h: number } | null
    slide_index?: number | null
    image_url: string | null
    image_prompt: string | null
    image_style: string | null
    caption: string | null
    hashtags: string[] | null
    /** Jen u `scope: "subtitles"` — karty a styl PŘED přerenderováním, aby vrácení
     *  zpět nevrátilo staré video s novými kartami. */
    video_source?: ReelVideoSource | null
}

// ─── IG Post Type ────────────────────────────────────────────

export interface IGPostType {
    id: string
    client_id: string
    name: string
    display_name: string
    description: string | null
    template: string | null
    emoji: string | null
    frequency: string | null
    is_active: boolean
    created_at: string
}

// ─── IG Post Idea ────────────────────────────────────────────

export interface IGIdea {
    id: string
    client_id: string
    category: string
    subcategory: string | null
    title: string
    content: string
    keywords: string[] | null
    used_count: number
    last_used_at: string | null
    cooldown_days: number
    is_active: boolean
    performance_score: number | null
    times_used_with_metrics: number | null
    created_at: string
}

// ─── IG Review ───────────────────────────────────────────────

export interface IGReview {
    id: string
    client_id: string
    customer_name: string | null
    customer_initials: string | null
    quote: string
    rating: number | null
    time_saved: string | null
    transformation: string | null
    source: string | null
    used_at: string | null
    is_approved: boolean
    created_at: string
}

// ─── IG Product ──────────────────────────────────────────────

export interface IGProduct {
    id: string
    client_id: string
    name: string
    type: string | null
    slug: string
    variants: number | null
    price: string | null
    description: string | null
    image_urls: string[] | null
    created_at: string
    updated_at: string
}

// ─── Brand Memory ────────────────────────────────────────────

export type BrandMemoryType = "pattern" | "preference" | "avoid" | "visual"

export interface BrandMemoryRow {
    id: string
    client_id: string
    memory_type: BrandMemoryType
    content: string
    confidence: number
    source_post_ids: string[] | null
    times_confirmed: number
    created_at: string
}

// ─── IG Job ──────────────────────────────────────────────────

export type IGJobStatus =
    | "pending" | "researcher" | "copywriter" | "critic"
    | "art_director" | "rendering" | "uploading" | "done" | "failed"
    | "chief_editor" | "strategist" | "video"

export interface IGJob {
    id: string
    client_id: string
    config: Record<string, unknown>
    status: IGJobStatus
    progress: number
    agent_message: string | null
    editorial_log: unknown[] | null
    result: Record<string, unknown> | null
    error: string | null
    created_at: string
    updated_at: string
}

// ─── Generation Log ──────────────────────────────────────────

export interface IGGenerationLog {
    id: string
    client_id: string
    post_id: string
    prompt_used: string | null
    model_used: string | null
    tokens_used: number | null
    generation_time_ms: number | null
    error: string | null
    created_at: string
}

// ─── Client ──────────────────────────────────────────────────

export interface Client {
    id: string
    slug: string
    name: string
    website: string | null
    instagram: string | null
    config: Record<string, unknown>
    is_active: boolean
    created_at: string
    updated_at: string
}

// ─── Dashboard Stats (composite return type) ─────────────────

export interface DashboardStats {
    drafts: number
    ready: number
    posted: number
    total: number
    ideasCount: number
    recentPosts: {
        id: string
        caption: string
        image_url: string | null
        status: string
        created_at: string
        type_name: string
        type_emoji: string
    }[]
    weekDays: {
        date: string
        dayName: string
        isToday: boolean
        posts: {
            id: string
            caption: string
            image_url: string | null
            status: string
            type_emoji: string
        }[]
    }[]
    recentActivity: {
        type: string
        label: string
        time: string
        emoji: string
    }[]
    quickMetrics: {
        postsWithMetrics: number
        avgLikes: number
        avgComments: number
        avgSaves: number
        avgReach: number
        totalEngagement: number
        bestPostId: string
        bestPostCaption: string
    } | null
}

// ─── Server Action Result ────────────────────────────────────

export interface ActionResult<T = void> {
    success: boolean
    error?: string
    data?: T
}
