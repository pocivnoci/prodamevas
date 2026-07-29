"use server"

import supabaseAdmin from "@/supabase/admin"
import { requireProjectAccess } from "@/lib/auth-guard"
import { computeSlotIntents, ghostRolesForPreview, getPatternDef, type SlotIntent, type FeedPatternId, type VisualMode } from "@/lib/feed-pattern"
import type { ClientConfig } from "@/instagram/configs/types"

// ─── Content Plan Preview (cheap text-only plan before expensive generation) ──

/** Media a content plan may schedule. Deliberately narrower than PostMedium: stories
 *  are ephemeral and never enter the feed grid the plan is built around, so they are
 *  mapped to `image` at plan time (see effectiveMediums below). Widen together with the
 *  calendar and the campaign worker, not on its own. */
export type PlanMedium = "image" | "carousel" | "reel"

export interface ContentPlanItem {
    id: string
    postType: string
    postTypeEmoji: string
    postTypeLabel: string
    /** Effective medium for this post (reel kill-switch already applied) — UI shows single vs carousel */
    medium: PlanMedium
    pillar: string
    pillarEmoji: string
    hookPreview: string
    angle: string
    topic: string
    week?: number
    day?: number
    /** AI self-evaluation: 1-10 quality score for the hook */
    qualityScore?: number
    /** Linked product from ig_products */
    productId?: string
    productName?: string
    productImage?: string
    /** Planner: when this post should publish. Set at plan approval, editable. */
    scheduledDate?: string // "YYYY-MM-DD"
    scheduledTime?: string // "HH:MM"
    /** ig_post_ideas id when this item was sourced from the idea bank (Zásobník témat). */
    ideaId?: string
    /** Idea title for the 💡 badge in the plan preview. */
    ideaTitle?: string
    /** This post's cell in the feed pattern, decided at plan time and carried through to the
     *  worker — so a resumed/retried post keeps the visual mode the grid was planned around. */
    slotIntent?: SlotIntent
}

/**
 * The brand's real posting cadence (posts per week), used by the planner UI to turn a chosen
 * duration (1 week / 2 weeks / month) into an honest post count. Seeded at onboarding from the
 * client's actual IG history; validateConfig guarantees a clamped 1–7 default of 4.
 */
export async function getPlanCadence(projectSlug: string): Promise<number> {
    try {
        await requireProjectAccess(projectSlug)
        const { loadConfig } = await import("@/instagram/configs")
        const config = await loadConfig(projectSlug)
        return config.postsPerWeek || 4
    } catch {
        return 4
    }
}

/**
 * Persist the cadence the user picked in the plan brief, so the next visit starts from their
 * real rhythm instead of the onboarding seed. Minimal-diff config write (raw row, not the
 * validateConfig-materialised shape) — same pattern as config-actions updates.
 */
export async function savePlanCadence(projectSlug: string, postsPerWeek: number): Promise<{ success: boolean }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        // Match validateConfig / distributeSchedule (1–14; 14 = 2×/day).
        const clamped = Math.min(14, Math.max(1, Math.round(postsPerWeek)))
        const { data, error } = await supabaseAdmin
            .from("clients")
            .select("config")
            .eq("id", clientId)
            .single()
        if (error || !data) return { success: false }
        const { error: updateError } = await supabaseAdmin
            .from("clients")
            .update({ config: { ...(data.config || {}), postsPerWeek: clamped } })
            .eq("id", clientId)
        if (updateError) return { success: false }
        const { invalidateConfigCache } = await import("@/instagram/configs")
        invalidateConfigCache(projectSlug)
        return { success: true }
    } catch {
        return { success: false }
    }
}

/**
 * Everything the user can dial in before the planner runs. An options object rather than
 * positional args: the brief keeps growing (goal / format mix / product focus) and a 6th
 * optional string in a row is how you silently pass a category as a topic.
 */
export interface PlanBriefOptions {
    count: number
    /** Campaign-wide topic — every post must relate to it. */
    topic?: string
    /** What the campaign is FOR. Steers the planner prompt always, and (once the brand has
     *  engagement data) biases pillar ratios toward pillars whose CTA strategy serves it. */
    goal?: CampaignGoal
    /** How carousel-heavy the plan may be. Replaces what used to be a hardcoded ¼ cap —
     *  carousels cost more credits and take longer, so this is the user's call, not ours. */
    carouselShare?: CarouselShare
    /** Products the campaign revolves around (ig_products ids, ownership-validated). */
    productIds?: string[]
    /** Client-generated UUID: lets the UI poll getPlanProgress() for live stage messages
     *  while this action runs (the deep pipeline takes ~1-2 min — a mute spinner won't do). */
    planRunId?: string
}

export type CampaignGoal = "reach" | "engagement" | "sales" | "launch"
export type CarouselShare = "low" | "auto" | "high"

