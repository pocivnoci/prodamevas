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
 * "Ověřit připojení" button). Samo pravidlo žije v `reconcileBridgeConnection` —
 * tentýž kód spouští hromadná oprava a jeho čtecí polovinu denní health check.
 */
export async function syncUploadPostConnection(
    projectSlug: string,
): Promise<{ success: boolean; connected: boolean; username?: string | null; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const { reconcileBridgeConnection } = await import("@/lib/channels/uploadpost-reconcile")
        const res = await reconcileBridgeConnection(clientId)
        return { success: true, connected: res.connected, username: res.username }
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
