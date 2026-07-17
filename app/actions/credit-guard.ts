"use server"

/**
 * Credit Guard — server action wrapper (v2)
 * ==========================================
 * Wraps any AI action with credit check + deduction.
 * 
 * Plan posts: commit() increments plan counter (no credit cost).
 * Extra posts: commit() deducts credits as before.
 * 
 * Single action:
 *   const guard = await creditGuard(projectId, "post")
 *   if (!guard.ok) return { success: false, error: guard.error }
 *   ... do work ...
 *   await guard.commit("Post: Letní kolekce")
 * 
 * Batch action:
 *   const guard = await creditGuardBatch(projectId, "post", 7)
 *   if (!guard.ok) return { success: false, error: guard.error }
 *   ... do work (returns actual success count) ...
 *   await guard.commitCount(successCount, "Batch: 5/7 postů")
 */

import {
    canPerformAction,
    canPerformBatchAction,
    deductCredits,
    incrementPlanPostCount,
    creditsForAction,
    type ActionType,
    ACTION_CREDITS,
    ACTION_LABELS,
} from "@/lib/subscription"
import supabaseAdmin from "@/supabase/admin"
import { requireProjectAccess } from "@/lib/auth-guard"

export interface CreditGuardResult {
    ok: boolean
    error?: string
    clientId: string
    /** True if this is a plan post (no credit cost) */
    isPlanPost: boolean
    /** Credits this action will deduct on commit (media-weighted; 0 for plan posts) */
    creditsRequired: number
    /** Call after successful AI operation to deduct credits or increment plan counter */
    commit: (description?: string, referenceId?: string) => Promise<void>
}

export interface CreditGuardBatchResult {
    ok: boolean
    error?: string
    clientId: string
    /** Call after batch completes — deducts credits only for successful items */
    commitCount: (successCount: number, description?: string) => Promise<void>
}

/**
 * Check if a project can perform a single action and return a commit function.
 */
export async function creditGuard(
    projectId: string,
    action: ActionType,
    /** If true, always treat as extra post (costs credits even if plan has capacity) */
    isExtraPost?: boolean,
    /** Post medium (image/carousel/reel) — weights the credit cost for post actions */
    medium?: string | null,
): Promise<CreditGuardResult> {
    try {
        const { clientId } = await requireProjectAccess(projectId)
        const check = await canPerformAction(clientId, action, isExtraPost, medium)

        if (!check.allowed) {
            return {
                ok: false,
                error: check.reason || "Akce není povolena.",
                clientId,
                isPlanPost: false,
                creditsRequired: check.creditsRequired,
                commit: async () => {},
            }
        }

        const isPlanPost = !!check.isPlanPost
        const creditsRequired = isPlanPost ? 0 : creditsForAction(action, medium)

        return {
            ok: true,
            clientId,
            isPlanPost,
            creditsRequired,
            commit: async (description?: string, referenceId?: string) => {
                if (isPlanPost) {
                    // Plan post — increment counter, no credit deduction
                    await incrementPlanPostCount(clientId)
                } else {
                    // Extra post — deduct media-weighted credits
                    await deductCredits(
                        clientId,
                        action,
                        description || ACTION_LABELS[action],
                        referenceId,
                        creditsRequired,
                    )
                }
            },
        }
    } catch (err: any) {
        // All errors block the action — no silent bypass
        console.error("Credit guard error (blocking action):", err?.message)
        return {
            ok: false,
            error: err?.message?.includes('Neautorizovaný')
                ? err.message
                : "Nepodařilo se ověřit kredity. Zkuste to znovu.",
            clientId: projectId,
            isPlanPost: false,
            creditsRequired: 0,
            commit: async () => {},
        }
    }
}

/**
 * Check if a project can perform a batch of actions.
 * Validates total credits upfront, deducts only for actual successes.
 */
export async function creditGuardBatch(
    projectId: string,
    action: ActionType,
    count: number,
): Promise<CreditGuardBatchResult> {
    try {
        const { clientId } = await requireProjectAccess(projectId)
        const check = await canPerformBatchAction(clientId, action, count)

        if (!check.allowed) {
            return {
                ok: false,
                error: check.reason || "Nedostatek kreditů pro batch.",
                clientId,
                commitCount: async () => {},
            }
        }

        return {
            ok: true,
            clientId,
            commitCount: async (successCount: number, description?: string) => {
                if (successCount <= 0) return
                // Deduct credits only for items that actually succeeded
                const creditsPerAction = ACTION_CREDITS[action]
                const totalCredits = creditsPerAction * successCount
                await supabaseAdmin.from("credit_transactions").insert({
                    client_id: clientId,
                    action,
                    credits: totalCredits,
                    description: description || `${ACTION_LABELS[action]} ×${successCount}`,
                })
            },
        }
    } catch (err: any) {
        console.error("Credit guard batch error (blocking action):", err?.message)
        return {
            ok: false,
            error: err?.message?.includes('Neautorizovaný')
                ? err.message
                : "Nepodařilo se ověřit kredity. Zkuste to znovu.",
            clientId: projectId,
            commitCount: async () => {},
        }
    }
}

/**
 * Lightweight credit check for client components.
 * Returns only serializable data (no functions).
 * Use this for pre-flight checks before triggering generation.
 */
export async function canGenerate(
    projectId: string,
    count: number = 1,
    /** Media of the posts to generate (media-weighted credits: image 1 / carousel 3 /
     *  reel 5). Callers MUST pass these for carousel/reel — a flat 1-credit pre-check
     *  said "ok" while the server-side charge then rejected mid-run (a campaign could
     *  start and die on credits halfway through). Omitted = flat image cost (legacy). */
    mediums?: (string | null | undefined)[],
): Promise<{ ok: boolean; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectId)

        if (count <= 1) {
            const check = await canPerformAction(clientId, "post", undefined, mediums?.[0] || undefined)
            return { ok: check.allowed, error: check.reason }
        } else {
            // Same media-weighted total the campaign path uses (startCampaign / worker)
            const { creditsForMedia } = await import("@/lib/credits")
            const totalCredits = mediums?.length
                ? Array.from({ length: count }, (_, i) => creditsForMedia(mediums[i % mediums.length])).reduce((a, b) => a + b, 0)
                : undefined
            const check = await canPerformBatchAction(clientId, "post", count, totalCredits)
            return { ok: check.allowed, error: check.reason }
        }
    } catch (err: any) {
        return {
            ok: false,
            error: err?.message?.includes('Neautorizovaný')
                ? err.message
                : "Nepodařilo se ověřit kredity.",
        }
    }
}
