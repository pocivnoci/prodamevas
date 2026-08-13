/**
 * Agent task handler registry.
 * ============================
 * Importing this module registers all known task-type handlers with the runner.
 * The cron worker imports it once before draining. New agents (support, ads, …)
 * add their registerHandler() call here.
 */

import supabaseAdmin from "@/supabase/admin"
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

// Ranní brief — JEDINÝ kanál z firmy k zakladateli. Pohlcuje bývalé samostatné
// e-maily health_check a compliance_check i lifecycle digest: ty moduly zůstávají
// detekčními knihovnami, ale poštu už nevlastní. Když je klid, nepošle se nic.
registerHandler("daily_brief", async () => {
    // Jeden brief denně je celá pointa — ruční curl na daily-ops ho nesmí poslat
    // podruhé. Vlastní task je v tuhle chvíli 'running', takže se nezapočítá.
    const midnight = new Date()
    midnight.setUTCHours(0, 0, 0, 0)
    const { count: alreadySent } = await supabaseAdmin
        .from("agent_tasks")
        .select("id", { count: "exact", head: true })
        .eq("type", "daily_brief")
        .eq("status", "done")
        .gte("created_at", midnight.toISOString())
    if ((alreadySent || 0) > 0) return { ok: true, skipped: "brief už dnes odešel" }

    const { buildDailyBrief, renderDailyBrief } = await import("@/lib/agents/daily-brief")
    const brief = await buildDailyBrief()
    if (brief.quiet) return { ok: true, quiet: true }

    const to = getFounderEmail()
    if (!to) throw new Error("daily_brief: REPORT_EMAIL/SUPER_ADMIN_EMAILS není nastaveno")
    const { sendEmail } = await import("@/lib/email")
    const mail = renderDailyBrief(brief)
    const sent = await sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text })
    return {
        ok: true,
        quiet: false,
        needsYou: brief.needsYou.length,
        money: brief.money.length,
        risk: brief.risk.length,
        system: brief.system.length,
        emailId: sent.id,
    }
})

// Daily lifecycle scan: proposes outbound e-mails (approval-gated). Sends NOTHING
// itself — the proposals surface in the morning brief's "co potřebuje tebe"
// section, which renders every `proposed` action regardless of which agent made it.
registerHandler("lifecycle_scan", async () => {
    // No founder inbox → don't propose. scanLifecycle persists outbound-tier
    // proposals with notify:false, so without a founder to approve them they'd
    // accumulate unseen and the once-ever dedupe would block those customers forever.
    const to = getFounderEmail()
    if (!to) return { ok: true, proposed: 0, skipped: "no founder e-mail configured" }

    const { scanLifecycle } = await import("@/lib/agents/lifecycle")
    const proposals = await scanLifecycle()
    return { ok: true, proposed: proposals.length, kinds: proposals.map(p => p.kind) }
})

// Send one approved lifecycle e-mail. Runs only after founder approval (outbound
// tier) — the payload comes from the approved agent_actions row; client_id rides
// on the task itself.
registerHandler("send_lifecycle_email", async (task: AgentTask) => {
    const { sendLifecycleEmail } = await import("@/lib/agents/lifecycle")
    return sendLifecycleEmail({ ...task.payload, clientId: task.client_id })
})

// Faktické oznámení zákazníkovi (blíží se stržení, platba selhala, příspěvek
// nevyšel). Tier `transactional` → dispatchuje se rovnou, bez čekání na člověka.
// Dedupe řeší proposeCustomerNotice ještě před založením akce.
registerHandler("send_customer_notice", async (task: AgentTask) => {
    const { sendCustomerNotice } = await import("@/lib/agents/customer-notices")
    return sendCustomerNotice({ ...task.payload, clientId: task.client_id })
})

// Tichý support: selhání NA POZADÍ, o kterých se zákazník jinak nedozví
// (naplánovaný příspěvek nevyšel, generování v kampani se nepovedlo). Interaktivní
// chyby se sem záměrně nepočítají — ty ukázalo UI v reálném čase.
registerHandler("incident_watch", async () => {
    const { notifyIncidents } = await import("@/lib/agents/incident-watch")
    return notifyIncidents()
})

