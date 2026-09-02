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
// Přímo z neutrálního modulu, ne přes re-export v `lib/comgate.ts`: Stripe cesta
// nesmí mít jedinou vazbu na klienta druhé brány, jinak se ComGate nedá smazat.
import { generateRefId } from "@/lib/payments/ref-id"
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
    /**
     * `service` = jednorázová služba (nastavení značky), `credits` = dobití.
     * Obojí mění tři věci: platí se celá cena bez období, Stripe jede
     * v jednorázovém režimu (není co obnovovat) a nezakládá se předplatné.
     */
    kind?: "subscription" | "service" | "credits"
    /** Kolik kreditů platba koupila — jen u `kind = "credits"`. */
    creditsGranted?: number
    /**
     * Vykreslit pokladnu UVNITŘ aplikace místo odchodu na Stripe.
     *
     * Hostovaná varianta znamená odchod z aplikace, a ten se ukázal jako křehký:
     * nové okno blokuje blokátor, v nainstalované aplikaci `window.open` mlčky
     * selže a přesměrování celé karty uživatele z aplikace vyhodí. Vestavěná
     * pokladna je podle doporučení Stripu rovnocenná první volba a žádnou
     * navigaci nepotřebuje.
     *
     * Serverová část zůstává stejná — týž webhook, týž podmíněný claim, týž
     * doklad. Liší se jen to, kde se pokladna nakreslí.
     */
    embedded?: boolean
}

/**
 * Režim vestavěné pokladny. Vlastní konstanta schválně: `ui_mode` je v typech SDK
 * unie končící `OtherString`, takže překlep ani zrušenou hodnotu typecheck nechytí
 * a chyba spadne až za běhu při volání Stripu — tedy ve chvíli, kdy zákazník
 * klikl na tarif. Jedno místo se dá pohlídat ascercí, roztroušené literály ne.
 */
export const EMBEDDED_UI_MODE = "embedded_page" as const

export interface CheckoutResult {
    /** Adresa hostované pokladny. Prázdné u vestavěné — ta se nikam neodchází. */
    redirectUrl: string
    /** Lokátor, pod kterým platbu najde webhook. */
    providerRef: string
    /** Klíč pro vykreslení pokladny uvnitř aplikace — viz EMBEDDED_UI_MODE. */
    clientSecret?: string
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
    const isCredits = input.kind === "credits"
    // Služba i dobití se chovají u brány stejně: jednorázová platba bez období.
    const isService = input.kind === "service" || isCredits
    const refId = generateRefId(client.slug)
    const label = isService ? `Chrlit — ${plan.name}` : paymentLabel(plan.name, termMonths)
    const amount = isService ? plan.price_czk : termPrice(plan.price_czk, termMonths)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://chrlit.cz"

    // `plans.price_czk` drží HALÉŘE (stejně jako `payments.amount` a to, co jde
    // do ComGate). Stripe chce nejmenší jednotku měny → předává se beze změny.
    //
    // Jednorázová služba jede v režimu `payment`: není co obnovovat, a předplatné
    // by u ní znamenalo strhávat 999 Kč každý měsíc za schůzku, která byla jednou.
    const session = await getStripe().checkout.sessions.create({
        mode: isService ? "payment" : "subscription",
        line_items: [{
            quantity: 1,
            price_data: {
                currency: "czk",
                unit_amount: amount,
                ...(isService ? {} : { recurring: stripeRecurring(termMonths) }),
                product_data: { name: label },
            },
        }],
        ...(payerEmail ? { customer_email: payerEmail } : {}),
        client_reference_id: refId,
        metadata: { clientId: client.id, clientSlug: client.slug, planId: plan.id, refId, termMonths: String(termMonths) },
        // Metadata na SAMOTNÉM předplatném — obnovy chodí jako `invoice.paid` bez
        // Checkout Session, takže bez tohohle by se u druhé faktury nedalo zjistit,
        // čí a jaký tarif to je.
        ...(isService ? {} : {
            subscription_data: {
                metadata: { clientId: client.id, clientSlug: client.slug, planId: plan.id, termMonths: String(termMonths) },
            },
        }),
        // Vestavěná pokladna se nikam nepřesměrovává, takže success_url/cancel_url
        // nedávají smysl — Stripe místo nich chce jediné `return_url` pro chvíli,
        // kdy platba skončí. Hostovaná varianta zůstává beze změny.
        ...(input.embedded
            ? {
                // `embedded_page`, ne `embedded` — starší hodnota už není podporovaná.
                // Typ v SDK to nechytí: unie končí `OtherString`, takže bere jakýkoli
                // řetězec a chyba spadne až za běhu, při volání Stripu. Proto to hlídá
                // aserce v test-prompt-assembly.ts proti EMBEDDED_UI_MODE.
                ui_mode: EMBEDDED_UI_MODE,
                return_url: `${baseUrl}/dashboard/instagram?platba=ok&session={CHECKOUT_SESSION_ID}`,
            }
            : {
                success_url: `${baseUrl}/dashboard/instagram?platba=ok`,
                cancel_url: `${baseUrl}/dashboard/instagram?platba=zrusena`,
            }),
        // Štítek pro porovnávání pokladen v dashboardu Stripu (doporučení pro
        // apiVersion 2026-03-25.dahlia a novější). Suffix odlišuje nasazení.
        integration_identifier: `chrlit-${input.embedded ? "embed" : "hosted"}-${Math.random().toString(36).slice(2, 10)}`,
    })

    if (!session.id) throw new Error("Stripe nevrátil session id")
    if (input.embedded) {
        if (!session.client_secret) throw new Error("Stripe nevrátil client_secret pro vestavěnou pokladnu")
    } else if (!session.url) {
        throw new Error("Stripe nevrátil URL hostované pokladny")
    }

    // Služba nezakládá předplatné — pending řádek bez tarifu by zamaskoval
    // zákazníkovi jeho skutečný plán (viz pickLiveSubscription).
    const { data: subscription } = isService
        ? { data: null }
        : await supabaseAdmin
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
        kind: input.kind || "subscription",
        credits_granted: input.creditsGranted ?? null,
        term_months: isService ? null : termMonths,
        payer_email: payerEmail,
    })

    console.log(`💳 [stripe/${isStripeSandbox() ? "sandbox" : "LIVE"}] Session ${session.id} pro ${client.name} (${plan.name}, ${termMonths} měs.)`)
    return {
        redirectUrl: session.url ?? "",
        providerRef: session.id,
        ...(session.client_secret ? { clientSecret: session.client_secret } : {}),
    }
}

