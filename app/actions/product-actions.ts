"use server"

import supabaseAdmin from "@/supabase/admin"
import { requireProjectAccess } from "@/lib/auth-guard"
import {
    generateProductIdeas,
    generateProductDesign,
    type ProductIdea,
    type DesignConcept
} from "@/instagram/product-generator"
import { loadConfig } from "@/instagram/configs"
import { getModel } from "@/instagram/models"
import { setActiveProject } from "@/instagram/service"

export { type ProductIdea, type DesignConcept }

import { withRetry } from "@/utils/retry"
import { creditGuard } from "./credit-guard"
import { getClientConfig } from "./config-actions"
import type { ProductUrlDraft, SavableDraft } from "@/lib/product-import"

// ============================================
// PRODUCT GENERATION ACTIONS
// ============================================

export async function triggerProductIdeas(options: {
    configName: string
    count?: number
    theme?: string
}): Promise<{ success: boolean; ideas?: ProductIdea[]; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(options.configName)
        const config = await loadConfig(options.configName)

        // Credit check
        const guard = await creditGuard(options.configName, "product_ideas")
        if (!guard.ok) return { success: false, error: guard.error }

        setActiveProject(clientId)
        const ideas = await withRetry(
            () => generateProductIdeas(config, options.count || 5, options.theme || undefined, clientId),
            1,
            "Product ideas"
        )

        await guard.commit(`Produktové nápady: ${options.theme || 'auto'}`)

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

export async function triggerProductDesign(options: {
    configName: string
    idea: ProductIdea
    referenceImageUrl?: string
    ideaId?: string
}): Promise<{ success: boolean; designUrl?: string; error?: string }> {
    try {
        // Credit check
        const guard = await creditGuard(options.configName, "product_design")
        if (!guard.ok) return { success: false, error: guard.error }

        const { clientId } = await requireProjectAccess(options.configName)
        const config = await loadConfig(options.configName)
        setActiveProject(clientId)
        const result = await withRetry(
            () => generateProductDesign(config, options.idea, options.referenceImageUrl),
            1,
            "Product design"
        )

        if (!result) {
            return { success: false, error: "Product design generation returned null" }
        }

        await guard.commit(`Design: ${options.idea.name}`)

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
        // Credit check
        const guard = await creditGuard(options.configName, "product_design")
        if (!guard.ok) return { success: false, error: guard.error }

        const { clientId } = await requireProjectAccess(options.configName)
        const config = await loadConfig(options.configName)
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

        await guard.commit(`Custom design: ${options.productDescription.substring(0, 40)}`)

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
        const { clientId } = await requireProjectAccess(configName)

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
        const { clientId } = await requireProjectAccess(configName)

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
// IDEA FEEDBACK — 👍/👎 that actually steers the next generation
// ============================================

/**
 * Rate a saved product idea.
 *
 * Before this, saved/rejected was recorded and influenced nothing: unlike
 * ig_post_ideas, product ideas had no performance_score and no weighted
 * selection, so the model re-proposed variations of ideas the user had already
 * thrown away. The rating feeds getWeightedProductIdeas (instagram/service.ts),
 * which both the idea generator and the line generator read.
 *
 * performance_score is derived here rather than stored raw so the weighting math
 * stays identical to the post-idea loop (decayedScore over a numeric score).
 */
export async function rateProductIdea(
    projectSlug: string,
    ideaId: string,
    rating: 1 | -1 | null,
): Promise<{ success: boolean; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        const { error } = await supabaseAdmin
            .from("ig_product_ideas")
            .update({
                rating,
                performance_score: rating === 1 ? 10 : rating === -1 ? 0 : 5,
                last_used_at: new Date().toISOString(),
            })
            .eq("id", ideaId)
            .eq("client_id", clientId)

        if (error) throw error
        return { success: true }
    } catch (err: any) {
        console.error("rateProductIdea error:", err)
        return { success: false, error: err.message || "Hodnocení se neuložilo" }
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
        // Tenant guard — this was the only product action without one, so any
        // authenticated user could write into another client's reference bucket.
        const { clientId } = await requireProjectAccess(projectId)

        const file = formData.get("file") as File
        if (!file) return { success: false, error: "No file provided" }

        const fileName = `${clientId}_${ideaId}_${Date.now()}`
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
        const { clientId } = await requireProjectAccess(projectId)

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

// ─── Product Revision ───────────────────────────────────────

/**
 * Revise a saved product idea based on user feedback.
 * Updates name, description, variants, and supplier message in-place.
 */
export async function reviseProduct(
    ideaId: string,
    feedback: string,
    configName: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(configName)

        // Credit check — AI revision costs 1 credit
        const guard = await creditGuard(configName, "idea_generate")
        if (!guard.ok) return { success: false, error: guard.error }

        // 1. Load the existing product idea — client_id filter is mandatory (hard rule):
        // a bare id lookup let any authenticated user read/rewrite another tenant's idea.
        const { data: original, error: fetchErr } = await supabaseAdmin
            .from("ig_product_ideas")
            .select("*")
            .eq("id", ideaId)
            .eq("client_id", clientId)
            .single()

        if (fetchErr || !original) throw new Error("Produkt nenalezen")

        // 2. Load client config for brand voice
        const config = await loadConfig(configName)
        const { ai } = await import("@/instagram/gemini-client")

        const brandName = config.name || configName
        const bv = config.brandVoice || {} as any

        // Existing products for naming consistency — live catalog, not the frozen
        // config.products onboarding snapshot
        const { getCatalogProducts } = await import("@/instagram/service")
        const catalogProducts = await getCatalogProducts(clientId, config.products)
            .catch(() => config.products || [])
        const existingProducts = catalogProducts.slice(0, 8)
            .map(p => `- ${p.name} (${p.type})`)
            .join("\n") || "Žádné"

        // 3. Build revision prompt
        const prompt = `Jsi produktový stratég a copywriter pro značku "${brandName}" (${config.website || ""}).

## BRAND PERSONA
${bv.persona || "Profesionální a kreativní přístup."}

## VOICE TRAITS
${(bv.voiceTraits || []).map((t: string) => `- ${t}`).join("\n") || "- Autentický"}

## STÁVAJÍCÍ PRODUKTY (pro konzistenci pojmenování)
${existingProducts}

## PŮVODNÍ PRODUKT:
Název: ${original.name}
Typ: ${original.type}
Tagline: "${original.tagline}"
Popis: ${original.description}
Materiál: ${original.material || "neuvedeno"}
Cenový rozsah: ${original.price_range || "neuvedeno"}
Varianty: ${(original.variants || []).join(", ")}
Zpráva pro dodavatele: ${original.supplier_message}

## FEEDBACK OD KLIENTA:
"${feedback}"

## INSTRUKCE:
1. Přepiš produkt PŘESNĚ podle feedbacku — ale zachovej brand identitu
2. Název musí být kreativní a brandový — konzistentní se stávajícími produkty
3. Tagline: max 8 slov, chytlavý, zapamatovatelný
4. Popis: 2-3 věty, přesný, prodejní
5. Varianty: 3-5 realistických variant (barvy/materiály/velikosti)
6. Zpráva pro dodavatele: VŽDY v angličtině, profesionální, konkrétní
7. Zachovej typ produktu (${original.type}) pokud feedback neříká jinak
8. Design prompt: aktualizovaný anglický prompt pro AI image generator

## VÝSTUP — vrať POUZE validní JSON:
{
  "name": "název produktu",
  "tagline": "tagline max 8 slov",
  "description": "popis produktu (2-3 věty, česky)",
  "variants": ["varianta 1", "varianta 2", "varianta 3"],
  "supplierMessage": "professional English message for supplier",
  "designPrompt": "Updated English prompt for AI image generator — describe the revised product visually. Product photography, studio lighting, dark background."
}`

        const response = await ai.models.generateContent({
            model: getModel("text"),
            contents: prompt,
            config: { responseMimeType: "application/json" },
        })

        const text = response.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text || ""
        let parsed: {
            name: string
            tagline: string
            description: string
            variants: string[]
            supplierMessage: string
            designPrompt?: string
        }
        try {
            parsed = JSON.parse(text.replace(/```json|```/g, "").trim())
        } catch {
            throw new Error("AI vrátilo neplatný JSON")
        }

        // 4. Update in-place
        const updateData: Record<string, any> = {
            name: parsed.name,
            tagline: parsed.tagline,
            description: parsed.description,
            variants: parsed.variants,
            supplier_message: parsed.supplierMessage,
            feedback: feedback,
        }
        if (parsed.designPrompt) updateData.design_prompt = parsed.designPrompt

        const { error: updateErr } = await supabaseAdmin
            .from("ig_product_ideas")
            .update(updateData)
            .eq("id", ideaId)
            .eq("client_id", clientId)

        if (updateErr) throw updateErr

        await guard.commit(`Revize: ${parsed.name}`)
        console.log(`✅ Product revised: ${ideaId}`)
        return { success: true }
    } catch (err: any) {
        console.error("reviseProduct error:", err?.message || err)
        return { success: false, error: err?.message || String(err) }
    }
}

// ─── Product Catalog CRUD (from admin-actions) ───────────────────────

export async function getProducts(projectSlug: string): Promise<any[]> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        const { data, error } = await supabaseAdmin
            .from("ig_products")
            .select("*")
            .eq("client_id", clientId)
            .order("created_at", { ascending: false })

        if (error) {
            console.error("getProducts error:", error.message)
            return []
        }
        return data || []
    } catch (err: any) {
        console.error("getProducts exception:", err?.message || err)
        return []
    }
}

export async function createProduct(
    projectSlug: string,
    product: { name: string; type?: string; slug: string; price?: string; description?: string; variants?: number }
): Promise<{ success: boolean; product?: any; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        const { data, error } = await supabaseAdmin
            .from("ig_products")
            .insert({
                client_id: clientId,
                name: product.name,
                type: product.type || null,
                slug: product.slug,
                price: product.price || null,
                description: product.description || null,
                variants: product.variants || null,
                image_urls: [],
            })
            .select()
            .single()

        if (error) throw error
        return { success: true, product: data }
    } catch (err: any) {
        console.error("createProduct error:", err?.message || err)
        return { success: false, error: err?.message || String(err) }
    }
}

