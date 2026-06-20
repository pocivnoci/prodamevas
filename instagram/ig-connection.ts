/**
 * Instagram connection data layer (server-only).
 * ===============================================
 * One module owning the ig_connections table + the Instagram OAuth token
 * lifecycle for "Instagram API with Instagram Login". Always takes an explicit
 * clientId (never getActiveProject() — that module-global state cross-contaminates
 * tenants) and goes through the service-role client (RLS deny-all on the table).
 *
 * Tokens are encrypted at rest (lib/ig-token-crypto.ts); plaintext only ever lives
 * in memory during a request.
 */

import supabaseAdmin from "@/supabase/admin"
import { encryptToken, decryptToken } from "@/lib/ig-token-crypto"
import { withRetry } from "@/utils/retry"

const IG_GRAPH_BASE = "https://graph.instagram.com"
const IG_OAUTH_TOKEN_URL = "https://api.instagram.com/oauth/access_token"

// This module owns the Instagram provider row in the multi-provider connections
// table (one row per (client_id, provider)). Every query scopes to this provider.
const PROVIDER = "instagram"

export interface IgConnection {
    igUserId: string
    igUsername: string | null
    accessToken: string // decrypted
    tokenExpiresAt: string | null
    status: "connected" | "expired" | "revoked"
}

export interface IgConnectionMeta {
    igUserId: string
    igUsername: string | null
    tokenExpiresAt: string | null
    refreshedAt: string | null
    status: "connected" | "expired" | "revoked"
}

/**
 * UI-safe metadata (NO token). Use this for the Settings "Connected as @handle"
 * card — never decrypt a credential just to show status.
 */
export async function getConnectionMeta(clientId: string): Promise<IgConnectionMeta | null> {
    const { data } = await supabaseAdmin
        .from("ig_connections")
        .select("ig_user_id, ig_username, token_expires_at, refreshed_at, status")
        .eq("client_id", clientId)
        .eq("provider", PROVIDER)
        .maybeSingle()
    if (!data) return null
    return {
        igUserId: data.ig_user_id,
        igUsername: data.ig_username,
        tokenExpiresAt: data.token_expires_at,
        refreshedAt: data.refreshed_at,
        status: data.status,
    }
}

/**
 * Full connection incl. the decrypted access token — for engine code that calls
 * the Graph API (metrics sync in roadmap step 3, publishing in step 2).
 */
export async function getConnection(clientId: string): Promise<IgConnection | null> {
    const { data } = await supabaseAdmin
        .from("ig_connections")
        .select("ig_user_id, ig_username, access_token, token_expires_at, status")
        .eq("client_id", clientId)
        .eq("provider", PROVIDER)
        .maybeSingle()
    if (!data) return null
    return {
        igUserId: data.ig_user_id,
        igUsername: data.ig_username,
        accessToken: decryptToken(data.access_token),
        tokenExpiresAt: data.token_expires_at,
        status: data.status,
    }
}

/** Upsert a tenant's connection (one per client). Encrypts the token before write. */
export async function saveConnection(
    clientId: string,
    conn: { igUserId: string; igUsername: string | null; accessToken: string; expiresAt: string | null },
): Promise<void> {
    const { error } = await supabaseAdmin
        .from("ig_connections")
        .upsert(
            {
                client_id: clientId,
                provider: PROVIDER,
                ig_user_id: conn.igUserId,
                ig_username: conn.igUsername,
                access_token: encryptToken(conn.accessToken),
                token_expires_at: conn.expiresAt,
                status: "connected",
                refreshed_at: new Date().toISOString(),
            },
            { onConflict: "client_id,provider" },
        )
    if (error) throw new Error(`Uložení IG připojení selhalo: ${error.message}`)
}

/** Mark a connection revoked (e.g. on data-deletion or when IG rejects the token). */
export async function markRevoked(clientId: string): Promise<void> {
    await supabaseAdmin
        .from("ig_connections")
        .update({ status: "revoked" })
        .eq("client_id", clientId)
        .eq("provider", PROVIDER)
}

