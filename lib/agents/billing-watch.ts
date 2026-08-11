/**
 * Oznámení dopředu — „za tři dny vám strhneme".
 * ==============================================
 * Do téhle chvíle byl první signál o penězích až DEN PO expiraci, z dunningu.
 * To je striktně horší než nic: zákazník se o platbě dozví teprve tím, že mu
 * něco přestalo fungovat, a nečekaná položka na výpisu je nejlevnější cesta
 * k chargebacku.
 *
 * Běží uvnitř `billing-worker` (ne v daily-ops): tenhle cron už seznam
 * předplatných má a je to sémanticky billing. Nový cron by přidal jen další
 * místo, kde se dá zapomenout.
 *
 * **Dedupe je konkrétní `periodEnd`, ne časové okno.** Okno by se s posunem
 * cronu rozjelo a poslalo druhý e-mail; klíč je replay-proof napořád, takže
 * ruční curl ani redeploy nikoho nespamují.
 */

import supabaseAdmin from "@/supabase/admin"
import { proposeCustomerNotice } from "@/lib/agents/customer-notices"
import { EXPIRING_SOON_DAYS } from "@/lib/billing-period"

const DAY_MS = 24 * 60 * 60 * 1000

export interface UpcomingRenewal {
    subscriptionId: string
    clientId: string
    clientName: string
    periodEnd: string
    amountHaleru: number
    /** Má uložený token a recurring je zapnuté → strhne se samo. */
    auto: boolean
}

/**
 * Předplatná, kterým do `EXPIRING_SOON_DAYS` končí zaplacené období.
 * Vypovězená se vynechávají — komu jsme slíbili, že skončí, tomu nepíšeme,
 * že mu strhneme peníze.
 */
export async function scanUpcomingRenewals(now: Date = new Date()): Promise<UpcomingRenewal[]> {
    const { isRecurringEnabled, isMockPaymentMode } = await import("@/lib/comgate")

    const { data: subs } = await supabaseAdmin
        .from("subscriptions")
        .select("id, client_id, plan_id, current_period_end, recurring_trans_id, clients(id, name)")
        .eq("status", "active")
        .eq("cancel_at_period_end", false)
        .gte("current_period_end", now.toISOString())
        .lte("current_period_end", new Date(now.getTime() + EXPIRING_SOON_DAYS * DAY_MS).toISOString())
        .limit(200)

    if (!subs || subs.length === 0) return []

    // Plánů je hrstka — jeden dotaz místo N joinů.
    const { data: plans } = await supabaseAdmin
        .from("subscription_plans")
        .select("id, price_czk")
    const priceOf = new Map((plans || []).map(p => [p.id, p.price_czk as number]))

    const autoCharging = isRecurringEnabled() && !isMockPaymentMode()

    const out: UpcomingRenewal[] = []
    for (const s of subs) {
        const client = (Array.isArray(s.clients) ? s.clients[0] : s.clients) as { id: string; name: string } | null
        if (!client || !s.client_id || !s.current_period_end) continue
        const amount = priceOf.get(s.plan_id) || 0
        // Nulová cena = trial nebo legacy plán; není co oznamovat.
        if (amount <= 0) continue

        out.push({
            subscriptionId: s.id,
            clientId: s.client_id,
            clientName: client.name,
            periodEnd: s.current_period_end,
            amountHaleru: amount,
            auto: Boolean(s.recurring_trans_id) && autoCharging,
        })
    }
    return out
}

function czDate(iso: string): string {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" })
}

/** Rozešle oznámení pro nadcházející obnovy. Vrací, kolik odešlo a kolik už bylo. */
export async function notifyUpcomingRenewals(now: Date = new Date()): Promise<{ notified: number; duplicates: number }> {
    const upcoming = await scanUpcomingRenewals(now)
    let notified = 0
    let duplicates = 0

    for (const r of upcoming) {
        try {
            const outcome = await proposeCustomerNotice({
                clientId: r.clientId,
                kind: "renewal_upcoming",
                // Klíčem je konkrétní konec období — ne dnešek.
                dedupeKey: r.periodEnd,
                vars: {
                    clientName: r.clientName,
                    clientId: r.clientId,
                    amountHaleru: r.amountHaleru,
                    date: czDate(r.periodEnd),
                    auto: r.auto,
                },
            })
            if (outcome === "sent") notified++
            else if (outcome === "duplicate") duplicates++
        } catch (err: any) {
            // Jeden rozbitý klient nesmí zabít zbytek běhu.
            console.warn(`billing-watch: oznámení pro ${r.clientId} selhalo: ${err?.message}`)
        }
    }
    return { notified, duplicates }
}
