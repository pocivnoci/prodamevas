/**
 * Instagram Autopilot — Orchestrator (thin wrapper)
 * =================================================
 *
 * Orchestrates single post and batch generation.
 * Media rendering delegated to orchestrators/ (reel, carousel, image).
 * CLI commands moved to cli.ts.
 *
 * Business logic split into:
 *   📊 performance.ts  — analyzePerformance, PerformanceInsight
 *   🚫 service.ts       — isHookSimilar, isBodySimilar (dedup)
 *   ✍️ caption-generator.ts — schemas, mega prompt, quality gate, helpers
 *   🎨 orchestrators/   — renderReel, renderCarousel, renderImage
 */

import supabaseAdmin from "../supabase/admin"
import { generateTextQuality } from "./gemini-client"
import { getModel, hasFallback, getTemperature } from "./models"
import {
    getActivePostTypes,
    getRecentPosts,
    createPost,
    markIdeaAsUsed,
    markReviewAsUsed,
    logGeneration,
    scoreConsistencyAndEmbed,
    setActiveProject,
    getActiveProject,
    withActiveProject,
    ensurePostTypes,
    getWeightedIdeas,
    getWeightedReviews,
    getIdeaById,
    countFeedPosts,
    toSelectedProduct,
} from "./service"
import { computeSlotIntent, type SlotIntent } from "../lib/feed-pattern"
import { loadConfig } from "./configs"
import type { ClientConfig, PostFormat, PostMedium } from "./configs/types"
import type { PostType, PostIdea, Review } from "./types"

// Module imports (refactored from monolith)
import { isHookSimilar, isBodySimilar, createPillarMapper } from "./service"
import { analyzePerformance, type PerformanceInsight } from "./performance"
import {
    COSTS,
    getPostFormat,
    selectOverlayVariant,

    buildCaptionSchema,
    buildVideoSchema,
    buildCarouselSchema,
    buildSmartWeekPlan,
    buildMegaPrompt,
    scorePost,
    rankDrafts,
    resolveCtaPolicyForPost,
} from "./caption-generator"
import { getBrandMemories, formatMemoriesForPrompt, learnFromCriticInsights } from "./memory-agent"
import { reviewPost, reviewContentPlan } from "./editorial-board"
import type { EditorialMessage } from "./types"

// Media orchestrators (extracted for maintainability)
import { renderReel } from "./orchestrators/reel-orchestrator"
import { renderCarousel } from "./orchestrators/carousel-orchestrator"
import { renderImage } from "./orchestrators/image-orchestrator"
import type { CaptionData, SelectedProduct, RenderResult } from "./orchestrators/types"

// Active client config (set from --config flag or ensureConfig)
let CLIENT_CONFIG: ClientConfig | null = null

/**
 * Smart config loader — ensures CLIENT_CONFIG is set before generation.
 * Called automatically by generateOnePost/generateBatch when invoked from server actions.
 * No-op if config is already loaded for the same client.
 */
async function ensureConfig(configName?: string): Promise<string> {
    if (!configName) {
        throw new Error("ensureConfig: chybí configName — tenant musí být vždy explicitní")
    }
    const name = configName

    // Resolve slug → uuid DETERMINISTICALLY (cached), never via the ambient
    // AsyncLocalStorage store. ensureConfig runs BEFORE generateOnePost enters its
    // withActiveProject scope, so the store isn't set here — and when CLIENT_CONFIG is
    // already cached (2nd+ post of a worker run), the old `return getActiveProject()`
    // threw "No active client set", killing every post after the first in a campaign.
    const { resolveClientId } = await import("./configs")
    const clientUuid = await resolveClientId(name)

    if (CLIENT_CONFIG && CLIENT_CONFIG.id === name) {
        return clientUuid // config already loaded for this tenant
    }
    CLIENT_CONFIG = await loadConfig(name)

    setActiveProject(clientUuid) // fallback for legacy code paths
    console.log(`🏢 Config loaded: ${CLIENT_CONFIG.name} (${name} → ${clientUuid.substring(0, 8)}...)`)

    // Auto-create any missing post types in DB for this client
    await ensurePostTypes(CLIENT_CONFIG, clientUuid)
    return clientUuid
}

// ============================================
// USED IDEA IDS (DB query)
// ============================================

async function getUsedIdeaIds(): Promise<Set<string>> {
    const { data } = await supabaseAdmin
        .from("ig_posts")
        .select("idea_id")
        .eq("client_id", getActiveProject())
        .not("idea_id", "is", null)

    return new Set((data || []).map(p => p.idea_id).filter((id): id is string => id !== null))
}

// ============================================
// SINGLE POST GENERATION
// ============================================

/**
 * Intra-post checkpoint persisted to ig_jobs.result after the caption phase
 * (copywriter + critic + editorial ≈ the expensive Pro calls). A retry of a
 * failed job resumes from here and goes straight to the visual phase — the
 * cheap deterministic steps (type/product/format resolution) re-run, the AI
 * text calls are skipped.
 */
export interface CaptionCheckpoint {
    stage: "caption"
    captionData: CaptionData & { caption?: string }
    captionModel: string
    score: number
    detail?: { hookScore: number; bodyScore: number; ctaScore: number; originalityScore: number; overall: number; feedback: { keep: string[]; fix: string[] } }
    format: PostFormat
    selectedTypeName: string
    ideaId: string | null
    reviewId: string | null
    linkedProductId: string | null
    megaPromptHead: string
    costSoFar: number
    /** Attribution carried through resume so ig_generation_log stays truthful */
    strategy?: "repair" | "bestof2"
    editorialRounds?: number
    finalScore?: number
}

