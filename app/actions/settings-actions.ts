"use server"

import supabaseAdmin from "@/supabase/admin"
import { revalidatePath } from "next/cache"
import type { ClientConfig } from "@/instagram/configs/types"
import { requireProjectAccess } from "@/lib/auth-guard"
import { actionTranslator } from "@/lib/i18n/actions"

/**
 * Activate a FREE plan (e.g. Beta Trial) directly — no payment gateway.
 * Paid plans must go through /api/payments/create; this refuses them so a
 * paid tier can never be self-activated for free.
 */
export async function activateFreePlan(
    projectSlug: string,
    planId: string
): Promise<{ success: boolean; error?: string }> {
    const t = await actionTranslator("actionsAccount")
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        const { data: plan } = await supabaseAdmin
            .from("subscription_plans")
            .select("id, price_czk, is_active")
            .eq("id", planId)
            .single()

        if (!plan || !plan.is_active) return { success: false, error: t("settings.activateFreePlan.planNotFound") }
        if (plan.price_czk !== 0) return { success: false, error: t("settings.activateFreePlan.requiresPayment") }

        const { activatePaidPlan } = await import("@/lib/subscription")
        await activatePaidPlan(clientId, planId)

        return { success: true }
    } catch (err: any) {
        console.error("activateFreePlan error:", err?.message || err)
        return { success: false, error: err?.message || t("settings.activateFreePlan.failed") }
    }
}

export async function getClientConfig(projectId: string): Promise<ClientConfig | null> {
    try {
        await requireProjectAccess(projectId)
        // Přes loadConfig, ne surové JSONB: brána slug už přeložila a druhý dotaz
        // na `clients` byl loadConfig bez validateConfig — BrandTab tak viděl config
        // bez defaultů, které SettingsTab (config-actions) měl. Jedno pole, dvě pravdy.
        const { loadConfig } = await import("@/instagram/configs")
        return await loadConfig(projectId)
    } catch (err) {
        console.error("Exception fetching config:", err)
        return null
    }
}

export async function updateClientConfig(projectId: string, newConfig: any): Promise<{ success: boolean; error?: string }> {
    const t = await actionTranslator("actionsAccount")
    try {
        const { clientId } = await requireProjectAccess(projectId)
        // Validation - verify the config is valid JSON and has minimum required fields
        if (!newConfig || typeof newConfig !== "object") {
            return { success: false, error: t("settings.updateClientConfig.invalidFormat") }
        }

        // Staré kategorie pilířů — po uložení se porovnají s novými (fronta na zařazení nápadů).
        const { data: before } = await supabaseAdmin.from("clients").select("config").eq("id", clientId).single()

        const { error } = await supabaseAdmin
            .from("clients")
            .update({ config: newConfig })
            .eq("id", clientId)

        if (error) {
            console.error("Supabase update error:", error)
            return { success: false, error: error.message }
        }

        // Invalidate config cache
        const { invalidateConfigCache } = await import("@/instagram/configs")
        invalidateConfigCache(projectId)

        if (newConfig.contentPillars) {
            const { enqueueReclassifyIfCategoriesChanged } = await import("@/lib/agents/idea-replenish")
            await enqueueReclassifyIfCategoriesChanged(clientId, projectId, (before?.config as any)?.contentPillars, newConfig.contentPillars)
        }

        // Revalidate the app to reflect changes
        revalidatePath("/dashboard")

        return { success: true }
    } catch (err: any) {
        console.error("Exception checking config:", err)
        return { success: false, error: err.message || "Unknown error during update." }
    }
}
