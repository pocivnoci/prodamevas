import { NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"
import { generateOnePost } from "@/instagram/autopilot"
import { isQualityUnavailable } from "@/utils/retry"

export const maxDuration = 800 // Vercel Pro cap (Fluid Compute) — full budget to drain a campaign.

/**
 * GET /api/cron/campaign-worker
 *
 * Durable drainer for ig_campaigns. Replaces the old browser-driven batch loop
 * (which truncated when the tab closed → "asked for 7, got 4"). Each tick claims
 * ONE unfinished campaign via a lease and generates its posts sequentially within
 * the 800s budget, advancing `cursor` after each post so a crash/timeout resumes
 * exactly where it stopped on the next tick.
 *
 * Triggers: Vercel cron every minute (vercel.json) + an immediate fire-and-forget
 * kick from startCampaign. Auth: CRON_SECRET bearer (no user session in a worker).
 */

const LEASE_MS = 5 * 60 * 1000 // a stale lease (worker died) is reclaimable after this
const BUDGET_MS = 700 * 1000   // stop taking new posts past this, leaving margin under 800s
// How long we keep deferring a post whose Pro engines stay overloaded before giving up
// on it as a failure. "Quality over speed" — but not forever.
const MAX_CAMPAIGN_AGE_MS = Number(process.env.CAMPAIGN_MAX_AGE_MS || 6 * 60 * 60 * 1000)
// Plan previews the user generated but never approved. Kept long enough to survive a
// "I'll finish this next week", then collected — otherwise every plan run leaks a row.
const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000
// Jak dlouho smí kampaň čekat na bránu (`options.gate`), než se pustí i tak. Čekání
// nesmí být nekonečné: když se hlídaná práce zasekne, je pozdější obsah pořád lepší
// než žádný.
const GATE_MAX_WAIT_MS = Number(process.env.CAMPAIGN_GATE_MAX_WAIT_MS || 20 * 60 * 1000)

export async function GET(req: Request) {
    const secret = process.env.CRON_SECRET
    const auth = req.headers.get("authorization")
    if (!secret || auth !== `Bearer ${secret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const t0 = Date.now()
    const nowIso = () => new Date().toISOString()
    const staleBefore = new Date(Date.now() - LEASE_MS).toISOString()

    // ── Claim one campaign (atomic lease) ───────────────────────────────────
    // Pořadí: nejdřív priorita tarifu, uvnitř stejné priority FIFO. Do 8/2026 se
    // řadilo jen podle `created_at`, takže „Prioritní generování" na Dominanci
    // a „Nejvyšší priorita ve frontě" na Impériu byly placené sliby bez jakékoliv
    // implementace. Priorita je stampnutá na řádku (viz campaign-actions.ts),
    // protože PostgREST neumí řadit přes join na tarif.
    const { data: candidates } = await supabaseAdmin
        .from("ig_campaigns")
        .select("id")
        .in("status", ["pending", "running"])
        .or(`worker_lease.is.null,worker_lease.lt.${staleBefore}`)
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(5)

    // Atomic claim. NOTE: PostgREST rejects `.or()` on UPDATE ("column ... does not
    // exist") — it silently claims nothing, so the worker would loop forever as idle.
    // Express "lease is null OR stale" as TWO sequential conditional updates; each is a
    // valid atomic filter and at most one matches. Errors are surfaced, never swallowed.
    const tryClaim = async (id: string, leaseNull: boolean) => {
        let q = supabaseAdmin
            .from("ig_campaigns")
            .update({ status: "running", worker_lease: nowIso() })
            .eq("id", id)
            .in("status", ["pending", "running"])
        q = leaseNull ? q.is("worker_lease", null) : q.lt("worker_lease", staleBefore)
        const { data, error } = await q.select("*").maybeSingle()
        if (error) console.warn(`⚠️ campaign-worker claim error (${id}): ${error.message}`)
        return data
    }

    // ── Brána: kampaň, která čeká na cizí práci ─────────────────────────────
    // Ukázkové příspěvky z onboardingu se nesmí vyrobit dřív, než sken webu stáhne
    // fotky produktů — renderer bere `ig_products.image_urls[0]` jako „EXACT product
    // photo" (instagram/orchestrators/image-orchestrator.ts). Bez fotky vznikne
    // vymyšlený produkt a přesně první tři příspěvky jsou to, podle čeho klient soudí
    // celý produkt. Stav se čte ŽIVĚ z hlídaného tasku, takže brána nepotřebuje, aby ji
    // kdokoli „otevřel" — když práce doběhne dřív, nic se nezdrží, a když task zmizí,
    // kampaň se pustí taky.
    //
    // Vrací důvod, proč se má počkat, nebo null. Rozdělaná kampaň (cursor > 0) se
    // nezastavuje — brána platí jen na tu, co ještě nic nevygenerovala.
    const gateReason = async (c: any): Promise<string | null> => {
        const taskId = (c.options as Record<string, any> | null)?.gate?.taskId
        if (!taskId || (c.cursor || 0) > 0) return null
        if (Date.now() - new Date(c.created_at).getTime() > GATE_MAX_WAIT_MS) return null
        const { data: task } = await supabaseAdmin
            .from("agent_tasks")
            .select("type, status")
            .eq("id", taskId)
            .maybeSingle()
        if (!task || !["pending", "running"].includes(task.status)) return null
        return `${task.type} (${task.status})`
    }

    let campaign: any = null
    for (const c of candidates || []) {
        const claimed = (await tryClaim(c.id, true)) || (await tryClaim(c.id, false))
        if (!claimed) continue

        const waitingFor = await gateReason(claimed)
        if (waitingFor) {
            // Zpátky do fronty — a tick si vezme další kampaň, ať čekání nezdrží cizí tenanty.
            const { error } = await supabaseAdmin
                .from("ig_campaigns")
                .update({ status: "pending", worker_lease: null })
                .eq("id", claimed.id)
            if (error) console.warn(`⚠️ campaign-worker gate release failed (${claimed.id}): ${error.message}`)
            console.log(`⏳ campaign ${claimed.id} čeká na ${waitingFor}`)
            continue
        }

        campaign = claimed
        break
    }

    if (!campaign) {
        // Nothing to drain — spend the idle tick collecting abandoned plan drafts. Only ever
        // touches status='draft', so a live campaign can't be caught by a clock skew.
        try {
            const cutoff = new Date(Date.now() - DRAFT_TTL_MS).toISOString()
            const { error } = await supabaseAdmin
                .from("ig_campaigns")
                .delete()
                .eq("status", "draft")
                .lt("updated_at", cutoff)
            if (error) console.warn(`⚠️ draft GC failed: ${error.message}`)
        } catch (e: any) {
            console.warn(`⚠️ draft GC failed: ${e?.message}`)
        }
        return NextResponse.json({ success: true, idle: true })
    }

    const clientId: string = campaign.client_id
    const plan: any[] = Array.isArray(campaign.plan) ? campaign.plan : []
    const opts = (campaign.options || {}) as Record<string, any>
    const configName: string = opts.configName
    const total: number = campaign.total || plan.length
    let cursor: number = campaign.cursor || 0
    let successes: number = campaign.successes || 0
    let failures: number = campaign.failures || 0

    if (!configName) {
        await supabaseAdmin.from("ig_campaigns")
            .update({ status: "failed", error: "Kampaň postrádá configName.", worker_lease: null })
            .eq("id", campaign.id)
        return NextResponse.json({ success: false, error: "missing configName" }, { status: 500 })
    }

    const {
        canPerformAction, incrementPlanPostCount, deductCredits, refundJobCharge, reconcileJobCharge,
        getClientSubscription, creditsForMedia,
    } = await import("@/lib/subscription")

    // Cross-tick campaign continuity: seed previous hooks from already-done posts.
    const previousPosts: { hook: string; topic: string }[] = []
    try {
        const { data: doneJobs } = await supabaseAdmin
            .from("ig_jobs")
            .select("config, result, created_at")
            .eq("client_id", clientId)
            .eq("status", "done")
            .order("created_at", { ascending: true })
        for (const j of doneJobs || []) {
            if ((j.config as any)?.campaignId === campaign.id) {
                const caption = (j.result as any)?.caption || ""
                previousPosts.push({ hook: caption.split("\n")[0] || "", topic: (j.config as any)?.topic || "auto" })
            }
        }
    } catch { /* non-fatal — continuity is best-effort */ }

    const allowedMedia = (await getClientSubscription(clientId))?.features?.allowed_media

    // ── Independent lease heartbeat ──────────────────────────────────────────
    // onProgress only fires BETWEEN pipeline stages; a single stage (withQualityRetry
    // backoff on an overloaded Pro model) can stay silent for longer than LEASE_MS,
    // letting a second worker "reclaim" a still-alive campaign and double-process the
    // current item (double charge + double post). Beat the lease on a timer, independent
    // of generation progress. MUST be cleared on every exit path (a zombie interval on a
    // reused Fluid instance would re-lease a released campaign and block the next tick) —
    // hence the try/finally wrapping the rest of the handler.
    const heartbeat = setInterval(() => {
        void supabaseAdmin
            .from("ig_campaigns")
            .update({ worker_lease: nowIso() })
            .eq("id", campaign.id)
            .then(({ error }) => {
                if (error) console.warn(`⚠️ campaign-worker lease heartbeat failed: ${error.message}`)
            })
    }, 60_000)

    try {
    // (body deliberately not re-indented — same style as autopilot's withActiveProject wrapper)

    let stopReason: "complete" | "budget" | "no_credits" | "deferred" = "complete"
    // The TRUE reason the gate stopped us (e.g. "subscription expired"), so the campaign
    // error isn't always the misleading "Došly kredity" when it's really something else.
    let stopDetail: string | null = null

    const persist = async () => {
        await supabaseAdmin.from("ig_campaigns")
            .update({ cursor, successes, failures, worker_lease: nowIso() })
            .eq("id", campaign.id)
    }

    while (cursor < total) {
        if (Date.now() - t0 > BUDGET_MS) { stopReason = "budget"; break }

        const item = plan[cursor]
        const postType: string | undefined = item?.postType || undefined
        // Topic = the theme (kept short); the approved hook is passed separately so the Pro
        // copywriter refines THE HOOK THE USER APPROVED instead of a mashed-together string it
        // would silently rewrite. What you approve in the plan ≈ what ships.
        const baseTopic = item?.topic || opts.topic || undefined
        const postTopic = item?.angle
            ? `${baseTopic || ""}${baseTopic ? " — " : ""}úhel: ${item.angle}`.trim()
            : baseTopic
        const approvedHook = item?.hookPreview?.trim() || undefined
        // Idea-bank attribution: the plan item's topic was derived from this idea (bank-sourced
        // or deposited at startCampaign) — generateOnePost links idea_id + marks it used.
        // Ownership was validated at startCampaign; re-check mere existence here so an idea
        // the user deleted mid-campaign drops the attribution instead of failing the post.
        let itemIdeaId: string | undefined = item?.ideaId || undefined
        if (itemIdeaId) {
            const { data: ideaRow } = await supabaseAdmin
                .from("ig_post_ideas")
                .select("id")
                .eq("id", itemIdeaId)
                .eq("client_id", clientId)
                .maybeSingle()
            if (!ideaRow) itemIdeaId = undefined
        }
        // Per-item medium chosen in the plan (image/carousel) overrides the campaign-wide
        // default. generateOnePost still applies the reel kill-switch + feed-safe clamp.
        const itemMedium = item?.medium || opts.medium || undefined

        // Billed medium = what will actually render: pre-apply the same clamps the engine
        // uses (kill-switch, plan gating), so the media-weighted charge matches delivery.
        let chargedMedium: "image" | "carousel" | "reel" =
            itemMedium === "reel" || itemMedium === "carousel" ? itemMedium : "image"
        if (chargedMedium === "reel" && process.env.REELS_ENABLED !== "1") chargedMedium = "carousel"
        if (chargedMedium === "reel" && allowedMedia && !allowedMedia.includes("reel")) {
            chargedMedium = allowedMedia.includes("carousel") ? "carousel" : "image"
        }

        // ── Per-post credit check (clientId-based; no session in a worker) ──
        // Admin/internal bypass: CAMPAIGN_ADMIN_BYPASS=1 (global) OR options.adminBypass
        // (per-campaign, set by startCampaign when a super-admin starts it) skips the credit
        // gate AND the charge (charged="none"). The per-campaign flag closes the mismatch where
        // a super-admin's session bypassed the up-front check but this session-less worker
        // could not — so the campaign was created then silently died at post 0. Default OFF.
        const ADMIN_BYPASS = process.env.CAMPAIGN_ADMIN_BYPASS === "1" || opts.adminBypass === true

        // Always built (not gated on previousPosts): the arc is decided once at plan time and
        // every post needs it, including post #1 — the one that opens the series.
        const campaignContext = {
            postNumber: cursor + 1,
            totalPosts: total,
            previousPosts: [...previousPosts],
            campaignArc: (opts.strategySummary as string | null) || undefined,
        }

        // ♻️ Deferred-item reuse: a previous tick hit QualityUnavailable and PARKED this
        // item's job (charge kept, caption checkpoint kept). Reuse the job — no new
        // charge, and the checkpoint skips the already-done caption phase.
        let job: { id: string } | null = null
        let charged: "plan" | "credits" | "none" = "none"
        let chargedCredits = 0
        let resumeFrom: import("@/instagram/autopilot").CaptionCheckpoint | undefined
        if (item?.jobId) {
            const { data: parked } = await supabaseAdmin
                .from("ig_jobs")
                .select("id, config, result, status")
                .eq("id", item.jobId)
                .maybeSingle()
            // A previous worker may have FINISHED this item and died before advancing the
            // cursor (item.jobId is persisted at job creation) — count it and move on,
            // never regenerate an already-delivered post.
            const parkedResult = (parked?.result ?? null) as { success?: boolean; caption?: string } | null
            if (parked && parked.status === "done" && parkedResult?.success) {
                console.log(`   ✅ campaign ${campaign.id} item #${cursor + 1}: already completed by a previous worker (job ${parked.id}) — skipping`)
                successes++
                previousPosts.push({ hook: String(parkedResult.caption || "").split("\n")[0] || "", topic: item?.topic || "auto" })
                cursor++
                await persist()
                continue
            }
            if (parked) {
                job = { id: parked.id }
                const pcfg = (parked.config || {}) as Record<string, any>
                charged = pcfg.charged ?? "none"
                chargedCredits = pcfg.chargedCredits ?? 0
                if (pcfg.chargedMedium) chargedMedium = pcfg.chargedMedium
                resumeFrom = (parked.result as any)?.checkpoint?.stage === "caption"
                    ? (parked.result as any).checkpoint
                    : undefined
                await supabaseAdmin.from("ig_jobs").update({
                    status: "researcher", progress: 5, error: null,
                    agent_message: resumeFrom ? "♻️ Navazuji z checkpointu..." : "🔍 Researcher vybírá zdroje...",
                }).eq("id", parked.id)
                console.log(`   ♻️ campaign ${campaign.id} item #${cursor + 1}: reusing parked job ${parked.id}${resumeFrom ? " (caption checkpoint)" : ""}`)
            }
        }

        if (!job) {
            const check = ADMIN_BYPASS ? { allowed: true, isPlanPost: false } : await canPerformAction(clientId, "post", undefined, chargedMedium)
            if (!check.allowed) {
                stopReason = "no_credits"
                stopDetail = (check as { reason?: string }).reason || "Nedostatek kreditů pro pokračování."
                break
            }
            const isPlanPost = !!check.isPlanPost
            charged = ADMIN_BYPASS ? "none" : (isPlanPost ? "plan" : "credits")
            chargedCredits = charged === "credits" ? creditsForMedia(chargedMedium) : 0

            // Create the job row (mirrors ig-create-job) so the post shows in history/observability.
            const { data: created } = await supabaseAdmin
                .from("ig_jobs")
                .insert({
                    client_id: clientId,
                    config: {
                        configName, type: postType, topic: postTopic, approvedHook,
                        ideaId: itemIdeaId,
                        aspectRatio: opts.aspectRatio || undefined,
                        medium: itemMedium,
                        productId: item?.productId || undefined,
                        campaignContext, campaignId: campaign.id,
                        charged, chargedCredits, chargedMedium, allowedMedia,
                    },
                    status: "researcher",
                    progress: 5,
                    agent_message: "🔍 Researcher vybírá zdroje...",
                })
                .select("id")
                .single()
            job = created

            if (!job) { failures++; cursor++; await persist(); continue }

            // Charge now (idempotent via reference_id = job.id), refund on failure.
            try {
                if (ADMIN_BYPASS) { /* no charge under admin bypass */ }
                else if (isPlanPost) await incrementPlanPostCount(clientId)
                else await deductCredits(clientId, "post", `Post (kampaň ${campaign.id})`, job.id, chargedCredits)
            } catch {
                await supabaseAdmin.from("ig_jobs").delete().eq("id", job.id)
                failures++; cursor++; await persist(); continue
            }

            // Persist the job id on the plan item NOW (not only on QualityUnavailable
            // deferral): if this process is killed mid-generation (800s cap, OOM), the
            // next tick REUSES this job and its already-made charge instead of charging
            // the item a second time — and the ghost job (which no reaper ever visits,
            // the campaign UI never polls individual jobs) can't strand an unrefunded
            // charge. Same persistence pattern as the deferral path below.
            if (item) {
                item.jobId = job.id
                try { await supabaseAdmin.from("ig_campaigns").update({ plan }).eq("id", campaign.id) } catch { /* best-effort */ }
            }
        }

        try {
            const result = await generateOnePost({
                configName, type: postType, topic: postTopic, approvedHook,
                ideaId: itemIdeaId,
                aspectRatio: opts.aspectRatio || undefined,
                medium: itemMedium,
                productId: item?.productId || undefined,
                // Decided at plan time and read straight off the plan row — never recomputed
                // here, or a resumed post could flip to a different visual mode than the grid
                // around it was planned for.
                slotIntent: item?.slotIntent || undefined,
                campaignContext, allowedMedia,
                chargedMedium: ADMIN_BYPASS ? undefined : chargedMedium,
                jobId: job.id,
                resumeFrom,
                onProgress: async (stage: string, progress: number, message: string, editorialLog?: any[]) => {
                    const upd: Record<string, any> = { status: stage, progress, agent_message: message }
                    if (editorialLog?.length) {
                        upd.editorial_log = editorialLog.map((m: any) => ({
                            role: m.role, action: m.action, summary: m.summary || m.content?.substring(0, 150),
                        }))
                    }
                    await supabaseAdmin.from("ig_jobs").update(upd).eq("id", job.id)
                    // Heartbeat the campaign lease DURING long generations so another
                    // worker can't reclaim a still-alive campaign mid-post.
                    await supabaseAdmin.from("ig_campaigns").update({ worker_lease: nowIso() }).eq("id", campaign.id)
                },
            })

            await supabaseAdmin.from("ig_jobs").update({
                status: "done", progress: 100, agent_message: "✅ Hotovo!",
                result: { success: true, postId: result.id, caption: result.caption, imageUrl: result.imageUrl, cost: result.cost },
            }).eq("id", job.id)

            // Engine clamped below the billed medium? Refund the difference.
            try { await reconcileJobCharge(clientId, job.id, charged, chargedCredits, result.mediaType) } catch { /* best-effort */ }

            // Planner: stamp the chosen posting time + calendar entry on the new post.
            // Best-effort — a calendar hiccup must never fail an already-generated post.
            if (result.id && item?.scheduledFor) {
                try {
                    await supabaseAdmin.from("ig_posts").update({
                        scheduled_for: item.scheduledFor,
                        time_slot: item.timeSlot || null,
                        status: "ready",
                    }).eq("id", result.id)
                    const { schedulePost } = await import("@/instagram/service")
                    const date = String(item.scheduledFor).split("T")[0]
                    await schedulePost(date, result.id, item.timeSlot || "afternoon")
                } catch (schedErr) {
                    console.warn(`   ⚠️ schedule stamp failed for ${result.id}: ${(schedErr as Error)?.message?.substring(0, 80)}`)
                }
            }

            successes++
            previousPosts.push({ hook: (result.caption || "").split("\n")[0] || "", topic: postTopic || "auto" })
        } catch (err: any) {
            const msg = (err?.message || String(err)).substring(0, 500)

            // QualityUnavailable = both Pro tiers are overloaded right now. We refuse to
            // ship a flash-quality post, so DEFER: PARK the job (charge kept, caption
            // checkpoint kept), remember its id on the plan item, leave the cursor put,
            // and break — the next tick reuses the job and resumes from the checkpoint,
            // so the already-written caption is never re-generated. Capped by
            // MAX_CAMPAIGN_AGE_MS so it can't defer forever.
            if (isQualityUnavailable(err)) {
                const ageMs = Date.now() - new Date(campaign.created_at).getTime()
                if (ageMs <= MAX_CAMPAIGN_AGE_MS) {
                    // status 'failed' = terminal → the stuck-job reaper won't touch it
                    // (it would refund the charge we're deliberately keeping).
                    await supabaseAdmin.from("ig_jobs").update({ status: "failed", agent_message: "⏸️ Odloženo — velký provoz, pokračuji v dalším ticku", error: msg }).eq("id", job.id)
                    if (item) {
                        item.jobId = job.id
                        try { await supabaseAdmin.from("ig_campaigns").update({ plan }).eq("id", campaign.id) } catch { /* best-effort */ }
                    }
                    console.warn(`   ⏸️ campaign ${campaign.id} item #${cursor + 1}: Pro engines busy — parked job ${job.id}, deferring to next tick`)
                    stopReason = "deferred"
                    break
                }
                // Tried for hours — give up on this item as a failure, refund, move on.
                try { await refundJobCharge(clientId, job.id, charged, chargedCredits) } catch { /* best-effort */ }
                await supabaseAdmin.from("ig_jobs").update({ status: "failed", agent_message: "❌ Nepodařilo se dokončit — velký provoz", error: msg }).eq("id", job.id)
                console.warn(`   ❌ campaign ${campaign.id} item #${cursor + 1}: Pro exhausted past max age — failing item`)
                failures++
            } else {
                await supabaseAdmin.from("ig_jobs").update({ status: "failed", agent_message: "❌ Generování selhalo", error: msg }).eq("id", job.id)
                try { await refundJobCharge(clientId, job.id, charged, chargedCredits) } catch { /* best-effort */ }
                failures++
            }
        }

        cursor++
        await persist()
    }

    // ── Finalize ────────────────────────────────────────────────────────────
    // Terminal updates are conditional transition claims (running → terminal):
    // a stale-lease double-worker reaching finalize claims nothing, so the
    // plan-ready e-mail can never double-send.
    if (cursor >= total) {
        const finalStatus = failures === 0 ? "done" : (successes === 0 ? "failed" : "partial")
        const { data: claimedTerminal } = await supabaseAdmin.from("ig_campaigns").update({
            status: finalStatus, cursor, successes, failures, worker_lease: null,
            error: stopReason === "no_credits" ? (stopDetail || "Došly kredity v průběhu kampaně.") : null,
        }).eq("id", campaign.id)
            .in("status", ["pending", "running"])
            .select("id")
            .maybeSingle()
        if (claimedTerminal) {
            await sendPlanReadyEmail(campaign.id, clientId, { finalStatus, successes, failures, total, noCredits: false })
        }
        return NextResponse.json({ success: true, campaignId: campaign.id, status: finalStatus, successes, failures })
    }

    if (stopReason === "no_credits") {
        const { data: claimedTerminal } = await supabaseAdmin.from("ig_campaigns").update({
            status: "partial", cursor, successes, failures, worker_lease: null,
            error: stopDetail || "Došly kredity — kampaň zastavena.",
        }).eq("id", campaign.id)
            .in("status", ["pending", "running"])
            .select("id")
            .maybeSingle()
        if (claimedTerminal) {
            await sendPlanReadyEmail(campaign.id, clientId, { finalStatus: "partial", successes, failures, total, noCredits: true })
        }
        return NextResponse.json({ success: true, campaignId: campaign.id, status: "partial", stopped: "no_credits" })
    }

    // Work remaining — either the 800s budget ran out or the current item was deferred
    // (Pro overloaded). Release the lease so the next cron tick resumes from `cursor`.
    // status stays 'running'; for a deferral the SAME item is retried until Pro frees up.
    await supabaseAdmin.from("ig_campaigns")
        .update({ cursor, successes, failures, worker_lease: null, status: "running" })
        .eq("id", campaign.id)
    return NextResponse.json({ success: true, campaignId: campaign.id, status: "running", reason: stopReason, resumeFrom: cursor })

    } finally {
        clearInterval(heartbeat)
    }
}