export async function updateProduct(
    productId: string,
    projectSlug: string,
    updates: { name?: string; type?: string; slug?: string; price?: string; description?: string; variants?: number }
): Promise<{ success: boolean; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        const { error } = await supabaseAdmin
            .from("ig_products")
            .update({
                ...updates,
                updated_at: new Date().toISOString(),
            })
            .eq("id", productId)
            .eq("client_id", clientId)

        if (error) throw error
        return { success: true }
    } catch (err: any) {
        console.error("updateProduct error:", err?.message || err)
        return { success: false, error: err?.message || String(err) }
    }
}

export async function deleteProduct(
    productId: string,
    projectSlug: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        // Delete product images from storage
        const { data: product } = await supabaseAdmin
            .from("ig_products")
            .select("image_urls, slug")
            .eq("id", productId)
            .eq("client_id", clientId)
            .single()

        if (product?.slug) {
            const { data: files } = await supabaseAdmin.storage
                .from("product-images")
                .list(clientId, { search: product.slug })
            if (files && files.length > 0) {
                await supabaseAdmin.storage
                    .from("product-images")
                    .remove(files.map(f => `${clientId}/${f.name}`))
            }
        }

        const { error } = await supabaseAdmin
            .from("ig_products")
            .delete()
            .eq("id", productId)
            .eq("client_id", clientId)

        if (error) throw error
        return { success: true }
    } catch (err: any) {
        console.error("deleteProduct error:", err?.message || err)
        return { success: false, error: err?.message || String(err) }
    }
}

