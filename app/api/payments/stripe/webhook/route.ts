/**
 * POST /api/payments/stripe/webhook
 *
 * Stripe webhook — zatím **jen ověřuje a loguje**, plány neaktivuje.
 *
 * Proč ne rovnou celá cesta: aktivace patří do `lib/payments/on-paid.ts`
 * (`finalizePaidPayment` + `deliverPaidArtifacts`), ale předtím musí být
 * hotové dvě věci, které tenhle soubor rozhodnout nemůže:
 *
 *  1. **Lokátor stavu.** ComGate zabírá řádek přes `payments.comgate_trans_id`.
 *     Stripe potřebuje vlastní sloupec (`provider_ref` + `provider`), a ten
 *     v `payments` zatím NENÍ — bez něj nejde platbu idempotentně zabrat a
 *     replay webhooku by plán aktivoval dvakrát.
 *  2. **Model předplatného.** Buď Stripe Billing (obnovy řeší Stripe a náš
 *     `billing-worker` se jich nesmí dotknout), nebo jednorázové platby na
 *     našem dunningu jako u ComGate. To je produktové rozhodnutí, ne detail.
 *
 * Do té doby je tohle živý, ale neškodný endpoint: ověří podpis (jinak by
 * kdokoli mohl poslat „zaplaceno") a potvrdí příjem. Rozšířit ho znamená
 * přidat claim a zavolat sdílené jádro — **nikdy nepsat aktivaci sem.**
 *
 * Lokální test:
 *   stripe listen --forward-to localhost:3000/api/payments/stripe/webhook
 *   stripe trigger payment_intent.succeeded
 */

import { NextRequest } from "next/server"
import { verifyStripeWebhook, isStripeConfigured, isStripeSandbox } from "@/lib/payments/stripe"

/** Události, které bude cesta k penězům skutečně zpracovávat, až se dopojí. */
const RELEVANT = new Set([
    "checkout.session.completed",
    "payment_intent.succeeded",
    "payment_intent.payment_failed",
    "invoice.paid",
    "invoice.payment_failed",
    "customer.subscription.deleted",
])

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
    if (RELEVANT.has(event.type)) {
        console.log(`💳 [stripe/${mode}] ${event.type} (${event.id}) — ověřeno, zatím se nezpracovává`)
    } else {
        console.log(`💳 [stripe/${mode}] ${event.type} (${event.id}) — ignorováno`)
    }

    // 200 = potvrzeno. Až se cesta dopojí, přijde sem podmíněný claim řádku
    // v `payments` a teprve po něm finalizePaidPayment/deliverPaidArtifacts.
    return Response.json({ received: true, handled: false })
}
