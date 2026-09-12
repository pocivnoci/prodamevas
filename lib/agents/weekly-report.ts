/**
 * Weekly founder report — first real ops agent.
 * Gathers the week's key numbers from Supabase and returns an email-ready report.
 * Defensive: each stat is isolated, so one missing source never breaks the report.
 */

import supabaseAdmin from "@/supabase/admin"
import { NOT_SHOWCASE } from "@/lib/audience"
import { footnote, heading, list } from "@/lib/mail/blocks"
import { renderEmail } from "@/lib/mail/layout"
import { countLabel, POSTS } from "@/lib/plural"

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

    // Značky z výlohy se nepočítají. Vlastníme je my, takže „aktivních klientů"
    // hlásilo 26 tam, kde jich bylo 14 — číslo, podle kterého se rozhoduje
    // o firmě, nesmí být skoro dvojnásobné.
    const activeClients = await (async () => {
        try {
            const { count } = await supabaseAdmin.from("clients")
                .select("id", { count: "exact", head: true })
                .eq("is_active", true)
                .or(NOT_SHOWCASE)
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

    // Příspěvky, kterým brána nechala nepodložené tvrzení. Štítek na kartě uvidí jen ten,
    // kdo se do Příspěvků podívá — a nepravda v postu je přesně to, co se nesmí spoléhat
    // na to, že si toho někdo všimne. Proto to jde do reportu jako číslo vedle tržeb.
    let flaggedPosts = -1
    let flaggedClients = ""
    try {
        const { data: flags } = await supabaseAdmin
            .from("ig_generation_log")
            .select("client_id, post_id, clients(slug)")
            .eq("fact_status", "flagged")
            .gte("created_at", since)
        flaggedPosts = (flags || []).length
        const bySlug = new Map<string, number>()
        for (const f of flags || []) {
            const slug = (f as { clients?: { slug?: string } }).clients?.slug || "?"
            bySlug.set(slug, (bySlug.get(slug) || 0) + 1)
        }
        flaggedClients = [...bySlug.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
            .map(([slug, n]) => `${slug} ${n}×`).join(", ")
    } catch { /* sloupec ještě nemigrovaný — sekci přeskoč */ }

    // Náklady a kvalita za týden: ig_generation_log ty sloupce nese od 8/2026,
    // ale report četl jen strategii — tržby bez COGS a bez detektoru propadu
    // skóre kritika. Stejný řádek, jen víc sloupců; null cost = neznámá sazba,
    // ne nula (viz spend-tracker), proto se počítá zvlášť.
    let cogsLine = ""
    let qualityLine = ""
    try {
        const { data: week } = await supabaseAdmin
            .from("ig_generation_log")
            .select("cost_usd, critic_score, qa_status")
            .gte("created_at", since)
        const { data: spend } = await supabaseAdmin
            .from("ai_spend")
            .select("cost_usd")
            .gte("created_at", since)
        const rows = week || []
        const priced = [...rows, ...(spend || [])].filter(r => r.cost_usd != null)
        const unpriced = [...rows, ...(spend || [])].length - priced.length
        if (priced.length > 0) {
            const { USD_TO_CZK } = await import("@/lib/model-pricing")
            const czk = Math.round(priced.reduce((a, r) => a + Number(r.cost_usd), 0) * USD_TO_CZK)
            const margin = revenueCzk > 0 ? ` · hrubá marže ${Math.round((1 - czk / revenueCzk) * 100)} %` : ""
            cogsLine = `${czk.toLocaleString("cs-CZ")} Kč${unpriced > 0 ? ` (+${unpriced}× bez sazby)` : ""}${margin}`
        }
        const scored = rows.filter(r => r.critic_score != null)
        const qaRows = rows.filter(r => r.qa_status != null)
        if (scored.length > 0) {
            const avg = scored.reduce((a, r) => a + Number(r.critic_score), 0) / scored.length
            // qa_status: "pass" | "retry_pass" | "native_forced" — poslední znamená, že
            // vision QA neprošlo ani po opravném kole a vizuál se vydal vynuceně.
            const qaForced = qaRows.length > 0 ? Math.round((qaRows.filter(r => r.qa_status === "native_forced").length / qaRows.length) * 100) : null
            qualityLine = `⌀ kritik ${avg.toFixed(1)}/10 (${scored.length}×)${qaForced != null ? ` · vizuál vynucen bez QA ${qaForced} %` : ""}`
        }
    } catch { /* sloupce ještě nemigrované — sekci přeskoč */ }

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
    if (flaggedPosts > 0) {
        rows.push(["🚩 Posty s neověřeným tvrzením", `${flaggedPosts}${flaggedClients ? ` (${flaggedClients})` : ""}`])
    }
    if (cogsLine) rows.push(["💸 Náklady na modely (7 dní)", cogsLine])
    if (qualityLine) rows.push(["🎯 Kvalita (7 dní)", qualityLine])
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
            footnote(`Automatický report od Chrlit ops-agenta · ${pendingApprovals > 0 ? `máš ${pendingApprovals} akcí ke schválení v dashboardu` : "nic nečeká na schválení"}${flaggedPosts > 0 ? ` · na ověření faktu čeká ${countLabel(flaggedPosts, POSTS)}` : ""}`),
        ],
    })

    return { subject, html, text }
}
