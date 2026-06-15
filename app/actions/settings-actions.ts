"use server"

import supabaseAdmin from "@/supabase/admin"
import { revalidatePath } from "next/cache"
import type { ClientConfig } from "@/instagram/configs/types"
import { requireProjectAccess } from "@/lib/auth-guard"

/**
 * Activate a FREE plan (e.g. Beta Trial) directly — no payment gateway.
 * Paid plans must go through /api/payments/create; this refuses them so a
 * paid tier can never be self-activated for free.
 */
export async function activateFreePlan(
    projectSlug: string,
    planId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        const { data: plan } = await supabaseAdmin
            .from("subscription_plans")
            .select("id, price_czk, is_active")
            .eq("id", planId)
            .single()

        if (!plan || !plan.is_active) return { success: false, error: "Plán nenalezen." }
        if (plan.price_czk !== 0) return { success: false, error: "Tento plán vyžaduje platbu." }

        const { activatePaidPlan } = await import("@/lib/subscription")
        await activatePaidPlan(clientId, planId)

        return { success: true }
    } catch (err: any) {
        console.error("activateFreePlan error:", err?.message || err)
        return { success: false, error: err?.message || "Aktivace plánu selhala." }
    }
}

export async function getClientConfig(projectId: string): Promise<ClientConfig | null> {
    try {
        await requireProjectAccess(projectId)
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
        await requireProjectAccess(projectId)
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

        return { success: true }
    } catch (err: any) {
        console.error("Exception checking config:", err)
        return { success: false, error: err.message || "Unknown error during update." }
    }
}
