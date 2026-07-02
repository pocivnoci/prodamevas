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
import { signEmail } from "@/lib/email-sign"

export type MailingSegment = "waitlist" | "activeClients" | "expired"

const DAILY_CAP = 100 // Resend free-tier daily send limit
const THROTTLE_MS = 550 // ~2 req/sec, safely under Resend's rate limit

function siteUrl(): string {
    return process.env.NEXT_PUBLIC_SITE_URL || "https://chrlit.cz"
}

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

/** Wrap plain-text body lines in the branded dark template + unsubscribe footer. */
function renderEmail(subject: string, body: string, email: string): string {
    const paragraphs = body
        .split(/\n{2,}/)
        .map(p => p.trim())
        .filter(Boolean)
        .map(p => `<p style="margin:0 0 16px;line-height:1.6">${p.replace(/\n/g, "<br/>")}</p>`)
        .join("")
    const unsubUrl = `${siteUrl()}/api/email/unsubscribe?e=${encodeURIComponent(email)}&s=${signEmail(email)}`
    return `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#050505;color:#fff;padding:32px;max-width:560px;margin:0 auto">
        <h1 style="font-size:20px;text-transform:uppercase;letter-spacing:-0.5px;margin:0 0 20px">${subject}</h1>
        <div style="color:#ddd;font-size:15px">${paragraphs}</div>
        <p style="color:#555;font-size:11px;margin-top:28px;border-top:1px solid #1a1a1a;padding-top:16px">
          Chrlit · <a href="${unsubUrl}" style="color:#777">Odhlásit odběr</a>
        </p>
      </div>`
}

export interface BroadcastResult { sent: number; failed: number; skipped: number; remaining: number; total: number }

/**
 * Send a broadcast to a segment. Throttled, capped at DAILY_CAP per run.
 * Idempotency is the caller's concern (confirm-before-send in the UI); this always sends.
 */
export async function sendBroadcast(input: { segment: MailingSegment; subject: string; body: string }): Promise<BroadcastResult> {
    await requireSuperAdmin()
    const subject = input.subject?.trim()
    const body = input.body?.trim()
    if (!subject || !body) throw new Error("Předmět i text jsou povinné.")

    const recipients = await resolveRecipients(input.segment)
    const total = recipients.length
    const batch = recipients.slice(0, DAILY_CAP)
    const remaining = Math.max(0, total - batch.length)

    const { sendEmail } = await import("@/lib/email")
    let sent = 0, failed = 0
    for (const email of batch) {
        try {
            await sendEmail({ to: email, subject, html: renderEmail(subject, body, email) })
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
