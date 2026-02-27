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
