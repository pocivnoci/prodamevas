"use server"

import {
    getProductCategories as getCategories,
    createProductCategory as createCategory,
    updateProductCategory as updateCategory,
    deleteProductCategory as deleteCategory,
    type ProductCategory,
} from "@/instagram/service"

// ─── Read ─────────────────────────────────────────────────

export async function fetchProductCategories(
    projectId: string
): Promise<{ categories: ProductCategory[]; isCustom: boolean }> {
    try {
        const categories = await getCategories(projectId)
        // isCustom = true if these are client-specific (not global defaults)
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
    try {
        const category = await createCategory(projectId, data)
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
    try {
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
    try {
        await deleteCategory(id)
        return { success: true }
    } catch (err: any) {
        return { success: false, error: err.message }
    }
}
