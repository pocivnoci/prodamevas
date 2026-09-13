"use server"

import {
    getProductCategories as getCategories,
    createProductCategory as createCategory,
    updateProductCategory as updateCategory,
    deleteProductCategory as deleteCategory,
    type ProductCategory,
} from "@/instagram/service"
import { resolveClientId } from "@/instagram/configs"
import { requireAuth, requireClientAccess, requireSuperAdmin } from "@/lib/auth-guard"
import supabaseAdmin from "@/supabase/admin"
import { actionTranslator, type ActionTranslator } from "@/lib/i18n/actions"

// ─── Helper: slug → UUID ──────────────────────────────────

async function toUUID(projectId: string): Promise<string | null> {
    // Already a UUID (36 chars with dashes)
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(projectId)) return projectId
    try {
        return await resolveClientId(projectId)
    } catch {
        return null
    }
}

/** Ownership check for a category row: per-client rows need membership, global rows (client_id null) need super admin. */
async function requireCategoryAccess(id: string, t: ActionTranslator): Promise<void> {
    const { data: category } = await supabaseAdmin
        .from("ig_product_categories")
        .select("client_id")
        .eq("id", id)
        .single()
    if (!category) throw new Error(t("productCategory.notFound"))
    if (category.client_id) {
        await requireClientAccess(category.client_id)
    } else {
        await requireSuperAdmin()
    }
}

// ─── Read ─────────────────────────────────────────────────

export async function fetchProductCategories(
    projectId: string
): Promise<{ categories: ProductCategory[]; isCustom: boolean }> {
    try {
        const clientUUID = await toUUID(projectId)
        if (clientUUID) {
            await requireClientAccess(clientUUID)
        } else {
            await requireAuth()
        }
        // Pass UUID or undefined — service falls back to global if null/undefined
        const categories = await getCategories(clientUUID ?? undefined)
        const isCustom = categories.length > 0 && categories[0].client_id !== null
        return { categories, isCustom }
    } catch (err: any) {
        console.error("fetchProductCategories error:", err.message)
        return { categories: [], isCustom: false }
    }
}

// ─── Create ───────────────────────────────────────────────

export async function addProductCategory(
    projectId: string,
    data: {
        slug: string
        label: string
        icon?: string
        design_guide: string
        mockup_prompt?: string
        material_hint?: string
        manufacturing_hint?: string
    }
): Promise<{ success: boolean; category?: ProductCategory; error?: string }> {
    const t = await actionTranslator("actionsContent")
    try {
        const clientUUID = await toUUID(projectId)
        if (!clientUUID) return { success: false, error: t("productCategory.clientNotFound", { name: projectId }) }
        await requireClientAccess(clientUUID)
        const category = await createCategory(clientUUID, data)
        return { success: true, category }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
}

// ─── Update ───────────────────────────────────────────────

export async function editProductCategory(
    id: string,
    data: Partial<{
        label: string
        icon: string
        design_guide: string
        mockup_prompt: string
        material_hint: string
        manufacturing_hint: string
    }>
): Promise<{ success: boolean; error?: string }> {
    const t = await actionTranslator("actionsContent")
    try {
        await requireCategoryAccess(id, t)
        await updateCategory(id, data)
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
}

// ─── Delete (soft) ────────────────────────────────────────

export async function removeProductCategory(
    id: string
): Promise<{ success: boolean; error?: string }> {
    const t = await actionTranslator("actionsContent")
    try {
        await requireCategoryAccess(id, t)
        await deleteCategory(id)
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
}

