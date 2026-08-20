/**
 * Weekly founder report — first real ops agent.
 * Gathers the week's key numbers from Supabase and returns an email-ready report.
 * Defensive: each stat is isolated, so one missing source never breaks the report.
 */

import supabaseAdmin from "@/supabase/admin"
import { footnote, heading, list } from "@/lib/mail/blocks"
import { renderEmail } from "@/lib/mail/layout"

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

async function countSince(table: string, column = "created_at", sinceIso?: string): Promise<number> {
    try {
        let q = supabaseAdmin.from(table).select("id", { count: "exact", head: true })
        if (sinceIso) q = q.gte(column, sinceIso)
        const { count } = await q
        return count || 0
    } catch {
        return -1 // -1 = source unavailable (shown as "—")
    }
}

export interface WeeklyReport {
    subject: string
    html: string
    text: string
}

export async function buildWeeklyReport(): Promise<WeeklyReport> {
    const since = new Date(Date.now() - WEEK_MS).toISOString()
    const fmtRange = `${new Date(Date.now() - WEEK_MS).toLocaleDateString("cs-CZ")} – ${new Date().toLocaleDateString("cs-CZ")}`

    // ── Gather (isolated) ───────────────────────────────────────────────
    const [newWaitlist, newClients, postsThisWeek, failedJobs, doneTasks, pendingApprovals] = await Promise.all([
        countSince("waitlist", "created_at", since),
        countSince("clients", "created_at", since),
        countSince("ig_posts", "created_at", since),
        (async () => {
            try {
                const { count } = await supabaseAdmin.from("ig_jobs").select("id", { count: "exact", head: true })
                    .eq("status", "failed").gte("created_at", since)
                return count || 0
            } catch { return -1 }
        })(),
        (async () => {
            try {
                const { count } = await supabaseAdmin.from("agent_tasks").select("id", { count: "exact", head: true })
                    .eq("status", "done").gte("created_at", since)
                return count || 0
            } catch { return -1 }
        })(),
        (async () => {
            try {
                const { count } = await supabaseAdmin.from("agent_actions").select("id", { count: "exact", head: true })
                    .eq("status", "proposed")
                return count || 0
            } catch { return -1 }
        })(),
    ])

    const activeClients = await (async () => {
        try {
            const { count } = await supabaseAdmin.from("clients").select("id", { count: "exact", head: true }).eq("is_active", true)
            return count || 0
        } catch { return -1 }
    })()

    // Revenue this week (paid payments). amount stored in haléře → /100 = Kč.
    let revenueCzk = -1
    try {
        const { data } = await supabaseAdmin.from("payments").select("amount, status, paid_at")
            .gte("paid_at", since)
        const paid = (data || []).filter(p => String(p.status).toLowerCase() === "paid")
        revenueCzk = Math.round(paid.reduce((s, p) => s + (Number(p.amount) || 0), 0) / 100)
    } catch { revenueCzk = -1 }

    // Pipeline strategy comparison (trailing 30 days): repair loop vs best-of-2
    // (PIPELINE_BESTOF2). This is the decision gate for flipping the default —
    // best-of-2 must match/beat repair on final_score before it becomes default.
    let strategyLine = ""
    try {
        const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
        const { data: logs } = await supabaseAdmin
            .from("ig_generation_log")
            .select("strategy, final_score, editorial_rounds, consistency_score")
            .gte("created_at", since30)
            .not("strategy", "is", null)
        const byStrategy = new Map<string, { n: number; score: number; rounds: number; cons: number; consN: number }>()
        for (const l of logs || []) {
            const key = String(l.strategy)
            const agg = byStrategy.get(key) || { n: 0, score: 0, rounds: 0, cons: 0, consN: 0 }
            agg.n++
            agg.score += Number(l.final_score) || 0
            agg.rounds += Number(l.editorial_rounds) || 0
            if (l.consistency_score != null) { agg.cons += Number(l.consistency_score); agg.consN++ }
            byStrategy.set(key, agg)
        }
        if (byStrategy.size > 0) {
            strategyLine = [...byStrategy.entries()]
                .map(([k, a]) => `${k}: ${a.n}× · skóre ⌀${(a.score / a.n).toFixed(1)} · kola ⌀${(a.rounds / a.n).toFixed(1)}${a.consN ? ` · konzistence ⌀${(a.cons / a.consN).toFixed(2)}` : ""}`)
                .join("  |  ")
        }
    } catch { /* column not migrated yet — skip the section */ }

    const v = (n: number) => (n < 0 ? "—" : String(n))

    const rows: [string, string][] = [
        ["💰 Tržby (zaplaceno)", revenueCzk < 0 ? "—" : `${revenueCzk.toLocaleString("cs-CZ")} Kč`],
        ["👥 Aktivní klienti", v(activeClients)],
        ["✨ Noví klienti", v(newClients)],
        ["📝 Noví na waitlistu", v(newWaitlist)],
        ["📸 Vygenerované posty", v(postsThisWeek)],
        ["⚠️ Selhané joby", v(failedJobs)],
        ["🤖 Agent tasky (done)", v(doneTasks)],
        ["✅ Čeká na schválení", v(pendingApprovals)],
    ]
    if (strategyLine) rows.push(["⚖️ Pipeline (30 dní)", strategyLine])

    const subject = `📊 Chrlit — týdenní report (${fmtRange})`
    const text = `Chrlit týdenní report — ${fmtRange}\n\n` + rows.map(([k, val]) => `${k}: ${val}`).join("\n")
    const { html } = renderEmail({
        subject: "Chrlit — týdenní report",
        eyebrow: fmtRange,
        kind: "transactional",
        variant: "ops",
        blocks: [
            heading("Týdenní report"),
            list(rows.map(([k, val]) => `**${k}** — ${val}`)),
            footnote(`Automatický report od Chrlit ops-agenta · ${pendingApprovals > 0 ? `máš ${pendingApprovals} akcí ke schválení v dashboardu` : "nic nečeká na schválení"}`),
        ],
    })

    return { subject, html, text }
}
