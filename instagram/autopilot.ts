/**
 * Instagram Autopilot — Closed-Loop Content Engine
 * ==================================================
 *
 * Fully automated with:
 *   🔄 Feedback loop — learns from post performance
 *   💰 Budget control — set max posts/cost before running
 *   🚫 Strict deduplication — never repeats ideas
 *
 * Usage:
 *   npx tsx instagram/autopilot.ts                         # 1 post
 *   npx tsx instagram/autopilot.ts --week                  # 7 posts
 *   npx tsx instagram/autopilot.ts --budget=5              # max 5 posts
 *   npx tsx instagram/autopilot.ts --type=meme             # specific type
 *   npx tsx instagram/autopilot.ts --dry-run               # preview only
 *   npx tsx instagram/autopilot.ts --feedback              # record performance
 *   npx tsx instagram/autopilot.ts --stats                 # show what works
 */

import supabase from "../supabase/client"
import supabaseAdmin from "../supabase/admin"
import { generateText, generateImage, generateImageWithReferences, generateVideo, ai } from "./gemini-client"
import { overlayText } from "./text-overlay"
import {
    getActivePostTypes,
    getAvailableIdeas,
    getApprovedReviews,
    getRecentPosts,
    createPost,
    markIdeaAsUsed,
    markReviewAsUsed,
    logGeneration,
    batchInsertIdeas,
    setActiveProject,
    getActiveProject,
    ensurePostTypes,
} from "./service"
import type { HookTemplate } from "./types"
import { runProductIdeas, runDesignConcept } from "./product-generator"
import { loadConfig } from "./configs"
import type { ClientConfig, PostFormat } from "./configs/types"
import type { PostType, PostIdea, Review, Post } from "./types"

// Active client config (set from --config flag or ensureConfig)
let CLIENT_CONFIG: ClientConfig | null = null

/**
 * Smart config loader — ensures CLIENT_CONFIG is set before generation.
 * Called automatically by generateOnePost/generateBatch when invoked from server actions.
 * No-op if config is already loaded for the same client.
 */
async function ensureConfig(configName?: string): Promise<void> {
    const name = configName || "mobilnamiru"
    if (CLIENT_CONFIG && CLIENT_CONFIG.id === name) return // already loaded
    CLIENT_CONFIG = await loadConfig(name)

    // Resolve slug → uuid and set the active client for all service queries
    const { resolveClientId } = await import("./configs")
    const clientUuid = await resolveClientId(name)
    setActiveProject(clientUuid)
    console.log(`🏢 Config loaded: ${CLIENT_CONFIG.name} (${name} → ${clientUuid.substring(0, 8)}...)`)

    // Auto-create any missing post types in DB for this client
    await ensurePostTypes(CLIENT_CONFIG, clientUuid)
}

// ============================================
// COST ESTIMATES (per operation in $)
// ============================================

const COSTS = {
    textGeneration: 0.01,     // Gemini 3.1 Pro per call
    promptRefinement: 0.01,   // Gemini 3.1 Pro for image prompt refinement
    imageGeneration: 0.08,    // Imagen 4 Ultra 2K per image
    videoPerSecond: 0.15,     // Veo 3.1 Fast per second
    perPost: 0.10,            // text + refinement + image combined
    perCarousel: 0.37,        // text + 4× (refinement + image) combined
    perReel: 1.07,            // text + refinement + video (7s) combined
}

// Helper: detect post format from config (with prefix fallback)
const DEFAULT_FORMAT: PostFormat = { aspectRatio: "3:4", medium: "image", overlayStyle: "default" }

function getPostFormat(typeName: string): PostFormat {
    const config = CLIENT_CONFIG
    if (config?.postFormats?.[typeName]) return config.postFormats[typeName]
    if (config?.defaultFormat) return config.defaultFormat
    // Fallback: prefix-based detection for backward compat
    if (typeName.startsWith("reel_")) return { aspectRatio: "9:16", medium: "reel", overlayStyle: "none" }
    if (typeName.startsWith("carousel_")) return { aspectRatio: "1:1", medium: "carousel", overlayStyle: "cover" }
    return DEFAULT_FORMAT
}

const getReelDuration = (_typeName: string) => 8  // Veo 3.1 @ 1080p requires 8s

// Idea cooldown — recycle after 90 days (3 months)
const IDEA_COOLDOWN_DAYS = 90

// ============================================
// CONFIG-DRIVEN HELPERS — read from CLIENT_CONFIG
// ============================================

/** Find which pillar a post type belongs to */
function getPillarForType(typeName: string): string {
    const config = CLIENT_CONFIG!
    for (const [pillar, pillarConfig] of Object.entries(config.contentPillars)) {
        if (pillarConfig.postTypes.includes(typeName)) return pillar
    }
    return Object.keys(config.contentPillars)[0]  // Default to first pillar
}

/** Get tone description for system prompt */
function getToneDescription(postType: string): string {
    const tone = CLIENT_CONFIG!.brandVoice.toneByPostType[postType]
    if (!tone) return ""

    const descriptions: string[] = []

    if (tone.humorLevel >= 4) descriptions.push("vtipný a hravý")
    else if (tone.humorLevel >= 2) descriptions.push("lehce humorný")
    else descriptions.push("vážný a seriózní")

    if (tone.urgencyLevel >= 4) descriptions.push("naléhavý")
    else if (tone.urgencyLevel >= 2) descriptions.push("motivující")
    else descriptions.push("klidný")

    if (tone.intimacyLevel >= 4) descriptions.push("osobní a blízký")
    else if (tone.intimacyLevel >= 2) descriptions.push("přátelský")
    else descriptions.push("profesionální")

    if (tone.educationalLevel >= 4) descriptions.push("vzdělávací s konkrétními fakty")
    else if (tone.educationalLevel >= 2) descriptions.push("informativní")
    else descriptions.push("zábavný")

    return descriptions.join(", ")
}

/** Get random hook templates for a post type */
function getHookTemplates(postType: string, count: number = 3): HookTemplate[] {
    const applicable = CLIENT_CONFIG!.brandVoice.hookTemplates.filter(
        template => template.bestFor.includes(postType)
    )
    return applicable.sort(() => Math.random() - 0.5).slice(0, count)
}

/** Get random CTAs */
function getRandomCTAs(count: number = 3): string[] {
    return [...CLIENT_CONFIG!.brandVoice.ctaVariations]
        .sort(() => Math.random() - 0.5)
        .slice(0, count)
}

// ============================================
// CAPTION JSON SCHEMA — Structured output (dynamic)
// ============================================

import { Type } from "@google/genai"

function buildCaptionSchema() {
    const config = CLIENT_CONFIG!
    return {
        type: Type.OBJECT,
        properties: {
            hook: {
                type: Type.STRING,
                description: "First sentence that stops scrolling — bold, shocking (max 15 words). NO EMOJI in hook.",
            },
            body: {
                type: Type.STRING,
                description: `Main text (max 120 words). ${config.contentFocus}`,
            },
            cta: {
                type: Type.STRING,
                description: `Call to action — ideally points to ${config.website}`,
            },
            hashtags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "8-10 relevant hashtags",
            },
            imagePrompt: {
                type: Type.STRING,
                description: "English prompt for Imagen 4 Ultra. MUST be 2-3 sentences describing: (1) specific scene/environment, (2) lighting and mood, (3) camera angle. Generate ONLY background photo, NO TEXT in image! Style: photorealistic, premium, 1:1 square.",
            },
            imageSubtext: {
                type: Type.STRING,
                description: "Subtext below hook (benefit, max 8 words, Czech)",
            },
        },
        required: ["hook", "body", "cta", "hashtags", "imagePrompt", "imageSubtext"],
    }
}
// ============================================
// VIDEO SCHEMA — Structured output for Reels (dynamic)
// ============================================

function buildVideoSchema() {
    const config = CLIENT_CONFIG!
    return {
        type: Type.OBJECT,
        properties: {
            hook: {
                type: Type.STRING,
                description: "Opening problem/question (2-4 words, punchy, Czech). NO EMOJI.",
            },
            videoScript: {
                type: Type.STRING,
                description: `Scene-by-scene description for Veo 3.1. MUST have 3 scenes: Scene 1 (0-2s): Hook visual. Scene 2 (2-7s): Main content. Scene 3 (7-10s): CTA with ${config.website}.`,
            },
            caption: {
                type: Type.STRING,
                description: "Instagram caption for the Reel (max 100 words, Czech)",
            },
            cta: {
                type: Type.STRING,
                description: `Must mention ${config.website}`,
            },
            hashtags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "8-10 relevant hashtags",
            },
        },
        required: ["hook", "videoScript", "caption", "cta", "hashtags"],
    }
}

// ============================================
// CAROUSEL SCHEMA — multi-slide posts (dynamic)
// ============================================

function buildCarouselSchema() {
    const config = CLIENT_CONFIG!
    return {
        type: Type.OBJECT,
        properties: {
            hook: {
                type: Type.STRING,
                description: "Cover slide headline (max 8 words, Czech, punchy). ZADNE EMOJI.",
            },
            imageSubtext: {
                type: Type.STRING,
                description: "Cover slide subtext - brief benefit or teaser (max 8 words, Czech, e.g. 'Navod krok za krokem')",
            },
            slides: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        headline: { type: Type.STRING, description: "Step headline (max 6 words, Czech, e.g. 'Krok 1: Otevri Nastaveni')" },
                        subtext: { type: Type.STRING, description: "Step detail - exact path or explanation (max 20 words, Czech)" },
                        imagePrompt: { type: Type.STRING, description: "English image prompt for this step - MUST share the same environment/setting as all other slides" },
                    },
                    required: ["headline", "subtext", "imagePrompt"],
                },
                description: "Exactly 3 steps that walk through ONE topic step-by-step (cover slide introduces the topic)",
            },
            body: {
                type: Type.STRING,
                description: "Full caption for the post (max 120 words, Czech)",
            },
            cta: {
                type: Type.STRING,
                description: `CTA mentioning ${config.website}`,
            },
            hashtags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "8-10 relevant hashtags",
            },
            imagePrompt: {
                type: Type.STRING,
                description: "English image prompt for cover slide background - sets the visual theme for ALL slides",
            },
            visualTheme: {
                type: Type.STRING,
                description: "Shared visual theme for ALL slides in 1 sentence (e.g. 'Dark urban street scene with neon reflections under moody studio lighting'). All slide imagePrompts MUST stay within this theme.",
            },
        },
        required: ["hook", "imageSubtext", "slides", "body", "cta", "hashtags", "imagePrompt", "visualTheme"],
    }
}

