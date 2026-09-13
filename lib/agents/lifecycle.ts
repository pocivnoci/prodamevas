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
 *
 * Od 10. 9. 2026 nese každý návrh `policyKey` ve tvaru `lifecycle:<kind>`:
 * zakladatel může jednou říct „tenhle druh posílej sám" a systém se pak ptát
 * přestane (`lib/agent-policy.ts`). Bez uloženého souhlasu se nic nemění.
 *
 * CO SE NENAVRHUJE VŮBEC (a proč to tu je napsané)
 * ------------------------------------------------
 * 8. 9. 2026 čekalo ve frontě 27 akcí, nejstarší 46 dní — a jedenáct z nich
 * nemělo nikdy vzniknout: devět mířilo na značky z výlohy (Rohlík, Portu,
 * Ambiente…), kde je „vlastníkem" zakladatel, takže měl schvalovat pobídku
 * sám sobě, a dvě na testovací adresu. Fronta, ve které je polovina šumu,
 * se přestane číst celá — a pak v ní uvázne i to, co odbavit šlo.
 *
 * Filtry proto stojí na `lib/audience.ts` a platí pro KAŽDÝ návrh, ne pro
 * jednotlivé hledače: nový hledač se nemůže omylem narodit bez nich.
 */

import supabaseAdmin from "@/supabase/admin"
import { requestAction } from "@/lib/agent-safety"
import { isInternalEmail, NOT_SHOWCASE } from "@/lib/audience"
import { buildLifecycleEmail, type LifecycleKind } from "@/lib/agents/lifecycle-templates"
import { DEFAULT_UI_LOCALE } from "@/lib/i18n/locales"
import { localeOfClientOwner, mailTranslatorSync } from "@/lib/mail/i18n"
import { getOwnerEmail } from "@/lib/notifications"
import { isSuperAdminEmail } from "@/lib/super-admins"

// Znění e-mailů žije v `lifecycle-templates.ts` (čistá funkce, bez DB).
export { buildLifecycleEmail }
export type { LifecycleKind }

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_PROPOSALS_PER_RUN = 15
const MAX_WAITLIST_PER_RUN = 10

