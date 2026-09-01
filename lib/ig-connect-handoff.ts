/**
 * Podepsané předání autorizační adresy do externího prohlížeče.
 * ==============================================================
 * Slouží jedinému účelu: aby poslední skok na instagram.com byl REDIRECT, ne
 * klepnutí na odkaz.
 *
 * iOS na klepnutí na odkaz vedoucí na instagram.com sáhne po Universal Links a
 * otevře nativní aplikaci Instagramu, která autorizační adresu neumí obsloužit a
 * skončí na „something went wrong". Na server-side redirect Universal Links
 * nereagují — prohlížeč zůstane v Safari a zobrazí přihlašovací formulář.
 *
 * Mezistránka proto neodkazuje na instagram.com, ale na naši routu
 * /api/ig-connect/bridge/go, která teprve přesměruje. Ta routa běží BEZ session
 * (Safari má vlastní cookie jar), takže cíl musí být ověřitelný sám o sobě —
 * odtud podpis. Payload sám o sobě není tajemství, podpis je tu proto, aby z naší
 * routy nešel udělat otevřený redirect.
 */

import crypto from "crypto"

/** Musí přežít jen cestu z mezistránky do prohlížeče; `state` u upload-postu
 *  stejně expiruje za 15 minut, takže delší platnost by nic nezachránila. */
const MAX_AGE_MS = 15 * 60 * 1000

/** Kam se vůbec smí přesměrovat, i kdyby podepisovací klíč unikl. */
const ALLOWED_HOSTS = new Set(["www.instagram.com", "instagram.com", "api.instagram.com"])

function getSecret(): string {
    const secret = process.env.IG_TOKEN_ENCRYPTION_KEY || process.env.CRON_SECRET
    if (!secret) {
        throw new Error("Chybí IG_TOKEN_ENCRYPTION_KEY i CRON_SECRET — nelze podepsat předání.")
    }
    return secret
}

function b64url(buf: Buffer): string {
    return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function sign(body: string): string {
    return b64url(crypto.createHmac("sha256", getSecret()).update(body).digest())
}

export function signHandoff(authorizeUrl: string): string {
    const body = b64url(Buffer.from(JSON.stringify({ u: authorizeUrl, ts: Date.now() })))
    return `${body}.${sign(body)}`
}

/** Ověří podpis, stáří i cílový host. Vrací adresu, nebo null. */
export function verifyHandoff(token: string | null): string | null {
    if (!token || !token.includes(".")) return null
    const [body, sig] = token.split(".")
    const expected = sign(body)
    // Konstantní čas; timingSafeEqual vyžaduje shodnou délku.
    if (sig.length !== expected.length) return null
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
    try {
        const payload = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"))
        if (typeof payload?.u !== "string" || typeof payload?.ts !== "number") return null
        if (Date.now() - payload.ts > MAX_AGE_MS) return null
        // Podpis říká „tohle jsme vydali my"; allowlist říká „a stejně to smí jít
        // jen na Instagram". Druhé bez prvního by stačilo na otevřený redirect
        // uvnitř instagram.com, první bez druhého na cokoli po úniku klíče.
        const url = new URL(payload.u)
        if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) return null
        return url.toString()
    } catch {
        return null
    }
}