/** Build smart week plan based on performance data */
function buildSmartWeekPlan(performance: PerformanceInsight, count: number = 14): string[] {
    const config = CLIENT_CONFIG!
    // If no performance data, use static plan from config repeating to fill count
    if (performance.avgEngagement === 0) {
        const staticPlan: string[] = []
        for (let i = 0; i < count; i++) {
            staticPlan.push(config.weekPlan[i % config.weekPlan.length])
        }
        return staticPlan
    }

    // Dynamic ratios from config
    const ratios: Record<string, number> = {}
    for (const [key, pillar] of Object.entries(config.contentPillars)) {
        ratios[key] = pillar.ratio
    }

    // Adjust ratios based on performance (dynamic pillar names)
    if (performance.pillarPerformance) {
        const pp = performance.pillarPerformance
        const pillarNames = Object.keys(ratios)
        // Boost underperforming pillars slightly
        for (const name of pillarNames) {
            if (pp[name] && pp[name].avgScore < performance.avgEngagement * 0.5) {
                ratios[name] = Math.min(0.5, ratios[name] + 0.05)
            }
        }
    }

    // Build plan from ratios
    const plan: string[] = []
    for (const [pillar, ratio] of Object.entries(ratios)) {
        const pillarCount = Math.max(1, Math.round(count * ratio))
        const types = config.contentPillars[pillar]?.postTypes || []
        for (let i = 0; i < pillarCount && plan.length < count; i++) {
            plan.push(types[i % types.length])
        }
    }

    // Pad if rounding left us short
    while (plan.length < count) {
        plan.push(config.weekPlan[plan.length % config.weekPlan.length])
    }

    // Shuffle to avoid clustering same pillar (but keep some structure)
    // Interleave: reach, value, convert, reach, value, connect...
    const byPillar: Record<string, string[]> = Object.fromEntries(Object.keys(config.contentPillars).map(k => [k, []]))
    for (const type of plan) {
        const pillar = getPillarForType(type)
        byPillar[pillar].push(type)
    }

    const interleaved: string[] = []
    const pillarKeys = Object.keys(config.contentPillars)
    // Create interleave pattern: repeat pillar keys, weighted by ratio
    const pillarOrder = pillarKeys.flatMap(k => {
        const r = config.contentPillars[k].ratio
        return Array(Math.max(1, Math.round(r * 10))).fill(k)
    })
    let pillarIdx = 0
    while (interleaved.length < count) {
        const p = pillarOrder[pillarIdx % pillarOrder.length]
        if (byPillar[p].length > 0) {
            interleaved.push(byPillar[p].shift()!)
        }
        pillarIdx++
        // Safety: avoid infinite loop
        if (pillarIdx > count * 3) break
    }

    return interleaved.slice(0, count)
}

// ============================================
// PERFORMANCE ANALYZER — "What works?"
// ============================================

interface PillarPerformance {
    avgScore: number
    bestPosts: string[]  // top hook excerpts
    topPatterns: string[]
}

interface PerformanceInsight {
    bestPostTypes: string[]
    bestHooks: string[]
    bestTimeSlots: string[]
    avgEngagement: number
    topPatterns: string[]
    // Growth Engine additions
    pillarPerformance?: Record<string, PillarPerformance>
    conversionRate: number
    bestConvertingTypes: string[]
}

async function analyzePerformance(): Promise<PerformanceInsight> {
    const { data: posts } = await supabase
        .from("ig_posts")
        .select("*")
        .eq("status", "posted")
        .eq("client_id", getActiveProject())
        .order("created_at", { ascending: false })
        .limit(50)

    const postedPosts = posts || []

    if (postedPosts.length === 0) {
        return {
            bestPostTypes: [],
            bestHooks: [],
            bestTimeSlots: [],
            avgEngagement: 0,
            topPatterns: [],
            conversionRate: 0,
            bestConvertingTypes: [],
        }
    }

    // Calculate engagement + reach + conversion scores per post
    const scored = postedPosts.map(p => {
        const engagement = (p.likes || 0) + (p.comments || 0) * 3 + (p.saves || 0) * 5
        const reachScore = (p.saves || 0) * 5 + (p.shares || 0) * 8 + (p.reach || 0) * 0.01 + (p.comments || 0) * 2
        const conversionScore = (p.link_clicks || 0) * 10 + (p.profile_visits || 0) * 3 + (p.saves || 0)
        return { ...p, engagement, reachScore, conversionScore }
    })

    // Sort by engagement
    scored.sort((a, b) => b.engagement - a.engagement)

    // Find best post types
    const typeScores: Record<string, number[]> = {}
    for (const p of scored) {
        const typeId = p.post_type_id || "unknown"
        if (!typeScores[typeId]) typeScores[typeId] = []
        typeScores[typeId].push(p.engagement)
    }

    const typeAvgs = Object.entries(typeScores)
        .map(([id, scores]) => ({
            id,
            avg: scores.reduce((s, v) => s + v, 0) / scores.length,
        }))
        .sort((a, b) => b.avg - a.avg)

    // Extract hooks from top posts
    const topPosts = scored.slice(0, 5)
    const bestHooks = topPosts
        .map(p => p.caption?.split("\n")[0] || "")
        .filter(Boolean)

    // Best time slots
    const timeSlotScores: Record<string, number[]> = {}
    for (const p of scored) {
        const slot = p.time_slot || "afternoon"
        if (!timeSlotScores[slot]) timeSlotScores[slot] = []
        timeSlotScores[slot].push(p.engagement)
    }

    const bestTimeSlots = Object.entries(timeSlotScores)
        .map(([slot, scores]) => ({
            slot,
            avg: scores.reduce((s, v) => s + v, 0) / scores.length,
        }))
        .sort((a, b) => b.avg - a.avg)
        .slice(0, 2)
        .map(s => s.slot)

    // Detect patterns in top posts
    const patterns: string[] = []
    const topCaptions = topPosts.map(p => p.caption || "").join(" ")
    if (topCaptions.includes("POV:")) patterns.push("POV format")
    if (topCaptions.includes("?")) patterns.push("Questions in hook")
    if (topCaptions.includes("😅") || topCaptions.includes("🫠")) patterns.push("Self-deprecating humor")
    if (topCaptions.match(/\d+/)) patterns.push("Numbers/statistics")
    if (topCaptions.includes("Znáš ten pocit")) patterns.push("Relatable opening")

    // Per-pillar analysis
    const pillarData: Record<string, typeof scored> = Object.fromEntries(Object.keys(CLIENT_CONFIG!.contentPillars).map(k => [k, []]))
    for (const p of scored) {
        const pillar = p.content_pillar || getPillarForType(getPostTypeNameById(p.post_type_id, postedPosts))
        if (pillarData[pillar]) pillarData[pillar].push(p)
    }

    const buildPillarPerf = (posts: typeof scored): PillarPerformance => ({
        avgScore: posts.length > 0 ? posts.reduce((s, p) => s + p.engagement, 0) / posts.length : 0,
        bestPosts: posts.slice(0, 3).map(p => p.caption?.split("\n")[0]?.substring(0, 60) || ""),
        topPatterns: extractPatterns(posts.map(p => p.caption || "")),
    })

    // Conversion tracking
    const totalReach = scored.reduce((s, p) => s + (p.reach || 0), 0)
    const totalClicks = scored.reduce((s, p) => s + (p.link_clicks || 0), 0)
    const conversionRate = totalReach > 0 ? totalClicks / totalReach : 0

    // Best converting types
    const convertScoresByType: Record<string, number[]> = {}
    for (const p of scored) {
        const typeId = p.post_type_id || "unknown"
        if (!convertScoresByType[typeId]) convertScoresByType[typeId] = []
        convertScoresByType[typeId].push(p.conversionScore)
    }
    const bestConvertingTypes = Object.entries(convertScoresByType)
        .map(([id, scores]) => ({ id, avg: scores.reduce((s, v) => s + v, 0) / scores.length }))
        .sort((a, b) => b.avg - a.avg)
        .slice(0, 3)
        .map(t => t.id)

    return {
        bestPostTypes: typeAvgs.slice(0, 3).map(t => t.id),
        bestHooks,
        bestTimeSlots,
        avgEngagement: scored.reduce((s, p) => s + p.engagement, 0) / scored.length,
        topPatterns: patterns,
        pillarPerformance: Object.fromEntries(
            Object.keys(pillarData).map(k => [k, buildPillarPerf(pillarData[k])])
        ) as Record<string, PillarPerformance>,
        conversionRate,
        bestConvertingTypes,
    }
}

/** Extract common patterns from captions */
function extractPatterns(captions: string[]): string[] {
    const combined = captions.join(" ")
    const patterns: string[] = []
    if (combined.includes("POV:")) patterns.push("POV format")
    if (combined.includes("?")) patterns.push("Questions")
    if (combined.match(/\d+%/)) patterns.push("Percentages")
    if (combined.match(/\d+ hodin|\d+ minut/)) patterns.push("Time stats")
    if (combined.includes("Znáš ten pocit") || combined.includes("Taky")) patterns.push("Relatable")
    if (combined.includes("😅") || combined.includes("🫠")) patterns.push("Humor")
    return patterns
}

/** Helper to get post type name from ID */
function getPostTypeNameById(typeId: string | null, posts: any[]): string {
    // Fallback — we don't have type name in post data, so use a rough guess
    return "value"
}

// ============================================
// STRICT DEDUPLICATION
// ============================================

/** Extract normalized topic keywords from a caption */
function extractTopicKeywords(text: string): Set<string> {
    return new Set(
        text.toLowerCase()
            .replace(/[^a-záčďéěíňóřšťúůýž\s]/g, "")
            .split(/\s+/)
            .filter(w => w.length > 4)
    )
}

/** Check if two hooks are too similar (word overlap > threshold) */
function isHookSimilar(newHook: string, existingHook: string, threshold = 0.5): boolean {
    const a = newHook.toLowerCase().trim()
    const b = existingHook.toLowerCase().trim()
    if (a === b) return true

    const wordsA = new Set(a.split(/\s+/))
    const wordsB = b.split(/\s+/)
    const overlap = wordsB.filter(w => wordsA.has(w)).length
    return overlap / Math.max(wordsA.size, wordsB.length) > threshold
}

/** Check if body content overlaps too much with recent posts */
function isBodySimilar(newBody: string, recentBodies: string[], threshold = 0.4): boolean {
    const newKeywords = extractTopicKeywords(newBody)
    if (newKeywords.size === 0) return false

    return recentBodies.some(existing => {
        const existingKeywords = extractTopicKeywords(existing)
        if (existingKeywords.size === 0) return false
        const overlap = [...newKeywords].filter(w => existingKeywords.has(w)).length
        return overlap / Math.max(newKeywords.size, existingKeywords.size) > threshold
    })
}

async function getUsedIdeaIds(): Promise<Set<string>> {
    const { data } = await supabase
        .from("ig_posts")
        .select("idea_id")
        .eq("client_id", getActiveProject())
        .not("idea_id", "is", null)

    return new Set((data || []).map(p => p.idea_id).filter((id): id is string => id !== null))
}

// ============================================
// MEGA PROMPT BUILDER (with learning)
// ============================================

