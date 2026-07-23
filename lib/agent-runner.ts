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

/** Heartbeat a running task's lease so a long handler can't be reclaimed mid-run. */
async function heartbeat(id: string): Promise<void> {
    await supabaseAdmin.from("agent_tasks").update({ lease: nowIso() }).eq("id", id)
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
    }
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
        // Heartbeat once mid-flight is overkill for short tasks; the lease covers
        // LEASE_MS. Long handlers should call heartbeat() themselves if needed.
        const outcome = await runTask(task)
        if (outcome === "done") done++
        else if (outcome === "retry") retried++
        else failed++
    }
    return { ran, done, failed, retried }
}

export { heartbeat }