export async function deleteProducts(
    productIds: string[],
    projectSlug: string
): Promise<{ success: boolean; deleted: number; error?: string }> {
    try {
        if (!productIds.length) return { success: true, deleted: 0 }
        const { clientId } = await requireProjectAccess(projectSlug)

        // Get slugs for storage cleanup
        const { data: products } = await supabaseAdmin
            .from("ig_products")
            .select("id, slug")
            .eq("client_id", clientId)
            .in("id", productIds)

        // Delete images from storage
        if (products && products.length > 0) {
            for (const p of products) {
                try {
                    const { data: files } = await supabaseAdmin.storage
                        .from("product-images")
                        .list(clientId, { search: p.slug })
                    if (files && files.length > 0) {
                        await supabaseAdmin.storage
                            .from("product-images")
                            .remove(files.map(f => `${clientId}/${f.name}`))
                    }
                } catch { /* non-critical */ }
            }
        }

        // Bulk delete from DB
        const { error, count } = await supabaseAdmin
            .from("ig_products")
            .delete({ count: "exact" })
            .eq("client_id", clientId)
            .in("id", productIds)

        if (error) throw error
        return { success: true, deleted: count || productIds.length }
    } catch (err: any) {
        console.error("deleteProducts error:", err?.message || err)
        return { success: false, deleted: 0, error: err?.message || String(err) }
    }
}

