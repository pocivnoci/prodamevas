/**
 * Zdraví zákaznického účtu — jeden zdroj pravdy.
 * ==============================================
 * Napájí sekci „Zákazníci v riziku" v ranním briefu i admin tab Firma. Kdyby
 * si každý z nich počítal vlastní čísla, začnou si po první změně odporovat.
 *
 * **Aktivita se odvozuje z obsahu, ne z přihlášení.** `clients.updated_at` je
 * mrtvý sloupec (nemá trigger a nikdo ho nepíše) a `auth.users.last_sign_in_at`
 * nejde filtrovat přes PostgREST. Zavádět `last_seen_at` a zapisovat ho
 * z `requireClientAccess` by znamenalo psát do DB na nejteplejší cestě v celé
 * appce — a „přihlásil se" je stejně horší signál než „generuje": přihlášení
 * bez obsahu není retence. Proto `max(ig_posts.created_at)`.
 *
 * Každý klient je izolovaný: jeden rozbitý tenant nesmí připravit zakladatele
 * o celý přehled.
 */

import supabaseAdmin from "@/supabase/admin"

const DAY_MS = 24 * 60 * 60 * 1000

/** Bez obsahu za tuhle dobu je účet spící — a spící účet je churn za měsíc. */
export const DORMANT_DAYS = 14
/** Token, kterému zbývá míň, je prakticky odpojený — obnova se nemusí povést. */
export const TOKEN_WARN_DAYS = 7
/** Kolik posledních postů se načítá pro odvození aktivity napříč tenanty. */
const POST_SCAN_LIMIT = 3000

export type ClientRisk = "dormant" | "ig_disconnected" | "dunning" | "credits_out" | "expiring" | "cancelled"

export interface ClientHealthRow {
    clientId: string
    name: string
    slug: string
    plan: string | null
    status: string | null
    periodEnd: string | null
    billingFailures: number
    cancelAtPeriodEnd: boolean
    /** Kdy naposledy vznikl obsah — náhrada za neexistující last_seen_at. */
    lastContentAt: string | null
    postsLast14d: number
    igConnected: boolean
    igTokenExpiresAt: string | null
    creditsRemaining: number
    creditsTotal: number
    risks: ClientRisk[]
}

const RISK_LABELS: Record<ClientRisk, string> = {
    dormant: "nic negeneruje",
    ig_disconnected: "odpojený Instagram",
    dunning: "selhává platba",
    credits_out: "došly kredity",
    expiring: "končí předplatné",
    cancelled: "vypověděl",
}

export function describeRisks(risks: ClientRisk[]): string {
    return risks.map(r => RISK_LABELS[r]).join(", ")
}

export async function buildClientHealth(now: Date = new Date()): Promise<ClientHealthRow[]> {
    const { data: clients } = await supabaseAdmin
        .from("clients")
        .select("id, name, slug")
        .eq("is_active", true)
        .order("created_at", { ascending: true })
    if (!clients || clients.length === 0) return []

    const [activity, connections] = await Promise.all([
        loadActivity(now),
        loadConnections(),
    ])

    const rows: ClientHealthRow[] = []
    for (const c of clients) {
        try {
            rows.push(await buildRow(c, activity, connections, now))
        } catch (err: any) {
            console.warn(`client-health: klient ${c.slug} spadl: ${err?.message}`)
        }
    }
    // Nejrizikovější nahoru — kdo nemá problém, ať nekrade pozornost.
    return rows.sort((a, b) => b.risks.length - a.risks.length)
}

interface Activity { last: Map<string, string>; count14d: Map<string, number> }

/**
 * Jeden dotaz místo N+1: nejnovější posty napříč tenanty, agregace v paměti.
 * Při počtu klientů, kde by `POST_SCAN_LIMIT` nestačil, se tohle stejně
 * přepíše na materializovaný pohled.
 */
async function loadActivity(now: Date): Promise<Activity> {
    const { data } = await supabaseAdmin
        .from("ig_posts")
        .select("client_id, created_at")
        .order("created_at", { ascending: false })
        .limit(POST_SCAN_LIMIT)

    const last = new Map<string, string>()
    const count14d = new Map<string, number>()
    const cutoff = now.getTime() - DORMANT_DAYS * DAY_MS

    for (const p of data || []) {
        if (!p.client_id) continue
        if (!last.has(p.client_id)) last.set(p.client_id, p.created_at)
        if (new Date(p.created_at).getTime() >= cutoff) {
            count14d.set(p.client_id, (count14d.get(p.client_id) || 0) + 1)
        }
    }
    return { last, count14d }
}

