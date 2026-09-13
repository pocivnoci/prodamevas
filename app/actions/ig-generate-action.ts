"use server"

/**
 * Server action wrapper for the Instagram Autopilot engine.
 * Bridges the admin UI → autopilot.ts → Gemini 3.5 Flash + Nano Banana Pro.
 *
 * Auto-heal: wraps every call in try/catch with retry logic.
 * All errors are caught and returned as { success: false, error: "..." }
 * so the UI never crashes.
 */

import { generateOnePost, generateBatch } from "@/instagram/autopilot"
import supabaseAdmin from "@/supabase/admin"
import { loadConfig } from "@/instagram/configs"
import { requireAuth, requireProjectAccess } from "@/lib/auth-guard"
import { actionTranslator } from "@/lib/i18n/actions"
import { MAX_POSTS_PER_WEEK, monthSpanDays, postsForSpan } from "@/lib/schedule-planner"



export interface GenerateResult {
    /** Médium, které skutečně vzniklo (`ig_jobs.result.mediaType`) — UI podle něj
     *  vykreslí story jako story; heuristika „víc URL = karusel" to nepozná. */
    mediaType?: string | null
    success: boolean
    postId?: string
    caption?: string
    imageUrl?: string
    error?: string
    retryCount?: number
}

import { withRetry } from "@/utils/retry"
import { creditGuard, creditGuardBatch } from "./credit-guard"

// ============================================
// SINGLE POST GENERATION
// ============================================



// ============================================
// BATCH GENERATION
// ============================================

export async function triggerBatchGeneration(options: {
    configName?: string
    count: number
    dryRun: boolean
    topic?: string
    category?: string
    projectId?: string
}): Promise<{
    success: boolean
    generated: number
    errors: number
    message: string
}> {
    const t = await actionTranslator("actionsContent")
    try {
        // Tenant PRÁCE a tenant ÚČTU je jeden a tentýž. Dřív šla práce podle
        // `configName` a účet podle `projectId` — dva nezávislé vstupy z prohlížeče,
        // takže se dalo generovat do cizí značky a zaplatit (nebo nezaplatit) za
        // vlastní. Brána běží nad slugem, který skutečně řídí generování.
        const slug = options.configName || options.projectId
        if (!slug) return { success: false, generated: 0, errors: 0, message: t("generate.batch.missingProject") }
        if (options.projectId && options.projectId !== slug) {
            return { success: false, generated: 0, errors: 0, message: t("generate.tenantMismatch") }
        }
        await requireProjectAccess(slug)
        // Upfront credit check for entire batch — vždy, ne jen když někdo poslal projectId.
        let batchGuard: Awaited<ReturnType<typeof creditGuardBatch>> | null = null
        if (!options.dryRun) {
            batchGuard = await creditGuardBatch(slug, "post", options.count)
            if (!batchGuard.ok) {
                return { success: false, generated: 0, errors: 0, message: batchGuard.error || t("generate.batch.noCredits") }
            }
        }

        await withRetry(
            () => generateBatch({
                configName: slug,
                count: options.count,
                dryRun: options.dryRun,
                topic: options.topic || undefined,
            }),
            1,
            "Batch generation"
        )

        // Deduct credits for all posts (generateBatch throws on total failure)
        if (batchGuard && !options.dryRun) {
            await batchGuard.commitCount(options.count, `Batch: ${options.count} postů`) // i18n-ignore: popis v deníku kreditů (záznam, ne UI)
        }

        return {
            success: true,
            generated: options.count,
            errors: 0,
            message: t("generate.batch.done", { count: options.count }),
        }
    } catch (err: any) {
        const errorMessage = err?.message || String(err) || t("common.unknownError")
        console.error("IG batch generation error:", errorMessage)
        return {
            success: false,
            generated: 0,
            errors: options.count,
            message: errorMessage.substring(0, 500),
        }
    }
}

// ============================================
// IDEAS & REVIEWS
// ============================================

export async function addNewIdea(data: {
    title: string
    content: string
    category: string
    subcategory?: string
    projectId: string
}): Promise<{ success: boolean; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(data.projectId)

        const { error } = await supabaseAdmin.from("ig_post_ideas").insert({
            title: data.title,
            content: data.content,
            category: data.category,
            subcategory: data.subcategory || null,
            is_active: true,
            cooldown_days: 60,
            client_id: clientId,
        })
        if (error) throw error
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err?.message || String(err) }
    }
}

