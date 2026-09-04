"use server"

import supabaseAdmin from "@/supabase/admin"
import { requireProjectAccess, requireClientAccess } from "@/lib/auth-guard"

/**
 * Resolve a post's tenant and verify the caller may touch it. Throws on missing
 * post or no access. Returns the post's client_id.
 */
async function gatePostAccess(postId: string): Promise<string> {
    const { data, error } = await supabaseAdmin
        .from("ig_posts")
        .select("client_id")
        .eq("id", postId)
        .single()
    if (error || !data?.client_id) throw new Error("Příspěvek nenalezen.")
    await requireClientAccess(data.client_id)
    return data.client_id
}

// ─── Plan Week ──────────────────────────────────────────
// planWeekAction was removed (v7.6): it generated posts synchronously in-request
// with NO credit gating (billing leak) and died with the tab. CalendarTab's
// "Naplánovat týden" now opens the campaign flow (generateIntent plan/1w).

// ─── Get Week Posts ──────────────────────────────────────

export async function getWeekPosts(
    projectSlug: string,
    weekStartISO: string // "2026-05-19"
): Promise<{
    posts: {
        id: string
        caption: string
        image_url: string | null
        status: string
        scheduled_for: string | null
        time_slot: string | null
        created_at: string
        post_type?: { name: string; display_name: string; emoji: string }
    }[]
}> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        const startDate = new Date(weekStartISO)
        const endDate = new Date(startDate)
        endDate.setDate(endDate.getDate() + 6)

        const startStr = startDate.toISOString()
        const endStr = new Date(endDate.getTime() + 24 * 60 * 60 * 1000).toISOString() // end of day

        const { data, error } = await supabaseAdmin
            .from("ig_posts")
            .select(`
                id, caption, image_url, status, scheduled_for, time_slot, created_at,
                ig_post_types ( name, display_name, emoji )
            `)
            .eq("client_id", clientId)
            .not("scheduled_for", "is", null)
            .gte("scheduled_for", startStr)
            .lte("scheduled_for", endStr)
            .order("scheduled_for", { ascending: true })

        if (error) throw error

        return {
            posts: (data || []).map(p => ({
                ...p,
                post_type: p.ig_post_types as any,
            })),
        }
    } catch (err: any) {
        console.error("getWeekPosts error:", err?.message)
        return { posts: [] }
    }
}

// ─── Move Post to Different Day ──────────────────────────

export async function movePost(
    postId: string,
    newDate: string,    // "2026-05-22"
    newTime?: string    // "17:00"
): Promise<{ success: boolean }> {
    await gatePostAccess(postId)
    const { toScheduledFor } = await import("@/lib/schedule-planner")
    const update: Record<string, any> = {
        // Prague-local wall time → UTC instant (same helper as scheduling), so a
        // moved post fires at the intended local time, not +2h.
        scheduled_for: toScheduledFor(newDate, newTime || "12:00"),
        // Přesun je nový pokus v novém čase — stará chyba a spotřebované pokusy
        // by jinak visely na příspěvku a publisher by ho po jednom selhání vzdal.
        publish_error: null,
        publish_attempts: 0,
        updated_at: new Date().toISOString(),
    }
    if (newTime) update.time_slot = newTime

    // Publikovaný příspěvek nemá termín co posouvat a `posting` je zrovna v letu —
    // přepsat mu čas by znamenalo závod s publisherem.
    const { error } = await supabaseAdmin
        .from("ig_posts")
        .update(update)
        .eq("id", postId)
        .not("status", "in", '("posted","posting")')

    return { success: !error }
}

// ─── Approve Post ──────────────────────────────────────

export async function approvePost(postId: string): Promise<{ success: boolean }> {
    await gatePostAccess(postId)
    const { error } = await supabaseAdmin
        .from("ig_posts")
        .update({
            status: "ready",
            updated_at: new Date().toISOString(),
        })
        .eq("id", postId)

    return { success: !error }
}

