"use server"

/**
 * Server action wrapper for the Instagram Autopilot engine.
 * Bridges the admin UI → autopilot.ts → Gemini 3 Pro + Imagen 4 Ultra.
 *
 * Auto-heal: wraps every call in try/catch with retry logic.
 * All errors are caught and returned as { success: false, error: "..." }
 * so the UI never crashes.
 */

import { generateOnePost, generateBatch } from "@/instagram/autopilot"
import supabaseAdmin from "@/supabase/admin"

export interface GenerateResult {
    success: boolean
    postId?: string
    caption?: string
    imageUrl?: string
    error?: string
    retryCount?: number
}

// ============================================
// RETRY WRAPPER — auto-heal on transient errors
// ============================================

async function withRetry<T>(
    fn: () => Promise<T>,
    maxRetries = 2,
    label = "operation"
): Promise<T> {
    const retryableErrors = [
        "503", "UNAVAILABLE", "overloaded", "high demand",
        "ECONNRESET", "ETIMEDOUT", "fetch failed",
        "socket hang up", "network",
    ]

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn()
        } catch (err: any) {
            const msg = String(err?.message || err)
            const isRetryable = retryableErrors.some(e => msg.toLowerCase().includes(e.toLowerCase()))

            if (!isRetryable || attempt >= maxRetries) {
                throw err
            }

            const delay = (attempt + 1) * 5000 // 5s, 10s
            console.log(`⏳ ${label}: retry ${attempt + 1}/${maxRetries} za ${delay / 1000}s (${msg.substring(0, 80)})...`)
            await new Promise(r => setTimeout(r, delay))
        }
    }

    throw new Error("withRetry: unreachable")
}

// ============================================
// SINGLE POST GENERATION
// ============================================

export async function triggerPostGeneration(options: {
    configName?: string
    type?: string
    topic?: string
    category?: string
    dryRun?: boolean
}): Promise<GenerateResult> {
    try {
        const result = await withRetry(
            () => generateOnePost({
                configName: options.configName,
                type: options.type || undefined,
                topic: options.topic || undefined,
                dryRun: options.dryRun,
            }),
            2,
            "Post generation"
        )

        return {
            success: true,
            postId: result.id,
            caption: result.caption,
            imageUrl: result.imageUrl,
        }
    } catch (err: any) {
        // Always return a clean serializable error — never crash the UI
        const errorMessage = err?.message || String(err) || "Unknown error"
        console.error("IG generation error:", errorMessage)
        return {
            success: false,
            error: errorMessage.substring(0, 500), // Truncate to avoid serialization issues
        }
    }
}

// ============================================
// BATCH GENERATION
// ============================================

