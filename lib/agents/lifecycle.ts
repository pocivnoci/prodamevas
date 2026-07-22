/**
 * Lifecycle e-mail agent — revenue without touching.
 * ===================================================
 * A daily scan finds customers at a lifecycle moment (not activated, credits
 * low, churned, waiting on the waitlist) and PROPOSES one e-mail per person via
 * the safety rails (outbound tier → founder approves). Nothing here sends
 * directly — the send happens in the `send_lifecycle_email` task only after
 * approval, through sendNotification (opt-out respected, unsubscribe footer).
 *
 * Dedupe is the audit trail itself: a proposed/approved/rejected agent_actions
 * row for the same kind + person inside the window blocks a re-proposal, so a
 * daily scan can never spam and a founder's rejection is respected.
 */

import supabaseAdmin from "@/supabase/admin"
import { requestAction } from "@/lib/agent-safety"
import { getOwnerEmail, siteUrl, studioDeepLink } from "@/lib/notifications"

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_PROPOSALS_PER_RUN = 15
const MAX_WAITLIST_PER_RUN = 10

export type LifecycleKind = "activation_nudge" | "credit_low" | "winback" | "waitlist_drip"

/** Re-proposal block window per kind (days; null = once ever). */
const DEDUPE_DAYS: Record<LifecycleKind, number | null> = {
    activation_nudge: null,
    credit_low: 30,
    winback: 90,
    waitlist_drip: 30,
}

export interface LifecycleProposal {
    actionId: string
    kind: LifecycleKind
    email: string
    clientId: string | null
    label: string
}

interface Candidate {
    kind: LifecycleKind
    email: string
    clientId: string | null
    clientName?: string
    vars?: Record<string, unknown>
}

/** Any prior send_lifecycle_email action for this kind+person inside the window? */
async function recentlyHandled(kind: LifecycleKind, target: { clientId?: string | null; email: string }): Promise<boolean> {
    try {
        let q = supabaseAdmin
            .from("agent_actions")
            .select("id", { count: "exact", head: true })
            .eq("task_type", "send_lifecycle_email")
            .eq("payload->>kind", kind)
        const days = DEDUPE_DAYS[kind]
        if (days) q = q.gte("created_at", new Date(Date.now() - days * DAY_MS).toISOString())
        q = target.clientId ? q.eq("client_id", target.clientId) : q.eq("payload->>email", target.email.toLowerCase())
        const { count } = await q
        return (count || 0) > 0
    } catch {
        return true // dedupe source broken → propose nothing rather than risk spam
    }
}

// ── Candidate finders (each isolated — one broken source never kills the scan) ──

/** Clients 2–14 days old that never started their own campaign (showcase doesn't count). */
async function findActivationCandidates(): Promise<Candidate[]> {
    const { data: clients } = await supabaseAdmin
        .from("clients")
        .select("id, name, slug, created_at")
        .eq("is_active", true)
        .gte("created_at", new Date(Date.now() - 14 * DAY_MS).toISOString())
        .lte("created_at", new Date(Date.now() - 2 * DAY_MS).toISOString())
    const out: Candidate[] = []
    for (const c of clients || []) {
        const { data: campaigns } = await supabaseAdmin
            .from("ig_campaigns").select("options").eq("client_id", c.id).limit(20)
        const ownCampaign = (campaigns || []).some(row => (row.options as Record<string, unknown> | null)?.showcase !== true)
        if (ownCampaign) continue
        const email = await getOwnerEmail(c.id)
        if (email) out.push({ kind: "activation_nudge", email, clientId: c.id, clientName: c.name })
    }
    return out
}