export async function deleteIdea(
    ideaId: string,
    projectId: string
): Promise<{ success: boolean; error?: string }> {
    const t = await actionTranslator("actionsContent")
    try {
        const { clientId } = await requireProjectAccess(projectId)

        const { data: idea } = await supabaseAdmin
            .from("ig_post_ideas")
            .select("client_id")
            .eq("id", ideaId)
            .single()

        if (!idea || idea.client_id !== clientId) {
            return { success: false, error: t("generate.ideas.notFound") }
        }

        const { error } = await supabaseAdmin
            .from("ig_post_ideas")
            .delete()
            .eq("id", ideaId)
        if (error) throw error
        return { success: true }
    } catch (err: any) {
        console.error("deleteIdea error:", err?.message || err)
        return { success: false, error: err?.message || String(err) }
    }
}

export async function setIdeaActive(
    ideaId: string,
    projectId: string,
    isActive: boolean
): Promise<{ success: boolean; error?: string }> {
    const t = await actionTranslator("actionsContent")
    try {
        const { clientId } = await requireProjectAccess(projectId)

        const { data: idea } = await supabaseAdmin
            .from("ig_post_ideas")
            .select("client_id")
            .eq("id", ideaId)
            .single()

        if (!idea || idea.client_id !== clientId) {
            return { success: false, error: t("generate.ideas.notFound") }
        }

        const { error } = await supabaseAdmin
            .from("ig_post_ideas")
            .update({ is_active: isActive })
            .eq("id", ideaId)
        if (error) throw error
        return { success: true }
    } catch (err: any) {
        console.error("setIdeaActive error:", err?.message || err)
        return { success: false, error: err?.message || String(err) }
    }
}

export async function addNewReview(data: {
    quote: string
    customer_initials?: string
    rating?: number
    projectId: string
}): Promise<{ success: boolean; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(data.projectId)

        const { error } = await supabaseAdmin.from("ig_reviews").insert({
            quote: data.quote,
            customer_initials: data.customer_initials || null,
            rating: data.rating || 5,
            is_approved: true,
            client_id: clientId,
        })
        if (error) throw error
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err?.message || String(err) }
    }
}

// ============================================
// AI IDEA GENERATOR
// ============================================

export async function triggerAIIdeasGeneration(options: {
    configName: string
    pillarId: string
    count?: number
    categoryId?: string
    projectId?: string
}): Promise<{ success: boolean; generatedCount: number; error?: string }> {
    const t = await actionTranslator("actionsContent")
    try {
        // Brána nad slugem, podle kterého se generuje; `projectId` (účet) smí být jen
        // tentýž projekt — jinak jde práce do jedné značky a účet druhé.
        if (options.projectId && options.projectId !== options.configName) {
            return { success: false, generatedCount: 0, error: t("generate.tenantMismatch") }
        }
        await requireProjectAccess(options.configName)
        // Credit check + commit with single guard instance
        let guard: Awaited<ReturnType<typeof creditGuard>> | null = null
        if (options.projectId) {
            guard = await creditGuard(options.projectId, "idea_generate")
            if (!guard.ok) return { success: false, generatedCount: 0, error: guard.error }
        }

        const { loadConfig } = await import("@/instagram/configs")
        const { generateAIIdeas } = await import("@/instagram/idea-generator")

        const config = await loadConfig(options.configName)
        const result = await generateAIIdeas(config, options.pillarId, options.count || 10, options.categoryId)

        // Deduct credits after success — same guard instance, no redundant DB call
        if (guard) {
            const catLabel = options.categoryId ? ` → ${options.categoryId}` : ""
            await guard.commit(`Nápady: ${options.pillarId}${catLabel}`) // i18n-ignore: popis v deníku kreditů (záznam, ne UI)
        }

        return {
            success: true,
            generatedCount: result?.length || 0,
        }
    } catch (err: any) {
        const errorMessage = err?.message || String(err) || t("common.unknownError")
        console.error("AI Idea generation error:", errorMessage)
        return { success: false, generatedCount: 0, error: errorMessage.substring(0, 500) }
    }
}

// ============================================
// IDEA BANK SEEDING (onboarding)
// ============================================

