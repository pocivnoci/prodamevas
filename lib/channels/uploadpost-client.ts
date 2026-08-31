/**
 * Shared HTTP client for upload-post.com (server-only).
 *
 * Split from the adapter because two different concerns talk to this API:
 *   - lib/channels/uploadpost.ts   — publishing + metrics (the ChannelAdapter)
 *   - lib/channels/uploadpost-profiles.ts — connection lifecycle (profiles, JWT)
 *
 * The base URL and the API key live HERE and nowhere else, so there is exactly one
 * place to audit for a leaked credential and one place to change if the host moves.
 */

import { withRetry } from "@/utils/retry"
import { ChannelPermanentError } from "./types"

export const UPLOADPOST_BASE = "https://api.upload-post.com"

/** True when this installation is configured to use the bridge at all. */
export function isUploadPostConfigured(): boolean {
    return Boolean(process.env.UPLOADPOST_API_KEY)
}

function apiKey(): string {
    const key = process.env.UPLOADPOST_API_KEY
    if (!key) {
        // Not transient: without a key this transport can never work, and retrying
        // every minute would bury the real cause under a generic network error.
        throw new ChannelPermanentError(
            "UPLOADPOST_API_KEY není nastavený — transport 'uploadpost' není v této instalaci nakonfigurovaný.",
        )
    }
    return key
}

/**
 * HTTP statuses where trying again later cannot help.
 *
 * 429 and 5xx are deliberately absent: those are exactly what backoff is for, and
 * upload-post rate-limits live analytics at 100 requests / 5 minutes.
 */
function isPermanentStatus(status: number): boolean {
    return status === 400 || status === 401 || status === 403 || status === 404 || status === 422
}

async function call(path: string, init: RequestInit & { label: string }): Promise<any> {
    const { label, ...rest } = init
    const auth = `Apikey ${apiKey()}` // resolved once, outside the retry loop

    return withRetry(async () => {
        const res = await fetch(`${UPLOADPOST_BASE}${path}`, {
            ...rest,
            headers: { Authorization: auth, ...(rest.headers || {}) },
        })
        if (!res.ok) {
            const body = await res.text()
            // withRetry only retries messages matching its transient vocabulary
            // ("rate limit", "network", 503…), so a 4xx is rethrown at once and the
            // marker below reaches uploadPostCall intact.
            const err: any = new Error(`upload-post ${label} ${res.status}: ${body.slice(0, 300)}`)
            err.permanent = isPermanentStatus(res.status)
            throw err
        }
        // Some endpoints (DELETE) answer with an empty body.
        const text = await res.text()
        return text ? JSON.parse(text) : {}
    }, 2, `uploadpost-${label}`)
}

/** Run a call, converting a marked-permanent failure into ChannelPermanentError so
 *  the publisher fails the post fast instead of burning its retry budget. */
export async function uploadPostCall(path: string, init: RequestInit & { label: string }): Promise<any> {
    try {
        return await call(path, init)
    } catch (err: any) {
        if (err?.permanent) throw new ChannelPermanentError(err.message)
        throw err
    }
}

export function uploadPostGet(path: string, label: string) {
    return uploadPostCall(path, { label, method: "GET" })
}

export function uploadPostJson(path: string, body: unknown, label: string, method: "POST" | "DELETE" = "POST") {
    return uploadPostCall(path, {
        label,
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    })
}

/**
 * POST multipart/form-data.
 *
 * The publish endpoints take form data, NOT JSON — a JSON body is rejected with
 * "Username required in form data" even when the field is present. Note there is
 * no explicit Content-Type header: fetch must set it itself so the multipart
 * boundary matches the body.
 */
export function uploadPostForm(path: string, form: FormData, label: string) {
    return uploadPostCall(path, { label, method: "POST", body: form })
}