/** Active subscriptions at ≤10 % credits. */
async function findCreditLowCandidates(): Promise<Candidate[]> {
    const { getClientSubscription } = await import("@/lib/subscription")
    const { data: subs } = await supabaseAdmin
        .from("subscriptions").select("client_id").eq("status", "active")
    const out: Candidate[] = []
    for (const s of subs || []) {
        if (!s.client_id) continue
        try {
            const info = await getClientSubscription(s.client_id)
            if (!info || info.status !== "active" || info.creditsTotal <= 0) continue
            if (info.creditsRemaining > Math.max(1, Math.ceil(info.creditsTotal * 0.1))) continue
            const email = await getOwnerEmail(s.client_id)
            const { data: c } = await supabaseAdmin.from("clients").select("name").eq("id", s.client_id).single()
            if (email) out.push({
                kind: "credit_low", email, clientId: s.client_id, clientName: c?.name,
                vars: { creditsRemaining: info.creditsRemaining, creditsTotal: info.creditsTotal },
            })
        } catch { /* one broken sub never kills the scan */ }
    }
    return out
}

/** Subscriptions that expired 14–30 days ago (dunning e-mails covered the first days). */
async function findWinbackCandidates(): Promise<Candidate[]> {
    const { data: subs } = await supabaseAdmin
        .from("subscriptions")
        .select("client_id, current_period_end")
        .eq("status", "expired")
        .gte("current_period_end", new Date(Date.now() - 30 * DAY_MS).toISOString())
        .lte("current_period_end", new Date(Date.now() - 14 * DAY_MS).toISOString())
    const out: Candidate[] = []
    for (const s of subs || []) {
        if (!s.client_id) continue
        const email = await getOwnerEmail(s.client_id)
        const { data: c } = await supabaseAdmin.from("clients").select("name").eq("id", s.client_id).single()
        if (email) out.push({ kind: "winback", email, clientId: s.client_id, clientName: c?.name })
    }
    return out
}

/** Waitlist entries older than a week — keep the list warm while invites are gated. */
async function findWaitlistCandidates(): Promise<Candidate[]> {
    const { data } = await supabaseAdmin
        .from("waitlist").select("email")
        .lte("created_at", new Date(Date.now() - 7 * DAY_MS).toISOString())
        .order("created_at", { ascending: true })
        .limit(MAX_WAITLIST_PER_RUN * 3) // headroom for dedupe-filtered ones
    return (data || []).map(w => ({ kind: "waitlist_drip" as const, email: String(w.email), clientId: null }))
}

// ── Scan ────────────────────────────────────────────────────────────────────

const KIND_LABELS: Record<LifecycleKind, string> = {
    activation_nudge: "Aktivační pobídka",
    credit_low: "Docházejí kredity",
    winback: "Winback po expiraci",
    waitlist_drip: "Waitlist připomínka",
}

/**
 * Find lifecycle moments and propose one outbound e-mail per person (approval-
 * gated, notify suppressed — the caller sends one digest instead of N e-mails).
 */
export async function scanLifecycle(): Promise<LifecycleProposal[]> {
    const groups = await Promise.all([
        findActivationCandidates().catch(() => [] as Candidate[]),
        findCreditLowCandidates().catch(() => [] as Candidate[]),
        findWinbackCandidates().catch(() => [] as Candidate[]),
        findWaitlistCandidates().catch(() => [] as Candidate[]),
    ])

    const proposals: LifecycleProposal[] = []
    let waitlistCount = 0
    for (const cand of groups.flat()) {
        if (proposals.length >= MAX_PROPOSALS_PER_RUN) break
        if (cand.kind === "waitlist_drip" && waitlistCount >= MAX_WAITLIST_PER_RUN) continue
        if (await recentlyHandled(cand.kind, { clientId: cand.clientId, email: cand.email })) continue

        const outcome = await requestAction({
            clientId: cand.clientId,
            agentType: "lifecycle",
            action: `${KIND_LABELS[cand.kind]} → ${cand.email}`,
            riskTier: "outbound",
            taskType: "send_lifecycle_email",
            payload: {
                kind: cand.kind,
                email: cand.email.toLowerCase(),
                clientName: cand.clientName || null,
                ...(cand.vars || {}),
            },
            notify: false, // one digest e-mail at the end of the scan, not one per person
        })
        if (outcome.status === "pending_approval") {
            if (cand.kind === "waitlist_drip") waitlistCount++
            proposals.push({
                actionId: outcome.actionId,
                kind: cand.kind,
                email: cand.email,
                clientId: cand.clientId,
                label: cand.clientName ? `${cand.clientName}` : cand.email,
            })
        }
    }
    return proposals
}

