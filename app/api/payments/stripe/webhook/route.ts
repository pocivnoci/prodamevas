/**
 * POST /api/payments/stripe/webhook
 *
 * Stripe webhook — ověří podpis a předá výsledek sdílenému jádru.
 *
 * Cesta je záměrně stejná jako u ComGate callbacku a **veškerá logika po claimu
 * je sdílená** (`lib/payments/on-paid.ts`) — druhá brána nesmí být druhé místo,
 * kde se zapomene na doklad. Routa sama nesahá na `payments` ani na
 * `subscriptions`; od toho jsou `applyGatewayStatus` / `applyProviderInvoice`
 * a adaptér `lib/payments/stripe-billing.ts`.
 *
 * Obsluhované události — celý životní cyklus, ne jen první platba:
 *
 *   checkout.session.completed   první platba: zabere PENDING řádek (lokátor =
 *                                id Session), aktivuje plán a PROPOJÍ naše
 *                                předplatné se Stripe objektem, který ho dál pohání
 *   invoice.paid                 obnova: Stripe Billing si období naúčtoval sám,
 *                                řádek v `payments` k ní zakládá jádro
 *   invoice.payment_failed       obnova neprošla → dunning (stejný čítač i
 *                                oznámení jako u ComGate)
 *   customer.subscription.deleted předplatné u brány skončilo → expirace
 *
 * ⚠️ Obnovy u Stripu **nejdou** přes `/api/cron/billing-worker`. Ten strhává
 *    ComGate tokenem a Stripe předplatná přeskakuje podle `subscriptions.provider`;
 *    kdyby to nedělal, zákazník zaplatí za jedno období dvakrát.
 *
 * Lokální test:
 *   stripe listen --forward-to localhost:3000/api/payments/stripe/webhook
 *   stripe trigger checkout.session.completed
 *   stripe trigger invoice.paid
 */

import { NextRequest } from "next/server"
import { verifyStripeWebhook, isStripeConfigured, isStripeSandbox } from "@/lib/payments/stripe"

/** Faktura z pohledu Stripu — jen pole, která tahle routa čte. */
type StripeInvoice = {
    id?: string
    subscription?: string | { id?: string } | null
    parent?: { subscription_details?: { subscription?: string | { id?: string } | null } | null } | null
    amount_paid?: number
    amount_due?: number
    currency?: string
    billing_reason?: string
}

/** `subscription` chodí jako id nebo jako rozbalený objekt — podle verze API a expandu. */
function refOf(v: string | { id?: string } | null | undefined): string | null {
    if (!v) return null
    return typeof v === "string" ? v : v.id || null
}

/**
 * Id předplatného na faktuře. Novější verze API ho stěhují pod
 * `parent.subscription_details.subscription`; starší ho mají rovnou na faktuře.
 * Číst obě místa je levnější než tichá ztráta obnovy po upgradu API verze.
 */
function subscriptionRefOf(invoice: StripeInvoice): string | null {
    return refOf(invoice.subscription) ?? refOf(invoice.parent?.subscription_details?.subscription)
}

