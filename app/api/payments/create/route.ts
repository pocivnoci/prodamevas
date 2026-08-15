/**
 * POST /api/payments/create
 * 
 * Creates a Comgate payment + records it in DB.
 * Returns redirect URL for the client to complete payment.
 * 
 * Body: { clientSlug, planId, email, termMonths }
 */

import { NextRequest, NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"
import { createPayment, generateRefId, isMockPaymentMode, isRecurringEnabled } from "@/lib/comgate"
import { activeGateway, createStripeCheckout, paymentLabel } from "@/lib/payments/checkout"
import { enqueueTask } from "@/lib/agent-runner"
import { CONSULTATION, EXTRA_CREDIT_HALERU, creditPackPrice, normalizeTermMonths, parseCreditPack, termPrice } from "@/lib/pricing"

/**
 * Cena jednoho dokoupeného kreditu podle TARIFU klienta.
 *
 * Musí sedět s tím, co aplikace slibuje v hlášce „dobijte si kredity za X/ks" —
 * ta ji čte z `features.extra_credit_price`. Kdyby si routa držela vlastní
 * konstantu, dřív nebo později by účtovala jinou částku, než jakou zákazník viděl.
 */
async function extraCreditPriceFor(clientId: string): Promise<number> {
    const { data } = await supabaseAdmin
        .from("subscriptions")
        .select("subscription_plans(features)")
        .eq("client_id", clientId)
        .in("status", ["active", "trialing"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    const plan = (Array.isArray(data?.subscription_plans) ? data?.subscription_plans[0] : data?.subscription_plans) as
        | { features?: { extra_credit_price?: number } }
        | undefined
    return plan?.features?.extra_credit_price || EXTRA_CREDIT_HALERU
}

export async function POST(req: NextRequest) {
    const { requireAuth } = await import("@/lib/auth-guard")
    try { await requireAuth() } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }

    try {
        const body = await req.json()
        const { clientSlug, clientId, planId, email } = body
        // Období z klienta se nikdy nebere doslova: cokoliv mimo 3/6/12 je měsíc.
        // Podvržené `termMonths` by jinak koupilo rok za měsíční cenu.
        const termMonths = normalizeTermMonths(body.termMonths)

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

        // 2. Get plan — nebo jednorázová služba, která žádný tarif neaktivuje.
        //
        // Služba není řádek v `subscription_plans` a být nesmí: nemá kredity,
        // období ani obnovu, a `/api/plans` by ji vysypalo na ceník jako pátý
        // tarif. Definice žije v lib/pricing.ts, cesta k penězům je společná,
        // aby se na doklad nezapomnělo právě u ní.
        const isService = planId === CONSULTATION.id
        // Balíček kreditů: `kredity-25`. Cena za kredit se bere z TARIFU klienta
        // (`extra_credit_price`), ne z konstanty — ceník kreditů je vlastnost
        // tarifu a musí sedět s tím, co aplikace slibuje v hlášce o nedostatku.
        const creditPack = parseCreditPack(planId)
        const unitPrice = creditPack ? await extraCreditPriceFor(client.id) : EXTRA_CREDIT_HALERU

        const plan = isService
            ? { id: CONSULTATION.id, name: CONSULTATION.name, price_czk: CONSULTATION.priceHaleru }
            : creditPack
                ? { id: planId, name: `${creditPack} kreditů`, price_czk: creditPackPrice(creditPack, unitPrice) }
                : (await supabaseAdmin
                    .from("subscription_plans")
                    .select("*")
                    .eq("id", planId)
                    .eq("is_active", true)
                    .single()).data

        if (!plan) {
            return NextResponse.json({ error: "Plan not found" }, { status: 404 })
        }

        // Službu si nemá smysl kupovat dvakrát — a hlavně ne, když už na ni má
        // nárok z předplatného na 6 nebo 12 měsíců.
        if (isService) {
            const { pendingConsultation } = await import("@/lib/consultations")
            const existing = await pendingConsultation(client.id)
            if (existing) {
                return NextResponse.json(
                    { error: "Nastavení značky už máte — stačí si vybrat termín.", alreadyOwned: true },
                    { status: 409 },
                )
            }
        }

        // 3. Create payment (mock or real Comgate)
        // ── Výběr brány ────────────────────────────────────────────────────────
        // UI o branách nic neví (viz lib/payments/checkout.ts). Když je aktivní
        // Stripe, celá zbývající ComGate větev se přeskočí — druhá brána tak
        // nepotřebuje vlastní tlačítko ani vlastní cestu z Reactu.
        if (activeGateway() === "stripe") {
            const result = await createStripeCheckout({
                client, plan, payerEmail, termMonths,
                kind: creditPack ? "credits" : isService ? "service" : "subscription",
                creditsGranted: creditPack ?? undefined,
                // Klient si řekne o vestavěnou pokladnu; ComGate ji neumí, takže
                // se přání uplatní jen na Stripe větvi. Když ji nechce (nebo běží
                // druhá brána), zůstává hostovaná varianta s přesměrováním.
                embedded: body.embedded === true,
            })
            return NextResponse.json({
                success: true, gateway: "stripe",
                transId: result.providerRef, redirect: result.redirectUrl, redirectUrl: result.redirectUrl,
                clientSecret: result.clientSecret,
            })
        }

        const refId = generateRefId(client.slug)
        // U tarifu je `price_czk` MĚSÍČNÍ cena a cena období z ní vzniká tady,
        // jednou, sdíleným pravidlem. Služba se platí celá a období nemá.
        const amount = isService || creditPack ? plan.price_czk : termPrice(plan.price_czk, termMonths)
        // Do `payments.label` jde plný popisek (skončí jako položka na dokladu),
        // do ComGate až jeho 40znakový ořez.
        const label = isService ? `Chrlit — ${CONSULTATION.name}`
            : creditPack ? `Chrlit — dobití ${creditPack} kreditů`
            : paymentLabel(plan.name, termMonths)

        const isMock = isMockPaymentMode()

        let transId: string
        let redirectUrl: string

        if (isMock) {
            // Mock mode: skip Comgate, redirect to mock payment page
            transId = `MOCK-${Date.now()}`
            const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://chrlit.cz"
            redirectUrl = `${baseUrl}/mock-payment?transId=${transId}&amount=${amount}&label=${encodeURIComponent(label.substring(0, 40))}&clientId=${client.id}`
            console.log(`💳 [MOCK] Payment created: ${transId} for ${client.name}`)
        } else {
            const comgateResult = await createPayment({
                refId,
                price: amount,
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

        // 4. Create subscription (pending) — jen u tarifu.
        // Služba žádné předplatné nezakládá: pending řádek bez tarifu by se
        // pletl do `pickLiveSubscription` a zamaskoval by zákazníkovi jeho
        // skutečný plán.
        const { data: subscription } = isService || creditPack
            ? { data: null }
            : await supabaseAdmin
                .from("subscriptions")
                .insert({
                    client_id: client.id,
                    plan_id: planId,
                    status: "pending",
                    // Aktivace po zaplacení z tohohle sloupce spočítá délku období.
                    term_months: termMonths,
                    provider: "comgate",
                })
                .select("id")
                .single()

        // 5. Record payment
        const { data: payment } = await supabaseAdmin
            .from("payments")
            .insert({
                client_id: client.id,
                subscription_id: subscription?.id,
                provider: "comgate",
                comgate_trans_id: transId,
                provider_ref: transId,
                ref_id: refId,
                amount,
                currency: "CZK",
                status: "PENDING",
                label,
                // Druh rozhoduje, jestli se po zaplacení aktivuje tarif, nebo
                // odemkne rezervace. Doklad se vystaví tak jako tak.
                kind: creditPack ? "credits" : isService ? "service" : "subscription",
                credits_granted: creditPack ?? null,
                term_months: isService || creditPack ? null : termMonths,
                payer_email: payerEmail,
            })
            .select("id")
            .maybeSingle()

        // 6. Pojistka proti ztracenému callbacku: za 20 minut se brány doptáme
        // sami. Bez ní zůstane zaplacená platba navždy v PENDING — zákazník
        // zaplatil a plán se neaktivoval, a nikdo se to nedozví.
        if (!isMock && payment?.id) {
            await enqueueTask({
                type: "payment_reconcile",
                payload: { paymentId: payment.id },
                clientId: client.id,
                scheduledFor: new Date(Date.now() + 20 * 60_000),
            })
        }

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
