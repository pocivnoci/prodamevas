"use server"

import supabaseAdmin from "@/supabase/admin"
import { revalidatePath } from "next/cache"
import type { ClientConfig } from "@/instagram/configs/types"
import { requireAuth } from "@/lib/auth-guard"

export async function getClientConfig(projectId: string): Promise<ClientConfig | null> {
    try {
        await requireAuth()
        const { data, error } = await supabaseAdmin
            .from("clients")
            .select("config")
            .eq("slug", projectId)
            .single()

        if (error || !data) {
            console.error("Error fetching config:", error)
            return null
        }

        return data.config as ClientConfig
    } catch (err) {
        console.error("Exception fetching config:", err)
        return null
    }
}

export async function updateClientConfig(projectId: string, newConfig: any): Promise<{ success: boolean; error?: string }> {
    try {
        await requireAuth()
        // Validation - verify the config is valid JSON and has minimum required fields
        if (!newConfig || typeof newConfig !== "object") {
            return { success: false, error: "Neplatný formát konfigurace (musí být JSON objekt)." }
        }

        const { error } = await supabaseAdmin
            .from("clients")
            .update({ config: newConfig })
            .eq("slug", projectId)

        if (error) {
            console.error("Supabase update error:", error)
            return { success: false, error: error.message }
        }

        // Invalidate config cache
        const { invalidateConfigCache } = await import("@/instagram/configs")
        invalidateConfigCache(projectId)

        // Revalidate the app to reflect changes
        revalidatePath("/dashboard")
        revalidatePath("/api/ig-generate")
        
        return { success: true }
    } catch (err: any) {
        console.error("Exception checking config:", err)
        return { success: false, error: err.message || "Unknown error during update." }
    }
}