export async function uploadProductImage(
    projectSlug: string,
    productId: string,
    formData: FormData
): Promise<{ success: boolean; publicUrl?: string; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        const file = formData.get("file") as File
        if (!file || !file.type.startsWith("image/")) {
            return { success: false, error: "Neplatný soubor — nahraj PNG, JPG nebo WebP" }
        }
        if (file.size > 10_000_000) {
            return { success: false, error: "Obrázek je příliš velký (max 10 MB)" }
        }

        // Get product slug for filename
        const { data: product } = await supabaseAdmin
            .from("ig_products")
            .select("slug, image_urls")
            .eq("id", productId)
            .eq("client_id", clientId)
            .single()

        if (!product) return { success: false, error: "Produkt nenalezen" }

        const buffer = Buffer.from(await file.arrayBuffer())
        const ext = file.type.includes("png") ? "png" : file.type.includes("webp") ? "webp" : "jpg"
        const existingCount = (product.image_urls || []).length
        const filename = `${clientId}/${product.slug}-${existingCount}.${ext}`

        const { error: uploadError } = await supabaseAdmin.storage
            .from("product-images")
            .upload(filename, buffer, {
                contentType: file.type,
                cacheControl: "31536000",
                upsert: true,
            })

        if (uploadError) throw uploadError

        const { data: pubUrl } = supabaseAdmin.storage
            .from("product-images")
            .getPublicUrl(filename)

        // Append URL to product's image_urls array
        const updatedUrls = [...(product.image_urls || []), pubUrl.publicUrl]
        await supabaseAdmin
            .from("ig_products")
            .update({ image_urls: updatedUrls, updated_at: new Date().toISOString() })
            .eq("id", productId)

        return { success: true, publicUrl: pubUrl.publicUrl }
    } catch (err: any) {
        console.error("uploadProductImage error:", err?.message || err)
        return { success: false, error: err?.message || String(err) }
    }
}

/**
 * One-shot migration: sync config.products JSONB → ig_products table
 * for all active clients. Safe to run multiple times (dedup by slug).
 */