// ─── Retry a failed publish ──────────────────────────────────────────────────

/**
 * Re-arm a post that failed to publish: back to 'scheduled' due now, so the next
 * ig-publisher tick retries it. Resets the attempt counter. Requires a live
 * Instagram connection (same guard as scheduling).
 */
export async function retryPublishAction(
    projectSlug: string,
    postId: string,
): Promise<{ success: boolean; error?: string }> {
    try {
        const clientId = await gatePostAccess(postId)
        const { getConnectionMeta } = await import("@/instagram/ig-connection")
        const conn = await getConnectionMeta(clientId)
        if (!conn || conn.status !== "connected") {
            return { success: false, error: "Nejdřív připojte Instagram účet v Nastavení." }
        }
        const { error } = await supabaseAdmin
            .from("ig_posts")
            .update({
                status: "scheduled",
                scheduled_for: new Date().toISOString(),
                publish_error: null,
                publish_attempts: 0,
                updated_at: new Date().toISOString(),
            })
            .eq("id", postId)
        if (error) return { success: false, error: error.message }
        return { success: true }
    } catch (err) {
        return { success: false, error: (err as Error)?.message || "Akce selhala" }
    }
}

// ─── Publish a post immediately ("Publikovat hned" — one tap, no app) ────────

/**
 * Arm a post for immediate auto-publish: status 'scheduled' due now, so the next
 * ig-publisher tick (≤60s) posts it to Instagram via the Graph API — no app, no
 * manual step. We deliberately DON'T call the Graph publish synchronously here, so
 * a slow carousel (container polling) can't time out a server action — the cron
 * owns that with its 800s budget. That budget is what makes reels workable here at
 * all: a REELS container is transcoded before it can be published, which takes
 * minutes. Requires a live connection. Every medium the engine renders is supported —
 * reels as a REELS container, stories as one STORIES container per frame.
 */
export async function publishNowAction(
    postId: string,
): Promise<{ success: boolean; error?: string }> {
    try {
        const clientId = await gatePostAccess(postId)
        const { getConnectionMeta } = await import("@/instagram/ig-connection")
        const conn = await getConnectionMeta(clientId)
        if (!conn || conn.status !== "connected") {
            return { success: false, error: "Nejdřív připojte Instagram účet v Nastavení." }
        }

        const { data: post } = await supabaseAdmin
            .from("ig_posts")
            .select("media_type, image_url")
            .eq("id", postId)
            .single()
        // Same parser as the publisher cron, so the two can't disagree about what a
        // pipe-joined image_url means.
        const { parsePostMedia } = await import("@/lib/media-urls")
        const media = parsePostMedia(post?.image_url, post?.media_type)

        // Reels and stories publish like anything else now, but a reel row whose
        // render fell back to a still has nothing to send down the video path. Saying
        // so HERE — while the tenant is looking at the button — beats arming the post
        // and letting the cron fail it four times into a silent 'failed'.
        // `parsePostMedia` has no bare 'video' kind — a reel IS the engine's only video.
        if (media.kind === "reel" && !media.videoUrl) {
            return { success: false, error: "Tenhle reel nemá video — přegeneruj ho, publikovat zatím nejde." }
        }
        if (media.urls.length === 0) {
            return { success: false, error: "Příspěvek nemá žádné médium k publikování." }
        }

        const { error } = await supabaseAdmin
            .from("ig_posts")
            .update({
                status: "scheduled",
                scheduled_for: new Date().toISOString(),
                publish_error: null,
                publish_attempts: 0,
                updated_at: new Date().toISOString(),
            })
            .eq("id", postId)
        if (error) return { success: false, error: error.message }
        return { success: true }
    } catch (err) {
        return { success: false, error: (err as Error)?.message || "Publikace selhala" }
    }
}

