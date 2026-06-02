"use server"

import supabaseAdmin from "@/supabase/admin"
import { requireProjectAccess } from "@/lib/auth-guard"

// ─── Brand Memory Management ────────────────────────────────────────

export async function getBrandMemoriesList(projectSlug: string): Promise<{
    memories: { id: string; memory_type: string; content: string; confidence: number; times_confirmed: number; source_post_ids: string[]; created_at: string; updated_at?: string }[]
}> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        const { data, error } = await supabaseAdmin
            .from("ig_brand_memory")
            .select("*")
            .eq("client_id", clientId)
            .order("confidence", { ascending: false })

        if (error) throw error
        return { memories: data || [] }
    } catch (err: any) {
        console.error("getBrandMemoriesList error:", err?.message)
        return { memories: [] }
    }
}

export async function createBrandMemory(
    projectSlug: string,
    data: { memory_type: string; content: string; confidence: number }
): Promise<{ success: boolean; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        const { error } = await supabaseAdmin
            .from("ig_brand_memory")
            .insert({
                client_id: clientId,
                memory_type: data.memory_type,
                content: data.content,
                confidence: Math.min(1, Math.max(0.1, data.confidence)),
                source_post_ids: [],
            })

        if (error) throw error
        return { success: true }
    } catch (err: any) {
        console.error("createBrandMemory error:", err?.message)
        return { success: false, error: err?.message }
    }
}

export async function updateBrandMemory(
    id: string,
    updates: { content?: string; confidence?: number; memory_type?: string }
): Promise<{ success: boolean; error?: string }> {
    try {
        const updateData: Record<string, any> = {}
        if (updates.content !== undefined) updateData.content = updates.content
        if (updates.confidence !== undefined) updateData.confidence = Math.min(1, Math.max(0.1, updates.confidence))
        if (updates.memory_type !== undefined) updateData.memory_type = updates.memory_type

        const { error } = await supabaseAdmin
            .from("ig_brand_memory")
            .update(updateData)
            .eq("id", id)

        if (error) throw error
        return { success: true }
    } catch (err: any) {
        console.error("updateBrandMemory error:", err?.message)
        return { success: false, error: err?.message }
    }
}

export async function deleteBrandMemory(id: string): Promise<{ success: boolean; error?: string }> {
    try {
        const { error } = await supabaseAdmin
            .from("ig_brand_memory")
            .delete()
            .eq("id", id)

        if (error) throw error
        return { success: true }
    } catch (err: any) {
        console.error("deleteBrandMemory error:", err?.message)
        return { success: false, error: err?.message }
    }
}
