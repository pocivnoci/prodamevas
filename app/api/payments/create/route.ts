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
import { createPayment, generateRefId, isMockPaymentMode, isRecurringEnabled } from "@/lib/comgate"

export async function POST(req: NextRequest) {
    const { requireAuth } = await import("@/lib/auth-guard")
    try { await requireAuth() } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }

    try {
        const body = await req.json()
        const { clientSlug, clientId, planId, email } = body

        if (!planId || (!clientSlug && !clientId)) {
            return NextResponse.json(
                { error: "Missing required fields: planId and (clientSlug or clientId)" },
                { status: 400 }
            )
        }

        // 1. Resolve client (by slug or UUID)
        let clientQuery = supabaseAdmin
            .from("clients")
            .select("id, slug, name")

        if (clientId) {
            clientQuery = clientQuery.eq("id", clientId)
        } else {
            clientQuery = clientQuery.eq("slug", clientSlug)
        }

        const { data: client } = await clientQuery.single()

        if (!client) {
            return NextResponse.json({ error: "Client not found" }, { status: 404 })
        }

        // Caller must be a member of the client they are paying for
        const { requireClientAccess } = await import("@/lib/auth-guard")
        try { await requireClientAccess(client.id) } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 403 }) }

        // Get payer email from user_clients → auth.users if not provided
        let payerEmail = email
        if (!payerEmail) {
            const { data: link } = await supabaseAdmin
                .from("user_clients")
                .select("user_id")
                .eq("client_id", client.id)
                .eq("role", "owner")
                .limit(1)
                .single()
            if (link) {
                const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(link.user_id)
                payerEmail = user?.email || "unknown@chrlit.cz"
            }
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

        // 3. Create payment (mock or real Comgate)
        const refId = generateRefId(client.slug)
        const label = `${plan.name} — ${client.name}`

        const isMock = isMockPaymentMode()

        let transId: string
        let redirectUrl: string

        if (isMock) {
            // Mock mode: skip Comgate, redirect to mock payment page
            transId = `MOCK-${Date.now()}`
            const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://chrlit.cz"
            redirectUrl = `${baseUrl}/mock-payment?transId=${transId}&amount=${plan.price_czk}&label=${encodeURIComponent(label.substring(0, 40))}&clientId=${client.id}`
            console.log(`💳 [MOCK] Payment created: ${transId} for ${client.name}`)
        } else {
            const comgateResult = await createPayment({
                refId,
                price: plan.price_czk,
                curr: "CZK",
                label: label.substring(0, 40),
                email: payerEmail || "noreply@chrlit.cz",
                // Init a recurring series so the billing worker can auto-renew month 2+.
                // Gated on COMGATE_RECURRING=1 (needs the merchant contract) — without it
                // the flag would fail payment creation entirely.
                initRecurring: isRecurringEnabled(),
            })

            if (!comgateResult.transId || !comgateResult.redirect) {
                throw new Error("Comgate didn't return transId or redirect URL")
            }

            transId = comgateResult.transId
            redirectUrl = comgateResult.redirect
            console.log(`💳 Payment created: ${transId} for ${client.name} (${plan.name})`)
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
                comgate_trans_id: transId,
                ref_id: refId,
                amount: plan.price_czk,
                currency: "CZK",
                status: "PENDING",
                label,
                payer_email: payerEmail,
            })

        return NextResponse.json({
            success: true,
            transId,
            redirect: redirectUrl,
            redirectUrl,
        })
    } catch (err: any) {
        console.error("Payment create error:", err?.message || err)
        return NextResponse.json(
            { error: err?.message || "Payment creation failed" },
            { status: 500 }
        )
    }
}
