/**
 * POST /api/payments/stripe/webhook
 *
 * Stripe webhook — ověří podpis, ZABERE platbu a aktivuje plán přes sdílené jádro.
 *
 * Obsluhuje `checkout.session.completed`. Cesta je záměrně stejná jako u ComGate
 * callbacku a **veškerá logika po claimu je sdílená** (`lib/payments/on-paid.ts`) —
 * druhá brána nesmí být druhé místo, kde se zapomene na doklad:
 *
 *  1. ověřit podpis (bez něj by kdokoli poslal „zaplaceno")
 *  2. předat výsledek do `applyGatewayStatus`, které **zabere** řádek podmíněným
 *     UPDATE (`WHERE provider='stripe' AND provider_ref=? AND status != 'PAID'`),
 *     aktivuje plán synchronně a doklad s potvrzením odloží mimo kritickou cestu
 *
 * Routa sama nesahá na `payments` ani na `subscriptions` — kdyby si brána
 * aktivaci napsala po svém, je to druhé místo, kde se zapomene na doklad.
 *
 * Lokátor je `payments.provider_ref` = id Checkout Session, unikátní v rámci
 * `provider` (migrace `20260810_payment_provider_ref.sql`).
 *
 * ⚠️ **Obnovy tudy nevedou.** Tohle je jednorázová platba; druhý měsíc řeší
 *    stávající billing-worker stejně jako u ComGate. Volba Stripe Billing vs
 *    vlastní dunning je schválně odložená — k PRVNÍ platbě není potřeba a první
 *    obnova přijde až za měsíc. `invoice.paid` a `customer.subscription.*` jsou
 *    proto zatím jen kvitované; až se o modelu rozhodne, obsluha patří sem.
 *
 * Lokální test:
 *   stripe listen --forward-to localhost:3000/api/payments/stripe/webhook
 *   stripe trigger checkout.session.completed
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

    if (event.type !== "checkout.session.completed") {
        // Ostatní události zatím jen kvitujeme. 200 schválně: 4xx/5xx by Stripe
        // nutilo opakovat něco, co nikdy nezpracujeme.
        console.log(`💳 [stripe/${mode}] ${event.type} (${event.id}) — ${RELEVANT.has(event.type) ? "zatím neobsluhováno" : "ignorováno"}`)
        return Response.json({ received: true, handled: false })
    }

    const session = event.data.object as { id?: string; payment_status?: string }
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

    // ── Zabrání + aktivace ─────────────────────────────────────────────────────
    // Podmíněný claim `WHERE provider='stripe' AND provider_ref=? AND status!='PAID'`
    // žije ve sdíleném jádře, protože stejný UPDATE potřebuje i ComGate callback
    // a reconciler. Stripe posílá webhook opakovaně, dokud nedostane 2xx, takže
    // je to JEDINÁ pojistka proti dvojí aktivaci a dvěma dokladům; claim bez
    // řádku je konec, nikdy insert fallback.
    const { applyGatewayStatus } = await import("@/lib/payments/on-paid")
    const result = await applyGatewayStatus({
        locator: { provider: "stripe", sessionId },
        status: "PAID",
        raw: { source: "stripe", eventId: event.id, type: event.type, paymentStatus: session.payment_status },
        // Sandboxová platba nikdy nesmí sáhnout na ostrou číselnou řadu.
        sandbox: isStripeSandbox(),
        // Obnovy tudy nevedou (jednorázová platba), takže se token neukládá.
        recurringToken: null,
        source: "webhook",
    })

    if (!result.claimed) {
        console.log(`💳 [stripe/${mode}] session ${sessionId} nic nezabrala — replay nebo neznámá platba`)
        return Response.json({ received: true, handled: false })
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