/** Re-proposal block window per kind (days; null = once ever). */
const DEDUPE_DAYS: Record<LifecycleKind, number | null> = {
    activation_nudge: null,
    credit_low: 30,
    winback: 90,
    waitlist_drip: 30,
    dormant: 30,
    ig_disconnected: 14,
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

/**
 * Any prior send_lifecycle_email action for this kind+person inside the window?
 *
 * DVĚ OTÁZKY, NE JEDNA. Okno platí pro **rozhodnuté** akce: schválenou pobídku
 * neopakuj měsíc, zamítnutou respektuj. Návrh, který pořád leží ve frontě,
 * ale blokuje **bez ohledu na stáří** — a přesně tohle tu chybělo.
 *
 * Bez toho fronta rostla sama: waitlistová připomínka na tutéž adresu se po
 * třiceti dnech navrhla znovu, protože ta první vypadla z okna. Zakladatel tak
 * dostával druhou kopii otázky, na kterou ještě neodpověděl — a 8. 9. 2026
 * v tom stavu čekalo pět lidí ve dvou kopiích. Opakovaný návrh nikomu nepomůže
 * se rozhodnout; jen prodlouží seznam, který se pak nečte celý.
 */
async function recentlyHandled(kind: LifecycleKind, target: { clientId?: string | null; email: string }): Promise<boolean> {
    // Adresa nebo tenant — podle toho, co u téhle příležitosti vůbec existuje.
    const scopeCol = target.clientId ? "client_id" : "payload->>email"
    const scopeVal = target.clientId ?? target.email.toLowerCase()

    try {
        // 1) Nerozhodnutý návrh — blokuje vždycky, i kdyby byl z loňska.
        const { count: pending } = await supabaseAdmin
            .from("agent_actions")
            .select("id", { count: "exact", head: true })
            .eq("task_type", "send_lifecycle_email")
            .eq("payload->>kind", kind)
            .eq("status", "proposed")
            .eq(scopeCol, scopeVal)
        if ((pending || 0) > 0) return true

        // 2) Rozhodnuté akce — platí okno podle druhu (null = jednou za život).
        let q = supabaseAdmin
            .from("agent_actions")
            .select("id", { count: "exact", head: true })
            .eq("task_type", "send_lifecycle_email")
            .eq("payload->>kind", kind)
            .eq(scopeCol, scopeVal)
        const days = DEDUPE_DAYS[kind]
        if (days) q = q.gte("created_at", new Date(Date.now() - days * DAY_MS).toISOString())
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
        .or(NOT_SHOWCASE) // seed portfolia zakládá deset značek naráz — bez tohohle deset pobídek
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

/**
 * Zdravotní rizika platících účtů → pobídka. Čte `client-health.ts`, aby
 * definice „spící" a „odpojený" existovala v repu jednou; brief a tab Firma
 * pak nemůžou tvrdit něco jiného než e-mail.
 *
 * Jeden průchod dává obě kategorie — dva samostatné findery by ten (nelevný)
 * přehled počítaly dvakrát.
 */
async function findHealthCandidates(): Promise<Candidate[]> {
    const { buildClientHealth } = await import("@/lib/agents/client-health")
    const rows = await buildClientHealth()
    const out: Candidate[] = []

    for (const r of rows) {
        // Priorita: rozbité propojení je konkrétní úkon, spící účet jen pobídka.
        // Poslat obojí najednou znamená nechat člověka vybírat, co je důležitější.
        const kind: LifecycleKind | null = r.risks.includes("ig_disconnected")
            ? "ig_disconnected"
            : r.risks.includes("dormant") ? "dormant" : null
        if (!kind) continue

        const email = await getOwnerEmail(r.clientId)
        if (email) out.push({ kind, email, clientId: r.clientId, clientName: r.name })
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

// i18n-ignore-start: popisky pro adminský panel (label akce v `agent_actions`), zákazník je nevidí
const KIND_LABELS: Record<LifecycleKind, string> = {
    activation_nudge: "Aktivační pobídka",
    credit_low: "Docházejí kredity",
    winback: "Winback po expiraci",
    waitlist_drip: "Waitlist připomínka",
    dormant: "Spící účet",
    ig_disconnected: "Odpojený Instagram",
}
// i18n-ignore-end

/**
 * Find lifecycle moments and propose one outbound e-mail per person (approval-
 * gated, notify suppressed — the caller sends one digest instead of N e-mails).
 */
export async function scanLifecycle(): Promise<LifecycleProposal[]> {
    const groups = await Promise.all([
        findActivationCandidates().catch(() => [] as Candidate[]),
        findCreditLowCandidates().catch(() => [] as Candidate[]),
        findWinbackCandidates().catch(() => [] as Candidate[]),
        findHealthCandidates().catch(() => [] as Candidate[]),
        findWaitlistCandidates().catch(() => [] as Candidate[]),
    ])

    const proposals: LifecycleProposal[] = []
    let waitlistCount = 0
    for (const cand of groups.flat()) {
        if (proposals.length >= MAX_PROPOSALS_PER_RUN) break
        if (cand.kind === "waitlist_drip" && waitlistCount >= MAX_WAITLIST_PER_RUN) continue
        // Naše vlastní adresa není zákazník. Testovací účet nasbíral návrh
        // pokaždé, když vypadl z okna dedupe — a schválit ho nešlo ani omylem.
        //
        // Super-admin je zvláštní případ: `thomas.pocar@gmail.com` je normální
        // gmail, ale patří zakladateli, který si pod ním drží zkušební značky.
        // Návrh „pošli mu winback" pak znamená, že má schválit e-mail sám sobě —
        // tři takové ve frontě 8. 9. 2026 byly.
        if (isInternalEmail(cand.email) || isSuperAdminEmail(cand.email)) continue
        if (await recentlyHandled(cand.kind, { clientId: cand.clientId, email: cand.email })) continue

        const outcome = await requestAction({
            clientId: cand.clientId,
            agentType: "lifecycle",
            action: `${KIND_LABELS[cand.kind]} → ${cand.email}`,
            riskTier: "outbound",
            taskType: "send_lifecycle_email",
            // Druh, ne handler: `send_lifecycle_email` obsluhuje všech šest
            // šablon, takže souhlas s připomínkou čekatelům nesmí zapnout
            // i oslovení po vypršení předplatného. Klíč je proto per `kind`.
            policyKey: `lifecycle:${cand.kind}`,
            payload: {
                kind: cand.kind,
                email: cand.email.toLowerCase(),
                clientName: cand.clientName || null,
                ...(cand.vars || {}),
            },
            notify: false, // one digest e-mail at the end of the scan, not one per person
        })
        // Stálý souhlas znamená `executed` místo `pending_approval` — do stropu
        // na běh se to musí počítat stejně, jinak by souhlas s připomínkami
        // čekatelům odemkl neomezenou dávku právě tam, kde je jich nejvíc.
        if (outcome.status === "executed" && cand.kind === "waitlist_drip") waitlistCount++

        if (outcome.status === "pending_approval") {
            if (cand.kind === "waitlist_drip") waitlistCount++
            proposals.push({
                actionId: outcome.actionId,
                kind: cand.kind,
                email: cand.email,
                clientId: cand.clientId,
                label: cand.clientName || cand.email,
            })
        }
    }
    return proposals
}

// ── Templates + send (runs only AFTER founder approval) ─────────────────────

/** Handler body for `send_lifecycle_email` — payload comes from an approved proposal. */
export async function sendLifecycleEmail(payload: Record<string, unknown>): Promise<{ ok: boolean; kind: string; to: string }> {
    const kind = String(payload.kind || "") as LifecycleKind
    const to = String(payload.email || "").trim().toLowerCase()
    if (!to || !(kind in DEDUPE_DAYS)) throw new Error(`send_lifecycle_email: invalid payload (kind=${payload.kind}, email=${payload.email})`)

    // Jazyk příjemce: pobídka jde vlastníkovi značky (adresa z `getOwnerEmail`),
    // takže jeho účet určuje i jazyk — a zjišťuje se až teď, při odeslání, ne při
    // návrhu. Připomínka čekatelům (`waitlist_drip`) nemá účet ani značku → čeština.
    const clientId = (payload.clientId as string) || null
    const locale = clientId ? await localeOfClientOwner(clientId) : DEFAULT_UI_LOCALE
    const t = mailTranslatorSync(locale, "notices")

    const msg = buildLifecycleEmail(kind, {
        clientName: (payload.clientName as string) || null,
        clientId,
        creditsRemaining: typeof payload.creditsRemaining === "number" ? payload.creditsRemaining : undefined,
        creditsTotal: typeof payload.creditsTotal === "number" ? payload.creditsTotal : undefined,
    }, t, locale)
    // Šablona si řekla, že jí chybí čísla, bez kterých by zpráva lhala. Není to
    // chyba tasku (retry by ji neopravil) — jen se nic nepošle.
    if (!msg) {
        console.warn(`send_lifecycle_email: ${kind} pro ${to} nemá data, neodesílám`)
        return { ok: false, kind, to }
    }
    const { subject, body } = msg
    const { sendNotification } = await import("@/lib/notifications")
    await sendNotification({ to, subject, body, kind: "notification", locale })
    return { ok: true, kind, to }
}