function buildMegaPrompt(
    postType: PostType,
    idea: PostIdea | null,
    review: Review | null,
    recentCaptions: string[],
    performance: PerformanceInsight,
    userTopic?: string
): string {
    const config = CLIENT_CONFIG!
    const bv = config.brandVoice
    const toneDesc = getToneDescription(postType.name)
    const hookTemplates = getHookTemplates(postType.name, 4)
    const ctaOptions = getRandomCTAs(6)

    // Performance-based learning section
    let learningSection = ""
    if (performance.topPatterns.length > 0 || performance.bestHooks.length > 0) {
        learningSection = `
## 📊 🚨 KRITICKÁ DATA Z REÁLNÉHO VÝKONU (NEJVYŠŠÍ PRIORITA) 🚨 📊
Toto jsou historicky nejúspěšnější formáty pro tuto značku. Tvoje priorita je na nich stavět:

${performance.topPatterns.length > 0 ? `**Top Fungující Vzorce:** ${performance.topPatterns.join(", ")}` : ""}
${performance.bestHooks.length > 0 ? `**Zlaté Hooky (Nejlepší dosah):**\n${performance.bestHooks.map(h => `- "${h}"`).join("\n")}` : ""}
${performance.avgEngagement > 0 ? `**Průměrný Engagement (Benchmarking):** ${performance.avgEngagement.toFixed(0)} bodů` : ""}

⚠️ **INSTRUKCE:** NEKOPÍRUJ tyto přesné fráze doslovně, ale MUSÍŠ použít stejnou psychologii, strukturu a rytmus. Pokud se nejlépe daří "krátkým provokativním otázkám", použij krátkou provokativní otázku.
`
    }

    // Products section for brands with products — now with eshop links
    const productsSection = config.products ? `
## PRODUKTY ZNAČKY (${config.products.length} produktů na ${config.website})
${config.products.map(p => `- **${p.name}** (${p.type}): ${p.description || ""} ${p.price ? `— ${p.price}` : ""} → ${config.website}/p/${p.slug}`).join("\n")}

${["product_drop", "limitka", "outfit_inspo"].includes(postType.name) ? `
### ⚠️ POVINNĚ VYBER KONKRÉTNÍ PRODUKT z výše uvedeného seznamu!
Pro tento typ postu (${postType.display_name}) MUSÍŠ:
- Vybrat 1 konkrétní produkt ze seznamu
- V caption zmínit jeho název a cenu
- V CTA odkázat na jeho eshop URL (${config.website}/p/...)
- V imagePrompt popsat PŘESNĚ tento produkt (barva, design, styl potisk)
` : ""}
` : ""

    return `
${bv.persona}

## TVŮJ ÚKOL
Vytvoř kompletní Instagram post typu: **${postType.emoji || "📱"} ${postType.display_name}**
${postType.description ? `(${postType.description})` : ""}

Brand: ${config.name} | Web: ${config.website} | IG: ${config.instagram}

## BRAND VOICE
${bv.voiceTraits.map(t => `- ${t}`).join("\n")}

### JAZYK
Piš česky, moderní hovorovou češtinou. Krátké věty. Přímé. Bez keců.

### ZAKÁZÁNO
${bv.antiPatterns.map(p => p).join("\n")}

### ⚠️ NIKDY NEPŘEKLÁDEJ ANGLICKÉ NÁZVY!
Názvy produktů, kolekcí a brand names ponechej V ANGLIČTINĚ! Příklady:
- ✅ "Zero Fucks Given" — SPRÁVNĚ (originální název)
- ❌ "Nula fucků na rozdávání" — ŠPATNĚ (přeložený do CZ)
- ✅ "Let It Snow" — SPRÁVNĚ
- ❌ "Nech to sněžit" — ŠPATNĚ
Pokud je název produktu anglicky, VŽDY ho piš anglicky!

## TÓN: ${toneDesc}

${productsSection}
${idea && !userTopic ? `## ZDROJOVÝ NÁPAD
**${idea.title}**: ${idea.content}
Kategorie: ${idea.category}, Platforma: ${idea.subcategory || "general"}
` : ""}
${userTopic ? `## 🎯 ZADANÉ TÉMA OD UŽIVATELE (NEJVYŠŠÍ PRIORITA!)
**Post MUSÍ být PŘESNĚ o tomto tématu:** ${userTopic}
Toto téma má ABSOLUTNÍ PRIORITU — ignoruj zdrojový nápad i automatické návrhy.
Celý post (hook, body, CTA, i image prompt) musí být zaměřen na toto konkrétní téma.
Pokud téma zmiňuje konkrétní produkt, POUŽIJ PŘESNĚ TEN PRODUKT — nevybírej jiný!
` : ""}
${review ? `## RECENZE K VYUŽITÍ
"${review.quote}" — ${review.customer_initials || "Zákazník"}
` : ""}
${learningSection}

## INSPIRACE PRO HOOKY
${hookTemplates.map(h => `- Vzor: "${h.pattern}" → Příklad: "${h.example}" (trigger: ${h.trigger})`).join("\n")}

## MOŽNÉ CTA (vyber nebo uprav)
${ctaOptions.map(c => `- ${c}`).join("\n")}

${(() => {
            const pillar = getPillarForType(postType.name)
            const pillarCfg = config.contentPillars[pillar]
            const pillarCTAs = config.ctaStrategies[pillarCfg?.ctaStrategy || "soft"]
            const ctaInstruction = pillarCfg?.ctaStrategy === "hard"
                ? `## 🎯 CONVERSION POST — CTA MUSÍ přímo odkázat na ${config.website}. Tento post má za úkol KONVERTOVAT.`
                : pillarCfg?.ctaStrategy === "medium"
                    ? `## 📚 VALUE POST — CTA může zmínit ${config.website}, ale hlavní focus je na hodnotu v postu.`
                    : pillarCfg?.ctaStrategy === "soft"
                        ? `## 🔥 REACH POST — CTA je čistě engagement (komentáře, sdílení, uložení). NEZMÍNEJ ${config.website}!`
                        : "## 🤝 CONNECT POST — Žádné CTA na web. Tento post buduje autenticitu."

            return `${ctaInstruction}
**Pilíř:** ${pillar.toUpperCase()} | **Cíl:** ${pillarCfg?.description || ""}
**Doporučené CTA:**
${(pillarCTAs || []).map((c: string) => `- ${c}`).join("\n")}`
        })()}

## ⚠️ NEOPAKUJ SE! Tyto hooky už byly použity:
${recentCaptions.map((c, i) => `${i + 1}. "${c}"`).join("\n")}

${getPostFormat(postType.name).medium === "reel" ? `
## 🎬 REELS VIDEO

Toto je Instagram Reel (krátké video, 7-10 sekund).

### STRUKTURA (POVINNÁ):
1. **Scene 1 (0-2s): HOOK** — Ukáž problém / provokativní otázku
2. **Scene 2 (2-7s): VALUE** — Ukáž řešení / produkt / tip
3. **Scene 3 (7-10s): CTA** — "Chceš víc? → ${config.website}"

### PRAVIDLA:
- Scene 3 MUSÍ končit s ${config.website} CTA!
- Popisuj konkrétní vizuály: úhly kamery, pohyby, prostředí
- Text overlays v češtině, ŽÁDNÉ emoji
- Styl: premium, moderní, ${config.feedAesthetic.feel}

## VÝSTUP — vrať POUZE validní JSON:
{
  "hook": "Opening problem/question (2-4 slova, punchy, česky). ŽÁDNÉ EMOJI.",
  "videoScript": "Scene-by-scene popis pro Veo 3.1.",
  "caption": "Instagram caption pro Reel (max 100 slov, česky).",
  "cta": "MUSÍ obsahovat ${config.website}",
  "hashtags": ["8-10", "relevantních", "hashtagů"]
}
` : getPostFormat(postType.name).medium === "carousel" ? `
## 📸 CAROUSEL POST (4 slidy) — JEDEN TIP, KROK ZA KROKEM

Toto je carousel post — 4 obrázky, které uživatel swipuje.
Celý carousel rozebírá JEDEN TIP / JEDNO TÉMA do hloubky, krok za krokem.
NEDÁVEJ 3 různé tipy — rozeber JEDEN postup tak, aby každý slide byl logický další krok.

### STRUKTURA (POVINNÁ):
1. **Slide 1 (COVER):** Bold hook headline — co uživatel získá, provokuje swipe
2. **Slide 2 (KROK 1):** První krok — kde začít, co udělat
3. **Slide 3 (KROK 2):** Další krok — navazuje, prohlubuje
4. **Slide 4 (KROK 3):** Poslední krok + výsledek + CTA na ${config.website}

### PRAVIDLA PRO CAROUSEL:
- Celý carousel = JEDEN ucelený návod/postup/průvodce
- Slidy na sebe MUSÍ logicky navazovat (krok 1 → 2 → 3)
- Uživatel po proswipování musí mít KOMPLETNÍ návod
- Kroky musí být REÁLNÉ a OVĚŘITELNÉ (přesná cesta v nastavení)
- Headlines: max 6 slov, jasné, bez emoji
- Subtext: konkrétní instrukce nebo vysvětlení
- Slide 4 MUSÍ končit s výsledkem + ${config.website} CTA

## VÝSTUP — vrať POUZE validní JSON:
{
  "hook": "Cover headline — co se naučí (max 8 slov, česky). ŽÁDNÉ EMOJI.",
  "slides": [
    {
      "headline": "Krok 1: [co udělat] (max 6 slov)",
      "subtext": "Nastavení → X → Y. Přesná instrukce co kde najít.",
      "imagePrompt": "English prompt for step 1 background. 1:1 square, premium, relevant to the brand."
    },
    {
      "headline": "Krok 2: [co udělat dál]",
      "subtext": "Navazující instrukce. Konkrétní detail.",
      "imagePrompt": "English prompt for step 2 background."
    },
    {
      "headline": "Krok 3: [výsledek]",
      "subtext": "Finální krok + Navštiv ${config.website}",
      "imagePrompt": "English prompt for final step background."
    }
  ],
  "body": "Hlavní caption (max 120 slov). Shrnutí celého postupu + proč to funguje.",
  "cta": "CTA směřující na ${config.website}",
  "hashtags": ["8-10", "hashtagů"],
  "imagePrompt": "English prompt for COVER slide background. Premium, eye-catching."
}
` : `
## 🎨 OBRÁZEK

### Layout (kromě meme):
- **POZADÍ:** Full-bleed relevantní fotografie (1:1 square)
- **OVERLAY:** Barevný gradient PŘES CELÝ OBRÁZEK (semi-transparentní, aby fotka prosvítala) — ${config.feedAesthetic.colorPalette}
- **TEXT DOLE:** Velký bílý tučný headline + menší subtext — umístěný ve SPODNÍ části obrázku
- **Font:** ${config.feedAesthetic.font}
- **Kvalita:** Vysoká, profesionální
- **Feel:** ${config.feedAesthetic.feel}

### Typ-specifické foto na pozadí:
${(() => {
            const instructions = config.imageInstructions || {}
            const typeInstr = instructions[postType.name] || instructions._default || "STANDARD: Pozadí: relevantní lifestyle fotka."
            return `**${postType.name.toUpperCase()}:**
${typeInstr}`
        })()
        }

## VÝSTUP — vrať POUZE validní JSON:
{
  "hook": "První věta co zastaví scrollování — drzá, šokující (max 15 slov). TOTO BUDE V OBRÁZKU! ŽÁDNÉ EMOJI v hooku.",
  "body": "Hlavní text (max 120 slov). ${config.contentFocus}",
  "cta": "CTA — ideálně směřuje na ${config.website}",
  "hashtags": ["8-10", "relevantních", "hashtagů"],
  "imagePrompt": "English prompt for Imagen 4 Ultra. Generate ONLY the background image, NO TEXT in the image at all! 'Instagram post, 1:1 square, high quality professional photography. Full-bleed background: [describe photorealistic scene relevant to the topic and brand]. ${config.contentFocus}. Clean, premium aesthetic, sharp focus, cinematic lighting.' For meme: describe a relatable meme scene.",
  "imageSubtext": "Podtext dole pod hookem (benefit, max 8 slov, česky)"
}
`}
`.trim()
}

/** Build FEED_AESTHETIC prompt from client config */
function buildFeedAesthetic(): string {
    const fa = CLIENT_CONFIG!.feedAesthetic
    return `
