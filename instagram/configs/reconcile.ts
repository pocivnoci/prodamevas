/**
 * Formats ↔ Pillars reconciliation
 * =================================
 * A single per-client format is denormalized across four config locations that
 * must stay in sync (the fifth, the `ig_post_types` DB row, is handled by the
 * server actions / ensurePostTypes, not here):
 *
 *   config.postTypeDefs[]              — the rich definition (SOURCE OF TRUTH)
 *   config.postTypes[]                 — flat active-slug list        (projection)
 *   config.postFormats{}               — render settings per slug     (projection)
 *   config.contentPillars[*].postTypes — pillar membership            (projection)
 *
 * `postTypeDefs[].pillar` records each format's intended pillar, so membership
 * and the render format are *derivable*. This function rebuilds the three
 * projections from the defs, which:
 *   - re-homes orphans (e.g. after a pillar is deleted, formats whose pillar key
 *     no longer exists are reassigned deterministically), and
 *   - drops dead pillar references (names no longer active).
 *
 * It is PURE (no DB, no AI), DETERMINISTIC, and IDEMPOTENT — running it twice
 * yields the same result — so it is safe on the hot config-load path.
 *
 * SEM NEPATŘÍ `brandVoice.hookTemplates[].bestFor` ani `brandVoice.toneByPostType`,
 * i když názvy formátů odkazují taky. Dva důvody:
 *   1. Nejsou to projekce `postTypeDefs` — jsou to AUTORSKÁ data, která se nedají
 *      zahodit a přegenerovat. Celý předpoklad téhle funkce na nich neplatí.
 *   2. Výstup se ukládá zpátky do `clients.config` (app/actions/config-actions.ts
 *      a čtyři skripty). Zahazování „mrtvých" názvů by tedy při prvním uložení
 *      Nastavení nevratně smazalo hook šablony všech klientů.
 * Normalizují se u konzumenta — `getHookTemplates` / `getToneDescription`
 * v instagram/caption-generator.ts.
 */

import type { ClientConfig, PostFormat, PostMedium, AspectRatio, OverlayStyle } from "./types"

/** Render-format default derived from a format's medium (matches upsertPostFormat). */
function defaultOverlayStyle(medium: PostMedium): OverlayStyle {
    // "none" is ONLY legal for reels — a static medium must never render text-free.
    // A story is the most typography-led format there is, so it takes "default".
    return medium === "carousel" ? "cover" : medium === "reel" ? "none" : "default"
}

/** Media rendered in a 9:16 frame. Mirrors VERTICAL_MEDIA in instagram/format-clamps.ts;
 *  that one enforces at render time, this one picks the default at config-load time. */
function defaultAspectRatio(medium: PostMedium): AspectRatio {
    return medium === "reel" || medium === "story" ? "9:16" : "4:5"
}

/** Ensure a postFormats entry exists for every active type without clobbering
 *  user-set entries (which may carry a hand-picked overlayStyle). */
function ensurePostFormats(
    config: ClientConfig,
    postTypes: string[],
    defByName: Map<string, any>,
): Record<string, PostFormat> {
    const out: Record<string, PostFormat> =
        config.postFormats && typeof config.postFormats === "object" ? { ...config.postFormats } : {}

    for (const name of postTypes) {
        if (out[name]) continue // never overwrite an existing render format
        const def = defByName.get(name)
        const medium: PostMedium = def?.medium || "image"
        const aspectRatio: AspectRatio = def?.aspectRatio || defaultAspectRatio(medium)
        out[name] = { aspectRatio, medium, overlayStyle: defaultOverlayStyle(medium) }
    }
    return out
}

/**
 * Reconcile a config's four format sources into a self-consistent projection.
 * Returns a new config; does not mutate the input.
 */
export function reconcileFormats(config: ClientConfig): ClientConfig {
    const contentPillars = config.contentPillars || {}
    const pillarKeys = Object.keys(contentPillars)
    const defs: any[] = Array.isArray(config.postTypeDefs) ? config.postTypeDefs : []
    const defByName = new Map<string, any>(defs.filter(d => d?.name).map(d => [d.name, d]))

    // 1) Active set — postTypes is authority, but every def name must be active
    //    (defs and postTypes entries are created together). Merge + dedupe, keep order.
    const seen = new Set<string>()
    const postTypes: string[] = []
    for (const n of [...(Array.isArray(config.postTypes) ? config.postTypes : []), ...defs.map(d => d?.name)]) {
        if (n && !seen.has(n)) { seen.add(n); postTypes.push(n) }
    }

    const postFormats = ensurePostFormats(config, postTypes, defByName)

    // No pillars to belong to (degenerate config) — leave membership untouched.
    if (pillarKeys.length === 0) {
        return { ...config, postTypes, postFormats }
    }

    // Current membership: name -> the pillar key that currently lists it (first wins).
    const currentPillarOf = new Map<string, string>()
    for (const key of pillarKeys) {
        const list = Array.isArray(contentPillars[key]?.postTypes) ? contentPillars[key].postTypes : []
        for (const n of list) if (!currentPillarOf.has(n)) currentPillarOf.set(n, key)
    }

    const firstPillar = pillarKeys[0]

    // 2) Intended pillar per active type (source of truth = def.pillar):
    //    def.pillar (if the key still exists) → current membership → first pillar.
    const intendedPillar = new Map<string, string>()
    for (const name of postTypes) {
        const defPillar = defByName.get(name)?.pillar
        const current = currentPillarOf.get(name)
        const target =
            (defPillar && contentPillars[defPillar]) ? defPillar :
            (current && contentPillars[current]) ? current :
            firstPillar
        intendedPillar.set(name, target)
    }

    // 3) Rebuild each pillar's postTypes as a pure projection (re-home + drop dead refs).
    const newPillars: Record<string, any> = {}
    for (const key of pillarKeys) {
        newPillars[key] = {
            ...contentPillars[key],
            postTypes: postTypes.filter(n => intendedPillar.get(n) === key),
        }
    }

    // Repair each def's own `pillar` to the resolved pillar so the source of truth
    // stays consistent (e.g. after a re-home the editor dropdown shows the live pillar,
    // not a deleted key).
    const newDefs = defs.map(d => {
        if (!d?.name) return d
        const target = intendedPillar.get(d.name)
        return target && target !== d.pillar ? { ...d, pillar: target } : d
    })

    return { ...config, postTypes, postFormats, postTypeDefs: newDefs, contentPillars: newPillars }
}