/** What each goal asks the planner to optimise for, and which CTA strategy it favours. */
const GOAL_BRIEFS: Record<CampaignGoal, { label: string; instruction: string; favours: string[] }> = {
    reach: {
        label: "Dosah",
        instruction: "Cílem je ZÁSAH NOVÝCH LIDÍ. Hooky musí být sdílitelné a srozumitelné i pro někoho, kdo značku nezná — žádný vnitřní žargon, žádné odkazy na předchozí posty. Upřednostni široce relatable témata před hloubkovou expertízou.",
        favours: ["none", "soft"],
    },
    engagement: {
        label: "Komunita",
        instruction: "Cílem je INTERAKCE. Každý post má dávat divákovi důvod reagovat — otázka, názor, ke kterému se dá přihlásit, nebo něco, co si chce uložit. Preferuj hooky, které vyvolají komentář, ne jen souhlasné kývnutí.",
        favours: ["soft", "medium"],
    },
    sales: {
        label: "Prodej",
        instruction: "Cílem je PRODEJ. Posty mají vést k nákupu: konkrétní produkt, konkrétní problém, který řeší, konkrétní důvod jednat teď. Vyhni se obecnému 'budování povědomí' — každý post má mít komerční záměr.",
        favours: ["hard", "medium"],
    },
    launch: {
        label: "Novinka",
        instruction: "Cílem je UVEDENÍ NOVINKY. Série má stoupající oblouk: nakousnout → vysvětlit → dokázat → vyzvat k akci. Posty na sebe musí navazovat jako kapitoly, ne existovat samostatně.",
        favours: ["medium", "hard"],
    },
}

/**
 * Tilt pillar ratios toward the pillars whose CTA strategy serves the campaign goal.
 * Returns a CLONE — biasing the loaded config in place would leak a one-off campaign's
 * slant into every later generation for this client.
 */
function applyGoalBias(config: ClientConfig, goal: CampaignGoal): ClientConfig {
    const favoured = GOAL_BRIEFS[goal].favours
    const pillars = config.contentPillars || {}
    const scaled: Record<string, number> = {}
    let total = 0
    for (const [key, pillar] of Object.entries(pillars)) {
        const cta = pillar?.ctaStrategy || "soft"
        const factor = favoured.includes(cta) ? 1.5 : 0.7
        const r = (pillar?.ratio ?? 0) * factor
        scaled[key] = r
        total += r
    }
    // Renormalise to sum 1. buildSmartWeekPlan reads a ratio as a direct fraction of the post
    // count (`Math.round(count * ratio)`) and only renormalises on the pillarPerformance
    // branch — so un-normalised ratios wouldn't just re-weight the mix, they'd inflate the
    // early pillars' counts and starve whatever came last in the iteration order.
    if (total <= 0) return config
    const biased: ClientConfig["contentPillars"] = {}
    for (const [key, pillar] of Object.entries(pillars)) {
        biased[key] = { ...pillar, ratio: scaled[key] / total }
    }
    return { ...config, contentPillars: biased }
}

