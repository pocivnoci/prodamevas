/**
 * Idea-bank auto-replenishment agent — the bank never silently runs dry.
 * ======================================================================
 * The idea bank (ig_post_ideas) is seeded once at onboarding and then only grows
 * when a plan deposits invented topics back (startCampaign) or the user clicks AI
 * generation in the Nápady tab. At a 2×/day cadence the available pool (active,
 * off-cooldown) drains faster than it refills — weighted selection then recycles
 * the same few ideas every cooldown cycle (repetitive feed) or the plan draws
 * from an empty bank. Nobody is told. This agent tops each client's bank up to a
 * cadence-derived runway before that happens, so fresh in-season ideas are
 * already waiting when the next plan runs.
 *
 * Safety by construction:
 *  - free: no creditGuard — system maintenance like seedIdeaBank, never charged
 *    (a background action a user didn't click must never move their balance)
 *  - bounded: at most MAX_BATCHES_PER_RUN batches × MAX_BATCH ideas per client
 *    per daily run, and only up to the runway target — token cost is capped by
 *    construction, a prompt gone weird can't flood the bank
 *  - threshold-gated: a full bank no-ops; clients with no generated post in
 *    ACTIVITY_WINDOW_DAYS are skipped entirely (churned tenants burn no tokens)
 *  - opt-out: config.autoReplenishIdeas === false disables per client
 *  - isolated per client: one broken tenant never blocks the rest
 *  - inert output: new ideas just sit in the bank (visible + deactivatable in
 *    the Nápady tab) until a plan picks them — nothing publishes, nothing is
 *    charged downstream
 */

import supabaseAdmin from "@/supabase/admin"
import { MAX_POSTS_PER_WEEK } from "@/lib/schedule-planner"

const DAY_MS = 24 * 60 * 60 * 1000

/** How many weeks of the client's cadence the available pool should cover. */
export const RUNWAY_WEEKS = 2
/** Floor for the runway target — even a 1×/week client keeps a varied pool. */
export const MIN_TARGET = 10
/** Skip refills smaller than this — daily 1–2 idea dribbles aren't worth a run. */
export const MIN_REFILL = 4
/** Per-pillar generation batch cap (one generateAIIdeas call). */
export const MAX_BATCH = 8
/** Max generation batches per client per daily run. */
export const MAX_BATCHES_PER_RUN = 2
/** Clients with no generated post in this window are skipped as dormant. */
export const ACTIVITY_WINDOW_DAYS = 60

export interface PillarState {
    id: string
    ratio: number
    available: number
}

export interface ReplenishBatch {
    pillarId: string
    count: number
}

export interface ReplenishPlan {
    target: number
    available: number
    need: number
    batches: ReplenishBatch[]
}

/**
 * Pure planning math (tested by scripts/test-idea-replenish.ts).
 * Target = cadence-derived runway; refill goes to the most starved pillars —
 * starvation measured against each pillar's ratio-fair share of the target, so
 * a 50%-ratio pillar with 2 ideas is hungrier than a 10% pillar with 2.
 * `extraAvailable` = available ideas outside the current pillars (retired
 * pillar ids): they still count toward the runway (getWeightedIdeas serves
 * them), but generation can only target pillars that exist in the config.
 */
export function computeReplenishPlan(perWeek: number, pillars: PillarState[], extraAvailable = 0): ReplenishPlan {
    const cadence = Math.min(MAX_POSTS_PER_WEEK, Math.max(1, Math.round(perWeek || 4)))
    const target = Math.max(MIN_TARGET, cadence * RUNWAY_WEEKS)
    const available = pillars.reduce((s, p) => s + p.available, 0) + extraAvailable
    const need = target - available

    if (need < MIN_REFILL || pillars.length === 0) {
        return { target, available, need: Math.max(0, need), batches: [] }
    }

    const totalRatio = pillars.reduce((s, p) => s + (p.ratio || 0), 0)
    const starved = pillars
        .map(p => ({
            id: p.id,
            // Fair share of the target by pillar ratio; equal shares if ratios are unset.
            deficit: (totalRatio > 0 ? (target * (p.ratio || 0)) / totalRatio : target / pillars.length) - p.available,
        }))
        .sort((a, b) => b.deficit - a.deficit)

    const batches: ReplenishBatch[] = []
    let remaining = need
    for (const p of starved.slice(0, MAX_BATCHES_PER_RUN)) {
        if (remaining <= 0) break
        const count = Math.min(MAX_BATCH, remaining)
        batches.push({ pillarId: p.id, count })
        remaining -= count
    }
    return { target, available, need, batches }
}

export interface ReplenishResult {
    clientId: string
    slug: string
    added: number
    available: number
    target: number
    skipped?: string
}

