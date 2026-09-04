/**
 * Stripe — klient brány (zatím SANDBOX).
 * =====================================
 * Adaptér na okraji, přesně jako `lib/comgate.ts`. Platí tu stejná dělba jako
 * u ComGate (viz `lib/payments/on-paid.ts`): tady žije **jen** práce s bránou —
 * klient, ověření podpisu, překlad Stripe pojmů na naše. Všechno po zabrání
 * stavu patří do sdíleného jádra, které tenhle soubor **nesmí** importovat.
 *
 * Klíče provisionuje Vercel Marketplace (resource `stripe-charcoal-planet`,
 * sandbox). Modul je **lazy** — bez klíče se nic neinicializuje a zbytek
 * aplikace běží dál; Stripe je zatím vypnutá druhá brána, ne povinná závislost.
 */

import "server-only"
import Stripe from "stripe"
import { isSandboxKey } from "./gateway"

let cached: Stripe | null = null

/** Je Stripe vůbec nakonfigurovaná? Volat před každou cestou, která ji používá. */
export function isStripeConfigured(): boolean {
    return Boolean(process.env.STRIPE_SECRET_KEY)
}

/**
 * Sandbox vs. ostrý provoz se pozná z klíče, ne z env příznaku — příznak se dá
 * zapomenout přepnout, prefix klíče lže jen tehdy, když někdo vloží špatný klíč.
 */
export function isStripeSandbox(): boolean {
    // Jediná definice žije v `./gateway` — je testovatelná bez SDK a bez env.
    return isSandboxKey(process.env.STRIPE_SECRET_KEY)
}

export function getStripe(): Stripe {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) {
        throw new Error(
            "STRIPE_SECRET_KEY není nastavený — Stripe cesta je vypnutá. " +
            "Klíče dodá `vercel env pull` (resource stripe-charcoal-planet)."
        )
    }
    if (!cached) {
        cached = new Stripe(key, {
            // Účtování a doklady visí na chování API — verzi drží kód, ne dashboard,
            // aby se cesta k penězům nezměnila tím, že někdo klikne v Stripe UI.
            apiVersion: "2026-07-29.dahlia",
            appInfo: { name: "Chrlit Studio", url: "https://chrlit.cz" },
            maxNetworkRetries: 2,
        })
    }
    return cached
}

/**
 * Ověří podpis webhooku a vrátí událost.
 *
 * Tělo MUSÍ být syrový text (`await req.text()`), ne přeparsovaný JSON —
 * podpis se počítá z bajtů. To je nejčastější důvod, proč Stripe webhook
 * „nefunguje" a přitom je všechno ostatní správně.
 *
 * Nepodepsaná událost se **zásadně nezpracovává**: webhook URL je veřejná,
 * takže bez ověření by kdokoli mohl poslat „zaplaceno" a aktivovat si plán.
 */
export function verifyStripeWebhook(rawBody: string, signature: string | null): Stripe.Event {
    const secret = process.env.STRIPE_WEBHOOK_SECRET
    if (!secret) {
        throw new Error(
            "STRIPE_WEBHOOK_SECRET není nastavený — webhook nelze ověřit. " +
            "Lokálně ho vypíše `stripe listen --forward-to localhost:3000/api/payments/stripe/webhook`."
        )
    }
    if (!signature) throw new Error("Chybí hlavička stripe-signature")
    return getStripe().webhooks.constructEvent(rawBody, signature, secret)
}