/** Lightweight status read for polling a just-armed "Publikovat hned" post. */
export async function getPostPublishStatus(
    postId: string,
): Promise<{ status: string; permalink: string | null; error: string | null } | null> {
    try {
        await gatePostAccess(postId)
        const { data } = await supabaseAdmin
            .from("ig_posts")
            .select("status, permalink, publish_error")
            .eq("id", postId)
            .single()
        if (!data) return null
        return { status: data.status, permalink: data.permalink, error: data.publish_error }
    } catch {
        return null
    }
}

// ─── Schedule a single post (from the generate result or posts list) ─────────

/**
 * Potvrzení plánu — překlopí NAVRŽENÉ termíny na naostřené.
 * =========================================================
 * Generátor razítkuje `scheduled_for` už při tvorbě příspěvku, ale se stavem
 * `ready`. Publisher bere jen `scheduled`, takže návrh sám o sobě nic nezveřejní —
 * a přesně proto kalendář dlouho vypadal jako plán, aniž by plánem byl.
 *
 * Tohle je ten chybějící krok: člověk se na týden podívá a jedním kliknutím ho
 * potvrdí. Termíny se přitom NEPŘEPOČÍTÁVAJÍ — až na propadlé, viz níže.
 */
export async function confirmPlanAction(
    projectSlug: string,
    fromDate: string, // "2026-09-01" včetně
    toDate: string,   // "2026-09-07" včetně
): Promise<{ success: boolean; confirmed?: number; shifted?: number; skipped?: number; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)

        const { getConnectionMeta } = await import("@/instagram/ig-connection")
        const conn = await getConnectionMeta(clientId)
        if (!conn || conn.status !== "connected") {
            return { success: false, error: "Nejdřív připojte Instagram účet v Nastavení." }
        }

        // Konec dne u `toDate` — jinak by poslední den v rozsahu vypadl.
        const fromIso = new Date(`${fromDate}T00:00:00.000Z`).toISOString()
        const toIso = new Date(`${toDate}T23:59:59.999Z`).toISOString()

        // Reels a stories most publikovat neumí; potvrdit je by znamenalo naostřit
        // něco, co skončí jako `failed`. Null větev je tu schválně: media_type přišlo
        // migrací bez backfillu, takže bez ní vypadnou všechny starší řádky.
        const { data: proposed, error: readErr } = await supabaseAdmin
            .from("ig_posts")
            .select("id, scheduled_for, time_slot")
            .eq("client_id", clientId)
            .eq("status", "ready")
            .not("image_url", "is", null)
            .not("scheduled_for", "is", null)
            .gte("scheduled_for", fromIso)
            .lte("scheduled_for", toIso)
            .or("media_type.is.null,and(media_type.neq.reel,media_type.neq.story)")
            .order("scheduled_for", { ascending: true })
        if (readErr) return { success: false, error: readErr.message }
        if (!proposed || proposed.length === 0) {
            return { success: true, confirmed: 0, shifted: 0, skipped: 0 }
        }

        // Propadlé termíny: příspěvek k pátečnímu provozu nemá vyjít zpětně v úterý.
        // Přeplánujeme je dopředu — a je to v pořádku, protože si o to člověk právě
        // řekl kliknutím. Tiché přepočítávání dělal agent a právě to bylo špatně.
        const now = Date.now()
        const overdue = proposed.filter(p => new Date(p.scheduled_for as string).getTime() <= now)
        const onTime = proposed.filter(p => new Date(p.scheduled_for as string).getTime() > now)

        let shiftSlots: { date: string; time: string }[] = []
        if (overdue.length > 0) {
            const { loadConfig } = await import("@/instagram/configs")
            const { distributeSchedule } = await import("@/lib/schedule-planner")
            let perWeek = 4
            let times: string[] | undefined
            try {
                const config = await loadConfig(projectSlug)
                perWeek = Number(config?.postsPerWeek) || 4
                times = Array.isArray(config?.postingTimes) && config.postingTimes.length > 0
                    ? (config.postingTimes as string[]) : undefined
            } catch { /* výchozí kadence stačí, tohle nesmí potvrzení shodit */ }
            shiftSlots = distributeSchedule(overdue.length, { postsPerWeek: perWeek, timeSlots: times })
        }

        const { toScheduledFor } = await import("@/lib/schedule-planner")
        let confirmed = 0
        let shifted = 0
        let skipped = 0

        const arm = async (postId: string, scheduledFor: string, timeSlot: string | null) => {
            // Podmíněný flip: souběžnou ruční změnu ani smazání nesmíme přepsat.
            const { data } = await supabaseAdmin
                .from("ig_posts")
                .update({
                    status: "scheduled",
                    scheduled_for: scheduledFor,
                    time_slot: timeSlot,
                    publish_error: null,
                    publish_attempts: 0,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", postId)
                .eq("status", "ready")
                .select("id")
                .maybeSingle()
            if (data) return true
            skipped++
            return false
        }

        for (const p of onTime) {
            if (await arm(p.id, p.scheduled_for as string, p.time_slot)) confirmed++
        }
        for (let i = 0; i < overdue.length; i++) {
            const slot = shiftSlots[i]
            if (!slot) { skipped++; continue }
            if (await arm(overdue[i].id, toScheduledFor(slot.date, slot.time), slot.time)) {
                confirmed++
                shifted++
            }
        }

        return { success: true, confirmed, shifted, skipped }
    } catch (err) {
        return { success: false, error: (err as Error)?.message || "Potvrzení plánu selhalo" }
    }
}

