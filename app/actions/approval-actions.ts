"use server"

import supabaseAdmin from "@/supabase/admin"
import { requireSuperAdmin } from "@/lib/auth-guard"

/**
 * Server actions for the dashboard "Schválení" (Approvals) tab — the human side
 * of the agent safety rails (Fáze 3). High-risk agent actions wait here for a
 * one-click approve/reject before anything runs.
 *
 * Super-admin scope: the inbox shows ALL pending actions across tenants AND
 * system-level ops actions (client_id NULL) — those were previously invisible,
 * because the listing was client-scoped. The same decisions are also reachable
 * from the founder e-mail via signed one-click links (/api/agent-approval).
 */

export interface PendingApprovalDTO {
    id: string
    agentType: string
    action: string
    riskTier: string
    payload: Record<string, unknown>
    createdAt: string
    /** "Name (slug)" for tenant actions, null for system-level ops actions. */
    clientLabel: string | null
}

export async function getPendingApprovals(): Promise<PendingApprovalDTO[]> {
    await requireSuperAdmin()
    const { listPendingApprovals } = await import("@/lib/agent-safety")
    const rows = await listPendingApprovals() // unscoped → includes client_id NULL

    const clientIds = [...new Set(rows.map(r => r.clientId).filter((id): id is string => Boolean(id)))]
    const labels = new Map<string, string>()
    if (clientIds.length > 0) {
        const { data } = await supabaseAdmin.from("clients").select("id, name, slug").in("id", clientIds)
        for (const c of data || []) labels.set(c.id, `${c.name} (${c.slug})`)
    }

    return rows.map(r => ({
        id: r.id,
        agentType: r.agentType,
        action: r.action,
        riskTier: r.riskTier,
        payload: r.payload,
        createdAt: r.createdAt,
        clientLabel: r.clientId ? labels.get(r.clientId) || r.clientId : null,
    }))
}

export async function approveAgentAction(actionId: string): Promise<{ ok: boolean; error?: string }> {
    const { email } = await requireSuperAdmin()
    const { approveAction } = await import("@/lib/agent-safety")
    return approveAction(actionId, email)
}

export async function rejectAgentAction(actionId: string): Promise<{ ok: boolean; error?: string }> {
    const { email } = await requireSuperAdmin()
    const { rejectAction } = await import("@/lib/agent-safety")
    return rejectAction(actionId, email)
}
