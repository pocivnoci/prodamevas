/**
 * Stav firmy jedním dotazem — podklad, ze kterého agent mluví.
 * =============================================================
 * Tohle je celý rozdíl mezi „AI ve skupině" a „agent, co koriguje". Bez čísel
 * po ruce by model na „máme kolem čtyřiceti platících" jen souhlasně přikývl,
 * protože je to věrohodná věta. S nimi řekne, že platících je dvanáct a že
 * čtyřicet je počet registrací.
 *
 * Proč se snapshot skládá dopředu a NE tool-callingem:
 *  - je malý (desítky čísel), takže se celý vejde do systémového promptu a
 *    padne do prompt cache — u kanálu, kde agent kouká na každou zprávu, je
 *    to rozdíl mezi haléři a korunami za den;
 *  - je to JEDEN round-trip. Agent, co odpovídá za deset vteřin, se přestane
 *    používat;
 *  - a hlavně: co v snapshotu není, o tom model NEMÁ čím tvrdit. Pevná sada
 *    faktů je levnější obrana proti výmyslu než instrukce „nehádej".
 *
 * Každý údaj se sbírá izolovaně (`stat`) — jeden chybějící sloupec po migraci
 * nesmí sebrat celý brief. Nedostupný údaj je `null` a v textu „—", nikdy nula:
 * nula je tvrzení, „—" je přiznání.
 */

import supabaseAdmin from "@/supabase/admin"

const DAY_MS = 24 * 60 * 60 * 1000

/** Jeden pokus o číslo. Selhání = null (v textu „—"), nikdy 0. */
async function stat<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    try {
        return await fn()
    } catch (err) {
        console.warn(`company-snapshot: '${label}' nedostupné — ${(err as Error)?.message}`)
        return null
    }
}

/** Jeden filtr do `countWhere`: sloupec, operátor, hodnota. */
type Filter =
    | { op: "eq"; column: string; value: string | number | boolean }
    | { op: "gte"; column: string; value: string | number }
    | { op: "gt"; column: string; value: string | number }

/**
 * `SELECT count(*)` s filtry.
 *
 * Filtry jdou jako data, ne jako callback nad query builderem: PostgREST typuje
 * builder podle schématu, takže řetězení uvnitř generické funkce skončí buď
 * u `any`, nebo u typu, který se rozbije při každé migraci. Tři operátory
 * pokryjí všechno, co snapshot potřebuje.
 */
async function countWhere(table: string, filters: Filter[] = []): Promise<number> {
    let q = supabaseAdmin.from(table).select("id", { count: "exact", head: true })
    for (const f of filters) {
        if (f.op === "eq") q = q.eq(f.column, f.value)
        else if (f.op === "gte") q = q.gte(f.column, f.value)
        else q = q.gt(f.column, f.value)
    }
    const { count, error } = await q
    if (error) throw new Error(error.message)
    return count || 0
}

const eq = (column: string, value: string | number | boolean): Filter => ({ op: "eq", column, value })
const gte = (column: string, value: string | number): Filter => ({ op: "gte", column, value })

export interface CompanySnapshot {
    /** Platící předplatná podle tarifu: { "remeslo": 8, "imperium": 4 } */
    payingByPlan: Record<string, number> | null
    paying: number | null
    /** Měsíční opakovaný příjem v Kč (součet cen aktivních tarifů). */
    mrrCzk: number | null
    trialing: number | null
    clientsTotal: number | null
    clientsActive: number | null
    clientsNew7d: number | null
    waitlist: number | null
    revenue7dCzk: number | null
    revenue30dCzk: number | null
    postsGenerated7d: number | null
    postsPublished7d: number | null
    failedJobs7d: number | null
    dunning: number | null
    pendingApprovals: number | null
    /** Čekající akce s popisem — agent na ně umí odkázat jménem. */
    pendingList: { id: string; agentType: string; action: string; riskTier: string; createdAt: string }[]
    systemProblems: { icon: string; title: string; detail?: string }[]
    takenAt: string
}

