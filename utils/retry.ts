/**
 * Shared Retry Utility
 * ====================
 * Single source of truth for retry logic across the entire app.
 * Handles transient errors (503, network timeouts, rate limiting).
 */

const RETRYABLE_ERRORS = [
    "503", "UNAVAILABLE", "overloaded", "high demand",
    "ECONNRESET", "ETIMEDOUT", "fetch failed",
    "socket hang up", "network", "rate limit",
]

// Transient = the model is fine but temporarily busy/unreachable → retrying the
// SAME model is the right move (this is when a Pro model is overloaded).
const TRANSIENT_ERRORS = [
    "503", "UNAVAILABLE", "overloaded", "high demand", "429",
    "rate limit", "quota", "RESOURCE_EXHAUSTED", "deadline",
    "ECONNRESET", "ETIMEDOUT", "fetch failed", "socket hang up", "network",
]

// Permanent for a given model = the model ID is gone/invalid → retrying it is
// pointless; surface it (a dead model is a config bug, not something to hide).
const PERMANENT_MODEL_ERRORS = ["404", "not found", "not_found", "no longer available", "invalid model", "permission"]

export function isTransientError(err: unknown): boolean {
    const msg = String((err as any)?.message || err).toLowerCase()
    return TRANSIENT_ERRORS.some(e => msg.includes(e.toLowerCase()))
}

export function isPermanentModelError(err: unknown): boolean {
    const msg = String((err as any)?.message || err).toLowerCase()
    return PERMANENT_MODEL_ERRORS.some(e => msg.includes(e.toLowerCase()))
}

/**
 * Thrown when EVERY model in a quality ladder is exhausted (overloaded/down) and
 * we refuse to silently ship lower-quality output. Carries a string marker so it
 * survives being re-wrapped in a generic Error deeper in the pipeline — detect
 * with isQualityUnavailable() rather than instanceof.
 */
export const QUALITY_UNAVAILABLE_MARKER = "QUALITY_UNAVAILABLE"
export class QualityUnavailableError extends Error {
    readonly isQualityUnavailable = true
    constructor(message: string) {
        super(`${QUALITY_UNAVAILABLE_MARKER}: ${message}`)
        this.name = "QualityUnavailableError"
    }
}

export function isQualityUnavailable(err: unknown): boolean {
    if ((err as any)?.isQualityUnavailable) return true
    return String((err as any)?.message || err).includes(QUALITY_UNAVAILABLE_MARKER)
}

/**
 * Retry a function HARD on transient errors with exponential backoff + jitter.
 * Unlike withRetry (short, generic), this is for quality-critical model calls
 * that must keep trying an overloaded Pro model for minutes before giving up.
 * Permanent model errors (404) are NOT retried — they're rethrown immediately.
 */
export async function withQualityRetry<T>(
    fn: () => Promise<T>,
    options: { maxRetries?: number; baseDelayMs?: number; maxDelayMs?: number; label?: string } = {},
): Promise<T> {
    const maxRetries = options.maxRetries
        ?? Number(process.env.QUALITY_LADDER_MAX_RETRIES || 6)
    const baseDelayMs = options.baseDelayMs ?? 4000
    const maxDelayMs = options.maxDelayMs ?? 60000
    const label = options.label || "quality-op"

    let lastError: unknown = null
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn()
        } catch (err: any) {
            lastError = err
            // Dead model ID — retrying won't help; let the ladder move to the next tier.
            if (isPermanentModelError(err)) throw err
            if (!isTransientError(err) || attempt >= maxRetries) throw err

            const expo = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
            const jitter = expo * (0.8 + Math.random() * 0.4) // ±20%
            const delay = Math.round(jitter)
            console.log(`⏳ ${label}: transient (${String(err?.message || err).substring(0, 70)}) — retry ${attempt + 1}/${maxRetries} in ${Math.round(delay / 1000)}s`)
            await new Promise(r => setTimeout(r, delay))
        }
    }
    throw lastError || new Error("withQualityRetry: unreachable")
}

/**
 * Retry a function on transient errors with exponential backoff.
 * @param fn - Async function to execute
 * @param maxRetries - Maximum retry attempts (default: 3)
 * @param label - Label for logging (default: "operation")
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
    label = "operation"
): Promise<T> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn()
        } catch (err: any) {
            lastError = err
            const msg = String(err?.message || err)
            const isRetryable = RETRYABLE_ERRORS.some(e =>
                msg.toLowerCase().includes(e.toLowerCase())
            )

            if (!isRetryable || attempt >= maxRetries) {
                throw err
            }

            const delay = (attempt + 1) * 3000
            console.log(`⏳ ${label}: retry ${attempt + 1}/${maxRetries} in ${delay / 1000}s (${msg.substring(0, 80)})...`)
            await new Promise(r => setTimeout(r, delay))
        }
    }

    throw lastError || new Error("withRetry: unreachable")
}
