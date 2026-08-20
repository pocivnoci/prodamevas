"use server"

/**
 * Admin Mailing panel — super-admin broadcast to a segment via Resend.
 * ===================================================================
 * Reuses lib/email.ts (sendEmail). No new vendor. Resend free tier = 100 emails/day,
 * 3,000/mo — sendBroadcast caps a run at DAILY_CAP and reports the remainder so a big
 * list is sent across days. Every email carries an unsubscribe link; global opt-outs
 * (email_optouts) are always filtered out.
 */

import supabaseAdmin from "@/supabase/admin"
import { requireSuperAdmin } from "@/lib/auth-guard"
import { renderBrandedEmailParts } from "@/lib/notifications"
import { BROADCAST_TEMPLATES, EMAIL_TEMPLATES, getTemplate } from "@/lib/mail/registry"
import type { TemplateField, TemplateVars } from "@/lib/mail/template"

export type MailingSegment = "waitlist" | "activeClients" | "expired"

const DAILY_CAP = 100 // Resend free-tier daily send limit
const THROTTLE_MS = 550 // ~2 req/sec, safely under Resend's rate limit

/** Emails that have globally opted out — filtered from every segment. */
async function getOptOuts(): Promise<Set<string>> {
    const { data } = await supabaseAdmin.from("email_optouts").select("email")
    return new Set((data || []).map(r => String(r.email).toLowerCase()))
}

/** Owner emails of clients whose live subscription is in one of `statuses`. */
async function clientOwnerEmails(statuses: string[]): Promise<string[]> {
    const { data: subs } = await supabaseAdmin
        .from("subscriptions")
        .select("client_id, status")
        .in("status", statuses)
    const clientIds = [...new Set((subs || []).map(s => s.client_id).filter(Boolean))]
    if (clientIds.length === 0) return []

    const { data: links } = await supabaseAdmin
        .from("user_clients")
        .select("client_id, user_id, role")
        .in("client_id", clientIds)
        .eq("role", "owner")

    const emails = new Set<string>()
    for (const link of links || []) {
        try {
            const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(link.user_id)
            if (user?.email) emails.add(user.email.toLowerCase())
        } catch { /* skip a broken link */ }
    }
    return [...emails]
}

async function resolveRecipients(segment: MailingSegment): Promise<string[]> {
    let emails: string[] = []
    if (segment === "waitlist") {
        const { data } = await supabaseAdmin.from("waitlist").select("email")
        emails = (data || []).map(r => String(r.email).toLowerCase())
    } else if (segment === "activeClients") {
        emails = await clientOwnerEmails(["active", "trialing"])
    } else if (segment === "expired") {
        emails = await clientOwnerEmails(["expired"])
    }
    const optOuts = await getOptOuts()
    return [...new Set(emails)].filter(e => e && !optOuts.has(e))
}

/** Live recipient counts per segment (after opt-out filtering) for the UI. */
export async function getMailingSegments(): Promise<{ waitlist: number; activeClients: number; expired: number }> {
    await requireSuperAdmin()
    const [waitlist, activeClients, expired] = await Promise.all([
        resolveRecipients("waitlist"),
        resolveRecipients("activeClients"),
        resolveRecipients("expired"),
    ])
    return { waitlist: waitlist.length, activeClients: activeClients.length, expired: expired.length }
}

/** The actual opt-out-filtered email list for a segment — powers per-recipient selection in the UI. */
export async function getMailingRecipients(segment: MailingSegment): Promise<string[]> {
    await requireSuperAdmin()
    return resolveRecipients(segment)
}

export interface BroadcastResult { sent: number; failed: number; skipped: number; remaining: number; total: number }

// ── Šablony ─────────────────────────────────────────────────────────────────

export interface MailingTemplateInfo {
    id: string
    label: string
    group: string
    kind: "transactional" | "notification"
    fields: TemplateField[]
    sample: TemplateVars
}

/**
 * Šablony nabízené v panelu. Posílá se jen popis (schéma + ukázka), ne funkce —
 * `build` zůstává na serveru, takže si klient nemůže vyrobit vlastní zprávu
 * a poslat ji pod hlavičkou Chrlitu.
 */
export async function getMailingTemplates(): Promise<MailingTemplateInfo[]> {
    await requireSuperAdmin()
    return BROADCAST_TEMPLATES.map(t => ({
        id: t.id, label: t.label, group: t.group, kind: t.kind, fields: t.fields, sample: t.sample,
    }))
}

export interface MailPreview { subject: string; html: string; text: string; kb: number }

export interface GalleryEntry extends MailPreview {
    id: string
    label: string
    group: string
    kind: "transactional" | "notification"
}

/**
 * Všechny šablony vyrenderované z ukázkových dat — galerie.
 *
 * Změnu tokenu je potřeba vidět na všech šablonách naráz, ne na té jedné, co
 * se zrovna upravuje. Renderuje se **všechno včetně transakčních**, které
 * v Mailingu nejsou k dispozici, protože chodí samy.
 */