You are an expert Instagram visual designer. Your job is to create a DETAILED, 
HIGH QUALITY image prompt for Imagen 4 Ultra (Google's best image model).

## BRAND VISUAL IDENTITY (must be consistent across ALL posts):
- Color palette: ${fa.colorPalette}
- The overlay covers the ENTIRE image at ~${fa.overlayOpacity} opacity (photo clearly visible beneath)
- Text position: ${fa.textPosition} of image
- Font: ${fa.font}
- Overall feel: ${fa.feel}
- Aspect ratio: 1:1 square
${fa.customInstructions || ""}

## IMAGE QUALITY REQUIREMENTS:
- Photorealistic, professional photography quality
- Good lighting (natural or studio)
- Sharp focus, shallow depth of field where appropriate  
- Modern, aspirational lifestyle aesthetic
- 2K resolution output
${CLIENT_CONFIG!.characterDescription ? `
## BRAND CHARACTER (must appear in lifestyle/behind_scenes/customer_content posts):
${CLIENT_CONFIG!.characterDescription}
When the post is about the brand or lifestyle, include this character in the scene.
` : fa.phoneModel && fa.phoneModel !== "none" ? `
## PHONE CONSISTENCY:
- When showing a smartphone, ALWAYS depict a ${fa.phoneModel}
- Never use generic/unnamed phones or older models
` : ""}
`
}

async function refineImagePrompt(
    captionData: { imagePrompt: string; hook: string; imageSubtext?: string },
    postType: string,
    bodyContext?: string
): Promise<string> {
    // MEME EXCEPTION: Completely different prompt strategy
    if (postType === "meme") {
        const memePrompt = `
You are creating a MEME image for Instagram.

Raw idea: "${captionData.imagePrompt}"
Meme text (will be IN the image): "${captionData.hook}"

## YOUR TASK:
Create a funny, relatable meme-style image prompt. This should look like a REAL meme, not a branded post.

REQUIREMENTS:
- Include the text "${captionData.hook}" directly in the image (as meme text overlay)
- Use classic meme formats (reaction images, relatable situations, funny comparisons)
- Keep it simple and authentic — no gradients, no brand styling
- Make it funny and shareable
- Style: meme aesthetic (white Impact font on image, or classic meme template style)

OUTPUT: Single detailed English image generation prompt (2-3 sentences).
`
        const response = await ai.models.generateContent({
            model: "gemini-3.1-pro-preview",
            contents: memePrompt,
        })
        const refined = response.candidates?.[0]?.content?.parts?.[0]?.text
        return refined || captionData.imagePrompt
    }

    // STANDARD POST: Apply brand aesthetic
    const refinementPrompt = `
${buildFeedAesthetic()}

## YOUR TASK:
Take this raw image prompt and transform it into a DETAILED, professional image prompt.
The result must follow the brand visual identity above EXACTLY.

Raw prompt from content generator:
"${captionData.imagePrompt}"

HOOK TEXT (main headline in the image): "${captionData.hook}"
Subtext below hook: "${captionData.imageSubtext || ""}"
Post type: ${postType}
${bodyContext ? `Post body context (for thematic alignment): "${bodyContext}"` : ""}

## OUTPUT:
Return ONLY a single detailed English image generation prompt (NO JSON, just the prompt text).
DO NOT include any text rendering instructions — text is added programmatically after.
Be extremely specific about:
1. Background scene (what exactly is in the photo — relevant to the brand and post topic)
2. Lighting and mood (cinematic, natural, studio)
3. Camera angle and composition (close-up, overhead, 45 degrees, etc.)
4. Overall aesthetic quality (premium, clean, professional)

The prompt should be 2-3 sentences, descriptive and precise.
`

    const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",  // Best quality model for text generation
        contents: refinementPrompt,
    })

    const refined = response.candidates?.[0]?.content?.parts?.[0]?.text
    if (!refined) return captionData.imagePrompt // Fallback to raw prompt

    // Clean up — remove quotes, JSON artifacts
    return refined.replace(/^["']|["']$/g, "").trim()
}

// ============================================
// CAROUSEL PROMPT REFINEMENT — unified visual theme
// ============================================

async function refineCarouselPrompts(
    allSlides: { headline: string; subtext: string; imagePrompt: string }[],
    visualTheme: string,
    postType: string
): Promise<string[]> {
    const slideSummary = allSlides.map((s, i) =>
        `Slide ${i === 0 ? "COVER" : String(i)}: headline="${s.headline}", subtext="${s.subtext}", rawPrompt="${s.imagePrompt}"`
    ).join("\n")

    const refinementPrompt = `
${buildFeedAesthetic()}

## YOUR TASK:
You are refining image prompts for an Instagram CAROUSEL (${allSlides.length} slides).
All slides MUST feel like ONE cohesive series — same environment, same color temperature, same lighting.

Visual theme for entire carousel: "${visualTheme}"

## SLIDES:
${slideSummary}

## CRITICAL RULES FOR CAROUSEL COHESION:
1. ALL slides share the SAME environment/location (e.g. all on same desk, same room, same outdoor setting)
2. ALL slides share the SAME lighting (e.g. all warm studio light, all natural daylight)
3. ALL slides share the SAME color temperature and mood
4. ONLY the camera angle/framing changes between slides:
   - COVER: Wide establishing shot showing the full scene
   - Slide 1: Medium shot, slightly closer
   - Slide 2: Close-up detail shot
   - Slide 3: Wide shot with a sense of completion/result
5. If showing a key product or prop, it MUST be consistent across ALL slides
6. The progression should feel like a camera moving THROUGH the scene, not jumping between locations

## OUTPUT:
Return a JSON array of exactly ${allSlides.length} strings. Each string is a refined English image prompt for the corresponding slide.
Do NOT include any text rendering instructions — text is added programmatically.
Each prompt should be 2-3 sentences.
`

    try {
        const response = await ai.models.generateContent({
            model: "gemini-3.1-pro-preview",
            contents: refinementPrompt,
            config: { responseMimeType: "application/json" },
        })

        const text = response.candidates?.[0]?.content?.parts?.[0]?.text || ""
        const parsed = JSON.parse(text)

        if (Array.isArray(parsed) && parsed.length === allSlides.length) {
            console.log(`   ✓ Carousel prompts unified (${parsed.length} slides, shared theme)`)
            return parsed.map((p: string) => p.replace(/^["']|["']$/g, "").trim())
        }

        console.warn("   ⚠️ Carousel prompt array length mismatch — falling back to individual refinement")
    } catch (err) {
        console.warn("   ⚠️ Carousel batch refinement failed — falling back to individual refinement:", err)
    }

    // Fallback: refine individually (old behavior)
    const results: string[] = []
    for (const slide of allSlides) {
        const refined = await refineImagePrompt(
            { imagePrompt: slide.imagePrompt, hook: slide.headline, imageSubtext: slide.subtext },
            postType
        )
        results.push(refined)
    }
    return results
}

// ============================================
// VIDEO PROMPT REFINEMENT (Veo 3.1)
// ============================================

async function refineVideoPrompt(
    videoData: { hook: string; videoScript: string },
    postType: string,
    duration: number
): Promise<string> {
    const config = CLIENT_CONFIG!
    const refinementPrompt = `
You are a professional video director for Instagram Reels.
Transform this raw script into a DETAILED Veo 3.1 video generation prompt.

Raw script:
"${videoData.videoScript}"

Hook text: "${videoData.hook}"
Duration: ${duration} seconds
Post type: ${postType}

## REQUIREMENTS:
- 9:16 vertical format (Instagram Reels)
- 1080p resolution
- Modern, clean, premium aesthetic
- ${config.videoFocus || 'Professional content with smooth camera movements'}
- Smooth camera movements (dolly, slow zoom — no shaky footage)
- Professional lighting (natural or studio)
- MUST show real content relevant to the brand
- Final 2-3 seconds MUST show ${config.website} branding

## STRUCTURE:
Scene 1 (0-2s): Hook visual — show the PROBLEM or attention-grabbing moment
Scene 2 (2-${duration - 3}s): Solution — main content
Scene 3 (${duration - 3}-${duration}s): Result + CTA — clean screen, "${config.website}" text

## OUTPUT:
Return a single detailed English video generation prompt (2-4 sentences).
Be specific about camera angles, hand movements, UI elements, lighting.
Do NOT include dialogue or voiceover — only visual descriptions.
`

    const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: refinementPrompt,
    })

    const refined = response.candidates?.[0]?.content?.parts?.[0]?.text
    if (!refined) return videoData.videoScript
    return refined.replace(/^["']|["']$/g, "").trim()
}

// ============================================
// QUALITY GATE — auto-score before image gen
// ============================================

async function scorePost(
    captionData: {
        hook: string
        body?: string
        cta: string
        hashtags: string[]
        slides?: { headline: string; subtext: string }[]
    },
    postTypeName?: string
): Promise<{ score: number; feedback: string }> {
    const isCarousel = captionData.slides && captionData.slides.length > 0

    let slidesSection = ""
    let carouselCriteria = ""
    if (isCarousel && captionData.slides) {
        slidesSection = `\nSlides:\n${captionData.slides.map((s, i) => `  ${i + 1}. "${s.headline}" - ${s.subtext}`).join("\n")}`
        carouselCriteria = `
6. **Carousel flow (0-2 body):** Navazuji kroky logicky na sebe? Je to krok 1->2->3? Da uzivatel po proswipovani uceleny navod?
7. **Cover swipe-appeal (0-1 bod):** Primeje cover headline swipnout? Je dostatecne provokativni/hodnotny?`
    }

    const config = CLIENT_CONFIG!
    const scorePrompt = `
Jsi prisny Instagram content reviewer pro znacku ${config.name} (${config.website}).
IG handle: ${config.instagram}
Ohodno tento post na skale 1-10.

## POST${postTypeName ? ` (typ: ${postTypeName})` : ""}:
Hook: "${captionData.hook}"
Body: "${captionData.body || ""}"${slidesSection}
CTA: "${captionData.cta}"
Hashtags: ${captionData.hashtags.join(", ")}

## KRITERIA:
1. **Hook (0-3 body):** Zastavi scrollovani? Je drzy/sokujici/provokativni? Kratky (max 15 slov)? Bez emoji na zacatku?
2. **Relevance (0-2 body):** Odpovida brand voice znacky ${config.name}? Je obsah on-brand?
3. **Originalita (0-2 body):** Nepusobi genericky nebo jako AI-generated? Ma unikatni uhel pohledu? Pouziva prirozenou cestinu?
4. **CTA (0-1 bod):** Obsahuje ${config.website}? Je prirozeny a ne salesy?
5. **Celkovy dojem (0-2 body):** Zverejnil bys to na realny IG ucet? Pusobi to autenticky?${carouselCriteria}

## VYSTUP - vrat POUZE validni JSON:
{ "score": <cislo 1-10>, "feedback": "<1 veta co zlepsit, cesky>" }
`

    try {
        const raw = await ai.models.generateContent({
            model: "gemini-3.1-pro-preview",
            contents: scorePrompt,
            config: { responseMimeType: "application/json" },
        })
        const text = raw.candidates?.[0]?.content?.parts?.[0]?.text || ""
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        const result = JSON.parse(jsonMatch?.[0] || text)
        return {
            score: Math.min(10, Math.max(1, Number(result.score) || 5)),
            feedback: result.feedback || "Zadny feedback",
        }
    } catch {
        return { score: 7, feedback: "Scoring failed - passing through" }
    }
}

// ============================================
// SINGLE POST GENERATION
// ============================================

export async function generateOnePost(options: {
    configName?: string
    type?: string
    topic?: string
    dryRun?: boolean
    performance?: PerformanceInsight
}): Promise<{ id?: string; caption: string; imageUrl?: string; cost: number }> {
    await ensureConfig(options.configName)
    const startTime = Date.now()
    let cost = 0

    // 1. Select post type
    console.log("\n📋 Vybírám typ postu...")
    const postTypes = await getActivePostTypes(CLIENT_CONFIG!.postTypes)
    if (postTypes.length === 0) {
        throw new Error(`Žádné aktivní typy postů pro "${CLIENT_CONFIG!.id}". Zkontroluj konfiguraci a tabulku ig_post_types.`)
    }
    let selectedType: PostType

    if (options.type) {
        const found = postTypes.find(pt => pt.name === options.type)
        if (!found) throw new Error(`Post type "${options.type}" not found. Available: ${postTypes.map(t => t.name).join(", ")}`)
        selectedType = found
    } else {
        const weighted = postTypes.flatMap(type =>
            Array(type.frequency === "daily" ? 3 : type.frequency === "weekly" ? 2 : 1).fill(type)
        )
        selectedType = weighted[Math.floor(Math.random() * weighted.length)]
    }
    console.log(`   ✓ ${selectedType.emoji} ${selectedType.display_name}`)

    // 2. Get source material (90-day cooldown deduplikace)
    console.log("📚 Hledám zdroje (cooldown: 90 dní)...")
    let idea: PostIdea | null = null
    let review: Review | null = null

    if (selectedType.name === "recenze") {
        const reviews = await getApprovedReviews()
        if (reviews.length > 0) {
            review = reviews[Math.floor(Math.random() * reviews.length)]
            console.log(`   ✓ Recenze: "${review.quote.substring(0, 40)}..."`)
        }
    } else {
        // Load ideas for ALL post types (not just mobilnamiru types) — scoped by _activeProjectId
        const ideas = await getAvailableIdeas()
        if (ideas.length > 0) {
            // Pick from least used — available ideas respect cooldown
            idea = ideas[Math.floor(Math.random() * Math.min(ideas.length, 3))]
            console.log(`   ✓ Nápad: "${idea.title}" (${ideas.length} dostupných, cooldown ${IDEA_COOLDOWN_DAYS} dní)`)
        } else {
            console.log(`   ℹ️ Všechny nápady v cooldownu — Gemini vymyslí vlastní`)
        }
    }

    // 3. Get recent captions for dedup
    const recentPosts = await getRecentPosts(30)
    const recentHooks = recentPosts
        .map(p => p.caption?.split("\n")[0]?.substring(0, 80) || "")
        .filter(Boolean)

    // 4. Get performance data
    const performance = options.performance || await analyzePerformance()

    // 5. Generate caption / video script / carousel
    const format = getPostFormat(selectedType.name)
    const isReel = format.medium === "reel"
    const isCarousel = format.medium === "carousel"
    const postFormat = isReel ? "video script" : isCarousel ? "carousel" : "caption"
    console.log(`✍️  Generuji ${postFormat} (Gemini 3.1 Pro)...`)
    const megaPrompt = buildMegaPrompt(selectedType, idea, review, recentHooks, performance, options.topic)
    const schema = isReel ? buildVideoSchema() : isCarousel ? buildCarouselSchema() : buildCaptionSchema()
    const rawText = await generateText(megaPrompt, { responseSchema: schema })
    cost += COSTS.textGeneration

    let captionData: {
        hook: string
        body?: string
        cta: string
        hashtags: string[]
        imagePrompt?: string
        imageSubtext?: string
        videoScript?: string
        caption?: string
        slides?: { headline: string; subtext: string; imagePrompt: string }[]
        visualTheme?: string
    }

    try {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/)
        captionData = JSON.parse(jsonMatch?.[0] || rawText)
    } catch (e) {
        console.error("   ⚠️ JSON parse failed, raw:", rawText.substring(0, 200))
        throw new Error(`Caption generation failed: ${e}`)
    }

    // For reels: caption field replaces body
    if (isReel && captionData.caption) {
        captionData.body = captionData.caption
    }

    // 6. Dedup check — hook similarity + body keyword overlap
    const hookDuplicate = recentHooks.some(h => isHookSimilar(captionData.hook, h, 0.5))
    const recentBodies = recentPosts
        .map(p => p.caption?.split("\n").slice(1).join(" ") || "")
        .filter(b => b.length > 20)
    const bodyDuplicate = captionData.body ? isBodySimilar(captionData.body, recentBodies, 0.4) : false
    const isDuplicate = hookDuplicate || bodyDuplicate

    if (isDuplicate) {
        const reason = hookDuplicate ? "hook" : "téma/body"
        console.log(`   ⚠️ Duplicitní ${reason} detekován — regeneruji...`)
        const retryPrompt = megaPrompt + `\n\nDŮLEŽITÉ: Předchozí verze měla duplicitní ${reason}!\nOdmítnutý hook: "${captionData.hook}"\n${bodyDuplicate ? `Odmítnuté body: "${captionData.body?.substring(0, 100)}..."\n` : ""}Vymysli ÚPLNĚ jiný úhel pohledu, jiný hook, jiné argumenty.`
        const retryText = await generateText(retryPrompt, { responseSchema: schema })
        cost += COSTS.textGeneration
        try {
            const jsonMatch = retryText.match(/\{[\s\S]*\}/)
            captionData = JSON.parse(jsonMatch?.[0] || retryText)
            if (isReel && captionData.caption) captionData.body = captionData.caption
            console.log(`   ✓ Nový hook: "${captionData.hook.substring(0, 50)}..."`)
        } catch {
            console.log("   ⚠️ Regeneration parse failed — pokračuji s originálem")
        }
    }

    // 6b. Quality gate — auto-score before proceeding
    console.log("🔍 Quality gate (Gemini 3.1 Pro scoring)...")
    const { score, feedback } = await scorePost(
        captionData as { hook: string; body?: string; cta: string; hashtags: string[]; slides?: { headline: string; subtext: string }[] },
        selectedType.name
    )
    cost += COSTS.textGeneration
    const scoreEmoji = score >= 8 ? "🟢" : score >= 6 ? "🟡" : "🔴"
    console.log(`   ${scoreEmoji} Score: ${score}/10 — ${feedback}`)

    if (score < 7) {
        console.log("   ⚠️ Low quality — regeneruji s feedbackem...")
        const improvePrompt = megaPrompt + `\n\nDŮLEŽITÉ: Předchozí verze dostala ${score}/10. Feedback: "${feedback}". VYLEPŠI TO! Buď drsnější, originálnější, konkrétnější.`
        const improvedText = await generateText(improvePrompt, { responseSchema: schema })
        cost += COSTS.textGeneration
        try {
            const jsonMatch = improvedText.match(/\{[\s\S]*\}/)
            const improved = JSON.parse(jsonMatch?.[0] || improvedText)
            if (isReel && improved.caption) improved.body = improved.caption
            captionData = improved

            // Re-score
            const { score: newScore, feedback: newFeedback } = await scorePost(captionData as { hook: string; body?: string; cta: string; hashtags: string[] })
            cost += COSTS.textGeneration
            const newEmoji = newScore >= 8 ? "🟢" : newScore >= 6 ? "🟡" : "🔴"
            console.log(`   ${newEmoji} Re-score: ${newScore}/10 — ${newFeedback}`)
        } catch {
            console.log("   ⚠️ Regeneration failed — pokračuji s originálem")
        }
    }

    // Use client-specific hashtags
    let finalHashtags: string[]
    if (CLIENT_CONFIG?.hashtagPools) {
        const pools = CLIENT_CONFIG.hashtagPools
        const hashtags = new Set<string>()
        // Core branded tags
        pools.core.forEach(tag => hashtags.add(tag))
        // AI suggested tags
        captionData.hashtags?.slice(0, 4).forEach(tag => {
            const formatted = tag.startsWith("#") ? tag : `#${tag}`
            hashtags.add(formatted.toLowerCase())
        })
        // Fill with niche/broad
        const fillTags = [...(pools.niche || []), ...(pools.broad || [])].sort(() => Math.random() - 0.5)
        for (const tag of fillTags) {
            if (hashtags.size >= 10) break
            hashtags.add(tag)
        }
        // Trending
        if (hashtags.size < 10 && pools.trending?.length) {
            hashtags.add(pools.trending[Math.floor(Math.random() * pools.trending.length)])
        }
        finalHashtags = Array.from(hashtags).slice(0, 10)
    } else {
        // Fallback: just use AI suggestions
        finalHashtags = (captionData.hashtags || []).slice(0, 10).map(tag =>
            tag.startsWith("#") ? tag : `#${tag}`
        )
    }
    const fullCaption = `${captionData.hook}\n\n${captionData.body || ""}\n\n${captionData.cta}\n\n${finalHashtags.join(" ")}`
    console.log(`   ✓ Caption (${fullCaption.length} znaků)`)

    // 7. Generate media (VIDEO or IMAGE)
    let imageUrl: string | undefined

    if (!options.dryRun) {
        if (isReel && captionData.videoScript) {
            // ============================================
            // VIDEO GENERATION PATH (Veo 3.1)
            // ============================================
            const duration = getReelDuration(selectedType.name)

            // Step 1: Refine video prompt
            console.log("🧠 Vylepšuji video prompt (Veo 3.1 pipeline)...")
            const refinedVideoPrompt = await refineVideoPrompt(captionData as { hook: string; videoScript: string }, selectedType.name, duration)
            cost += COSTS.promptRefinement
            console.log(`   ✓ Video prompt refined`)

            // Step 2: Generate video with Veo 3.1 Fast
            console.log(`🎬 Generuji video (Veo 3.1 Fast, ${duration}s, 9:16)...`)
            try {
                const videoBuffer = await generateVideo(refinedVideoPrompt, {
                    duration,
                    aspectRatio: "9:16",
                    fast: true,
                })
                cost += COSTS.videoPerSecond * duration
                console.log(`   ✓ Video (${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB, ${duration}s)`)

                // Step 3: Upload to Supabase
                console.log("📤 Nahrávám video do Supabase...")
                const timestamp = Date.now()
                const filename = `ig-reels/${timestamp}.mp4`

                const { error: uploadError } = await supabaseAdmin.storage
                    .from("audit-screenshots")
                    .upload(filename, videoBuffer, {
                        contentType: "video/mp4",
                        cacheControl: "31536000",
                    })

                if (uploadError) {
                    console.error("   ⚠️ Upload failed:", uploadError.message)
                } else {
                    const { data: publicUrlData } = supabaseAdmin.storage
                        .from("audit-screenshots")
                        .getPublicUrl(filename)
                    imageUrl = publicUrlData.publicUrl
                    console.log(`   ✓ URL: ${imageUrl}`)
                }
            } catch (vidErr) {
                console.error("   ⚠️ Video generation failed:", vidErr)
            }
        } else if (isCarousel && captionData.slides) {
            // ============================================
            // CAROUSEL GENERATION PATH (4 images)
            // ============================================
            const slideCount = captionData.slides.length + 1 // slides + cover
            console.log(`📸 Generuji carousel (${slideCount} slidů)...`)

            const allSlides = [
                { headline: captionData.hook, subtext: captionData.imageSubtext || "", imagePrompt: captionData.imagePrompt || "" },
                ...captionData.slides,
            ]

            // Unified prompt refinement — all slides in one AI call for visual consistency
            console.log("🧠 Unified carousel prompt refinement...")
            const refinedPrompts = await refineCarouselPrompts(
                allSlides,
                captionData.visualTheme || "",
                selectedType.name
            )
            cost += COSTS.promptRefinement  // One batch call instead of N individual calls

            const uploadedUrls: string[] = []

            for (let i = 0; i < allSlides.length; i++) {
                const slide = allSlides[i]
                const label = i === 0 ? "COVER" : `Slide ${i}`
                console.log(`\n   📄 ${label}: "${slide.headline}"`)

                try {
                    // Use pre-refined prompt from batch
                    const refinedPrompt = refinedPrompts[i] || slide.imagePrompt

                    // Generate image with format-specific aspect ratio
                    const imageBuffer = await generateImage(refinedPrompt, { aspectRatio: format.aspectRatio as any })
                    cost += COSTS.imageGeneration
                    console.log(`   ✓ Obrázek ${i + 1} (${(imageBuffer.length / 1024).toFixed(0)} KB)`)

                    // Overlay text with slide-specific styling
                    // EXCEPTION: Skip overlay for meme posts
                    let finalImage: Buffer
                    if (format.overlayStyle === "none") {
                        console.log(`   🎭 ${selectedType.name} carousel — overlay: none (raw image)`)
                        finalImage = imageBuffer
                    } else {
                        finalImage = await overlayText(imageBuffer, {
                            headline: slide.headline,
                            subtext: slide.subtext,
                            slideInfo: { current: i + 1, total: allSlides.length },
                            variant: i === 0 ? "cover" : "step",
                            gradientColors: CLIENT_CONFIG!.overlayGradient,
                            logoFile: CLIENT_CONFIG!.logoFile,
                            fontFamily: CLIENT_CONFIG!.feedAesthetic?.fontOverride,
                        })
                        console.log(`   ✓ Text overlay ${i + 1}`)
                    }

                    // Upload
                    const timestamp = Date.now()
                    const filename = `ig-carousel/${timestamp}-slide${i}.png`

                    const { error: uploadError } = await supabaseAdmin.storage
                        .from("audit-screenshots")
                        .upload(filename, finalImage, {
                            contentType: "image/png",
                            cacheControl: "31536000",
                        })

                    if (uploadError) {
                        console.error(`   ⚠️ Upload slide ${i} failed:`, uploadError.message)
                    } else {
                        const { data: publicUrlData } = supabaseAdmin.storage
                            .from("audit-screenshots")
                            .getPublicUrl(filename)
                        uploadedUrls.push(publicUrlData.publicUrl)
                        console.log(`   ✓ Uploaded`)
                    }
                } catch (slideErr) {
                    console.error(`   ⚠️ Slide ${i} failed:`, slideErr)
                }
            }

            // Store all URLs pipe-separated
            if (uploadedUrls.length > 0) {
                imageUrl = uploadedUrls.join("|")
                console.log(`\n   ✓ Carousel: ${uploadedUrls.length}/${slideCount} slidů nahráno`)
            }
        } else {
            // ============================================
            // IMAGE GENERATION PATH
            // Uses Nano Banana (Gemini 3.1 Pro Image) when reference images exist,
            // otherwise falls back to Imagen 4 Ultra
            // ============================================

            // Step 1: Refine image prompt with feed cohesion context
            console.log("🧠 Vylepšuji image prompt (2-step pipeline)...")
            const bodySnippet = captionData.body ? captionData.body.substring(0, 150) : undefined
            let refinedPrompt = await refineImagePrompt(
                captionData as { imagePrompt: string; hook: string; imageSubtext?: string },
                selectedType.name,
                bodySnippet
            )
            cost += COSTS.promptRefinement
            console.log(`   ✓ Prompt refined`)

            // Step 2: Generate image
            try {
                let imageBuffer: Buffer

                // Load reference images — LOCAL FILES FIRST, then remote URLs
                const refImages: { buffer: Buffer; mimeType?: string; label?: string }[] = []

                // Strategy 1: Load local reference images from reference-images/{configId}/
                // These are curated, high-quality photos (best for face consistency)
                try {
                    const { readdir, readFile } = await import("fs/promises")
                    const { join, dirname } = await import("path")
                    const { fileURLToPath } = await import("url")
                    const baseDir = dirname(fileURLToPath(import.meta.url))
                    const refDir = join(baseDir, "reference-images", CLIENT_CONFIG!.id)

                    const files = await readdir(refDir).catch(() => [] as string[])
                    const imageFiles = files
                        .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
                        .sort()

                    for (const file of imageFiles) {
                        const imgBuffer = await readFile(join(refDir, file))
                        const mimeType = file.endsWith(".png") ? "image/png" : "image/jpeg"
                        refImages.push({
                            buffer: imgBuffer,
                            mimeType,
                            label: "brand character reference — preserve this person's EXACT face and likeness",
                        })
                        console.log(`   📸 Loaded local ref: ${file}`)
                    }
                } catch {
                    // Local files not available (e.g. Vercel) — continue to remote
                }

                // Strategy 2: Also load remote reference images from config URLs
                if (CLIENT_CONFIG!.characterReferenceImages?.length) {
                    for (const refUrl of CLIENT_CONFIG!.characterReferenceImages) {
                        try {
                            const resp = await fetch(refUrl)
                            if (resp.ok) {
                                const arrayBuf = await resp.arrayBuffer()
                                refImages.push({
                                    buffer: Buffer.from(arrayBuf),
                                    mimeType: refUrl.endsWith(".png") ? "image/png" : "image/jpeg",
                                    label: "brand character reference — preserve this person's EXACT face and likeness",
                                })
                                console.log(`   📸 Loaded remote ref: ${refUrl.split("/").pop()?.substring(0, 40)}`)
                            } else {
                                console.warn(`   ⚠️ Ref image fetch failed (${resp.status}): ${refUrl.substring(0, 60)}`)
                            }
                        } catch (err) {
                            console.warn(`   ⚠️ Ref image error: ${(err as Error).message?.substring(0, 60)}`)
                        }
                    }
                }

                // For product posts, load REAL product photos (scraped from eshop)
                // These must be faithfully reproduced — NOT used as "inspiration"
                const productTypes = ["product_drop", "limitka", "outfit_inspo", "produkt", "recenze"]
                if (productTypes.includes(selectedType.name) && CLIENT_CONFIG!.products?.length) {
                    const products = CLIENT_CONFIG!.products
                    const randomProduct = products[Math.floor(Math.random() * products.length)]

                    // Strategy 1: Load from local scraped images (product-images/{configId}/)
                    let productImageLoaded = false
                    if (randomProduct.slug) {
                        try {
                            const { readdir, readFile } = await import("fs/promises")
                            const { join, dirname } = await import("path")
                            const { fileURLToPath } = await import("url")
                            const baseDir = dirname(fileURLToPath(import.meta.url))
                            const productDir = join(baseDir, "product-images", CLIENT_CONFIG!.id)

                            // Find all images for this product slug (e.g. triko-mrdke-gang-black-white-1.jpg, -2.jpg, etc.)
                            const files = await readdir(productDir).catch(() => [] as string[])
                            const productFiles = files
                                .filter(f => f.startsWith(randomProduct.slug) && /\.(jpg|jpeg|png|webp)$/i.test(f))
                                .sort()

                            if (productFiles.length > 0) {
                                // Load the main image (first one) as reference
                                const mainFile = productFiles[0]
                                const imgBuffer = await readFile(join(productDir, mainFile))
                                const mimeType = mainFile.endsWith(".png") ? "image/png" : "image/jpeg"
                                refImages.push({
                                    buffer: imgBuffer,
                                    mimeType,
                                    label: `EXACT product photo: ${randomProduct.name}`,
                                })
                                productImageLoaded = true
                                console.log(`   🛍️ Loaded local product image: ${mainFile}`)
                            }
                        } catch (err) {
                            // Local files not available (e.g. running on Vercel) — will try remote
                        }
                    }

                    // Strategy 2: Fallback to live og:image scraping
                    if (!productImageLoaded && randomProduct.slug && CLIENT_CONFIG!.website) {
                        try {
                            const productUrl = `${CLIENT_CONFIG!.website}/p/${randomProduct.slug}`
                            const pageResp = await fetch(productUrl)
                            if (pageResp.ok) {
                                const html = await pageResp.text()
                                const ogMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)
                                if (ogMatch?.[1]) {
                                    const imgResp = await fetch(ogMatch[1])
                                    if (imgResp.ok) {
                                        const arrayBuf = await imgResp.arrayBuffer()
                                        refImages.push({
                                            buffer: Buffer.from(arrayBuf),
                                            mimeType: "image/jpeg",
                                            label: `EXACT product photo: ${randomProduct.name}`,
                                        })
                                        productImageLoaded = true
                                        console.log(`   🛍️ Loaded remote product image: ${randomProduct.name}`)
                                    }
                                }
                            }
                        } catch (err) {
                            console.warn(`   ⚠️ Product ref error: ${(err as Error).message?.substring(0, 60)}`)
                        }
                    }

                    // If we loaded a product image, prepend explicit instruction to the prompt
                    if (productImageLoaded) {
                        refinedPrompt = `CRITICAL INSTRUCTION: One of the attached reference images shows the EXACT product "${randomProduct.name}". You MUST reproduce this product's design FAITHFULLY — same colors, same logo placement, same print/pattern. Do NOT invent new designs, patterns, or text on the clothing. The product must look IDENTICAL to the reference photo. Show this exact product in the scene described below.\n\n${refinedPrompt}`
                        console.log(`   📌 Product constraint: "${randomProduct.name}" — exact design enforced`)
                    }
                }

                if (refImages.length > 0) {
                    // Use Nano Banana (Gemini 3.1 Pro Image) with reference images
                    console.log(`🎨 Generuji obrázek (Nano Banana + ${refImages.length} ref images, 2K)...`)
                    imageBuffer = await generateImageWithReferences(
                        refinedPrompt,
                        refImages,
                        { aspectRatio: format.aspectRatio, resolution: "2K" }
                    )
                } else {
                    // Fallback: Imagen 4 Ultra (no references)
                    console.log("🎨 Generuji obrázek (Imagen 4 Ultra, 2K)...")
                    imageBuffer = await generateImage(refinedPrompt, { aspectRatio: format.aspectRatio as any })
                }
                cost += COSTS.imageGeneration
                console.log(`   ✓ Obrázek (${(imageBuffer.length / 1024).toFixed(0)} KB, 2K resolution)`)

                // Step 3: Overlay text programmatically (pixel-perfect Czech)
                // EXCEPTION: Skip overlay for meme posts — they should be raw
                let finalImage: Buffer
                if (format.overlayStyle === "none") {
                    console.log(`🎭 ${selectedType.name} — overlay: none (raw image)`)
                    finalImage = imageBuffer
                } else {
                    console.log("✏️  Přidávám text (programaticky — bez chyb)...")
                    finalImage = await overlayText(imageBuffer, {
                        headline: captionData.hook,
                        subtext: captionData.imageSubtext,
                        gradientColors: CLIENT_CONFIG!.overlayGradient,
                        logoFile: CLIENT_CONFIG!.logoFile,
                        fontFamily: CLIENT_CONFIG!.feedAesthetic?.fontOverride,
                    })
                    console.log(`   ✓ Text overlay (${(finalImage.length / 1024).toFixed(0)} KB)`)
                }

                console.log("📤 Nahrávám do Supabase...")
                const timestamp = Date.now()
                const filename = `ig-posts/${timestamp}.png`
                const bucketName = CLIENT_CONFIG!.storageBucket || "audit-screenshots"

                const { error: uploadError } = await supabaseAdmin.storage
                    .from(bucketName)
                    .upload(filename, finalImage, {
                        contentType: "image/png",
                        cacheControl: "31536000",
                    })

                if (uploadError) {
                    console.error("   ⚠️ Upload failed:", uploadError.message)
                } else {
                    const { data: publicUrlData } = supabaseAdmin.storage
                        .from(bucketName)
                        .getPublicUrl(filename)
                    imageUrl = publicUrlData.publicUrl
                    console.log(`   ✓ URL: ${imageUrl}`)
                }
            } catch (imgErr) {
                console.error("   ⚠️ Image failed:", imgErr)
            }
        }
    } else {
        console.log(`🎨 [DRY-RUN] Přeskakuji ${isReel ? "video" : isCarousel ? "carousel" : "obrázek"}`)
    }

    // 8. Save to database
    let postId: string | undefined

    if (!options.dryRun) {
        console.log("💾 Ukládám...")
        const post = await createPost({
            post_type_id: selectedType.id,
            idea_id: idea?.id,
            review_id: review?.id,
            caption: fullCaption,
            hashtags: finalHashtags,
            call_to_action: captionData.cta,
            image_prompt: captionData.imagePrompt,
            image_url: imageUrl,
            image_style: "gemini-pro",
            status: "draft",
        })

        postId = post.id
        if (idea) await markIdeaAsUsed(idea.id)
        if (review) await markReviewAsUsed(review.id)

        await logGeneration({
            postId: post.id,
            promptUsed: megaPrompt.substring(0, 500),
            modelUsed: "gemini-3.1-pro-preview + imagen-4.0-ultra",
            generationTimeMs: Date.now() - startTime,
        })

        console.log(`   ✓ ID: ${post.id}`)
    }

    // 9. Summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

    console.log("\n" + "═".repeat(60))
    console.log("📱 POST")
    console.log("═".repeat(60))
    console.log(`\n${fullCaption}`)
    console.log("\n" + "─".repeat(60))
    console.log(`🎨 ${imageUrl || "Bez obrázku"}`)
    console.log(`⏱️  ${elapsed}s | 💰 ~$${cost.toFixed(3)}`)
    console.log("═".repeat(60) + "\n")

    return { id: postId, caption: fullCaption, imageUrl, cost }
}