/** Remove a tenant's connection entirely (user-initiated disconnect, data deletion). */
export async function disconnect(clientId: string): Promise<void> {
    const { error } = await supabaseAdmin.from("ig_connections").delete().eq("client_id", clientId).eq("provider", PROVIDER)
    if (error) throw new Error(`Odpojení Instagramu selhalo: ${error.message}`)
}

// ── Instagram OAuth token HTTP exchanges ────────────────────────────────────

/** POST code → short-lived token (1h) + ig user id. */
export async function exchangeCodeForShortLivedToken(
    code: string,
    redirectUri: string,
): Promise<{ accessToken: string; userId: string }> {
    const appId = requireEnv("META_APP_ID")
    const appSecret = requireEnv("META_APP_SECRET")
    const body = new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
    })
    const json = await withRetry(async () => {
        const res = await fetch(IG_OAUTH_TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
        })
        if (!res.ok) throw new Error(`IG token exchange ${res.status}: ${await res.text()}`)
        return res.json()
    }, 2, "ig-code-exchange")
    return { accessToken: json.access_token, userId: String(json.user_id) }
}

/** GET short-lived → long-lived token (~60 days). Returns token + expires_in seconds. */
export async function exchangeForLongLivedToken(
    shortLivedToken: string,
): Promise<{ accessToken: string; expiresIn: number }> {
    const appSecret = requireEnv("META_APP_SECRET")
    const url = `${IG_GRAPH_BASE}/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(appSecret)}&access_token=${encodeURIComponent(shortLivedToken)}`
    const json = await withRetry(async () => {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`IG long-lived exchange ${res.status}: ${await res.text()}`)
        return res.json()
    }, 2, "ig-longlived-exchange")
    return { accessToken: json.access_token, expiresIn: Number(json.expires_in || 0) }
}

/** GET the connected account's id + username, to display @handle and key Graph calls. */
export async function fetchIgProfile(
    accessToken: string,
): Promise<{ userId: string; username: string | null }> {
    const url = `${IG_GRAPH_BASE}/me?fields=user_id,username&access_token=${encodeURIComponent(accessToken)}`
    const json = await withRetry(async () => {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`IG profile fetch ${res.status}: ${await res.text()}`)
        return res.json()
    }, 2, "ig-profile")
    return { userId: String(json.user_id || json.id), username: json.username || null }
}

/**
 * Refresh a tenant's long-lived token (IG tokens don't auto-refresh; must be
 * renewed before the 60-day expiry). On failure marks the connection expired so
 * the UI prompts a reconnect and the manual metrics loop keeps running.
 */
export async function refreshConnection(clientId: string): Promise<{ refreshed: boolean }> {
    const conn = await getConnection(clientId)
    if (!conn) return { refreshed: false }
    try {
        const url = `${IG_GRAPH_BASE}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(conn.accessToken)}`
        const json = await withRetry(async () => {
            const res = await fetch(url)
            if (!res.ok) throw new Error(`IG token refresh ${res.status}: ${await res.text()}`)
            return res.json()
        }, 2, "ig-token-refresh")
        const expiresIn = Number(json.expires_in || 0)
        const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null
        await supabaseAdmin
            .from("ig_connections")
            .update({
                access_token: encryptToken(json.access_token),
                token_expires_at: expiresAt,
                refreshed_at: new Date().toISOString(),
                status: "connected",
            })
            .eq("client_id", clientId)
            .eq("provider", PROVIDER)
        return { refreshed: true }
    } catch (err) {
        console.warn(`ig-token-refresh: client ${clientId} failed:`, (err as Error).message)
        await supabaseAdmin.from("ig_connections").update({ status: "expired" }).eq("client_id", clientId).eq("provider", PROVIDER)
        return { refreshed: false }
    }
}

function requireEnv(key: string): string {
    const v = process.env[key]
    if (!v) throw new Error(`Chybí env proměnná ${key} — Instagram OAuth není nakonfigurován.`)
    return v
}
