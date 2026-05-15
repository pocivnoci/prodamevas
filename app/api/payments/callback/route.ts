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
 */

import { NextRequest, NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"
import { getPaymentStatus } from "@/lib/comgate"

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData()
        const transId = formData.get("transId") as string
        const status = formData.get("status") as string
        const refId = formData.get("refId") as string
        const method = formData.get("method") as string

        console.log(`💳 Comgate callback: transId=${transId}, status=${status}, refId=${refId}`)

        if (!transId) {
            return new Response("code=1&message=Missing transId", {
                status: 200, // Comgate expects 200 even on errors
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
            })
        }

        // Verify payment status directly with Comgate (don't trust callback alone)
        const verified = await getPaymentStatus(transId)

        if (verified.code !== 0) {
            console.error("Comgate status verification failed:", verified)
            return new Response("code=0&message=OK", {
                status: 200,
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
            })
        }

        const confirmedStatus = verified.status || status

        // Update payment record
        const { data: payment } = await supabaseAdmin
            .from("payments")
            .update({
                status: confirmedStatus,
                payment_method: method || verified.method,
                paid_at: confirmedStatus === "PAID" ? new Date().toISOString() : null,
                comgate_response: verified,
                updated_at: new Date().toISOString(),
            })
            .eq("comgate_trans_id", transId)
            .select("id, subscription_id, client_id")
            .single()

        if (!payment) {
            console.warn(`⚠️ Payment not found for transId: ${transId}`)
            return new Response("code=0&message=OK", {
                status: 200,
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
            })
        }

        // If PAID → activate subscription
        if (confirmedStatus === "PAID" && payment.subscription_id) {
            const now = new Date()
            const periodEnd = new Date(now)
            periodEnd.setMonth(periodEnd.getMonth() + 1) // +1 month

            await supabaseAdmin
                .from("subscriptions")
                .update({
                    status: "active",
                    current_period_start: now.toISOString(),
                    current_period_end: periodEnd.toISOString(),
                    updated_at: now.toISOString(),
                })
                .eq("id", payment.subscription_id)

            console.log(`✅ Subscription activated for client ${payment.client_id}`)
        }

        // If CANCELLED → mark subscription
        if (confirmedStatus === "CANCELLED" && payment.subscription_id) {
            await supabaseAdmin
                .from("subscriptions")
                .update({
                    status: "cancelled",
                    cancelled_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .eq("id", payment.subscription_id)

            console.log(`❌ Subscription cancelled for client ${payment.client_id}`)
        }

        // Respond to Comgate with success
        return new Response("code=0&message=OK", {
            status: 200,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
        })
    } catch (err: any) {
        console.error("Payment callback error:", err?.message || err)
        // Still return 200 to prevent Comgate from retrying infinitely
        return new Response("code=0&message=OK", {
            status: 200,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
        })
    }
}
