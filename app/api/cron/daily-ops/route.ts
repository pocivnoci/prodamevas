import { NextResponse } from "next/server"
import { requestAction } from "@/lib/agent-safety"

export const maxDuration = 60

/**
 * GET /api/cron/daily-ops
 *
 * Daily Vercel cron (05:30 UTC, vercel.json). Like weekly-report it does no work
 * itself — it dispatches through the agent stack (audit row + task), and
 * /api/cron/agent-worker runs the handlers within the minute:
 *
 *   lifecycle_scan    → proposes outbound lifecycle e-mails (approval-gated)
 *   auto_publish_arm  → arms ready posts for opted-in clients
 *   idea_replenish    → tops up idea banks
 *   voice_examples_promote → povyšuje ověřené posty na zlaté příklady hlasu
 *                       (jediné místo, kde se clients.config mění sám podle výsledků)
 *   incident_watch    → tells customers about background failures they can't see
 *   payment_reconcile → asks the gateway about payments stuck in PENDING
 *   daily_brief       → THE ONE e-mail to the founder; absorbs the former
 *                       health_check and compliance_check mails and renders every
 *                       pending approval with one-click buttons
 *
 * All dispatches are 'internal' risk (a scan sends nothing to customers — every
 * actual customer e-mail is its own proposal, `outbound` or `transactional`).
 *
 * ORDER MATTERS TWICE:
 *  - billing-worker runs at 04:00 UTC, before this cron, so the brief reports
 *    today's money rather than yesterday's (asserted in `npm run guard`);
 *  - daily_brief is dispatched with priority -10 so the runner drains it LAST
 *    within this wave and it observes the scans above it.
 *
 * Auth: CRON_SECRET bearer (no user session in cron).
 */
export async function GET(req: Request) {
    const secret = process.env.CRON_SECRET
    const auth = req.headers.get("authorization")
    if (!secret || auth !== `Bearer ${secret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const lifecycle = await requestAction({
        agentType: "lifecycle",
        action: "Denní lifecycle scan",
        riskTier: "internal",
        taskType: "lifecycle_scan",
        clientId: null,
        payload: {},
    })

    // Arm ready posts for opted-in + connected clients (config.autoPublish). Internal
    // risk: it only schedules a bounded buffer of already-generated posts onto the
    // client's own cadence — no new spend, no customer-facing action.
    const autoPublish = await requestAction({
        agentType: "ops",
        action: "Denní auto-publish arming",
        riskTier: "internal",
        taskType: "auto_publish_arm",
        clientId: null,
        payload: {},
    })

    // Top up idea banks that dropped under the cadence-derived runway
    // (config.autoReplenishIdeas, default on). Internal risk: output is inert
    // ig_post_ideas rows — nothing publishes, nothing is charged.
    const ideaReplenish = await requestAction({
        agentType: "ops",
        action: "Denní doplnění zásobníku nápadů",
        riskTier: "internal",
        taskType: "idea_replenish",
        clientId: null,
        payload: {},
    })

    // Povýšení ověřených postů na zlaté příklady hlasu — config se konečně učí
    // sám ze sebe. Internal risk: nic se neposílá ani neúčtuje, jen se z vlastních
    // naměřených postů klienta staví few-shot kotva pro copywritera.
    const voiceExamples = await requestAction({
        agentType: "ops",
        action: "Denní povýšení zlatých příkladů hlasu",
        riskTier: "internal",
        taskType: "voice_examples_promote",
        clientId: null,
        payload: {},
    })

    // Tichý support: co selhalo na pozadí, řekne produkt zákazníkovi sám.
    // Internal risk — sken nic neposílá; každé oznámení je vlastní `transactional`
    // akce s dedupe na id postu, takže jeden incident = nejvýš jeden e-mail.
    const incidents = await requestAction({
        agentType: "ops",
        action: "Denní kontrola selhání na pozadí",
        riskTier: "internal",
        taskType: "incident_watch",
        clientId: null,
        payload: {},
    })

    // Záchytná síť pro zaseklé platby: cílené doptání se plánuje hned při
    // založení platby, tenhle sweep chytá ty, o jejichž úkol přišel redeploy.
    // Internal risk — jen se ptá brány, co už se stalo.
    const reconcile = await requestAction({
        agentType: "billing",
        action: "Denní dohojení zaseklých plateb",
        riskTier: "internal",
        taskType: "payment_reconcile",
        clientId: null,
        payload: {},
    })

    // Ranní brief POSLEDNÍ ve vlně (priority -10): drainTasks řadí priority DESC,
    // takže brief poběží až po skenech výše a uvidí, co navrhly. Internal risk —
    // čte a píše jedinému čtenáři, zakladateli.
    const brief = await requestAction({
        agentType: "ops",
        action: "Ranní brief",
        riskTier: "internal",
        taskType: "daily_brief",
        clientId: null,
        payload: {},
        priority: -10,
    })

    return NextResponse.json({ success: true, lifecycle, autoPublish, ideaReplenish, voiceExamples, incidents, reconcile, brief })
}