// ============================================
// BUDGET-CONTROLLED BATCH
// ============================================

export async function generateBatch(options: {
    configName?: string
    count: number
    dryRun: boolean
    topic?: string
}) {
    await ensureConfig(options.configName)
    const { count, dryRun } = options
    const estimatedCost = count * COSTS.perPost

    console.log("\n" + "═".repeat(60))
    console.log("📅 AUTOPILOT — BATCH GENEROVÁNÍ")
    console.log("═".repeat(60))
    console.log(`   📊 Postů: ${count}`)
    console.log(`   💰 Odhadovaná cena: ~$${estimatedCost.toFixed(2)} (${(estimatedCost * 24).toFixed(0)} Kč)`)
    console.log(`   ${dryRun ? "🔍 MODE: DRY-RUN" : "🚀 MODE: PRODUKCE"}`)
    console.log("═".repeat(60))

    // Get performance data once for all posts
    console.log("\n📊 Analyzuji výkon minulých postů...")
    const performance = await analyzePerformance()
    if (performance.topPatterns.length > 0) {
        console.log(`   ✓ Naučené vzorce: ${performance.topPatterns.join(", ")}`)
    } else {
        console.log("   ℹ️ Zatím žádná data o výkonu — generuji bez feedbacku")
    }

    const results: Array<{ type: string; success: boolean; id?: string; cost: number }> = []
    let totalCost = 0
    const typesToUse = buildSmartWeekPlan(performance, options.count)

    for (let i = 0; i < typesToUse.length; i++) {
        const type = typesToUse[i]

        console.log(`\n${"─".repeat(60)}`)
        console.log(`📌 [${i + 1}/${typesToUse.length}] ${type}`)
        console.log("─".repeat(60))

        try {
            const result = await generateOnePost({ configName: options.configName, type, dryRun, performance })
            totalCost += result.cost
            results.push({ type, success: true, id: result.id, cost: result.cost })

            if (i < typesToUse.length - 1) {
                console.log("⏳ Pauza 15s (API rate limiting)...")
                await new Promise(resolve => setTimeout(resolve, 15000))
            }
        } catch (error) {
            console.error(`❌ ${type}: ${error}`)
            results.push({ type, success: false, cost: 0 })
        }
    }

    // Final summary
    const successCount = results.filter(r => r.success).length
    console.log("\n" + "═".repeat(60))
    console.log("📊 SOUHRN")
    console.log("═".repeat(60))
    results.forEach((r) => {
        console.log(`   ${r.success ? "✅" : "❌"} ${r.type.padEnd(15)} $${r.cost.toFixed(3)} ${r.id ? `(${r.id.substring(0, 8)}...)` : ""}`)
    })
    console.log("─".repeat(60))
    console.log(`   ✅ ${successCount}/${results.length} postů`)
    console.log(`   💰 Celkem: $${totalCost.toFixed(3)} (${(totalCost * 24).toFixed(0)} Kč)`)
    console.log("═".repeat(60) + "\n")
}