export async function generateContentPlan(
    projectSlug: string,
    brief: PlanBriefOptions
): Promise<{
    success: boolean
    plan?: ContentPlanItem[]
    strategySummary?: string
    draftId?: string
    /** The grid rhythm this plan was laid out against, so the UI can re-derive slots locally
     *  when the user adds/removes items instead of round-tripping to the planner. */
    feedPattern?: { id: FeedPatternId; seqBase: number }
    error?: string
}> {
    const { count, topic: userTopic, goal, carouselShare, productIds, planRunId } = brief
    // ─── Durable observability: a breadcrumb row in ig_jobs proves the action started and
    // shows where it stops/fails. Instrumentation must NEVER break generation (all wrapped). ──
    const t0 = Date.now()
    let planJobId: string | null = null
    const planBreadcrumb = async (update: Record<string, any>) => {
        if (!planJobId) return
        try { await supabaseAdmin.from("ig_jobs").update(update).eq("id", planJobId) }
        catch (e: any) { console.warn(`📋 [content-plan] breadcrumb update failed: ${e?.message}`) }
    }
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const { getModel } = await import("@/instagram/models")
        const planModel = getModel("planner")
        console.log(`📋 [content-plan] START client=${clientId} count=${count} topic="${userTopic || "-"}" goal=${goal || "-"} carousels=${carouselShare || "auto"} model=${planModel}`)
        try {
            const { data: jobRow } = await supabaseAdmin
                .from("ig_jobs")
                .insert({
                    // status must be one of the ig_jobs CHECK values — "running" violates the
                    // constraint and silently killed every content_plan breadcrumb insert
                    // (0/179 rows existed), so plan-stage failures were invisible.
                    client_id: clientId,
                    config: { kind: "content_plan", count, topic: userTopic || null, goal: goal || null, carouselShare: carouselShare || null, model: planModel, runId: planRunId || null },
                    status: "pending",
                    progress: 0,
                    agent_message: "📋 Plánuji obsah…",
                })
                .select("id")
                .single()
            planJobId = jobRow?.id || null
        } catch (e: any) {
            console.warn(`📋 [content-plan] breadcrumb insert failed: ${e?.message}`)
        }
        const { loadConfig } = await import("@/instagram/configs")
        const { buildSmartWeekPlan, getPostFormat } = await import("@/instagram/caption-generator")
        const { analyzePerformance } = await import("@/instagram/performance")
        const { setActiveProject, createPillarMapper, getPillarForType } = await import("@/instagram/service")

        const config = await loadConfig(projectSlug)
        setActiveProject(clientId)

        // Get strategic post type sequence
        const _getPillarForType = createPillarMapper(config)
        const performance = await analyzePerformance(config, _getPillarForType)
        // The campaign goal tilts the pillar mix toward pillars whose CTA strategy serves it
        // (a sales campaign should lean on the hard-CTA pillars). Applied to a CLONE — the
        // stored config must not inherit a one-off campaign's bias. Note buildSmartWeekPlan
        // only reads these ratios once the brand has engagement data; at cold start it walks
        // config.weekPlan verbatim, and the prompt below is what carries the goal instead.
        const planConfig = goal ? applyGoalBias(config, goal) : config
        const typeSequence = buildSmartWeekPlan(planConfig, performance, count)

        // ─── Zásobník témat: the idea bank feeds the plan first — weighted (proven/fresh)
        // ideas become plan topics with ideaId attribution; the model invents the rest.
        // Read-only here: the preview must NEVER mutate the bank (deposit + markIdeaAsUsed
        // happen only at startCampaign / post generation). ──
        let bankIdeas: { id: string; title: string; content: string; performance_score?: number; times_used_with_metrics?: number }[] = []
        try {
            const { getWeightedIdeas } = await import("@/instagram/service")
            bankIdeas = await getWeightedIdeas(count)
        } catch (e: any) {
            console.warn(`📋 [content-plan] idea bank skipped: ${e?.message}`)
        }

        // Effective medium per post, precomputed once so the badge (item.medium) and the planner
        // prompt always read the exact same value. Two passes:
        //  1) Base format, with the reels kill-switch spreading clamped reels (~2/3 image, ~1/3
        //     carousel) so reels-off doesn't flood the plan with carousels.
        //  2) Hard cap: at most ¼ of the plan may be carousels. Walk in order, keep carousels until
        //     the cap is hit, then demote every further carousel to a single image. Reels (when
        //     enabled) and images are untouched.
        // How many carousels the plan may contain. Used to be a fixed ¼; carousels cost more
        // credits and take longer to generate, so the share is the user's call now. "auto"
        // keeps the historical ¼ so an unspecified brief behaves exactly as before.
        const CAROUSEL_DIVISOR: Record<CarouselShare, number> = { low: 6, auto: 4, high: 2 }
        const carouselCap = Math.floor(count / CAROUSEL_DIVISOR[carouselShare || "auto"])
        const effectiveMediums: PlanMedium[] = (() => {
            let carouselsKept = 0
            return typeSequence.map((typeName, i) => {
                const configured = getPostFormat(config, typeName).medium
                // v2: stories in content plans. Until then a story-format post type planned
                // into a batch renders as a single image — the plan preview, the calendar and
                // the campaign worker all assume feed media, and a story would silently eat a
                // feed slot it never appears in.
                let m: PlanMedium = configured === "story" ? "image" : configured
                if (process.env.REELS_ENABLED !== "1" && m === "reel") {
                    m = i % 3 === 0 ? "carousel" : "image"
                }
                if (m === "carousel") {
                    if (carouselsKept >= carouselCap) m = "image"
                    else carouselsKept++
                }
                return m
            })
        })()
        // ─── Feed pattern: assign each planned post its cell in the profile grid. Computed
        // once here (not in the worker) so the whole batch is planned against one consistent
        // grid — and so a post that gets retried later can't drift into a different mode than
        // the posts around it were designed for. Never fatal: no pattern = full freedom. ──
        const feedPattern = config.feedPattern || "none"
        let seqBase = 0
        let slotIntents: (SlotIntent | null)[] = []
        if (feedPattern !== "none") {
            try {
                const { countFeedPosts } = await import("@/instagram/service")
                seqBase = await countFeedPosts(clientId)
                slotIntents = computeSlotIntents(feedPattern, seqBase, count)
                console.log(`📋 [content-plan] feed pattern "${feedPattern}" from #${seqBase}: ${slotIntents.map(s => s?.visualMode?.[0] ?? "-").join("")}`)
            } catch (e: any) {
                console.warn(`📋 [content-plan] feed pattern skipped: ${e?.message}`)
                slotIntents = []
            }
        }

        const effectiveMedium = (_typeName: string, i: number): PlanMedium =>
            effectiveMediums[i] ?? "image"

        // Get post type metadata from DB
        const { data: dbPostTypes } = await supabaseAdmin
            .from("ig_post_types")
            .select("name, display_name, emoji, description, uses_product")
            .eq("client_id", clientId)
            .eq("is_active", true)

        const ptMap = new Map((dbPostTypes || []).map(pt => [pt.name, pt]))

        // ─── Quality Context: top hooks + recent dedup ───
        const { data: topPosts } = await supabaseAdmin
            .from("ig_posts")
            .select("caption, engagement_score")
            .eq("client_id", clientId)
            .not("engagement_score", "is", null)
            .order("engagement_score", { ascending: false })
            .limit(5)

        const topHooks = (topPosts || [])
            .map(p => p.caption?.split("\n")[0]?.substring(0, 80))
            .filter(Boolean)

        const { data: recentPosts } = await supabaseAdmin
            .from("ig_posts")
            .select("caption")
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })
            .limit(15)

        const recentHooks = (recentPosts || [])
            .map(p => p.caption?.split("\n")[0]?.substring(0, 60))
            .filter(Boolean)

        // Build context for Gemini — include the EFFECTIVE medium per post (reel kill-switch
        // applied) so the planner writes copy that matches the format and never promises a
        // "video"/"Reel" for something that will actually render as a carousel or single image.
        const typeList = typeSequence.map((typeName, i) => {
            const pt = ptMap.get(typeName)
            const pillar = getPillarForType(config, typeName)
            const pillarCfg = config.contentPillars[pillar]
            const medium = effectiveMedium(typeName, i)
            const formatLabel = medium === "carousel" ? "KARUSEL (statické obrázky/slidy — ŽÁDNÉ video)"
                : medium === "reel" ? "REEL (krátké video)"
                : "JEDEN STATICKÝ OBRÁZEK (ŽÁDNÉ video)"
            // The visual slot shapes the copy, not just the design: a typography cell needs a
            // hook short and punchy enough to BE the image, not a caption sitting on a photo.
            const mode = slotIntents[i]?.visualMode
            const slotLabel = mode
                ? ` | Vizuální slot: ${mode === "typography" ? "TYPOGRAFIE (hook musí unést celý obrázek — krátký, úderný, max ~6 slov)"
                    : mode === "graphic" ? "GRAFIKA (hook krátký, funguje jako nápis v grafice)"
                    : "FOTKA (hook doprovází fotografickou scénu)"}`
                : ""
            return `${i + 1}. Typ: "${typeName}" (${pt?.display_name || typeName}) | Formát: ${formatLabel}${slotLabel} | Pilíř: ${pillarCfg?.label || pillar} | Popis: ${pt?.description || pillarCfg?.description || ""}`
        }).join("\n")

        const topicInstruction = userTopic
            ? `\n## 🎯 HLAVNÍ TÉMA KAMPANĚ: "${userTopic}"\nVšechny posty MUSÍ souviset s tímto tématem, ale každý z jiného úhlu.`
            : ""

        const topHooksSection = topHooks.length > 0
            ? `\n## ✅ PŘÍKLADY NEJLEPŠÍCH HOOKŮ (tyto fungovaly — inspiruj se stylem, NEkopíruj):\n${topHooks.map(h => `- "${h}"`).join("\n")}\n`
            : ""

        const deduplicationSection = recentHooks.length > 0
            ? `\n## 🚫 NEDÁVNÉ HOOKY (NEPOUŽÍVEJ podobné vzorce ani témata!):\n${recentHooks.map(h => `- "${h}"`).join("\n")}\n`
            : ""

        const ideaBankSection = bankIdeas.length > 0
            ? `\n## 💡 ZÁSOBNÍK TÉMAT ZNAČKY (použij přednostně!)
Schválené nápady klienta. Kde to dává smysl, postav post na nápadu ze seznamu a vrať jeho číslo jako "ideaIndex".
Nápad rozveď vlastním hookem a úhlem — jádro tématu ale MUSÍ odpovídat nápadu.
${bankIdeas.map((idea, i) => `${i + 1}. ${(idea.performance_score || 0) > 0 && (idea.times_used_with_metrics || 0) > 0 ? "[🔥 ověřený] " : ""}"${idea.title}" — ${String(idea.content || "").substring(0, 150)}`).join("\n")}
PRAVIDLA: Každý nápad použij MAXIMÁLNĚ jednou. Když se žádný nehodí, vymysli vlastní téma a "ideaIndex" vynech.\n`
            : ""

        // ─── Brand grounding: pipe in what onboarding learned from the client's REAL Instagram.
        // Crucial at cold start — a brand-new client has no posts of OURS yet (topHooks empty),
        // so without this the planner writes generic hooks blind to the brand's proven winners.
        // Proven patterns live in ig_brand_memory (seeded from igInsights.provenPatterns at
        // onboarding, confidence 0.45); the scraped baseline (content mix, hashtags) is on config. ──
        let brandGroundingSection = ""
        try {
            const { getBrandMemories, formatMemoriesForPrompt } = await import("@/instagram/memory-agent")
            const brandMemories = await getBrandMemories(15, clientId)
            const memorySection = formatMemoriesForPrompt(brandMemories)

            const baseline = config.igBaseline
            const baselineSection = baseline
                ? `\n## 📲 BASELINE Z REÁLNÉHO IG ÚČTU ZNAČKY (co už publikovali — stav na tom)\n${
                    baseline.contentMix && Object.keys(baseline.contentMix).length
                        ? `Ověřený mix obsahu: ${Object.entries(baseline.contentMix).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(", ")}\n`
                        : ""
                }${
                    baseline.topHashtags?.length ? `Top hashtagy: ${baseline.topHashtags.slice(0, 10).join(" ")}\n` : ""
                }`
                : ""

            brandGroundingSection = `${memorySection}${baselineSection}`
        } catch (e: any) {
            console.warn(`📋 [content-plan] brand grounding skipped: ${e?.message}`)
        }

        // ─── Live product catalog (ig_products) — NOT config.products (frozen onboarding
        // snapshot): grounding the plan on the snapshot produced hooks naming deleted
        // products while the worker then picked a different live product at render time. ──
        let catalogProducts: { name: string; type: string; price?: string; description?: string }[] = []
        try {
            const { getCatalogProducts } = await import("@/instagram/service")
            catalogProducts = await getCatalogProducts(clientId, config.products)
        } catch (e) {
            console.warn(`📋 [content-plan] catalog read failed — falling back to config snapshot: ${(e as Error)?.message}`)
            catalogProducts = config.products || []
        }

        // ─── Product focus: the campaign revolves around these. Ownership-validated against
        // ig_products (never trust ids from the browser — an unfiltered id is another
        // tenant's product leaking into this brand's plan). ──
        let focusProducts: { id: string; name: string }[] = []
        if (productIds?.length) {
            try {
                const { data: owned } = await supabaseAdmin
                    .from("ig_products")
                    .select("id, name")
                    .eq("client_id", clientId)
                    .in("id", productIds.slice(0, 10))
                focusProducts = owned || []
                if (focusProducts.length !== productIds.length) {
                    console.warn(`📋 [content-plan] product focus: ${productIds.length - focusProducts.length} id(s) rejected (not this client's)`)
                }
            } catch (e: any) {
                console.warn(`📋 [content-plan] product focus skipped: ${e?.message}`)
            }
        }
        const productFocusSection = focusProducts.length > 0
            ? `\n## 🎯 KAMPAŇ SE TOČÍ KOLEM TĚCHTO PRODUKTŮ (priorita nad ostatními):\n${focusProducts.map(p => `- **${p.name}**`).join("\n")}\n⚠️ Většina postů má stavět na některém z těchto produktů — každý ale z jiného úhlu (problém, který řeší; detail; použití; výsledek).\n`
            : ""

        const goalSection = goal
            ? `\n## 🎯 CÍL KAMPANĚ: ${GOAL_BRIEFS[goal].label}\n${GOAL_BRIEFS[goal].instruction}\n`
            : ""

        // ─── Deep plan pipeline (instagram/plan-pipeline.ts): strategist → concepts →
        // cross-family judge → targeted revision. All brand context is assembled here
        // (this file owns the DB queries); the pipeline treats it as an opaque block. ──
        const contextBlock = `## BRAND VOICE
${config.brandVoice.persona}
Tón: ${config.brandVoice.voiceTraits?.join(", ")}

## ANTI-PATTERNS (NEPOUŽÍVEJ)
${config.brandVoice.antiPatterns?.join(", ")}

${catalogProducts.length ? `## PRODUKTY ZNAČKY (${catalogProducts.length})\n${catalogProducts.slice(0, 10).map(p => `- **${p.name}** (${p.type})${p.price ? ` — ${p.price}` : ""}${p.description ? `: ${p.description.substring(0, 60)}` : ""}`).join("\n")}\n⚠️ Pro posty typu product_drop/produkt MUSÍŠ zmínit KONKRÉTNÍ produkt z tohoto seznamu v hooku!\n` : ""}
${config.audiencePersonas?.length ? `## CÍLOVÉ PERSONY\n${config.audiencePersonas.map(p => `- **${p.label}** (${p.ageRange} let): Pain points: ${p.painPoints.slice(0, 2).join(", ")}`).join("\n")}\n` : ""}
${brandGroundingSection}${ideaBankSection}${topHooksSection}${deduplicationSection}${goalSection}${productFocusSection}${topicInstruction}
${count > 14 ? "\n## STRUKTURA\nRozděl do týdnů — každý týden má vlastní mini-téma.\n" : ""}`

        const { runPlanPipeline } = await import("@/instagram/plan-pipeline")
        const pipelineResult = await runPlanPipeline({
            brandName: config.name,
            website: config.website,
            count,
            contextBlock,
            typeList,
            recentHooks,
            onStage: (progress, message) => planBreadcrumb({ progress, agent_message: message }),
        })
        const concepts: { hookPreview: string; angle: string; topic: string; qualityScore?: number; ideaIndex?: number }[] = pipelineResult.concepts
        const strategySummary = pipelineResult.strategySummary || undefined
        await planBreadcrumb({ progress: 92, agent_message: `📝 Plán: ${concepts.length}/${count}${pipelineResult.judged ? " · oponentura ✓" : ""}` })

        // Ensure we have exactly `count` concepts — AI sometimes returns fewer
        let retries = 0
        while (concepts.length < count && retries < 3) {
            console.warn(`   ⚠️ AI vrátila ${concepts.length}/${count} položek — doplňuji (pokus ${retries + 1})...`)

            // Retry for missing items
            const missing = count - concepts.length
            const missingTypes = typeSequence.slice(concepts.length, count)
            const existingHooks = concepts.map(c => c.hookPreview)

            const fillPrompt = `Jsi content planner pro "${config.name}". Potřebuji přesně ${missing} dalších postů do obsahového plánu.