/**
 * Seed a fresh client's idea bank (Zásobník témat) from their 2 highest-ratio pillars.
 * Called once from onboarding (between showcase posts and the first content plan) so the
 * very first plan can already draw from the bank. Free — an onboarding gift, no creditGuard.
 * Never throws; every failure is non-fatal.
 */
export async function seedIdeaBank(projectSlug: string): Promise<{ success: boolean; seeded: number }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const config = await loadConfig(projectSlug)
        const { withActiveProject } = await import("@/instagram/service")
        const { generateAIIdeas } = await import("@/instagram/idea-generator")

        const topPillars = Object.entries(config.contentPillars || {})
            .sort((a, b) => (b[1]?.ratio || 0) - (a[1]?.ratio || 0))
            .slice(0, 2)
            .map(([id]) => id)

        let seeded = 0
        for (const pillarId of topPillars) {
            try {
                // withActiveProject lets getBrandMemories() inside the generator see the
                // memories onboarding just seeded (instead of silently skipping them).
                const rows = await withActiveProject(clientId, () => generateAIIdeas(config, pillarId, 6))
                seeded += rows?.length || 0
            } catch (e: any) {
                console.warn(`seedIdeaBank: pillar ${pillarId} failed: ${e?.message?.substring(0, 120)}`)
            }
        }
        console.log(`💡 seedIdeaBank: ${seeded} nápadů pro ${projectSlug} (${topPillars.join(", ")})`)
        return { success: seeded > 0, seeded }
    } catch (err: any) {
        console.warn("seedIdeaBank error:", err?.message || err)
        return { success: false, seeded: 0 }
    }
}

// ============================================
// AI REVIEW GENERATOR
// ============================================

export async function triggerAIReviewsGeneration(options: {
    configName: string
    count?: number
}): Promise<{ success: boolean; generatedCount: number; error?: string }> {
    const t = await actionTranslator("actionsContent")
    try {
        // Recenze se zapisují do ig_reviews tenanta z configName a engine z nich pak
        // píše posty — pouhé přihlášení nesmí stačit k zápisu do cizí značky.
        await requireProjectAccess(options.configName)
        const { loadConfig } = await import("@/instagram/configs")
        const { generateAIReviews } = await import("@/instagram/review-generator")

        const config = await loadConfig(options.configName)
        const result = await generateAIReviews(config, options.count || 5)

        return {
            success: true,
            generatedCount: result?.length || 0,
        }
    } catch (err: any) {
        const errorMessage = err?.message || String(err) || t("common.unknownError")
        console.error("AI Review generation error:", errorMessage)
        return { success: false, generatedCount: 0, error: errorMessage.substring(0, 500) }
    }
}

// ============================================
// CREATE PROMO POST FROM PRODUCT IDEA
// ============================================

import { createPost, setActiveProject } from "@/instagram/service"
import { contentLanguage, writeRuleCs } from "@/instagram/language"

interface PromoPostOptions {
    configName: string
    ideaName: string
    ideaTagline: string
    ideaDescription: string
    ideaType: string
    ideaPriceRange?: string
    designUrl: string
}

/**
 * Promo post si píše caption sám, mimo `generateOnePost` — tedy i mimo měřič, který
 * plní `ig_generation_log`. Bez tohohle obalu by to byl příspěvek, co nikde nestojí nic.
 */
export async function createPromoPost(
    options: PromoPostOptions,
): Promise<{ success: boolean; postId?: string; caption?: string; error?: string }> {
    const { trackSpend, spendClientId } = await import("@/instagram/spend-tracker")
    return trackSpend(
        "other",
        { clientId: await spendClientId(options.configName), refId: `promo:${options.ideaName}` },
        () => createPromoPostInner(options),
    )
}