export async function buildCompanySnapshot(): Promise<CompanySnapshot> {
    const now = Date.now()
    const since7d = new Date(now - 7 * DAY_MS).toISOString()
    const since30d = new Date(now - 30 * DAY_MS).toISOString()

    // Předplatná + ceník v jednom průchodu: MRR je součin, ne uložené číslo,
    // takže musí vzniknout ze stejného čtení jako počty. Dvě oddělená čtení by
    // uměla ohlásit „12 platících" a MRR spočítané z jedenácti.
    const subs = await stat("předplatná", async () => {
        const { data: rows, error } = await supabaseAdmin
            .from("subscriptions")
            .select("plan_id, status")
            .in("status", ["active", "trialing"])
        if (error) throw new Error(error.message)

        const { data: plans } = await supabaseAdmin
            .from("subscription_plans")
            .select("id, price_czk")
        const priceOf = new Map((plans || []).map(p => [String(p.id), Number(p.price_czk) || 0]))

        const byPlan: Record<string, number> = {}
        let paying = 0
        let trialing = 0
        let mrr = 0
        for (const row of rows || []) {
            if (String(row.status) === "trialing") { trialing++; continue }
            paying++
            const plan = String(row.plan_id)
            byPlan[plan] = (byPlan[plan] || 0) + 1
            mrr += priceOf.get(plan) ?? 0
        }
        return { byPlan, paying, trialing, mrr }
    })

    const revenue = async (sinceIso: string) => {
        const { data, error } = await supabaseAdmin
            .from("payments")
            .select("amount, status")
            .gte("paid_at", sinceIso)
        if (error) throw new Error(error.message)
        // `amount` je v haléřích (viz lib/payments) — /100 dělá Kč.
        const paid = (data || []).filter(p => String(p.status).toUpperCase() === "PAID")
        return Math.round(paid.reduce((s, p) => s + (Number(p.amount) || 0), 0) / 100)
    }

    const [
        clientsTotal, clientsActive, clientsNew7d, waitlist,
        revenue7d, revenue30d, postsGenerated7d, postsPublished7d,
        failedJobs7d, dunning, pending, system,
    ] = await Promise.all([
        stat("klienti celkem", () => countWhere("clients")),
        stat("aktivní klienti", () => countWhere("clients", [eq("is_active", true)])),
        stat("noví klienti 7 d", () => countWhere("clients", [gte("created_at", since7d)])),
        stat("waitlist", () => countWhere("waitlist")),
        stat("tržby 7 d", () => revenue(since7d)),
        stat("tržby 30 d", () => revenue(since30d)),
        stat("posty 7 d", () => countWhere("ig_posts", [gte("created_at", since7d)])),
        // Publikovaný post je `status='posted'` + `posted_at` (viz ig-publisher).
        // Ne `published_at` — takový sloupec neexistuje a dotaz by tiše vracel 0.
        stat("publikované 7 d", () => countWhere("ig_posts", [eq("status", "posted"), gte("posted_at", since7d)])),
        stat("selhané joby 7 d", () => countWhere("ig_jobs", [eq("status", "failed"), gte("created_at", since7d)])),
        stat("dunning", () => countWhere("subscriptions", [{ op: "gt", column: "billing_failures", value: 0 }])),
        stat("čekající schválení", async () => {
            const { listPendingApprovals } = await import("@/lib/agent-safety")
            return listPendingApprovals()
        }),
        stat("zdraví systému", async () => {
            const { buildHealthCheck } = await import("@/lib/agents/health-check")
            const report = await buildHealthCheck()
            return report.problems.map(p => ({ icon: p.icon, title: p.title, detail: p.detail }))
        }),
    ])

    return {
        payingByPlan: subs?.byPlan ?? null,
        paying: subs?.paying ?? null,
        mrrCzk: subs?.mrr ?? null,
        trialing: subs?.trialing ?? null,
        clientsTotal, clientsActive, clientsNew7d, waitlist,
        revenue7dCzk: revenue7d,
        revenue30dCzk: revenue30d,
        postsGenerated7d, postsPublished7d, failedJobs7d, dunning,
        pendingApprovals: pending?.length ?? null,
        pendingList: (pending || []).slice(0, 10).map(a => ({
            id: a.id,
            agentType: a.agentType,
            action: a.action,
            riskTier: a.riskTier,
            createdAt: a.createdAt,
        })),
        systemProblems: system || [],
        takenAt: new Date().toISOString(),
    }
}

const num = (n: number | null | undefined): string =>
    n === null || n === undefined ? "—" : n.toLocaleString("cs-CZ")

const czk = (n: number | null | undefined): string =>
    n === null || n === undefined ? "—" : `${n.toLocaleString("cs-CZ")} Kč`

/**
 * Snapshot → text do systémového promptu.
 *
 * Formát je schválně strohý `klíč: hodnota`, ne věty: model má čísla citovat,
 * ne přebírat jejich rétoriku. A „—" je v textu ponechané právě proto, aby
 * model viděl rozdíl mezi „je to nula" a „nevíme".
 */
export function describeSnapshot(s: CompanySnapshot): string {
    const lines: string[] = []

    const plans = s.payingByPlan && Object.keys(s.payingByPlan).length > 0
        ? ` (${Object.entries(s.payingByPlan).map(([p, n]) => `${p}: ${n}`).join(", ")})`
        : ""
    lines.push(`Platící předplatná: ${num(s.paying)}${plans}`)
    lines.push(`MRR: ${czk(s.mrrCzk)}`)
    lines.push(`V triálu: ${num(s.trialing)}`)
    lines.push(`Klienti celkem: ${num(s.clientsTotal)} · aktivní: ${num(s.clientsActive)} · noví za 7 dní: ${num(s.clientsNew7d)}`)
    lines.push(`Waitlist: ${num(s.waitlist)}`)
    lines.push(`Tržby 7 dní: ${czk(s.revenue7dCzk)} · 30 dní: ${czk(s.revenue30dCzk)}`)
    lines.push(`Posty za 7 dní: vygenerováno ${num(s.postsGenerated7d)}, publikováno ${num(s.postsPublished7d)}`)
    lines.push(`Selhané joby za 7 dní: ${num(s.failedJobs7d)}`)
    lines.push(`Předplatná se selhanou platbou: ${num(s.dunning)}`)

    if (s.pendingList.length > 0) {
        lines.push("")
        lines.push("Čeká na schválení:")
        for (const a of s.pendingList) {
            const age = Math.round((Date.now() - new Date(a.createdAt).getTime()) / (60 * 60 * 1000))
            lines.push(`  - [${a.id}] ${a.agentType}/${a.action} (${a.riskTier}, čeká ${age} h)`)
        }
    } else {
        lines.push("Čeká na schválení: nic")
    }

    if (s.systemProblems.length > 0) {
        lines.push("")
        lines.push("Problémy systému:")
        for (const p of s.systemProblems) {
            lines.push(`  - ${p.title}${p.detail ? ` — ${p.detail}` : ""}`)
        }
    }

    lines.push("")
    lines.push(`Načteno: ${new Date(s.takenAt).toLocaleString("cs-CZ")}`)
    return lines.join("\n")
}
