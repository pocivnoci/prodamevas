/**
 * Deduplication helpers for Instagram Autopilot
 * Detects similar hooks and body content to prevent repetitive posts.
 */

/** Extract normalized topic keywords from a caption */
export function extractTopicKeywords(text: string): Set<string> {
    return new Set(
        text.toLowerCase()
            .replace(/[^a-záčďéěíňóřšťúůýž\s]/g, "")
            .split(/\s+/)
            .filter(w => w.length > 4)
    )
}

/** Check if two hooks are too similar (word overlap > threshold) */
export function isHookSimilar(newHook: string, existingHook: string, threshold = 0.5): boolean {
    const a = newHook.toLowerCase().trim()
    const b = existingHook.toLowerCase().trim()
    if (a === b) return true

    const wordsA = new Set(a.split(/\s+/))
    const wordsB = b.split(/\s+/)
    const overlap = wordsB.filter(w => wordsA.has(w)).length
    return overlap / Math.max(wordsA.size, wordsB.length) > threshold
}

/** Check if body content overlaps too much with recent posts */
export function isBodySimilar(newBody: string, recentBodies: string[], threshold = 0.4): boolean {
    const newKeywords = extractTopicKeywords(newBody)
    if (newKeywords.size === 0) return false

    return recentBodies.some(existing => {
        const existingKeywords = extractTopicKeywords(existing)
        if (existingKeywords.size === 0) return false
        const overlap = [...newKeywords].filter(w => existingKeywords.has(w)).length
        return overlap / Math.max(newKeywords.size, existingKeywords.size) > threshold
    })
}