async function createPromoPostInner(
    options: PromoPostOptions,
): Promise<{ success: boolean; postId?: string; caption?: string; error?: string }> {
    const t = await actionTranslator("actionsContent")
    try {
        const { clientId } = await requireProjectAccess(options.configName)
        const config = await loadConfig(options.configName)
        setActiveProject(clientId)

        // 1. Gemini generates a promo caption
        console.log(`📝 Generuji promo caption pro "${options.ideaName}"...`)
        const { generateText } = await import("@/instagram/gemini-client")

        // i18n-ignore-start: prompt pro model — jazyk výstupu řídí contentLanguage(config)
        const captionPrompt = `Jsi senior copywriter pro značku "${config.name}" (${config.website}).
Napiš prodejní Instagram caption pro NOVÝ PRODUKT.

## PRODUKT:
- Název: ${options.ideaName}
- Typ: ${options.ideaType}
- Tagline: "${options.ideaTagline}"
- Popis: ${options.ideaDescription}
${options.ideaPriceRange ? `- Cena: ${options.ideaPriceRange}` : ""}

## BRAND VOICE:
${config.brandVoice.persona}
Tón: ${config.brandVoice.voiceTraits?.slice(0, 4).join(", ") || "autenticky"}

## ZAKÁZÁNO:
${config.brandVoice.antiPatterns?.slice(0, 5).map((p: string) => `- ${p}`).join("\n") || "- Generické fráze"}

## PRAVIDLA:
- Hook (první řádek) musí okamžitě zaujmout — max 10 slov, BEZ emoji
- Body: 2-3 řádky popisující produkt, proč je unikátní, co zákazník získá
- CTA: musí obsahovat ${config.website} — buď přímý odkaz nebo "🔗 ${config.website}"
- ${writeRuleCs(contentLanguage(config))} Tón: ${config.brandVoice.voiceTraits?.slice(0, 3).join(", ") || "autenticky a přirozeně"}
- MAX 3 emoji v celém textu
- NIKDY nepřekládej název produktu — ponech ho v originále

${config.hashtagPools ? `## HASHTAG POOLS (vyber z těchto + přidej product-specific):
- Core: ${config.hashtagPools.core?.slice(0, 5).join(", ") || ""}
- Niche: ${config.hashtagPools.niche?.slice(0, 5).join(", ") || ""}
Použij 5-8 hashtagů: mix core + niche + 1-2 specifické pro tento produkt.` : "Max 5-8 relevantních hashtagů."}

## VÝSTUP — vrať POUZE validní JSON:
{
  "hook": "první řádek - zaujme, max 10 slov",
  "body": "2-3 řádky o produktu",
  "cta": "call to action s odkazem na ${config.website}",
  "hashtags": ["#tag1", "#tag2", "#tag3"]
}`
        // i18n-ignore-end

        const rawText = await generateText(captionPrompt)

        let captionData: { hook: string; body: string; cta: string; hashtags: string[] }
        try {
            const jsonMatch = rawText.match(/\{[\s\S]*\}/)
            captionData = JSON.parse(jsonMatch?.[0] || rawText)
        } catch {
            captionData = {
                hook: `🔥 ${options.ideaName}`,
                body: options.ideaDescription,
                cta: `Koukni na ${config.website}`,
                hashtags: [`#${config.id}`, "#newdrop", "#merch"]
            }
        }

        const fullCaption = `${captionData.hook}\n\n${captionData.body}\n\n${captionData.cta}\n\n${captionData.hashtags.join(" ")}`

        // 2. Create Draft post in ig_posts
        console.log("💾 Ukládám jako Draft post...")
        const post = await createPost({
            caption: fullCaption,
            hashtags: captionData.hashtags,
            call_to_action: captionData.cta,
            image_url: options.designUrl,
            image_style: "product-promo",
            status: "draft",
        })

        console.log(`   ✅ Post ${post.id} vytvořen jako Draft`)

        return {
            success: true,
            postId: post.id,
            caption: fullCaption,
        }
    } catch (err: any) {
        console.error("createPromoPost error:", err)
        return { success: false, error: err.message || t("generate.promo.failed") }
    }
}

// ============================================
// UPLOAD CUSTOM IMAGE (For Manual Image Override)
// ============================================