export async function syncConfigProductsToDb(): Promise<{ success: boolean; synced: number; skipped: number; error?: string }> {
    try {
        const { data: clients, error } = await supabaseAdmin
            .from("clients")
            .select("id, slug, config")
            .eq("is_active", true)

        if (error) throw error
        if (!clients || clients.length === 0) return { success: true, synced: 0, skipped: 0 }

        let totalSynced = 0
        let totalSkipped = 0

        for (const client of clients) {
            const config = client.config as any
            const products = config?.products
            if (!products || !Array.isArray(products) || products.length === 0) continue

            // Get existing slugs to avoid duplicates
            const { data: existing } = await supabaseAdmin
                .from("ig_products")
                .select("slug")
                .eq("client_id", client.id)

            const existingSlugs = new Set((existing || []).map((p: any) => p.slug))

            const toInsert = products
                .filter((p: any) => p.slug && !existingSlugs.has(p.slug))
                .map((p: any) => ({
                    client_id: client.id,
                    name: p.name,
                    type: p.type || "product",
                    slug: p.slug,
                    price: p.price || null,
                    description: p.description || null,
                    image_urls: [],
                }))

            if (toInsert.length === 0) {
                totalSkipped += products.length
                continue
            }

            const { error: insertError } = await supabaseAdmin
                .from("ig_products")
                .insert(toInsert)

            if (insertError) {
                console.warn(`⚠️ Sync failed for ${client.slug}:`, insertError.message)
            } else {
                totalSynced += toInsert.length
                totalSkipped += products.length - toInsert.length
                console.log(`✅ ${client.slug}: ${toInsert.length} products synced`)
            }
        }

        return { success: true, synced: totalSynced, skipped: totalSkipped }
    } catch (err: any) {
        console.error("syncConfigProductsToDb error:", err?.message || err)
        return { success: false, synced: 0, skipped: 0, error: err?.message || String(err) }
    }
}

// ─── Scrape Products from Website ────────────────────────────────────

/**
 * Scrape client's website, extract products/services via AI, insert into ig_products.
 * Also downloads product images and uploads to Supabase storage.
 * Max 30 products. Dedup by slug — safe to run multiple times.
 */
