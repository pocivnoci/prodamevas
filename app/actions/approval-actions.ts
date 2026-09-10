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
    /** Druh akce pro stálý souhlas; null = tuhle akci nelze zapnout natrvalo. */
    policyKey: string | null
    /** Český název druhu — do tlačítka „a příště se neptat". */
    policyLabel: string | null
}

/** Platný stálý souhlas, jak ho vidí dashboard. */
export interface AgentPolicyDTO {
    key: string
    label: string
    dailyCap: number
    usedToday: number
    decidedBy: string
    decidedAt: string
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

    const { policyLabel } = await import("@/lib/agent-policy")
    return rows.map(r => ({
        id: r.id,
        agentType: r.agentType,
        action: r.action,
        riskTier: r.riskTier,
        payload: r.payload,
        createdAt: r.createdAt,
        clientLabel: r.clientId ? labels.get(r.clientId) || r.clientId : null,
        policyKey: r.policyKey,
        policyLabel: r.policyKey ? policyLabel(r.policyKey) : null,
    }))
}

/**
 * Stálé souhlasy — co dnes systém dělá sám, protože mu to někdo jednou dovolil.
 *
 * Bez téhle obrazovky by souhlas šlo udělit (jedním klikem z e-mailu), ale
 * nešlo by ho najít ani vzít zpět. Nevratné zapnutí rozesílky je přesně ta věc,
 * u které musí být cesta ven stejně krátká jako cesta dovnitř.
 */
export async function getAgentPolicies(): Promise<AgentPolicyDTO[]> {
    await requireSuperAdmin()
    const { listActivePolicies, policyLabel, countUsedToday } = await import("@/lib/agent-policy")
    const policies = await listActivePolicies()
    return Promise.all(policies.map(async p => ({
        key: p.key,
        label: policyLabel(p.key),
        dailyCap: p.dailyCap,
        usedToday: await countUsedToday(p.key),
        decidedBy: p.decidedBy,
        decidedAt: p.decidedAt,
    })))
}

/** Zrušit stálý souhlas — akce toho druhu se zase začnou navrhovat. */
export async function revokeAgentPolicy(key: string): Promise<{ ok: boolean; error?: string }> {
    const { email } = await requireSuperAdmin()
    const { revokePolicy } = await import("@/lib/agent-policy")
    return revokePolicy(key, email)
}

export async function approveAgentAction(actionId: string): Promise<{ ok: boolean; error?: string }> {
    const { email } = await requireSuperAdmin()
    const { approveAction } = await import("@/lib/agent-safety")
    return approveAction(actionId, email)
}

/**
 * Schválit a uložit stálý souhlas s druhem — dashboardový protějšek třetího
 * tlačítka z e-mailu.
 *
 * Pořadí je stejné jako v `/api/agent-approval`: nejdřív musí projít schválení
 * téhle konkrétní akce, teprve pak se zapíná pravidlo. Obráceně by kliknutí na
 * dávno rozhodnutou akci trvale zapnulo rozesílku.
 */
export async function approveAgentActionAlways(actionId: string): Promise<{ ok: boolean; error?: string }> {
    const { email } = await requireSuperAdmin()
    const { approveAction } = await import("@/lib/agent-safety")
    const res = await approveAction(actionId, email)
    if (!res.ok) return res
    if (!res.policyKey) return { ok: false, error: "Akce nemá druh, pro který by šel uložit stálý souhlas." }

    const { grantPolicy } = await import("@/lib/agent-policy")
    const granted = await grantPolicy(res.policyKey, email, { note: "schváleno z dashboardu" })
    // Akce už běží, takže tohle není celkové selhání — ale mlčet o něm nejde:
    // člověk by čekal, že se systém přestane ptát, a ono by se nic nezměnilo.
    return granted.ok ? { ok: true } : { ok: false, error: `Akce schválena, ale trvalé zapnutí selhalo: ${granted.error}` }
}

export async function rejectAgentAction(actionId: string): Promise<{ ok: boolean; error?: string }> {
    const { email } = await requireSuperAdmin()
    const { rejectAction } = await import("@/lib/agent-safety")
    return rejectAction(actionId, email)
}
