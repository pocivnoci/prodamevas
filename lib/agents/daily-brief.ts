/**
 * Ranní brief — jediný kanál z firmy k zakladateli.
 * ==================================================
 * Jeden e-mail denně místo šesti. Health check, daňový kalendář, peníze,
 * rizikoví zákazníci i čekající schválení se slévají do jednoho dokumentu,
 * který se čte odshora dolů a končí tlačítky.
 *
 * Proč právě takhle:
 *  - **Nikdy seznam úkolů.** Sekce „Co jsem udělal" je hotová práce, sekce
 *    „Co potřebuje tebe" má u každé položky jedno kliknutí. Nic, co by si
 *    člověk musel někam opsat a pak si na to vzpomenout.
 *  - **Ticho, když je klid.** `quiet` znamená, že nepřijde nic. Agent, který
 *    píše každý den, se přestane číst — a pak se přehlédne i ten den, kdy hoří.
 *  - **Jeden zdroj, ne šest.** health-check a compliance-calendar zůstávají
 *    detekčními knihovnami, ale e-mail už nevlastní. Lifecycle scan taky ne:
 *    jeho návrhy se sem dostanou samy, protože sekce „Co potřebuje tebe" bere
 *    *všechny* `proposed` akce, ne jen ty od jednoho agenta.
 *
 * Jediná povolená výjimka z „jeden e-mail denně" je `paid_not_activated`
 * (peníze na účtu, produkt nedodán) — ta letí okamžitě přes notifyPendingApproval.
 *
 * Ranní pořadí cronů má význam: billing-worker běží ve 04:00 UTC, daily-ops
 * v 05:30, takže brief vidí dnešní peníze, ne včerejší. Hlídá to `npm run guard`.
 */

import supabaseAdmin from "@/supabase/admin"
import { listPendingApprovals, type PendingAction } from "@/lib/agent-safety"
import { safe, type HealthProblem } from "@/lib/agents/health-check"
import { renderApprovalItem } from "@/lib/agents/approval-notify"
import type { ComplianceItem } from "@/lib/agents/compliance-calendar"

const DAY_MS = 24 * 60 * 60 * 1000

export interface BriefLine {
    icon: string
    text: string
    detail?: string
}

export interface DailyBrief {
    /** Nic k hlášení → handler nepošle žádný e-mail. */
    quiet: boolean
    /** Peníze: selhané platby, zaseklé platby, tržby, blížící se obnovy. */
    money: BriefLine[]
    /** Zákazníci v riziku + nedokončený onboarding. */
    risk: BriefLine[]
    /** Co agent za posledních 24 h udělal sám (audit z agent_actions). */
    did: BriefLine[]
    /** Co čeká na člověka — každá položka nese one-click tlačítka. */
    needsYou: PendingAction[]
    /** Technické zdraví z health-check. */
    system: HealthProblem[]
    /** Daňové termíny — jen ty, co hoří (`now` / `soon`). */
    compliance: ComplianceItem[]
    /** client_id → „Název (slug)", aby render zůstal synchronní a bez UUID. */
    clientLabels: Record<string, string>
    checkedAt: string
}

const czk = (haleru: number) => `${Math.round(haleru / 100).toLocaleString("cs-CZ")} Kč`

// ── Sekce: peníze ───────────────────────────────────────────────────────────

/**
 * Peníze za posledních 24 h. Záměrně sem NEPATŘÍ dunning (`billing_failures > 0`)
 * — ten hlásí health-check jako systémový problém a dvakrát se to psát nemá.
 */
