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

        // If PAID → activate the purchased plan (trial → paid, tier change, or renewal).
        // Everything past the status claim is provider-neutral and lives in
        // lib/payments/on-paid.ts — the Stripe webhook calls the SAME code, so a
        // second gateway can't become a second place that forgets the invoice.
        if (confirmedStatus === "PAID" && payment.client_id) {
            const { finalizePaidPayment, deliverPaidArtifacts } = await import("@/lib/payments/on-paid")

            const result = await finalizePaidPayment(payment, {
                provider: "comgate",
                isRenewal,
                // The INIT transId is what chargeRecurring references forever. A mock
                // transId must never be stored — it would be charged for real later.
                recurringToken: !isMockPaymentMode() && !transId.startsWith("MOCK-") ? transId : null,
                // Mock platba nesmí sáhnout na ostrou číselnou řadu Fakturoidu.
                sandbox: isMockPaymentMode() || transId.startsWith("MOCK-"),
            })

            // Comgate gets OK either way; the payment row stays PAID for manual repair.
            if (!result.activated) return OK()

            // after() so Comgate gets its ACK immediately — invoicing and the receipt
            // are best-effort and never throw.
            after(() => deliverPaidArtifacts(payment, result))
        }

        // If CANCELLED → cancel the unpaid pending subscription, but NEVER for a
        // renewal charge: a declined auto-renewal goes through dunning (billing
        // worker retries) and must not kill the live subscription on the spot.
        if (confirmedStatus === "CANCELLED" && !isRenewal) {
            const { cancelPendingSubscription } = await import("@/lib/payments/on-paid")
            await cancelPendingSubscription(payment)
        }

        return OK()
    } catch (err: any) {
        console.error("Payment callback error:", err?.message || err)
        // Still return 200 to prevent Comgate from retrying infinitely
        return OK()
    }
}
