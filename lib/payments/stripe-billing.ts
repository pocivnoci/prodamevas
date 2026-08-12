/**
 * Životní cyklus Stripe předplatného
 * ==================================
 * ComGate a Stripe se liší v jediné podstatné věci: **kdo iniciuje obnovu.**
 *
 *   ComGate — obnovu strhává NÁŠ cron (`/api/cron/billing-worker`) uloženým
 *             tokenem `subscriptions.recurring_trans_id`. Období si počítáme sami.
 *   Stripe  — obnovu si účtuje Stripe Billing sám podle `interval` /
 *             `interval_count` a jen pošle `invoice.paid`.
 *
 * Z toho plyne všechno ostatní v tomhle souboru: naše předplatné si musí
 * pamatovat, která brána ho pohání (`subscriptions.provider`) a pod jakým id ho
 * ta brána zná (`subscriptions.provider_ref`), cron musí Stripe předplatná
 * přeskočit (jinak dvojí platba) a zrušení se musí propsat OBĚMA směry.
 *
 * Tenhle modul je adaptér: sahá na Stripe API a na `subscriptions`, ale
 * **nesahá na `payments`** — od toho je `lib/payments/on-paid.ts`.
 */

import "server-only"
import supabaseAdmin from "@/supabase/admin"
import { getStripe, isStripeConfigured } from "./stripe"

/**
 * Propojí naše předplatné se Stripe objektem, který ho od teď pohání.
 *
 * Volá se z webhooku po `checkout.session.completed`. Bez tohohle kroku by obnova
 * (`invoice.paid`) neměla podle čeho najít, komu faktura patří — Checkout Session
 * u druhé a další faktury už neexistuje. Zapomenout na to znamená, že první
 * platba projde, roční obnova přijde na účet a v aplikaci po ní nezbyde nic.
 */
export async function linkStripeSubscription(paymentId: string, stripeSubscriptionId: string): Promise<void> {
    const { data: payment } = await supabaseAdmin
        .from("payments")
        .select("subscription_id")
        .eq("id", paymentId)
        .maybeSingle()
    if (!payment?.subscription_id) return

    await supabaseAdmin
        .from("subscriptions")
        .update({
            provider: "stripe",
            provider_ref: stripeSubscriptionId,
            updated_at: new Date().toISOString(),
        })
        .eq("id", payment.subscription_id)
}

/**
 * Zruší / obnoví předplatné i na straně Stripu.
 *
 * Naše `cancel_at_period_end` je jen záznam. Kdyby se nepropsal do Stripu, Stripe
 * by dál vystavoval faktury za období, které zákazník vypověděl — to je vrácení
 * peněz a stížnost, ne jen nekonzistentní stav.
 *
 * Výjimku **nepolyká**: volající ji musí ukázat, jinak zákazník uvidí „zrušeno"
 * a přijde mu další platba.
 */
export async function setStripeCancelAtPeriodEnd(stripeSubscriptionId: string, cancel: boolean): Promise<void> {
    if (!isStripeConfigured()) throw new Error("Stripe není nakonfigurovaná")
    await getStripe().subscriptions.update(stripeSubscriptionId, { cancel_at_period_end: cancel })
}

/**
 * Předplatné u brány definitivně skončilo (`customer.subscription.deleted`).
 *
 * Podmíněný zápis: expiruje se jen to, co ještě žije. Bez podmínky by pozdní
 * událost přepsala stav předplatného, které si zákazník mezitím znovu založil.
 */
export async function expireStripeSubscription(stripeSubscriptionId: string): Promise<boolean> {
    const now = new Date().toISOString()
    const { data } = await supabaseAdmin
        .from("subscriptions")
        .update({ status: "expired", cancelled_at: now, updated_at: now })
        .eq("provider", "stripe")
        .eq("provider_ref", stripeSubscriptionId)
        .in("status", ["active", "pending", "trialing"])
        .select("id")
        .maybeSingle()
    return Boolean(data)
}

/**
 * Stripe id předplatného klienta — pro zrušení a obnovení ze server action.
 * `null` znamená „tohle předplatné pohání ComGate", ne chybu.
 */
export async function getStripeSubscriptionRef(subscriptionId: string): Promise<string | null> {
    const { data } = await supabaseAdmin
        .from("subscriptions")
        .select("provider, provider_ref")
        .eq("id", subscriptionId)
        .maybeSingle()
    return data?.provider === "stripe" ? data.provider_ref : null
}
