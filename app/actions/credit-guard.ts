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

import { after } from "next/server"
import {
    canPerformAction,
    canPerformBatchAction,
    incrementPlanPostCount,
    decrementPlanPostCount,
    reserveCredits,
    releaseCredits,
    settleReservation,
    shrinkReservation,
    getClientSubscription,
    extraCreditPriceLabel,
    type ActionType,
    ACTION_CREDITS,
    ACTION_LABELS,
} from "@/lib/subscription"
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
        // Cenu určuje `canPerformAction`, guard ji NEPŘEPOČÍTÁVÁ. Do 9/2026 tu
        // stálo `creditsForAction(action, medium)`, což zahodilo jedinou hodnotu,
        // kterou se kontrola liší od výpočtu: `ADMIN_BYPASS` vrací 0. Super admin
        // tak spadl do větve s rezervací a na čerstvém klientovi (`trial_v2`,
        // nula kreditů) mu vlastní aplikace odmítla vygenerovat příspěvek —
        // přestože přes plán/kampaň (`options.adminBypass`) prošel. Dvě místa,
        // která počítají cenu, jsou dvě pravdy; tohle je to podřízené.
        const creditsRequired = check.creditsRequired

        // ── Rezervace PŘED prací ────────────────────────────────────────────
        //
        // Do 9/2026 se kredity strhávaly až v `commit()`, tedy po dokončení AI
        // operace. `canPerformAction` mezitím jen ČETL zůstatek, takže souběžné
        // požadavky přečetly totéž a prošly všechny — zákazník s jedním kreditem
        // uměl spustit padesát generování a zaplatit za jedno.
        //
        // Teď se odečítá dopředu, pod zámkem na klienta (`reserveCredits`).
        // Cena za to je, že selhaná práce musí kredity vrátit — o to se stará
        // automatické uvolnění níž, ne volající.
        let reservationId: string | null = null
        if (isPlanPost) {
            // Plánovaný příspěvek nestojí kredity, ale čítač má tentýž závod.
            await incrementPlanPostCount(clientId)
        } else if (creditsRequired > 0) {
            const sub = await getClientSubscription(clientId)
            const reservation = await reserveCredits({
                clientId,
                action,
                credits: creditsRequired,
                monthly: sub?.features?.credits_per_month ?? 0,
                description: ACTION_LABELS[action],
            })
            if (!reservation.reserved) {
                return {
                    ok: false,
                    error:
                        `Nedostatek kreditů. Potřebujete ${creditsRequired}, zbývá ${Math.max(0, reservation.remaining)}. ` +
                        `Dobijte si kredity za ${extraCreditPriceLabel(sub?.features)}/ks.`,
                    clientId,
                    isPlanPost: false,
                    creditsRequired,
                    commit: async () => {},
                }
            }
            reservationId = reservation.reservationId
        }

        // ── Automatické vrácení, když `commit()` nepřijde ────────────────────
        //
        // `after()` běží po odeslání odpovědi, a to i když akce vyhodila výjimku.
        // Díky tomu nemuselo do chybové cesty sáhnout ani jedno ze čtrnácti
        // volajících míst — a hlavně: na žádné se nedá zapomenout.
        //
        // Mimo request (skripty, CLI) `after()` neexistuje. Tam se rezervace
        // nevrátí sama, což je stejné chování, jaké má dneska fronta generování:
        // účtuje dopředu a vrací explicitně.
        let settled = false
        const releaseIfUnused = async () => {
            if (settled) return
            settled = true
            if (isPlanPost) await decrementPlanPostCount(clientId)
            else await releaseCredits(reservationId)
            console.warn(`↩️ Kredity vráceny: akce „${action}" pro ${clientId} neskončila potvrzením.`)
        }
        try {
            after(() => releaseIfUnused())
        } catch {
            console.warn(`creditGuard: mimo request — rezervace akce „${action}" se sama nevrátí.`)
        }

        return {
            ok: true,
            clientId,
            isPlanPost,
            creditsRequired,
            commit: async (description?: string, referenceId?: string) => {
                settled = true
                if (isPlanPost) return // čítač už se zvýšil při rezervaci
                await settleReservation(
                    reservationId,
                    description || ACTION_LABELS[action],
                    referenceId,
                )
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

        // Celá dávka se rezervuje dopředu — jinak by platil týž závod jako
        // u jednotlivé akce, jen znásobený počtem položek.
        //
        // Kolik, to říká kontrola, ne přepočet — stejný důvod jako u jednotlivé
        // akce výš. Nula znamená „neúčtuje se" (super admin) a rezervace se
        // přeskočí celá; `reservationId` pak zůstane `null` a `releaseCredits`,
        // `shrinkReservation` i `settleReservation` ho berou jako no-op.
        const creditsPerAction = ACTION_CREDITS[action]
        const totalCredits = check.creditsRequired
        let reservationId: string | null = null

        if (totalCredits > 0) {
            const sub = await getClientSubscription(clientId)
            const reservation = await reserveCredits({
                clientId,
                action,
                credits: totalCredits,
                monthly: sub?.features?.credits_per_month ?? 0,
                description: `${ACTION_LABELS[action]} ×${count} (rezervace)`,
            })
            if (!reservation.reserved) {
                return {
                    ok: false,
                    error:
                        `Nedostatek kreditů pro dávku. Potřebujete ${totalCredits}, ` +
                        `zbývá ${Math.max(0, reservation.remaining)}.`,
                    clientId,
                    commitCount: async () => {},
                }
            }
            reservationId = reservation.reservationId
        }

        let settled = false
        try {
            after(() => {
                if (settled) return
                settled = true
                void releaseCredits(reservationId)
                console.warn(`↩️ Kredity vráceny: dávka „${action}" pro ${clientId} neskončila potvrzením.`)
            })
        } catch {
            console.warn(`creditGuardBatch: mimo request — rezervace dávky „${action}" se sama nevrátí.`)
        }

        return {
            ok: true,
            clientId,
            commitCount: async (successCount: number, description?: string) => {
                settled = true
                // Účtuje se jen to, co skutečně prošlo — zbytek rezervace se vrací.
                await shrinkReservation(reservationId, creditsPerAction * Math.max(0, successCount))
                if (successCount > 0) {
                    await settleReservation(
                        reservationId,
                        description || `${ACTION_LABELS[action]} ×${successCount}`,
                    )
                }
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