async function buildMoney(now: Date): Promise<BriefLine[]> {
    const since24h = new Date(now.getTime() - DAY_MS).toISOString()
    const lines: BriefLine[] = []

    const checks = await Promise.all([
        // Selhané strhnutí. Řádky zakládá billing-worker, aby po neúspěchu
        // zůstala stopa s důvodem od brány — dřív po něm nezbylo nic než čítač.
        safe("selhané platby", async () => {
            const { data, error } = await supabaseAdmin
                .from("payments")
                .select("amount, label, comgate_response")
                .eq("status", "FAILED")
                .gte("created_at", since24h)
            if (error) throw new Error(error.message)
            if (!data || data.length === 0) return null
            const reason = (data[0].comgate_response as Record<string, unknown> | null)?.error
            return {
                icon: "💸",
                title: `${data.length}× selhala platba (24 h)`,
                detail: `${data.map(p => czk(p.amount)).join(", ")}${reason ? ` · ${String(reason).slice(0, 120)}` : ""}`,
            }
        }),

        // Platba, která visí v PENDING přes den, je skoro vždy ztracený callback:
        // zákazník zaplatil a plán se neaktivoval. Reconciler to má dohojit sám,
        // takže tenhle řádek zároveň hlásí, že reconciler nefunguje.
        //
        // Mock platby se vynechávají. Reconciler se na ně brány zeptat NEMŮŽE
        // (u ní neexistují), takže by v PENDING zůstaly navždy a brief by je
        // hlásil každé ráno. Upozornění, které nikdy nezmizí a nedá se s ním nic
        // udělat, je přesně to, po čem se celý brief přestane číst.
        safe("zaseklé platby", async () => {
            const { data, error } = await supabaseAdmin
                .from("payments")
                .select("id, amount, created_at")
                .eq("status", "PENDING")
                .lt("created_at", since24h)
                .not("comgate_trans_id", "like", "MOCK-%")
                .order("created_at", { ascending: true })
                .limit(20)
            if (error) throw new Error(error.message)
            if (!data || data.length === 0) return null
            const oldestDays = Math.floor((now.getTime() - new Date(data[0].created_at).getTime()) / DAY_MS)
            return {
                icon: "🕳️",
                title: `${data.length}× platba visí v PENDING`,
                detail: `Nejstarší ${oldestDays} d. Ztracený callback → reconciler ji měl dohojit; zkontroluj agent_tasks.`,
            }
        }),

        // Tržby. Jediný řádek, který smí být „dobrá zpráva" — brief jinak mlčí.
        safe("tržby", async () => {
            const { data, error } = await supabaseAdmin
                .from("payments")
                .select("amount")
                .eq("status", "PAID")
                .gte("paid_at", since24h)
            if (error) throw new Error(error.message)
            if (!data || data.length === 0) return null
            const total = data.reduce((s, p) => s + (p.amount || 0), 0)
            return { icon: "💰", title: `${czk(total)} přijato (${data.length}× platba)`, detail: "" }
        }),
    ])

    for (const c of checks) {
        if (c) lines.push({ icon: c.icon, text: c.title, detail: c.detail || undefined })
    }
    return lines
}

// ── Sekce: co jsem udělal sám ───────────────────────────────────────────────

/** Čitelné názvy pro seskupení; neznámý typ spadne na svůj `agent_type`. */
const TASK_LABELS: Record<string, string> = {
    send_customer_notice: "Odesláno oznámení zákazníkovi",
    send_lifecycle_email: "Odeslán lifecycle e-mail",
    payment_reconcile: "Dohojena platba",
    idea_replenish: "Doplněn zásobník nápadů",
    auto_publish_arm: "Naplánovány hotové příspěvky",
    lifecycle_scan: "Proběhl lifecycle sken",
    daily_brief: "Ranní brief",
}

/**
 * Hotová práce za 24 h — čte se z audit logu, ne z paměti agenta. Proto musí
 * i automaticky odeslaná pošta chodit přes requestAction (tier `transactional`):
 * co neprojde přes agent_actions, tady prostě nebude.
 */
async function buildDid(now: Date): Promise<BriefLine[]> {
    const since24h = new Date(now.getTime() - DAY_MS).toISOString()
    const { data } = await supabaseAdmin
        .from("agent_actions")
        .select("agent_type, task_type, action")
        .eq("status", "executed")
        .gte("created_at", since24h)
        .limit(500)

    const groups = new Map<string, number>()
    for (const row of data || []) {
        // Ranní brief sám sebe nehlásí — to je šum, ne práce.
        if (row.task_type === "daily_brief") continue
        const key = TASK_LABELS[row.task_type || ""] || row.agent_type || "Ostatní"
        groups.set(key, (groups.get(key) || 0) + 1)
    }

    return [...groups.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([label, count]) => ({ icon: "✅", text: `${label} — ${count}×` }))
}

// ── Sestavení ───────────────────────────────────────────────────────────────

