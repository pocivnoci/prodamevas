/**
 * Weekly founder report — first real ops agent.
 * Gathers the week's key numbers from Supabase and returns an email-ready report.
 * Defensive: each stat is isolated, so one missing source never breaks the report.
 */

import supabaseAdmin from "@/supabase/admin"

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

    const subject = `📊 Chrlit — týdenní report (${fmtRange})`
    const text = `Chrlit týdenní report — ${fmtRange}\n\n` + rows.map(([k, val]) => `${k}: ${val}`).join("\n")
    const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#050505;color:#fff;padding:32px;max-width:560px;margin:0 auto">
        <h1 style="font-size:20px;text-transform:uppercase;letter-spacing:-0.5px;margin:0 0 4px">Chrlit — týdenní report</h1>
        <p style="color:#888;font-size:12px;margin:0 0 24px">${fmtRange}</p>
        <table style="width:100%;border-collapse:collapse">
          ${rows.map(([k, val]) => `<tr>
            <td style="padding:10px 0;border-bottom:1px solid #1a1a1a;color:#bbb;font-size:14px">${k}</td>
            <td style="padding:10px 0;border-bottom:1px solid #1a1a1a;text-align:right;font-weight:700;font-size:15px">${val}</td>
          </tr>`).join("")}
        </table>
        <p style="color:#555;font-size:11px;margin-top:24px">Automatický report od Chrlit ops-agenta · ${pendingApprovals > 0 ? `máš ${pendingApprovals} akcí ke schválení v dashboardu` : "nic nečeká na schválení"}</p>
      </div>`

    return { subject, html, text }
}
