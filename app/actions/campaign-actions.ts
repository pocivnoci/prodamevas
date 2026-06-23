"use server"

import supabaseAdmin from "@/supabase/admin"
import { requireProjectAccess } from "@/lib/auth-guard"
import type { ContentPlanItem } from "./content-plan-actions"

// ─── Durable content-plan campaigns ──────────────────────────────────────────
// The old batch path ran a sequential loop in the BROWSER: each post is its own
// up-to-800s job, so a 7-post campaign needed the tab open & foregrounded for
// ~15 min. Closing/backgrounding the tab truncated it ("asked for 7, got 4").
// Now the approved plan is persisted as an ig_campaigns row and drained by a
// server worker (see app/api/cron/campaign-worker) — the tab can close freely.

export interface CampaignOptions {
    aspectRatio?: string
    medium?: string
    category?: string
    /** Campaign-wide topic, prefixed onto each item's hook (matches old per-post behaviour). */
    topic?: string
}

export interface CampaignStatus {
    id: string
    status: "pending" | "running" | "done" | "partial" | "failed"
    total: number
    cursor: number
    successes: number
    failures: number
    error?: string | null
}

/**
 * Persist an approved plan as a durable campaign and kick the worker.
 * Credits are checked up-front (early UX feedback) but charged per-post by the
 * worker as each post is actually generated — so a partial run only ever bills
 * for posts that shipped.
 */
export async function startCampaign(
    projectSlug: string,
    plan: ContentPlanItem[],
    options: CampaignOptions = {},
): Promise<{ success: boolean; campaignId?: string; error?: string }> {
    try {
        const { clientId, isSuperAdmin } = await requireProjectAccess(projectSlug)

        const items = (plan || []).filter(Boolean)
        if (items.length === 0) {
            return { success: false, error: "Plán je prázdný." }
        }

        // Reel gating once, up-front (same rule as ig-create-job).
        if (!isSuperAdmin && options.medium === "reel") {
            const { getClientSubscription, canUseMedium } = await import("@/lib/subscription")
            const sub = await getClientSubscription(clientId)
            if (!canUseMedium(sub?.features, "reel")) {
                return { success: false, error: "Reels jsou dostupné od balíčku Růst." }
            }
        }

        // Up-front capacity check for the whole batch (does NOT charge).
        const { canPerformBatchAction } = await import("@/lib/subscription")
        const check = await canPerformBatchAction(clientId, "post", items.length)
        if (!check.allowed) {
            return { success: false, error: check.reason || "Nedostatek kreditů pro celou kampaň." }
        }

        // Persist only the fields the worker needs to generate each post.
        // scheduledFor/timeSlot (from the planner) let the worker stamp the post's
        // posting time + calendar entry once it's generated.
        const { toScheduledFor } = await import("@/lib/schedule-planner")
        const planRows = items.map(it => ({
            postType: it.postType,
            hookPreview: it.hookPreview,
            topic: it.topic,
            angle: it.angle || null,
            productId: it.productId || null,
            scheduledFor: it.scheduledDate && it.scheduledTime
                ? toScheduledFor(it.scheduledDate, it.scheduledTime)
                : null,
            timeSlot: it.scheduledTime || null,
        }))

        const { data: campaign, error } = await supabaseAdmin
            .from("ig_campaigns")
            .insert({
                client_id: clientId,
                status: "pending",
                plan: planRows,
                options: {
                    // configName (slug) is needed by the worker for loadConfig/generateOnePost,
                    // which the cron can't re-derive (no user session to resolve project access).
                    configName: projectSlug,
                    aspectRatio: options.aspectRatio || null,
                    medium: options.medium || null,
                    category: options.category || null,
                    topic: options.topic || null,
                    // Carry the super-admin's billing bypass to the session-less worker, so a
                    // campaign that passed the bypassed up-front check isn't then killed at
                    // post 0 by the worker's real credit gate (the silent-death mismatch).
                    adminBypass: isSuperAdmin || undefined,
                },
                total: planRows.length,
            })
            .select("id")
            .single()

        if (error || !campaign) {
            throw new Error(`Failed to create campaign: ${error?.message}`)
        }

        // The every-minute cron (vercel.json → /api/cron/campaign-worker) claims and
        // starts this campaign within ≤60s. We deliberately do NOT self-fetch the
        // worker here: aborting that fetch to return fast could cancel the worker
        // mid-run (Fluid Compute honours request cancellation). Cron is the durable,
        // safe driver — a sub-minute start delay is fine for a multi-minute batch.
        return { success: true, campaignId: campaign.id }
    } catch (err: any) {
        return { success: false, error: err?.message || String(err) }
    }
}

/** Poll a campaign's progress. Safe to call from the browser; tab can be closed between calls. */
export async function getCampaignStatus(
    projectSlug: string,
    campaignId: string,
): Promise<{ success: boolean; campaign?: CampaignStatus; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const { data, error } = await supabaseAdmin
            .from("ig_campaigns")
            .select("id, client_id, status, total, cursor, successes, failures, error")
            .eq("id", campaignId)
            .single()

        if (error || !data) return { success: false, error: "Kampaň nenalezena." }
        if (data.client_id !== clientId) return { success: false, error: "Neautorizovaný přístup ke kampani." }

        return {
            success: true,
            campaign: {
                id: data.id,
                status: data.status,
                total: data.total,
                cursor: data.cursor,
                successes: data.successes,
                failures: data.failures,
                error: data.error,
            },
        }
    } catch (err: any) {
        return { success: false, error: err?.message || String(err) }
    }
}
