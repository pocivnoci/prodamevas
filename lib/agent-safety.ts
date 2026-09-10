/**
 * Agent action safety rails (core hardening Fáze 3).
 * ===================================================
 * Every action an agent wants to take goes through requestAction(). It records
 * the action in agent_actions (audit trail) and decides, by risk tier, whether
 * to run it now or hold it for human approval:
 *
 *   reversible | internal | transactional → auto-approve, dispatch immediately
 *   outbound | spending | irreversible    → 'proposed', wait for a human
 *
 * Approved/auto actions execute as an agent_tasks task (Fáze 2 runner), so the
 * safety layer never executes work itself — it gates and audits. Default-deny:
 * anything that touches customers or money cannot run unseen.
 *
 * STÁLÝ SOUHLAS (10. 9. 2026)
 * ---------------------------
 * Akce z horní skupiny se smí dispatchnout i bez dnešního kliku, když k jejímu
 * `policyKey` existuje platný souhlas v `agent_policies` a nevyčerpal se denní
 * strop (`lib/agent-policy.ts`). Důvod: za čtyři měsíce bylo navrženo 27 akcí
 * a schváleno nula — otázka „schválíš tenhle jeden e-mail?" kladená denně je
 * smyčka, která se nikdy nezavře. Stálý souhlas se ptá jednou na druh.
 *
 * Hranice se tím ale NEPOSOUVÁ: `AUTO_TIERS` zůstává beze změny a druh bez
 * uloženého rozhodnutí čeká na člověka jako dřív. Rozdíl je jen v tom, že
 * člověk smí odpovědět dopředu — a jeho odpověď je vidět v `actor`.
 *
 * `transactional` vs `outbound` — the line that decides what may leave the
 * building unattended:
 *
 *   transactional = goes to the customer, but it's a FIXED template stating a
 *     fact that already happened or is contractually certain (an upcoming
 *     charge, a failed payment, an expiry, an invoice, a post that failed to
 *     publish). Withholding it until the founder clicks would be worse than
 *     sending it. Pair it with sendNotification({ kind: "transactional" }).
 *   outbound = anything that persuades — a nudge, a winback, a drip. It waits.
 *
 * The tier exists so that automatic mail still leaves an agent_actions row:
 * without it there is no dedupe key and no source for the daily brief's
 * "what I did on my own" section. Never move `outbound` into AUTO_TIERS.
 */

import supabaseAdmin from "@/supabase/admin"
import { enqueueTask } from "@/lib/agent-runner"

export type RiskTier = "reversible" | "internal" | "transactional" | "outbound" | "spending" | "irreversible"

/** Tiers that may run without human sign-off. Everything else needs approval. */
const AUTO_TIERS: ReadonlySet<RiskTier> = new Set<RiskTier>(["reversible", "internal", "transactional"])

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
    /**
     * Queue priority for the dispatched task (drainTasks orders priority DESC).
     * Negative = run last in the wave — the daily brief uses -10 so it observes
     * the results of the scans dispatched alongside it in the same cron tick.
     */
    priority?: number
    /**
     * Druh akce pro stálý souhlas (`lib/agent-policy.ts`), např.
     * `lifecycle:winback`. Když k němu existuje platný souhlas a nevyčerpal se
     * denní strop, akce se dispatchne rovnou místo čekání na člověka.
     *
     * Schválně NEPOVINNÝ a bez odvozování z `taskType`: kdo klíč nepošle,
     * dostane dosavadní chování (zeptat se). Odvozený klíč by znamenal, že nový
     * agent zdědí cizí souhlas jen tím, že sáhl po stejném handleru —
     * `send_lifecycle_email` obsluhuje šest různých druhů e-mailu a souhlas
     * s připomínkou čekatelům není souhlas s oslovením po vypršení.
     */
    policyKey?: string
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
            policy_key: req.policyKey ?? null,
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
        priority: req.priority,
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
        // Rozhodl člověk dopředu, že tenhle DRUH akce má běžet sám? Pak se
        // neptáme podruhé. Auditní řádek vzniká pořád, jen s `actor` ve tvaru
        // `policy:<key>` — v logu tak jde odlišit klik od pravidla, a denní
        // strop se počítá právě z těch řádků.
        //
        // Tohle NENÍ díra v default-deny: `outbound` zůstává mimo `AUTO_TIERS`
        // a druh bez uloženého souhlasu čeká na člověka přesně jako dřív.
        const { canRunUnattended, POLICY_ACTOR_PREFIX } = await import("@/lib/agent-policy")
        const standing = await canRunUnattended(req.policyKey)
        if (standing.allowed) {
            const actionId = await insertAction(req, "approved", `${POLICY_ACTOR_PREFIX}${req.policyKey}`)
            const taskId = await dispatch(actionId, req)
            return { status: "executed", actionId, taskId }
        }

        // High-risk → hold for a human. Nothing dispatched.
        // Vyčerpaný strop se do `actor` zapíše, aby se v auditu nepletl
        // s „nikdo o tom nerozhodl" — jinak by člověk udělil souhlas, který
        // už má, a divil se, že se nic nezměnilo.
        const actor = standing.reason === "cap-reached" ? `system:cap:${req.policyKey}` : "system"
        const actionId = await insertAction(req, "proposed", actor)
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
                    policyKey: req.policyKey,
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
    /** Druh akce pro stálý souhlas; null = rozhoduje se pokaždé. */
    policyKey: string | null
}

