/**
 * Instagram Content Automation — Multi-Client Engine
 * ====================================================
 *
 * Gemini 3 Pro + Imagen 4 Ultra + Veo 3.1
 *
 * Features:
 * - Config-driven brand voice & content pillars
 * - Performance learning loop
 * - Strict deduplication (90-day cooldown)
 * - Text overlay on images
 * - Carousel & Reel support
 * - Image generation (Imagen 4 Ultra 2K)
 * - Video generation (Veo 3.1)
 * - Product idea & design generation
 *
 * Usage:
 *   npx tsx instagram/autopilot.ts                          # 1 post (default: mobilnamiru)
 *   npx tsx instagram/autopilot.ts --config=hanzfans        # 1 post for HanzFans
 *   npx tsx instagram/autopilot.ts --config=hanzfans --week # week plan
 *   npx tsx instagram/autopilot.ts --dry-run                # preview only
 */

// Main generation functions (from autopilot engine)
export {
    generateOnePost,
    generateBatch,
} from './autopilot'

// Service functions (for admin UI)
export {
    getActivePostTypes,
    getAvailableIdeas,
    getApprovedReviews,
    getRecentPosts,
    getPostsByStatus,
    createPost,
    updatePostStatus,
    addIdea,
    addReview,
} from './service'

// Config system
export { loadConfig } from './configs'
export type { ClientConfig, ContentPillar, FeedAesthetic, ProductInfo } from './configs/types'

// Gemini client
export {
    generateText,
    generateImage,
    generateVideo,
} from './gemini-client'

// Types
export type {
    PostType,
    PostIdea,
    Review,
    Post,
    GenerateOptions,
    EmotionalHook,
    BrandVoiceConfig,
    HookTemplate,
    ToneModifier,
} from './types'
