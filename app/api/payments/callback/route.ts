/**
 * POST /api/payments/callback
 *
 * Comgate sends a POST callback here when payment status changes.
 * This is the ONLY reliable way to confirm payment — never trust client-side redirects.
 *
 * Comgate sends: application/x-www-form-urlencoded
 * Fields: merchant, test, price, curr, label, refId, transId, secret, status, email, method, ...
 *
 * Expected statuses: PAID, CANCELLED, AUTHORIZED, PENDING
 *
 * IMPORTANT: Must return HTTP 200 with "code=0&message=OK" to acknowledge.
 * Idempotent: a replayed PAID callback is a no-op (conditional status-claim update).
 */

import { NextRequest, after } from "next/server"
import supabaseAdmin from "@/supabase/admin"
import { getPaymentStatus, isMockPaymentMode, isRenewalRefId } from "@/lib/comgate"

const OK = () =>
    new Response("code=0&message=OK", {
        status: 200,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
    })

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData()
        const transId = formData.get("transId") as string
        const status = formData.get("status") as string
        const method = formData.get("method") as string

        console.log(`💳 Comgate callback: transId=${transId}, status=${status}`)

        if (!transId) {
            return new Response("code=1&message=Missing transId", {
                status: 200, // Comgate expects 200 even on errors
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
            })
        }

        // Verify payment status (skip for mock payments)
        let confirmedStatus: string
        if (isMockPaymentMode()) {
            confirmedStatus = status // Trust mock callback
            console.log(`💳 [MOCK] Callback: transId=${transId}, status=${confirmedStatus}`)
        } else {
            const verified = await getPaymentStatus(transId)

            if (verified.code !== 0) {
                console.error("Comgate status verification failed:", verified)
                return OK()
            }

            confirmedStatus = verified.status || status
        }

        // Idempotence: claim the status transition. A payment already PAID is never
        // reprocessed — a replayed callback must not re-activate the plan (or worse,
        // re-extend the period). The conditional update returns a row only for the
        // first transition into the new status.
        const { data: payment } = await supabaseAdmin
            .from("payments")
            .update({
                status: confirmedStatus,
                payment_method: method || undefined,
                paid_at: confirmedStatus === "PAID" ? new Date().toISOString() : null,
                updated_at: new Date().toISOString(),
            })
            .eq("comgate_trans_id", transId)
            .neq("status", "PAID")
            .select("id, subscription_id, client_id, ref_id, payer_email, amount, currency, label")
            .single()

        if (!payment) {
            const { data: existing } = await supabaseAdmin
                .from("payments")
                .select("id, status")
                .eq("comgate_trans_id", transId)
                .maybeSingle()
            if (existing?.status === "PAID") {
                console.log(`💳 Callback replay for already-PAID ${transId} — no-op`)
            } else {
                console.warn(`⚠️ Payment not found for transId: ${transId}`)
            }
            return OK()
        }

        const isRenewal = isRenewalRefId(payment.ref_id)

        // If PAID → activate the purchased plan (trial → paid, tier change, or renewal)
        if (confirmedStatus === "PAID" && payment.client_id) {
            // The purchased plan lives on the pending subscription created at payment init
            // (renewals reference the live subscription directly)
            let purchasedPlanId = "chrlit" // legacy fallback
            if (payment.subscription_id) {
                const { data: sub } = await supabaseAdmin
                    .from("subscriptions")
                    .select("plan_id")
                    .eq("id", payment.subscription_id)
                    .single()
                if (sub?.plan_id) purchasedPlanId = sub.plan_id
            }

            try {
                const { activatePaidPlan } = await import("@/lib/subscription")
                await activatePaidPlan(payment.client_id, purchasedPlanId, payment.subscription_id || undefined)
                console.log(`✅ Plan "${purchasedPlanId}" ${isRenewal ? "renewed" : "activated"} for client ${payment.client_id}`)
            } catch (upgradeErr: any) {
                // A paid-but-not-activated customer is the worst state — alert loudly.
                console.error(`🚨 activatePaidPlan FAILED for PAID payment ${transId} (client ${payment.client_id}):`, upgradeErr?.message)
                try {
                    const Sentry = await import("@sentry/nextjs")
                    Sentry.captureException(upgradeErr, { tags: { route: "payments-callback", transId }, extra: { clientId: payment.client_id, planId: purchasedPlanId } })
                } catch { /* Sentry optional */ }
                return OK() // Comgate gets OK either way; the payment row stays PAID for manual repair
            }

            // Successful payment resets dunning + (for initial payments) stores the
            // recurring token: the INIT transId is what chargeRecurring references forever.
            if (payment.subscription_id) {
                const update: Record<string, unknown> = { billing_failures: 0, updated_at: new Date().toISOString() }
                if (!isRenewal && !isMockPaymentMode() && !transId.startsWith("MOCK-")) {
                    update.recurring_trans_id = transId
                }
                await supabaseAdmin.from("subscriptions").update(update).eq("id", payment.subscription_id)
            }

            // Receipt e-mail — only on the first-PAID path (the status claim above)
            // and only after a successful activation. after() so Comgate gets its
            // ACK immediately; sendNotification is best-effort and never throws.
            after(async () => {
                try {
                    const { sendNotification, getOwnerEmail, siteUrl } = await import("@/lib/notifications")
                    const to = payment.payer_email || (await getOwnerEmail(payment.client_id))
                    if (!to) return
                    let planName = purchasedPlanId
                    const { data: planRow } = await supabaseAdmin
                        .from("subscription_plans")
                        .select("name")
                        .eq("id", purchasedPlanId)
                        .maybeSingle()
                    if (planRow?.name) planName = planRow.name
                    const amountStr = typeof payment.amount === "number"
                        ? `${(payment.amount / 100).toLocaleString("cs-CZ")} ${payment.currency === "CZK" || !payment.currency ? "Kč" : payment.currency}`
                        : null
                    await sendNotification({
                        to,
                        kind: "transactional",
                        subject: isRenewal
                            ? `Předplatné ${planName} obnoveno`
                            : `Potvrzení platby — plán ${planName} je aktivní`,
                        body: `Dobrý den,

${amountStr ? `přijali jsme vaši platbu ${amountStr}${payment.label ? ` (${payment.label})` : ""}. ` : ""}${isRenewal
                            ? `Předplatné <strong>${planName}</strong> bylo úspěšně obnoveno na další období.`
                            : `Plán <strong>${planName}</strong> je aktivní — generování příspěvků je odemčené.`}

Toto potvrzení není daňový doklad.

<a href="${siteUrl()}/dashboard/instagram">Přejít do studia →</a>

Tým Chrlit`,
                    })
                } catch (err: any) {
                    console.warn(`payments-callback: receipt e-mail failed: ${err?.message}`)
                }
            })
        }

        // If CANCELLED → mark subscription — but NEVER for a renewal charge: a declined
        // auto-renewal goes through dunning (billing worker retries), it must not kill
        // the live subscription on the spot.
        if (confirmedStatus === "CANCELLED" && payment.subscription_id && !isRenewal) {
            await supabaseAdmin
                .from("subscriptions")
                .update({
                    status: "cancelled",
                    cancelled_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .eq("id", payment.subscription_id)
                .eq("status", "pending") // only the unpaid pending sub from payment init — never a live one

            console.log(`❌ Pending subscription cancelled for client ${payment.client_id}`)
        }

        return OK()
    } catch (err: any) {
        console.error("Payment callback error:", err?.message || err)
        // Still return 200 to prevent Comgate from retrying infinitely
        return OK()
    }
}
