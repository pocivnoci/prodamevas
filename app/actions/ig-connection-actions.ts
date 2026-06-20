"use server"

import { requireProjectAccess } from "@/lib/auth-guard"

/**
 * Server actions for the Settings "Připojit Instagram" card. The OAuth flow
 * itself runs through the /api/ig-connect/* routes (browser redirect); these
 * just read connection status and let a tenant disconnect.
 */

export interface ConnectionStatus {
    connected: boolean
    username: string | null
    expiresAt: string | null
    status: "connected" | "expired" | "revoked" | null
    configured: boolean // whether IG OAuth env is set up at all
}

export async function getConnectionStatus(projectSlug: string): Promise<ConnectionStatus> {
    const { clientId } = await requireProjectAccess(projectSlug)
    const configured = Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET)
    const { getConnectionMeta } = await import("@/instagram/ig-connection")
    const meta = await getConnectionMeta(clientId)
    if (!meta) {
        return { connected: false, username: null, expiresAt: null, status: null, configured }
    }
    return {
        connected: meta.status === "connected",
        username: meta.igUsername,
        expiresAt: meta.tokenExpiresAt,
        status: meta.status,
        configured,
    }
}

export async function disconnectInstagram(projectSlug: string): Promise<{ success: boolean; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const { disconnect } = await import("@/instagram/ig-connection")
        await disconnect(clientId)
        return { success: true }
    } catch (err) {
        return { success: false, error: (err as Error).message }
    }
}
