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

// Weekly founder report: gather the week's numbers and e-mail them. Internal/auto.
registerHandler("weekly_report", async () => {
    const { buildWeeklyReport } = await import("@/lib/agents/weekly-report")
    const { sendEmail } = await import("@/lib/email")
    const to = process.env.REPORT_EMAIL || "thomas.pocar@gmail.com"
    const report = await buildWeeklyReport()
    const sent = await sendEmail({ to, subject: report.subject, html: report.html, text: report.text })
    return { ok: true, to, emailId: sent.id, subject: report.subject }
})

export {} // side-effect module
