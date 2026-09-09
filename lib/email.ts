/**
 * Minimal transactional email sender via Resend (REST, no SDK dependency).
 * Used by ops agents (e.g. the weekly founder report). Needs RESEND_API_KEY.
 * Sender defaults to Resend's shared onboarding address (works for sending to
 * your own Resend account email without domain verification); set
 * REPORT_FROM_EMAIL once a domain is verified.
 */

import { superAdminEmails } from "@/lib/super-admins"

/** Where ops-agent mail (reports, alerts, approval requests) goes: REPORT_EMAIL, else the first super admin. */
export function getFounderEmail(): string | null {
    const explicit = process.env.REPORT_EMAIL?.trim()
    if (explicit) return explicit
    const firstAdmin = superAdminEmails()[0]
    return firstAdmin || null
}

/**
 * Příloha e-mailu. `content` je base64 **bez** `data:` prefixu — přesně to, co
 * čeká Resend. Obsah necháváme projít až sem: příloha je pro Resend součást
 * jednoho requestu, takže nikde nemusí ležet veřejná URL, ze které by šel
 * soubor stáhnout i bez adresáta.
 */
export interface MailAttachment {
    filename: string
    /** base64 obsahu souboru */
    content: string
    contentType?: string
}

export async function sendEmail(opts: {
    to: string
    subject: string
    html: string
    text?: string
    attachments?: MailAttachment[]
}): Promise<{ id?: string }> {
    const key = process.env.RESEND_API_KEY
    if (!key) throw new Error("RESEND_API_KEY není nastavený — nelze odeslat e-mail.")
    const from = process.env.REPORT_FROM_EMAIL || "Chrlit <onboarding@resend.dev>"

    const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            from, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text,
            // Klíč se posílá jen když opravdu je co přiložit — prázdné pole si
            // Resend vykládá po svém a není důvod to zkoušet.
            ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
        }),
    })
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`)
    return res.json()
}
