/**
 * Daily ops health check — "nothing breaks silently".
 * ====================================================
 * Scans the last 24 h for operational problems and returns a report.
 *
 * This module is a DETECTION LIBRARY, not a channel: it no longer owns an
 * e-mail. `lib/agents/daily-brief.ts` consumes buildHealthCheck() as its
 * `system` section, so the founder gets one morning brief instead of a mail
 * per agent. renderHealthAlert() is kept for the standalone script and for
 * anyone who wants the old shape.
 *
 * Defensive like weekly-report: each check is isolated, a broken source is
 * reported as a problem of its own rather than crashing the whole check.
 */

import supabaseAdmin from "@/supabase/admin"

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

export interface HealthProblem {
    icon: string
    title: string
    detail: string
}

export interface HealthReport {
    healthy: boolean
    problems: HealthProblem[]
    checkedAt: string
}

type Check = () => Promise<HealthProblem | null>

/**
 * Wraps a check so its own failure surfaces as a problem instead of crashing the run.
 * Exported because the daily brief composes several independent scanners the same
 * way — one broken data source must never cost the founder the whole briefing.
 */
export async function safe(name: string, fn: Check): Promise<HealthProblem | null> {
    try {
        return await fn()
    } catch (err) {
        return { icon: "🧨", title: `Kontrola „${name}" selhala`, detail: (err as Error)?.message?.slice(0, 200) || "neznámá chyba" }
    }
}

