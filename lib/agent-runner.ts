/**
 * Durable agent-task runner (core hardening Fáze 2).
 * ===================================================
 * A generic queue on top of `agent_tasks`, generalizing the proven
 * ig_campaigns lease/heartbeat/resume pattern. Any agent is a `type` with a
 * registered handler — new agents need no new cron, just registerHandler().
 *
 * Server-only (uses the service-role client). The actual draining is kicked by
 * app/api/cron/agent-worker. Safety rails (audit log, approval gates) come in
 * Fáze 3 and will wrap runTask — this layer is just durable execution.
 */

import * as Sentry from "@sentry/nextjs"
import supabaseAdmin from "@/supabase/admin"

export interface AgentTask {
    id: string
    client_id: string | null
    type: string
    payload: Record<string, unknown>
    attempts: number
    max_attempts: number
}

/** A handler does the work for one task type and returns a JSON-serializable result. */
export type TaskHandler = (task: AgentTask) => Promise<unknown>

const LEASE_MS = 5 * 60 * 1000 // a claim older than this is considered dead → reclaimable

// Module-level registry. Handlers are registered once at import time (see
// lib/agents/handlers.ts) and looked up by the worker per task.
const handlers = new Map<string, TaskHandler>()

export function registerHandler(type: string, fn: TaskHandler): void {
    handlers.set(type, fn)
}

export function hasHandler(type: string): boolean {
    return handlers.has(type)
}

const nowIso = () => new Date().toISOString()

/** Enqueue a task. Returns the new task id. */
export async function enqueueTask(opts: {
    type: string
    payload?: Record<string, unknown>
    clientId?: string | null
    scheduledFor?: Date
    priority?: number
    maxAttempts?: number
    /** Auth user who asked for this task. NULL = system task (cron, webhook).
     *  Onboarding runs BEFORE a client row exists, so client_id can't authorize the
     *  poll — this is what the status route checks instead. Typed column, not a
     *  payload key: payload means "handler input" across all handlers, and a typo in
     *  a column name is a Postgres error while a typo in payload.userId is invisible. */
    requestedBy?: string | null
}): Promise<string> {
    const { data, error } = await supabaseAdmin
        .from("agent_tasks")
        .insert({
            type: opts.type,
            payload: opts.payload || {},
            client_id: opts.clientId ?? null,
            scheduled_for: (opts.scheduledFor || new Date()).toISOString(),
            priority: opts.priority ?? 0,
            max_attempts: opts.maxAttempts ?? 3,
            requested_by: opts.requestedBy ?? null,
        })
        .select("id")
        .single()
    if (error || !data) throw new Error(`enqueueTask failed: ${error?.message}`)
    return data.id
}

/**
 * Atomically claim one runnable task (lease it).
 *
 * NOTE: PostgREST rejects `.or()` on UPDATE (it silently matches nothing), so —
 * exactly like campaign-worker — "lease is null OR stale" is expressed as two
 * sequential conditional updates; at most one matches.
 */
async function claimNext(): Promise<AgentTask | null> {
    const staleBefore = new Date(Date.now() - LEASE_MS).toISOString()

    const { data: candidates } = await supabaseAdmin
        .from("agent_tasks")
        .select("id")
        .in("status", ["pending", "running"])
        .lte("scheduled_for", nowIso())
        .or(`lease.is.null,lease.lt.${staleBefore}`)
        .order("priority", { ascending: false })
        .order("scheduled_for", { ascending: true })
        .limit(5)

    const tryClaim = async (id: string, leaseNull: boolean): Promise<AgentTask | null> => {
        let q = supabaseAdmin
            .from("agent_tasks")
            .update({ status: "running", lease: nowIso() })
            .eq("id", id)
            .in("status", ["pending", "running"])
        q = leaseNull ? q.is("lease", null) : q.lt("lease", staleBefore)
        const { data, error } = await q.select("*").maybeSingle()
        if (error) console.warn(`⚠️ agent-runner claim error (${id}): ${error.message}`)
        return (data as AgentTask) || null
    }

    for (const c of candidates || []) {
        const claimed = (await tryClaim(c.id, true)) || (await tryClaim(c.id, false))
        if (claimed) return claimed
    }
    return null
}

/**
 * Beat a running task's lease so a long handler can't be reclaimed mid-run.
 *
 * The `status = running` filter matters: without it a zombie beat from a worker that
 * already lost the row (stale interval on a reused Fluid instance) resurrects a lease
 * somebody else owns, or re-leases a task that already finished.
 */
async function beatLease(id: string): Promise<void> {
    const { error } = await supabaseAdmin
        .from("agent_tasks")
        .update({ lease: nowIso() })
        .eq("id", id)
        .eq("status", "running")
    if (error) console.warn(`⚠️ agent-runner lease heartbeat failed (${id}): ${error.message}`)
}