// ============================================
// FEEDBACK COMMAND — Record post performance
// ============================================

async function recordFeedback() {
    console.log("\n" + "═".repeat(60))
    console.log("📊 FEEDBACK — Zaznamenat výkon postů")
    console.log("═".repeat(60))

    // Get all posted posts without metrics
    const { data: posts } = await supabase
        .from("ig_posts")
        .select("*")
        .eq("status", "posted")
        .eq("client_id", getActiveProject())
        .is("likes", null)
        .order("posted_at", { ascending: false })
        .limit(10)

    if (!posts || posts.length === 0) {
        console.log("\n   ℹ️ Žádné posty bez metrik.")
        console.log("   Tip: Změň status postu na 'posted' a pak spusť --feedback znovu.")
        console.log("═".repeat(60) + "\n")
        return
    }

    console.log(`\n   Nalezeno ${posts.length} postů bez metrik.`)
    console.log("   Pro záznam metrik aktualizuj v Supabase dashboardu:")
    console.log("   Tabulka: ig_posts → sloupce: likes, comments, saves\n")

    for (const post of posts) {
        const hook = post.caption?.split("\n")[0] || "Unknown"
        console.log(`   📱 ${post.id.substring(0, 8)}... | "${hook.substring(0, 50)}..."`)
        console.log(`      Datum: ${post.posted_at || post.created_at}`)
        console.log(`      Lajky: ${post.likes ?? "❓"} | Komentáře: ${post.comments ?? "❓"} | Uložení: ${post.saves ?? "❓"}`)
        console.log("")
    }

    console.log("═".repeat(60) + "\n")
}

