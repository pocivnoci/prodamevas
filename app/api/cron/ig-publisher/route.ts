import { NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"
import { getConnection } from "@/instagram/ig-connection"
import { instagramAdapter } from "@/lib/channels/instagram"
import type { FormattedContent, MediaType } from "@/lib/channels/types"
import { isMediumType } from "@/lib/credits"
import { parsePostMedia } from "@/lib/media-urls"

export const maxDuration = 800 // Vercel Pro cap (Fluid Compute).

/**
 * GET /api/cron/ig-publisher
 *
 * Durable publisher for approved, scheduled posts. Step 2 ("Publishing") of the IG
 * go-live roadmap. Each tick drains posts whose `scheduled_for` is due and whose
 * status is 'scheduled' (the human-approved, armed state), publishing each to the
 * tenant's connected Instagram account via the Graph API.
 *
 * Safety:
 *  - Atomic claim: status 'scheduled' → 'posting' on the row id; only the worker that
 *    wins the flip proceeds, so two overlapping ticks can't double-publish.
 *  - Per-item fail-open: one bad post never kills the batch.
 *  - Bounded retries with backoff; permanent errors (no connection, reel unsupported)
 *    fail fast instead of looping.
 *
 * Triggers: Vercel cron every minute (vercel.json). Auth: CRON_SECRET bearer
 * (no user session in a worker). No credit charge here — credits are taken at
 * generation time (ig-create-job / campaign-worker); publishing is free.
 */

const BATCH = 20            // posts claimed per tick (publish is mostly network wait)
const BUDGET_MS = 700 * 1000 // stop taking new posts past this, margin under 800s
const MAX_ATTEMPTS = 4      // give up (status 'failed') after this many publish failures

const nowIso = () => new Date().toISOString()

/** Derive the media type for a post, falling back to the image_url pipe convention.
 *  Narrowed through isMediumType rather than a hand-written whitelist: the old one
 *  fell through to the pipe heuristic for anything it didn't name, so a 3-frame story
 *  resolved to "carousel". The heuristic itself must stay carousel-biased — legacy
 *  rows with a NULL media_type predate both stories and reels. */
function resolveMediaType(post: { media_type: string | null; image_url: string | null }): MediaType {
    if (isMediumType(post.media_type)) return post.media_type
    return (post.image_url || "").includes("|") ? "carousel" : "image"
}

export async function GET(req: Request) {
    const secret = process.env.CRON_SECRET
    const auth = req.headers.get("authorization")
    if (!secret || auth !== `Bearer ${secret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const t0 = Date.now()

    // Due posts: approved + armed (status='scheduled') and their time has arrived.
    const { data: due, error } = await supabaseAdmin
        .from("ig_posts")
        .select("id, client_id, caption, image_url, media_type, publish_attempts")
        .eq("status", "scheduled")
        .lte("scheduled_for", nowIso())
        .order("scheduled_for", { ascending: true })
        .limit(BATCH)

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!due || due.length === 0) {
        return NextResponse.json({ success: true, idle: true })
    }

    let published = 0
    let failed = 0
    let deferred = 0

    for (const post of due) {
        if (Date.now() - t0 > BUDGET_MS) break

        // ── Atomic claim: only the worker that flips scheduled→posting proceeds. ──
        const { data: claimed } = await supabaseAdmin
            .from("ig_posts")
            .update({ status: "posting", updated_at: nowIso() })
            .eq("id", post.id)
            .eq("status", "scheduled")
            .select("id")
            .maybeSingle()
        if (!claimed) continue // someone else got it

        const attempts = (post.publish_attempts || 0) + 1

        // Mark a transient failure: back off and re-arm for a later tick, or give up.
        const failTransient = async (reason: string) => {
            if (attempts >= MAX_ATTEMPTS) {
                await supabaseAdmin.from("ig_posts").update({
                    status: "failed", publish_attempts: attempts,
                    publish_error: reason.slice(0, 500), updated_at: nowIso(),
                }).eq("id", post.id)
                failed++
                return
            }
            const backoffMs = Math.min(2 ** attempts, 30) * 60 * 1000
            await supabaseAdmin.from("ig_posts").update({
                status: "scheduled", publish_attempts: attempts,
                publish_error: reason.slice(0, 500),
                scheduled_for: new Date(Date.now() + backoffMs).toISOString(),
                updated_at: nowIso(),
            }).eq("id", post.id)
            deferred++
        }

        // Mark a permanent failure (no point retrying): not connected, reel unsupported, etc.
        const failPermanent = async (reason: string) => {
            await supabaseAdmin.from("ig_posts").update({
                status: "failed", publish_attempts: attempts,
                publish_error: reason.slice(0, 500), updated_at: nowIso(),
            }).eq("id", post.id)
            failed++
        }

        try {
            const conn = await getConnection(post.client_id)
            if (!conn || conn.status !== "connected") {
                await failPermanent("Instagram není připojený (nebo vypršel token).")
                continue
            }

            const mediaType = resolveMediaType(post)
            const mediaUrls = parsePostMedia(post.image_url, post.media_type).urls
            const content: FormattedContent = {
                channel: "instagram",
                body: post.caption || "",
                mediaUrls,
                mediaType,
            }

            const result = await instagramAdapter.publish(
                { accessToken: conn.accessToken, externalUserId: conn.igUserId },
                content,
            )

            // A partial publish (some story frames live, a later one failed) is TERMINAL:
            // "posted" with the error recorded. It IS on Instagram and it is NOT complete,
            // and re-arming would republish the frames that already went live — up to
            // MAX_ATTEMPTS times, i.e. 8 junk stories on a customer's account.
            await supabaseAdmin.from("ig_posts").update({
                status: "posted",
                posted_at: nowIso(),
                ig_media_id: result.externalId,
                permalink: result.permalink || null,
                publish_attempts: attempts,
                publish_error: result.partial
                    ? `Publikováno ${result.partial.publishedCount}/${result.partial.total} snímků: ${result.partial.error}`.slice(0, 500)
                    : null,
                updated_at: nowIso(),
            }).eq("id", post.id)
            if (result.partial) {
                console.warn(`   ⚠️ Story ${post.id}: publikováno jen ${result.partial.publishedCount}/${result.partial.total} snímků — neopakuji`)
            }
            published++
        } catch (err: any) {
            const msg = err?.message || String(err)
            // ChannelNotEnabledError = unsupported media (e.g. reel) — never retry.
            if (err?.name === "ChannelNotEnabledError") await failPermanent(msg)
            else await failTransient(msg)
        }
    }

    return NextResponse.json({ success: true, published, failed, deferred, considered: due.length })
}
