"use server"

/**
 * Credit Guard — server action wrapper
 * =====================================
 * Wraps any AI action with credit check + deduction.
 * Use: const guard = await creditGuard(projectId, "post")
 *      if (!guard.ok) return { success: false, error: guard.error }
 *      ... do work ...
 *      await guard.commit("Post: Letní kolekce")
 */

import { resolveClientId } from "@/instagram/configs"
import {
    canPerformAction,
    deductCredits,
    type ActionType,
    ACTION_LABELS,
} from "@/lib/subscription"
import { createClient } from "@/supabase/server"

export interface CreditGuardResult {
    ok: boolean
    error?: string
    clientId: string
    /** Call after successful AI operation to deduct credits */
    commit: (description?: string, referenceId?: string) => Promise<void>
}

/**
 * Check if a project can perform an action and return a commit function.
 * 
 * @param projectId - The project slug or UUID
 * @param action - The action type (post, product_brief, etc.)
 * @returns Guard result with ok/error and commit function
 */
export async function creditGuard(
    projectId: string,
    action: ActionType,
): Promise<CreditGuardResult> {
    try {
        // Super-admin bypass — no credit checks, no deductions
        const admins = (process.env.SUPER_ADMIN_EMAILS || "").split(",").map(e => e.trim()).filter(Boolean)
        if (admins.length > 0) {
            const supabase = await createClient()
            const { data: { user } } = await supabase.auth.getUser()
            if (user?.email && admins.includes(user.email)) {
                const clientId = await resolveClientId(projectId)
                return {
                    ok: true,
                    clientId,
                    commit: async () => {}, // no-op — don't deduct credits for admins
                }
            }
        }

        const clientId = await resolveClientId(projectId)

        const check = await canPerformAction(clientId, action)

        if (!check.allowed) {
            return {
                ok: false,
                error: check.reason || "Akce není povolena.",
                clientId,
                commit: async () => {},
            }
        }

        return {
            ok: true,
            clientId,
            commit: async (description?: string, referenceId?: string) => {
                await deductCredits(
                    clientId,
                    action,
                    description || ACTION_LABELS[action],
                    referenceId,
                )
            },
        }
    } catch (err: any) {
        // If subscription system fails, allow the action (graceful degradation)
        console.warn("Credit guard error (allowing action):", err?.message)
        return {
            ok: true,
            clientId: projectId,
            commit: async () => {},
        }
    }
}
