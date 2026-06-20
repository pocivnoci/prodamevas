/**
 * Agent task handler registry.
 * ============================
 * Importing this module registers all known task-type handlers with the runner.
 * The cron worker imports it once before draining. New agents (email, ads, …)
 * add their registerHandler() call here.
 *
 * Fáze 2 ships only a `noop` handler — proof that the durable queue works
 * end-to-end. Real handlers arrive once the Fáze 3 safety rails are in place.
 */

import { registerHandler, type AgentTask } from "@/lib/agent-runner"

// Health-check / smoke task: does nothing but confirm the runner executes it.
registerHandler("noop", async (task: AgentTask) => {
    return { ok: true, echo: task.payload ?? {}, ranAt: new Date().toISOString() }
})

export {} // side-effect module
