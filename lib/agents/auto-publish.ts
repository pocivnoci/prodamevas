/**
 * Auto-publish arming agent — the last mile of the content flywheel.
 * ==================================================================
 * The pipeline generates posts to status `ready` WITH a proposed `scheduled_for`
 * (the cadence is applied once, at generation, by distributeSchedule). Nothing
 * publishes until someone moves ready→scheduled. For a client opted into hands-free
 * publishing (`config.autoPublish`) AND connected, this agent does that confirming
 * step automatically — it is the machine equivalent of the "Potvrdit plán" button.
 *
 * It CONFIRMS the plan; it does not make one. The dates come from the generator and
 * are never recomputed here. Until 2026-08-31 this agent ordered by `created_at` and
 * recomputed every date with distributeSchedule, which silently overwrote what the
 * calendar showed — two schedulers that disagreed. One scheduler now: the generator.
 *
 * Safety by construction:
 *  - opt-in: does nothing unless `config.autoPublish === true`
 *  - connection-guarded: no live ig_connection → no-op (the publisher would only
 *    fail the post anyway)
 *  - bounded buffer: only tops up to ~2 weeks ahead, so a 149-post backlog can't
 *    flood the account — it drains at cadence and the founder can veto any
 *    still-future scheduled post in the dashboard before it goes out
 *  - reels excluded: auto-publish has no video path (they use the manual handoff)
 *  - overdue posts are left alone: shifting them silently would publish content
 *    outside the moment it was written for. They stay visible for a human.
 */

import supabaseAdmin from "@/supabase/admin"
import { MAX_POSTS_PER_WEEK } from "@/lib/schedule-planner"

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

    // Ready posts s NAVRŽENÝM termínem, seřazené podle toho termínu.
    //
    // Dřív tenhle agent bral nejstarší podle `created_at` a termíny si POČÍTAL SÁM
    // přes distributeSchedule — čímž přepsal to, co generátor naplánoval a co člověk
    // viděl v kalendáři. Byly to dva plánovače, které se neshodly: co jsi viděl,
    // nebylo co vyšlo, ani v jakém pořadí. Agent teď plán jen POTVRZUJE.
    //
    // Horní mez okna = konec dopředného zásobníku; co je naplánované dál, počká na
    // některý z dalších běhů.
    //
    // POZOR: `.neq()` je v SQL `<>`, a `NULL <> 'reel'` je NULL — řádek vypadne.
    // media_type přišlo migrací 20260622 bez backfillu, takže bez null větve by se
    // vynechal každý příspěvek vzniklý dřív.
    const nowMs = Date.now()
    const windowEnd = new Date(nowMs + FORWARD_BUFFER_WEEKS * 7 * DAY_MS).toISOString()

    const { data: ready, error: rErr } = await supabaseAdmin
        .from("ig_posts")
        .select("id, scheduled_for, time_slot")
        .eq("client_id", clientId)
        .eq("status", "ready")
        .not("image_url", "is", null)
        .not("scheduled_for", "is", null)
        // Propadlé termíny agent NEOSTŘÍ. Posunout je potichu dopředu by znamenalo
        // vydat obsah mimo okamžik, pro který byl napsaný. Zůstanou v kalendáři
        // viditelně propadlé a člověk je posune nebo potvrdí sám.
        .gt("scheduled_for", new Date(nowMs).toISOString())
        .lte("scheduled_for", windowEnd)
        .or("media_type.is.null,and(media_type.neq.reel,media_type.neq.story)")
        .order("scheduled_for", { ascending: true })
        .limit(need)
    if (rErr) throw new Error(`auto-publish ready read (${slug}): ${rErr.message}`)
    if (!ready || ready.length === 0) return { clientId, slug, armed: 0, queued: queuedCount }

    let armed = 0
    for (const post of ready) {
        // Conditional flip: only arm if the post is still `ready` (a concurrent
        // manual schedule/delete can't be clobbered). `scheduled_for` se NEMĚNÍ.
        const { data, error } = await supabaseAdmin
            .from("ig_posts")
            .update({
                status: "scheduled",
                publish_error: null,
                publish_attempts: 0,
                updated_at: new Date().toISOString(),
            })
            .eq("id", post.id)
            .eq("status", "ready")
            .select("id")
            .maybeSingle()
        if (!error && data) armed++
    }

    // ── Příspěvky BEZ navrženého termínu ────────────────────────────────────
    //
    // Termín razítkuje jen kampaňový worker. Jednotlivé generování, varianty ani
    // produktové řady ho nenastavují, takže většina `ready` postů žádný plán nemá.
    // Kdyby je agent ignoroval, auto-publikování by u nich potichu přestalo fungovat
    // — což se stalo, když tenhle agent poprvé začal vyžadovat `scheduled_for`.
    //
    // Přesná hranice tedy není „agent nesmí počítat termíny", ale:
    // AGENT SMÍ TERMÍN DOPLNIT TOMU, KDO ŽÁDNÝ NEMÁ, A NIKDY NESMÍ PŘEPSAT EXISTUJÍCÍ.
    // Vynucuje to podmínka `.is("scheduled_for", null)` na updatu níž — ne komentář.
    const stillNeeded = need - armed
    if (stillNeeded <= 0) return { clientId, slug, armed, queued: queuedCount + armed }

    const { data: undated } = await supabaseAdmin
        .from("ig_posts")
        .select("id")
        .eq("client_id", clientId)
        .eq("status", "ready")
        .not("image_url", "is", null)
        .is("scheduled_for", null)
        .or("media_type.is.null,and(media_type.neq.reel,media_type.neq.story)")
        .order("created_at", { ascending: true })
        .limit(stillNeeded)
    if (!undated || undated.length === 0) return { clientId, slug, armed, queued: queuedCount + armed }

    const { distributeSchedule, toScheduledFor } = await import("@/lib/schedule-planner")
    // Navazujeme za poslední už naostřený slot, ať se fronta nekříží sama se sebou.
    const lastQueued = queued && queued.length > 0 ? new Date(queued[0].scheduled_for) : null
    const startDate = lastQueued ? new Date(lastQueued.getTime() + DAY_MS) : undefined
    const times = Array.isArray(config.postingTimes) && (config.postingTimes as string[]).length > 0
        ? (config.postingTimes as string[]) : undefined
    const slots = distributeSchedule(undated.length, { postsPerWeek: perWeek, startDate, timeSlots: times })

    for (let i = 0; i < undated.length; i++) {
        const slot = slots[i]
        if (!slot) break
        const { data } = await supabaseAdmin
            .from("ig_posts")
            .update({
                status: "scheduled",
                scheduled_for: toScheduledFor(slot.date, slot.time),
                time_slot: slot.time,
                publish_error: null,
                publish_attempts: 0,
                updated_at: new Date().toISOString(),
            })
            .eq("id", undated[i].id)
            .eq("status", "ready")
            // Tvrdá pojistka proti přepsání plánu: kdyby mezitím termín někdo
            // nastavil, tenhle update neprojde a post zůstane jeho.
            .is("scheduled_for", null)
            .select("id")
            .maybeSingle()
        if (data) armed++
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

    // Rotované pořadí + časový rozpočet — viz lib/agents/client-sweep.ts.
    const { sweepClients } = await import("./client-sweep")
    const { results } = await sweepClients(
        (clients || []) as { id: string; slug: string; config: unknown }[],
        c => armClient(c.id, c.slug, (c.config || {}) as Record<string, unknown>),
        (c, err) => ({ clientId: c.id, slug: c.slug, armed: 0, queued: 0, skipped: err.message?.slice(0, 200) }),
    )
    return results
}