/** Same off-cooldown rule as getWeightedIdeas — an idea on cooldown is not available. */
function offCooldown(idea: { last_used_at: string | null; cooldown_days: number | null }, now: number): boolean {
    if (!idea.last_used_at) return true
    const cooldownDays = idea.cooldown_days ?? 90
    return now - new Date(idea.last_used_at).getTime() > cooldownDays * DAY_MS
}

/** Replenish one client's bank if it's below the runway target. */
async function replenishClient(clientId: string, slug: string, raw: Record<string, unknown>): Promise<ReplenishResult> {
    if (raw.autoReplenishIdeas === false) {
        return { clientId, slug, added: 0, available: 0, target: 0, skipped: "opt-out (autoReplenishIdeas)" }
    }

    // Dormant tenant → no token spend. Any generated post in the window counts.
    const activitySince = new Date(Date.now() - ACTIVITY_WINDOW_DAYS * DAY_MS).toISOString()
    const { count: recentPosts, error: aErr } = await supabaseAdmin
        .from("ig_posts")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId)
        .gte("created_at", activitySince)
    if (aErr) throw new Error(`activity read (${slug}): ${aErr.message}`)
    if (!recentPosts) {
        return { clientId, slug, added: 0, available: 0, target: 0, skipped: `no post in ${ACTIVITY_WINDOW_DAYS} d` }
    }

    const { data: ideas, error: iErr } = await supabaseAdmin
        .from("ig_post_ideas")
        .select("category, last_used_at, cooldown_days")
        .eq("client_id", clientId)
        .eq("is_active", true)
    if (iErr) throw new Error(`bank read (${slug}): ${iErr.message}`)

    const now = Date.now()
    const availableByPillar = new Map<string, number>()
    for (const idea of ideas ?? []) {
        if (!offCooldown(idea, now)) continue
        availableByPillar.set(idea.category, (availableByPillar.get(idea.category) || 0) + 1)
    }

    const pillarDefs = (raw.contentPillars || {}) as Record<string, { ratio?: number }>
    const pillarIds = Object.keys(pillarDefs)
    if (pillarIds.length === 0) {
        return { clientId, slug, added: 0, available: 0, target: 0, skipped: "no content pillars in config" }
    }
    const orphanAvailable = [...availableByPillar.entries()]
        .filter(([id]) => !pillarDefs[id])
        .reduce((s, [, n]) => s + n, 0)
    const pillars: PillarState[] = pillarIds.map(id => ({
        id,
        ratio: pillarDefs[id]?.ratio || 0,
        available: availableByPillar.get(id) || 0,
    }))

    const perWeek = Number(raw.postsPerWeek) || 4
    const plan = computeReplenishPlan(perWeek, pillars, orphanAvailable)
    if (plan.batches.length === 0) {
        return { clientId, slug, added: 0, available: plan.available, target: plan.target }
    }

    const { loadConfig } = await import("@/instagram/configs")
    const { withActiveProject } = await import("@/instagram/service")
    const { generateAIIdeas } = await import("@/instagram/idea-generator")
    const config = await loadConfig(slug)

    let added = 0
    for (const batch of plan.batches) {
        // withActiveProject: getBrandMemories() inside the generator needs the
        // tenant scope (same as seedIdeaBank — there is no session in a cron).
        const rows = await withActiveProject(clientId, () => generateAIIdeas(config, batch.pillarId, batch.count))
        added += rows?.length || 0
    }

    console.log(`💡 idea-replenish: +${added} nápadů pro ${slug} (available ${plan.available}/${plan.target})`)
    return { clientId, slug, added, available: plan.available, target: plan.target }
}

/**
 * Top up the idea bank of every active, non-dormant client below its runway.
 * Isolated per client so one broken tenant never blocks the rest. Called by the
 * daily-ops cron via the `idea_replenish` handler.
 */
export async function replenishIdeaBanks(): Promise<ReplenishResult[]> {
    const { data: clients, error } = await supabaseAdmin
        .from("clients")
        .select("id, slug, config")
        .eq("is_active", true)
    if (error) throw new Error(`idea-replenish client scan: ${error.message}`)

    // Rotované pořadí + časový rozpočet — viz lib/agents/client-sweep.ts. Bez toho
    // by zabitý běh pokaždé odřízl tytéž klienty na konci seznamu.
    const { sweepClients } = await import("./client-sweep")
    const { results } = await sweepClients(
        (clients || []) as { id: string; slug: string; config: unknown }[],
        c => replenishClient(c.id, c.slug, (c.config || {}) as Record<string, unknown>),
        (c, err) => ({ clientId: c.id, slug: c.slug, added: 0, available: 0, target: 0, skipped: err.message?.slice(0, 200) }),
    )
    return results
}