/**
 * "Obsah je připraven" digest to the client owner — per-post cards (termín,
 * caption, hashtagy, náhled) + deep link to Příspěvky (where approve/publish
 * actions live; matches the in-app result CTA). kind "notification" → respects
 * email_optouts and carries the unsubscribe footer. Best-effort: never lets an
 * e-mail problem fail the finalize response.
 */
async function sendPlanReadyEmail(
    campaignId: string,
    clientId: string,
    info: { finalStatus: string; successes: number; failures: number; total: number; noCredits: boolean },
): Promise<void> {
    try {
        const { getOwnerEmail, getCampaignPosts, renderCampaignDigest, sendNotification, studioDeepLink } =
            await import("@/lib/notifications")
        const to = await getOwnerEmail(clientId)
        if (!to) return
        const ctaUrl = studioDeepLink(clientId, "posts")

        if (info.successes === 0) {
            await sendNotification({
                to,
                kind: "notification",
                subject: "Kampaň se nepodařilo dokončit",
                body: `Dobrý den,

${info.noCredits
                        ? "kampaň se zastavila — došly kredity. Po dobití můžete obsah vygenerovat znovu."
                        : "příspěvky z vaší kampaně se bohužel nepodařilo vygenerovat. Kredity za nezdařené příspěvky byly vráceny — zkuste to prosím znovu."}

<a href="${ctaUrl}">Otevřít studio →</a>

Tým Chrlit`,
            })
            return
        }

        const posts = await getCampaignPosts(campaignId, clientId)
        const introParts = [
            "Dobrý den,",
            info.finalStatus === "done"
                ? `váš obsah je hotový — všech ${info.total} příspěvků je připraveno ke kontrole. Každý má navržený termín, caption i hashtagy — zkontrolujte je a schvalte k publikaci:`
                : `${info.successes} z ${info.total} příspěvků je připraveno ke kontrole:`,
        ]
        if (info.failures > 0) {
            introParts.push(`${info.failures} příspěvků se nepodařilo vygenerovat — kredity za ně byly vráceny.`)
        }
        if (info.noCredits) {
            introParts.push("Kampaň se zastavila dřív — došly kredity. Po dobití můžete zbytek vygenerovat znovu.")
        }

        await sendNotification({
            to,
            kind: "notification",
            subject: `Váš obsah je připraven — ${info.successes} z ${info.total} příspěvků`,
            blocks: renderCampaignDigest(posts, {
                intro: introParts.join("\n\n"),
                ctaUrl,
                ctaLabel: "Otevřít příspěvky v aplikaci →",
            }),
        })
    } catch (err: any) {
        console.warn(`campaign-worker: plan-ready e-mail failed (campaign ${campaignId}): ${err?.message}`)
    }
}
