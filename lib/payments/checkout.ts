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
import { termPrice, termLabel, stripeRecurring, type TermMonths } from "@/lib/pricing"

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
    /** `price_czk` je MĚSÍČNÍ cena tarifu — cena období z ní vzniká přes termPrice(). */
    plan: { id: string; name: string; price_czk: number }
    payerEmail: string | null
    termMonths: TermMonths
}

export interface CheckoutResult {
    redirectUrl: string
    /** Lokátor, pod kterým platbu najde webhook. */
    providerRef: string
}

/**
 * Popisek platby. Do ComGate se ořezává na 40 znaků, ale do `payments.label` se
 * ukládá celý — je to text, který skončí jako položka na daňovém dokladu.
 */
export function paymentLabel(planName: string, termMonths: TermMonths): string {
    return `Chrlit ${planName} — předplatné ${termLabel(termMonths)}`
}

/**
 * Stripe Checkout + `PENDING` řádek v `payments`.
 *
 * **Režim `subscription`, ne `payment`.** Stripe Billing tím přebírá obnovu:
 * vystaví fakturu sám na konci každého období a pošle `invoice.paid`. Do
 * `mode: "payment"` (jednorázovka) se tudy vracet nedá — pak by druhé období
 * nikdo nestrhl a zákazník by po roce tiše přišel o službu, přestože §8 podmínek
 * slibuje automatickou obnovu. ComGate to řeší uloženým tokenem a naším cronem;
 * Stripe si to řídí sám a cron ho proto přeskakuje (`subscriptions.provider`).
 *
 * Kratší období než rok jsou u Stripu plnohodnotná předplatná přes
 * `interval_count` (3 nebo 6 měsíců), ne série jednorázovek.
 *
 * Volající si ověřuje přístup sám (`requireAuth` + `requireClientAccess`) —
 * tahle funkce se dostane k penězům, takže **nikdy ji nevolej z neautorizované
 * cesty**.
 */
export async function createStripeCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    if (!isStripeConfigured()) throw new Error("Stripe není nakonfigurovaná")

    const { client, plan, payerEmail, termMonths } = input
    const refId = generateRefId(client.slug)
    const label = paymentLabel(plan.name, termMonths)
    const amount = termPrice(plan.price_czk, termMonths)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://chrlit.cz"

    // `plans.price_czk` drží HALÉŘE (stejně jako `payments.amount` a to, co jde
    // do ComGate). Stripe chce nejmenší jednotku měny → předává se beze změny.
    const session = await getStripe().checkout.sessions.create({
        mode: "subscription",
        line_items: [{
            quantity: 1,
            price_data: {
                currency: "czk",
                unit_amount: amount,
                recurring: stripeRecurring(termMonths),
                product_data: { name: label },
            },
        }],
        ...(payerEmail ? { customer_email: payerEmail } : {}),
        client_reference_id: refId,
        metadata: { clientId: client.id, clientSlug: client.slug, planId: plan.id, refId, termMonths: String(termMonths) },
        // Metadata na SAMOTNÉM předplatném — obnovy chodí jako `invoice.paid` bez
        // Checkout Session, takže bez tohohle by se u druhé faktury nedalo zjistit,
        // čí a jaký tarif to je.
        subscription_data: {
            metadata: { clientId: client.id, clientSlug: client.slug, planId: plan.id, termMonths: String(termMonths) },
        },
        success_url: `${baseUrl}/dashboard/instagram?platba=ok`,
        cancel_url: `${baseUrl}/dashboard/instagram?platba=zrusena`,
    })

    if (!session.id || !session.url) throw new Error("Stripe nevrátil session id nebo URL")

    const { data: subscription } = await supabaseAdmin
        .from("subscriptions")
        .insert({
            client_id: client.id,
            plan_id: plan.id,
            status: "pending",
            term_months: termMonths,
            provider: "stripe",
        })
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
        amount,
        currency: "CZK",
        status: "PENDING",
        label,
        term_months: termMonths,
        payer_email: payerEmail,
    })

    console.log(`💳 [stripe/${isStripeSandbox() ? "sandbox" : "LIVE"}] Session ${session.id} pro ${client.name} (${plan.name}, ${termMonths} měs.)`)
    return { redirectUrl: session.url, providerRef: session.id }
}

