/**
 * Which catalog product is a piece of copy actually ABOUT?
 * ========================================================
 * The planner writes a hook that names a concrete product ("Náš termobox udrží
 * Brownie na čtyřech stupních"), but the product attached to that post used to be
 * picked by a completely independent rule — round-robin over the campaign's focus
 * products, or a least-recently-used cooldown pick in the engine. The two never met,
 * so a caption about the antinicotine programme got rendered with a children's
 * session's photo. This module is the missing join: read the copy, name the product.
 *
 * Primary signal is still the planner's own `productIndex` (it knows what it meant);
 * this is the net that catches everything written before that existed, plus revised
 * hooks and single-item regenerations.
 *
 * Czech makes a plain substring match useless — the catalog says "Kytice na míru",
 * the hook says "kytici na míru". So tokens are compared by a crude stem (drop the
 * final character of anything 5+ chars long), which absorbs the common declension
 * endings without pulling in a stemming dependency. Matching is deliberately strict:
 * EVERY content word of the product name must appear, so "Kytice na míru" cannot
 * swallow a hook about "Kytice pro radost".
 */

/** Czech/English glue words — present in half the catalog, meaningless as evidence. */
const STOPWORDS = new Set([
    "a", "i", "na", "pro", "do", "od", "se", "ze", "s", "k", "ke", "v", "ve", "u", "o", "po", "za",
    "the", "and", "of", "for", "with",
])

/** Product names that are one short generic word ("Set", "Mila") match anything —
 *  require at least one token this long before trusting a match. */
const STRONG_TOKEN_LEN = 5

/** Lowercase, strip diacritics, reduce everything else to single spaces. */
export function normalizeForMatch(text: string): string {
    return text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
}

function contentTokens(text: string): string[] {
    return normalizeForMatch(text)
        .split(" ")
        .filter(t => t.length >= 2 && !STOPWORDS.has(t))
}

/** "kytice"/"kytici" → "kytic"; short tokens stay whole (nothing to spare). */
const stem = (token: string): string => (token.length >= STRONG_TOKEN_LEN ? token.slice(0, -1) : token)

export interface MatchableProduct {
    id: string
    name: string
}

/**
 * The catalog product this copy names, or undefined when it names none.
 *
 * A product matches only when every content word of its name appears in the text
 * (stem-compared, order-free) and at least one of those words is long enough to be
 * evidence. When several products match, the most specific one wins — the product
 * whose matched words cover the most characters — so "Výběrová sada 12ks" beats a
 * bare "Sada" on a hook that mentions both.
 */
export function matchProductInText<T extends MatchableProduct>(
    products: T[],
    text: string,
): T | undefined {
    if (!text?.trim() || !products?.length) return undefined
    const haystack = new Set(contentTokens(text).map(stem))
    if (haystack.size === 0) return undefined

    let best: { product: T; weight: number } | undefined
    for (const product of products) {
        const tokens = contentTokens(product.name || "")
        if (tokens.length === 0) continue
        if (!tokens.some(t => t.length >= STRONG_TOKEN_LEN)) continue
        if (!tokens.every(t => haystack.has(stem(t)))) continue
        const weight = tokens.reduce((sum, t) => sum + t.length, 0)
        if (!best || weight > best.weight) best = { product, weight }
    }
    return best?.product
}