// ── Templates + send (runs only AFTER founder approval) ─────────────────────

export function buildLifecycleEmail(kind: LifecycleKind, vars: { clientName?: string | null; clientId?: string | null; creditsRemaining?: number; creditsTotal?: number }): { subject: string; body: string } {
    const name = vars.clientName ? ` pro ${vars.clientName}` : ""
    switch (kind) {
        case "activation_nudge":
            return {
                subject: "Váš obsah čeká — spusťte první kampaň",
                body: `Založili jste si Chrlit${name}, ale zatím jste nespustili žádnou vlastní kampaň. Ukázkové posty už na vás čekají v dashboardu.\n\n` +
                    `Stačí jedno kliknutí a AI vám připraví celý týdenní plán obsahu — texty, obrázky, kalendář.\n\n` +
                    `<a href="${vars.clientId ? studioDeepLink(vars.clientId, "plan") : siteUrl() + "/dashboard/instagram"}">Otevřít studio →</a>`,
            }
        case "credit_low":
            return {
                subject: "Kredity skoro vyčerpané",
                body: `V plánu${name} zbývá ${vars.creditsRemaining ?? "málo"} z ${vars.creditsTotal ?? "?"} kreditů. Aby obsah nepřestal vycházet, navyšte plán nebo dokupte kredity.\n\n` +
                    `<a href="${vars.clientId ? studioDeepLink(vars.clientId, "subscription") : siteUrl() + "/dashboard/instagram"}">Spravovat předplatné →</a>`,
            }
        case "winback":
            return {
                subject: "Instagram mezitím spí — vraťte se k Chrlit",
                body: `Předplatné${name} vypršelo a účet přestal dostávat nový obsah. Vaše nastavení, značka i naučené preference zůstávají uložené — návrat je otázka jednoho kliknutí.\n\n` +
                    `<a href="${vars.clientId ? studioDeepLink(vars.clientId, "subscription") : siteUrl()}">Obnovit předplatné →</a>`,
            }
        case "waitlist_drip":
            return {
                subject: "Nezapomněli jsme na vás",
                body: `Jste na čekací listině Chrlit Studia. Pouštíme dovnitř postupně, aby každý nový účet dostal plnou kvalitu — další vlna pozvánek je na cestě.\n\n` +
                    `Díky za trpělivost. Ozveme se, jakmile na vás přijde řada.`,
            }
    }
}

/** Handler body for `send_lifecycle_email` — payload comes from an approved proposal. */
export async function sendLifecycleEmail(payload: Record<string, unknown>): Promise<{ ok: boolean; kind: string; to: string }> {
    const kind = String(payload.kind || "") as LifecycleKind
    const to = String(payload.email || "").trim().toLowerCase()
    if (!to || !(kind in DEDUPE_DAYS)) throw new Error(`send_lifecycle_email: invalid payload (kind=${payload.kind}, email=${payload.email})`)

    const { subject, body } = buildLifecycleEmail(kind, {
        clientName: (payload.clientName as string) || null,
        clientId: (payload.clientId as string) || null,
        creditsRemaining: typeof payload.creditsRemaining === "number" ? payload.creditsRemaining : undefined,
        creditsTotal: typeof payload.creditsTotal === "number" ? payload.creditsTotal : undefined,
    })
    const { sendNotification } = await import("@/lib/notifications")
    await sendNotification({ to, subject, body, kind: "notification" })
    return { ok: true, kind, to }
}