export async function buildHealthCheck(): Promise<HealthReport> {
    const since24h = new Date(Date.now() - DAY_MS).toISOString()
    const staleHour = new Date(Date.now() - HOUR_MS).toISOString()

    const checks: Array<Promise<HealthProblem | null>> = [
        // Generation failures (single posts + campaign posts share ig_jobs).
        safe("selhané joby", async () => {
            const { count, error } = await supabaseAdmin.from("ig_jobs").select("id", { count: "exact", head: true })
                .eq("status", "failed").gte("created_at", since24h)
            if (error) throw new Error(error.message)
            return count && count > 0
                ? { icon: "⚠️", title: `${count}× selhaný generační job (24 h)`, detail: "Detail v ig_jobs / Sentry." }
                : null
        }),

        // A job stuck mid-pipeline (neither done nor failed) for hours means a
        // crashed run that never resolved. Windowed to 7 days so old debris
        // (pre-dating this check) doesn't alarm forever.
        safe("zaseklé joby", async () => {
            const { count, error } = await supabaseAdmin.from("ig_jobs").select("id", { count: "exact", head: true })
                .not("status", "in", "(done,failed)")
                .lt("created_at", new Date(Date.now() - 2 * HOUR_MS).toISOString())
                .gte("created_at", new Date(Date.now() - 7 * DAY_MS).toISOString())
            if (error) throw new Error(error.message)
            return count && count > 0
                ? { icon: "⚠️", title: `${count}× job visí uprostřed pipeline`, detail: "Přes 2 h v ne-koncovém stavu (pending/copywriter/…) — spadlý běh." }
                : null
        }),

        // A campaign stuck 'running' with an hour-dead lease means the worker
        // stopped reclaiming it — normally a stale lease is re-claimed within minutes.
        safe("zaseklé kampaně", async () => {
            // A running campaign is stuck if its lease is stale OR null — `.lt`
            // alone drops null rows, exactly the "lease was cleared / never set" case.
            const { count, error } = await supabaseAdmin.from("ig_campaigns").select("id", { count: "exact", head: true })
                .eq("status", "running").or(`worker_lease.is.null,worker_lease.lt.${staleHour}`)
            if (error) throw new Error(error.message)
            return count && count > 0
                ? { icon: "🛑", title: `${count}× kampaň visí ve stavu running`, detail: "worker_lease starší než hodina — campaign-worker ji nepřebírá." }
                : null
        }),

        // Pending campaigns older than an hour = the campaign-worker cron isn't draining.
        safe("nespuštěné kampaně", async () => {
            const { count, error } = await supabaseAdmin.from("ig_campaigns").select("id", { count: "exact", head: true })
                .eq("status", "pending").lt("created_at", staleHour)
            if (error) throw new Error(error.message)
            return count && count > 0
                ? { icon: "🛑", title: `${count}× kampaň čeká přes hodinu`, detail: "campaign-worker možná neběží (cron/Vercel)." }
                : null
        }),

        // Agent queue failures (terminal — retries exhausted).
        safe("selhané agent tasky", async () => {
            const { count, error } = await supabaseAdmin.from("agent_tasks").select("id", { count: "exact", head: true })
                .eq("status", "failed").gte("created_at", since24h)
            if (error) throw new Error(error.message)
            return count && count > 0
                ? { icon: "🤖", title: `${count}× selhaný agent task (24 h)`, detail: "Detail v agent_tasks.error." }
                : null
        }),

        // Dunning in progress — a customer's renewal is failing.
        safe("billing selhání", async () => {
            const { data, error } = await supabaseAdmin.from("subscriptions")
                .select("client_id, billing_failures")
                .eq("status", "active").gt("billing_failures", 0)
            if (error) throw new Error(error.message)
            return data && data.length > 0
                ? { icon: "💳", title: `${data.length}× předplatné v dunningu`, detail: `billing_failures: ${data.map(s => s.billing_failures).join(", ")} — billing-worker upomíná.` }
                : null
        }),

        // Approvals sitting unanswered — includes ops actions (client_id NULL),
        // which the client-scoped tab historically never showed.
        safe("čekající schválení", async () => {
            const { data, error } = await supabaseAdmin.from("agent_actions")
                .select("id, created_at")
                .eq("status", "proposed")
                .lt("created_at", since24h)
                .order("created_at", { ascending: true })
            if (error) throw new Error(error.message)
            if (!data || data.length === 0) return null
            const oldestDays = Math.floor((Date.now() - new Date(data[0].created_at).getTime()) / DAY_MS)
            return { icon: "⏳", title: `${data.length}× akce čeká na schválení déle než den`, detail: `Nejstarší ${oldestDays} d — dashboard → Schválení.` }
        }),
    ]

    const problems = (await Promise.all(checks)).filter((p): p is HealthProblem => p !== null)
    return { healthy: problems.length === 0, problems, checkedAt: new Date().toISOString() }
}

export function renderHealthAlert(report: HealthReport): { subject: string; html: string; text: string } {
    const subject = `🚨 Chrlit health — ${report.problems.length} ${report.problems.length === 1 ? "problém" : report.problems.length < 5 ? "problémy" : "problémů"}`
    const rows = report.problems.map(p => `
      <div style="border:1px solid #1a1a1a;border-radius:4px;padding:14px;margin:0 0 10px;background:#0a0a0a">
        <p style="margin:0 0 4px;font-size:15px;font-weight:700">${p.icon} ${p.title}</p>
        <p style="margin:0;font-size:13px;color:#999">${p.detail}</p>
      </div>`).join("")
    const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#050505;color:#fff;padding:32px;max-width:560px;margin:0 auto">
        <h1 style="font-size:20px;text-transform:uppercase;letter-spacing:-0.5px;margin:0 0 4px">Chrlit — health check</h1>
        <p style="color:#888;font-size:12px;margin:0 0 24px">${new Date(report.checkedAt).toLocaleString("cs-CZ")}</p>
        ${rows}
        <p style="color:#555;font-size:11px;margin-top:24px">Denní kontrola od ops-agenta · chodí jen když něco nesedí</p>
      </div>`
    const text = `Chrlit health check\n\n` + report.problems.map(p => `${p.icon} ${p.title}\n   ${p.detail}`).join("\n")
    return { subject, html, text }
}