/** Run one task through its handler; mark done, or failed/retry on error. */
async function runTask(task: AgentTask): Promise<"done" | "failed" | "retry" | "no_handler"> {
    const handler = handlers.get(task.type)
    if (!handler) {
        await supabaseAdmin.from("agent_tasks")
            .update({ status: "failed", error: `No handler for type '${task.type}'`, lease: null })
            .eq("id", task.id)
        // Misconfiguration (a task enqueued for a type nobody registered) — surface
        // it in real time, not just in agent_tasks.error / the daily health digest.
        Sentry.captureException(new Error(`agent-runner: no handler for type '${task.type}'`), {
            tags: { agent_task_type: task.type, task_id: task.id },
        })
        return "no_handler"
    }

    const attempts = (task.attempts || 0) + 1

    // ── Independent lease heartbeat ───────────────────────────────────────
    // claimNext() reclaims any task whose lease is older than LEASE_MS and never reads
    // `attempts` — so a handler running longer than LEASE_MS gets claimed a SECOND time
    // while still alive, and both copies run concurrently. That is NOT a retry, so
    // max_attempts cannot stop it; for an AI handler it simply means paying twice. The
    // cron fires every minute with maxDuration 800, so invocations overlap and this race
    // is routine, not exotic.
    //
    // Beat the lease here rather than in each handler: the lease belongs to the runner
    // (AgentTask deliberately doesn't even expose it), and handlers like the onboarding
    // ones are also called from plain `tsx` scripts that have no task at all. Same shape
    // as campaign-worker's heartbeat. MUST be cleared on every exit path — a zombie
    // interval on a reused Fluid instance would re-lease a task the next tick may claim.
    const heartbeat = setInterval(() => { void beatLease(task.id) }, 60_000)

    try {
        const result = await handler(task)
        await supabaseAdmin.from("agent_tasks")
            .update({ status: "done", attempts, result: (result ?? null) as never, error: null, lease: null })
            .eq("id", task.id)
        return "done"
    } catch (err) {
        const msg = (err as Error)?.message?.slice(0, 500) || String(err)
        const willRetry = attempts < (task.max_attempts || 3)
        await supabaseAdmin.from("agent_tasks")
            .update({
                status: willRetry ? "pending" : "failed",
                attempts,
                error: msg,
                lease: null,
                // simple linear backoff before the next attempt
                scheduled_for: willRetry ? new Date(Date.now() + attempts * 30_000).toISOString() : nowIso(),
            })
            .eq("id", task.id)
        // Report only TERMINAL failures — retries are expected and self-heal, so
        // capturing them would be noise. The catch here means the error never
        // propagates to Sentry's onRequestError, so without this a dead ops agent
        // is invisible in real time (only the daily health digest would catch it).
        if (!willRetry) {
            Sentry.captureException(err, {
                tags: { agent_task_type: task.type, task_id: task.id, attempts: String(attempts) },
            })
        }
        return willRetry ? "retry" : "failed"
    } finally {
        clearInterval(heartbeat)
    }
}

/**
 * Claim and run exactly ONE task by id. The browser-kick path: a start action enqueues,
 * the browser POSTs /api/onboarding/run-task, and work begins immediately instead of
 * waiting up to 60s for the next cron tick. The cron stays the safety net — a kick that
 * never lands (closed tab, dead lambda, `Failed to fetch`) costs latency, not the task.
 *
 * Conditional claim, never an insert fallback (CLAUDE.md): no row back means the cron
 * already owns it, which is a normal outcome, not an error — the caller polls either way.
 */
export async function runTaskById(id: string): Promise<{ ran: boolean; outcome?: string; reason?: string }> {
    const { data: claimed, error } = await supabaseAdmin
        .from("agent_tasks")
        .update({ status: "running", lease: nowIso() })
        .eq("id", id)
        .eq("status", "pending")
        .is("lease", null)
        .select("*")
        .maybeSingle()

    if (error) {
        console.warn(`⚠️ runTaskById claim error (${id}): ${error.message}`)
        return { ran: false, reason: "claim_error" }
    }
    if (!claimed) return { ran: false, reason: "already_claimed" }

    return { ran: true, outcome: await runTask(claimed as AgentTask) }
}

/**
 * Drain runnable tasks until the time budget runs out or the queue is empty.
 * Returns a small summary. Called by the cron worker.
 */
export async function drainTasks(budgetMs = 700_000): Promise<{ ran: number; done: number; failed: number; retried: number }> {
    const t0 = Date.now()
    let ran = 0, done = 0, failed = 0, retried = 0

    while (Date.now() - t0 < budgetMs) {
        const task = await claimNext()
        if (!task) break // queue empty
        ran++
        // runTask beats the lease itself on a timer, so a handler that outlives LEASE_MS
        // can't be reclaimed and double-run. Handlers need do nothing.
        const outcome = await runTask(task)
        if (outcome === "done") done++
        else if (outcome === "retry") retried++
        else failed++
    }
    return { ran, done, failed, retried }
}

export { beatLease }
