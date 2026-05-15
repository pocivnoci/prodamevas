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
import { setActiveProject } from "@/instagram/service"

export { type ProductIdea, type DesignConcept }

import { withRetry } from "@/utils/retry"

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
        const clientId = await resolveClientId(options.configName)
        setActiveProject(clientId)
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
    includeLogo?: boolean
    overlayText?: string
}): Promise<{ success: boolean; concept?: DesignConcept; designUrl?: string; error?: string }> {
    try {
        const config = await loadConfig(options.configName)
        const clientId = await resolveClientId(options.configName)
        setActiveProject(clientId)
        const result = await withRetry(
            () => generateDesignConcept(config, options.theme, options.productType || "triko", {
                includeLogo: options.includeLogo,
                overlayText: options.overlayText,
            }),
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
        const clientId = await resolveClientId(options.configName)
        setActiveProject(clientId)
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
        const clientId = await resolveClientId(options.configName)
        setActiveProject(clientId)
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
        const clientId = await resolveClientId(options.configName)
        setActiveProject(clientId)

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
            variants: [],
            supplierMessage: "",
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

export async function saveProductIdea(configName: string, idea: Omit<ProductIdea, "id" | "client_id" | "created_at">, designUrl?: string): Promise<{ success: boolean; error?: string }> {
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
                variants: idea.variants || [],
                supplier_message: idea.supplierMessage || "",
                status: "saved",
                design_url: designUrl || null
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
                variants: idea.variants || [],
                supplier_message: idea.supplierMessage || "",
                status: "rejected"
            })

        if (error) throw error
        return { success: true }
    } catch (err: any) {
        console.error("rejectProductIdea error:", err)
        return { success: false, error: err.message || "Failed to reject idea" }
    }
}

// ============================================
// PRODUCT REFERENCE UPLOAD (replaces client-side supabase.storage)
// ============================================

export async function uploadProductReference(
    projectId: string,
    ideaId: string,
    formData: FormData
): Promise<{ success: boolean; publicUrl?: string; error?: string }> {
    try {
        const file = formData.get("file") as File
        if (!file) return { success: false, error: "No file provided" }

        const fileName = `${projectId}_${ideaId}_${Date.now()}`
        const arrayBuffer = await file.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        const { error } = await supabaseAdmin.storage
            .from("product-references")
            .upload(fileName, buffer, {
                cacheControl: "3600",
                upsert: false,
                contentType: file.type,
            })

        if (error) throw error

        const { data: publicUrlData } = supabaseAdmin.storage
            .from("product-references")
            .getPublicUrl(fileName)

        return { success: true, publicUrl: publicUrlData.publicUrl }
    } catch (err: any) {
        console.error("uploadProductReference error:", err)
        return { success: false, error: err.message || "Upload failed" }
    }
}

// ============================================
// FETCH SAVED PRODUCT IDEAS (replaces client-side supabase query)
// ============================================

export async function getSavedProductIdeas(projectId: string): Promise<ProductIdea[]> {
    try {
        const clientId = await resolveClientId(projectId)

        const { data, error } = await supabaseAdmin
            .from("ig_product_ideas")
            .select("*")
            .eq("client_id", clientId)
            .eq("status", "saved")
            .order("created_at", { ascending: false })

        if (error) throw error
        if (!data) return []

        return data.map(row => ({
            id: row.id,
            client_id: row.client_id,
            name: row.name,
            brandingNames: row.branding_names || [],
            type: row.type,
            tagline: row.tagline,
            description: row.description,
            material: row.material,
            dimensions: row.dimensions,
            manufacturingMethod: row.manufacturing_method,
            priceRange: row.price_range,
            viralAngle: row.viral_angle,
            whyItWorks: row.why_it_works,
            productionNotes: row.production_notes,
            designPrompt: row.design_prompt,
            variants: row.variants || [],
            supplierMessage: row.supplier_message || "",
            status: row.status as "saved" | "review" | "rejected",
            created_at: row.created_at,
            design_url: row.design_url,
        }))
    } catch (err: any) {
        console.error("getSavedProductIdeas error:", err)
        return []
    }
}
