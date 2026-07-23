/**
 * Auto-publish arming agent — the last mile of the content flywheel.
 * ==================================================================
 * The pipeline generates posts to status `ready` (generated, NOT armed — nothing
 * publishes without a human moving ready→scheduled). For a client that has opted
 * into hands-free publishing (`config.autoPublish`) AND connected Instagram, this
 * agent arms `ready` posts onto the brand's `postsPerWeek` cadence, keeping a
 * bounded forward buffer so the account posts by itself.
 *
 * Safety by construction:
 *  - opt-in: does nothing unless `config.autoPublish === true`
 *  - connection-guarded: no live ig_connection → no-op (the publisher would only
 *    fail the post anyway)
 *  - bounded buffer: only tops up to ~2 weeks ahead, so a 149-post backlog can't
 *    flood the account — it drains at cadence and the founder can veto any
 *    still-future scheduled post in the dashboard before it goes out
 *  - reels excluded: auto-publish has no video path (they use the manual handoff)
 *  - FIFO: oldest `ready` first, so nothing is stranded forever
 */

import supabaseAdmin from "@/supabase/admin"
import { distributeSchedule, toScheduledFor, MAX_POSTS_PER_WEEK } from "@/lib/schedule-planner"

const DAY_MS = 24 * 60 * 60 * 1000
const FORWARD_BUFFER_WEEKS = 2 // keep ~2 weeks of posts armed ahead

export interface ArmResult {
    clientId: string
    slug: string
    armed: number
    queued: number // forward-scheduled posts after this run
    skipped?: string
}

/** Arm one client's ready posts if it's opted in and connected. */
async function armClient(clientId: string, slug: string, config: Record<string, unknown>): Promise<ArmResult> {
    const { getConnectionMeta } = await import("@/instagram/ig-connection")
    const conn = await getConnectionMeta(clientId)
    if (!conn || conn.status !== "connected") {
        return { clientId, slug, armed: 0, queued: 0, skipped: "no live Instagram connection" }
    }

    const perWeek = Math.min(MAX_POSTS_PER_WEEK, Math.max(1, Math.round(Number(config.postsPerWeek) || 4)))
    const target = perWeek * FORWARD_BUFFER_WEEKS
    const nowIso = new Date().toISOString()

    // Posts already armed for the future = the current buffer. Newest first so
    // [0] is the last slot we'd append after.
    const { data: queued, error: qErr } = await supabaseAdmin
        .from("ig_posts")
        .select("scheduled_for")
        .eq("client_id", clientId)
        .eq("status", "scheduled")
        .gt("scheduled_for", nowIso)
        .order("scheduled_for", { ascending: false })
    if (qErr) throw new Error(`auto-publish queue read (${slug}): ${qErr.message}`)

    const queuedCount = queued?.length || 0
    if (queuedCount >= target) return { clientId, slug, armed: 0, queued: queuedCount }

    const need = target - queuedCount

    // Oldest ready posts with real media, excluding reels (no auto-publish path).
    const { data: ready, error: rErr } = await supabaseAdmin
        .from("ig_posts")
        .select("id, media_type")
        .eq("client_id", clientId)
        .eq("status", "ready")
        .not("image_url", "is", null)
        .neq("media_type", "reel")
        .order("created_at", { ascending: true })
        .limit(need)
    if (rErr) throw new Error(`auto-publish ready read (${slug}): ${rErr.message}`)
    if (!ready || ready.length === 0) return { clientId, slug, armed: 0, queued: queuedCount }

    // Append to the queue: start the day after the last armed slot (distributeSchedule
    // clamps to ≥ tomorrow, so an empty queue starts tomorrow).
    const lastQueued = queued && queued.length > 0 ? new Date(queued[0].scheduled_for) : null
    const startDate = lastQueued ? new Date(lastQueued.getTime() + DAY_MS) : undefined
    // Per-client posting times (Prague local); empty → engine defaults.
    const times = Array.isArray(config.postingTimes) && (config.postingTimes as string[]).length > 0
        ? (config.postingTimes as string[]) : undefined
    const slots = distributeSchedule(ready.length, { postsPerWeek: perWeek, startDate, timeSlots: times })

    let armed = 0
    for (let i = 0; i < ready.length; i++) {
        const slot = slots[i]
        // Conditional flip: only arm if the post is still `ready` (a concurrent
        // manual schedule/delete can't be clobbered).
        const { data, error } = await supabaseAdmin
            .from("ig_posts")
            .update({
                status: "scheduled",
                scheduled_for: toScheduledFor(slot.date, slot.time),
                time_slot: slot.time,
                publish_error: null,
                publish_attempts: 0,
                updated_at: new Date().toISOString(),
            })
            .eq("id", ready[i].id)
            .eq("status", "ready")
            .select("id")
            .maybeSingle()
        if (!error && data) armed++
    }

    return { clientId, slug, armed, queued: queuedCount + armed }
}

/**
 * Arm ready posts for every opted-in, connected client. Isolated per client so
 * one broken tenant never blocks the rest. Called by the daily-ops cron via the
 * `auto_publish_arm` handler.
 */
export async function armReadyPosts(): Promise<ArmResult[]> {
    const { data: clients, error } = await supabaseAdmin
        .from("clients")
        .select("id, slug, config")
        .eq("is_active", true)
        .eq("config->>autoPublish", "true")
    if (error) throw new Error(`auto-publish client scan: ${error.message}`)

    const results: ArmResult[] = []
    for (const c of clients || []) {
        try {
            results.push(await armClient(c.id, c.slug, (c.config || {}) as Record<string, unknown>))
        } catch (err) {
            results.push({ clientId: c.id, slug: c.slug, armed: 0, queued: 0, skipped: (err as Error)?.message?.slice(0, 200) })
        }
    }
    return results
}
