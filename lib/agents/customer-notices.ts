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
import { siteUrl, studioDeepLink } from "@/lib/notifications"

export type NoticeKind =
    | "renewal_upcoming"
    | "charge_failed"
    | "manual_renew"
    | "expired"
    | "payment_recovered"
    | "generation_failed"
    | "publish_failed"

export interface NoticeVars {
    clientName?: string | null
    clientId?: string | null
    /** Haléře — formátuje se až v šabloně, nikdy se nepočítá v korunách. */
    amountHaleru?: number | null
    /** Datum česky, např. „3. 9. 2026". */
    date?: string | null
    /** Automatické stržení (má uložený token) vs. ruční obnova. */
    auto?: boolean
    /** Kolikátý pokus dunningu (1–3). */
    attempt?: number
    /** Čeho se incident týká — „příspěvek plánovaný na 12. 8.". */
    what?: string | null
    /** Délka obnovovaného období, česky — „na 12 měsíců". */
    termLabel?: string | null
    /** Proč to selhalo, jednou větou a bez technikálií. */
    reason?: string | null
}

const KIND_LABELS: Record<NoticeKind, string> = {
    renewal_upcoming: "Blíží se obnova",
    charge_failed: "Platba selhala",
    manual_renew: "Ruční obnova",
    expired: "Předplatné vypršelo",
    payment_recovered: "Platba se podařila",
    generation_failed: "Generování selhalo",
    publish_failed: "Publikace selhala",
}

const APP_URL = () => siteUrl()
const link = (clientId: string | null | undefined, section: string) =>
    clientId ? studioDeepLink(clientId, section) : `${APP_URL()}/dashboard/instagram`

const czk = (haleru?: number | null) =>
    typeof haleru === "number" ? `${Math.round(haleru / 100).toLocaleString("cs-CZ")} Kč` : "částku dle plánu"

// ── Šablony ─────────────────────────────────────────────────────────────────

export function buildCustomerNotice(kind: NoticeKind, vars: NoticeVars): { subject: string; body: string } {
    const name = vars.clientName || "váš účet"
    const sub = link(vars.clientId, "subscription")
    const cal = link(vars.clientId, "calendar")

    switch (kind) {
        case "renewal_upcoming": {
            // Předmět nesmí tvrdit „za 3 dny": u víceměsíčního období chodí
            // upozornění měsíc dopředu (renewalNoticeDays), protože nečekaných
            // 19 900 Kč na výpisu je nejlevnější cesta k chargebacku.
            const term = vars.termLabel ? ` ${vars.termLabel}` : ""
            return vars.auto
                ? {
                    subject: vars.date ? `Připomínka: předplatné se obnoví ${vars.date}` : "Připomínka: předplatné se brzy obnoví",
                    body: `Dobrý den,

${vars.date ? `<strong>${vars.date}</strong> ` : "Brzy "}vám automaticky strhneme <strong>${czk(vars.amountHaleru)}</strong> za předplatné${term} pro <strong>${name}</strong>. Nemusíte nic dělat — píšeme jen proto, abyste to na výpisu čekali.

Pokud si přejete plán změnit nebo zrušit, stihnete to do té doby:

<a href="${sub}">Spravovat předplatné →</a>

Tým Chrlit`,
                }
                : {
                    subject: vars.date ? `Předplatné končí ${vars.date}` : "Předplatné brzy končí",
                    body: `Dobrý den,

předplatné pro <strong>${name}</strong> končí ${vars.date ? `<strong>${vars.date}</strong>` : "brzy"}. Nemáme uloženou kartu, takže se automaticky neobnoví — aby generování příspěvků nepřestalo, obnovte plán prosím ručně:

<a href="${sub}">Obnovit předplatné →</a>

Tým Chrlit`,
                }
        }

        case "charge_failed":
            return {
                subject: "Platba za Chrlit se nezdařila",
                body: `Dobrý den,

automatická platba za předplatné <strong>${name}</strong> se nezdařila${vars.attempt ? ` (pokus ${vars.attempt}/3)` : ""}. Zkusíme to znovu zítra — zkontrolujte prosím platební kartu, případně obnovte plán ručně:

<a href="${sub}">Zkontrolovat předplatné →</a>

Tým Chrlit`,
            }

        case "manual_renew":
            return {
                subject: "Obnovte si předplatné Chrlit",
                body: `Dobrý den,

předplatné pro <strong>${name}</strong> právě doběhlo. Aby generování příspěvků pokračovalo bez přerušení, obnovte si prosím plán jedním kliknutím:

<a href="${sub}">Obnovit předplatné →</a>

Tým Chrlit`,
            }

        case "expired":
            return {
                subject: "Vaše předplatné Chrlit vypršelo",
                body: `Dobrý den,

předplatné pro <strong>${name}</strong> vypršelo. Vaše data, značka i naučené preference zůstávají zachovány; generování se znovu spustí hned po obnovení plánu:

<a href="${sub}">Obnovit předplatné →</a>

Tým Chrlit`,
            }

        case "payment_recovered":
            return {
                subject: "Platba prošla — vše je zase v pořádku",
                body: `Dobrý den,

platba za <strong>${name}</strong> se nakonec podařila a předplatné pokračuje bez přerušení. Nic dalšího dělat nemusíte.

<a href="${sub}">Zobrazit předplatné →</a>

Tým Chrlit`,
            }

        // ── Tichý support: produkt se přiznává sám ───────────────────────────
        // Zákazník u toho nebyl, takže se to jinak nedozví — a co se nedozví,
        // na to se druhý den ptá e-mailem. Levnější je říct to první.
        case "generation_failed":
            return {
                subject: "Jeden příspěvek se nepodařilo vygenerovat",
                body: `Dobrý den,

${vars.what ? `<strong>${vars.what}</strong> se` : "Jeden z naplánovaných příspěvků pro <strong>" + name + "</strong> se"} nepodařilo vygenerovat.${vars.reason ? ` Důvod: ${vars.reason}.` : ""}

Zkusíme to automaticky znovu při dalším běhu — dělat nemusíte nic. Pokud se to zopakuje, ozveme se sami.

<a href="${cal}">Zobrazit kalendář →</a>

Tým Chrlit`,
            }

        case "publish_failed":
            return {
                subject: "Naplánovaný příspěvek se nepodařilo publikovat",
                body: `Dobrý den,

${vars.what ? `<strong>${vars.what}</strong>` : `naplánovaný příspěvek pro <strong>${name}</strong>`} se nepodařilo publikovat na Instagram ani po opakovaných pokusech.${vars.reason ? ` Důvod: ${vars.reason}.` : ""}

Příspěvek je hotový a čeká v kalendáři — nejčastější příčinou je odpojený nebo vypršelý účet Instagramu. Stačí ho znovu připojit a příspěvek pustit:

<a href="${cal}">Otevřít kalendář →</a>

Tým Chrlit`,
            }
    }
}

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
        date: (payload.date as string) ?? null,
        auto: Boolean(payload.auto),
        attempt: typeof payload.attempt === "number" ? payload.attempt : undefined,
        what: (payload.what as string) ?? null,
        reason: (payload.reason as string) ?? null,
    })

    const { sendNotification } = await import("@/lib/notifications")
    await sendNotification({ to, subject, body, kind: "transactional" })
    return { ok: true, kind, to }
}
