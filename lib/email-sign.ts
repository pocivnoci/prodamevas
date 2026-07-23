import crypto from "crypto"

/**
 * Signs an email address for the one-click unsubscribe link so the token can't be
 * trivially forged or enumerated. Low-stakes (worst case: a marketing opt-out), so
 * no auth — just an HMAC over the lowercased email.
 */
/** Shared HMAC secret for signed low/medium-stakes links (unsubscribe, agent approval). */
export function emailSigningSecret(): string {
    return process.env.EMAIL_SECRET || process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "chrlit-email-fallback"
}
const secret = emailSigningSecret

export function signEmail(email: string): string {
    return crypto.createHmac("sha256", secret()).update(email.trim().toLowerCase()).digest("hex").slice(0, 32)
}

export function verifyEmailSig(email: string, sig: string): boolean {
    const expected = signEmail(email)
    // constant-time compare (equal length by construction)
    return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
}