// Doptání brány na visící platbu. S `paymentId` cíleně (naplánováno ~20 min po
// založení platby), bez něj denní sweep přes všechny PENDING řádky.
registerHandler("payment_reconcile", async (task: AgentTask) => {
    const { reconcilePayment, reconcilePendingPayments } = await import("@/lib/agents/payment-reconcile")
    const paymentId = task.payload?.paymentId
    return typeof paymentId === "string"
        ? reconcilePayment(paymentId)
        : reconcilePendingPayments()
})

// Ruční oprava „zaplaceno, plán NEAKTIVOVÁN". Běží až po schválení člověkem
// (irreversible) — schválení JE ta oprava. Aktivace je idempotentní přes
// activatePaidPlan, takže omylem dvakrát schválené nic nerozbije.
registerHandler("repair_activation", async (task: AgentTask) => {
    const paymentId = String(task.payload?.paymentId || "")
    if (!paymentId) throw new Error("repair_activation: chybí paymentId")

    const { data: payment } = await supabaseAdmin
        .from("payments")
        .select("id, subscription_id, client_id, ref_id, payer_email, amount, currency, label, status")
        .eq("id", paymentId)
        .maybeSingle()
    if (!payment) throw new Error(`repair_activation: platba ${paymentId} nenalezena`)
    if (payment.status !== "PAID") return { ok: false, skipped: `platba není PAID (${payment.status})` }

    const { finalizePaidPayment, deliverPaidArtifacts } = await import("@/lib/payments/on-paid")
    const { isRenewalRefId } = await import("@/lib/payments/ref-id")
    const result = await finalizePaidPayment(payment, {
        provider: "comgate",
        isRenewal: isRenewalRefId(payment.ref_id),
        recurringToken: null,
        // Oprava ostré platby — doklad se vystavit MÁ, právě ten při selhání chybí.
        sandbox: false,
    })
    if (!result.activated) throw new Error(`repair_activation: aktivace znovu selhala (${paymentId})`)

    await deliverPaidArtifacts(payment, result)
    return { ok: true, paymentId, planId: result.planId }
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

// Povýšení ověřených postů na zlaté příklady hlasu. Jediné místo, kde se
// clients.config mění sám podle výsledků — zbytek učicí vrstvy jen přepočítává
// váhy za běhu a po doběhnutí je zahodí. Zdarma, bez volání modelu, a zasetou
// kotvu nahradí jen post s reálně naměřeným výkonem.
// Viz lib/agents/voice-examples.ts.
registerHandler("voice_examples_promote", async () => {
    const { promoteVoiceExamples } = await import("@/lib/agents/voice-examples")
    const results = await promoteVoiceExamples()
    const promoted = results.reduce((s, r) => s + r.promoted, 0)
    return { ok: true, clients: results.length, promoted, results }
})

// ── Obchodní agent ─────────────────────────────────────────────────────────────
// Tři kroky od leadu k odeslané zprávě. Kvalitu drží soudce, ne klikání
// zakladatele — viz lib/agents/sales/pipeline.ts.

registerHandler("lead_qualify", async (task) => {
    const { runQualify } = await import("@/lib/agents/sales/pipeline")
    return runQualify(String((task.payload as any).leadId))
})

// Drahý krok (~18 Kč/lead) — zařazuje se až pro kvalifikované.
registerHandler("lead_preview", async (task) => {
    const { runPreview } = await import("@/lib/agents/sales/pipeline")
    return runPreview(String((task.payload as any).leadId))
})

registerHandler("lead_outreach", async (task) => {
    const { runOutreach } = await import("@/lib/agents/sales/pipeline")
    return runOutreach(String((task.payload as any).leadId))
})

// ── Vstupní schůzka ────────────────────────────────────────────────────────────
// Podklad se skládá až po rezervaci termínu, ne dřív: dřív by zestaral, protože
// zákazník mezitím konfiguraci ještě mění. Běží mimo webhook, aby Cal.com dostal
// ACK hned a selhání přípravy nikdy neshodilo domluvený termín.
registerHandler("consultation_brief", async (task) => {
    const { generateConsultationBrief } = await import("@/lib/agents/consultation-brief")
    const brief = await generateConsultationBrief(String((task.payload as any).consultationId))
    return { ok: true, generated: Boolean(brief) }
})

export {} // side-effect module
