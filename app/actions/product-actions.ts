"use server"

import supabaseAdmin from "@/supabase/admin"
import {
    generateProductIdeas,
    generateDesignConcept,
    generateProductMockup,
    generateProductDesign,
    type ProductIdea,
    type DesignConcept
} from "@/instagram/product-generator"
import { loadConfig, resolveClientId } from "@/instagram/configs"

export { type ProductIdea, type DesignConcept }

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
// PRODUCT GENERATION ACTIONS
// ============================================

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
    ideaId?: string
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

        if (options.ideaId && result.designUrl) {
            await supabaseAdmin
                .from("ig_product_ideas")
                .update({ design_url: result.designUrl })
                .eq("id", options.ideaId)
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

export async function triggerMockupGeneration(options: {
    configName: string
    designUrl: string
    productType?: string
    designDescription?: string
    ideaId?: string
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

        if (options.ideaId && result.mockupUrl) {
            await supabaseAdmin
                .from("ig_product_ideas")
                .update({ mockup_url: result.mockupUrl })
                .eq("id", options.ideaId)
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
    ideaId?: string
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

        if (options.ideaId && result.designUrl) {
            await supabaseAdmin
                .from("ig_product_ideas")
                .update({ design_url: result.designUrl })
                .eq("id", options.ideaId)
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

export async function triggerCustomProductDesign(options: {
    configName: string
    productDescription: string
}): Promise<{ success: boolean; designUrl?: string; error?: string }> {
    try {
        const config = await loadConfig(options.configName)

        const customIdea: ProductIdea = {
            name: options.productDescription,
            type: "custom",
            description: options.productDescription,
            material: "",
            dimensions: "",
            designPrompt: `Single ${options.productDescription} centered on a clean dark background. Product photography, studio lighting, photorealistic render, premium quality, detailed materials and textures. The product must have a clear, flat, prominent surface suitable for a printed logo.`,
            tagline: "",
            priceRange: "",
            brandingNames: [],
            manufacturingMethod: "",
            viralAngle: "",
            whyItWorks: "",
            productionNotes: "",
        }

        const result = await withRetry(
            () => generateProductDesign(config, customIdea),
            1,
            "Custom product design"
        )

        if (!result) {
            return { success: false, error: "Custom product design generation returned null" }
        }

        return {
            success: true,
            designUrl: result.designUrl,
        }
    } catch (err: any) {
        const errorMessage = err?.message || String(err) || "Unknown error"
        console.error("Custom product design error:", errorMessage)
        return { success: false, error: errorMessage.substring(0, 500) }
    }
}

export async function saveProductIdea(configName: string, idea: Omit<ProductIdea, "id" | "client_id" | "created_at">): Promise<{ success: boolean; error?: string }> {
    try {
        const clientId = await resolveClientId(configName)

        const { error } = await supabaseAdmin
            .from("ig_product_ideas")
            .insert({
                client_id: clientId,
                name: idea.name,
                branding_names: idea.brandingNames || [],
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
                branding_names: idea.brandingNames || [],
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
