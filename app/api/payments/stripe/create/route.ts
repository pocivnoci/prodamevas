/**
 * POST /api/payments/stripe/create
 *
 * Vynutí Stripe bez ohledu na `activeGateway()` — pro testování druhé brány
 * a pro případ, kdy chceš konkrétnímu zákazníkovi poslat Stripe odkaz.
 *
 * Běžná cesta z UI vede přes `/api/payments/create`, které bránu vybírá samo.
 * Vlastní logika žije v `lib/payments/checkout.ts`, aby obě cesty zakládaly
 * platbu identicky.
 */

import { NextRequest, NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"
import { createStripeCheckout } from "@/lib/payments/checkout"
import { isStripeConfigured } from "@/lib/payments/stripe"
import { normalizeTermMonths } from "@/lib/pricing"

export async function POST(req: NextRequest) {
    const { requireAuth } = await import("@/lib/auth-guard")
    try { await requireAuth() } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }

    if (!isStripeConfigured()) {
        return NextResponse.json({ error: "Stripe není nakonfigurovaná" }, { status: 503 })
    }

    try {
        const { clientSlug, clientId, planId, email, termMonths } = await req.json()
        if ((!clientSlug && !clientId) || !planId) {
            return NextResponse.json({ error: "Chybí clientSlug/clientId nebo planId" }, { status: 400 })
        }
        // Období z requestu se nikdy nebere doslova — cokoliv mimo 3/6/12 je měsíc.
        const term = normalizeTermMonths(termMonths)

        const q = clientId
            ? supabaseAdmin.from("clients").select("id, slug, name").eq("id", clientId)
            : supabaseAdmin.from("clients").select("id, slug, name").eq("slug", clientSlug)
        const { data: client } = await q.single()
        if (!client) return NextResponse.json({ error: "Klient nenalezen" }, { status: 404 })

        const { requireClientAccess } = await import("@/lib/auth-guard")
        try { await requireClientAccess(client.id) } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 403 }) }

        // Tabulka se jmenuje `subscription_plans`, ne `plans` — a filtr na
        // is_active je tu ze stejného důvodu jako u ComGate: neaktivní tarif se
        // nesmí dát koupit ani přímým odkazem.
        const { data: plan } = await supabaseAdmin
            .from("subscription_plans").select("id, name, price_czk")
            .eq("id", planId).eq("is_active", true).single()
        if (!plan) return NextResponse.json({ error: "Plán nenalezen" }, { status: 404 })

        let payerEmail: string | null = email || null
        if (!payerEmail) {
            const { data: link } = await supabaseAdmin
                .from("user_clients").select("user_id").eq("client_id", client.id).limit(1).maybeSingle()
            if (link?.user_id) {
                const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(link.user_id)
                payerEmail = user?.email ?? null
            }
        }

        const result = await createStripeCheckout({ client, plan, payerEmail, termMonths: term })
        return NextResponse.json({ success: true, sessionId: result.providerRef, redirect: result.redirectUrl, redirectUrl: result.redirectUrl })
    } catch (err: any) {
        console.error("Stripe create error:", err?.message || err)
        return NextResponse.json({ error: err?.message || "Založení platby selhalo" }, { status: 500 })
    }
}
