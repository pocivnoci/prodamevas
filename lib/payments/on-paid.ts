/**
 * Co se stane, když platba dojde — nezávisle na platební bráně.
 * =============================================================
 * Aktivace plánu, uložení tokenu pro obnovy, vystavení daňového dokladu
 * a potvrzovací e-mail. **Tohle je jediné místo, kde ta logika žije** —
 * ComGate callback i Stripe webhook ji volají, takže druhá brána neznamená
 * druhou kódovou cestu (a tedy ani druhé místo, kde se zapomene na doklad).
 *
 * Co záměrně NENÍ tady, protože se to mezi branami skutečně liší:
 *  - parsování a **serverové ověření** stavu platby (jiné API, jiný podpis),
 *  - **zabrání stavu** (`payments` má pro každou bránu vlastní lokátor —
 *    `comgate_trans_id` vs `provider_ref`).
 *
 * Volající tedy nejdřív ověří a zabere, teprve pak sem předá už zabraný řádek.
 * Rozdělení na `finalizePaidPayment` (synchronně, kritické) a
 * `deliverPaidArtifacts` (v `after()`, best-effort) je úmyslné: brána musí
 * dostat ACK okamžitě, ale aktivace plánu se odkládat nesmí.
 */

import supabaseAdmin from "@/supabase/admin"

export type PaymentProvider = "comgate" | "stripe"

/** Sloupce z `payments`, které jádro potřebuje. */
export interface PaidPaymentRow {
    id: string
    subscription_id: string | null
    client_id: string
    ref_id?: string | null
    payer_email?: string | null
    amount: number
    currency?: string | null
    label?: string | null
}

export interface FinalizeOptions {
    provider: PaymentProvider
    /** Obnova předplatného (nikoli první platba) — mění text e-mailu i uložení tokenu. */
    isRenewal: boolean
    /**
     * Identifikátor, na který se budou odkazovat budoucí automatické obnovy.
     * U ComGate je to transId PRVNÍ platby v sérii; u Stripe se obnovy řeší
     * na jeho straně, takže se nepředává. Ukládá se jen u první platby.
     */
    recurringToken?: string | null
}

export interface FinalizeResult {
    /** false = plán se NEPODAŘILO aktivovat. Zaplacený a neaktivovaný zákazník je nejhorší stav. */
    activated: boolean
    planId: string
    isRenewal: boolean
}

/** Legacy fallback pro platby bez navázaného předplatného. */
const LEGACY_PLAN_ID = "chrlit"

/**
 * Aktivuje zaplacený plán. Volá se **po** úspěšném zabrání stavu, takže se na
 * jednu platbu provede právě jednou.
 */
export async function finalizePaidPayment(
    payment: PaidPaymentRow,
    opts: FinalizeOptions
): Promise<FinalizeResult> {
    // Zakoupený plán visí na pending předplatném založeném při vytvoření platby;
    // obnovy odkazují přímo na živé předplatné.
    let planId = LEGACY_PLAN_ID
    if (payment.subscription_id) {
        const { data: sub } = await supabaseAdmin
            .from("subscriptions")
            .select("plan_id")
            .eq("id", payment.subscription_id)
            .single()
        if (sub?.plan_id) planId = sub.plan_id
    }

    try {
        const { activatePaidPlan } = await import("@/lib/subscription")
        await activatePaidPlan(payment.client_id, planId, payment.subscription_id || undefined)
        console.log(`✅ Plán „${planId}" ${opts.isRenewal ? "obnoven" : "aktivován"} pro klienta ${payment.client_id}`)
    } catch (err: any) {
        // Zaplaceno a neaktivováno je nejhorší možný stav — křičet nahlas.
        // Řádek platby zůstává PAID, aby šla oprava provést ručně.
        console.error(`🚨 activatePaidPlan SELHALO pro zaplacenou platbu ${payment.id} (klient ${payment.client_id}):`, err?.message)
        try {
            const Sentry = await import("@sentry/nextjs")
            Sentry.captureException(err, {
                tags: { area: "payments", provider: opts.provider },
                extra: { paymentId: payment.id, clientId: payment.client_id, planId },
            })
        } catch { /* Sentry je volitelný */ }
        return { activated: false, planId, isRenewal: opts.isRenewal }
    }

    // Úspěšná platba nuluje dunning a u PRVNÍ platby uloží token pro obnovy.
    if (payment.subscription_id) {
        const update: Record<string, unknown> = {
            billing_failures: 0,
            updated_at: new Date().toISOString(),
        }
        if (!opts.isRenewal && opts.recurringToken) {
            update.recurring_trans_id = opts.recurringToken
        }
        await supabaseAdmin.from("subscriptions").update(update).eq("id", payment.subscription_id)
    }

    return { activated: true, planId, isRenewal: opts.isRenewal }
}