/**
 * Assign a posting time to one already-generated post and add it to the calendar.
 * Used by the "📅 Naplánovat" control after a single generation.
 */
export async function schedulePostAction(
    projectSlug: string,
    postId: string,
    date: string,    // "2026-06-20"
    time: string,    // "17:00"
): Promise<{ success: boolean; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        // Confirm the post belongs to this tenant before mutating.
        const { data: post } = await supabaseAdmin
            .from("ig_posts")
            .select("client_id")
            .eq("id", postId)
            .single()
        if (!post || post.client_id !== clientId) {
            return { success: false, error: "Příspěvek nepatří tomuto projektu." }
        }

        // Arming a post for auto-publish requires a live Instagram connection — the
        // publisher cron (status='scheduled') would otherwise just fail the post.
        const { getConnectionMeta } = await import("@/instagram/ig-connection")
        const conn = await getConnectionMeta(clientId)
        if (!conn || conn.status !== "connected") {
            return { success: false, error: "Nejdřív připojte Instagram účet v Nastavení." }
        }

        const { toScheduledFor } = await import("@/lib/schedule-planner")
        const { error } = await supabaseAdmin
            .from("ig_posts")
            .update({
                scheduled_for: toScheduledFor(date, time),
                time_slot: time,
                // 'scheduled' = approved + armed → picked up by the ig-publisher cron.
                status: "scheduled",
                publish_error: null,
                publish_attempts: 0,
                updated_at: new Date().toISOString(),
            })
            .eq("id", postId)
        if (error) return { success: false, error: error.message }

        // Calendar entry — best-effort, non-fatal (mirrors planWeekAction).
        try {
            const { schedulePost } = await import("@/instagram/service")
            await schedulePost(date, postId, time)
        } catch { /* calendar insert is non-critical */ }

        return { success: true }
    } catch (err) {
        return { success: false, error: (err as Error)?.message || "Plánování selhalo" }
    }
}

// ─── Publish Outlook ─────────────────────────────────────
//
// Co auto-publikování reálně čeká, spočítané z PLÁNU — ne z nějaké frekvence
// nastavené vedle plánu. Nastavení dřív nabízelo „jak často publikovat", jenže
// termín každého příspěvku vzniká jednou při generování a žije v kalendáři;
// druhé číslo v Nastavení tedy nemělo co řídit a jen lhalo o tom, kdy co vyjde.
// Tahle akce je jeho náhrada: místo volby ukazuje pravdu.

