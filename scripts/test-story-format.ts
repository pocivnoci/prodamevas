/**
 * Format safety clamps — pure-function checks (no DB, no network).
 *   npx tsx scripts/test-story-format.ts
 *
 * These clamps decide what medium and what aspect ratio actually get rendered and
 * billed. They used to live as a closure inside a 900-line function and could not be
 * tested at all; the failure mode is silent (a story renders as a square, a carousel
 * ships at 9:16 and Instagram crops it) and only visible in the published post.
 *
 * The feed-safety guarantee — image/carousel can NEVER ship at 9:16 — predates
 * stories and is asserted here for the first time.
 */

import { applyFormatClamps, isVerticalMedium, FEED_SAFE_RATIOS, type ClampOptions } from "../instagram/format-clamps"
import type { PostFormat, PostMedium, AspectRatio, OverlayStyle } from "../instagram/configs/types"
import { MEDIA_CREDITS, ALL_MEDIA } from "../lib/credits"

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail?: string) {
    if (cond) { passed++; console.log(`  ✅ ${name}`) }
    else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`) }
}

function eq<T>(name: string, actual: T, expected: T) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    check(name, a === e, `expected ${e}, got ${a}`)
}

const fmt = (medium: PostMedium, aspectRatio: AspectRatio, overlayStyle: OverlayStyle = "default"): PostFormat =>
    ({ medium, aspectRatio, overlayStyle })

/** Everything on, nothing charged, no plan limits — the permissive baseline. */
const OPEN: ClampOptions = { reelsEnabled: true, storiesEnabled: true, log: () => { } }

const clamp = (f: PostFormat, o: Partial<ClampOptions> = {}) =>
    applyFormatClamps(f, { ...OPEN, ...o })

// ─── 1. The happy paths ──────────────────────────────────────────────────────
console.log("\n📐 Nedotčené formáty")

eq("story 9:16 projde beze změny", clamp(fmt("story", "9:16")), fmt("story", "9:16"))
eq("image 4:5 projde beze změny", clamp(fmt("image", "4:5")), fmt("image", "4:5"))
eq("carousel 1:1 projde beze změny", clamp(fmt("carousel", "1:1", "cover")), fmt("carousel", "1:1", "cover"))
eq("reel 9:16 si drží overlay none", clamp(fmt("reel", "9:16", "none")), fmt("reel", "9:16", "none"))

// ─── 2. Feed safety — the pre-existing guarantee ─────────────────────────────
console.log("\n🛡️ Feed-legální poměr (existující záruka)")

for (const medium of ["image", "carousel"] as const) {
    for (const bad of ["9:16", "16:9", "4:3"] as AspectRatio[]) {
        eq(`${medium} ${bad} → 4:5`, clamp(fmt(medium, bad)).aspectRatio, "4:5")
    }
    for (const ok of FEED_SAFE_RATIOS) {
        eq(`${medium} ${ok} zůstává`, clamp(fmt(medium, ok)).aspectRatio, ok)
    }
}

// ─── 3. Vertical pinning — new, and it fixes a latent reel bug ───────────────
console.log("\n📱 Vertikální média se pinují na 9:16")

eq("story 4:5 → 9:16", clamp(fmt("story", "4:5")).aspectRatio, "9:16")
eq("story 1:1 → 9:16", clamp(fmt("story", "1:1")).aspectRatio, "9:16")
// Latent bug before this refactor: nothing forced a reel to 9:16, the orchestrator
// just hardcoded it internally — so format.aspectRatio lied to the UI and to QA.
eq("reel 4:5 → 9:16 (dřív latentní chyba)", clamp(fmt("reel", "4:5")).aspectRatio, "9:16")
check("isVerticalMedium(story)", isVerticalMedium("story"))
check("isVerticalMedium(reel)", isVerticalMedium("reel"))
check("!isVerticalMedium(image)", !isVerticalMedium("image"))
check("!isVerticalMedium(carousel)", !isVerticalMedium("carousel"))

// ─── 4. Billing cap, ranked by the credit table ─────────────────────────────
console.log("\n💳 Účtovací strop (creditsForMedia, ne MEDIUM_RANK)")

check("ceník je monotónní: image < story < carousel < reel",
    MEDIA_CREDITS.image < MEDIA_CREDITS.story
    && MEDIA_CREDITS.story < MEDIA_CREDITS.carousel
    && MEDIA_CREDITS.carousel < MEDIA_CREDITS.reel)

eq("charged story + carousel (3>2) → story",
    clamp(fmt("carousel", "4:5", "cover"), { chargedMedium: "story" }).medium, "story")
eq("charged story + carousel → poměr se dorovná na 9:16",
    clamp(fmt("carousel", "4:5", "cover"), { chargedMedium: "story" }).aspectRatio, "9:16")
eq("charged story + image (1<2) → image, žádný upgrade",
    clamp(fmt("image", "4:5"), { chargedMedium: "story" }).medium, "image")
eq("charged image + story → image",
    clamp(fmt("story", "9:16"), { chargedMedium: "image" }).medium, "image")
eq("charged image + story → poměr zpět na 4:5",
    clamp(fmt("story", "9:16"), { chargedMedium: "image" }).aspectRatio, "4:5")
eq("charged carousel + reel (5>3) → carousel",
    clamp(fmt("reel", "9:16", "none"), { chargedMedium: "carousel" }).medium, "carousel")
eq("charged carousel + reel → overlay už není none",
    clamp(fmt("reel", "9:16", "none"), { chargedMedium: "carousel" }).overlayStyle, "cover")
eq("charged reel + story → story (levnější, beze změny)",
    clamp(fmt("story", "9:16"), { chargedMedium: "reel" }).medium, "story")

// ─── 5. Plan gating ─────────────────────────────────────────────────────────
console.log("\n🔒 Plan gating (allowed_media)")

eq("story mimo balíček → carousel",
    clamp(fmt("story", "9:16"), { allowedMedia: ["image", "carousel"] }).medium, "carousel")
eq("story mimo balíček → feed-legální poměr",
    clamp(fmt("story", "9:16"), { allowedMedia: ["image", "carousel"] }).aspectRatio, "4:5")
eq("story mimo balíček bez carouselu → image",
    clamp(fmt("story", "9:16"), { allowedMedia: ["image"] }).medium, "image")
eq("story v balíčku projde",
    clamp(fmt("story", "9:16"), { allowedMedia: ["image", "story"] }).medium, "story")
eq("chybějící allowedMedia = legacy plán = vše",
    clamp(fmt("story", "9:16"), { allowedMedia: undefined }).medium, "story")

// ─── 6. Kill-switches ───────────────────────────────────────────────────────
console.log("\n🚫 Kill-switche")

const storiesOff = clamp(fmt("story", "9:16"), { storiesEnabled: false })
eq("stories off → image", storiesOff.medium, "image")
eq("stories off → 4:5", storiesOff.aspectRatio, "4:5")
check("stories off → overlay není none", storiesOff.overlayStyle !== "none")

const reelsOff = clamp(fmt("reel", "9:16", "none"), { reelsEnabled: false })
eq("reels off → carousel", reelsOff.medium, "carousel")
eq("reels off → 4:5", reelsOff.aspectRatio, "4:5")
eq("reels off → overlay cover", reelsOff.overlayStyle, "cover")

eq("reels off se story zapnutou nechá story být",
    clamp(fmt("story", "9:16"), { reelsEnabled: false }).medium, "story")

// ─── 7. overlayStyle "none" is reel-only (CLAUDE.md hard rule) ───────────────
console.log("\n🎨 overlayStyle \"none\" jen pro reel")

for (const medium of ["image", "story", "carousel"] as const) {
    check(`${medium} nikdy neskončí s overlay none`,
        clamp(fmt(medium, isVerticalMedium(medium) ? "9:16" : "4:5", "none")).overlayStyle !== "none")
}
eq("reel si none udrží", clamp(fmt("reel", "9:16", "none")).overlayStyle, "none")

// ─── 8. Purity + idempotence — what makes running it twice safe ─────────────
console.log("\n♻️ Čistota a idempotence")

const cases: [PostFormat, Partial<ClampOptions>][] = []
for (const medium of ALL_MEDIA) {
    for (const ratio of ["1:1", "4:5", "3:4", "4:3", "9:16", "16:9"] as AspectRatio[]) {
        for (const overlay of ["default", "cover", "none"] as OverlayStyle[]) {
            cases.push([fmt(medium, ratio, overlay), {}])
            cases.push([fmt(medium, ratio, overlay), { chargedMedium: "story" }])
            cases.push([fmt(medium, ratio, overlay), { chargedMedium: "image" }])
            cases.push([fmt(medium, ratio, overlay), { allowedMedia: ["image", "carousel"] }])
            cases.push([fmt(medium, ratio, overlay), { reelsEnabled: false, storiesEnabled: false }])
        }
    }
}

let idempotentFailures = 0
let mutationFailures = 0
let invariantFailures = 0
for (const [f, opts] of cases) {
    const snapshot = JSON.stringify(f)
    const once = clamp(f, opts)
    if (JSON.stringify(f) !== snapshot) mutationFailures++
    const twice = clamp(once, opts)
    if (JSON.stringify(once) !== JSON.stringify(twice)) {
        idempotentFailures++
        if (idempotentFailures === 1) {
            console.log(`     ↳ první rozdíl: ${JSON.stringify(f)} → ${JSON.stringify(once)} → ${JSON.stringify(twice)}`)
        }
    }
    // The two invariants that must hold for EVERY output, whatever the route in.
    const feedLegal = isVerticalMedium(once.medium)
        ? once.aspectRatio === "9:16"
        : (FEED_SAFE_RATIOS as readonly string[]).includes(once.aspectRatio)
    const overlayLegal = once.medium === "reel" || once.overlayStyle !== "none"
    if (!feedLegal || !overlayLegal) {
        invariantFailures++
        if (invariantFailures === 1) {
            console.log(`     ↳ první porušení: ${JSON.stringify(f)} + ${JSON.stringify(opts)} → ${JSON.stringify(once)}`)
        }
    }
}
check(`vstup se nemutuje (${cases.length} případů)`, mutationFailures === 0, `${mutationFailures} mutací`)
check(`clamp(clamp(f)) === clamp(f) (${cases.length} případů)`, idempotentFailures === 0, `${idempotentFailures} rozdílů`)
check(`poměr i overlay jsou legální na každém výstupu (${cases.length} případů)`, invariantFailures === 0, `${invariantFailures} porušení`)

// ─── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