export async function getEmailGallery(): Promise<GalleryEntry[]> {
    await requireSuperAdmin()
    return EMAIL_TEMPLATES.map(t => {
        const { subject, html, text } = t.render(t.sample, "ukazka@chrlit.cz")
        return {
            id: t.id, label: t.label, group: t.group, kind: t.kind,
            subject, html, text, kb: Buffer.byteLength(html, "utf8") / 1024,
        }
    })
}

/**
 * Náhled pro `<iframe srcDoc>` — přesně to, co dorazí do schránky.
 *
 * Renderuje se na serveru týmž kódem jako ostré odeslání. Panel dřív náhled
 * kreslil Tailwindem, takže ukazoval něco jiného, než co odešlo.
 */
export async function previewMail(input: {
    templateId?: string
    vars?: TemplateVars
    subject?: string
    body?: string
}): Promise<MailPreview> {
    await requireSuperAdmin()
    const sample = "ukazka@chrlit.cz"

    if (input.templateId) {
        const t = getTemplate(input.templateId)
        if (!t) throw new Error(`Šablona „${input.templateId}" neexistuje.`)
        const { subject, html, text } = t.render(input.vars || {}, sample)
        return { subject, html, text, kb: Buffer.byteLength(html, "utf8") / 1024 }
    }

    const subject = input.subject?.trim() || "(bez předmětu)"
    const { html, text } = renderBrandedEmailParts(subject, input.body || "", { unsubscribeEmail: sample })
    return { subject, html, text, kb: Buffer.byteLength(html, "utf8") / 1024 }
}

/** Odešle zprávu na adresu přihlášeného super-admina — než ji uvidí zákazníci. */
export async function sendTestEmail(input: { templateId?: string; vars?: TemplateVars; subject?: string; body?: string }): Promise<string> {
    const { email } = await requireSuperAdmin()
    const { sendEmail } = await import("@/lib/email")

    if (input.templateId) {
        const t = getTemplate(input.templateId)
        if (!t) throw new Error(`Šablona „${input.templateId}" neexistuje.`)
        const { subject, html, text } = t.render(input.vars || {}, email)
        await sendEmail({ to: email, subject: `[TEST] ${subject}`, html, text })
        return email
    }

    const subject = input.subject?.trim()
    const body = input.body?.trim()
    if (!subject || !body) throw new Error("Předmět i text jsou povinné.")
    const { html, text } = renderBrandedEmailParts(subject, body, { unsubscribeEmail: email })
    await sendEmail({ to: email, subject: `[TEST] ${subject}`, html, text })
    return email
}

/**
 * Send a broadcast to a segment. Throttled, capped at DAILY_CAP per run.
 * Idempotency is the caller's concern (confirm-before-send in the UI); this always sends.
 *
 * `recipients` (optional) narrows the send to specific addresses within the segment.
 * They are always validated against the freshly resolved + opt-out-filtered segment list,
 * so the client can never smuggle in an address that isn't actually in the segment.
 * Omitted → send to the whole segment (backward-compatible).
 */
export async function sendBroadcast(input: {
    segment: MailingSegment
    /** Předmět a text — starší cesta, pořád funkční. */
    subject?: string
    body?: string
    /** Šablona z registru. Má přednost před `subject`/`body`. */
    template?: { id: string; vars: TemplateVars }
    recipients?: string[]
}): Promise<BroadcastResult> {
    await requireSuperAdmin()

    // Zpráva se skládá jednou; per příjemce se mění jen odhlašovací odkaz.
    const template = input.template ? getTemplate(input.template.id) : null
    if (input.template && !template) throw new Error(`Šablona „${input.template.id}" neexistuje.`)

    const subject = template
        ? template.render(input.template!.vars, "ukazka@chrlit.cz").subject
        : input.subject?.trim()
    const body = input.body?.trim()
    if (!subject) throw new Error("Předmět je povinný.")
    if (!template && !body) throw new Error("Předmět i text jsou povinné.")

    const renderFor = (email: string): { html: string; text: string } =>
        template
            ? template.render(input.template!.vars, email)
            : renderBrandedEmailParts(subject, body!, { unsubscribeEmail: email })

    const resolved = await resolveRecipients(input.segment)
    let recipients = resolved
    if (input.recipients) {
        const wanted = new Set(input.recipients.map(e => String(e).trim().toLowerCase()).filter(Boolean))
        recipients = resolved.filter(e => wanted.has(e))
        if (recipients.length === 0) throw new Error("Žádný z vybraných příjemců není v segmentu.")
    }
    const total = recipients.length
    const batch = recipients.slice(0, DAILY_CAP)
    const remaining = Math.max(0, total - batch.length)

    const { sendEmail } = await import("@/lib/email")
    let sent = 0, failed = 0
    for (const email of batch) {
        try {
            const { html, text } = renderFor(email)
            await sendEmail({ to: email, subject, html, text })
            sent++
        } catch (err: any) {
            console.warn(`mailing: send to ${email} failed: ${err?.message?.substring(0, 80)}`)
            failed++
        }
        await new Promise(r => setTimeout(r, THROTTLE_MS))
    }

    console.log(`✉️ Broadcast "${subject}" → ${input.segment}: ${sent} sent, ${failed} failed, ${remaining} remaining`)
    return { sent, failed, skipped: 0, remaining, total }
}
