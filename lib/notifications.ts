/**
 * Shared transactional/notification e-mail helpers.
 * ==================================================
 * Single home for the branded template, owner-email resolution, and the
 * best-effort sender used by all automatic e-mails (welcome, payment receipt,
 * plan-ready digest) and by the billing/broadcast flows.
 *
 * Policy:
 *  - kind "transactional" (welcome, receipts, billing) → always sent, plain footer.
 *  - kind "notification" (plan-ready digest, …) → checked against email_optouts
 *    and carries the signed one-click unsubscribe footer.
 *
 * sendNotification NEVER throws — a failed e-mail must never break the flow
 * that triggered it (auth redirect, payment webhook, campaign finalize).
 */

import supabaseAdmin from "@/supabase/admin"
import { signEmail } from "@/lib/email-sign"
import { isMediumType, type MediumType } from "@/lib/credits"
import { parsePostMedia } from "@/lib/media-urls"

/**
 * Základ pro všechny generované odkazy (odhlášení, deep linky, ukázky).
 *
 * Dvě pasti, obě chycené naostro 2026-08-11:
 *
 *  1. **Zástupný text projde `||`.** V `.env.local` bylo `[SENSITIVE]` —
 *     neprázdný řetězec, takže se použil a všechny odkazy vedly na
 *     `[SENSITIVE]/...`. Stejná chyba jako `[SET_ME]` u HikerAPI klíče.
 *  2. **`chrlit.cz` přesměrovává na `www.chrlit.cz` (308).** Prohlížeč to
 *     přežije, STROJ ne — Stripe webhooky přesměrování nenásledují, takže
 *     platba prošla a plán se neaktivoval. Výchozí hodnota je proto kanonická.
 */
export function siteUrl(): string {
    const v = (process.env.NEXT_PUBLIC_SITE_URL || "").trim()
    const usable = v.startsWith("http") ? v.replace(/\/$/, "") : ""
    if (v && !usable) {
        console.warn(`⚠️ NEXT_PUBLIC_SITE_URL není URL ("${v.slice(0, 20)}") — používám výchozí doménu`)
    }
    return usable || "https://www.chrlit.cz"
}

/** Deep link into the studio: selects the project (?project=) and opens a tab (#hash). */
export function studioDeepLink(clientId: string, section: string = "calendar"): string {
    return `${siteUrl()}/dashboard/instagram?project=${encodeURIComponent(clientId)}#${section}`
}

/** Plain text (with optional inline HTML like links) → <p> blocks. */
function paragraphsHtml(body: string): string {
    return body
        .split(/\n{2,}/)
        .map(p => p.trim())
        .filter(Boolean)
        .map(p => `<p style="margin:0 0 16px;line-height:1.6">${p.replace(/\n/g, "<br/>")}</p>`)
        .join("")
}

function wrapBranded(subject: string, innerHtml: string, unsubscribeEmail?: string): string {
    const footer = unsubscribeEmail
        ? `Chrlit · <a href="${siteUrl()}/api/email/unsubscribe?e=${encodeURIComponent(unsubscribeEmail)}&s=${signEmail(unsubscribeEmail)}" style="color:#777">Odhlásit odběr</a>`
        : `Chrlit · chrlit.cz`
    return `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#050505;color:#fff;padding:32px;max-width:560px;margin:0 auto">
        <h1 style="font-size:20px;text-transform:uppercase;letter-spacing:-0.5px;margin:0 0 20px">${subject}</h1>
        <div style="color:#ddd;font-size:15px">${innerHtml}</div>
        <p style="color:#555;font-size:11px;margin-top:28px;border-top:1px solid #1a1a1a;padding-top:16px">
          ${footer}
        </p>
      </div>`
}

/** Branded dark template. With unsubscribeEmail → broadcast footer (unsubscribe link). */
export function renderBrandedEmail(subject: string, body: string, opts?: { unsubscribeEmail?: string }): string {
    return wrapBranded(subject, paragraphsHtml(body), opts?.unsubscribeEmail)
}

/** Owner e-mail resolution mirrors payments/create: user_clients owner → auth user. */
export async function getOwnerEmail(clientId: string): Promise<string | null> {
    const { data: link } = await supabaseAdmin
        .from("user_clients")
        .select("user_id")
        .eq("client_id", clientId)
        .eq("role", "owner")
        .limit(1)
        .maybeSingle()
    if (!link) return null
    const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(link.user_id)
    return user?.email || null
}

/**
 * Best-effort branded e-mail. `body` is plain text (double newline = paragraph,
 * inline HTML allowed); `html` bypasses the paragraph conversion for pre-built
 * inner markup (e.g. the campaign digest cards). Never throws.
 */
export async function sendNotification(opts: {
    to: string | null | undefined
    subject: string
    body?: string
    html?: string
    kind: "transactional" | "notification"
}): Promise<void> {
    const to = opts.to?.trim().toLowerCase()
    if (!to) return
    try {
        if (opts.kind === "notification") {
            const { data: optedOut } = await supabaseAdmin
                .from("email_optouts")
                .select("email")
                .eq("email", to)
                .maybeSingle()
            if (optedOut) return
        }
        const inner = opts.html ?? paragraphsHtml(opts.body || "")
        const html = wrapBranded(opts.subject, inner, opts.kind === "notification" ? to : undefined)
        const { sendEmail } = await import("@/lib/email")
        await sendEmail({ to, subject: opts.subject, html })
    } catch (err: any) {
        console.warn(`notifications: e-mail to ${to} failed: ${err?.message}`)
    }
}