${topHooksSection}
## EXISTUJÍCÍ HOOKY (neduplikuj):
${existingHooks.map(h => `- "${h}"`).join("\n")}

## CHYBĚJÍCÍ TYPY POSTŮ:
${missingTypes.map((t, i) => {
    const pt = ptMap.get(t)
    const pillar = getPillarForType(config, t)
    return `${i + 1}. Typ: "${t}" (${pt?.display_name || t}) | Pilíř: ${pillar}`
}).join("\n")}

Vrať POUZE validní JSON pole obsahující PŘESNĚ ${missing} položek s klíči: hookPreview, angle, topic, qualityScore.`

            try {
                // Same Pro ladder as the pipeline — a fill item is a real plan item, no flash.
                const { generateTextQuality } = await import("@/instagram/gemini-client")
                const { conceptSchema, plannerModels } = await import("@/instagram/plan-pipeline")
                const { getTemperature } = await import("@/instagram/models")
                const fillRaw = await generateTextQuality(fillPrompt, {
                    models: plannerModels(),
                    label: "plan-fill",
                    temperature: getTemperature("copywriter"),
                    responseSchema: conceptSchema,
                })
                const fillMatch = fillRaw.match(/\[[\s\S]*\]/)
                // Fill prompts have no bank section — strip any hallucinated ideaIndex
                const stripIdeaIndex = (arr: any[]) => arr.map(c => ({ ...c, ideaIndex: undefined }))
                if (fillMatch) {
                    const fillConcepts = JSON.parse(fillMatch[0])
                    if (Array.isArray(fillConcepts) && fillConcepts.length > 0) {
                        concepts.push(...stripIdeaIndex(fillConcepts))
                        console.log(`   ✅ Doplněno ${fillConcepts.length} položek (celkem ${concepts.length}/${count})`)
                    }
                } else {
                    // Try parsing as array directly if regex failed
                    const fillConcepts = JSON.parse(fillRaw)
                    if (Array.isArray(fillConcepts) && fillConcepts.length > 0) {
                        concepts.push(...stripIdeaIndex(fillConcepts))
                        console.log(`   ✅ Doplněno ${fillConcepts.length} položek (celkem ${concepts.length}/${count})`)
                    }
                }
            } catch (e) {
                console.warn(`   ⚠️ Fill retry failed: ${e}`)
            }
            retries++
        }

        // Final fallback: pad with generic items if still short after retries
        if (concepts.length < count) {
            console.warn(`   ⚠️ Doplňuji ${count - concepts.length} generických položek...`)
            while (concepts.length < count) {
                const idx = concepts.length
                const typeName = typeSequence[idx % typeSequence.length]
                const pt = ptMap.get(typeName)
                concepts.push({
                    hookPreview: pt?.display_name || typeName,
                    angle: "Automaticky doplněný post",
                    topic: typeName,
                    qualityScore: 5,
                })
            }
        }

        // Build plan items with metadata
        const usedIdeaIdx = new Set<number>()
        const plan: ContentPlanItem[] = typeSequence.slice(0, count).map((typeName, i) => {
            const pt = ptMap.get(typeName)
            const pillar = getPillarForType(config, typeName)
            const pillarCfg = config.contentPillars[pillar]
            const concept = concepts[i] || { hookPreview: "", angle: "", topic: "" }

            // Effective medium (reels-off split applied — see effectiveMedium above)
            const medium = effectiveMedium(typeName, i)

            // Map ideaIndex → ideaId with clamping — the model can hallucinate indexes
            // or reuse one twice; invalid/duplicate indexes silently become "invented".
            const ix = concept.ideaIndex
            let ideaId: string | undefined
            let ideaTitle: string | undefined
            if (typeof ix === "number" && Number.isInteger(ix) && ix >= 1 && ix <= bankIdeas.length && !usedIdeaIdx.has(ix)) {
                usedIdeaIdx.add(ix)
                ideaId = bankIdeas[ix - 1].id
                ideaTitle = bankIdeas[ix - 1].title
            }

            return {
                id: `plan_${Date.now()}_${i}`,
                postType: typeName,
                postTypeEmoji: pt?.emoji || "📝",
                postTypeLabel: pt?.display_name || typeName,
                medium,
                pillar,
                pillarEmoji: pillarCfg?.emoji || "📋",
                hookPreview: concept.hookPreview,
                angle: concept.angle,
                topic: concept.topic,
                qualityScore: concept.qualityScore || undefined,
                week: count > 14 ? Math.floor(i / 7) + 1 : undefined,
                day: i + 1,
                ideaId,
                ideaTitle,
                slotIntent: slotIntents[i] ?? undefined,
            }
        })

        // ─── Product focus: hand the chosen products to the posts that actually show a
        // product, round-robin so a multi-product campaign spreads across them instead of
        // hammering the first one. Post types that don't use a product (tips, behind-the-
        // scenes…) are left alone — forcing a product into them is how you get a caption
        // that mentions a product the image never shows. ──
        if (focusProducts.length > 0) {
            let rr = 0
            for (const item of plan) {
                if (!ptMap.get(item.postType)?.uses_product) continue
                const p = focusProducts[rr++ % focusProducts.length]
                item.productId = p.id
                item.productName = p.name
            }
            console.log(`📋 [content-plan] product focus: ${focusProducts.length} product(s) across ${plan.filter(p => p.productId).length} post(s)`)
        }

        // ─── Durable preview: persist as a 'draft' campaign so a refresh / closed tab doesn't
        // throw away a 1-2 min Pro-ladder run. The worker claims only pending|running, so a
        // draft can never generate — and therefore never charge — until startCampaign flips it.
        // Best-effort: a failed draft write must not sink a plan that already cost real tokens. ──
        let draftId: string | undefined
        try {
            draftId = await persistPlanDraft(clientId, projectSlug, plan, strategySummary, brief)
        } catch (e: any) {
            console.warn(`📋 [content-plan] draft persist failed: ${e?.message}`)
        }

        await planBreadcrumb({ status: "done", progress: 100, agent_message: "✅ Plán hotový", result: { planLength: plan.length, judged: pipelineResult.judged } })
        return { success: true, plan, strategySummary, draftId, feedPattern: { id: feedPattern, seqBase } }
    } catch (err: any) {
        const msg = (err?.message || String(err)).substring(0, 500)
        console.error("generateContentPlan error:", msg)
        await planBreadcrumb({ status: "failed", agent_message: "❌ Plánování selhalo", error: msg })
        try {
            const Sentry = await import("@sentry/nextjs")
            Sentry.captureException(err, { tags: { route: "content-plan", planJobId: planJobId || "none" } })
        } catch { /* Sentry optional */ }
        return { success: false, error: err?.message || String(err) }
    } finally {
        console.log(`📋 [content-plan] END job=${planJobId || "none"} ${Date.now() - t0}ms`)
    }
}

// ─── Plan drafts ─────────────────────────────────────────────────────────────
// A draft is an ig_campaigns row parked at status 'draft'. Reusing the campaign row
// (rather than a new table) means approval is a status flip instead of a copy, and the
// worker — which claims only 'pending'/'running' — structurally cannot generate or
// charge a plan the user never approved.

async function persistPlanDraft(
    clientId: string,
    projectSlug: string,
    plan: ContentPlanItem[],
    strategySummary: string | undefined,
    brief: PlanBriefOptions,
): Promise<string | undefined> {
    // One active draft per client — a fresh preview supersedes the stale one. Scoped to
    // status 'draft' so this can never delete a pending/running/finished campaign.
    await supabaseAdmin.from("ig_campaigns").delete().eq("client_id", clientId).eq("status", "draft")
    const { data, error } = await supabaseAdmin
        .from("ig_campaigns")
        .insert({
            client_id: clientId,
            status: "draft",
            // Full UI shape (pillar, emoji, qualityScore…), unlike startCampaign's stripped
            // planRows — the draft has to rehydrate the preview exactly as the user left it.
            plan,
            options: { configName: projectSlug, strategySummary: strategySummary ?? null, brief },
            total: plan.length,
        })
        .select("id")
        .single()
    if (error) throw new Error(error.message)
    return data?.id
}

/**
 * The client's active plan draft, if any — GenerateTab calls this on mount to restore a
 * preview the user generated before a refresh. Returns null (never throws) so a missing
 * draft is just an empty studio, not an error screen.
 */
export async function getPlanDraft(projectSlug: string): Promise<{
    draftId: string
    plan: ContentPlanItem[]
    strategySummary?: string
    brief?: PlanBriefOptions
} | null> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const { data } = await supabaseAdmin
            .from("ig_campaigns")
            .select("id, plan, options")
            .eq("client_id", clientId)
            .eq("status", "draft")
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        if (!data || !Array.isArray(data.plan) || data.plan.length === 0) return null
        return {
            draftId: data.id,
            plan: data.plan as ContentPlanItem[],
            strategySummary: data.options?.strategySummary || undefined,
            brief: data.options?.brief || undefined,
        }
    } catch {
        return null
    }
}

/**
 * Persist the user's edits to a draft (debounced from the UI). Status-scoped: once the
 * draft has been approved into a real campaign, late-arriving autosaves from the still-open
 * tab must not rewrite a plan the worker is already draining.
 */
export async function savePlanDraft(
    projectSlug: string,
    draftId: string,
    plan: ContentPlanItem[],
): Promise<{ success: boolean; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const items = (plan || []).filter(Boolean)
        const { error } = await supabaseAdmin
            .from("ig_campaigns")
            .update({ plan: items, total: items.length, updated_at: new Date().toISOString() })
            .eq("id", draftId)
            .eq("client_id", clientId)
            .eq("status", "draft")
        if (error) throw new Error(error.message)
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err?.message || String(err) }
    }
}

/**
 * The client's grid rhythm + the visual modes the next few posts will take, for FeedTab's
 * ghost cells ("this is how the feed will continue"). Cheap: one count + pure math.
 *
 * `upcoming` fills the grid to the next whole rows so the ghosts read as a shape rather than
 * a ragged tail.
 */
export async function getFeedPatternPreview(projectSlug: string): Promise<{
    patternId: FeedPatternId
    label: string
    gridAligned: boolean
    ghostRoles: VisualMode[]
} | null> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const { loadConfig } = await import("@/instagram/configs")
        const config = await loadConfig(projectSlug)
        const patternId = config.feedPattern || "none"
        const def = getPatternDef(patternId)
        if (patternId === "none") return { patternId, label: def.label, gridAligned: def.gridAligned, ghostRoles: [] }

        const { countFeedPosts } = await import("@/instagram/service")
        const existing = await countFeedPosts(clientId)
        // Fill out the current row, then one full row beyond it.
        const upcoming = (3 - (existing % 3)) % 3 + 3
        return {
            patternId,
            label: def.label,
            gridAligned: def.gridAligned,
            ghostRoles: ghostRolesForPreview(patternId, existing, upcoming),
        }
    } catch {
        return null
    }
}

/** User threw the plan away ("Zahodit plán"). Status-scoped — never deletes a live campaign. */
export async function discardPlanDraft(
    projectSlug: string,
    draftId: string,
): Promise<{ success: boolean; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const { error } = await supabaseAdmin
            .from("ig_campaigns")
            .delete()
            .eq("id", draftId)
            .eq("client_id", clientId)
            .eq("status", "draft")
        if (error) throw new Error(error.message)
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err?.message || String(err) }
    }
}

/**
 * Live progress for a running generateContentPlan call — the UI polls this (~2s) with the
 * planRunId it generated, and shows the pipeline's stage messages (strategist / concepts /
 * judge / revision) instead of a mute spinner. Reads the ig_jobs breadcrumb row.
 */
export async function getPlanProgress(
    projectSlug: string,
    planRunId: string
): Promise<{ progress: number; message: string; status: string } | null> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const { data } = await supabaseAdmin
            .from("ig_jobs")
            .select("progress, agent_message, status")
            .eq("client_id", clientId)
            .eq("config->>kind", "content_plan")
            .eq("config->>runId", planRunId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        if (!data) return null
        return { progress: data.progress || 0, message: data.agent_message || "", status: data.status || "pending" }
    } catch {
        return null
    }
}

/**
 * AI-generate a prompt hint for a pillar category based on its label + pillar context.
 */
export async function generateCategoryPrompt(
    projectSlug: string,
    categoryLabel: string,
    pillarLabel: string,
    pillarDescription: string
): Promise<{ success: boolean; prompt?: string; error?: string }> {
    try {
        await requireProjectAccess(projectSlug)
        const { loadConfig } = await import("@/instagram/configs")
        const { generateText } = await import("@/instagram/gemini-client")
        const config = await loadConfig(projectSlug)

        const raw = await generateText(`Jsi content stratég pro značku "${config.name}" (${config.website}).