async function loadConnections(): Promise<Map<string, { status: string; expiresAt: string | null }>> {
    const { data } = await supabaseAdmin
        .from("ig_connections")
        .select("client_id, status, token_expires_at")
    return new Map((data || [])
        .filter(c => c.client_id)
        .map(c => [c.client_id as string, { status: c.status, expiresAt: c.token_expires_at }]))
}

async function buildRow(
    client: { id: string; name: string; slug: string },
    activity: Activity,
    connections: Map<string, { status: string; expiresAt: string | null }>,
    now: Date,
): Promise<ClientHealthRow> {
    const { getClientSubscription } = await import("@/lib/subscription")
    const sub = await getClientSubscription(client.id).catch(() => null)

    const conn = connections.get(client.id)
    const igConnected = conn?.status === "connected"
    const tokenExpiresAt = conn?.expiresAt ?? null
    const postsLast14d = activity.count14d.get(client.id) || 0
    const lastContentAt = activity.last.get(client.id) || null

    const risks: ClientRisk[] = []
    const paying = sub?.status === "active"

    if (sub?.billingFailures) risks.push("dunning")
    if (sub?.cancelAtPeriodEnd) risks.push("cancelled")

    // Spící účet hlásíme jen u platících — u trialu je ticho normální stav.
    if (paying && postsLast14d === 0) risks.push("dormant")

    if (paying && sub && sub.creditsTotal > 0 && sub.creditsRemaining === 0) risks.push("credits_out")

    if (paying && sub?.currentPeriodEnd && !sub.cancelAtPeriodEnd) {
        const msLeft = new Date(sub.currentPeriodEnd).getTime() - now.getTime()
        if (msLeft > 0 && msLeft <= 3 * DAY_MS) risks.push("expiring")
    }

    // Rozbité propojení hlásíme jen tomu, komu na něm reálně záleží — tedy
    // účtu, který obsah vyrábí. Jinak by to hlásil každý nedodělaný onboarding.
    if (paying || postsLast14d > 0) {
        const tokenSoon = tokenExpiresAt
            ? new Date(tokenExpiresAt).getTime() - now.getTime() < TOKEN_WARN_DAYS * DAY_MS
            : false
        if (conn && (!igConnected || tokenSoon)) risks.push("ig_disconnected")
    }

    return {
        clientId: client.id,
        name: client.name,
        slug: client.slug,
        plan: sub?.planName ?? null,
        status: sub?.status ?? null,
        periodEnd: sub?.currentPeriodEnd ?? null,
        billingFailures: sub?.billingFailures ?? 0,
        cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
        lastContentAt,
        postsLast14d,
        igConnected,
        igTokenExpiresAt: tokenExpiresAt,
        creditsRemaining: sub?.creditsRemaining ?? 0,
        creditsTotal: sub?.creditsTotal ?? 0,
        risks,
    }
}

/**
 * Zaregistroval se, ale nedokončil onboarding — tedy nemá řádek v `user_clients`.
 * Do lifecycle to nepatří: cíl nemá `client_id`, takže na něj nesedí dedupe
 * idiom postavený na klientovi, a v uzavřené betě je to signál pro zakladatele,
 * ne šablonový e-mail.
 */
export async function countStalledOnboardings(now: Date = new Date()): Promise<{ count: number; oldestDays: number | null }> {
    try {
        const { data: links } = await supabaseAdmin.from("user_clients").select("user_id")
        const linked = new Set((links || []).map(l => l.user_id))

        const { data } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 })
        const cutoff = now.getTime() - DAY_MS // den na rozmyšlenou

        const stalled = (data?.users || []).filter(u =>
            !linked.has(u.id) && new Date(u.created_at).getTime() < cutoff)

        if (stalled.length === 0) return { count: 0, oldestDays: null }
        const oldest = stalled.reduce((min, u) =>
            Math.min(min, new Date(u.created_at).getTime()), Date.now())
        return { count: stalled.length, oldestDays: Math.floor((now.getTime() - oldest) / DAY_MS) }
    } catch {
        return { count: 0, oldestDays: null }
    }
}
