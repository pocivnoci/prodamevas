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
 * Zruší předplatné u Stripu OKAMŽITĚ, ne ke konci období.
 *
 * Tohle je pro **změnu tarifu**, ne pro výpověď. Rozdíl je zásadní: výpověď
 * nechává zaplacené období doběhnout (`cancel_at_period_end`), kdežto při
 * přechodu na jiný tarif nové předplatné začíná HNED a zbytek starého období
 * propadá (`activatePaidPlan`, bez proration). Kdyby se staré předplatné rušilo
 * až ke konci období, Stripe by za ně mezitím vystavil ještě jednu fakturu —
 * zákazník by platil dva tarify najednou.
 *
 * `customer.subscription.deleted` se vrátí webhookem a `expireStripeSubscription`
 * na něm neudělá nic navíc: náš řádek je v tu chvíli už `cancelled`, a ten
 * podmíněný UPDATE bere jen živé stavy.
 *
 * Neexistující předplatné (ručně smazané, jiné prostředí) není chyba — vrací
 * `false`, protože cílový stav „u brány neběží" už platí.
 */
export async function cancelStripeSubscriptionNow(stripeSubscriptionId: string): Promise<boolean> {
    if (!isStripeConfigured()) throw new Error("Stripe není nakonfigurovaná")
    try {
        await getStripe().subscriptions.cancel(stripeSubscriptionId)
        return true
    } catch (err: any) {
        // 404 = u brány už neexistuje. Cílového stavu je dosaženo jinou cestou.
        if (err?.statusCode === 404 || err?.code === "resource_missing") return false
        throw err
    }
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
 * Vrátí peníze u Stripu k platbě, kterou známe pod `payments.provider_ref`.
 *
 * `provider_ref` je podle fáze buď id Checkout Session (první platba), nebo id
 * faktury (obnova) — viz `PaymentLocator` v `on-paid.ts`. Obojí se musí přeložit
 * na platební záměr, protože refundovat jde jen ten.
 *
 * Čtení je **záměrně obranné**: Stripe mezi verzemi API stěhuje, kde platební
 * záměr na faktuře leží (stejně jako to udělal s `subscription`). Číst víc míst
 * je levnější než tichá ztráta schopnosti vracet peníze po upgradu verze.
 *
 * Částka se předává **explicitně**, i když jde o celou platbu: kdyby se u brány
 * lišila (jiná měna, částečná platba), plná refundace bez částky by vrátila
 * jiné peníze, než jaké má náš doklad.
 *
 * Dvojímu vrácení brání podmíněný claim `PAID → REFUNDED` u volajícího — sem se
 * tahle funkce podruhé nedostane.
 */
export async function refundStripePayment(providerRef: string, amountHaleru: number): Promise<string> {
    if (!isStripeConfigured()) throw new Error("Stripe není nakonfigurovaná")
    const stripe = getStripe()

    /** Vytáhne id platebního záměru z faktury napříč verzemi API. */
    const intentOfInvoice = (inv: any): string | null => {
        const direct = inv?.payment_intent
        if (typeof direct === "string") return direct
        if (direct?.id) return direct.id
        // Novější verze drží platby v poli; bereme první uhrazenou.
        const fromPayments = inv?.payments?.data?.[0]?.payment?.payment_intent
        if (typeof fromPayments === "string") return fromPayments
        return fromPayments?.id ?? null
    }

    let intentId: string | null = null

    if (providerRef.startsWith("cs_")) {
        const session: any = await stripe.checkout.sessions.retrieve(providerRef)
        intentId = typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id ?? null
        // Předplatné neplatí Session, ale její první faktura.
        if (!intentId && session.invoice) {
            const invoiceId = typeof session.invoice === "string" ? session.invoice : session.invoice?.id
            if (invoiceId) intentId = intentOfInvoice(await stripe.invoices.retrieve(invoiceId))
        }
    } else if (providerRef.startsWith("in_")) {
        intentId = intentOfInvoice(await stripe.invoices.retrieve(providerRef))
    } else if (providerRef.startsWith("pi_")) {
        intentId = providerRef
    }

    if (!intentId) {
        throw new Error(`k ${providerRef} se nepodařilo najít platební záměr`)
    }

    const refund = await stripe.refunds.create({
        payment_intent: intentId,
        amount: amountHaleru,
        reason: "requested_by_customer",
    })
    return refund.id
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