export async function scrapeProductsFromWebsite(
    projectSlug: string
): Promise<{ success: boolean; found: number; inserted: number; images: number; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        // Get website URL from config
        const config = await getClientConfig(projectSlug)
        const website = config?.website
        if (!website) {
            return { success: false, found: 0, inserted: 0, images: 0, error: "Klient nemá nastavený web" }
        }

        const baseUrl = website.startsWith("http") ? website : `https://${website}`
        const origin = new URL(baseUrl).origin

        // --- Lightweight scraper ---
        // Adresa webu jde z konfigurace, kterou plní uživatel — stejná třída rizika
        // jako import z odkazu, takže stejná pojistka proti sáhnutí na interní síť.
        const { assertFetchableUrl } = await import("@/lib/product-url")

        const fetchWithTimeout = async (url: string, ms = 8000): Promise<string> => {
            await assertFetchableUrl(url)
            const ctrl = new AbortController()
            const t = setTimeout(() => ctrl.abort(), ms)
            try {
                const r = await fetch(url, {
                    signal: ctrl.signal,
                    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
                })
                if (!r.ok) throw new Error(`HTTP ${r.status}`)
                return await r.text()
            } finally { clearTimeout(t) }
        }

        // Preserve <img> tags as [IMG: url] markers so AI can map images to products
        const stripHtml = (html: string, pageBaseUrl: string): string => {
            return html
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
                .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
                .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
                .replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gi, (_, lvl, c) => `\n[H${lvl}] ${c.replace(/<[^>]+>/g, "").trim()}\n`)
                .replace(/<img[^>]+(?:src|data-src)="([^"]+)"[^>]*>/gi, (_, src) => {
                    // Skip tiny icons, trackers, SVGs
                    if (src.endsWith('.svg') || src.endsWith('.ico') || src.includes('data:image')
                        || src.includes('pixel') || src.includes('tracking') || src.includes('placeholder')
                        || src.includes('spinner') || src.includes('loading') || src.includes('avatar')
                        || src.includes('emoji') || src.includes('widget') || /\b(1x1|2x2|spacer)\b/i.test(src)) return ""
                    let url = src
                    if (url.startsWith("//")) url = `https:${url}`
                    else if (url.startsWith("/")) url = `${pageBaseUrl}${url}`
                    return ` [IMG: ${url}] `
                })
                .replace(/<li[^>]*>(.*?)<\/li>/gi, (_, c) => `• ${c.replace(/<[^>]+>/g, "").trim()}\n`)
                .replace(/(\d[\d\s]*(?:Kč|CZK|,-|€|\$))/gi, " [CENA: $1] ")
                .replace(/<[^>]+>/g, " ")
                .replace(/&nbsp;/gi, " ")
                .replace(/&amp;/gi, "&")
                .replace(/\s+/g, " ")
                .trim()
        }

        // Scrape homepage
        console.log(`🔍 Scraping products from ${baseUrl}...`)
        let homepageHtml: string
        try {
            homepageHtml = await fetchWithTimeout(baseUrl)
        } catch (e: any) {
            return { success: false, found: 0, inserted: 0, images: 0, error: `Web se nepodařilo načíst: ${e.message}` }
        }
        const homepageText = stripHtml(homepageHtml, origin).substring(0, 6000)

        // Discover subpages from <a href>
        const subUrls = new Set<string>()
        const linkRegex = /href="([^"]+)"/gi
        let m: RegExpExecArray | null
        while ((m = linkRegex.exec(homepageHtml)) !== null) {
            const href = m[1]
            if (href.startsWith("/") && !href.startsWith("//") && href.length > 1 && !href.match(/\.(js|css|png|jpg|svg|ico|webp|gif|pdf|xml|json)/i) && !href.includes("#")) {
                subUrls.add(`${origin}${href}`)
            }
        }

        // Prioritize product/service/pricing pages
        const priority = /produk|sluzb|služb|cenik|ceník|nabid|shop|store|menu|katalog|balic|balíč|price|offer|obchod/i
        const sortedSubs = Array.from(subUrls)
            .sort((a, b) => (priority.test(a) ? 0 : 1) - (priority.test(b) ? 0 : 1))
            .slice(0, 10)

        // Scrape subpages (keep raw HTML for image extraction)
        const subTexts: string[] = []
        for (const url of sortedSubs) {
            try {
                const html = await fetchWithTimeout(url)
                subTexts.push(`### ${url}\n${stripHtml(html, origin).substring(0, 2000)}`)
            } catch { /* skip */ }
        }

        // --- AI extraction (with image URLs) ---
        const { generateText } = await import("@/instagram/gemini-client")

        const prompt = `Analyzuj obsah tohoto webu a extrahuj VŠECHNY produkty, služby, balíčky, nabídky a cenové položky.

Obsah obsahuje značky [IMG: url] označující obrázky nalezené na stránce.

## HOMEPAGE
${homepageText}

## PODSTRÁNKY (${sortedSubs.length})
${subTexts.join("\n\n")}

## ÚKOL
Extrahuj pole produktů/služeb. Pro KAŽDÝ nalezený produkt/službu vrať:
- name: název produktu/služby (česky)
- type: kategorie (produkt, služba, balíček, menu, pokoj, kurz, atd.)
- slug: URL-friendly verze názvu (lowercase, bez diakritiky, pomlčky místo mezer)
- price: cena pokud nalezena (např. "990 Kč", "od 1500 Kč/hod") nebo null
- description: stručný popis (1-2 věty) nebo null
- imageUrl: URL obrázku produktu z nejbližší [IMG: url] značky, nebo null

PRAVIDLA:
- Maximálně 30 položek
- Zahrň i služby, balíčky, kategorie menu, typy pokojů atd.
- Nezahrnuj navigační položky, stránky, nebo interní odkazy
- Slug: bez diakritiky, lowercase, max 40 znaků
- imageUrl: vyber obrázek který nejlépe odpovídá danému produktu (nejbližší [IMG:] tag). Pokud žádný vhodný není, nastav null
- Pokud na webu žádné produkty/služby nejsou, vrať prázdné pole

Vrať POUZE platný JSON pole objektů.`

        const productSchema = {
            type: "object",
            properties: {
                products: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            name: { type: "string" },
                            type: { type: "string" },
                            slug: { type: "string" },
                            price: { type: "string" },
                            description: { type: "string" },
                            imageUrl: { type: "string" },
                        },
                        required: ["name", "type", "slug"],
                    },
                },
            },
            required: ["products"],
        }

        const raw = await generateText(prompt, { model: getModel("text"), responseSchema: productSchema })
        let products: any[] = []

        // Parse — handle both {products: [...]} and bare [...]
        const jsonObjMatch = raw.match(/\{[\s\S]*\}/)
        const jsonArrMatch = raw.match(/\[[\s\S]*\]/)
        if (jsonObjMatch) {
            const parsed = JSON.parse(jsonObjMatch[0])
            products = parsed.products || parsed
        } else if (jsonArrMatch) {
            products = JSON.parse(jsonArrMatch[0])
        }

        if (!Array.isArray(products)) products = []
        products = products.slice(0, 30) // enforce limit

        if (products.length === 0) {
            return { success: true, found: 0, inserted: 0, images: 0 }
        }

        // --- Dedup + insert ---
        const { data: existing } = await supabaseAdmin
            .from("ig_products")
            .select("id, slug, image_urls")
            .eq("client_id", clientId)

        const existingBySlug = new Map((existing || []).map((p: any) => [p.slug, p]))

        const newProducts = products.filter(p => p.slug && !existingBySlug.has(p.slug))

        let insertedRows: any[] = []
        if (newProducts.length > 0) {
            const toInsert = newProducts.map(p => ({
                client_id: clientId,
                name: p.name,
                type: p.type || "product",
                slug: p.slug.substring(0, 40),
                price: p.price || null,
                description: p.description || null,
                image_urls: [],
            }))

            const { data, error: insertError } = await supabaseAdmin
                .from("ig_products")
                .insert(toInsert)
                .select("id, slug")

            if (insertError) throw insertError
            insertedRows = data || []
        }

        // --- Download and upload product images ---
        // Build map of products that need images (newly inserted + existing without images)
        let totalImages = 0
        const sharp = (await import("sharp")).default

        const slugToData = new Map<string, { id: string; imageUrl: string }>()
        for (const p of products) {
            if (!p.imageUrl || typeof p.imageUrl !== "string" || !p.imageUrl.startsWith("http")) continue
            const slug = p.slug.substring(0, 40)

            // Check if this is a newly inserted product
            const newRow = insertedRows.find((r: any) => r.slug === slug)
            if (newRow) {
                slugToData.set(slug, { id: newRow.id, imageUrl: p.imageUrl })
                continue
            }

            // Check if this is an existing product WITHOUT images
            const existingProduct = existingBySlug.get(slug)
            if (existingProduct && (!existingProduct.image_urls || existingProduct.image_urls.length === 0)) {
                slugToData.set(slug, { id: existingProduct.id, imageUrl: p.imageUrl })
            }
        }

        if (slugToData.size > 0) {
            console.log(`📷 Downloading images for ${slugToData.size} products...`)

            for (const [slug, { id: productId, imageUrl }] of slugToData) {
                try {
                    const ctrl = new AbortController()
                    const t = setTimeout(() => ctrl.abort(), 8000)
                    const resp = await fetch(imageUrl, {
                        signal: ctrl.signal,
                        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
                    })
                    clearTimeout(t)

                    if (!resp.ok) continue

                    const contentType = resp.headers.get("content-type") || "image/jpeg"
                    if (!contentType.startsWith("image/")) continue

                    const buffer = Buffer.from(await resp.arrayBuffer())

                    // Skip tiny (<5KB) and huge (>10MB)
                    if (buffer.length < 5000 || buffer.length > 10_000_000) continue

                    // Validate dimensions — skip icons/badges
                    try {
                        const metadata = await sharp(buffer).metadata()
                        if ((metadata.width || 0) < 200 || (metadata.height || 0) < 200) continue
                    } catch { continue }

                    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg"
                    const filename = `${clientId}/${slug}-0.${ext}`

                    const { error: uploadError } = await supabaseAdmin.storage
                        .from("product-images")
                        .upload(filename, buffer, {
                            contentType,
                            cacheControl: "31536000",
                            upsert: true,
                        })

                    if (uploadError) {
                        console.warn(`   ⚠️ Upload failed for ${slug}: ${uploadError.message}`)
                        continue
                    }

                    const { data: pubUrl } = supabaseAdmin.storage
                        .from("product-images")
                        .getPublicUrl(filename)

                    // Update product record with image URL
                    await supabaseAdmin
                        .from("ig_products")
                        .update({ image_urls: [pubUrl.publicUrl], updated_at: new Date().toISOString() })
                        .eq("id", productId)

                    totalImages++
                    console.log(`   📸 ${slug}: ${(buffer.length / 1024).toFixed(0)}KB ✓`)
                } catch {
                    // Skip failed image downloads silently
                }
            }
        }

        console.log(`✅ ${newProducts.length} products + ${totalImages} images scraped for ${projectSlug}`)
        return { success: true, found: products.length, inserted: newProducts.length, images: totalImages }
    } catch (err: any) {
        console.error("scrapeProductsFromWebsite error:", err?.message || err)
        return { success: false, found: 0, inserted: 0, images: 0, error: err?.message || String(err) }
    }
}

