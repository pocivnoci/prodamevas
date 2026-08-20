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
import { isMediumType, type MediumType } from "@/lib/credits"
import { parsePostMedia } from "@/lib/media-urls"
import { renderEmail, type MailKind } from "@/lib/mail/layout"
import {
    button, cards, compact, heading, paragraph, raw,
    type Block, type CardItem,
} from "@/lib/mail/blocks"
import { htmlToText } from "@/lib/mail/render-text"
import { TYPE } from "@/lib/mail/tokens"

// Odkazy a escapování se přestěhovaly do lib/mail/links.ts, aby na ně dosáhly
// i cesty, které na transakční poštu sáhnout nesmějí. Re-export tu zůstává,
// takže všech devět importérů `@/lib/notifications` běží beze změny.
export { siteUrl, studioDeepLink, escapeHtml, unsubscribeUrl } from "@/lib/mail/links"

/** Plain text (with optional inline HTML like links) → <p> blocks. */
function paragraphsHtml(body: string): string {
    return body
        .split(/\n{2,}/)
        .map(p => p.trim())
        .filter(Boolean)
        .map(p => `<p style="${TYPE.body};margin:0 0 16px">${p.replace(/\n/g, "<br/>")}</p>`)
        .join("")
}

/**
 * Most pro starší volající. `body` je text s **povoleným inline HTML**, `html`
 * je hotový vnitřek. Obojí se zabalí do jednoho `raw` bloku, takže slupka
 * existuje jen jedna a nová šablona se dá psát v blocích, aniž by se muselo
 * naráz přepsat všech deset odesílacích míst.
 *
 * Předmět se přidává jako nadpis — dřív ho vypisovala slupka sama a bez něj by
 * každá stávající zpráva o titulek přišla.
 */
function legacyBlocks(subject: string, opts: { html?: string; body?: string }): Block[] {
    const inner = opts.html ?? paragraphsHtml(opts.body || "")
    // Text se odvozuje z `body`, ne z vygenerovaného HTML — je v něm míň šumu
    // a odkazy se z něj rozbalí i s adresou.
    const text = htmlToText(opts.body ?? inner)
    return [heading(subject, 1), raw(inner, text)]
}

/** Branded template. With unsubscribeEmail → broadcast footer (unsubscribe link). */
export function renderBrandedEmail(subject: string, body: string, opts?: { unsubscribeEmail?: string }): string {
    return renderBrandedEmailParts(subject, body, opts).html
}

/** Jako `renderBrandedEmail`, ale i s textovou částí — broadcast ji má posílat taky. */
export function renderBrandedEmailParts(
    subject: string,
    body: string,
    opts?: { unsubscribeEmail?: string },
): { html: string; text: string } {
    return renderEmail({
        subject,
        blocks: legacyBlocks(subject, { body }),
        kind: opts?.unsubscribeEmail ? "notification" : "transactional",
        unsubscribeEmail: opts?.unsubscribeEmail,
    })
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
 * Best-effort branded e-mail. Přednost `blocks → html → body`:
 *  - `blocks` — typované bloky, renderují HTML i text. Tudy má chodit nové.
 *  - `html` — hotový vnitřek (digest). Legacy.
 *  - `body` — text s povoleným inline HTML, prázdný řádek = odstavec. Legacy.
 *
 * Never throws.
 */
export async function sendNotification(opts: {
    to: string | null | undefined
    subject: string
    blocks?: Block[]
    body?: string
    html?: string
    /** Řádek vedle předmětu ve schránce. Bez něj se odvodí z prvního odstavce. */
    preheader?: string
    /** Ruční override textové části. Jinak se odvodí z bloků. */
    text?: string
    kind: MailKind
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
        const { html, text } = renderEmail({
            subject: opts.subject,
            preheader: opts.preheader,
            blocks: opts.blocks ?? legacyBlocks(opts.subject, opts),
            kind: opts.kind,
            unsubscribeEmail: opts.kind === "notification" ? to : undefined,
        })
        const { sendEmail } = await import("@/lib/email")
        // Prázdný řetězec by Resend poslal jako skutečnou prázdnou textovou část
        // a část klientů pak ukáže prázdnou zprávu místo HTML verze.
        await sendEmail({ to, subject: opts.subject, html, text: opts.text?.trim() || text || undefined })
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
 * + intro + one CTA. Vrací **bloky** — pošli přes `sendNotification({ blocks })`.
 *
 * Dřív to bylo hotové HTML s vlastními tmavými kartami a CTA v odstínu
 * `#e5533f`, který se s brandovým `#e63946` rozešel. Přes bloky drží digest
 * tentýž vzhled jako zbytek pošty a textovou verzi dostane zadarmo.
 */
export function renderCampaignDigest(
    posts: CampaignDigestPost[],
    opts: { intro: string; ctaUrl: string; ctaLabel: string },
): Block[] {
    const items: CardItem[] = posts.slice(0, DIGEST_MAX_CARDS).map(post => {
        const typeLabel = (isMediumType(post.media_type) && MEDIA_LABELS[post.media_type]) || "📷 Příspěvek"
        // image_url is pipe-joined (carousel slides / story frames / reel video|cover) —
        // parsePostMedia picks the one URL that is safe to put in an <img>.
        const thumb = parsePostMedia(post.image_url, post.media_type).thumbUrl
        const caption = truncateAtWord((post.caption || "").trim(), DIGEST_CAPTION_CHARS)
        const hashtags = (post.hashtags || []).filter(Boolean)
            .map(h => (h.startsWith("#") ? h : `#${h}`)).join(" ")
        return {
            meta: `${formatScheduled(post)} · ${typeLabel}`,
            text: [caption, hashtags].filter(Boolean).join("\n\n"),
            imageUrl: thumb || undefined,
        }
    })

    return compact([
        ...opts.intro.split(/\n{2,}/).map(p => p.trim()).filter(Boolean).map(paragraph),
        cards(items),
        posts.length > DIGEST_MAX_CARDS &&
            paragraph(`…a dalších ${posts.length - DIGEST_MAX_CARDS} příspěvků najdete v aplikaci.`),
        button(opts.ctaLabel, opts.ctaUrl),
    ])
}