export async function uploadCustomImage(
    projectId: string,
    formData: FormData
): Promise<{ success: boolean; publicUrl?: string; error?: string }> {
    const t = await actionTranslator("actionsContent")
    try {
        // Vlastnictví projektu + omezení obsahu: bucket je veřejný a sdílený, takže
        // bez allow-listu by sem kdokoli přihlášený uložil libovolný soubor (i HTML)
        // pod naší doménou na rok do cache. Stejné typy a strop jako klientské buckety.
        await requireProjectAccess(projectId)
        const file = formData.get("file") as File
        if (!file) return { success: false, error: t("common.noFile") }
        const { CLIENT_BUCKET_MIME_TYPES, CLIENT_BUCKET_SIZE_LIMIT } = await import("@/lib/storage-buckets")
        if (!file.type.startsWith("image/") || !CLIENT_BUCKET_MIME_TYPES.includes(file.type)) {
            return { success: false, error: t("generate.upload.imagesOnly") }
        }
        if (file.size > CLIENT_BUCKET_SIZE_LIMIT) {
            return { success: false, error: t("generate.upload.tooLarge") }
        }

        const fileName = `${projectId}_custom_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`
        const arrayBuffer = await file.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        const { error } = await supabaseAdmin.storage
            .from("audit-screenshots") // Using same public bucket as others
            .upload(`custom-uploads/${fileName}`, buffer, {
                cacheControl: "31536000",
                upsert: false,
                contentType: file.type,
            })

        if (error) throw error

        const { data: publicUrlData } = supabaseAdmin.storage
            .from("audit-screenshots")
            .getPublicUrl(`custom-uploads/${fileName}`)

        return { success: true, publicUrl: publicUrlData.publicUrl }
    } catch (err: any) {
        console.error("uploadCustomImage error:", err)
        return { success: false, error: err.message || t("common.uploadFailed") }
    }
}

// ============================================
// MONTHLY PLAN GENERATION (v2 credit model)
// ============================================

// Template captions for locked posts — visible only through 3px blur, so content doesn't matter.
// Just needs to look like real text at a glance.
// i18n-ignore-start: atrapy captionů zamčeného plánu — rozmazaný obsah, ne UI
const PLACEHOLDER_HOOKS = [
    "Tohle vám nikdo neřekne o vašem podnikání",
    "3 věci které děláte špatně na Instagramu",
    "Proč vaši zákazníci odcházejí ke konkurenci",
    "Největší chyba kterou podnikatelé dělají",
    "Tenhle trik změní váš marketing navždy",
    "Co jsme se naučili za poslední měsíc",
    "Zákulisí naší firmy — bez filtrů",
    "Recenze od zákazníka co nás dostala",
    "5 tipů jak zvýšit engagement o 200%",
    "Tohle jsme zkusili a funguje to",
    "Nový produkt který musíte vidět",
    "Jak jsme vyřešili největší problém",
    "Tajný recept na úspěch v online světě",
    "Za oponou — jak vzniká náš obsah",
    "Výsledky které mluví za vše",
    "Co nám řekli zákazníci nás překvapilo",
    "Trend kterému se nevyhnete v roce 2025",
    "Meme který vás bude bavit celý den",
    "Produkt na který se nás ptáte nejvíc",
    "Příběh jednoho zákazníka — inspirace",
    "Proč bychom to udělali znovu jinak",
    "Věc kterou byste měli změnit hned teď",
    "Behind the scenes — jak to doopravdy vypadá",
    "Tip od profíka co vám ušetří hodiny",
    "Otázka na kterou odpovídáme nejčastěji",
    "Novinka v nabídce — první pohled",
    "Tohle jsme nečekali — příběh z praxe",
]
// i18n-ignore-end

/**
 * Kolik příspěvků měsíce vznikne doopravdy v ukázkové kampani z onboardingu
 * (`startOnboardingBootstrap`: `plan: [{}, {}, {}]`, `total: 3`) — o tolik míň
 * atrap tady, jinak by plán ukazoval o tři příspěvky víc, než klient dostane.
 */
const SHOWCASE_POSTS = 3

/**
 * Vyplní zbytek měsíčního plánu atrapami `plan_locked` z configu — ZERO AI cost.
 * Uses client's post types + pillars to look realistic when blurred.
 *
 * Počet drží kalendář, ne konstanta: `postsForSpan(monthSpanDays(now), perWeek)`
 * minus ukázkové příspěvky. Natvrdo 27 platilo jen pro 4 týdny × 7 postů, takže
 * v 31denním měsíci i při jiné než sedmidenní kadenci počítadlo lhalo.
 * The showcase posts run separately as the durable showcase campaign
 * (startOnboardingBootstrap → campaign-worker), not from here.
 */