export async function POST(req: NextRequest) {
    if (!isStripeConfigured()) {
        // Brána není zapnutá — 503 říká Stripu „zkus to znovu", ne „zahoď".
        return new Response("Stripe není nakonfigurovaná", { status: 503 })
    }

    // Syrové tělo, ne req.json() — podpis se počítá z bajtů.
    const rawBody = await req.text()
    const signature = req.headers.get("stripe-signature")

    let event
    try {
        event = verifyStripeWebhook(rawBody, signature)
    } catch (err: any) {
        // Neověřená událost se NIKDY nezpracovává a 400 je tu správně:
        // Stripe si ji označí jako selhanou a je to vidět v dashboardu.
        console.error(`🔒 Stripe webhook: neplatný podpis — ${err?.message}`)
        return new Response(`Neplatný podpis: ${err?.message}`, { status: 400 })
    }

    const mode = isStripeSandbox() ? "sandbox" : "LIVE"
    const { applyGatewayStatus, applyProviderInvoice } = await import("@/lib/payments/on-paid")

    // ── První platba ───────────────────────────────────────────────────────────
    if (event.type === "checkout.session.completed") {
        const session = event.data.object as { id?: string; payment_status?: string; subscription?: string | { id?: string } | null }
        const sessionId = session?.id
        if (!sessionId) {
            console.warn(`⚠️ [stripe/${mode}] ${event.id} bez session id`)
            return Response.json({ received: true, handled: false })
        }
        // Session může být "completed" i bez zaplacení (např. odložené metody).
        if (session.payment_status !== "paid") {
            console.log(`💳 [stripe/${mode}] session ${sessionId} completed, ale payment_status=${session.payment_status} — neaktivuji`)
            return Response.json({ received: true, handled: false })
        }

        // Podmíněný claim `WHERE provider='stripe' AND provider_ref=? AND status
        // NOT IN (PAID, REFUNDED)` žije ve sdíleném jádře, protože stejný UPDATE
        // potřebuje i ComGate callback a reconciler. Stripe posílá webhook
        // opakovaně, dokud nedostane 2xx, takže je to JEDINÁ pojistka proti dvojí
        // aktivaci a dvěma dokladům; claim bez řádku je konec, nikdy insert fallback.
        const result = await applyGatewayStatus({
            locator: { provider: "stripe", ref: sessionId },
            status: "PAID",
            raw: { source: "stripe", eventId: event.id, type: event.type, paymentStatus: session.payment_status },
            // Sandboxová platba nikdy nesmí sáhnout na ostrou číselnou řadu.
            sandbox: isStripeSandbox(),
            // Token pro obnovy si u Stripu drží brána sama (viz linkStripeSubscription).
            recurringToken: null,
            source: "webhook",
        })

        if (!result.claimed) {
            console.log(`💳 [stripe/${mode}] session ${sessionId} nic nezabrala — replay nebo neznámá platba`)
            return Response.json({ received: true, handled: false })
        }

        // Propojení musí proběhnout i tehdy, když aktivace selhala: bez něj by
        // obnova neměla podle čeho najít, komu faktura patří, a ruční oprava
        // aktivace by problém vyřešila jen do první obnovy.
        const stripeSubRef = refOf(session.subscription)
        if (stripeSubRef && result.paymentId) {
            const { linkStripeSubscription } = await import("@/lib/payments/stripe-billing")
            await linkStripeSubscription(result.paymentId, stripeSubRef)
        } else {
            console.warn(`⚠️ [stripe/${mode}] session ${sessionId} bez id předplatného — obnovy nebude podle čeho spárovat`)
        }

        if (!result.activated) {
            // Řádek zůstává PAID pro ruční opravu a jádro už založilo návrh s jedním
            // tlačítkem. 200, aby Stripe neopakoval něco, co se opakováním nespraví.
            console.error(`🚨 [stripe/${mode}] platba ${result.paymentId} zaplacena, ale plán se NEAKTIVOVAL`)
            return Response.json({ received: true, handled: false, activated: false })
        }

        console.log(`💳 [stripe/${mode}] ✅ platba ${result.paymentId} aktivována`)
        return Response.json({ received: true, handled: true })
    }

    // ── Obnova ────────────────────────────────────────────────────────────────
    if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
        const invoice = event.data.object as StripeInvoice
        const subscriptionRef = subscriptionRefOf(invoice)

        // Faktura bez předplatného není obnova (jednorázový doklad) — nic nedělat.
        if (!invoice.id || !subscriptionRef) {
            console.log(`💳 [stripe/${mode}] ${event.type} bez předplatného — ignorováno`)
            return Response.json({ received: true, handled: false })
        }

        // `subscription_create` je PRVNÍ faktura, kterou už zpracovala Session
        // výš. Kdyby se pustila i tudy, vznikne druhá platba a druhý doklad na
        // tytéž peníze.
        if (event.type === "invoice.paid" && invoice.billing_reason === "subscription_create") {
            console.log(`💳 [stripe/${mode}] faktura ${invoice.id} je první platba — řeší ji Checkout Session`)
            return Response.json({ received: true, handled: false })
        }

        const paid = event.type === "invoice.paid"
        const result = await applyProviderInvoice({
            provider: "stripe",
            invoiceRef: invoice.id,
            subscriptionRef,
            status: paid ? "PAID" : "FAILED",
            // Účtovaná částka se bere OD BRÁNY, ne z našeho ceníku: kdyby se ceník
            // mezitím změnil, doklad musí sedět s tím, co se skutečně strhlo.
            amount: (paid ? invoice.amount_paid : invoice.amount_due) ?? 0,
            currency: (invoice.currency || "czk").toUpperCase(),
            sandbox: isStripeSandbox(),
            raw: { source: "stripe", eventId: event.id, type: event.type, billingReason: invoice.billing_reason },
        })

        console.log(`💳 [stripe/${mode}] ${event.type} ${invoice.id} → ${result.claimed ? (paid ? "obnoveno" : "dunning") : "replay/neznámé"}`)
        return Response.json({ received: true, handled: result.claimed })
    }

    // ── Konec předplatného ────────────────────────────────────────────────────
    if (event.type === "customer.subscription.deleted") {
        const sub = event.data.object as { id?: string }
        if (!sub?.id) return Response.json({ received: true, handled: false })

        const { expireStripeSubscription } = await import("@/lib/payments/stripe-billing")
        const expired = await expireStripeSubscription(sub.id)
        console.log(`💳 [stripe/${mode}] předplatné ${sub.id} ukončeno u brány → ${expired ? "expirováno" : "už neběželo"}`)
        return Response.json({ received: true, handled: expired })
    }

    // Ostatní události jen kvitujeme. 200 schválně: 4xx/5xx by Stripe nutilo
    // opakovat něco, co nikdy nezpracujeme.
    console.log(`💳 [stripe/${mode}] ${event.type} (${event.id}) — ignorováno`)
    return Response.json({ received: true, handled: false })
}
