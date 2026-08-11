/**
 * Založení platby — výběr brány na JEDNOM místě
 * =============================================
 * UI o platebních branách nic neví a vědět nemá. Volá `/api/payments/create`
 * a dostane `redirectUrl`; která brána za tím stojí, rozhoduje server tady.
 *
 * Bez tohohle by se volba brány rozlezla do každého tlačítka v Reactu (dnes
 * `PaywallProvider` a `SubscriptionSection`) a druhá brána by se stala druhou
 * kódovou cestou — přesně to, čemu se `lib/payments/on-paid.ts` brání na druhém
 * konci platby.
 */

import "server-only"
import supabaseAdmin from "@/supabase/admin"
import { getStripe, isStripeConfigured, isStripeSandbox } from "./stripe"
import { generateRefId } from "@/lib/comgate"

export type Gateway = "comgate" | "stripe"

/**
 * Která brána vezme peníze.
 *
 * `PAYMENT_GATEWAY` je explicitní přepínač; bez něj rozhoduje konfigurace —
 * ComGate má přednost (je to původní brána se smluvním vztahem), Stripe
 * naskočí, když ComGate nakonfigurovaná není. Díky tomu stačí k přepnutí
 * doplnit klíče, ne měnit kód.
 */
/**
 * Stripe umí vzít peníze už se samotným tajným klíčem — ale **aktivovat plán umí
 * až s webhookem**. Bez `STRIPE_WEBHOOK_SECRET` se podpis nedá ověřit,
 * `verifyStripeWebhook` vyhodí, route vrátí 400 a zaplacený zákazník nikdy
 * nedostane, co si koupil.
 *
 * Zaplacený a neaktivovaný zákazník je nejhorší možný stav — horší než platba,
 * která vůbec nezačne. Proto se za „nakonfigurovanou" považuje jen brána, která
 * zvládne CELOU cestu, ne jen její začátek.
 *
 * Nalezeno na produkci 2026-08-11: ComGate creds tam nebyly, Stripe klíč ano,
 * a tenhle výběr proto tiše směroval platby na bránu bez webhooku.
 */
export function stripeCanCompletePayment(): boolean {
    return isStripeConfigured() && Boolean(process.env.STRIPE_WEBHOOK_SECRET)
}

export function activeGateway(): Gateway {
    const forced = (process.env.PAYMENT_GATEWAY || "").toLowerCase()
    // I vynucená volba musí umět dojet do konce — jinak by se překlep v env
    // proměnné projevil až tím, že zákazník zaplatí a nic nedostane.
    if (forced === "stripe" && stripeCanCompletePayment()) return "stripe"
    if (forced === "comgate") return "comgate"
    const comgateReady = Boolean(process.env.COMGATE_MERCHANT_ID && process.env.COMGATE_SECRET)
    if (!comgateReady && stripeCanCompletePayment()) return "stripe"
    return "comgate"
}

export interface CheckoutInput {
    client: { id: string; slug: string; name: string }
    plan: { id: string; name: string; price_czk: number }
    payerEmail: string | null
}

export interface CheckoutResult {
    redirectUrl: string
    /** Lokátor, pod kterým platbu najde webhook. */
    providerRef: string
}

/**
 * Stripe Checkout + `PENDING` řádek v `payments`.
 *
 * Volající si ověřuje přístup sám (`requireAuth` + `requireClientAccess`) —
 * tahle funkce se dostane k penězům, takže **nikdy ji nevolej z neautorizované
 * cesty**.
 */
export async function createStripeCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    if (!isStripeConfigured()) throw new Error("Stripe není nakonfigurovaná")

    const { client, plan, payerEmail } = input
    const refId = generateRefId(client.slug)
    const label = `${plan.name} — ${client.name}`
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://chrlit.cz"

    // `plans.price_czk` drží HALÉŘE (stejně jako `payments.amount` a to, co jde
    // do ComGate). Stripe chce nejmenší jednotku měny → předává se beze změny.
    const session = await getStripe().checkout.sessions.create({
        mode: "payment",
        line_items: [{
            quantity: 1,
            price_data: { currency: "czk", unit_amount: plan.price_czk, product_data: { name: label } },
        }],
        ...(payerEmail ? { customer_email: payerEmail } : {}),
        client_reference_id: refId,
        metadata: { clientId: client.id, clientSlug: client.slug, planId: plan.id, refId },
        success_url: `${baseUrl}/dashboard/instagram?platba=ok`,
        cancel_url: `${baseUrl}/dashboard/instagram?platba=zrusena`,
    })

    if (!session.id || !session.url) throw new Error("Stripe nevrátil session id nebo URL")

    const { data: subscription } = await supabaseAdmin
        .from("subscriptions")
        .insert({ client_id: client.id, plan_id: plan.id, status: "pending" })
        .select("id")
        .single()

    // provider_ref = id Session. Částečný UNIQUE index (provider, provider_ref)
    // z migrace 20260810 je nárok na zpracování — replay webhooku claim nevrátí.
    await supabaseAdmin.from("payments").insert({
        client_id: client.id,
        subscription_id: subscription?.id,
        provider: "stripe",
        provider_ref: session.id,
        ref_id: refId,
        amount: plan.price_czk,
        currency: "CZK",
        status: "PENDING",
        label,
        payer_email: payerEmail,
    })

    console.log(`💳 [stripe/${isStripeSandbox() ? "sandbox" : "LIVE"}] Session ${session.id} pro ${client.name} (${plan.name})`)
    return { redirectUrl: session.url, providerRef: session.id }
}