export async function buildDailyBrief(now: Date = new Date()): Promise<DailyBrief> {
    const [money, risk, did, needsYou, system, compliance] = await Promise.all([
        buildMoney(now).catch(() => [] as BriefLine[]),
        buildRisk(now).catch(() => [] as BriefLine[]),
        buildDid(now).catch(() => [] as BriefLine[]),
        listPendingApprovals().catch(() => [] as PendingAction[]),
        buildSystem().catch(() => [] as HealthProblem[]),
        buildCompliance().catch(() => [] as ComplianceItem[]),
    ])

    return {
        quiet: money.length === 0 && risk.length === 0 && needsYou.length === 0
            && system.length === 0 && compliance.length === 0,
        money, risk, did, needsYou, system, compliance,
        clientLabels: await resolveClientLabels(needsYou),
        checkedAt: now.toISOString(),
    }
}

/** Jména klientů pro schvalovací karty — jedním dotazem, ne N+1 v renderu. */
async function resolveClientLabels(actions: PendingAction[]): Promise<Record<string, string>> {
    const ids = [...new Set(actions.map(a => a.clientId).filter((id): id is string => Boolean(id)))]
    if (ids.length === 0) return {}
    try {
        const { data } = await supabaseAdmin.from("clients").select("id, name, slug").in("id", ids)
        return Object.fromEntries((data || []).map(c => [c.id, `${c.name} (${c.slug})`]))
    } catch {
        return {}
    }
}

async function buildSystem(): Promise<HealthProblem[]> {
    const { buildHealthCheck } = await import("@/lib/agents/health-check")
    return (await buildHealthCheck()).problems
}

/** Daňový kalendář: `info` položky do briefu nepatří — hlásí se jen co hoří. */
async function buildCompliance(): Promise<ComplianceItem[]> {
    const { buildComplianceReport } = await import("@/lib/agents/compliance-calendar")
    const report = await buildComplianceReport()
    return report.items.filter(i => i.urgency === "now" || i.urgency === "soon")
}

/**
 * Zákazníci v riziku. Bere hotový obrázek z `client-health.ts` — tentýž, který
 * pohání admin tab Firma, aby si e-mail a dashboard nemohly odporovat.
 * Klienti bez rizika se nevypisují: brief má být krátký.
 */
async function buildRisk(now: Date): Promise<BriefLine[]> {
    const { buildClientHealth, describeRisks, countStalledOnboardings } = await import("@/lib/agents/client-health")

    const [rows, stalled] = await Promise.all([
        buildClientHealth(now).catch(() => []),
        countStalledOnboardings(now).catch(() => ({ count: 0, oldestDays: null })),
    ])

    const lines: BriefLine[] = rows
        .filter(r => r.risks.length > 0)
        .slice(0, 15)
        .map(r => ({
            icon: r.risks.includes("dunning") ? "💳" : r.risks.includes("dormant") ? "😴" : "⚠️",
            text: `${r.name} — ${describeRisks(r.risks)}`,
            detail: [
                r.plan ? `plán ${r.plan}` : null,
                r.postsLast14d === 0 ? "0 příspěvků za 14 dní" : `${r.postsLast14d} příspěvků za 14 dní`,
                r.creditsTotal > 0 ? `${r.creditsRemaining}/${r.creditsTotal} kreditů` : null,
            ].filter(Boolean).join(" · "),
        }))

    if (stalled.count > 0) {
        lines.push({
            icon: "🚪",
            text: `${stalled.count}× registrace bez dokončeného onboardingu`,
            detail: stalled.oldestDays !== null ? `Nejstarší ${stalled.oldestDays} d — účet vznikl, klient nikdy nedojel do studia.` : undefined,
        })
    }
    return lines
}

// ── Render ──────────────────────────────────────────────────────────────────

const URGENCY_ICON: Record<string, string> = { now: "🔴", soon: "🟠", info: "⚪" }

export function renderDailyBrief(b: DailyBrief): { subject: string; html: string; text: string } {
    const todo = b.needsYou.length
    // Předmět nese verdikt, ne počet problémů: z pohledu na lištu má být hned
    // jasné, jestli se musí něco udělat, nebo jestli stačí přečíst.
    const subject = todo > 0
        ? `☕ Ranní brief — ${todo} ${todo === 1 ? "věc" : todo < 5 ? "věci" : "věcí"} pro tebe`
        : "☕ Ranní brief — jen ke čtení"

    return { subject, html: renderHtml(b), text: renderText(b) }
}

