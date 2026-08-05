/**
 * Fetching a stored image back into a Buffer.
 *
 * Every "edit the artwork we already shipped" path needs this: the finished
 * image lives in a public Supabase bucket, and the image model needs the bytes,
 * not the URL. Single definition on purpose — print (editPrintDesign) and
 * Instagram (editPost) must not drift on how a download failure is reported.
 */

/** Download a public bucket URL into a Buffer. Throws with the URL on a non-2xx. */
export async function fetchImageBuffer(url: string): Promise<Buffer> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Nepodařilo se stáhnout ${url} (${res.status})`)
    return Buffer.from(await res.arrayBuffer())
}

/** Supported Gemini image aspect ratios — the model renders these five and nothing else. */
const SUPPORTED_RATIOS: { label: string; value: number }[] = [
    { label: "1:1", value: 1 },
    { label: "4:5", value: 4 / 5 },
    { label: "9:16", value: 9 / 16 },
    { label: "16:9", value: 16 / 9 },
    { label: "3:2", value: 3 / 2 },
]

/**
 * Nearest supported aspect ratio for an actual pixel size.
 *
 * An edit must be re-rendered at the ratio the image already has — passing a
 * different one makes the model reframe the whole composition, which is exactly
 * the "it changed everything" failure this feature exists to remove. Derive it
 * from the real buffer, never from the post type's configured format (a story
 * clamped to a 4:5 feed format is a real case — see revisePost's coercion).
 */
export function nearestAspectRatio(width?: number, height?: number, fallback = "4:5"): string {
    if (!width || !height) return fallback
    const actual = width / height
    let best = SUPPORTED_RATIOS[0]
    let bestDelta = Infinity
    for (const r of SUPPORTED_RATIOS) {
        // Compare in log space so 16:9 and 9:16 are equidistant from 1:1
        const delta = Math.abs(Math.log(actual / r.value))
        if (delta < bestDelta) {
            bestDelta = delta
            best = r
        }
    }
    return best.label
}