export async function triggerBatchGeneration(options: {
    configName?: string
    count: number
    dryRun: boolean
    topic?: string
    category?: string
}): Promise<{
    success: boolean
    generated: number
    errors: number
    message: string
}> {
    try {
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
// PRODUCT GENERATOR — Ideas, Designs, Mockups
// ============================================

import {
    generateProductIdeas,
    generateDesignConcept,
    generateProductMockup,
    generateProductDesign,
    type ProductIdea,
    type DesignConcept,
} from "@/instagram/product-generator"
import { loadConfig } from "@/instagram/configs"

export { type ProductIdea, type DesignConcept }

export async function triggerProductIdeas(options: {
    configName: string
    count?: number
    theme?: string
}): Promise<{ success: boolean; ideas?: ProductIdea[]; error?: string }> {
    try {
        const config = await loadConfig(options.configName)
        const ideas = await withRetry(
            () => generateProductIdeas(config, options.count || 5, options.theme || undefined),
            1,
            "Product ideas"
        )

        return {
            success: true,
            ideas,
        }
    } catch (err: any) {
        const errorMessage = err?.message || String(err) || "Unknown error"
        console.error("Product ideas error:", errorMessage)
        return { success: false, error: errorMessage.substring(0, 500) }
    }
}

export async function triggerDesignGeneration(options: {
    configName: string
    theme: string
    productType?: string
}): Promise<{ success: boolean; concept?: DesignConcept; designUrl?: string; error?: string }> {
    try {
        const config = await loadConfig(options.configName)
        const result = await withRetry(
            () => generateDesignConcept(config, options.theme, options.productType || "triko"),
            1,
            "Design generation"
        )

        if (!result) {
            return { success: false, error: "Design generation returned null" }
        }

        return {
            success: true,
            concept: result.concept,
            designUrl: result.designUrl,
        }
    } catch (err: any) {
        const errorMessage = err?.message || String(err) || "Unknown error"
        console.error("Design generation error:", errorMessage)
        return { success: false, error: errorMessage.substring(0, 500) }
    }
}

// ============================================
// AI IDEA GENERATOR
// ============================================

export async function triggerAIIdeasGeneration(options: {
    configName: string
    pillarId: string
    count?: number
}): Promise<{ success: boolean; generatedCount: number; error?: string }> {
    try {
        const { loadConfig } = await import("@/instagram/configs")
        const { generateAIIdeas } = await import("@/instagram/idea-generator")

        const config = await loadConfig(options.configName)
        const result = await generateAIIdeas(config, options.pillarId, options.count || 10)

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

export async function triggerMockupGeneration(options: {
    configName: string
    designUrl: string
    productType?: string
    designDescription?: string
}): Promise<{ success: boolean; mockupUrl?: string; error?: string }> {
    try {
        const config = await loadConfig(options.configName)
        const result = await withRetry(
            () => generateProductMockup(
                config,
                options.designUrl,
                options.productType || "triko",
                options.designDescription
            ),
            1,
            "Mockup generation"
        )

        if (!result) {
            return { success: false, error: "Mockup generation returned null" }
        }

        return {
            success: true,
            mockupUrl: result.mockupUrl,
        }
    } catch (err: any) {
        const errorMessage = err?.message || String(err) || "Unknown error"
        console.error("Mockup generation error:", errorMessage)
        return { success: false, error: errorMessage.substring(0, 500) }
    }
}

export async function triggerProductDesign(options: {
    configName: string
    idea: ProductIdea
    referenceImageUrl?: string
}): Promise<{ success: boolean; designUrl?: string; error?: string }> {
    try {
        const config = await loadConfig(options.configName)
        const result = await withRetry(
            () => generateProductDesign(config, options.idea, options.referenceImageUrl),
            1,
            "Product design"
        )

        if (!result) {
            return { success: false, error: "Product design generation returned null" }
        }

        return {
            success: true,
            designUrl: result.designUrl,
        }
    } catch (err: any) {
        const errorMessage = err?.message || String(err) || "Unknown error"
        console.error("Product design error:", errorMessage)
        return { success: false, error: errorMessage.substring(0, 500) }
    }
}

// ============================================
// PRODUCT IDEAS DB MANAGEMENT
// ============================================

import { resolveClientId } from "@/instagram/configs"

export async function saveProductIdea(configName: string, idea: Omit<ProductIdea, "id" | "client_id" | "created_at">): Promise<{ success: boolean; error?: string }> {
    try {
        const clientId = await resolveClientId(configName)

        const { error } = await supabaseAdmin
            .from("ig_product_ideas")
            .insert({
                client_id: clientId,
                name: idea.name,
                brandingNames: idea.brandingNames, // array gets stringified to pg array natively if jsonb
                type: idea.type,
                tagline: idea.tagline,
                description: idea.description,
                material: idea.material,
                dimensions: idea.dimensions,
                manufacturing_method: idea.manufacturingMethod,
                price_range: idea.priceRange,
                viral_angle: idea.viralAngle,
                why_it_works: idea.whyItWorks,
                production_notes: idea.productionNotes,
                design_prompt: idea.designPrompt,
                status: "saved"
            })

        if (error) throw error

        return { success: true }
    } catch (err: any) {
        console.error("saveProductIdea error:", err)
        return { success: false, error: err.message || "Failed to save idea" }
    }
}

export async function rejectProductIdea(configName: string, idea: Omit<ProductIdea, "id" | "client_id" | "created_at">): Promise<{ success: boolean; error?: string }> {
    try {
        const clientId = await resolveClientId(configName)

        const { error } = await supabaseAdmin
            .from("ig_product_ideas")
            .insert({
                client_id: clientId,
                name: idea.name,
                brandingNames: idea.brandingNames,
                type: idea.type,
                tagline: idea.tagline,
                description: idea.description,
                material: idea.material,
                dimensions: idea.dimensions,
                manufacturing_method: idea.manufacturingMethod,
                price_range: idea.priceRange,
                viral_angle: idea.viralAngle,
                why_it_works: idea.whyItWorks,
                production_notes: idea.productionNotes,
                design_prompt: idea.designPrompt,
                status: "rejected"
            })

        if (error) throw error

        return { success: true }
    } catch (err: any) {
        console.error("rejectProductIdea error:", err)
        return { success: false, error: err.message || "Failed to reject idea" }
    }
}
