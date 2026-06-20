"use server"

import supabaseAdmin from "@/supabase/admin"
import { requireProjectAccess } from "@/lib/auth-guard"

/**
 * Server actions for the dashboard "Schválení" (Approvals) tab — the human side
 * of the agent safety rails (Fáze 3). High-risk agent actions wait here for a
 * one-click approve/reject before anything runs.
 */

export interface PendingApprovalDTO {
    id: string
    agentType: string
    action: string
    riskTier: string
    payload: Record<string, unknown>
    createdAt: string
}

export async function getPendingApprovals(projectSlug: string): Promise<PendingApprovalDTO[]> {
    const { clientId } = await requireProjectAccess(projectSlug)
    const { listPendingApprovals } = await import("@/lib/agent-safety")
    const rows = await listPendingApprovals(clientId)
    return rows.map(r => ({
        id: r.id,
        agentType: r.agentType,
        action: r.action,
        riskTier: r.riskTier,
        payload: r.payload,
        createdAt: r.createdAt,
    }))
}

/** Verify the action belongs to this tenant before any decision. */
async function assertActionInProject(actionId: string, clientId: string): Promise<boolean> {
    const { data } = await supabaseAdmin
        .from("agent_actions")
        .select("client_id")
        .eq("id", actionId)
        .single()
    return !!data && data.client_id === clientId
}

export async function approveAgentAction(projectSlug: string, actionId: string): Promise<{ ok: boolean; error?: string }> {
    const { clientId, email } = await requireProjectAccess(projectSlug)
    if (!(await assertActionInProject(actionId, clientId))) return { ok: false, error: "Akce nepatří tomuto projektu." }
    const { approveAction } = await import("@/lib/agent-safety")
    return approveAction(actionId, email)
}

export async function rejectAgentAction(projectSlug: string, actionId: string): Promise<{ ok: boolean; error?: string }> {
    const { clientId, email } = await requireProjectAccess(projectSlug)
    if (!(await assertActionInProject(actionId, clientId))) return { ok: false, error: "Akce nepatří tomuto projektu." }
    const { rejectAction } = await import("@/lib/agent-safety")
    return rejectAction(actionId, email)
}