/** Pending approvals (optionally scoped to a tenant), oldest first. */
export async function listPendingApprovals(clientId?: string): Promise<PendingAction[]> {
    let q = supabaseAdmin
        .from("agent_actions")
        .select("id, client_id, agent_type, action, risk_tier, payload, created_at, policy_key")
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
        policyKey: r.policy_key ?? null,
    }))
}

/** Approve a pending action → dispatch its task. Returns false if not pending. */
export async function approveAction(actionId: string, actor: string): Promise<{ ok: boolean; taskId?: string; error?: string; policyKey?: string }> {
    // Atomic claim: flip proposed→approved in a single guarded UPDATE (mirrors
    // rejectAction). A read-then-write would let two concurrent approvals — the
    // dashboard button and the e-mail one-click link firing at once — both pass a
    // status check and both dispatch, double-charging / double-e-mailing the customer.
    const { data: action, error } = await supabaseAdmin
        .from("agent_actions")
        .update({ status: "approved", actor })
        .eq("id", actionId)
        .eq("status", "proposed")
        .select("id, agent_type, action, risk_tier, task_type, policy_key, payload, client_id")
        .maybeSingle()
    if (error) return { ok: false, error: error.message }
    if (!action) {
        // Claim matched nothing: either the action is gone or no longer proposed.
        const { data: existing } = await supabaseAdmin.from("agent_actions").select("status").eq("id", actionId).maybeSingle()
        return { ok: false, error: existing ? `Akci nelze schválit (stav: ${existing.status}).` : "Akce nenalezena." }
    }

    const taskId = await dispatch(actionId, {
        clientId: action.client_id,
        agentType: action.agent_type,
        action: action.action,
        riskTier: action.risk_tier as RiskTier,
        taskType: action.task_type || undefined,
        payload: (action.payload || {}) as Record<string, unknown>,
    })
    return { ok: true, taskId, policyKey: action.policy_key || undefined }
}

/**
 * Kolik dní smí návrh čekat, než se sám zavře.
 *
 * Návrh na obchodní e-mail je nabídka reakce na okamžik — „zapsal se před
 * týdnem", „vypršelo mu předplatné". Po dvou týdnech ten okamžik pominul
 * a schválit ho znamená poslat zprávu, která se netrefila do ničeho.
 */
export const PROPOSAL_TTL_DAYS = 14

/**
 * Zavřít návrhy, na které se nikdo nepodíval včas.
 *
 * Fronta bez expirace je jen seznam, který roste: 8. 9. 2026 v něm čekalo
 * 27 akcí, nejstarší 46 dní, a nic z toho se už poslat nedalo. Seznam, který
 * se nedá dočíst, se přestane číst celý — a pak v něm uvázne i to, co odbavit
 * šlo. `expired` je vlastní stav schválně: `rejected` znamená „člověk řekl ne"
 * a kdyby se do něj vešlo i „nikdo se nepodíval", ztratí se rozdíl mezi
 * rozhodnutím a zapomenutím právě tam, kde je celý audit trail k něčemu.
 *
 * Podmíněný claim jako všude jinde v repu: `WHERE status = 'proposed'`.
 * Souběžné schválení tak nikdy neprohraje se sweeperem.
 */
export async function expireStaleProposals(ttlDays: number = PROPOSAL_TTL_DAYS): Promise<number> {
    const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await supabaseAdmin
        .from("agent_actions")
        .update({ status: "expired", actor: "system:expired" })
        .eq("status", "proposed")
        .lt("created_at", cutoff)
        .select("id")
    if (error) {
        console.error("expireStaleProposals:", error.message)
        return 0
    }
    return (data || []).length
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