// ============================================
// IMPORT Z PŘÍMÉHO ODKAZU NA PRODUKT
// ============================================
//
// Třetí cesta do katalogu, vedle ručního formuláře a scrapu celého webu.
// Je dvoufázová schválně: `previewProductsFromUrls` **nic neukládá**, jen vrátí,
// co ze stránek přečetl. Uloží se až to, co uživatel v náhledu potvrdí.
// U jednoho konkrétního produktu je špatná cena horší než klik navíc — a scrape
// webu, který ukládá rovnou, tuhle kontrolu nemá.
//
// Vlastní logika žije v `lib/product-import.ts` bez vazby na session, aby šla
// spustit i mimo prohlížeč. Tady zbývá jen hranice: přelož slug na `clientId`.

export type { ProductUrlDraft }

/** Přečte produkty z vložených odkazů a vrátí je k potvrzení. Neukládá. */
export async function previewProductsFromUrls(
    projectSlug: string,
    rawUrls: string[],
): Promise<{ success: boolean; drafts?: ProductUrlDraft[]; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const { readProductDrafts } = await import("@/lib/product-import")
        const result = await readProductDrafts(clientId, rawUrls)
        if (result.drafts) {
            console.log(`🔗 Import z odkazů: ${result.drafts.filter(d => d.ok).length}/${result.drafts.length} přečteno pro ${projectSlug}`)
        }
        return result
    } catch (err: any) {
        console.error("previewProductsFromUrls error:", err?.message || err)
        return { success: false, error: err?.message || String(err) }
    }
}

/** Uloží produkty potvrzené v náhledu — včetně stažení fotek do `product-images`. */
export async function saveImportedProducts(
    projectSlug: string,
    drafts: SavableDraft[],
): Promise<{ success: boolean; inserted: number; skipped: number; images: number; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const { importProductDrafts } = await import("@/lib/product-import")
        const result = await importProductDrafts(clientId, drafts)
        console.log(`✅ Import z odkazů: ${result.inserted} produktů + ${result.images} fotek pro ${projectSlug}`)
        return result
    } catch (err: any) {
        console.error("saveImportedProducts error:", err?.message || err)
        return { success: false, inserted: 0, skipped: 0, images: 0, error: err?.message || String(err) }
    }
}
