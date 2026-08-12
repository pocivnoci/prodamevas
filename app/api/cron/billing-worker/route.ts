import { NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"
import { getOwnerEmail } from "@/lib/notifications"
import { enqueueTask } from "@/lib/agent-runner"
import { proposeCustomerNotice } from "@/lib/agents/customer-notices"

export const maxDuration = 300

/**
 * GET /api/cron/billing-worker
 *
 * Denní worker obnov a dunningu (rozvrh ve vercel.json).
 *
 * Běží ve **04:00 UTC, tedy před daily-ops (05:30)** — ranní brief tak hlásí
 * dnešní peníze, ne včerejší. To pořadí hlídá `npm run guard`.
 *
 * Krok 0 (každý běh, všechna aktivní předplatná): posunout propadlá KREDITOVÁ
 * okna. Kreditové okno je měsíční i u ročního plánu, takže se hýbe po vlastní
 * ose — nikdy ho neváž na obnovu.
 *
 * Pak pro každé ACTIVE předplatné, kterému uplynulo `current_period_end`:
 *
 *   0b. Předplatné pohání **Stripe** → přeskočit úplně. Stripe Billing si období
 *      fakturuje sám a obnova přijde jako `invoice.paid` na webhook; strhnout ji
 *      ještě jednou ComGatem znamená dvojí platbu za totéž období.
 *   1. Zákazník předplatné vypověděl (`cancel_at_period_end`) → nechat doběhnout,
 *      označit `expired` a poslat oznámení. Nikdy nestrhávat.
 *   2. Obnova už běží (PENDING `renew-` řádek < 24 h, nebo jakýkoli `renew-` řádek
 *      z dneška) → počkat na callback.
 *   3. Vyčerpaný dunning (`billing_failures >= MAX`) → `expired` + poslední zpráva.
 *   4. Uložený token + COMGATE_RECURRING=1 → strhnout na pozadí. Potvrzení chodí
 *      standardním callbackem, takže aktivace má jednu jedinou kódovou cestu.
 *   5. Jinak → upomínka k ruční obnově.
 *
 * Nakonec projde předplatná, kterým období teprve KONČÍ (do 3 dnů), a pošle
 * oznámení dopředu. Do téhle chvíle přišel první signál až den PO expiraci,
 * což je striktně horší než nic.
 *
 * Každé selhání zakládá řádek v `payments` se stavem FAILED a důvodem od brány.
 * Dřív po neúspěchu nezbylo nic než čítač, takže nešlo zjistit ani proč, ani kdy.
 *
 * `getClientSubscription` drží předplatné použitelné po dobu grace okna
 * (BILLING_GRACE_DAYS), aby výpadek karty nezamkl zákazníka uprostřed dunningu.
 *
 * Auth: CRON_SECRET bearer (v cronu není uživatelská session).
 */
export async function GET(req: Request) {
    const secret = process.env.CRON_SECRET
    const auth = req.headers.get("authorization")
    if (!secret || auth !== `Bearer ${secret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { isRecurringEnabled, chargeRecurring, generateRenewalRefId, isMockPaymentMode } = await import("@/lib/comgate")
    const { MAX_BILLING_FAILURES, rollLapsedCreditWindows } = await import("@/lib/subscription")
    const { resolveTermMonths } = await import("@/lib/billing-period")
    const { termPrice, termLabel, normalizeTermMonths } = await import("@/lib/pricing")

    // 0. Nejdřív posunout každé propadlé KREDITOVÉ okno — nezávisle na tom, jestli
    // je splatná obnova. U ročního plánu je tohle jediné, co kredity resetuje
    // (zaplaceno jednou, kredity dvanáctkrát), a nesmí se přeskočit jen proto, že
    // zaplacené období běží ještě jedenáct měsíců. Selhání tady nesmí zastavit
    // obnovy: stržení je důležitější než persistované okno (čtenáři si ho odvodí).
    let creditWindowsRolled = 0
    try {
        creditWindowsRolled = await rollLapsedCreditWindows()
        if (creditWindowsRolled > 0) console.log(`🔄 billing-worker: ${creditWindowsRolled} kreditových oken posunuto`)
    } catch (err: any) {
        console.error("billing-worker: credit window roll failed:", err?.message)
    }

    const nowIso = new Date().toISOString()
    const { data: dueSubs, error } = await supabaseAdmin
        .from("subscriptions")
        .select("id, client_id, plan_id, current_period_end, recurring_trans_id, billing_failures, cancel_at_period_end, term_months, provider, clients(id, slug, name)")
        .eq("status", "active")
        .lt("current_period_end", nowIso)
        .order("current_period_end", { ascending: true })
        .limit(50)

    if (error) {
        console.error("billing-worker: query failed:", error.message)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    let charged = 0
    let reminded = 0
    let expired = 0
    let waiting = 0
    let cancelled = 0
    let skippedStripe = 0

    for (const sub of dueSubs || []) {
        const client = (Array.isArray(sub.clients) ? sub.clients[0] : sub.clients) as
            | { id: string; slug: string; name: string }
            | null
        if (!client) continue

        // 0b. Stripe si obnovu účtuje sám (`invoice.paid` → webhook). Kdyby ji
        // strhl i tenhle worker, zákazník zaplatí jedno období dvakrát a rozdíl
        // se vrací ručně. Období u Stripe předplatných proto posouvá výhradně
        // webhook — tady se jen nesahá.
        if (sub.provider === "stripe") {
            skippedStripe++
            continue
        }

        try {
            const failures = sub.billing_failures || 0
            const payerEmail = await getOwnerEmail(client.id)
            const notice = (kind: "expired" | "charge_failed" | "manual_renew", dedupeKey: string, vars?: Record<string, unknown>) =>
                proposeCustomerNotice({
                    clientId: client.id,
                    kind,
                    email: payerEmail,
                    dedupeKey,
                    vars: { clientName: client.name, clientId: client.id, ...(vars || {}) },
                })

            // 1. Zákazník vypověděl → období doběhlo, končíme. Nikdy nestrhávat:
            // strhnout peníze někomu, kdo řekl „už ne", je to nejhorší, co umíme.
            if (sub.cancel_at_period_end) {
                await supabaseAdmin
                    .from("subscriptions")
                    .update({ status: "expired", updated_at: new Date().toISOString() })
                    .eq("id", sub.id)
                    .eq("status", "active")
                await notice("expired", `${sub.id}:${sub.current_period_end}`)
                cancelled++
                console.log(`🚪 billing-worker: sub ${sub.id} (${client.slug}) doběhlo po výpovědi`)
                continue
            }

            // 2. Obnova je rozjetá — počkat na callback.
            //
            // Samotné „PENDING < 24 h" nestačí: odmítnutá obnova přejde na
            // CANCELLED a z filtru zmizí, takže by se týž den strhlo znovu.
            // Druhá podmínka (jakýkoli renew- řádek z dneška) je pojistka proti
            // tomu, aby jeden zákazník dostal víc než jeden pokus denně.
            const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
            const midnight = new Date()
            midnight.setUTCHours(0, 0, 0, 0)

            const { data: openRenewal } = await supabaseAdmin
                .from("payments")
                .select("id")
                .eq("subscription_id", sub.id)
                .eq("status", "PENDING")
                .like("ref_id", "renew-%")
                .gte("created_at", dayAgo)
                .limit(1)
                .maybeSingle()

            const { data: todaysAttempt } = openRenewal ? { data: null } : await supabaseAdmin
                .from("payments")
                .select("id")
                .eq("subscription_id", sub.id)
                .like("ref_id", "renew-%")
                .gte("created_at", midnight.toISOString())
                .limit(1)
                .maybeSingle()

            if (openRenewal || todaysAttempt) { waiting++; continue }

            // 3. Dunning vyčerpán → persistovat expiraci + poslední zpráva.
            if (failures >= MAX_BILLING_FAILURES) {
                await supabaseAdmin
                    .from("subscriptions")
                    .update({ status: "expired", updated_at: new Date().toISOString() })
                    .eq("id", sub.id)
                    .eq("status", "active")
                await notice("expired", `${sub.id}:${sub.current_period_end}`)
                expired++
                console.log(`⛔ billing-worker: sub ${sub.id} (${client.slug}) expired after ${failures} failed attempts`)
                continue
            }

            const { data: plan } = await supabaseAdmin
                .from("subscription_plans")
                .select("id, name, price_czk, interval")
                .eq("id", sub.plan_id)
                .single()
            if (!plan || !plan.price_czk) {
                console.warn(`billing-worker: sub ${sub.id} has no billable plan (${sub.plan_id}) — skipping`)
                continue
            }

            // Obnova strhává cenu ZAPLACENÉHO OBDOBÍ, ne měsíční cenu tarifu.
            // `plan.price_czk` je měsíční sazba; roční zákazník by jinak po roce
            // dostal strh na 1 990 místo 19 900 a tiše dostal rok za měsíc.
            const termMonths = resolveTermMonths(plan.interval, sub.term_months)
            const renewalAmount = termPrice(plan.price_czk, normalizeTermMonths(termMonths))

            // 4. Automatická obnova uloženým tokenem.
            if (sub.recurring_trans_id && isRecurringEnabled() && !isMockPaymentMode()) {
                const refId = generateRenewalRefId(client.slug)
                // Plný popisek do `payments.label` (jde na doklad), ořez až do brány.
                const label = `Chrlit ${plan.name} — obnovení ${termLabel(normalizeTermMonths(termMonths))}`
                try {
                    const result = await chargeRecurring({
                        refId,
                        price: renewalAmount,
                        label: label.substring(0, 40),
                        email: payerEmail || "noreply@chrlit.cz",
                        initRecurringId: sub.recurring_trans_id,
                    })
                    if (!result.transId) throw new Error("Comgate nevrátil transId pro recurring charge")

                    const { data: inserted } = await supabaseAdmin.from("payments").insert({
                        client_id: client.id,
                        subscription_id: sub.id,
                        provider: "comgate",
                        comgate_trans_id: result.transId,
                        provider_ref: result.transId,
                        ref_id: refId,
                        amount: renewalAmount,
                        term_months: termMonths,
                        currency: "CZK",
                        status: "PENDING",
                        label,
                        payer_email: payerEmail,
                    }).select("id").maybeSingle()

                    // Kdyby se callback ztratil, zůstane strhnutá platba navždy
                    // v PENDING. Doptání za 20 minut to dohojí samo.
                    if (inserted?.id) {
                        await enqueueTask({
                            type: "payment_reconcile",
                            payload: { paymentId: inserted.id },
                            clientId: client.id,
                            scheduledFor: new Date(Date.now() + 20 * 60_000),
                        })
                    }

                    charged++
                    console.log(`💳 billing-worker: renewal charged for ${client.slug} (${result.transId})`)
                } catch (chargeErr: any) {
                    const attempt = failures + 1
                    // Stopa po selhání. Bez ní zbyl jen čítač a nešlo zjistit proč.
                    // comgate_trans_id zůstává NULL — UNIQUE index NULLů snese kolik chce.
                    await supabaseAdmin.from("payments").insert({
                        client_id: client.id,
                        subscription_id: sub.id,
                        provider: "comgate",
                        ref_id: refId,
                        amount: renewalAmount,
                        term_months: termMonths,
                        currency: "CZK",
                        status: "FAILED",
                        label,
                        payer_email: payerEmail,
                        comgate_response: {
                            source: "chargeRecurring",
                            error: String(chargeErr?.message || chargeErr).slice(0, 500),
                            attempt,
                            at: new Date().toISOString(),
                        },
                    })
                    await bumpFailures(sub.id, failures)
                    await notice("charge_failed", `${sub.id}:${attempt}`, { attempt })
                    console.warn(`⚠️ billing-worker: recurring charge failed for ${client.slug}: ${chargeErr?.message}`)
                }
                continue
            }

            // 5. Bez tokenu → upomínka k ruční obnově (počítá se do dunningu).
            await bumpFailures(sub.id, failures)
            await notice("manual_renew", `${sub.id}:${failures + 1}`)
            reminded++
        } catch (subErr: any) {
            console.warn(`billing-worker: sub ${sub.id} threw:`, subErr?.message)
        }
    }

    // 6. Oznámení DOPŘEDU pro předplatná, kterým období teprve končí. Až sem,
    // protože splatné obnovy jsou důležitější a nesmí je zdržet upomínka.
    let upcoming = { notified: 0, duplicates: 0 }
    try {
        const { notifyUpcomingRenewals } = await import("@/lib/agents/billing-watch")
        upcoming = await notifyUpcomingRenewals()
    } catch (err: any) {
        console.error("billing-worker: oznámení o nadcházejících obnovách selhalo:", err?.message)
    }

    console.log(`💳 billing-worker: ${charged} charged, ${reminded} reminded, ${expired} expired, ${cancelled} ended after cancellation, ${waiting} in-flight, ${skippedStripe} driven by Stripe, ${upcoming.notified} pre-notified, ${creditWindowsRolled} credit windows rolled`)
    return NextResponse.json({ success: true, charged, reminded, expired, cancelled, waiting, skippedStripe, upcoming, creditWindowsRolled })
}

async function bumpFailures(subId: string, current: number): Promise<void> {
    await supabaseAdmin
        .from("subscriptions")
        .update({ billing_failures: current + 1, updated_at: new Date().toISOString() })
        .eq("id", subId)
}
