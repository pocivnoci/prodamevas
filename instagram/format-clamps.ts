/**
 * Format safety clamps — the single place where "what the config asked for" is
 * reconciled with "what this tenant, this plan and this deploy actually allow".
 *
 * Extracted from autopilot.ts because it is applied TWICE per generation: once on
 * the freshly resolved format, and again after a caption checkpoint is restored.
 * A checkpoint freezes the format under the ORIGINAL attempt's rules, and a
 * deferral window can last hours — the live rules must win on resume, or a reel
 * parked before a kill-switch flip would sail through it.
 *
 * Two invariants the tests in scripts/test-story-format.ts pin down:
 *   PURE        — the input object is never mutated; a new PostFormat comes back.
 *   IDEMPOTENT  — clamp(clamp(f)) === clamp(f), which is what makes applying it
 *                 twice safe in the first place.
 */

import type { PostFormat, PostMedium, AspectRatio } from "./configs/types"
import { creditsForMedia } from "../lib/credits"

/**
 * Media rendered in a 9:16 frame, pinned there rather than clamped to the feed.
 *
 * This replaces the old `f.medium !== "reel"` predicate, which was written out
 * twice and had to agree with itself. Worse, it meant every FUTURE medium was
 * silently squashed to 4:5 — which is exactly what would have happened to a story.
 * Membership is now explicit and stated once.
 */
const VERTICAL_MEDIA: ReadonlySet<PostMedium> = new Set<PostMedium>(["reel", "story"])

/** Ratios Instagram renders in the feed without a hard crop. */
export const FEED_SAFE_RATIOS = ["1:1", "4:5", "3:4"] as const

export interface ClampOptions {
    /** Media the subscription plan includes. Undefined = legacy plan = everything. */
    allowedMedia?: string[]
    /** Medium the job was charged for. The engine must never deliver a pricier one. */
    chargedMedium?: PostMedium
    /** Global engine kill-switches (env), read live so a mid-deferral flip wins. */
    reelsEnabled: boolean
    storiesEnabled: boolean
    /** Optional sink for the clamp log; defaults to console.log. Tests pass a no-op. */
    log?: (message: string) => void
}

export function applyFormatClamps(input: PostFormat, opts: ClampOptions): PostFormat {
    const f: PostFormat = { ...input }
    const log = opts.log ?? ((m: string) => console.log(m))

    // 1) Plan media gating — config or pillar category may still ask for a medium the
    //    subscription doesn't include (e.g. a reel on the Start tier).
    if (opts.allowedMedia && !opts.allowedMedia.includes(f.medium)) {
        const original = f.medium
        f.medium = opts.allowedMedia.includes("carousel") ? "carousel" : "image"
        log(`   🔒 Médium "${original}" není v balíčku — fallback na ${f.medium}`)
    }

    // 2) Global kill-switches. A disabled medium falls back to the cheapest thing whose
    //    COPY the engine already has in hand: a story's frames[0] IS a legal single
    //    image, whereas a reel has only scenes and a cover — hence reel → carousel but
    //    story → image. Flip either back on with the env var; no redeploy needed.
    if (!opts.reelsEnabled && f.medium === "reel") {
        f.medium = "carousel"
        log("   🚫 Reels dočasně vypnuté (Veo off) — fallback na carousel")
    }
    if (!opts.storiesEnabled && f.medium === "story") {
        f.medium = "image"
        log("   🚫 Stories dočasně vypnuté — fallback na obrázek")
    }

    // 3) Billing cap — the delivered medium can never cost MORE than what the job was
    //    charged for (credits are charged at job creation). Ranked by the credit table
    //    itself, so a new medium is ranked the moment it is priced; the old MEDIUM_RANK
    //    map was a second ordering to keep in sync and would have placed a cheap 9:16
    //    story above carousel. Downward differences are refunded by reconcileJobCharge;
    //    upward ones are impossible by construction.
    if (opts.chargedMedium && creditsForMedia(f.medium) > creditsForMedia(opts.chargedMedium)) {
        const original = f.medium
        f.medium = opts.chargedMedium
        log(`   💳 Médium "${original}" překračuje účtovaný formát — clamp na ${f.medium}`)
    }

    // 4) Ratio ↔ medium legality. Stated ONCE, in both directions, and last — so it runs
    //    after every mutation above and there is no path around it. A 9:16 feed post gets
    //    cropped hard by Instagram; a 4:5 story/reel gets pillarboxed and looks amateur
    //    (today nothing stops that: the reel orchestrator hardcodes 9:16 internally, so
    //    format.aspectRatio can lie and the UI renders the wrong shape).
    if (VERTICAL_MEDIA.has(f.medium)) {
        if (f.aspectRatio !== "9:16") {
            log(`   📐 Poměr "${f.aspectRatio}" není 9:16 pro ${f.medium} — clamp na 9:16`)
            f.aspectRatio = "9:16"
        }
    } else if (!(FEED_SAFE_RATIOS as readonly string[]).includes(f.aspectRatio)) {
        const original = f.aspectRatio
        f.aspectRatio = "4:5"
        log(`   📐 Poměr "${original}" není feed-legální pro ${f.medium} — clamp na 4:5`)
    }

    // 5) overlayStyle "none" (text-free) is ONLY legal for reels — see CLAUDE.md. Any
    //    medium that arrived here by being clamped OUT of reel must not keep it, or a
    //    static post ships as a bare text-free photo.
    if (f.medium !== "reel" && f.overlayStyle === "none") {
        f.overlayStyle = f.medium === "carousel" ? "cover" : "default"
    }

    return f
}

/** Reads the live kill-switches. Kept next to the clamps so the two env var names
 *  can't drift apart from the logic that honours them. */
export function liveKillSwitches(): Pick<ClampOptions, "reelsEnabled" | "storiesEnabled"> {
    return {
        reelsEnabled: process.env.REELS_ENABLED === "1",
        storiesEnabled: process.env.STORIES_ENABLED === "1",
    }
}

/** Exported for tests — the ratio a medium is pinned to, if any. */
export function isVerticalMedium(medium: PostMedium): boolean {
    return VERTICAL_MEDIA.has(medium)
}

export type { AspectRatio }