// ============================================
// STATS COMMAND — Show performance insights
// ============================================

async function showStats() {
    console.log("\n" + "═".repeat(60))
    console.log("📈 STATISTIKY — Co funguje?")
    console.log("═".repeat(60))

    const { data: allPosts } = await supabase
        .from("ig_posts")
        .select("*")
        .eq("client_id", getActiveProject())
        .order("created_at", { ascending: false })

    const posts = allPosts || []
    const posted = posts.filter(p => p.status === "posted")
    const withMetrics = posted.filter(p => p.likes !== null)

    console.log(`\n   📊 Celkem postů: ${posts.length}`)
    console.log(`   📤 Publikováno: ${posted.length}`)
    console.log(`   📏 S metrikami: ${withMetrics.length}`)
    console.log(`   📝 Drafty: ${posts.filter(p => p.status === "draft").length}`)

    // Always fetch performance (handles empty data gracefully)
    const performance = await analyzePerformance()

    if (withMetrics.length > 0) {
        console.log("\n" + "─".repeat(60))
        console.log("🏆 TOP VZORCE (co systém učí)")
        console.log("─".repeat(60))

        if (performance.topPatterns.length > 0) {
            performance.topPatterns.forEach(p => console.log(`   ✓ ${p}`))
        } else {
            console.log("   Zatím žádné detekované vzorce")
        }

        if (performance.bestHooks.length > 0) {
            console.log("\n   🎯 Nejlepší hooky:")
            performance.bestHooks.forEach(h => console.log(`     "${h}"`))
        }

        console.log(`\n   📊 Průměrný engagement: ${performance.avgEngagement.toFixed(0)} bodů`)
        console.log(`   ⏰ Nejlepší časy: ${performance.bestTimeSlots.join(", ") || "N/A"}`)
    } else {
        console.log("\n   ℹ️ Potřebuji metriky pro analýzu!")
        console.log("   1. Postni drafty na Instagram")
        console.log("   2. Zapiš likes/comments/saves do Supabase")
        console.log("   3. Spusť `--stats` znovu")
    }

    // Dedup stats
    const usedIdeaIds = await getUsedIdeaIds()
    const allIdeas = await getAvailableIdeas()
    const freshIdeas = allIdeas.filter(i => !usedIdeaIds.has(i.id))

    console.log("\n" + "─".repeat(60))
    console.log("🗂️  BANKA NÁPADŮ")
    console.log("─".repeat(60))
    console.log(`   Celkem: ${allIdeas.length + usedIdeaIds.size}`)
    console.log(`   Použité: ${usedIdeaIds.size}`)
    console.log(`   Zbývá čerstvých: ${freshIdeas.length}`)

    if (freshIdeas.length < 5) {
        console.log("   ⚠️ Dochází nápady! Spusť --generate-ideas pro auto-refill.")
    }

    // Pillar breakdown
    if (withMetrics.length > 0 && performance.pillarPerformance) {
        const pp = performance.pillarPerformance
        console.log("\n" + "─".repeat(60))
        console.log("📊 VÝKON PODLE PILÍŘE")
        console.log("─".repeat(60))
        for (const [key, perf] of Object.entries(pp)) {
            const pillarCfg = CLIENT_CONFIG!.contentPillars[key]
            const emoji = pillarCfg?.emoji || "📌"
            const label = (pillarCfg?.label || key).toUpperCase().padEnd(8)
            console.log(`   ${emoji} ${label} avg ${perf.avgScore.toFixed(0)} bodů ${perf.topPatterns.length > 0 ? `(${perf.topPatterns.join(", ")})` : ""}`)
        }
        if (performance.conversionRate > 0) {
            console.log(`\n   📈 Conversion rate: ${(performance.conversionRate * 100).toFixed(2)}%`)
        }
    }

    // Cost estimate
    const weekCount = CLIENT_CONFIG!.weekPlan.length
    console.log("\n" + "─".repeat(60))
    console.log("💰 BUDGET")
    console.log("─".repeat(60))
    console.log(`   Cena za post: ~$${COSTS.perPost.toFixed(3)} (${(COSTS.perPost * 24).toFixed(0)} Kč)`)
    console.log(`   Týden (${weekCount} postů): ~$${(COSTS.perPost * weekCount).toFixed(2)} (${(COSTS.perPost * weekCount * 24).toFixed(0)} Kč)`)
    console.log(`   Měsíc (${weekCount * 4} postů): ~$${(COSTS.perPost * weekCount * 4).toFixed(2)} (${(COSTS.perPost * weekCount * 4 * 24).toFixed(0)} Kč)`)

    console.log("\n" + "═".repeat(60) + "\n")
}

