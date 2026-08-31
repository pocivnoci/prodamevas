/**
 * upload-post connection lifecycle (server-only).
 * ===============================================
 * The bridge's account-linking half: create a profile per tenant, hand the tenant a
 * hosted page where THEY authorize their own Instagram, read back whether it took,
 * and tear the profile down on disconnect.
 *
 * Publishing and metrics live in ./uploadpost.ts; this file never touches content.
 *
 * ⚠️ Endpoint paths come from upload-post's published User Profiles API reference.
 * The response field names are read defensively — Fáze 0 confirms them.
 */

import { uploadPostGet, uploadPostJson } from "./uploadpost-client"

const USERS = "/api/uploadposts/users"

/**
 * The tenant's profile name at upload-post.
 *
 * Derived from the client UUID, never from the slug: a slug is user-facing and can
 * be renamed, and a renamed slug would orphan the remote profile — leaving a paid
 * connected account we can no longer address or delete.
 */
export function uploadPostProfileName(clientId: string): string {
    return `chrlit-${clientId}`
}

export interface UploadPostProfileStatus {
    exists: boolean
    /** The tenant's Instagram handle at upload-post, when connected. */
    instagramUsername: string | null
    connected: boolean
}

/** Pull the Instagram entry out of a profile payload, whatever it is keyed by. */
function readInstagram(profile: any): { connected: boolean; username: string | null } {
    const accounts = profile?.social_accounts ?? profile?.socialAccounts ?? {}
    const ig = accounts?.instagram
    if (!ig) return { connected: false, username: null }
    // The API reports an unconnected platform as null; a connected one as an object
    // (or, on some responses, just the handle string).
    if (typeof ig === "string") return { connected: true, username: ig }
    const username = ig?.username ?? ig?.handle ?? ig?.display_name ?? null
    return { connected: true, username: username ? String(username) : null }
}

/** Create the tenant's profile. Idempotent: an existing profile is not an error. */
export async function ensureProfile(clientId: string): Promise<string> {
    const username = uploadPostProfileName(clientId)
    try {
        await uploadPostJson(USERS, { username }, "create-profile")
    } catch (err: any) {
        // Re-creating an existing profile answers 400/409. That is the happy path on
        // every reconnect, so it must not surface as a failure to the tenant.
        const msg = String(err?.message || "")
        const alreadyExists = /\b(400|409)\b/.test(msg) || /exist/i.test(msg)
        if (!alreadyExists) throw err
    }
    return username
}

/**
 * A single-use URL where the tenant connects their own Instagram.
 *
 * upload-post signs a 48-hour JWT into it, so it is a CREDENTIAL: never log it,
 * never store it, hand it straight to the browser that asked for it.
 */
export async function generateConnectUrl(clientId: string): Promise<string> {
    const username = await ensureProfile(clientId)
    const json = await uploadPostJson(
        `${USERS}/generate-jwt`,
        {
            username,
            // Show the tenant only what we actually support today. Offering TikTok
            // here would let them connect an account nothing in Chrlit can publish to.
            platforms: ["instagram"],
        },
        "generate-jwt",
    )
    const url = json?.access_url ?? json?.accessUrl ?? json?.url
    if (!url) {
        throw new Error(`upload-post: generate-jwt nevrátil access_url: ${JSON.stringify(json).slice(0, 300)}`)
    }
    return String(url)
}

/** Current connection state at upload-post, for reconciling our own row. */
export async function getProfileStatus(clientId: string): Promise<UploadPostProfileStatus> {
    const username = uploadPostProfileName(clientId)
    try {
        const json = await uploadPostGet(`${USERS}/${encodeURIComponent(username)}`, "get-profile")
        const profile = json?.profile ?? json?.user ?? json
        const ig = readInstagram(profile)
        return { exists: true, instagramUsername: ig.username, connected: ig.connected }
    } catch (err: any) {
        // An unknown profile is a legitimate answer ("never connected"), not a fault.
        if (/\b404\b/.test(String(err?.message || ""))) {
            return { exists: false, instagramUsername: null, connected: false }
        }
        throw err
    }
}

/**
 * Delete the tenant's profile at upload-post.
 *
 * Called on disconnect. Skipping it would leave a profile that still counts against
 * the plan's profile quota — a slow, silent leak of money for tenants who left.
 */
export async function deleteProfile(clientId: string): Promise<void> {
    const username = uploadPostProfileName(clientId)
    try {
        await uploadPostJson(USERS, { username }, "delete-profile", "DELETE")
    } catch (err: any) {
        // Already gone is the desired end state.
        if (/\b404\b/.test(String(err?.message || ""))) return
        throw err
    }
}