// ── Campaign digest ─────────────────────────────────────────────────────────

export interface CampaignDigestPost {
    id: string
    caption: string | null
    hashtags: string[] | null
    scheduled_for: string | null
    time_slot: string | null
    media_type: string | null
    image_url: string | null
}

/**
 * Posts generated by a campaign. There is no campaign_id on ig_posts — the
 * linkage is ig_jobs.config.campaignId → ig_jobs.result.postId → ig_posts.
 */
export async function getCampaignPosts(campaignId: string, clientId: string): Promise<CampaignDigestPost[]> {
    const { data: jobs } = await supabaseAdmin
        .from("ig_jobs")
        .select("result")
        .eq("client_id", clientId)
        .eq("status", "done")
        .eq("config->>campaignId", campaignId)
    const postIds = (jobs || [])
        .map(j => (j.result as any)?.postId)
        .filter((id): id is string => Boolean(id))
    if (postIds.length === 0) return []

    const { data: posts } = await supabaseAdmin
        .from("ig_posts")
        .select("id, caption, hashtags, scheduled_for, time_slot, media_type, image_url")
        .eq("client_id", clientId)
        .in("id", postIds)
    return (posts || []).sort((a, b) => {
        if (!a.scheduled_for) return 1
        if (!b.scheduled_for) return -1
        return a.scheduled_for.localeCompare(b.scheduled_for)
    })
}

const DIGEST_MAX_CARDS = 15       // keep the HTML safely under Gmail's ~102KB clip limit
const DIGEST_CAPTION_CHARS = 300

export function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function truncateAtWord(s: string, max: number): string {
    if (s.length <= max) return s
    const cut = s.slice(0, max)
    const lastSpace = cut.lastIndexOf(" ")
    return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…"
}

/** Typed on MediumType so a new medium is a build error here, not a silent
 *  "📷 Příspěvek" in every customer's campaign digest. */
const MEDIA_LABELS: Record<MediumType, string> = {
    image: "📷 Obrázek",
    story: "📱 Story",
    carousel: "🖼️ Carousel",
    reel: "🎬 Reel",
}

function formatScheduled(post: CampaignDigestPost): string {
    if (!post.scheduled_for) return "termín neurčen"
    try {
        return new Intl.DateTimeFormat("cs-CZ", {
            timeZone: "Europe/Prague",
            weekday: "short", day: "numeric", month: "numeric",
            hour: "2-digit", minute: "2-digit",
        }).format(new Date(post.scheduled_for))
    } catch {
        return post.scheduled_for
    }
}

/**
 * Per-post cards (scheduled time · type · thumbnail · caption preview · hashtags)
 * + intro + one CTA. Returns INNER html — send via sendNotification({ html }).
 */
export function renderCampaignDigest(
    posts: CampaignDigestPost[],
    opts: { intro: string; ctaUrl: string; ctaLabel: string },
): string {
    const cards = posts.slice(0, DIGEST_MAX_CARDS).map(post => {
        const typeLabel = (isMediumType(post.media_type) && MEDIA_LABELS[post.media_type]) || "📷 Příspěvek"
        // image_url is pipe-joined (carousel slides / story frames / reel video|cover) —
        // parsePostMedia picks the one URL that is safe to put in an <img>.
        const thumb = parsePostMedia(post.image_url, post.media_type).thumbUrl
        const caption = truncateAtWord((post.caption || "").trim(), DIGEST_CAPTION_CHARS)
        const hashtags = (post.hashtags || []).filter(Boolean)
            .map(h => (h.startsWith("#") ? h : `#${h}`)).join(" ")
        return `
        <div style="border:1px solid #1a1a1a;border-radius:4px;padding:14px;margin:0 0 12px;background:#0a0a0a">
          <p style="margin:0 0 10px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px">${escapeHtml(formatScheduled(post))} · ${typeLabel}</p>
          ${thumb ? `<img src="${thumb}" alt="" width="120" style="display:block;max-width:120px;border-radius:4px;margin:0 0 10px" />` : ""}
          <p style="margin:0;font-size:13px;line-height:1.55;color:#ddd;white-space:pre-wrap">${escapeHtml(caption)}</p>
          ${hashtags ? `<p style="margin:8px 0 0;font-size:12px;color:#8fb4ff">${escapeHtml(hashtags)}</p>` : ""}
        </div>`
    }).join("")

    const more = posts.length > DIGEST_MAX_CARDS
        ? `<p style="margin:0 0 16px;font-size:13px;color:#888">…a dalších ${posts.length - DIGEST_MAX_CARDS} příspěvků najdete v aplikaci.</p>`
        : ""
    const cta = `<p style="margin:20px 0 0"><a href="${opts.ctaUrl}" style="display:inline-block;background:#e5533f;color:#fff;text-decoration:none;font-weight:bold;font-size:13px;padding:12px 20px;border-radius:4px">${opts.ctaLabel}</a></p>`

    return `${paragraphsHtml(opts.intro)}${cards}${more}${cta}`
}