// ============================================
// AUTO-IDEA GENERATION — AI-powered idea factory
// ============================================

function buildIdeasSchema(): object {
    const config = CLIENT_CONFIG!
    // Build categories from config contentPillars
    const categories = Object.keys(config.contentPillars).join(", ")

    return {
        type: "object",
        properties: {
            ideas: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        title: { type: "string", description: "Short title (3-6 words, Czech)" },
                        content: { type: "string", description: "Detailed description of the idea (2-3 sentences, Czech)" },
                        category: { type: "string", description: `Category: ${categories}` },
                        subcategory: { type: "string", description: "Sub-topic or platform, e.g. 'general'" },
                        keywords: { type: "array", items: { type: "string" }, description: "3-5 relevant keywords" },
                    },
                    required: ["title", "content", "category", "subcategory", "keywords"],
                },
            },
        },
        required: ["ideas"],
    }
}

async function generateIdeas(
    pillar: string,
    count: number,
    performance: PerformanceInsight,
    existingIdeas: PostIdea[]
): Promise<any[]> {
    const existingTitles = existingIdeas.map(i => i.title).join(", ")
    const config = CLIENT_CONFIG!
    const bv = config.brandVoice
    const pillarInfo = config.contentPillars[pillar]

    // Build client-specific prompt
    const prompt = `Jsi expert na Instagram content strategii pro brand "${config.name}".
Web: ${config.website} | IG: ${config.instagram}

## BRAND PERSONA
${bv.persona}

## BRAND VOICE
${bv.voiceTraits.map(t => `- ${t}`).join("\n")}

## ZAKÁZÁNO
${bv.antiPatterns.map(p => p).join("\n")}

${config.products ? `## PRODUKTY
${config.products.map(p => `- ${p.name} (${p.type}): ${p.description || p.price || ""}`).join("\n")}
` : ""}

## PILÍŘ: ${pillarInfo?.label || pillar.toUpperCase()}
${pillarInfo?.description || ""}
Typy postů: ${pillarInfo?.postTypes.join(", ") || "meme, product_drop"}

## PRAVIDLA:
1. Všechny nápady MUSÍ odpovídat brand voice a tématu značky "${config.name}"
2. Piš česky, moderní hovorovou češtinou
3. Každý nápad musí být originální a relevantní pro cílovou skupinu
4. NEDUPLIKUJ tyto existující nápady: ${existingTitles || "žádné"}
5. CTA musí směřovat na ${config.website}

Generuj PŘESNĚ ${count} nápadů.
Každý nápad musí mít: title (krátký název), content (text nápadu/caption), category, keywords.`

    try {
        const result = await generateText(prompt, {
            responseSchema: buildIdeasSchema(),
            temperature: 0.9,
        })

        const parsed = JSON.parse(result)
        const ideas: any[] = parsed.ideas.map((idea: any) => ({
            title: idea.title,
            content: idea.content,
            category: idea.category || pillar,
            subcategory: idea.subcategory || "general",
            keywords: idea.keywords || [],
            cooldown_days: 60,
            is_active: true,
        }))

        return ideas
    } catch (err) {
        console.error("❌ AI idea generation failed:", err)
        return []
    }
}

/** CLI handler for --generate-ideas */
async function runGenerateIdeas() {
    const args = process.argv.slice(2)
    const countArg = args.find(a => a.startsWith("--count="))
    const count = countArg ? parseInt(countArg.split("=")[1]) : 15
    const pillarArg = args.find(a => a.startsWith("--pillar="))
    const pillar = pillarArg?.split("=")[1] || "all"

    const config = CLIENT_CONFIG!

    console.log("\n" + "═".repeat(60))
    console.log(`🧠 AUTO-GENERACE NÁPADŮ — ${config.name}`)
    console.log("═".repeat(60))

    const performance = await analyzePerformance()
    const existingIdeas = await getAvailableIdeas()

    console.log(`   📊 Existujících nápadů: ${existingIdeas.length}`)
    console.log(`   🎯 Generuji: ${count} per pillar`)
    console.log("")

    // Use pillars from client config
    const clientPillars = Object.keys(config.contentPillars)
    const pillarsToGenerate: string[] = pillar === "all"
        ? clientPillars
        : [pillar]

    let totalGenerated = 0

    for (const p of pillarsToGenerate) {
        const pillarConfig = config.contentPillars[p]
        const emoji = pillarConfig?.emoji || "📌"
        console.log(`\n${emoji} Generuji ${(pillarConfig?.label || p).toUpperCase()} nápady (${count})...`)

        const ideas = await generateIdeas(p, count, performance, existingIdeas)

        if (ideas.length > 0) {
            const inserted = await batchInsertIdeas(ideas)
            totalGenerated += inserted
            console.log(`   ✓ Vloženo ${inserted} nápadů`)
            ideas.forEach(i => console.log(`     - ${i.title}: ${(i.content as string).substring(0, 60)}...`))
        } else {
            console.log(`   ⚠️ Žádné nápady vygenerovány`)
        }

        // Rate limit between pillars
        if (pillarsToGenerate.indexOf(p) < pillarsToGenerate.length - 1) {
            console.log("   ⏳ Pauza 5s...")
            await new Promise(r => setTimeout(r, 5000))
        }
    }

    console.log(`\n${"═".repeat(60)}`)
    console.log(`✅ Celkem vygenerováno: ${totalGenerated} nápadů`)
    console.log(`${"═".repeat(60)}\n`)
}

// ============================================
// CLI
// ============================================

async function main() {
    const args = process.argv.slice(2)

    // Parse --config flag first
    const configArg = args.find(a => a.startsWith("--config="))
    const configName = configArg?.split("=")[1] || "mobilnamiru"
    CLIENT_CONFIG = await loadConfig(configName)
    const { resolveClientId } = await import("./configs")
    const clientUuid = await resolveClientId(configName)
    setActiveProject(clientUuid)

    console.log(`🏢 Klient: ${CLIENT_CONFIG.name} (${CLIENT_CONFIG.id})`)
    console.log(`🌐 Web: ${CLIENT_CONFIG.website}`)
    console.log("")

    if (args.includes("--help") || args.includes("-h")) {
        console.log(`
📱 Instagram Autopilot — Multi-Client Content Engine

Klient: ${CLIENT_CONFIG.name} (${CLIENT_CONFIG.id})

Generování:
  npx tsx instagram/autopilot.ts --config=${configName}                    1 náhodný post
  npx tsx instagram/autopilot.ts --config=${configName} --week             Smart week plan
  npx tsx instagram/autopilot.ts --config=${configName} --count=5          Konkrétní počet
  npx tsx instagram/autopilot.ts --config=${configName} --type=meme        Konkrétní typ
  npx tsx instagram/autopilot.ts --config=${configName} --dry-run          Jen náhled

Growth Engine:
  npx tsx instagram/autopilot.ts --config=${configName} --generate-ideas   Auto-generace nápadů
  npx tsx instagram/autopilot.ts --config=${configName} --generate-ideas --pillar=reach --count=20
  npx tsx instagram/autopilot.ts --config=${configName} --feedback         Zaznamenat výkon
  npx tsx instagram/autopilot.ts --config=${configName} --stats            Statistiky

Product & Design:
  npx tsx instagram/autopilot.ts --config=${configName} --product-idea             Nápady na produkty
  npx tsx instagram/autopilot.ts --config=${configName} --product-idea --count=5 --theme="summer"
  npx tsx instagram/autopilot.ts --config=${configName} --design --theme="neon"     Design koncept + obrázek
  npx tsx instagram/autopilot.ts --config=${configName} --design --product=triko --theme="summer vibes"

Dostupné konfigurace: mobilnamiru, hanzfans
(bez --config se použije mobilnamiru)
`)
        return
    }

    // Special commands
    if (args.includes("--feedback")) return recordFeedback()
    if (args.includes("--stats")) return showStats()
    if (args.includes("--generate-ideas")) return runGenerateIdeas()
    if (args.includes("--product-idea")) return runProductIdeas(CLIENT_CONFIG!)
    if (args.includes("--design")) return runDesignConcept(CLIENT_CONFIG!)

    // Parse options
    const dryRun = args.includes("--dry-run")
    const isWeek = args.includes("--week")
    const typeArg = args.find(a => a.startsWith("--type="))
    const type = typeArg?.split("=")[1]
    const countArg = args.find(a => a.startsWith("--count="))
    const count = countArg ? parseInt(countArg.split("=")[1]) : undefined

    if (isWeek || count) {
        await generateBatch({
            count: count || CLIENT_CONFIG!.weekPlan.length,
            dryRun,
        })
    } else {
        await generateOnePost({ type, dryRun })
    }
}

// Only run main() when executed directly from CLI (npx tsx autopilot.ts)
// NOT when imported as a module by server actions
const isDirectExecution = process.argv[1]?.includes("autopilot")

if (isDirectExecution) {
    main().catch(err => {
        console.error("💥 Autopilot selhal:", err)
        process.exit(1)
    })
}
