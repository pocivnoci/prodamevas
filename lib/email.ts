/**
 * Minimal transactional email sender via Resend (REST, no SDK dependency).
 * Used by ops agents (e.g. the weekly founder report). Needs RESEND_API_KEY.
 * Sender defaults to Resend's shared onboarding address (works for sending to
 * your own Resend account email without domain verification); set
 * REPORT_FROM_EMAIL once a domain is verified.
 */

/** Where ops-agent mail (reports, alerts, approval requests) goes: REPORT_EMAIL, else the first super admin. */
export function getFounderEmail(): string | null {
    const explicit = process.env.REPORT_EMAIL?.trim()
    if (explicit) return explicit
    const firstAdmin = (process.env.SUPER_ADMIN_EMAILS || "").split(",").map(e => e.trim()).filter(Boolean)[0]
    return firstAdmin || null
}

export async function sendEmail(opts: {
    to: string
    subject: string
    html: string
    text?: string
}): Promise<{ id?: string }> {
    const key = process.env.RESEND_API_KEY
    if (!key) throw new Error("RESEND_API_KEY není nastavený — nelze odeslat e-mail.")
    const from = process.env.REPORT_FROM_EMAIL || "Chrlit <onboarding@resend.dev>"

    const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text }),
    })
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`)
    return res.json()
}
