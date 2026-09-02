/**
 * Co Stripe událost ZNAMENÁ — čistá funkce nad tvarem události.
 * ==============================================================
 *
 * Tohle je druhé nejdražší rozhodnutí v aplikaci hned po výběru brány, a do 9/2026
 * bylo zadrátované uvnitř routy — tedy netestovatelné jinak než nasazením a
 * spuštěním skutečné platby. Přesně z toho důvodu žije `chooseGateway` v
 * `./gateway` jako čistá funkce: incident z 11. 8. 2026 se nedal chytit dřív,
 * než ho zaplatil zákazník.
 *
 * Routa si po ověření podpisu nechá událost KLASIFIKOVAT a pak už jen vykoná, co
 * z klasifikace vyšlo. Rozhodování je tady, vedlejší účinky tam.
 *
 * Tři místa, kde chyba stojí peníze:
 *
 *  1. `checkout.session.completed` NEZNAMENÁ zaplaceno. Session se uzavře i u
 *     odložených metod; aktivovat plán podle typu události by rozdal tarify zdarma.
 *
 *  2. `invoice.paid` s `billing_reason = "subscription_create"` je PRVNÍ faktura,
 *     kterou už zpracovala Session. Kdyby prošla i tudy, vznikne druhá platba a
 *     druhý daňový doklad na tytéž peníze — a číselná řada je nevratná.
 *
 *  3. Částka se bere OD BRÁNY (`amount_paid` u zaplacené, `amount_due` u odmítnuté),
 *     nikdy z našeho ceníku: kdyby se ceník mezitím změnil, doklad by neseděl
 *     s tím, co se zákazníkovi skutečně strhlo.
 *
 * Idempotence sama tady NENÍ a být nemůže — tu drží podmíněný claim v databázi
 * (`WHERE provider_ref=? AND status NOT IN (PAID, REFUNDED)`). Stripe opakuje
 * doručení, dokud nedostane 2xx, takže claim je jediná pojistka proti dvojí
 * aktivaci. Tahle vrstva rozhoduje jen o tom, jestli se claim vůbec MÁ zkusit.
 */

/** Faktura z pohledu Stripu — jen pole, která čteme. */
export type StripeInvoiceShape = {
    id?: string
    subscription?: string | { id?: string } | null
    parent?: { subscription_details?: { subscription?: string | { id?: string } | null } | null } | null
    amount_paid?: number
    amount_due?: number
    currency?: string
    billing_reason?: string
}

export type StripeSessionShape = {
    id?: string
    payment_status?: string
    subscription?: string | { id?: string } | null
}

/** Minimální tvar události — schválně ne typ ze SDK, ať jde testovat bez něj. */
export type StripeEventShape = {
    id?: string
    type?: string
    data?: { object?: unknown }
}

/** Proč se událost nezpracovává. Kód, ne věta — routa z něj skládá log. */
export type IgnoreReason =
    | "unhandled_type"        // událost, kterou nikdy zpracovávat nebudeme
    | "missing_session_id"    // Session bez id — nemáme podle čeho zabrat řádek
    | "session_not_paid"      // Session uzavřená, ale nezaplacená
    | "invoice_not_renewal"   // faktura bez předplatného = jednorázový doklad
    | "first_invoice"         // první faktura předplatného — řeší ji Session
    | "missing_subscription_id"

export type StripeEventPlan =
    | { kind: "first_payment"; sessionId: string; subscriptionRef: string | null }
    | {
          kind: "renewal"
          invoiceRef: string
          subscriptionRef: string
          /** true = `invoice.paid`, false = `invoice.payment_failed` (dunning). */
          paid: boolean
          /** V haléřích, jak je posílá brána. */
          amount: number
          currency: string
      }
    | { kind: "subscription_ended"; subscriptionRef: string }
    | { kind: "ignore"; reason: IgnoreReason }

/** `subscription` chodí jako id nebo jako rozbalený objekt — podle verze API a expandu. */
export function refOf(v: string | { id?: string } | null | undefined): string | null {
    if (!v) return null
    return typeof v === "string" ? v : v.id || null
}

/**
 * Id předplatného na faktuře. Novější verze API ho stěhují pod
 * `parent.subscription_details.subscription`; starší ho mají rovnou na faktuře.
 * Číst obě místa je levnější než tichá ztráta obnovy po upgradu API verze.
 */
export function subscriptionRefOf(invoice: StripeInvoiceShape): string | null {
    return refOf(invoice.subscription) ?? refOf(invoice.parent?.subscription_details?.subscription)
}

export function classifyStripeEvent(event: StripeEventShape): StripeEventPlan {
    const type = event?.type

    // ── První platba ──────────────────────────────────────────────────────────
    if (type === "checkout.session.completed") {
        const session = (event.data?.object ?? {}) as StripeSessionShape
        if (!session.id) return { kind: "ignore", reason: "missing_session_id" }
        // Session může být "completed" i bez zaplacení (např. odložené metody).
        // Aktivovat podle TYPU události místo podle stavu platby = tarif zdarma.
        if (session.payment_status !== "paid") return { kind: "ignore", reason: "session_not_paid" }
        return {
            kind: "first_payment",
            sessionId: session.id,
            // Chybějící id předplatného aktivaci NEBLOKUJE — jen se pak nebude mít
            // obnova podle čeho spárovat, což routa hlásí zvlášť.
            subscriptionRef: refOf(session.subscription),
        }
    }

    // ── Obnova ────────────────────────────────────────────────────────────────
    if (type === "invoice.paid" || type === "invoice.payment_failed") {
        const invoice = (event.data?.object ?? {}) as StripeInvoiceShape
        const subscriptionRef = subscriptionRefOf(invoice)
        if (!invoice.id || !subscriptionRef) return { kind: "ignore", reason: "invoice_not_renewal" }

        // Druhý doklad na tytéž peníze. Nevratné — číselnou řadu jde jen stornovat.
        if (type === "invoice.paid" && invoice.billing_reason === "subscription_create") {
            return { kind: "ignore", reason: "first_invoice" }
        }

        const paid = type === "invoice.paid"
        return {
            kind: "renewal",
            invoiceRef: invoice.id,
            subscriptionRef,
            paid,
            amount: (paid ? invoice.amount_paid : invoice.amount_due) ?? 0,
            currency: (invoice.currency || "czk").toUpperCase(),
        }
    }

    // ── Konec předplatného ────────────────────────────────────────────────────
    if (type === "customer.subscription.deleted") {
        const sub = (event.data?.object ?? {}) as { id?: string }
        if (!sub.id) return { kind: "ignore", reason: "missing_subscription_id" }
        return { kind: "subscription_ended", subscriptionRef: sub.id }
    }

    return { kind: "ignore", reason: "unhandled_type" }
}
