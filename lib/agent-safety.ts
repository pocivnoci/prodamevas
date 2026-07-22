/**
 * Agent action safety rails (core hardening Fáze 3).
 * ===================================================
 * Every action an agent wants to take goes through requestAction(). It records
 * the action in agent_actions (audit trail) and decides, by risk tier, whether
 * to run it now or hold it for human approval:
 *
 *   reversible | internal   → auto-approve, dispatch immediately
 *   outbound | spending | irreversible → 'proposed', wait for a human
 *
 * Approved/auto actions execute as an agent_tasks task (Fáze 2 runner), so the
 * safety layer never executes work itself — it gates and audits. Default-deny:
 * anything that touches customers or money cannot run unseen.
 */

import supabaseAdmin from "@/supabase/admin"
import { enqueueTask } from "@/lib/agent-runner"

export type RiskTier = "reversible" | "internal" | "outbound" | "spending" | "irreversible"

/** Tiers that may run without human sign-off. Everything else needs approval. */
const AUTO_TIERS: ReadonlySet<RiskTier> = new Set<RiskTier>(["reversible", "internal"])

export function needsApproval(tier: RiskTier): boolean {
    return !AUTO_TIERS.has(tier)
}

export interface ActionRequest {
    clientId?: string | null
    agentType: string
    action: string
    riskTier: RiskTier
    /** agent_tasks handler to run when approved/auto (omit for a pure audit entry). */
    taskType?: string
    payload?: Record<string, unknown>
    /** Simulate only — record as proposed, never dispatch. */
    dryRun?: boolean
    /**
     * E-mail the founder when the action lands as pending_approval (default true).
     * Batch proposers (lifecycle scan) set false and send one digest instead.
     */
    notify?: boolean
}

export type ActionOutcome =
    | { status: "executed"; actionId: string; taskId?: string } // auto-approved + dispatched
    | { status: "pending_approval"; actionId: string }          // waiting for a human
    | { status: "dry_run"; actionId: string }                   // simulated only

const nowIso = () => new Date().toISOString()

async function insertAction(req: ActionRequest, status: string, actor: string) {
    const { data, error } = await supabaseAdmin
        .from("agent_actions")
        .insert({
            client_id: req.clientId ?? null,
            agent_type: req.agentType,
            action: req.action,
            risk_tier: req.riskTier,
            status,
            task_type: req.taskType ?? null,
            payload: req.payload || {},
            actor,
        })
        .select("id")
        .single()
    if (error || !data) throw new Error(`agent_actions insert failed: ${error?.message}`)
    return data.id as string
}

async function dispatch(actionId: string, req: ActionRequest): Promise<string | undefined> {
    if (!req.taskType) return undefined
    const taskId = await enqueueTask({
        type: req.taskType,
        payload: { ...(req.payload || {}), agentActionId: actionId },
        clientId: req.clientId ?? null,
    })
    await supabaseAdmin.from("agent_actions").update({ status: "executed" }).eq("id", actionId)
    return taskId
}

/**
 * The single entry point an agent uses to do something. Records + gates + (maybe)
 * dispatches. Never executes work inline — dispatch goes through the task runner.
 */
export async function requestAction(req: ActionRequest): Promise<ActionOutcome> {
    if (req.dryRun) {
        const actionId = await insertAction(req, "proposed", "dry-run")
        return { status: "dry_run", actionId }
    }

    if (needsApproval(req.riskTier)) {
        // High-risk → hold for a human. Nothing dispatched.
        const actionId = await insertAction(req, "proposed", "system")
        if (req.notify !== false) {
            // Fire & forget — a failed e-mail must never break the proposing flow.
            try {
                const { notifyPendingApproval } = await import("@/lib/agents/approval-notify")
                await notifyPendingApproval({
                    actionId,
                    clientId: req.clientId,
                    agentType: req.agentType,
                    action: req.action,
                    riskTier: req.riskTier,
                    payload: req.payload,
                })
            } catch (err) {
                console.warn(`agent-safety: approval notify failed: ${(err as Error)?.message}`)
            }
        }
        return { status: "pending_approval", actionId }
    }

    // Low-risk → auto-approve and dispatch.
    const actionId = await insertAction(req, "approved", "auto")
    const taskId = await dispatch(actionId, req)
    return { status: "executed", actionId, taskId }
}

export interface PendingAction {
    id: string
    clientId: string | null
    agentType: string
    action: string
    riskTier: RiskTier
    payload: Record<string, unknown>
    createdAt: string
}

/** Pending approvals (optionally scoped to a tenant), oldest first. */
export async function listPendingApprovals(clientId?: string): Promise<PendingAction[]> {
    let q = supabaseAdmin
        .from("agent_actions")
        .select("id, client_id, agent_type, action, risk_tier, payload, created_at")
        .eq("status", "proposed")
        .order("created_at", { ascending: true })
    if (clientId) q = q.eq("client_id", clientId)
    const { data } = await q
    return (data || []).map(r => ({
        id: r.id,
        clientId: r.client_id,
        agentType: r.agent_type,
        action: r.action,
        riskTier: r.risk_tier,
        payload: r.payload || {},
        createdAt: r.created_at,
    }))
}

/** Approve a pending action → dispatch its task. Returns false if not pending. */
export async function approveAction(actionId: string, actor: string): Promise<{ ok: boolean; taskId?: string; error?: string }> {
    const { data: action } = await supabaseAdmin
        .from("agent_actions")
        .select("id, status, agent_type, action, risk_tier, task_type, payload, client_id")
        .eq("id", actionId)
        .single()
    if (!action) return { ok: false, error: "Akce nenalezena." }
    if (action.status !== "proposed") return { ok: false, error: `Akci nelze schválit (stav: ${action.status}).` }

    await supabaseAdmin.from("agent_actions").update({ status: "approved", actor }).eq("id", actionId)
    const taskId = await dispatch(actionId, {
        clientId: action.client_id,
        agentType: action.agent_type,
        action: action.action,
        riskTier: action.risk_tier as RiskTier,
        taskType: action.task_type || undefined,
        payload: (action.payload || {}) as Record<string, unknown>,
    })
    return { ok: true, taskId }
}

/** Reject a pending action → nothing runs. */
export async function rejectAction(actionId: string, actor: string): Promise<{ ok: boolean; error?: string }> {
    const { data, error } = await supabaseAdmin
        .from("agent_actions")
        .update({ status: "rejected", actor })
        .eq("id", actionId)
        .eq("status", "proposed")
        .select("id")
        .maybeSingle()
    if (error) return { ok: false, error: error.message }
    if (!data) return { ok: false, error: "Akci nelze zamítnout (už není ve stavu proposed)." }
    return { ok: true }
}
