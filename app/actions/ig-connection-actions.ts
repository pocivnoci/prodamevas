"use server"

import { requireProjectAccess } from "@/lib/auth-guard"

/**
 * Server actions for the Settings "Připojit Instagram" card.
 *
 * Two ways a tenant can connect, both landing in the same `ig_connections` row:
 *  - transport `meta`       — our own Meta app, OAuth via the /api/ig-connect/* routes
 *  - transport `uploadpost` — the bridge; the tenant authorizes on upload-post's
 *                             hosted page, so there is no redirect back to us and we
 *                             reconcile by polling instead of by callback
 */

export interface ConnectionStatus {
    connected: boolean
    username: string | null
    expiresAt: string | null
    status: "connected" | "expired" | "revoked" | null
    /** Whether the offered transport is configured at all in this installation. */
    configured: boolean
    /** Which connect flow to offer. Comes from the live row if connected, else config. */
    transport: "meta" | "uploadpost"
}

/** Which flow this tenant should be OFFERED (config + env), ignoring any live row. */
async function offeredTransport(projectSlug: string): Promise<"meta" | "uploadpost"> {
    try {
        const { loadConfig } = await import("@/instagram/configs")
        const config = await loadConfig(projectSlug)
        // validateConfig already clamps this to a known value and applies the env
        // default, so anything else here would be a bug rather than a missing field.
        if (config?.publishTransport === "uploadpost") return "uploadpost"
        if (config?.publishTransport === "meta") return "meta"
    } catch {
        /* a tenant with an unreadable config still deserves a working Settings page */
    }
    return process.env.UPLOADPOST_DEFAULT_TRANSPORT === "uploadpost" ? "uploadpost" : "meta"
}

export async function getConnectionStatus(projectSlug: string): Promise<ConnectionStatus> {
    const { clientId } = await requireProjectAccess(projectSlug)
    const { getConnectionMeta } = await import("@/instagram/ig-connection")
    const meta = await getConnectionMeta(clientId)

    // An EXISTING connection reports its own transport — that is the truth about how
    // it publishes. Config only decides what to offer someone not yet connected.
    const transport = meta?.transport ?? (await offeredTransport(projectSlug))

    const { isUploadPostConfigured } = await import("@/lib/channels/uploadpost-client")
    const configured =
        transport === "uploadpost"
            ? isUploadPostConfigured()
            : Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET)

    if (!meta) {
        return { connected: false, username: null, expiresAt: null, status: null, configured, transport }
    }
    return {
        connected: meta.status === "connected",
        username: meta.igUsername,
        expiresAt: meta.tokenExpiresAt,
        status: meta.status,
        configured,
        transport,
    }
}

// Připojení mostu ZAČÍNÁ v routě /api/ig-connect/bridge, ne tady. Server action by
// musela adresu vrátit do JS, které by ji pak otevřelo — jenže než ji upload-post
// podepíše, je uživatelské gesto promlčené a popup blocker okno zahodí. Odkaz na
// routu je navigace, kterou zablokovat nejde.

/**
 * Reconcile our row with upload-post's view of the tenant's profile.
 *
 * There is no OAuth callback to hook: the authorization happens on upload-post's own
 * page, so the UI calls this when the tenant comes back (window focus, or the
 * "Ověřit připojení" button).
 */
export async function syncUploadPostConnection(
    projectSlug: string,
): Promise<{ success: boolean; connected: boolean; username?: string | null; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const { getProfileStatus, uploadPostProfileName } = await import("@/lib/channels/uploadpost-profiles")
        const { saveConnection, disconnect } = await import("@/instagram/ig-connection")

        const status = await getProfileStatus(clientId)

        if (!status.connected) {
            // Nothing connected on their side. Drop a stale row of OURS so the tenant
            // is not told they are connected when publishing would fail — but only a
            // bridge row: a Graph connection is none of this flow's business.
            const { getConnectionMeta } = await import("@/instagram/ig-connection")
            const existing = await getConnectionMeta(clientId)
            if (existing?.transport === "uploadpost") await disconnect(clientId)
            return { success: true, connected: false }
        }

        await saveConnection(clientId, {
            // upload-post reports Instagram's numeric user id under `username` and the
            // @name under `handle` — the opposite of what the field names suggest.
            igUserId: status.instagramUserId || uploadPostProfileName(clientId),
            igUsername: status.instagramUsername,
            // The per-tenant credential IS the profile name — the API key is global.
            accessToken: uploadPostProfileName(clientId),
            // Bridge connections do not expire, so the refresh cron must never touch
            // them (instagram/ig-connection.ts guards on transport as well).
            expiresAt: null,
            transport: "uploadpost",
            // Linked but needing re-authorization is NOT connected: publishing would
            // fail and the tenant would only find out from a dead post.
            status: status.reauthRequired ? "expired" : "connected",
            metadata: {
                profileUsername: uploadPostProfileName(clientId),
                igUsername: status.instagramUsername,
                igUserId: status.instagramUserId,
            },
        })
        return { success: true, connected: !status.reauthRequired, username: status.instagramUsername }
    } catch (err) {
        return { success: false, connected: false, error: (err as Error).message }
    }
}

export async function disconnectInstagram(projectSlug: string): Promise<{ success: boolean; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const { disconnect, getConnectionMeta } = await import("@/instagram/ig-connection")

        // Tear down the remote profile too. Leaving it would keep consuming a paid
        // profile slot for a tenant who has left — a silent, recurring cost.
        const meta = await getConnectionMeta(clientId)
        if (meta?.transport === "uploadpost") {
            const { deleteProfile } = await import("@/lib/channels/uploadpost-profiles")
            try {
                await deleteProfile(clientId)
            } catch (err) {
                // Never block the tenant's disconnect on the provider being down; the
                // local row must go regardless, and a monthly reconcile catches leftovers.
                console.warn("upload-post: smazání profilu selhalo:", (err as Error).message)
            }
        }

        await disconnect(clientId)
        return { success: true }
    } catch (err) {
        return { success: false, error: (err as Error).message }
    }
}
