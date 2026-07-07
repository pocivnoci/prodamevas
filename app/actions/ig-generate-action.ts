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



export interface GenerateResult {
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
    try {
        await requireAuth()
        // Upfront credit check for entire batch
        let batchGuard: Awaited<ReturnType<typeof creditGuardBatch>> | null = null
        if (options.projectId && !options.dryRun) {
            batchGuard = await creditGuardBatch(options.projectId, "post", options.count)
            if (!batchGuard.ok) {
                return { success: false, generated: 0, errors: 0, message: batchGuard.error || "Nedostatek kreditů" }
            }
        }

        await withRetry(
            () => generateBatch({
                configName: options.configName,
                count: options.count,
                dryRun: options.dryRun,
                topic: options.topic || undefined,
            }),
            1,
            "Batch generation"
        )

        // Deduct credits for all posts (generateBatch throws on total failure)
        if (batchGuard && !options.dryRun) {
            await batchGuard.commitCount(options.count, `Batch: ${options.count} postů`)
        }

        return {
            success: true,
            generated: options.count,
            errors: 0,
            message: `Batch generování ${options.count} postů dokončeno`,
        }
    } catch (err: any) {
        const errorMessage = err?.message || String(err) || "Unknown error"
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
    try {
        const { clientId } = await requireProjectAccess(projectId)

        const { data: idea } = await supabaseAdmin
            .from("ig_post_ideas")
            .select("client_id")
            .eq("id", ideaId)
            .single()

        if (!idea || idea.client_id !== clientId) {
            return { success: false, error: "Nápad nenalezen" }
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
    try {
        const { clientId } = await requireProjectAccess(projectId)

        const { data: idea } = await supabaseAdmin
            .from("ig_post_ideas")
            .select("client_id")
            .eq("id", ideaId)
            .single()

        if (!idea || idea.client_id !== clientId) {
            return { success: false, error: "Nápad nenalezen" }
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
    try {
        await requireAuth()
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
            await guard.commit(`Nápady: ${options.pillarId}${catLabel}`)
        }

        return {
            success: true,
            generatedCount: result?.length || 0,
        }
    } catch (err: any) {
        const errorMessage = err?.message || String(err) || "Unknown error"
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
    try {
        await requireAuth()
        const { loadConfig } = await import("@/instagram/configs")
        const { generateAIReviews } = await import("@/instagram/review-generator")

        const config = await loadConfig(options.configName)
        const result = await generateAIReviews(config, options.count || 5)

        return {
            success: true,
            generatedCount: result?.length || 0,
        }
    } catch (err: any) {
        const errorMessage = err?.message || String(err) || "Unknown error"
        console.error("AI Review generation error:", errorMessage)
        return { success: false, generatedCount: 0, error: errorMessage.substring(0, 500) }
    }
}

// ============================================
// CREATE PROMO POST FROM PRODUCT IDEA
// ============================================

import { createPost, setActiveProject } from "@/instagram/service"

export async function createPromoPost(options: {
    configName: string
    ideaName: string
    ideaTagline: string
    ideaDescription: string
    ideaType: string
    ideaPriceRange?: string
    designUrl: string
}): Promise<{ success: boolean; postId?: string; caption?: string; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(options.configName)
        const config = await loadConfig(options.configName)
        setActiveProject(clientId)

        // 1. Gemini generates a promo caption
        console.log(`📝 Generuji promo caption pro "${options.ideaName}"...`)
        const { generateText } = await import("@/instagram/gemini-client")

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
- Piš ${config.brandVoice.voiceTraits?.slice(0, 3).join(", ") || "autenticky a přirozeně"}
- MAX 3 emoji v celém textu
- NIKDY nepřekládej název produktu do češtiny pokud je anglicky

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
        return { success: false, error: err.message || "Failed to create promo post" }
    }
}

// ============================================
// UPLOAD CUSTOM IMAGE (For Manual Image Override)
// ============================================

export async function uploadCustomImage(
    projectId: string,
    formData: FormData
): Promise<{ success: boolean; publicUrl?: string; error?: string }> {
    try {
        await requireAuth()
        const file = formData.get("file") as File
        if (!file) return { success: false, error: "No file provided" }

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
        return { success: false, error: err.message || "Upload failed" }
    }
}

// ============================================
// MONTHLY PLAN GENERATION (v2 credit model)
// ============================================

// Template captions for locked posts — visible only through 3px blur, so content doesn't matter.
// Just needs to look like real text at a glance.
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

/**
 * Create 27 fake plan_locked posts from config — ZERO AI cost.
 * Uses client's post types + pillars to look realistic when blurred.
 * The 3 showcase posts are generated separately via generateShowcasePost().
 */
export async function generateMonthlyPlan(options: {
    configName: string
    projectId: string
}): Promise<{ success: boolean; postsCreated: number; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(options.configName)
        const config = await loadConfig(options.configName)

        // Check if plan was already generated this month
        const { data: sub } = await supabaseAdmin
            .from("subscriptions")
            .select("id, plan_generated_at")
            .eq("client_id", clientId)
            .in("status", ["active", "trialing"])
            .order("created_at", { ascending: false })
            .limit(1)
            .single()

        if (sub?.plan_generated_at) {
            const lastGen = new Date(sub.plan_generated_at)
            const now = new Date()
            const daysSince = (now.getTime() - lastGen.getTime()) / (1000 * 60 * 60 * 24)
            if (daysSince < 25) {
                return { success: false, postsCreated: 0, error: "Měsíční plán už byl vygenerován." }
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

        // Generate 27 template rows — cycle through week plan and pillars
        const insertRows = Array.from({ length: 27 }, (_, i) => {
            const postTypeName = weekPlan[i % weekPlan.length]
            const pillar = pillarKeys[i % pillarKeys.length] || "reach"
            const hook = PLACEHOLDER_HOOKS[i % PLACEHOLDER_HOOKS.length]
            const fakeBody = `Inspirujte se naším obsahem a posuňte svou značku na novou úroveň. Více na ${config.website}`

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

        if (insertError) throw new Error(`Failed to insert plan posts: ${insertError.message}`)

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

// ============================================
// SHOWCASE POST (full autopilot — used after onboarding)
// ============================================

/**
 * Generate 1 full post via autopilot (caption + image + overlay).
 * Called 3 times from onboarding to create showcase posts. Posts stay in the
 * normal "draft" status so they enter the standard approval pipeline (the old
 * "plan_draft" status had no approve path, no filter chip, and wasn't counted
 * in dashboard stats — a brand-new account looked empty despite 3 real posts).
 * Each call is a separate server action to avoid timeout issues (~30-60s each).
 */
export async function generateShowcasePost(options: {
    configName: string
}): Promise<{ success: boolean; postId?: string; error?: string }> {
    try {
        // Membership check — must own the target client, not just be logged in.
        // (Without this, a stale/colliding slug wrote posts into another tenant.)
        await requireProjectAccess(options.configName)
        const { generateOnePost } = await import("@/instagram/autopilot")

        const result = await generateOnePost({ configName: options.configName })

        return { success: true, postId: result.id }
    } catch (err: any) {
        console.error("generateShowcasePost error:", err?.message || err)
        return { success: false, error: (err?.message || String(err)).substring(0, 300) }
    }
}
