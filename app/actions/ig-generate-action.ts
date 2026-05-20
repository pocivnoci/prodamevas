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
import { loadConfig, resolveClientId } from "@/instagram/configs"
import { requireAuth } from "@/lib/auth-guard"



export interface GenerateResult {
    success: boolean
    postId?: string
    caption?: string
    imageUrl?: string
    error?: string
    retryCount?: number
}

import { withRetry } from "@/utils/retry"
import { creditGuard } from "./credit-guard"

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
        // Credit check: 1 credit per post
        if (options.projectId && !options.dryRun) {
            const guard = await creditGuard(options.projectId, "post")
            if (!guard.ok) {
                return { success: false, generated: 0, errors: 0, message: guard.error || "Nedostatek kreditů" }
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

        // Deduct credits for each generated post
        if (options.projectId && !options.dryRun) {
            for (let i = 0; i < options.count; i++) {
                const guard = await creditGuard(options.projectId, "post")
                await guard.commit(`Post batch ${i + 1}/${options.count}`)
            }
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
        await requireAuth()
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(data.projectId)

        const { error } = await supabaseAdmin.from("ig_post_ideas").insert({
            title: data.title,
            content: data.content,
            category: data.category,
            subcategory: data.subcategory || null,
            times_used: 0,
            client_id: clientId,
        })
        if (error) throw error
        return { success: true }
    } catch (err: any) {
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
        await requireAuth()
        const { resolveClientId } = await import("@/instagram/configs")
        const clientId = await resolveClientId(data.projectId)

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
    projectId?: string
}): Promise<{ success: boolean; generatedCount: number; error?: string }> {
    try {
        await requireAuth()
        // Credit check
        if (options.projectId) {
            const guard = await creditGuard(options.projectId, "idea_generate")
            if (!guard.ok) return { success: false, generatedCount: 0, error: guard.error }
        }

        const { loadConfig } = await import("@/instagram/configs")
        const { generateAIIdeas } = await import("@/instagram/idea-generator")

        const config = await loadConfig(options.configName)
        const result = await generateAIIdeas(config, options.pillarId, options.count || 10)

        // Deduct credits after success
        if (options.projectId) {
            const guard = await creditGuard(options.projectId, "idea_generate")
            await guard.commit(`Nápady: ${options.pillarId}`)
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
        await requireAuth()
        const config = await loadConfig(options.configName)
        const clientId = await resolveClientId(options.configName)
        setActiveProject(clientId)

        // 1. Gemini generates a promo caption
        console.log(`📝 Generuji promo caption pro "${options.ideaName}"...`)
        const { generateText } = await import("@/instagram/gemini-client")

        const captionPrompt = `Jsi copywriter pro značku ${config.name} (${config.website}).
Napiš prodejní Instagram caption pro NOVÝ PRODUKT.

PRODUKT:
- Název: ${options.ideaName}
- Typ: ${options.ideaType}
- Tagline: "${options.ideaTagline}"
- Popis: ${options.ideaDescription}
${options.ideaPriceRange ? `- Cena: ${options.ideaPriceRange}` : ""}

BRAND VOICE:
${config.brandVoice.persona}

PRAVIDLA:
- Hook (první řádek) musí okamžitě zaujmout — max 10 slov
- Body: 2-3 řádky popisující produkt, proč je unikátní
- CTA: odkaz na eshop nebo "link v biu"
- Max 5 hashtagů relevantních pro produkt
- Piš ${config.brandVoice.voiceTraits?.slice(0, 3).join(", ") || "autenticky a přirozeně"}
- ŽÁDNÉ emoji spam, max 3 emoji celkem

Odpověz POUZE v tomto JSON formátu:
{
  "hook": "první řádek - zaujme",
  "body": "2-3 řádky o produktu",
  "cta": "call to action",
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
