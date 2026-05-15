/**
 * POST /api/payments/create
 * 
 * Creates a Comgate payment + records it in DB.
 * Returns redirect URL for the client to complete payment.
 * 
 * Body: { clientSlug, planId, email }
 */

import { NextRequest, NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"
import { createPayment, generateRefId } from "@/lib/comgate"

export async function POST(req: NextRequest) {
    try {
        const { clientSlug, planId, email } = await req.json()

        if (!clientSlug || !planId || !email) {
            return NextResponse.json(
                { error: "Missing required fields: clientSlug, planId, email" },
                { status: 400 }
            )
        }

        // 1. Resolve client
        const { data: client } = await supabaseAdmin
            .from("clients")
            .select("id, slug, name")
            .eq("slug", clientSlug)
            .single()

        if (!client) {
            return NextResponse.json({ error: "Client not found" }, { status: 404 })
        }

        // 2. Get plan
        const { data: plan } = await supabaseAdmin
            .from("subscription_plans")
            .select("*")
            .eq("id", planId)
            .eq("is_active", true)
            .single()

        if (!plan) {
            return NextResponse.json({ error: "Plan not found" }, { status: 404 })
        }

        // 3. Create payment via Comgate
        const refId = generateRefId(clientSlug)
        const label = `${plan.name} — ${client.name}`

        const comgateResult = await createPayment({
            refId,
            price: plan.price_czk,
            curr: "CZK",
            label: label.substring(0, 40), // Comgate label max ~40 chars
            email,
        })

        if (!comgateResult.transId || !comgateResult.redirect) {
            throw new Error("Comgate didn't return transId or redirect URL")
        }

        // 4. Create subscription (pending)
        const { data: subscription } = await supabaseAdmin
            .from("subscriptions")
            .insert({
                client_id: client.id,
                plan_id: planId,
                status: "pending",
            })
            .select("id")
            .single()

        // 5. Record payment
        await supabaseAdmin
            .from("payments")
            .insert({
                client_id: client.id,
                subscription_id: subscription?.id,
                comgate_trans_id: comgateResult.transId,
                ref_id: refId,
                amount: plan.price_czk,
                currency: "CZK",
                status: "PENDING",
                label,
                payer_email: email,
                comgate_response: comgateResult,
            })

        console.log(`💳 Payment created: ${comgateResult.transId} for ${client.name} (${plan.name})`)

        return NextResponse.json({
            success: true,
            transId: comgateResult.transId,
            redirect: comgateResult.redirect,
        })
    } catch (err: any) {
        console.error("Payment create error:", err?.message || err)
        return NextResponse.json(
            { error: err?.message || "Payment creation failed" },
            { status: 500 }
        )
    }
}
