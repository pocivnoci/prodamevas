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
    const { data: candidates } = await supabaseAdmin
        .from("ig_campaigns")
        .select("id")
        .in("status", ["pending", "running"])
        .or(`worker_lease.is.null,worker_lease.lt.${staleBefore}`)
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

    let campaign: any = null
    for (const c of candidates || []) {
        const claimed = (await tryClaim(c.id, true)) || (await tryClaim(c.id, false))
        if (claimed) { campaign = claimed; break }
    }

    if (!campaign) {
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
        const check = ADMIN_BYPASS ? { allowed: true, isPlanPost: false } : await canPerformAction(clientId, "post", undefined, chargedMedium)
        if (!check.allowed) {
            stopReason = "no_credits"
            stopDetail = (check as { reason?: string }).reason || "Nedostatek kreditů pro pokračování."
            break
        }
        const isPlanPost = !!check.isPlanPost
        const charged: "plan" | "credits" | "none" = ADMIN_BYPASS ? "none" : (isPlanPost ? "plan" : "credits")
        const chargedCredits = charged === "credits" ? creditsForMedia(chargedMedium) : 0

        const campaignContext = previousPosts.length > 0
            ? { postNumber: cursor + 1, totalPosts: total, previousPosts: [...previousPosts] }
            : undefined

        // Create the job row (mirrors ig-create-job) so the post shows in history/observability.
        const { data: job } = await supabaseAdmin
            .from("ig_jobs")
            .insert({
                client_id: clientId,
                config: {
                    configName, type: postType, topic: postTopic, approvedHook,
                    aspectRatio: opts.aspectRatio || undefined,
                    medium: itemMedium,
                    category: opts.category || undefined,
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

        try {
            const result = await generateOnePost({
                configName, type: postType, topic: postTopic, approvedHook,
                aspectRatio: opts.aspectRatio || undefined,
                medium: itemMedium,
                productId: item?.productId || undefined,
                campaignContext, allowedMedia,
                chargedMedium: ADMIN_BYPASS ? undefined : chargedMedium,
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
            // ship a flash-quality post, so DEFER: refund, drop the stub job, leave the
            // cursor put, and break — the next cron tick retries this same item when Pro
            // frees up. Capped by MAX_CAMPAIGN_AGE_MS so it can't defer forever.
            if (isQualityUnavailable(err)) {
                try { await refundJobCharge(clientId, job.id, charged, chargedCredits) } catch { /* best-effort */ }
                const ageMs = Date.now() - new Date(campaign.created_at).getTime()
                if (ageMs <= MAX_CAMPAIGN_AGE_MS) {
                    await supabaseAdmin.from("ig_jobs").delete().eq("id", job.id)
                    console.warn(`   ⏸️ campaign ${campaign.id} item #${cursor + 1}: Pro engines busy — deferring to next tick`)
                    stopReason = "deferred"
                    break
                }
                // Tried for hours — give up on this item as a failure and move on.
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
    if (cursor >= total) {
        const finalStatus = failures === 0 ? "done" : (successes === 0 ? "failed" : "partial")
        await supabaseAdmin.from("ig_campaigns").update({
            status: finalStatus, cursor, successes, failures, worker_lease: null,
            error: stopReason === "no_credits" ? (stopDetail || "Došly kredity v průběhu kampaně.") : null,
        }).eq("id", campaign.id)
        return NextResponse.json({ success: true, campaignId: campaign.id, status: finalStatus, successes, failures })
    }

    if (stopReason === "no_credits") {
        await supabaseAdmin.from("ig_campaigns").update({
            status: "partial", cursor, successes, failures, worker_lease: null,
            error: stopDetail || "Došly kredity — kampaň zastavena.",
        }).eq("id", campaign.id)
        return NextResponse.json({ success: true, campaignId: campaign.id, status: "partial", stopped: "no_credits" })
    }

    // Work remaining — either the 800s budget ran out or the current item was deferred
    // (Pro overloaded). Release the lease so the next cron tick resumes from `cursor`.
    // status stays 'running'; for a deferral the SAME item is retried until Pro frees up.
    await supabaseAdmin.from("ig_campaigns")
        .update({ cursor, successes, failures, worker_lease: null, status: "running" })
        .eq("id", campaign.id)
    return NextResponse.json({ success: true, campaignId: campaign.id, status: "running", reason: stopReason, resumeFrom: cursor })
}