export async function generateOnePost(options: {
    configName?: string
    type?: string
    topic?: string
    /** Idea explicitly picked by the user (ig_post_ideas id) — used for source
     *  attribution (idea_id link + markIdeaAsUsed) instead of weighted selection. */
    ideaId?: string
    /** Hook approved in the content plan — binds the copywriter (refine, don't replace). */
    approvedHook?: string
    dryRun?: boolean
    performance?: PerformanceInsight
    aspectRatio?: string
    medium?: PostMedium
    /** User's own uploaded photo — becomes the mandatory VISUAL BASE of the native render
     *  (designed on/around, never published raw). Ignored for reels. */
    customImageUrl?: string
    /** Explicit product ID from ig_products — overrides random product selection */
    productId?: string
    /** Content pillar key ("Zaměření" in the Generate tab). Narrows weighted type
     *  selection to that pillar's formats. Only meaningful when `type` is absent —
     *  an explicit type already decides the pillar. */
    category?: string
    campaignContext?: {
        postNumber: number
        totalPosts: number
        previousPosts: { hook: string; topic: string }[]
        /** The strategist's campaign arc, decided once at plan time and carried by every post.
         *  previousPosts alone only ever describes where the campaign has been — the arc is the
         *  only thing that tells post #1 (which has no predecessors) where it's going. */
        campaignArc?: string
    }
    /** Media allowed by the subscription plan (undefined = everything; legacy plans). Disallowed medium gets clamped to carousel. */
    allowedMedia?: string[]
    /** Medium the job was charged for (media-weighted credits) — the engine never renders a more expensive one. */
    chargedMedium?: PostMedium
    /** ig_jobs id — enables writing the caption checkpoint for crash-resume. */
    jobId?: string
    /** Prior checkpoint from a failed job — skips the caption phase (copywriter/critic/editorial). */
    resumeFrom?: CaptionCheckpoint
    /** Feed-pattern slot decided at plan time (campaigns). Passed in rather than recomputed so a
     *  resumed/retried post keeps the mode its neighbours were planned around. Omit for one-off
     *  posts — those derive it from the live feed. */
    slotIntent?: SlotIntent
    onProgress?: (stage: string, progress: number, message: string, editorialLog?: EditorialMessage[]) => Promise<void>
}): Promise<{ id?: string; caption: string; imageUrl?: string; cost: number; mediaType: PostMedium }> {
    const report = options.onProgress || (async () => { }) // no-op if not provided
    const clientUuid = await ensureConfig(options.configName)
    const ck = options.resumeFrom?.stage === "caption" ? options.resumeFrom : undefined

    // Wrap entire generation in request-scoped context to prevent race conditions
    return withActiveProject(clientUuid, async () => {
    const config = CLIENT_CONFIG!
    const startTime = Date.now()
    let cost = ck?.costSoFar ?? 0

    // 0. Context FIRST (pipeline v2, stage 4) — real-world signals (holiday/season/trends)
    // now arrive BEFORE the Researcher, so they can bias WHAT gets made (type selection),
    // not just how it's written. The gathered block is appended to the mega prompt at the
    // same injection point as before (content unchanged). Skipped on checkpoint resume —
    // a resumed post's caption already exists.
    let contextBlock = ""
    let hasHoliday = false
    if (!ck) {
        await report("researcher", 3, "🌍 Context Agent sbírá sezónní a oborový kontext...")
        try {
            const { gatherContext, formatContextForPrompt } = await import("./context-agent")
            const context = await gatherContext(config, "single")
            contextBlock = formatContextForPrompt(context)
            hasHoliday = context.holidays.length > 0
            const holidayInfo = hasHoliday ? ` | 📅 ${context.holidays[0]}` : ""
            console.log(`   🌍 Context: ${context.season}${holidayInfo} | ${context.pulse.length} signálů`)
            cost += COSTS.contextAgent
        } catch (err: any) {
            console.warn(`   ⚠️ Context agent skipped: ${err?.message?.substring(0, 60)}`)
        }
    }

    // 0.5 User photo analysis — the uploaded photo becomes the VISUAL BASE of the post
    // (the native engine designs the post ON it, it is never published raw). One vision
    // call describes it here because both consumers are text-only: the copywriter gets
    // the description as context (caption must not contradict the visual) and the AI
    // Designer needs it to write a composition grounded in the real photo. Runs on
    // checkpoint resume too — a resumed post still renders its media.
    let userPhotoDescription: string | undefined
    if (options.customImageUrl) {
        try {
            const resp = await fetch(options.customImageUrl)
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
            const photoBuf = Buffer.from(await resp.arrayBuffer())
            const { analyzeImagesWithText } = await import("./gemini-client")
            const raw = await analyzeImagesWithText(
                [{ buffer: photoBuf, mimeType: options.customImageUrl.endsWith(".png") ? "image/png" : "image/jpeg" }],
                `Describe this photo factually for a designer who cannot see it. Return JSON: {"description": "2-3 English sentences covering subject(s), setting, action, mood, dominant colors and composition"}`,
            )
            userPhotoDescription = JSON.parse(raw.replace(/```(?:json)?/g, "").trim())?.description || undefined
            cost += COSTS.imageQA
            if (userPhotoDescription) console.log(`   📷 Fotka uživatele: ${userPhotoDescription.substring(0, 100)}…`)
        } catch (err: any) {
            console.warn(`   ⚠️ Analýza nahrané fotky přeskočena: ${err?.message?.substring(0, 60)}`)
        }
    }

    // 1. Select post type
    await report("researcher", 5, "🔍 Researcher vybírá typ postu...")
    console.log("\n📋 Vybírám typ postu...")
    const postTypes = await getActivePostTypes(config.postTypes)
    if (postTypes.length === 0) {
        throw new Error(`Žádné aktivní typy postů pro "${config.id}". Zkontroluj konfiguraci a tabulku ig_post_types.`)
    }
    let selectedType: PostType

    const forcedTypeName = ck?.selectedTypeName || options.type
    if (forcedTypeName) {
        const found = postTypes.find(pt => pt.name === forcedTypeName)
        if (!found) throw new Error(`Post type "${forcedTypeName}" not found. Available: ${postTypes.map(t => t.name).join(", ")}`)
        selectedType = found
    } else {
        // Manual-only formats (giveaways, contests — real-world commitments) are
        // NEVER auto-picked; they exist only for the explicit Generate-tab flow.
        const manualOnlyNames = new Set((config.postTypeDefs ?? []).filter(d => d.manualOnly).map(d => d.name))
        const autoTypes = postTypes.filter(t => !manualOnlyNames.has(t.name))
        let selectableTypes = autoTypes.length > 0 ? autoTypes : postTypes

        // "Zaměření" pillar picked by the user in the Generate tab. Until now this
        // was stored on the job row and never read, so choosing "Prodej" and leaving
        // the format on "AI vybere" silently generated from every pillar. Narrow the
        // candidate pool instead — but never let the filter empty it (a pillar whose
        // formats are all manual-only or deactivated would otherwise throw below).
        if (options.category) {
            const allowed = new Set(config.contentPillars?.[options.category]?.postTypes ?? [])
            const narrowed = selectableTypes.filter(t => allowed.has(t.name))
            if (narrowed.length > 0) {
                selectableTypes = narrowed
                console.log(`   🎯 Zaměření "${options.category}" → ${narrowed.length} formátů`)
            } else {
                console.warn(`   ⚠️ Zaměření "${options.category}" nemá dostupný formát — vybírám ze všech`)
            }
        }

        // Memory-informed post type weighting
        let postTypeBoosts: Record<string, number> = {}
        try {
            const { getPostTypeBoosts } = await import("./memory-agent")
            postTypeBoosts = await getPostTypeBoosts(selectableTypes.map(t => t.name))
            const boostedTypes = Object.entries(postTypeBoosts).filter(([, v]) => v !== 0)
            if (boostedTypes.length > 0) {
                console.log(`   🧠 Memory boosts: ${boostedTypes.map(([k, v]) => `${k}=${v > 0 ? "+" : ""}${v.toFixed(2)}`).join(", ")}`)
            }
        } catch {
            // Non-fatal — continue with base weights
        }

        // Measured per-format engagement (propagateMetricsToSources → ig_post_types.
        // performance_score). Bounded ×[0.5, 1.6] vs the measured average, and only once
        // ≥2 formats have real data — one lucky format must not monopolize a cold start.
        const measured = selectableTypes.filter(t => t.performance_score != null && (t.times_used_with_metrics ?? 0) >= 2)
        const measuredAvg = measured.length >= 2
            ? measured.reduce((s, t) => s + t.performance_score, 0) / measured.length
            : 0
        const perfFactor = (type: PostType): number => {
            if (measuredAvg <= 0 || type.performance_score == null || (type.times_used_with_metrics ?? 0) < 2) return 1
            return Math.min(1.6, Math.max(0.5, type.performance_score / measuredAvg))
        }

        // Holiday/seasonal signal → bounded ×1.3 bias toward product/promo formats
        // (same name-pattern approach as review-type detection). Deterministic, small.
        const HOLIDAY_BIAS_PATTERN = /product|produkt|drop|limitka|nabidka|promo|akce/i
        const weighted = selectableTypes.flatMap(type => {
            const baseWeight = type.frequency === "daily" ? 3 : type.frequency === "weekly" ? 2 : 1
            const boost = postTypeBoosts[type.name] || 0
            let finalWeight = Math.max(1, Math.round(baseWeight * (1 + boost) * perfFactor(type)))
            if (hasHoliday && HOLIDAY_BIAS_PATTERN.test(type.name)) {
                finalWeight = Math.max(1, Math.round(finalWeight * 1.3))
            }
            return Array(finalWeight).fill(type)
        })
        selectedType = weighted[Math.floor(Math.random() * weighted.length)]
        if (measuredAvg > 0) {
            const shifts = selectableTypes.map(t => `${t.name}=${perfFactor(t).toFixed(2)}`).filter(s => !s.endsWith("=1.00"))
            if (shifts.length > 0) console.log(`   📊 Format performance weights: ${shifts.join(", ")}`)
        }
        if (hasHoliday) console.log("   📅 Svátek v kontextu — produktové/promo typy dostaly ×1.3 váhu")
    }
    console.log(`   ✓ ${selectedType.emoji} ${selectedType.display_name}`)

    // 2. Get source material (per-idea cooldown deduplikace)
    await report("researcher", 15, `🔍 Researcher hledá zdroje pro ${selectedType.display_name}...`)
    console.log("📚 Hledám zdroje (cooldown dle nápadu)...")
    let idea: PostIdea | null = null
    let review: Review | null = null

    // Review-type detection by name pattern — works for canonical "recenze" AND
    // brand-specific custom formats (e.g. "recenze_zakazniku", "spokojeny_klient").
    if (ck) {
        // Resume: restore the exact sources the checkpointed caption was written from —
        // only the ids matter downstream (createPost FKs + markAsUsed).
        idea = ck.ideaId ? ({ id: ck.ideaId } as PostIdea) : null
        review = ck.reviewId ? ({ id: ck.reviewId } as Review) : null
    } else if (/recenz|review|testimonial|spokojen/i.test(selectedType.name)) {
        const reviews = await getWeightedReviews(3)
        if (reviews.length > 0) {
            review = reviews[0]
            console.log(`   ✓ Recenze (weighted): "${review.quote.substring(0, 40)}..." (score: ${review.performance_score || 'N/A'})`)
        }
    } else if (options.ideaId) {
        idea = await getIdeaById(options.ideaId)
        if (!idea) throw new Error("Vybraný nápad nenalezen pro tohoto klienta")
        console.log(`   ✓ Nápad (vybraný uživatelem): "${idea.title}"`)
    } else if (!options.topic) {
        const ideas = await getWeightedIdeas(3)
        if (ideas.length > 0) {
            idea = ideas[0]
            console.log(`   ✓ Nápad (weighted): "${idea.title}" (score: ${idea.performance_score || 'N/A'}, ${ideas.length} dostupných)`)
        } else {
            console.log(`   ℹ️ Všechny nápady v cooldownu — Gemini vymyslí vlastní`)
        }
    } else {
        // Explicit topic drives the prompt (buildMegaPrompt ignores the idea when a
        // topic is set) — skip weighted selection so no idea gets falsely credited,
        // cooled down, or scored for a post it didn't influence.
        console.log(`   🎯 Explicitní téma — přeskakuji výběr nápadu (žádná falešná atribuce)`)
    }

    // 3. Get recent captions for dedup — include hook + body summary (not just hooks!)
    const recentPosts = await getRecentPosts(30)
    const recentHooks = recentPosts
        .map(p => {
            if (!p.caption) return ""
            const lines = p.caption.split("\n").filter(Boolean)
            const hook = lines[0]?.substring(0, 80) || ""
            const body = lines.slice(1).join(" ").substring(0, 120)
            return body ? `${hook} — ${body}` : hook
        })
        .filter(Boolean)

    // 3b. Recent design fingerprints — anti-repetition input for the AI Designer.
    // Concept alone lets the model "diverge" in words while rendering the same layout,
    // so feed the structural attributes too and hard-ban the latest layout archetypes.
    const recentDesigns = recentPosts
        .map(p => (p as any).design_brief)
        .filter(Boolean)
        .slice(0, 6)
    const recentBriefs = recentDesigns
        .map((d: any) => {
            const parts = [
                d.concept,
                d.layoutArchetype && `layout: ${d.layoutArchetype}`,
                d.typography?.placement && `text: ${d.typography.placement}`,
                d.typography?.styleDescription && `type: ${d.typography.styleDescription}`,
                d.colorTreatment && `color: ${String(d.colorTreatment).substring(0, 80)}`,
            ]
            return parts.filter(Boolean).join(" | ")
        })
        .filter(Boolean)
    const recentArchetypes = [...new Set(
        recentDesigns
            .slice(0, 3)
            .map((d: any) => d.layoutArchetype as string | undefined)
            .filter((a: any): a is string => Boolean(a))
    )]

    // 3c. Feed-pattern slot. Campaign posts arrive with theirs already decided at plan time
    // (stable across worker retries — recomputing mid-batch could flip a resumed post's mode);
    // a one-off post computes it here from the live grid size. Never fatal: a pattern is a
    // nice-to-have on top of a good post, so a failed count just means full creative freedom.
    let slotIntent: SlotIntent | undefined = options.slotIntent
    if (!slotIntent && config.feedPattern && config.feedPattern !== "none") {
        try {
            const feedCount = await countFeedPosts(clientUuid)
            slotIntent = computeSlotIntent(config.feedPattern, feedCount, feedCount + 1) ?? undefined
            if (slotIntent) console.log(`   🔲 Feed pattern "${config.feedPattern}": slot #${feedCount} → ${slotIntent.visualMode}`)
        } catch (e: any) {
            console.warn(`   ⚠️ Feed pattern skipped: ${e?.message}`)
        }
    }

    // 4. Get performance data
    const _getPillarForType = createPillarMapper(config)
    const performance = options.performance || await analyzePerformance(config, _getPillarForType)

    // 4b. Smart product selection — cooldown-based from ig_products
    let selectedProduct: SelectedProduct | undefined = undefined
    let linkedProductId: string | undefined = undefined

    // Resume: re-fetch the exact product the checkpointed caption references
    // (reuses the explicit-product branch); no product on checkpoint = none now.
    const explicitProductId = ck ? ck.linkedProductId || undefined : options.productId
    if (explicitProductId) {
        // Explicit product from ig_products DB table (user picked via @ mention).
        // client_id is part of the filter, not an assumption: the id arrives from a
        // browser payload / plan row, so an id belonging to another tenant would
        // otherwise render a foreign product into this client's post.
        const { data: dbProduct } = await supabaseAdmin
            .from("ig_products")
            .select("id, name, type, slug, price, description, image_urls, line_id, line_step, line_role, specs, ig_product_lines(name)")
            .eq("id", explicitProductId)
            .eq("client_id", clientUuid)
            .single()
        if (dbProduct) {
            selectedProduct = toSelectedProduct(dbProduct)
            linkedProductId = dbProduct.id
            console.log(`   🛍️ Explicit product (from DB): "${selectedProduct.name}"`)
        }
    } else if (!ck && selectedType.uses_product) {
        // Smart: cooldown-based selection from ig_products
        const cooldownDays = config.productCooldownDays ?? 14
        const cooldownDate = new Date()
        cooldownDate.setDate(cooldownDate.getDate() - cooldownDays)

        const { data: candidates } = await supabaseAdmin
            .from("ig_products")
            .select("id, name, type, slug, price, description, image_urls, line_id, line_step, line_role, specs, ig_product_lines(name)")
            .eq("client_id", clientUuid)
            .or(`last_used_at.is.null,last_used_at.lt.${cooldownDate.toISOString()}`)
            .order("last_used_at", { ascending: true, nullsFirst: true })
            .limit(5)

        if (candidates && candidates.length > 0) {
            // Pick from top 3 least-recently-used (slight randomness to avoid predictability)
            const pick = candidates[Math.floor(Math.random() * Math.min(3, candidates.length))]
            selectedProduct = toSelectedProduct(pick)
            linkedProductId = pick.id
            console.log(`   🛍️ Smart product (cooldown ${cooldownDays}d): "${selectedProduct.name}"`)
        } else {
            console.log(`   ℹ️ All products in cooldown (${cooldownDays}d) — generating without product`)
        }
    }

    // 5. Generate caption / video script / carousel
    let format = getPostFormat(config, selectedType.name)

    // Category format override — preferences from pillar category config
    const _pillarKey = _getPillarForType(selectedType.name)
    const _pillarCfg = config.contentPillars[_pillarKey]
    const _category = idea?.subcategory
        ? _pillarCfg?.categories?.find((c: any) => c.id === idea.subcategory)
        : undefined

    if (_category?.medium && _category.medium !== "auto") {
        format.medium = _category.medium
        if (_category.medium === "carousel" && format.overlayStyle === "none") {
            format.overlayStyle = "cover"
        }
        console.log(`   📁 Kategorie "${_category.label}" → medium: ${_category.medium}`)
    }
    if (_category?.overlayStyle && _category.overlayStyle !== "auto") {
        format.overlayStyle = _category.overlayStyle
        console.log(`   🎨 Kategorie "${_category.label}" → overlay: ${_category.overlayStyle}`)
    }
    if (_category?.aspectRatio && _category.aspectRatio !== "auto") {
        format.aspectRatio = _category.aspectRatio as any
        console.log(`   📐 Kategorie "${_category.label}" → ratio: ${_category.aspectRatio}`)
    }

    // User override: if aspectRatio is provided, use it (highest priority)
    if (options.aspectRatio) {
        format.aspectRatio = options.aspectRatio as any
        console.log(`   📐 Formát přepsán uživatelem: ${options.aspectRatio}`)
    }
    // User override: force medium (image/carousel/reel)
    if (options.medium) {
        format.medium = options.medium
        if (options.medium === "carousel" && format.overlayStyle === "none") {
            format.overlayStyle = "cover"
        }
        console.log(`   📐 Médium přepsáno uživatelem: ${options.medium}`)
    }

    // ── Safety clamps — extracted so they can be RE-APPLIED after a checkpoint
    // restore. These read LIVE settings (subscription plan, REELS_ENABLED env,
    // charged medium); a checkpoint freezes the format under the ORIGINAL attempt's
    // rules, and a deferral window can last hours — live rules must win on resume
    // (a resumed reel must not bypass a kill-switch flipped mid-deferral).
    const CAROUSEL_SAFE_RATIOS = ["1:1", "4:5", "3:4"] as const
    const applySafetyClamps = (f: PostFormat) => {
        // Plan media gating: config/category may still ask for a medium the
        // subscription doesn't include (e.g. reel on the Start tier) — clamp it.
        if (options.allowedMedia && !options.allowedMedia.includes(f.medium)) {
            const original = f.medium
            f.medium = options.allowedMedia.includes("carousel") ? "carousel" : "image"
            if (f.medium === "carousel" && f.overlayStyle === "none") {
                f.overlayStyle = "cover"
            }
            console.log(`   🔒 Médium "${original}" není v balíčku — fallback na ${f.medium}`)
        }

        // Global reel kill-switch — Veo video generation is OFF for now. Clamp any reel
        // (from config/category/user) to carousel so no Veo call is ever made. Flip back on
        // with REELS_ENABLED=1 (env) when ready — no redeploy needed.
        if (process.env.REELS_ENABLED !== "1" && f.medium === "reel") {
            f.medium = "carousel"
            f.aspectRatio = "4:5" // 9:16 (reel) není feed-legální pro carousel — IG by ho ořízl
            if (f.overlayStyle === "none") f.overlayStyle = "cover"
            console.log("   🚫 Reels dočasně vypnuté (Veo off) — fallback na carousel (4:5)")
        }

        // Billing cap — the medium can never be MORE expensive than what the job was
        // charged for (credits are media-weighted: image 1 / carousel 3 / reel 5, charged
        // at job creation). Ideas/categories may still ask for a pricier medium; clamp it
        // to the paid one. Downward differences are refunded via reconcileJobCharge.
        if (options.chargedMedium) {
            const MEDIUM_RANK: Record<string, number> = { image: 0, carousel: 1, reel: 2 }
            if ((MEDIUM_RANK[f.medium] ?? 0) > (MEDIUM_RANK[options.chargedMedium] ?? 0)) {
                const original = f.medium
                f.medium = options.chargedMedium
                if (f.medium !== "reel" && f.aspectRatio === "9:16") f.aspectRatio = "4:5"
                if (f.medium === "carousel" && f.overlayStyle === "none") f.overlayStyle = "cover"
                console.log(`   💳 Médium "${original}" překračuje účtovaný formát — clamp na ${f.medium}`)
            }
        }

        // Feed-safety clamp — carousel/image must use a feed-legal aspect ratio. A 9:16
        // (or landscape 16:9/4:3) on a non-reel medium gets cropped hard by Instagram, no
        // matter where it leaked in from (config / category / onboarding / user override).
        if (f.medium !== "reel" && !CAROUSEL_SAFE_RATIOS.includes(f.aspectRatio as any)) {
            const original = f.aspectRatio
            f.aspectRatio = "4:5"
            console.log(`   📐 Poměr "${original}" není feed-legální pro ${f.medium} — clamp na 4:5`)
        }
    }
    applySafetyClamps(format)

    // Smart overlay rotation — for image posts only, auto-select layout variant
    if (format.medium === "image" && format.overlayStyle === "default") {
        // Extract recent overlay styles from recent posts' image_style field
        // If no history, just vary based on post type
        const recentStyles = recentPosts
            .filter(p => p.image_style && p.image_style.startsWith("overlay:"))
            .slice(0, 3)
            .map(p => p.image_style.replace("overlay:", ""))
        const smartOverlay = selectOverlayVariant(selectedType.name, recentStyles)
        format.overlayStyle = smartOverlay
        console.log(`   🎨 Smart overlay: "${smartOverlay}" (${recentStyles.length ? `avoided: ${recentStyles.join(", ")}` : "no history"})`)
    }

    // Resume: the checkpointed caption was written for THIS exact resolved format —
    // restore it wholesale so the visual phase matches the text, then RE-APPLY the live
    // safety clamps: the snapshot froze the rules of the original attempt, but the reel
    // kill-switch / plan gating / billing cap may have changed during the deferral
    // window (up to MAX_CAMPAIGN_AGE_MS) and must win over the frozen format.
    if (ck) {
        format = { ...ck.format }
        applySafetyClamps(format)
    }

    const isReel = format.medium === "reel"
    const isCarousel = format.medium === "carousel"

    // Caption-phase state — filled either from the checkpoint (resume) or by the
    // full caption phase below (copywriter → dedup → critic → editorial).
    // Deliberately an ALIAS of the orchestrators' CaptionData, not a copy: this used
    // to be a hand-maintained duplicate of the same 13 fields, so every new medium's
    // payload (slides, scenes, frames…) had to be added in two places or the caption
    // phase silently dropped it on the way to the renderer.
    type CaptionPhaseData = CaptionData
    let captionData: CaptionPhaseData
    let megaPrompt = ""
    let captionModel = getModel("textPro")
    let score = 7
    let feedback = ""
    let detail: Awaited<ReturnType<typeof scorePost>>["detail"]
    let strategyUsed: "repair" | "bestof2" = "repair"
    let editorialRoundsUsed = 0
    let finalScore = 0

    if (ck) {
        // ♻️ Resume from the caption checkpoint — the expensive Pro text calls
        // (copywriter, dedup regen, critic, editorial board) already ran and are skipped.
        captionData = ck.captionData as CaptionPhaseData
        captionModel = ck.captionModel || captionModel
        score = ck.score ?? 7
        detail = ck.detail
        strategyUsed = ck.strategy === "bestof2" ? "bestof2" : "repair"
        editorialRoundsUsed = ck.editorialRounds ?? 0
        finalScore = ck.finalScore ?? ck.score ?? 7
        megaPrompt = ck.megaPromptHead || "[resumed from checkpoint]"
        if (isReel && captionData.caption) captionData.body = captionData.caption
        console.log(`   ♻️ Resume z caption checkpointu — přeskakuji copywriter/critic/editorial (hook: "${captionData.hook.substring(0, 50)}...")`)
        await report("designer", 52, "♻️ Navazuji z checkpointu — text hotový, jdu rovnou na vizuál...")
    } else {
    // (block deliberately not re-indented — same style as the withActiveProject wrapper)
    const postFormat = isReel ? "video script" : isCarousel ? "carousel" : "caption"
    await report("copywriter", 25, `✍️ Copywriter generuje ${postFormat}...`)
    console.log(`✍️  Generuji ${postFormat} (Pro copywriter ladder)...`)
    // Resolve the CTA policy ONCE and pass it to the writer AND every judge (critic,
    // ranking judge, editorial board) — writer/judge parity on the CTA rules.
    const ctaPolicy = resolveCtaPolicyForPost(config, selectedType.name, selectedProduct)
    megaPrompt = buildMegaPrompt(config, selectedType, idea, review, recentHooks, performance, options.topic, selectedProduct, format, options.approvedHook, ctaPolicy)

    // The user's uploaded photo will be the post's visual base — the caption must
    // work WITH it (not describe a different scene), but the photo is NOT the topic.
    if (options.customImageUrl && userPhotoDescription) {
        megaPrompt += `\n\n## 📷 KLIENTOVA FOTKA — VIZUÁL TOHOTO POSTU
Uživatel nahrál vlastní fotku, která bude vizuálním základem příspěvku. Co na ní je: "${userPhotoDescription}"

### INSTRUKCE:
- Drž se zadaného tématu a formátu — fotka NENÍ téma postu, je to jeho vizuál
- Hook, text ani imagePrompt nesmí být s fotkou v rozporu (nepopisuj jinou scénu, jiné prostředí, jiné lidi)
- imagePrompt navrhni tak, aby stavěl na této fotce (její kompozice, nálada a barvy jsou dané)
`
        console.log("   📷 Caption kontext: popis nahrané fotky injektován")
    }

    // Inject brand memories (long-term learning from past performance) — retrieved by
    // relevance to the topic/idea when available (pipeline v2), not just top-confidence.
    try {
        const memoryTopic = options.topic || idea?.title || undefined
        const memories = await getBrandMemories(8, clientUuid, _getPillarForType(selectedType.name), memoryTopic)
        if (memories.length > 0) {
            megaPrompt += formatMemoriesForPrompt(memories)
            console.log(`   🧠 Brand memory: ${memories.length} vzorců načteno`)
        }
    } catch {
        // Non-fatal — continue without memories
    }

    // Inject critic score feedback from recent generation logs — same-FORMAT history first
    // (a carousel's "fix" notes are noise for a meme), client-wide as cold-start fallback
    // (post_type only exists on rows written after the format-feedback migration).
    try {
        let { data: recentLogs } = await supabaseAdmin
            .from("ig_generation_log")
            .select("critic_score, critic_keep, critic_fix")
            .eq("client_id", clientUuid)
            .eq("post_type", selectedType.name)
            .not("critic_score", "is", null)
            .order("created_at", { ascending: false })
            .limit(5)
        let scopeLabel = `formátu ${selectedType.display_name}`

        if (!recentLogs || recentLogs.length < 2) {
            ({ data: recentLogs } = await supabaseAdmin
                .from("ig_generation_log")
                .select("critic_score, critic_keep, critic_fix")
                .eq("client_id", clientUuid)
                .not("critic_score", "is", null)
                .order("created_at", { ascending: false })
                .limit(5))
            scopeLabel = "všech postů"
        }

        if (recentLogs && recentLogs.length >= 2) {
            const avgScore = recentLogs.reduce((s, l) => s + (l.critic_score || 0), 0) / recentLogs.length
            const allKeep = recentLogs.flatMap(l => l.critic_keep || []).filter(Boolean)
            const allFix = recentLogs.flatMap(l => l.critic_fix || []).filter(Boolean)
            // Deduplicate
            const keepUnique = [...new Set(allKeep)].slice(0, 5)
            const fixUnique = [...new Set(allFix)].slice(0, 5)

            if (keepUnique.length > 0 || fixUnique.length > 0) {
                megaPrompt += `\n\n## 📋 ZPĚTNÁ VAZBA Z PŘEDCHOZÍCH POSTŮ (Critic Score)\nPrůměrné skóre posledních ${recentLogs.length} postů ${scopeLabel}: **${avgScore.toFixed(1)}/10**\n`
                if (keepUnique.length > 0) {
                    megaPrompt += `\n**Co funguje (zachovej):** ${keepUnique.join(", ")}`
                }
                if (fixUnique.length > 0) {
                    megaPrompt += `\n**Co zlepšit (oprav):** ${fixUnique.join(", ")}`
                }
                console.log(`   📋 Critic feedback (${scopeLabel}): avg ${avgScore.toFixed(1)}/10 (${keepUnique.length} keep, ${fixUnique.length} fix)`)
            }
        }
    } catch {
        // Non-fatal
    }

    // Inject feed continuity context — recent published posts for thematic/visual flow
    const publishedPosts = recentPosts
        .filter(p => p.status === "posted" || p.status === "approved")
        .slice(0, 5)
    if (publishedPosts.length > 0) {
        const feedSummary = publishedPosts.map((p, i) => {
            const hook = p.caption?.split("\n")[0]?.substring(0, 60) || "?"
            const pillar = p.content_pillar || "?"
            return `  ${i + 1}. "${hook}" [${pillar}]`
        }).join("\n")
        megaPrompt += `\n\n## 📱 FEED KONTINUITA — POSLEDNÍ PUBLIKOVANÉ PŘÍSPĚVKY
Tvůj nový post bude na feedu HNED VEDLE těchto příspěvků. Zajisti návaznost:

${feedSummary}

### INSTRUKCE:
- NEOPAKUJ stejné hooky, fráze ani argumenty z posledních postů
- Zvol JINÝ úhel pohledu nebo content pillar než posledních 2-3 postů
- Vizuální styl by měl být konzistentní s brandem, ale ne identický s posledním postem
- Pokud poslední posty byly edukační, zvol lehčí formát (meme, behind-the-scenes) — a naopak
- Feed by měl působit pestře a dynamicky, ne jako kopie jednoho vzoru
`
        console.log(`   📱 Feed continuity: ${publishedPosts.length} published postů jako kontext`)
    }

    // Inject real-world context (season, industry trends, local relevance) — gathered
    // BEFORE the Researcher (step 0), appended here at the original injection point.
    megaPrompt += contextBlock

    // Inject campaign continuity context. Gated on the context existing, NOT on having
    // predecessors: post #1 has no previousPosts by definition, and it's the post that sets
    // the tone for the whole series — it needs the arc most.
    if (options.campaignContext) {
        const cc = options.campaignContext
        const arcSection = cc.campaignArc
            ? `\n### Kampaňová linka (platí pro celou sérii):\n${cc.campaignArc}\n`
            : ""
        const prevSummary = cc.previousPosts.map((p, i) => `  ${i + 1}. Hook: "${p.hook}" | Téma: ${p.topic}`).join("\n")
        const prevSection = cc.previousPosts.length > 0
            ? `\n### Předchozí příspěvky v kampani:\n${prevSummary}\n\n### INSTRUKCE PRO NÁVAZNOST:\n- Tento post MUSÍ tematicky navazovat na předchozí — buduj na nich, prohlubuj téma, přidej nový úhel\n- NEOPAKUJ stejný hook ani stejný argument — posuň příběh dál\n- Zachovej konzistentní tón a vizuální styl napříč celou kampaní\n- Pokud je zadané hlavní téma kampaně, drž se ho ale z jiného úhlu než předchozí posty\n- Série by měla fungovat jako storytelling: každý post přidává novou vrstvu\n`
            : `\n### INSTRUKCE:\n- Toto je PRVNÍ post kampaně — otevři linku, nastav tón a nech prostor, na co budou další posty navazovat\n`
        megaPrompt += `\n\n## 🎯 KAMPAŇ — NÁVAZNOST PŘÍSPĚVKŮ (KRITICKÉ!)\nToto je příspěvek **${cc.postNumber}/${cc.totalPosts}** v rámci koherentní kampaně.\n${arcSection}${prevSection}`
        console.log(`   🎯 Campaign context: post ${cc.postNumber}/${cc.totalPosts} (${cc.previousPosts.length} previous)${cc.campaignArc ? " + arc" : ""}`)
    }

    if (process.env.DEBUG_PROMPT === "1") {
        console.log(`\n────── MEGA PROMPT ──────\n${megaPrompt}\n─────────────────────────\n`)
    }

    const schema = isReel ? buildVideoSchema(config) : isCarousel ? buildCarouselSchema(config) : buildCaptionSchema(config)
    // The MAIN caption is "80% of text quality" → it runs the Pro QUALITY LADDER
    // (textPro: gemini-pro-latest → gemini-2.5-pro, never flash), retried hard on
    // transient 503/429. This is in-job (800s budget) so latency is hidden. Previously
    // this used the fast flash `text` tier — captions shipped at flash quality every post.
    // If both Pro tiers are exhausted, generateTextQuality throws QualityUnavailableError
    // → the campaign worker defers and the single-post route fails cleanly (never flash).
    const captionLadder = [getModel("textPro")]
    if (hasFallback("textPro")) captionLadder.push(getModel("textPro", "fallback"))
    captionModel = captionLadder[0] // actual winning model, for truthful model_used logging

    const generateDraft = async (label: string): Promise<CaptionPhaseData> => {
        const raw = await generateTextQuality(megaPrompt, { models: captionLadder, responseSchema: schema, label, temperature: getTemperature("copywriter"), onModelUsed: m => { captionModel = m } })
        cost += COSTS.textGeneration
        let parsed: CaptionPhaseData
        try {
            const jsonMatch = raw.match(/\{[\s\S]*\}/)
            parsed = JSON.parse(jsonMatch?.[0] || raw)
        } catch (e) {
            console.error("   ⚠️ JSON parse failed, raw:", raw.substring(0, 200))
            throw new Error(`Caption generation failed: ${e}`)
        }
        // For reels: caption field replaces body
        if (isReel && parsed.caption) parsed.body = parsed.caption
        return parsed
    }

    const recentBodies = recentPosts
        .map(p => p.caption?.split("\n").slice(1).join(" ") || "")
        .filter(b => b.length > 20)
    const isDup = (d: CaptionPhaseData) =>
        recentHooks.some(h => isHookSimilar(d.hook, h, 0.5)) ||
        (d.body ? isBodySimilar(d.body, recentBodies, 0.4) : false)

    // Pipeline v2 (PIPELINE_BESTOF2=1): generate-and-SELECT instead of generate-and-repair.
    // Two parallel drafts → the judge RANKS them (pairwise beats absolute scoring for LLM
    // judges) → the winner gets at most ONE repair round. One lost draft degrades to the
    // legacy single-draft path; both lost = the same QualityUnavailable failure as before.
    let pendingRank: { a: CaptionPhaseData; b: CaptionPhaseData } | null = null
    if (process.env.PIPELINE_BESTOF2 === "1") {
        await report("copywriter", 25, "✍️ Copywriter píše 2 návrhy paralelně (best-of-2)...")
        const [ra, rb] = await Promise.allSettled([generateDraft("copywriter-a"), generateDraft("copywriter-b")])
        if (ra.status === "fulfilled" && rb.status === "fulfilled") {
            pendingRank = { a: ra.value, b: rb.value }
            captionData = ra.value // provisional — replaced by the ranked winner below
        } else if (ra.status === "fulfilled" || rb.status === "fulfilled") {
            captionData = ra.status === "fulfilled" ? ra.value : (rb as PromiseFulfilledResult<CaptionPhaseData>).value
            console.warn("   ⚠️ Best-of-2: jeden návrh selhal — pokračuji legacy cestou s jedním návrhem")
        } else {
            throw ra.reason
        }

        // Pre-rank dedup: a duplicate draft never wins. Both duplicates → fall through
        // to the standard dedup regen below with draft A.
        if (pendingRank) {
            const dupA = isDup(pendingRank.a)
            const dupB = isDup(pendingRank.b)
            if (dupA !== dupB) {
                captionData = dupA ? pendingRank.b : pendingRank.a
                pendingRank = null
                console.log("   ⚠️ Best-of-2: jeden návrh byl duplicitní — vítězí automaticky ten druhý")
            } else if (dupA && dupB) {
                captionData = pendingRank.a
                pendingRank = null
                console.log("   ⚠️ Best-of-2: oba návrhy duplicitní — jdu přes dedup regeneraci")
            }
        }

        // Rank the two clean drafts — one judge call picks the winner + returns its rubric.
        if (pendingRank) {
            try {
                const rank = await rankDrafts(config, pendingRank.a, pendingRank.b, selectedType.name, ctaPolicy)
                cost += COSTS.textGeneration
                captionData = rank.winner === "A" ? pendingRank.a : pendingRank.b
                score = rank.score
                detail = rank.detail
                feedback = `Best-of-2: vítěz ${rank.winner} (${rank.score}/10 vs ${rank.loserScore}/10) — ${rank.reason}`
                strategyUsed = "bestof2"
                console.log(`   ⚖️ ${feedback}`)
                await report("critic", 45, `⚖️ Kritik vybral návrh ${rank.winner} (${rank.score}/10 vs ${rank.loserScore}/10)`)
            } catch (rankErr: any) {
                captionData = pendingRank.a
                console.warn(`   ⚠️ Ranking judge failed — fallback na legacy critic: ${rankErr?.message?.substring(0, 80)}`)
            }
            pendingRank = null
        }
    } else {
        captionData = await generateDraft("copywriter")
    }

    // 6. Dedup check — hook similarity + body keyword overlap
    const hookDuplicate = recentHooks.some(h => isHookSimilar(captionData.hook, h, 0.5))
    const bodyDuplicate = captionData.body ? isBodySimilar(captionData.body, recentBodies, 0.4) : false
    const isDuplicate = hookDuplicate || bodyDuplicate

    if (isDuplicate) {
        const reason = hookDuplicate ? "hook" : "téma/body"
        console.log(`   ⚠️ Duplicitní ${reason} detekován — regeneruji...`)
        const retryPrompt = megaPrompt + `\n\nDŮLEŽITÉ: Předchozí verze měla duplicitní ${reason}!\nOdmítnutý hook: "${captionData.hook}"\n${bodyDuplicate ? `Odmítnuté body: "${captionData.body?.substring(0, 100)}..."\n` : ""}Vymysli ÚPLNĚ jiný úhel pohledu, jiný hook, jiné argumenty.`
        // Dedup regeneration is best-effort: we already hold a valid Pro caption, so if
        // the Pro ladder is busy (QualityUnavailable) or the JSON is bad, keep the original
        // rather than fail the post.
        try {
            const retryText = await generateTextQuality(retryPrompt, { models: captionLadder, responseSchema: schema, label: "copywriter-dedup", temperature: getTemperature("copywriter") })
            cost += COSTS.textGeneration
            const jsonMatch = retryText.match(/\{[\s\S]*\}/)
            captionData = JSON.parse(jsonMatch?.[0] || retryText)
            if (isReel && captionData.caption) captionData.body = captionData.caption
            console.log(`   ✓ Nový hook: "${captionData.hook.substring(0, 50)}..."`)
        } catch {
            console.log("   ⚠️ Dedup regeneration failed/busy — pokračuji s originálem")
        }
    }

    // 6b. Quality gate — Critic + Chief Editor multi-round review.
    // Best-of-2 already scored the winner via the ranking judge — no second critic call.
    if (strategyUsed !== "bestof2") {
        await report("critic", 45, "🔍 Kritik hodnotí kvalitu obsahu...")
        console.log("🔍 Quality gate (Critic + Šéfredaktor review)...")
        ;({ score, feedback, detail } = await scorePost(
            config,
            captionData as { hook: string; body?: string; cta: string; hashtags: string[]; slides?: { headline: string; subtext: string }[]; angle?: string },
            selectedType.name,
            ctaPolicy
        ))
        cost += COSTS.textGeneration
    }
    finalScore = score
    const scoreEmoji = score >= 8 ? "🟢" : score >= 6 ? "🟡" : "🔴"
    console.log(`   ${scoreEmoji} Score: ${score}/10 — ${feedback}`)
    if (detail) {
        console.log(`   📊 Hook: ${detail.hookScore}/3 | Body: ${detail.bodyScore}/3 | CTA: ${detail.ctaScore}/2 | Orig: ${detail.originalityScore}/2`)
        if (detail.feedback.keep.length > 0) console.log(`   ✅ Zachovat: ${detail.feedback.keep.join(", ")}`)
        if (detail.feedback.fix.length > 0) console.log(`   🔧 Opravit: ${detail.feedback.fix.join(", ")}`)
    }

    // Editorial Board — multi-round review by Chief Editor (runs the Pro ladder).
    // Non-fatal: this polishes a caption that ALREADY passed the copywriter on Pro, so
    // if the Pro tiers are momentarily exhausted mid-editorial we keep the existing Pro
    // caption and ship it rather than defer/fail the whole post over a polish step.
    // Best-of-2: the ranked winner gets at most ONE repair round (select > repair).
    try {
        const editorialResult = await reviewPost(
            config,
            captionData,
            selectedType.name,
            { score, feedback, detail },
            megaPrompt,
            report,
            strategyUsed === "bestof2" ? 1 : undefined,
            { ctaPolicy, selectedProduct },
        )
        captionData = editorialResult.captionData
        cost += editorialResult.totalTokenCost
        if (isReel && captionData.caption) captionData.body = captionData.caption

        // auto-approve (score ≥ 9) returns a bookkeeping round-0 entry at zero cost = 0 real rounds
        editorialRoundsUsed = editorialResult.totalTokenCost === 0 ? 0 : editorialResult.rounds.length
        finalScore = editorialResult.finalScore || score
        console.log(`   🎖️ Editorial: ${editorialResult.approved ? "✅ schváleno" : "⏰ max kol"} po ${editorialRoundsUsed} ${editorialRoundsUsed === 1 ? "kole" : "kolech"} ($${editorialResult.totalTokenCost.toFixed(3)})`)
    } catch (editorialErr: any) {
        console.warn(`   ⚠️ Editorial board failed/busy — keeping the Pro caption as-is: ${editorialErr?.message?.substring(0, 100)}`)
    }
    } // end caption phase (skipped entirely on checkpoint resume)

    // Persist the caption checkpoint — a crash/timeout in the visual phase can resume
    // from here without re-burning the copywriter/critic/editorial Pro calls. The final
    // done-write overwrites ig_jobs.result, so a successful job carries no checkpoint.
    if (options.jobId && !ck && !options.dryRun) {
        try {
            const checkpoint: CaptionCheckpoint = {
                stage: "caption",
                captionData: captionData as CaptionCheckpoint["captionData"],
                captionModel,
                score,
                detail,
                format,
                selectedTypeName: selectedType.name,
                ideaId: idea?.id ?? null,
                reviewId: review?.id ?? null,
                linkedProductId: linkedProductId ?? null,
                megaPromptHead: megaPrompt.substring(0, 500),
                costSoFar: cost,
                strategy: strategyUsed,
                editorialRounds: editorialRoundsUsed,
                finalScore,
            }
            await supabaseAdmin.from("ig_jobs").update({ result: { checkpoint } }).eq("id", options.jobId)
            console.log("   💾 Caption checkpoint uložen (resume-ready)")
        } catch { /* best-effort — never fail the post over a checkpoint */ }
    }

    // Use client-specific hashtags
    let finalHashtags: string[]
    if (config.hashtagPools) {
        const pools = config.hashtagPools
        const hashtags = new Set<string>()
        pools.core.forEach(tag => hashtags.add(tag))
        captionData.hashtags?.slice(0, 4).forEach(tag => {
            const formatted = tag.startsWith("#") ? tag : `#${tag}`
            hashtags.add(formatted.toLowerCase())
        })
        const fillTags = [...(pools.niche || []), ...(pools.broad || [])].sort(() => Math.random() - 0.5)
        for (const tag of fillTags) {
            if (hashtags.size >= 10) break
            hashtags.add(tag)
        }
        if (hashtags.size < 10 && pools.trending?.length) {
            hashtags.add(pools.trending[Math.floor(Math.random() * pools.trending.length)])
        }
        finalHashtags = Array.from(hashtags).slice(0, 10)
    } else {
        finalHashtags = (captionData.hashtags || []).slice(0, 10).map(tag =>
            tag.startsWith("#") ? tag : `#${tag}`
        )
    }
    const fullCaption = `${captionData.hook}\n\n${captionData.body || ""}\n\n${captionData.cta}\n\n${finalHashtags.join(" ")}`
    console.log(`   ✓ Caption (${fullCaption.length} znaků)`)

    // 7. Generate media — delegate to orchestrators
    let imageUrl: string | undefined
    let renderResult: RenderResult | undefined

    if (!options.dryRun) {
        if (isReel && (captionData.scenes?.length || captionData.videoScript)) {
            renderResult = await renderReel({
                config, captionData: captionData as CaptionData, format, selectedType, report,
                selectedProduct: selectedProduct as SelectedProduct | undefined,
                linkedProductId, clientUuid, recentBriefs, recentArchetypes,
            })
            imageUrl = renderResult.imageUrl
            cost += renderResult.cost
        } else if (isCarousel && captionData.slides) {
            // options.customImageUrl (user's own photo) is NOT published raw — it flows
            // into the native engine as the mandatory visual base (cover for carousels).
            renderResult = await renderCarousel({
                config, captionData: captionData as CaptionData, format, selectedType, report,
                selectedProduct: selectedProduct as SelectedProduct | undefined,
                linkedProductId, clientUuid, recentBriefs, recentArchetypes, slotIntent,
                userPhotoUrl: options.customImageUrl, userPhotoDescription,
            })
            imageUrl = renderResult.imageUrl
            cost += renderResult.cost
        } else {
            // Truthful fallback: a reel caption without scenes/script (or a carousel
            // without slides) renders as a single image — the format MUST say so.
            // Leaving format.medium = "reel" here made media_type lie: reconcileJobCharge
            // saw no billed-vs-actual delta (5-credit reel charge, 1-credit image shipped,
            // no refund) and the publisher later pushed a static image through the video
            // path (publish failure).
            if (format.medium !== "image") {
                console.warn(`   ⚠️ ${format.medium} caption bez ${format.medium === "reel" ? "scén/skriptu" : "slides"} — renderuji single image, media_type opraven`)
                format.medium = "image"
                if (!(CAROUSEL_SAFE_RATIOS as readonly string[]).includes(format.aspectRatio)) format.aspectRatio = "4:5"
                if (format.overlayStyle === "none") format.overlayStyle = "default"
            }
            renderResult = await renderImage({
                config, captionData: captionData as CaptionData, format, selectedType, report,
                selectedProduct: selectedProduct as SelectedProduct | undefined,
                linkedProductId, clientUuid, recentBriefs, recentArchetypes, slotIntent,
                userPhotoUrl: options.customImageUrl, userPhotoDescription,
            })
            imageUrl = renderResult.imageUrl
            cost += renderResult.cost
        }
    } else {
        console.log(`🎨 [DRY-RUN] Přeskakuji ${isReel ? "video" : isCarousel ? "carousel" : "obrázek"}`)
    }


    // 8. Save to database
    let postId: string | undefined

    if (!options.dryRun) {
        await report("uploading", 90, "💾 Ukládám do databáze...")
        console.log("💾 Ukládám...")
        const post = await createPost({
            post_type_id: selectedType.id,
            idea_id: idea?.id,
            review_id: review?.id,
            product_id: linkedProductId || undefined,
            caption: fullCaption,
            hashtags: finalHashtags,
            call_to_action: captionData.cta,
            image_prompt: captionData.imagePrompt,
            image_url: imageUrl,
            // 'image' | 'carousel' | 'reel' — drives how the publisher cron pushes media.
            // (Carousel slide URLs stay pipe-joined in image_url per the orchestrator convention.)
            media_type: format.medium,
            image_style: renderResult?.imageStyle ?? (isReel ? "veo-3.1" : "native"),
            design_brief: renderResult?.designBrief ?? null,
            status: "draft",
        })

        postId = post.id
        if (idea) await markIdeaAsUsed(idea.id)
        if (review) await markReviewAsUsed(review.id)

        // Track product usage for cooldown rotation
        if (linkedProductId) {
            await supabaseAdmin
                .from("ig_products")
                .update({
                    last_used_at: new Date().toISOString(),
                    times_used: (await supabaseAdmin.from("ig_products").select("times_used").eq("id", linkedProductId).single()).data?.times_used + 1 || 1,
                })
                .eq("id", linkedProductId)
            console.log(`   📌 Product "${selectedProduct?.name}" marked as used`)
        }

        await logGeneration({
            postId: post.id,
            promptUsed: megaPrompt.substring(0, 500),
            // Truthful image tier: renderResult.imageModel reflects what ACTUALLY rendered the
            // shipped buffer (a mid-generation 503 can silently drop Nano Banana Pro to the
            // weaker fallback tier) — falls back to the static config only for reels/dry-run,
            // where no native image render happened.
            modelUsed: `${captionModel} + ${renderResult?.imageModel || getModel("image")}`,
            generationTimeMs: Date.now() - startTime,
            criticScore: score,
            criticKeep: detail?.feedback.keep,
            criticFix: detail?.feedback.fix,
            qaStatus: renderResult?.qaStatus,
            strategy: strategyUsed,
            editorialRounds: editorialRoundsUsed,
            finalScore: finalScore || score,
            angle: captionData.angle,
            postType: selectedType.name,
        })

        // Close the loop: persist recurring critic "fix" notes into brand memory so they
        // become standing "avoid" rules instead of expiring after 5 posts. Fire-and-forget.
        if (detail?.feedback?.fix?.length) {
            learnFromCriticInsights(clientUuid, detail.feedback.fix, post.id, _getPillarForType(selectedType.name)).catch(() => {})
        }

        // Brand-consistency sensor (pipeline v2): embed the caption + log cosine vs
        // the gold-voice centroid. Fire-and-forget — never blocks or fails the post.
        scoreConsistencyAndEmbed(post.id, clientUuid, fullCaption).catch(() => {})

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

    return { id: postId, caption: fullCaption, imageUrl, cost, mediaType: format.medium }
    }) // end withActiveProject
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
    const config = CLIENT_CONFIG!
    const { count, dryRun } = options
    const estimatedCost = count * COSTS.perPost

    console.log("\n" + "═".repeat(60))
    console.log("📅 AUTOPILOT — BATCH GENEROVÁNÍ (s Editorial Review)")
    console.log("═".repeat(60))
    console.log(`   📊 Postů: ${count}`)
    const USD_TO_CZK = 23
    console.log(`   💰 Odhadovaná cena: ~$${estimatedCost.toFixed(2)} (${(estimatedCost * USD_TO_CZK).toFixed(0)} Kč) + editorial review`)
    console.log(`   ${dryRun ? "🔍 MODE: DRY-RUN" : "🚀 MODE: PRODUKCE"}`)
    console.log("═".repeat(60))

    console.log("\n📊 Analyzuji výkon minulých postů...")
    const _getPillarForType = createPillarMapper(config)
    const performance = await analyzePerformance(config, _getPillarForType)
    if (performance.topPatterns.length > 0) {
        console.log(`   ✓ Naučené vzorce: ${performance.topPatterns.join(", ")}`)
    } else {
        console.log("   ℹ️ Zatím žádná data o výkonu — generuji bez feedbacku")
    }

    const results: Array<{ type: string; success: boolean; id?: string; cost: number }> = []
    let totalCost = 0
    let typesToUse = buildSmartWeekPlan(config, performance, options.count)

    // ═══════════════════════════════════════════════════════
    // EDITORIAL REVIEW — Chief Editor reviews the content plan
    // ═══════════════════════════════════════════════════════
    console.log("\n🎖️ ŠÉFREDAKTOR — Review content plánu...")
    console.log("─".repeat(60))

    // Build a plan structure for editorial review
    const startDate = new Date()
    const planSlots = typesToUse.map((type, i) => {
        const postDate = new Date(startDate)
        postDate.setDate(postDate.getDate() + Math.floor(i * 7 / typesToUse.length))
        const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
        return {
            day: dayNames[postDate.getDay()],
            date: postDate.toISOString().split("T")[0],
            time: "17:00",
            postType: type,
            topic: options.topic || `Auto-generated ${type} post`,
            reason: "Algoritmicky vybraný typ",
            weatherContext: null,
            calendarContext: null,
            source: "planned" as const,
        }
    })

    try {
        const editorialPlanResult = await reviewContentPlan(config, planSlots)
        totalCost += editorialPlanResult.totalTokenCost

        if (editorialPlanResult.approved) {
            console.log(`\n   ✅ Content plan schválen po ${editorialPlanResult.rounds.length} kolech`)
        } else {
            console.log(`\n   ⏰ Content plan po max kolech — používám poslední verzi`)
        }

        // Extract post types from approved plan
        const approvedPlan = editorialPlanResult.plan
        if (Array.isArray(approvedPlan) && approvedPlan.length > 0) {
            const extracted = approvedPlan.map((s: any) => s.postType).filter(Boolean) as string[]
            // The editorial LLM sometimes returns pillar labels (e.g. "Dosah",
            // "Zapojení", "Prodej") instead of registered post-type keys, which would
            // crash the per-post lookup. Validate against the active post types and
            // recover any unknown slot from the algorithmic plan (preserves count + variety).
            const validNames = new Set((await getActivePostTypes(config.postTypes)).map(t => t.name))
            const fallbackPlan = buildSmartWeekPlan(config, performance, extracted.length || options.count)
            const recovered = extracted.map((t, i) => validNames.has(t) ? t : fallbackPlan[i % fallbackPlan.length])
            const invalidCount = recovered.filter((t, i) => t !== extracted[i]).length
            if (invalidCount > 0) {
                console.log(`   ⚠️ ${invalidCount} neplatných typů z editorial plánu nahrazeno algoritmickým výběrem`)
            }
            typesToUse = recovered.filter(Boolean)
            // If editorial changed the count, respect it
            if (typesToUse.length === 0) {
                typesToUse = buildSmartWeekPlan(config, performance, options.count)
            }
        }

        console.log(`   📋 Final plan: ${typesToUse.join(", ")}`)
        console.log(`   💰 Editorial review cost: $${editorialPlanResult.totalTokenCost.toFixed(3)}`)
    } catch (editorialErr: any) {
        console.warn(`   ⚠️ Editorial review failed: ${editorialErr?.message?.substring(0, 100)}`)
        console.log(`   📋 Using original plan: ${typesToUse.join(", ")}`)
    }

    console.log("─".repeat(60))

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

    const successCount = results.filter(r => r.success).length
    console.log("\n" + "═".repeat(60))
    console.log("📊 SOUHRN")
    console.log("═".repeat(60))
    results.forEach((r) => {
        console.log(`   ${r.success ? "✅" : "❌"} ${r.type.padEnd(15)} $${r.cost.toFixed(3)} ${r.id ? `(${r.id.substring(0, 8)}...)` : ""}`)
    })
    console.log("─".repeat(60))
    console.log(`   ✅ ${successCount}/${results.length} postů`)
    console.log(`   💰 Celkem: $${totalCost.toFixed(3)} (${(totalCost * 23).toFixed(0)} Kč)`)
    console.log("═".repeat(60) + "\n")
}
