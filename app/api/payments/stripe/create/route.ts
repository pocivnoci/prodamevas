/**
 * POST /api/payments/stripe/create
 *
 * Založí Stripe Checkout Session a k ní PENDING řádek v `payments`.
 * Vrací redirect URL, na kterou se prohlížeč pošle.
 *
 * Zrcadlí `app/api/payments/create/route.ts` (ComGate) záměrně co nejtěsněji —
 * druhá brána nesmí být druhá kódová cesta. Co se skutečně liší, je **jen lokátor
 * stavu**: ComGate zabírá řádek přes `comgate_trans_id`, Stripe přes
 * `provider_ref` = id Checkout Session (známé už při založení, takže ho webhook
 * najde bez ohledu na to, kdy dorazí). Všechno po claimu je sdílené jádro
 * `lib/payments/on-paid.ts`.
 *
 * ⚠️ Obnovy tudy NEVEDOU. Tohle je jednorázová platba; druhý měsíc řeší stávající
 *    billing-worker stejně jako u ComGate. Rozhodnutí Stripe Billing vs vlastní
 *    dunning je schválně odložené — nepotřebuješ ho, abys vzal PRVNÍ platbu, a
 *    první obnova je až za měsíc.
 */

import { NextRequest, NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"
import { getStripe, isStripeConfigured, isStripeSandbox } from "@/lib/payments/stripe"
import { generateRefId } from "@/lib/comgate"

export async function POST(req: NextRequest) {
    const { requireAuth } = await import("@/lib/auth-guard")
    try { await requireAuth() } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }

    if (!isStripeConfigured()) {
        return NextResponse.json({ error: "Stripe není nakonfigurovaná" }, { status: 503 })
    }

    try {
        const body = await req.json()
        const { clientSlug, clientId, planId, email } = body

        if ((!clientSlug && !clientId) || !planId) {
            return NextResponse.json({ error: "Chybí clientSlug/clientId nebo planId" }, { status: 400 })
        }

        const clientQuery = clientId
            ? supabaseAdmin.from("clients").select("id, slug, name").eq("id", clientId)
            : supabaseAdmin.from("clients").select("id, slug, name").eq("slug", clientSlug)
        const { data: client } = await clientQuery.single()
        if (!client) return NextResponse.json({ error: "Klient nenalezen" }, { status: 404 })

        const { requireClientAccess } = await import("@/lib/auth-guard")
        try { await requireClientAccess(client.id) } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 403 }) }

        const { data: plan } = await supabaseAdmin
            .from("plans")
            .select("id, name, price_czk")
            .eq("id", planId)
            .single()
        if (!plan) return NextResponse.json({ error: "Plán nenalezen" }, { status: 404 })

        // Odesílatel platby — stejné pořadí zdrojů jako u ComGate.
        let payerEmail: string | null = email || null
        if (!payerEmail) {
            const { data: link } = await supabaseAdmin
                .from("user_clients").select("user_id").eq("client_id", client.id).limit(1).maybeSingle()
            if (link?.user_id) {
                const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(link.user_id)
                payerEmail = user?.email ?? null
            }
        }

        const refId = generateRefId(client.slug)
        const label = `${plan.name} — ${client.name}`
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://chrlit.cz"

        // `plans.price_czk` drží HALÉŘE (stejně jako `payments.amount`, které do
        // Comgate jdou taky v haléřích). Stripe chce nejmenší jednotku měny, takže
        // se hodnota předává beze změny — žádné násobení stem.
        const session = await getStripe().checkout.sessions.create({
            mode: "payment",
            line_items: [{
                quantity: 1,
                price_data: {
                    currency: "czk",
                    unit_amount: plan.price_czk,
                    product_data: { name: label },
                },
            }],
            ...(payerEmail ? { customer_email: payerEmail } : {}),
            client_reference_id: refId,
            // Webhook z toho pozná tenanta i plán, aniž by musel dohledávat.
            metadata: { clientId: client.id, clientSlug: client.slug, planId, refId },
            success_url: `${baseUrl}/dashboard/instagram?platba=ok`,
            cancel_url: `${baseUrl}/dashboard/instagram?platba=zrusena`,
        })

        if (!session.id || !session.url) throw new Error("Stripe nevrátil session id nebo URL")

        const { data: subscription } = await supabaseAdmin
            .from("subscriptions")
            .insert({ client_id: client.id, plan_id: planId, status: "pending" })
            .select("id")
            .single()

        // provider_ref = id Session. Unikátní index (provider, provider_ref) z
        // migrace 20260810 je nárok na zpracování — replay webhooku claim nevrátí
        // a je konec. Nikdy insert fallback.
        await supabaseAdmin.from("payments").insert({
            client_id: client.id,
            subscription_id: subscription?.id,
            provider: "stripe",
            provider_ref: session.id,
            ref_id: refId,
            amount: plan.price_czk,
            currency: "CZK",
            status: "PENDING",
            label,
            payer_email: payerEmail,
        })

        console.log(`💳 [stripe/${isStripeSandbox() ? "sandbox" : "LIVE"}] Session ${session.id} pro ${client.name} (${plan.name})`)

        return NextResponse.json({ success: true, sessionId: session.id, redirect: session.url, redirectUrl: session.url })
    } catch (err: any) {
        console.error("Stripe create error:", err?.message || err)
        return NextResponse.json({ error: err?.message || "Založení platby selhalo" }, { status: 500 })
    }
}