## KONTEXT
Pilíř: "${pillarLabel}" — ${pillarDescription}
Kategorie: "${categoryLabel}"

## ÚKOL
Napiš STRUČNÝ prompt hint (1-2 věty, česky) pro tuto kategorii.
Prompt hint říká AI generátoru obsahu JAKÝ typ příspěvků a Z JAKÉHO ÚHLU má pro tuto kategorii tvořit.

## PRAVIDLA
- Max 2 věty, konkrétní a akční
- Zaměř se na: jaká témata, jaký tón, jaké formáty fungují
- Piš česky
- Vrať POUZE text promptu, nic jiného

Příklad pro kategorii "Tipy" v pilíři "Edukace":
"Praktické tipy a návody krok za krokem. Používej čísla v hooku, konkrétní příklady a řešení reálných problémů zákazníků."`)

        return { success: true, prompt: raw.trim().replace(/^["']|["']$/g, "") }
    } catch (err: any) {
        return { success: false, error: err?.message || String(err) }
    }
}

export async function regeneratePlanItem(
    projectSlug: string,
    postType: string,
    existingHooks: string[],
    userTopic?: string,
    medium?: "image" | "carousel" | "reel"
): Promise<{ success: boolean; item?: { hookPreview: string; angle: string; topic: string }; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const { loadConfig } = await import("@/instagram/configs")
        const { getPillarForType, getCatalogProducts } = await import("@/instagram/service")
        const config = await loadConfig(projectSlug)

        // Build pillar context for this post type
        const pillar = getPillarForType(config, postType)
        const pillarCfg = config.contentPillars[pillar]
        const pillarSection = pillarCfg
            ? `## PILÍŘ: ${pillarCfg.emoji} ${pillarCfg.label}\n${pillarCfg.description || ""}\nCíl: ${pillarCfg.ctaStrategy === "hard" ? "PRODEJ" : pillarCfg.ctaStrategy === "medium" ? "HODNOTA" : pillarCfg.ctaStrategy === "soft" ? "DOSAH" : "KOMUNITA"}\n`
            : ""

        // Live catalog, not the frozen config.products snapshot (see generateContentPlan)
        const catalogProducts = await getCatalogProducts(clientId, config.products).catch(() => config.products || [])
        const productsSection = catalogProducts.length
            ? `## PRODUKTY (${catalogProducts.length})\n${catalogProducts.slice(0, 6).map(p => `- ${p.name} (${p.type})${p.price ? ` — ${p.price}` : ""}`).join("\n")}\n`
            : ""

        const prompt = `Jsi content stratég pro "${config.name}" (${config.website}).

## BRAND PERSONA
${config.brandVoice.persona || ""}

## VOICE TRAITS
${config.brandVoice.voiceTraits?.map((t: string) => `- ${t}`).join("\n") || ""}

## ZAKÁZÁNO
${config.brandVoice.antiPatterns?.slice(0, 5).map((p: string) => `- ${p}`).join("\n") || ""}

${productsSection}
${pillarSection}
## ÚKOL
Vygeneruj JEDEN nový koncept pro post typu "${postType}".
${userTopic ? `Téma kampaně: "${userTopic}" — hook MUSÍ souviset s tímto tématem.` : ""}
${medium ? `\n## FORMÁT POSTU: ${medium === "carousel" ? "KARUSEL (statické obrázky/slidy — ŽÁDNÉ video)" : medium === "reel" ? "REEL (krátké video)" : "JEDEN STATICKÝ OBRÁZEK (ŽÁDNÉ video)"}\n` : ""}

