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
import { classifyStripeEvent } from "@/lib/payments/stripe-events"



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

    // Co událost ZNAMENÁ, rozhoduje čistá funkce (lib/payments/stripe-events.ts) —
    // tady zůstávají už jen vedlejší účinky. Do 9/2026 bylo rozhodování zadrátované
    // sem, takže se nedalo ověřit jinak než skutečnou platbou na produkci.
    const plan = classifyStripeEvent(event as { id?: string; type?: string; data?: { object?: unknown } })

    if (plan.kind === "ignore") {
        // 200 schválně i u nezpracovaných: 4xx/5xx by Stripe nutilo opakovat něco,
        // co nikdy nezpracujeme.
        console.log(`💳 [stripe/${mode}] ${event.type} (${event.id}) — ${plan.reason}`)
        return Response.json({ received: true, handled: false })
    }

    const { applyGatewayStatus, applyProviderInvoice } = await import("@/lib/payments/on-paid")

    // ── První platba ───────────────────────────────────────────────────────────
    if (plan.kind === "first_payment") {
        // Podmíněný claim `WHERE provider='stripe' AND provider_ref=? AND status
        // NOT IN (PAID, REFUNDED)` žije ve sdíleném jádře, protože stejný UPDATE
        // potřebuje i ComGate callback a reconciler. Stripe posílá webhook
        // opakovaně, dokud nedostane 2xx, takže je to JEDINÁ pojistka proti dvojí
        // aktivaci a dvěma dokladům; claim bez řádku je konec, nikdy insert fallback.
        const result = await applyGatewayStatus({
            locator: { provider: "stripe", ref: plan.sessionId },
            status: "PAID",
            raw: { source: "stripe", eventId: event.id, type: event.type, paymentStatus: "paid" },
            // Sandboxová platba nikdy nesmí sáhnout na ostrou číselnou řadu.
            sandbox: isStripeSandbox(),
            // Token pro obnovy si u Stripu drží brána sama (viz linkStripeSubscription).
            recurringToken: null,
            source: "webhook",
        })

        if (!result.claimed) {
            console.log(`💳 [stripe/${mode}] session ${plan.sessionId} nic nezabrala — replay nebo neznámá platba`)
            return Response.json({ received: true, handled: false })
        }

        // Propojení musí proběhnout i tehdy, když aktivace selhala: bez něj by
        // obnova neměla podle čeho najít, komu faktura patří, a ruční oprava
        // aktivace by problém vyřešila jen do první obnovy.
        if (plan.subscriptionRef && result.paymentId) {
            const { linkStripeSubscription } = await import("@/lib/payments/stripe-billing")
            await linkStripeSubscription(result.paymentId, plan.subscriptionRef)
        } else {
            console.warn(`⚠️ [stripe/${mode}] session ${plan.sessionId} bez id předplatného — obnovy nebude podle čeho spárovat`)
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
    if (plan.kind === "renewal") {
        const result = await applyProviderInvoice({
            provider: "stripe",
            invoiceRef: plan.invoiceRef,
            subscriptionRef: plan.subscriptionRef,
            status: plan.paid ? "PAID" : "FAILED",
            // Účtovaná částka se bere OD BRÁNY, ne z našeho ceníku: kdyby se ceník
            // mezitím změnil, doklad musí sedět s tím, co se skutečně strhlo.
            amount: plan.amount,
            currency: plan.currency,
            sandbox: isStripeSandbox(),
            raw: { source: "stripe", eventId: event.id, type: event.type },
        })

        console.log(`💳 [stripe/${mode}] ${event.type} ${plan.invoiceRef} → ${result.claimed ? (plan.paid ? "obnoveno" : "dunning") : "replay/neznámé"}`)
        return Response.json({ received: true, handled: result.claimed })
    }

    // ── Konec předplatného ────────────────────────────────────────────────────
    const { expireStripeSubscription } = await import("@/lib/payments/stripe-billing")
    const expired = await expireStripeSubscription(plan.subscriptionRef)
    console.log(`💳 [stripe/${mode}] předplatné ${plan.subscriptionRef} ukončeno u brány → ${expired ? "expirováno" : "už neběželo"}`)
    return Response.json({ received: true, handled: expired })
}
