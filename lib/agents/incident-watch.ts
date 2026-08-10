/**
 * Tichý support — produkt se přiznává sám.
 * =========================================
 * Většina supportních dotazů není otázka, ale chyba, kterou produkt neuměl
 * vysvětlit. „Proč mi včera nevyšel příspěvek?" je e-mail, který nemusel
 * vzniknout, kdyby to produkt řekl první. Nejlepší support agent je ten,
 * který nemá co dělat.
 *
 * **Dělicí čára: hlásí se jen selhání na pozadí, u kterých zákazník nebyl.**
 * Když si někdo klikne na generování a rozbije se to, UI mu to ukáže hned —
 * poslat k tomu ještě e-mail znamená říct totéž dvakrát a naučit ho naše
 * zprávy ignorovat.
 *
 * Dvě pasti, kvůli kterým je scanner konzervativnější, než by se čekalo:
 *  1. `campaign-worker` značí **odložené** joby taky jako `failed`
 *     (agent_message „⏸️ Odloženo — velký provoz"). To není selhání, to je
 *     fronta; e-mail o tom by byl lež.
 *  2. Kampaň umí job zopakovat v dalším ticku. Proto se generační selhání
 *     hlásí až po `GENERATION_SETTLE_HOURS` — do té doby se to nejspíš samo
 *     spraví a mlčet je správně.
 */

import supabaseAdmin from "@/supabase/admin"
import { proposeCustomerNotice, type NoticeKind } from "@/lib/agents/customer-notices"

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** Publisher to vzdává po tolika pokusech (MAX_ATTEMPTS v ig-publisher). */
const PUBLISH_MAX_ATTEMPTS = 4
/** Kolik hodin se čeká, než se generační selhání označí za konečné. */
const GENERATION_SETTLE_HOURS = 6
/** Starší trosky se neřeší — jinak by první běh rozeslal historii. */
const LOOKBACK_DAYS = 7
const MAX_PER_RUN = 25

export interface Incident {
    clientId: string
    kind: Extract<NoticeKind, "generation_failed" | "publish_failed">
    /** Id postu/jobu — zároveň dedupe klíč, takže jeden incident = jeden e-mail. */
    ref: string
    what: string
    reason: string | null
}

/** Technickou hlášku na jednu srozumitelnou větu. Zákazník nechce stack trace. */
function humanReason(raw: string | null | undefined): string | null {
    if (!raw) return null
    const s = String(raw)
    if (/token|oauth|expired|permission|OAuthException/i.test(s)) return "vypršelo propojení s Instagramem"
    if (/rate limit|quota|429/i.test(s)) return "Instagram dočasně omezil počet požadavků"
    if (/aspect|ratio|size|dimension/i.test(s)) return "formát média neprošel kontrolou Instagramu"
    if (/timeout|ETIMEDOUT|ECONNRESET/i.test(s)) return "spojení vypršelo"
    return null
}

function czDate(iso: string | null): string {
    if (!iso) return ""
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" })
}

/**
 * Naplánovaný příspěvek, který publisher vzdal. Nejednoznačný případ tu není:
 * `failed` po vyčerpání pokusů je konečný stav a zákazník u toho nebyl.
 */
async function findPublishFailures(now: Date): Promise<Incident[]> {
    const { data } = await supabaseAdmin
        .from("ig_posts")
        .select("id, client_id, scheduled_for, publish_error, publish_attempts, updated_at")
        .eq("status", "failed")
        .gte("publish_attempts", PUBLISH_MAX_ATTEMPTS)
        .gte("updated_at", new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS).toISOString())
        .limit(MAX_PER_RUN)

    return (data || [])
        .filter(p => p.client_id)
        .map(p => ({
            clientId: p.client_id as string,
            kind: "publish_failed" as const,
            ref: p.id,
            what: `Příspěvek plánovaný na ${czDate(p.scheduled_for) || "tento týden"}`,
            reason: humanReason(p.publish_error),
        }))
}

/**
 * Generační selhání uvnitř kampaně nebo plánu — tedy práce na pozadí.
 * Interaktivní generování (bez `campaignId`) se úmyslně vynechává: tam chybu
 * ukázalo UI v reálném čase.
 */
async function findGenerationFailures(now: Date): Promise<Incident[]> {
    const { data } = await supabaseAdmin
        .from("ig_jobs")
        .select("id, client_id, config, error, agent_message, created_at")
        .eq("status", "failed")
        .not("config->>campaignId", "is", null)
        .lte("created_at", new Date(now.getTime() - GENERATION_SETTLE_HOURS * HOUR_MS).toISOString())
        .gte("created_at", new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS).toISOString())
        .limit(MAX_PER_RUN)

    return (data || [])
        .filter(j => {
            if (!j.client_id) return false
            // Odložený job není selhaný job — viz past č. 1 v hlavičce.
            const msg = String(j.agent_message || "")
            return !msg.includes("⏸️") && !/odlož/i.test(msg)
        })
        .map(j => ({
            clientId: j.client_id as string,
            kind: "generation_failed" as const,
            ref: j.id,
            what: "Jeden příspěvek z naplánované kampaně",
            reason: humanReason(j.error),
        }))
}

export async function scanIncidents(now: Date = new Date()): Promise<Incident[]> {
    const groups = await Promise.all([
        findPublishFailures(now).catch(() => [] as Incident[]),
        findGenerationFailures(now).catch(() => [] as Incident[]),
    ])
    return groups.flat()
}

/** Rozešle oznámení o incidentech. Dedupe klíč = id postu/jobu → jeden e-mail navždy. */
export async function notifyIncidents(now: Date = new Date()): Promise<{ notified: number; duplicates: number; found: number }> {
    const incidents = await scanIncidents(now)
    let notified = 0
    let duplicates = 0

    for (const inc of incidents) {
        try {
            const outcome = await proposeCustomerNotice({
                clientId: inc.clientId,
                kind: inc.kind,
                dedupeKey: inc.ref,
                vars: { clientId: inc.clientId, what: inc.what, reason: inc.reason },
            })
            if (outcome === "sent") notified++
            else if (outcome === "duplicate") duplicates++
        } catch (err: any) {
            console.warn(`incident-watch: oznámení pro ${inc.clientId} selhalo: ${err?.message}`)
        }
    }
    return { notified, duplicates, found: incidents.length }
}