export interface PublishOutlook {
    /** Naostřené (status 'scheduled') s termínem v budoucnu — vyjdou samy. */
    armed: number
    /** Hotové s termínem, které ještě čekají na potvrzení/naostření. */
    waiting: number
    /** Propadlé termíny — agent je schválně neposouvá, čekají na člověka. */
    overdue: number
    /** Nejbližší termín, ať už naostřený nebo čekající. */
    next: { at: string; armed: boolean } | null
    /** Poslední skutečně zveřejněný příspěvek. */
    lastPosted: { at: string; permalink: string | null } | null
}

export async function getPublishOutlook(projectSlug: string): Promise<PublishOutlook> {
    const { clientId } = await requireProjectAccess(projectSlug)
    const nowIso = new Date().toISOString()

    const base = () => supabaseAdmin
        .from("ig_posts")
        .select("scheduled_for", { count: "exact", head: true })
        .eq("client_id", clientId)

    const [armedRes, waitingRes, overdueRes, nextArmed, nextWaiting, lastRes] = await Promise.all([
        base().eq("status", "scheduled").gt("scheduled_for", nowIso),
        base().eq("status", "ready").gt("scheduled_for", nowIso),
        // Propadlé = mělo vyjít a nevyšlo. Naostřené propadlé řeší publisher sám
        // (běží každou minutu), takže tady jde o ty, co uvázly v `ready`.
        base().eq("status", "ready").lte("scheduled_for", nowIso),
        supabaseAdmin.from("ig_posts").select("scheduled_for").eq("client_id", clientId)
            .eq("status", "scheduled").gt("scheduled_for", nowIso)
            .order("scheduled_for", { ascending: true }).limit(1).maybeSingle(),
        supabaseAdmin.from("ig_posts").select("scheduled_for").eq("client_id", clientId)
            .eq("status", "ready").gt("scheduled_for", nowIso)
            .order("scheduled_for", { ascending: true }).limit(1).maybeSingle(),
        supabaseAdmin.from("ig_posts").select("posted_at, permalink").eq("client_id", clientId)
            .eq("status", "posted").not("posted_at", "is", null)
            .order("posted_at", { ascending: false }).limit(1).maybeSingle(),
    ])

    const a = nextArmed.data?.scheduled_for as string | undefined
    const w = nextWaiting.data?.scheduled_for as string | undefined
    let next: PublishOutlook["next"] = null
    if (a && w) next = new Date(a) <= new Date(w) ? { at: a, armed: true } : { at: w, armed: false }
    else if (a) next = { at: a, armed: true }
    else if (w) next = { at: w, armed: false }

    return {
        armed: armedRes.count || 0,
        waiting: waitingRes.count || 0,
        overdue: overdueRes.count || 0,
        next,
        lastPosted: lastRes.data?.posted_at
            ? { at: lastRes.data.posted_at as string, permalink: (lastRes.data.permalink as string | null) ?? null }
            : null,
    }
}

/**
 * Naostřit hotové příspěvky hned — volá se, když člověk zapne auto-publikování
 * nebo právě dokončil připojení účtu.
 *
 * Denní agent `auto_publish_arm` dělá totéž jednou za den; tohle jen zkracuje
 * ticho mezi činem a účinkem, aby se nově připojený klient nedozvěděl až zítra,
 * že to funguje. Sám o sobě nic nepřepíše: uvnitř běží týž podmíněný claim
 * `ready → scheduled` a termíny z plánu zůstávají beze změny.
 */
export async function armAutoPublishNow(
    projectSlug: string,
): Promise<{ success: boolean; armed?: number; skipped?: string; error?: string }> {
    try {
        const { clientId } = await requireProjectAccess(projectSlug)
        const { armClientNow } = await import("@/lib/agents/auto-publish")
        const res = await armClientNow(clientId)
        return { success: true, armed: res.armed, skipped: res.skipped }
    } catch (err) {
        return { success: false, error: (err as Error)?.message || "Naostření selhalo" }
    }
}