/**
 * Doklad a potvrzovací e-mail. Pouštět v `after()` — brána nemá čekat.
 * **Nikdy nevyhazuje výjimku**: daňový doklad je povinnost, potvrzení zdvořilost,
 * ale ani jedno nesmí shodit potvrzení platby.
 */
export async function deliverPaidArtifacts(
    payment: PaidPaymentRow,
    result: FinalizeResult
): Promise<void> {
    try {
        const { sendNotification, getOwnerEmail, siteUrl } = await import("@/lib/notifications")
        const to = payment.payer_email || (await getOwnerEmail(payment.client_id))

        // Faktura se vystavuje nezávisle na e-mailu — doklad je zákonná
        // povinnost, i když se potvrzení nemá komu poslat.
        const { issueInvoiceForPayment } = await import("@/lib/invoicing")
        const invoice = await issueInvoiceForPayment({
            paymentId: payment.id,
            clientId: payment.client_id,
            amountHaleru: payment.amount,
            currency: payment.currency,
            label: payment.label,
            payerEmail: to,
            paidAt: new Date(),
        })

        if (!to) return

        let planName = result.planId
        const { data: planRow } = await supabaseAdmin
            .from("subscription_plans")
            .select("name")
            .eq("id", result.planId)
            .maybeSingle()
        if (planRow?.name) planName = planRow.name

        const amountStr = typeof payment.amount === "number"
            ? `${(payment.amount / 100).toLocaleString("cs-CZ")} ${payment.currency === "CZK" || !payment.currency ? "Kč" : payment.currency}`
            : null

        const invoiceLine = invoice.status === "issued" && invoice.publicUrl
            ? `Daňový doklad č. <strong>${invoice.number}</strong>: <a href="${invoice.publicUrl}">zobrazit fakturu →</a>`
            : invoice.status === "issued"
                ? `Daňový doklad č. <strong>${invoice.number}</strong> jsme vám poslali samostatným e-mailem.`
                : `Daňový doklad vám zašleme e-mailem během okamžiku.`

        await sendNotification({
            to,
            kind: "transactional",
            subject: result.isRenewal
                ? `Předplatné ${planName} obnoveno`
                : `Potvrzení platby — plán ${planName} je aktivní`,
            body: `Dobrý den,

${amountStr ? `přijali jsme vaši platbu ${amountStr}${payment.label ? ` (${payment.label})` : ""}. ` : ""}${result.isRenewal
                    ? `Předplatné <strong>${planName}</strong> bylo úspěšně obnoveno na další období.`
                    : `Plán <strong>${planName}</strong> je aktivní — generování příspěvků je odemčené.`}

${invoiceLine}

<a href="${siteUrl()}/dashboard/instagram">Přejít do studia →</a>

Tým Chrlit`,
        })
    } catch (err: any) {
        console.warn(`on-paid: doručení dokladu/potvrzení selhalo: ${err?.message}`)
    }
}

/**
 * Zrušená platba → zruší **jen** to nezaplacené pending předplatné z inicializace.
 *
 * U obnovy se nesmí volat vůbec: odmítnutá automatická obnova jde do dunningu
 * (billing-worker to zkouší dál) a nesmí na místě zabít živé předplatné.
 * Podmínka `status='pending'` je druhá pojistka téhož.
 */
export async function cancelPendingSubscription(payment: PaidPaymentRow): Promise<void> {
    if (!payment.subscription_id) return
    await supabaseAdmin
        .from("subscriptions")
        .update({
            status: "cancelled",
            cancelled_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        })
        .eq("id", payment.subscription_id)
        .eq("status", "pending")
    console.log(`❌ Pending předplatné zrušeno pro klienta ${payment.client_id}`)
}