function renderHtml(b: DailyBrief): string {
    const parts: string[] = []

    if (b.needsYou.length > 0) {
        parts.push(section("Co potřebuje tebe", b.needsYou.map(a => approvalHtml(a, b.clientLabels)).join("")))
    }
    if (b.money.length > 0) parts.push(section("Peníze", b.money.map(lineHtml).join("")))
    if (b.risk.length > 0) parts.push(section("Zákazníci v riziku", b.risk.map(lineHtml).join("")))
    if (b.system.length > 0) {
        parts.push(section("Systém", b.system.map(p =>
            lineHtml({ icon: p.icon, text: p.title, detail: p.detail })).join("")))
    }
    if (b.compliance.length > 0) {
        parts.push(section("Termíny", b.compliance.map(i => lineHtml({
            icon: URGENCY_ICON[i.urgency] || "⚪",
            text: `${i.action}${i.deadline ? ` — ${i.deadline}` : ""}`,
            detail: i.why,
        })).join("")))
    }
    if (b.did.length > 0) parts.push(section("Co jsem udělal sám", b.did.map(lineHtml).join("")))

    return `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#050505;color:#fff;padding:32px;max-width:600px;margin:0 auto">
        <h1 style="font-size:20px;text-transform:uppercase;letter-spacing:-0.5px;margin:0 0 4px">Ranní brief</h1>
        <p style="color:#888;font-size:12px;margin:0 0 28px">${new Date(b.checkedAt).toLocaleString("cs-CZ")}</p>
        ${parts.join("")}
        <p style="color:#555;font-size:11px;margin-top:28px">Jeden e-mail denně · když je klid, nepřijde nic · odkazy platí 7 dní</p>
      </div>`
}

function section(title: string, inner: string): string {
    return `
      <h2 style="font-size:10px;text-transform:uppercase;letter-spacing:2px;font-weight:700;color:#666;margin:0 0 10px">${title}</h2>
      ${inner}
      <div style="height:22px"></div>`
}

function lineHtml(l: BriefLine): string {
    return `
      <div style="border:1px solid #1a1a1a;border-radius:4px;padding:12px 14px;margin:0 0 8px;background:#0a0a0a">
        <p style="margin:0;font-size:14px;font-weight:600;color:#fff">${l.icon} ${l.text}</p>
        ${l.detail ? `<p style="margin:4px 0 0;font-size:12px;color:#888">${l.detail}</p>` : ""}
      </div>`
}

/** Tlačítka Schválit/Zamítnout — stejný render jako v samostatných výzvách. */
function approvalHtml(a: PendingAction, labels: Record<string, string>): string {
    return renderApprovalItem(
        {
            actionId: a.id,
            clientId: a.clientId,
            agentType: a.agentType,
            action: a.action,
            riskTier: a.riskTier,
            payload: a.payload,
        },
        a.clientId ? (labels[a.clientId] || a.clientId) : "OPS (celý systém)",
    )
}

function renderText(b: DailyBrief): string {
    const out: string[] = ["Ranní brief", ""]
    const add = (title: string, lines: string[]) => {
        if (lines.length === 0) return
        out.push(title.toUpperCase(), ...lines.map(l => `  ${l}`), "")
    }
    add("Co potřebuje tebe", b.needsYou.map(a => `${a.action} (${a.agentType}) — schval v dashboardu → Schválení`))
    add("Peníze", b.money.map(l => `${l.icon} ${l.text}${l.detail ? ` — ${l.detail}` : ""}`))
    add("Zákazníci v riziku", b.risk.map(l => `${l.icon} ${l.text}${l.detail ? ` — ${l.detail}` : ""}`))
    add("Systém", b.system.map(p => `${p.icon} ${p.title} — ${p.detail}`))
    add("Termíny", b.compliance.map(i => `${i.action}${i.deadline ? ` — ${i.deadline}` : ""} (${i.why})`))
    add("Co jsem udělal sám", b.did.map(l => `${l.icon} ${l.text}`))
    return out.join("\n")
}
