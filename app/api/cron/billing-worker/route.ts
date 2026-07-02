import { NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"

export const maxDuration = 300

/**
 * GET /api/cron/billing-worker
 *
 * Daily renewal + dunning worker (see vercel.json). For every ACTIVE subscription
 * whose current_period_end has passed:
 *
 *   1. If a renewal payment is already PENDING (< 24h old) → wait for the callback.
 *   2. If the sub has a recurring token (Comgate initRecurring) and COMGATE_RECURRING=1
 *      → charge a background renewal (chargeRecurring). The standard payment callback
 *      confirms it and extends the period via activatePaidPlan — same path as the
 *      first payment, so there is exactly ONE activation code path.
 *   3. Otherwise (no token / recurring disabled) → e-mail a manual-renewal reminder.
 *   4. Each failed/missed attempt increments billing_failures; after
 *      MAX_BILLING_FAILURES the sub is persisted as expired + final e-mail.
 *
 * getClientSubscription keeps the sub usable during the grace window
 * (BILLING_GRACE_DAYS) so a card hiccup doesn't lock the customer out mid-dunning.
 *
 * Auth: CRON_SECRET bearer (no user session in a cron).
 */
export async function GET(req: Request) {
    const secret = process.env.CRON_SECRET
    const auth = req.headers.get("authorization")
    if (!secret || auth !== `Bearer ${secret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { isRecurringEnabled, chargeRecurring, generateRenewalRefId, isMockPaymentMode } = await import("@/lib/comgate")
    const { MAX_BILLING_FAILURES } = await import("@/lib/subscription")

    const nowIso = new Date().toISOString()
    const { data: dueSubs, error } = await supabaseAdmin
        .from("subscriptions")
        .select("id, client_id, plan_id, current_period_end, recurring_trans_id, billing_failures, clients(id, slug, name)")
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

    for (const sub of dueSubs || []) {
        const client = (Array.isArray(sub.clients) ? sub.clients[0] : sub.clients) as
            | { id: string; slug: string; name: string }
            | null
        if (!client) continue

        try {
            // 1. A renewal is already in flight — the callback will finish it.
            const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
            const { data: openRenewal } = await supabaseAdmin
                .from("payments")
                .select("id")
                .eq("subscription_id", sub.id)
                .eq("status", "PENDING")
                .like("ref_id", "renew-%")
                .gte("created_at", dayAgo)
                .limit(1)
                .maybeSingle()
            if (openRenewal) { waiting++; continue }

            const failures = sub.billing_failures || 0
            const payerEmail = await getOwnerEmail(client.id)

            // 2. Dunning exhausted → persist expiry + final notice.
            if (failures >= MAX_BILLING_FAILURES) {
                await supabaseAdmin
                    .from("subscriptions")
                    .update({ status: "expired", updated_at: new Date().toISOString() })
                    .eq("id", sub.id)
                    .eq("status", "active")
                await notify(payerEmail, "Vaše předplatné Chrlit vypršelo", expiredEmailHtml(client.name))
                expired++
                console.log(`⛔ billing-worker: sub ${sub.id} (${client.slug}) expired after ${failures} failed attempts`)
                continue
            }

            const { data: plan } = await supabaseAdmin
                .from("subscription_plans")
                .select("id, name, price_czk")
                .eq("id", sub.plan_id)
                .single()
            if (!plan || !plan.price_czk) {
                console.warn(`billing-worker: sub ${sub.id} has no billable plan (${sub.plan_id}) — skipping`)
                continue
            }

            // 3. Auto-renew via the stored recurring token.
            if (sub.recurring_trans_id && isRecurringEnabled() && !isMockPaymentMode()) {
                const refId = generateRenewalRefId(client.slug)
                const label = `${plan.name} — obnovení`.substring(0, 40)
                try {
                    const result = await chargeRecurring({
                        refId,
                        price: plan.price_czk,
                        label,
                        email: payerEmail || "noreply@chrlit.cz",
                        initRecurringId: sub.recurring_trans_id,
                    })
                    if (!result.transId) throw new Error("Comgate nevrátil transId pro recurring charge")

                    await supabaseAdmin.from("payments").insert({
                        client_id: client.id,
                        subscription_id: sub.id,
                        comgate_trans_id: result.transId,
                        ref_id: refId,
                        amount: plan.price_czk,
                        currency: "CZK",
                        status: "PENDING",
                        label,
                        payer_email: payerEmail,
                    })
                    charged++
                    console.log(`💳 billing-worker: renewal charged for ${client.slug} (${result.transId})`)
                } catch (chargeErr: any) {
                    await bumpFailures(sub.id, failures)
                    await notify(
                        payerEmail,
                        "Platba za Chrlit se nezdařila",
                        failedChargeEmailHtml(client.name, failures + 1),
                    )
                    console.warn(`⚠️ billing-worker: recurring charge failed for ${client.slug}: ${chargeErr?.message}`)
                }
                continue
            }

            // 4. No recurring token → manual renewal reminder (counts toward dunning).
            await bumpFailures(sub.id, failures)
            await notify(payerEmail, "Obnovte si předplatné Chrlit", manualRenewEmailHtml(client.name))
            reminded++
        } catch (subErr: any) {
            console.warn(`billing-worker: sub ${sub.id} threw:`, subErr?.message)
        }
    }

    console.log(`💳 billing-worker: ${charged} charged, ${reminded} reminded, ${expired} expired, ${waiting} in-flight`)
    return NextResponse.json({ success: true, charged, reminded, expired, waiting })
}

async function bumpFailures(subId: string, current: number): Promise<void> {
    await supabaseAdmin
        .from("subscriptions")
        .update({ billing_failures: current + 1, updated_at: new Date().toISOString() })
        .eq("id", subId)
}

/** Owner e-mail resolution mirrors payments/create: user_clients owner → auth user. */
async function getOwnerEmail(clientId: string): Promise<string | null> {
    const { data: link } = await supabaseAdmin
        .from("user_clients")
        .select("user_id")
        .eq("client_id", clientId)
        .eq("role", "owner")
        .limit(1)
        .maybeSingle()
    if (!link) return null
    const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(link.user_id)
    return user?.email || null
}

/** Best-effort e-mail — billing must never fail because Resend is down/unconfigured. */
async function notify(to: string | null, subject: string, html: string): Promise<void> {
    if (!to) return
    try {
        const { sendEmail } = await import("@/lib/email")
        await sendEmail({ to, subject, html })
    } catch (err: any) {
        console.warn(`billing-worker: e-mail to ${to} failed: ${err?.message}`)
    }
}

const APP_URL = () => process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://chrlit.cz"

function manualRenewEmailHtml(clientName: string): string {
    return `<p>Dobrý den,</p>
<p>měsíční předplatné pro <strong>${clientName}</strong> právě doběhlo. Aby generování příspěvků pokračovalo bez přerušení, obnovte si prosím plán jedním kliknutím v aplikaci:</p>
<p><a href="${APP_URL()}/dashboard/instagram">Obnovit předplatné →</a></p>
<p>Tým Chrlit</p>`
}

function failedChargeEmailHtml(clientName: string, attempt: number): string {
    return `<p>Dobrý den,</p>
<p>automatická platba za předplatné <strong>${clientName}</strong> se nezdařila (pokus ${attempt}/3). Zkusíme to znovu zítra — zkontrolujte prosím platební kartu, případně obnovte plán ručně:</p>
<p><a href="${APP_URL()}/dashboard/instagram">Zkontrolovat předplatné →</a></p>
<p>Tým Chrlit</p>`
}

function expiredEmailHtml(clientName: string): string {
    return `<p>Dobrý den,</p>
<p>předplatné pro <strong>${clientName}</strong> vypršelo — platbu se nepodařilo dokončit ani po opakovaných pokusech. Vaše data i vygenerovaný obsah zůstávají zachovány; generování se znovu spustí hned po obnovení plánu:</p>
<p><a href="${APP_URL()}/dashboard/instagram">Obnovit předplatné →</a></p>
<p>Tým Chrlit</p>`
}
