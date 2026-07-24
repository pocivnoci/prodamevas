/**
 * Agent task handler registry.
 * ============================
 * Importing this module registers all known task-type handlers with the runner.
 * The cron worker imports it once before draining. New agents (support, ads, …)
 * add their registerHandler() call here.
 */

import { registerHandler, type AgentTask } from "@/lib/agent-runner"
import { getFounderEmail } from "@/lib/email"

// Health-check / smoke task: does nothing but confirm the runner executes it.
registerHandler("noop", async (task: AgentTask) => {
    return { ok: true, echo: task.payload ?? {}, ranAt: new Date().toISOString() }
})

// Weekly founder report: gather the week's numbers and e-mail them. Internal/auto.
registerHandler("weekly_report", async () => {
    const { buildWeeklyReport } = await import("@/lib/agents/weekly-report")
    const { sendEmail } = await import("@/lib/email")
    const to = getFounderEmail()
    if (!to) throw new Error("weekly_report: REPORT_EMAIL/SUPER_ADMIN_EMAILS není nastaveno")
    const report = await buildWeeklyReport()
    const sent = await sendEmail({ to, subject: report.subject, html: report.html, text: report.text })
    return { ok: true, to, emailId: sent.id, subject: report.subject }
})

// Daily ops health check: e-mails the founder ONLY when something is wrong.
registerHandler("health_check", async () => {
    const { buildHealthCheck, renderHealthAlert } = await import("@/lib/agents/health-check")
    const report = await buildHealthCheck()
    if (report.healthy) return { ok: true, healthy: true }

    const to = getFounderEmail()
    if (!to) throw new Error("health_check: REPORT_EMAIL/SUPER_ADMIN_EMAILS není nastaveno")
    const { sendEmail } = await import("@/lib/email")
    const alert = renderHealthAlert(report)
    const sent = await sendEmail({ to, subject: alert.subject, html: alert.html, text: alert.text })
    return { ok: true, healthy: false, problems: report.problems.map(p => p.title), emailId: sent.id }
})

// Daily lifecycle scan: proposes outbound e-mails (approval-gated) and sends the
// founder ONE digest with one-click approve/reject links per proposal.
registerHandler("lifecycle_scan", async () => {
    // No founder inbox → don't propose. scanLifecycle persists outbound-tier
    // proposals with notify:false, so without the digest below they'd accumulate
    // unseen and the once-ever dedupe would then block those customers forever.
    const to = getFounderEmail()
    if (!to) return { ok: true, proposed: 0, skipped: "no founder e-mail configured" }

    const { scanLifecycle } = await import("@/lib/agents/lifecycle")
    const proposals = await scanLifecycle()
    if (proposals.length === 0) return { ok: true, proposed: 0 }

    const { renderApprovalItem, wrapOpsEmail } = await import("@/lib/agents/approval-notify")
    const { sendEmail } = await import("@/lib/email")
    const items = proposals.map(p => renderApprovalItem(
        { actionId: p.actionId, clientId: p.clientId, agentType: "lifecycle", action: `${p.kind} → ${p.email}`, riskTier: "outbound" },
        p.label,
    )).join("")
    const html = wrapOpsEmail("Lifecycle e-maily ke schválení", `${proposals.length} návrhů · ${new Date().toLocaleDateString("cs-CZ")}`, items)
    await sendEmail({
        to,
        subject: `📬 ${proposals.length} lifecycle e-mailů ke schválení`,
        html,
        text: proposals.map(p => `${p.kind} → ${p.email}`).join("\n") + "\n\nSchval v dashboardu → Schválení.",
    })
    return { ok: true, proposed: proposals.length }
})

// Send one approved lifecycle e-mail. Runs only after founder approval (outbound
// tier) — the payload comes from the approved agent_actions row; client_id rides
// on the task itself.
registerHandler("send_lifecycle_email", async (task: AgentTask) => {
    const { sendLifecycleEmail } = await import("@/lib/agents/lifecycle")
    return sendLifecycleEmail({ ...task.payload, clientId: task.client_id })
})

// Daily auto-publish arming: for opted-in (config.autoPublish) + connected clients,
// arm `ready` posts → `scheduled` on cadence with a bounded forward buffer. No-op
// for everyone else. See lib/agents/auto-publish.ts for the safety invariants.
registerHandler("auto_publish_arm", async () => {
    const { armReadyPosts } = await import("@/lib/agents/auto-publish")
    const results = await armReadyPosts()
    const armed = results.reduce((s, r) => s + r.armed, 0)
    return { ok: true, clients: results.length, armed, results }
})

// Daily idea-bank replenishment: tops each active client's available idea pool
// up to a cadence-derived runway so plans never draw from a starved bank. Free,
// bounded, opt-out via config — see lib/agents/idea-replenish.ts invariants.
registerHandler("idea_replenish", async () => {
    const { replenishIdeaBanks } = await import("@/lib/agents/idea-replenish")
    const results = await replenishIdeaBanks()
    const added = results.reduce((s, r) => s + r.added, 0)
    return { ok: true, clients: results.length, added, results }
})

export {} // side-effect module
