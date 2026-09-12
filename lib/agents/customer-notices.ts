/**
 * Faktická pošta zákazníkovi — odchází sama, ale zůstává po ní stopa.
 * ===================================================================
 * Jeden modul pro všechno, co zákazníkovi *oznamujeme*: peníze (blíží se
 * stržení, platba selhala, předplatné končí) i provoz (naplánovaný příspěvek
 * nevyšel). Tvar zrcadlí `lifecycle.ts`, ale liší se v tom podstatném:
 *
 *   lifecycle.ts   → riskTier `outbound`      → PŘEMLOUVÁ  → čeká na člověka
 *   customer-notices → riskTier `transactional` → OZNAMUJE → odchází samo
 *
 * Zadržet fakturu nebo „za tři dny vám strhneme 1 490 Kč" do doby, než si někdo
 * vzpomene kliknout, je horší než to poslat. Ale i tak to jde přes
 * `requestAction`, ne přímo přes `sendNotification` — bez řádku v `agent_actions`
 * by nebyl dedupe klíč („neposílej dvakrát") ani zdroj pro sekci ranního briefu
 * „co jsem udělal sám".
 *
 * **Dedupe je klíčem, ne časovým oknem.** `dedupeKey` je to, co danou zprávu
 * dělá jedinečnou — konkrétní `periodEnd` u obnovy, číslo pokusu u dunningu, id
 * postu u incidentu. Časové okno by se s posunem cronu rozjelo; klíč je
 * replay-proof napořád, takže ruční curl ani redeploy nikoho nespamují.
 */

import supabaseAdmin from "@/supabase/admin"
import { requestAction } from "@/lib/agent-safety"
import { buildCustomerNotice, KIND_LABELS, type NoticeKind, type NoticeVars } from "@/lib/agents/notice-templates"

// Znění e-mailů žije v `notice-templates.ts` (čistá funkce, bez DB). Re-export
// tu zůstává, takže volající dál importují jedno místo.
export { buildCustomerNotice }
export type { NoticeKind, NoticeVars }

// ── Návrh (s dedupe) ────────────────────────────────────────────────────────

const DEDUPE_LOOKBACK_DAYS = 120

/**
 * Už jsme tuhle konkrétní zprávu tomuhle klientovi poslali? Dedupe se ptá
 * audit logu, ne paměti — takže přežije redeploy, ruční curl i retry fronty.
 */
async function alreadySent(clientId: string, kind: NoticeKind, dedupeKey: string): Promise<boolean> {
    try {
        const since = new Date(Date.now() - DEDUPE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
        const { count } = await supabaseAdmin
            .from("agent_actions")
            .select("id", { count: "exact", head: true })
            .eq("task_type", "send_customer_notice")
            .eq("client_id", clientId)
            .eq("payload->>kind", kind)
            .eq("payload->>dedupeKey", dedupeKey)
            .gte("created_at", since)
        return (count || 0) > 0
    } catch {
        // Rozbitý zdroj dedupe → raději neposlat než poslat dvakrát.
        return true
    }
}

export type ProposeOutcome = "sent" | "duplicate" | "no_recipient"

/**
 * Zaeviduje a (protože tier je `transactional`) rovnou odešle jedno oznámení.
 * `dedupeKey` musí být to, co zprávu jednoznačně určuje — konkrétní `periodEnd`,
 * číslo pokusu, id postu. Nikdy „dnešek".
 */
export async function proposeCustomerNotice(input: {
    clientId: string
    kind: NoticeKind
    email?: string | null
    dedupeKey: string
    vars?: NoticeVars
}): Promise<ProposeOutcome> {
    const { getOwnerEmail } = await import("@/lib/notifications")
    const to = (input.email || (await getOwnerEmail(input.clientId)))?.trim().toLowerCase()
    if (!to) return "no_recipient"

    if (await alreadySent(input.clientId, input.kind, input.dedupeKey)) return "duplicate"

    await requestAction({
        clientId: input.clientId,
        agentType: "billing",
        action: `${KIND_LABELS[input.kind]} → ${to}`,
        riskTier: "transactional",
        taskType: "send_customer_notice",
        payload: {
            kind: input.kind,
            email: to,
            dedupeKey: input.dedupeKey,
            ...(input.vars || {}),
        },
    })
    return "sent"
}

// ── Odeslání (handler `send_customer_notice`) ───────────────────────────────

/**
 * Tělo handleru. `sendNotification` schválně NEházi výjimku: selhaný e-mail
 * nesmí shodit task a spustit retry, který by ho poslal podruhé.
 */
export async function sendCustomerNotice(payload: Record<string, unknown>): Promise<{ ok: boolean; kind: string; to: string }> {
    const kind = String(payload.kind || "") as NoticeKind
    const to = String(payload.email || "").trim().toLowerCase()
    if (!to || !(kind in KIND_LABELS)) {
        throw new Error(`send_customer_notice: neplatný payload (kind=${payload.kind}, email=${payload.email})`)
    }

    const { subject, body } = buildCustomerNotice(kind, {
        clientName: (payload.clientName as string) ?? null,
        clientId: (payload.clientId as string) ?? null,
        amountHaleru: typeof payload.amountHaleru === "number" ? payload.amountHaleru : null,
        netHaleru: typeof payload.netHaleru === "number" ? payload.netHaleru : null,
        date: (payload.date as string) ?? null,
        auto: Boolean(payload.auto),
        attempt: typeof payload.attempt === "number" ? payload.attempt : undefined,
        what: (payload.what as string) ?? null,
        // Bez `termLabel` chyběla roční obnově ta nejdůležitější informace: že
        // strhávaná částka je za dvanáct měsíců, ne za měsíc. Do šablony se to
        // od začátku nepředávalo, takže věta v ní byla mrtvý kód.
        termLabel: (payload.termLabel as string) ?? null,
        reason: (payload.reason as string) ?? null,
        count: typeof payload.count === "number" ? payload.count : null,
    })

    const { sendNotification } = await import("@/lib/notifications")
    await sendNotification({ to, subject, body, kind: "transactional" })
    return { ok: true, kind, to }
}
