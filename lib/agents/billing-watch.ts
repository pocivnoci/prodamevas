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
import { renewalNoticeDays, resolveTermMonths } from "@/lib/billing-period"
import { normalizeTermMonths, termPrice, termLabel } from "@/lib/pricing"

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Nejdelší předstih, jaký kterékoli období vyžaduje — jen tak široce se hledá
 * v DB. Který řádek se skutečně ohlásí, rozhoduje `renewalNoticeDays` podle
 * jeho vlastního období.
 */
const MAX_NOTICE_DAYS = 30

export interface UpcomingRenewal {
    subscriptionId: string
    clientId: string
    clientName: string
    periodEnd: string
    amountHaleru: number
    /** Délka obnovovaného období v měsících — do textu oznámení. */
    termMonths: number
    /** Obnova se strhne sama (uložený token u ComGate, nebo Stripe Billing). */
    auto: boolean
}

/**
 * Předplatná, kterým končí zaplacené období dřív, než dovolí jejich předstih.
 *
 * Předstih není konstanta: měsíční obnovu stačí ohlásit tři dny dopředu, ale
 * strh 19 900 Kč tři dny dopředu je pozvánka na chargeback — roční zákazník
 * potřebuje měsíc, aby stihl zrušit rozmyslem, ne reklamací.
 *
 * Vypovězená se vynechávají — komu jsme slíbili, že skončí, tomu nepíšeme,
 * že mu strhneme peníze.
 */
export async function scanUpcomingRenewals(now: Date = new Date()): Promise<UpcomingRenewal[]> {
    const { isRecurringEnabled, isMockPaymentMode } = await import("@/lib/comgate")

    const { data: subs } = await supabaseAdmin
        .from("subscriptions")
        .select("id, client_id, plan_id, current_period_end, recurring_trans_id, term_months, provider, clients(id, name)")
        .eq("status", "active")
        .eq("cancel_at_period_end", false)
        .gte("current_period_end", now.toISOString())
        .lte("current_period_end", new Date(now.getTime() + MAX_NOTICE_DAYS * DAY_MS).toISOString())
        .limit(200)

    if (!subs || subs.length === 0) return []

    // Plánů je hrstka — jeden dotaz místo N joinů.
    const { data: plans } = await supabaseAdmin
        .from("subscription_plans")
        .select("id, price_czk, interval")
    const planOf = new Map((plans || []).map(p => [p.id, p]))

    const comgateAuto = isRecurringEnabled() && !isMockPaymentMode()

    const out: UpcomingRenewal[] = []
    for (const s of subs) {
        const client = (Array.isArray(s.clients) ? s.clients[0] : s.clients) as { id: string; name: string } | null
        if (!client || !s.client_id || !s.current_period_end) continue

        const plan = planOf.get(s.plan_id)
        if (!plan?.price_czk) continue

        const termMonths = resolveTermMonths(plan.interval, s.term_months)
        // Předstih patří tomuhle konkrétnímu období — širší dotaz výš by jinak
        // měsíčním zákazníkům psal měsíc dopředu.
        const msLeft = new Date(s.current_period_end).getTime() - now.getTime()
        if (msLeft > renewalNoticeDays(termMonths) * DAY_MS) continue

        // Oznamuje se to, co se skutečně strhne — cena OBDOBÍ, ne měsíční sazba.
        const amount = termPrice(plan.price_czk, normalizeTermMonths(termMonths))
        // Nulová cena = trial nebo legacy plán; není co oznamovat.
        if (amount <= 0) continue

        out.push({
            subscriptionId: s.id,
            clientId: s.client_id,
            clientName: client.name,
            periodEnd: s.current_period_end,
            amountHaleru: amount,
            termMonths,
            // Stripe Billing obnovuje vždy sám; u ComGate jen s uloženým tokenem.
            auto: s.provider === "stripe" || (Boolean(s.recurring_trans_id) && comgateAuto),
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
                    // Aby v e-mailu stálo „na dalších 12 měsíců", ne jen částka.
                    termLabel: termLabel(normalizeTermMonths(r.termMonths)),
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