## NESMÍŠ OPAKOVAT tyto hooky:
${existingHooks.map(h => `- "${h}"`).join("\n")}

## PRAVIDLA:
- Hook musí zastavit scrollování — provokativní, překvapivý, specifický pro "${config.name}"
- ŽÁDNÉ emoji v hooku
- Hook max 12 slov, česky
- Angle musí být konkrétní — ne "zajímavý pohled" ale "srovnání cen s konkurencí"
- Topic: 3-5 slov shrnující o čem post bude
${medium && medium !== "reel" ? `- ⚠️ Tohle je ${medium === "carousel" ? "KARUSEL" : "JEDEN OBRÁZEK"} — hook ani angle NESMÍ slibovat "video", "Reel", "scénář" ani "za 60 sekund ti ukážu". Mluv o tom, co bude na obrázcích.` : ""}

Vrať POUZE validní JSON:
{ "hookPreview": "český hook max 12 slov BEZ emoji", "angle": "1 věta o přístupu", "topic": "3-5 slov" }`

        // Single-item regen goes through the same Pro ladder as the plan itself —
        // a regenerated hook must not be weaker than the plan it replaces an item of.
        const { generateTextQuality } = await import("@/instagram/gemini-client")
        const { plannerModels } = await import("@/instagram/plan-pipeline")
        const { getTemperature } = await import("@/instagram/models")
        const raw = await generateTextQuality(prompt, {
            models: plannerModels(),
            label: "plan-regen-item",
            temperature: getTemperature("copywriter"),
        })
        const jsonMatch = raw.match(/\{[\s\S]*\}/)
        if (!jsonMatch) throw new Error("Invalid JSON response")
        const item = JSON.parse(jsonMatch[0])

        return { success: true, item }
    } catch (err: any) {
        return { success: false, error: err?.message || String(err) }
    }
}