export async function generateMonthlyPlan(options: {
    configName: string
    projectId: string
}): Promise<{ success: boolean; postsCreated: number; error?: string }> {
    const t = await actionTranslator("actionsContent")
    try {
        const { clientId } = await requireProjectAccess(options.configName)
        const config = await loadConfig(options.configName)

        // Check if plan was already generated this month
        const { data: sub } = await supabaseAdmin
            .from("subscriptions")
            .select("id, plan_generated_at, credit_period_start")
            .eq("client_id", clientId)
            .in("status", ["active", "trialing"])
            .order("created_at", { ascending: false })
            .limit(1)
            .single()

        const now = new Date()
        if (sub?.plan_generated_at) {
            const lastGen = new Date(sub.plan_generated_at)
            // Jeden plán na jedno KREDITOVÉ okno — to je ta hranice, po které
            // klient dostane nový příděl kreditů (`lib/billing-period.ts`).
            // Natvrdo „25 dní" pustilo v 31denním měsíci druhý plán o šest dní
            // dřív, než se kredity obnovily. Bez okna (starý řádek, žádné
            // předplatné) rozhodne skutečná délka měsíce, ne paušálních 25 dní.
            const windowStart = sub.credit_period_start ? new Date(sub.credit_period_start) : null
            const alreadyThisPeriod = windowStart && !Number.isNaN(windowStart.getTime())
                ? lastGen >= windowStart
                : (now.getTime() - lastGen.getTime()) / 86_400_000 < monthSpanDays(lastGen)
            if (alreadyThisPeriod) {
                return { success: false, postsCreated: 0, error: t("generate.monthlyPlan.alreadyGenerated") }
            }
        }

        // Build template posts from config — no AI needed
        const weekPlan = config.weekPlan || ["tip", "meme", "carousel", "product", "behind_scenes", "tip", "meme"]
        const pillarKeys = Object.keys(config.contentPillars || {})

        // Resolve post types to get type IDs
        const { data: postTypes } = await supabaseAdmin
            .from("ig_post_types")
            .select("id, name")
            .eq("client_id", clientId)

        const typeMap = new Map((postTypes || []).map(t => [t.name, t.id]))

        // Kolik atrap měsíc unese: kalendářní délka měsíce × kadence značky,
        // minus příspěvky, které pro klienta vzniknou doopravdy.
        const perWeek = Math.min(MAX_POSTS_PER_WEEK, Math.max(1, Math.round(Number(config.postsPerWeek) || 4)))
        const teaserCount = Math.max(0, postsForSpan(monthSpanDays(now), perWeek) - SHOWCASE_POSTS)
        if (teaserCount === 0) {
            // Kadence 1×/týdně na krátký měsíc: ukázkové příspěvky pokryjí celý
            // plán samy a insert prázdného pole by jen zbytečně sáhl do DB.
            return { success: true, postsCreated: 0 }
        }

        // Generate template rows — cycle through week plan and pillars
        const insertRows = Array.from({ length: teaserCount }, (_, i) => {
            const postTypeName = weekPlan[i % weekPlan.length]
            const pillar = pillarKeys[i % pillarKeys.length] || "reach"
            const hook = PLACEHOLDER_HOOKS[i % PLACEHOLDER_HOOKS.length]
            const fakeBody = `Inspirujte se naším obsahem a posuňte svou značku na novou úroveň. Více na ${config.website}` // i18n-ignore: atrapa captionu zamčeného plánu

            return {
                client_id: clientId,
                caption: `${hook}\n\n${fakeBody}\n\n👉 ${config.website}`,
                hashtags: null,
                call_to_action: `👉 ${config.website}`,
                image_url: null,
                image_prompt: null,
                status: "plan_locked",
                content_pillar: pillar,
                post_type_id: typeMap.get(postTypeName) || null,
            }
        })

        const { error: insertError } = await supabaseAdmin
            .from("ig_posts")
            .insert(insertRows)

        if (insertError) throw new Error(t("generate.monthlyPlan.insertFailed", { detail: insertError.message }))

        // Update subscription: mark plan as generated
        if (sub) {
            await supabaseAdmin
                .from("subscriptions")
                .update({
                    plan_generated_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .eq("id", sub.id)
        }

        console.log(`✅ Monthly plan generated: ${insertRows.length} locked posts (zero AI cost)`)

        return { success: true, postsCreated: insertRows.length }
    } catch (err: any) {
        console.error("generateMonthlyPlan error:", err?.message || err)
        return { success: false, postsCreated: 0, error: (err?.message || String(err)).substring(0, 500) }
    }
}
