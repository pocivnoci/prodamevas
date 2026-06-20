/**
 * Signed OAuth `state` for the Instagram connect flow.
 * =====================================================
 * The IG redirect back to /api/ig-connect/callback carries no reliable Supabase
 * session cookie, so the callback can't re-run requireProjectAccess on its own.
 * Instead we bind the tenant into a tamper-proof, short-lived `state` value
 * (HMAC-SHA256) when starting the flow and verify it on return — this is both the
 * CSRF token and the proof of which tenant authorized the connection.
 */

import crypto from "crypto"

const MAX_AGE_MS = 10 * 60 * 1000 // 10 minutes

interface StatePayload {
    clientId: string
    slug: string
    nonce: string
    ts: number
}

function getSecret(): string {
    const secret = process.env.IG_TOKEN_ENCRYPTION_KEY || process.env.CRON_SECRET
    if (!secret) {
        throw new Error("Chybí IG_TOKEN_ENCRYPTION_KEY i CRON_SECRET — nelze podepsat OAuth state.")
    }
    return secret
}

function b64url(buf: Buffer): string {
    return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function signState(clientId: string, slug: string): string {
    const payload: StatePayload = { clientId, slug, nonce: crypto.randomBytes(8).toString("hex"), ts: Date.now() }
    const body = b64url(Buffer.from(JSON.stringify(payload)))
    const sig = b64url(crypto.createHmac("sha256", getSecret()).update(body).digest())
    return `${body}.${sig}`
}

/** Verify HMAC + freshness; returns the bound tenant or null if invalid/expired. */
export function verifyState(state: string | null): { clientId: string; slug: string } | null {
    if (!state || !state.includes(".")) return null
    const [body, sig] = state.split(".")
    const expected = b64url(crypto.createHmac("sha256", getSecret()).update(body).digest())
    // Constant-time compare; lengths must match for timingSafeEqual.
    if (sig.length !== expected.length) return null
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
    try {
        const payload = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as StatePayload
        if (!payload.clientId || !payload.slug) return null
        if (Date.now() - payload.ts > MAX_AGE_MS) return null
        return { clientId: payload.clientId, slug: payload.slug }
    } catch {
        return null
    }
}
