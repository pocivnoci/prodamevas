/**
 * Co se stane, když platba dojde — nezávisle na platební bráně.
 * =============================================================
 * Aktivace plánu, uložení tokenu pro obnovy, vystavení daňového dokladu
 * a potvrzovací e-mail. **Tohle je jediné místo, kde ta logika žije** —
 * ComGate callback i Stripe webhook ji volají, takže druhá brána neznamená
 * druhou kódovou cestu (a tedy ani druhé místo, kde se zapomene na doklad).
 *
 * Co záměrně NENÍ tady, protože se to mezi branami skutečně liší:
 *  - parsování a **serverové ověření** stavu platby (jiné API, jiný podpis).
 *
 * Volající tedy nejdřív ověří, co brána řekla, a pak předá výsledek do
 * `applyGatewayStatus` — ta zabere řádek a rozhodne, co se stane dál. Zabrání
 * je tady (a ne u volajících) proto, že volající jsou dnes tři: ComGate
 * callback, Stripe webhook a reconciler zaseklých plateb. Tři kopie téhož
 * podmíněného UPDATE by dřív nebo později přestaly být tytéž.
 *
 * Rozdělení na `finalizePaidPayment` (synchronně, kritické) a
 * `deliverPaidArtifacts` (odloženě, best-effort) je úmyslné: brána musí
 * dostat ACK okamžitě, ale aktivace plánu se odkládat nesmí.
 */

import { after } from "next/server"
import supabaseAdmin from "@/supabase/admin"
// Konvence refId, ne klient brány — jádro nesmí záviset na jedné z bran.
import { isRenewalRefId } from "@/lib/payments/ref-id"

export type PaymentProvider = "comgate" | "stripe"

/** Sloupce z `payments`, které jádro potřebuje. */
export interface PaidPaymentRow {
    id: string
    subscription_id: string | null
    client_id: string
    ref_id?: string | null
    payer_email?: string | null
    amount: number
    currency?: string | null
    label?: string | null
}

export interface FinalizeOptions {
    provider: PaymentProvider
    /** Obnova předplatného (nikoli první platba) — mění text e-mailu i uložení tokenu. */
    isRenewal: boolean
    /**
     * Identifikátor, na který se budou odkazovat budoucí automatické obnovy.
     * U ComGate je to transId PRVNÍ platby v sérii; u Stripe se obnovy řeší
     * na jeho straně, takže se nepředává. Ukládá se jen u první platby.
     */
    recurringToken?: string | null
    /**
     * Platba nepřišla z ostré brány (mock ComGate, Stripe `sk_test_`).
     * Ví to **jen route** — jádro nesmí znát konkrétní bránu, aby ji mohlo
     * obsloužit obě. Propaguje se do `FinalizeResult`, protože doklad se
     * vystavuje až v `deliverPaidArtifacts`, a na fiktivní platbu se
     * vystavit nesmí (číselná řada je nevratná).
     */
    sandbox?: boolean
}

export interface FinalizeResult {
    /** false = plán se NEPODAŘILO aktivovat. Zaplacený a neaktivovaný zákazník je nejhorší stav. */
    activated: boolean
    planId: string
    isRenewal: boolean
    /** Přeneseno z `FinalizeOptions` — rozhoduje, jestli se smí sáhnout na ostrou fakturaci. */
    sandbox: boolean
}

/** Legacy fallback pro platby bez navázaného předplatného. */
const LEGACY_PLAN_ID = "chrlit"

/**
 * Aktivuje zaplacený plán. Volá se **po** úspěšném zabrání stavu, takže se na
 * jednu platbu provede právě jednou.
 */
export async function finalizePaidPayment(
    payment: PaidPaymentRow,
    opts: FinalizeOptions
): Promise<FinalizeResult> {
    // Zakoupený plán visí na pending předplatném založeném při vytvoření platby;
    // obnovy odkazují přímo na živé předplatné.
    let planId = LEGACY_PLAN_ID
    if (payment.subscription_id) {
        const { data: sub } = await supabaseAdmin
            .from("subscriptions")
            .select("plan_id")
            .eq("id", payment.subscription_id)
            .single()
        if (sub?.plan_id) planId = sub.plan_id
    }

    try {
        const { activatePaidPlan } = await import("@/lib/subscription")
        await activatePaidPlan(payment.client_id, planId, payment.subscription_id || undefined)
        console.log(`✅ Plán „${planId}" ${opts.isRenewal ? "obnoven" : "aktivován"} pro klienta ${payment.client_id}`)
    } catch (err: any) {
        // Zaplaceno a neaktivováno je nejhorší možný stav — křičet nahlas.
        // Řádek platby zůstává PAID, aby šla oprava provést ručně.
        console.error(`🚨 activatePaidPlan SELHALO pro zaplacenou platbu ${payment.id} (klient ${payment.client_id}):`, err?.message)
        try {
            const Sentry = await import("@sentry/nextjs")
            Sentry.captureException(err, {
                tags: { area: "payments", provider: opts.provider },
                extra: { paymentId: payment.id, clientId: payment.client_id, planId },
            })
        } catch { /* Sentry je volitelný */ }
        return { activated: false, planId, isRenewal: opts.isRenewal, sandbox: Boolean(opts.sandbox) }
    }

    // Úspěšná platba nuluje dunning a u PRVNÍ platby uloží token pro obnovy.
    if (payment.subscription_id) {
        const update: Record<string, unknown> = {
            billing_failures: 0,
            updated_at: new Date().toISOString(),
        }
        if (!opts.isRenewal && opts.recurringToken) {
            update.recurring_trans_id = opts.recurringToken
        }
        await supabaseAdmin.from("subscriptions").update(update).eq("id", payment.subscription_id)
    }

    return { activated: true, planId, isRenewal: opts.isRenewal, sandbox: Boolean(opts.sandbox) }
}

/**
 * Doklad a potvrzovací e-mail. Pouštět v `after()` — brána nemá čekat.
 * **Nikdy nevyhazuje výjimku**: daňový doklad je povinnost, potvrzení zdvořilost,
 * ale ani jedno nesmí shodit potvrzení platby.
 */
export async function deliverPaidArtifacts(
    payment: PaidPaymentRow,
    result: FinalizeResult
): Promise<void> {
    try {
        const { sendNotification, getOwnerEmail, siteUrl } = await import("@/lib/notifications")
        const to = payment.payer_email || (await getOwnerEmail(payment.client_id))

        // Faktura se vystavuje nezávisle na e-mailu — doklad je zákonná
        // povinnost, i když se potvrzení nemá komu poslat.
        const { issueInvoiceForPayment } = await import("@/lib/invoicing")
        const invoice = await issueInvoiceForPayment({
            paymentId: payment.id,
            clientId: payment.client_id,
            amountHaleru: payment.amount,
            currency: payment.currency,
            label: payment.label,
            payerEmail: to,
            paidAt: new Date(),
            sandbox: result.sandbox,
        })

        if (!to) return

        let planName = result.planId
        const { data: planRow } = await supabaseAdmin
            .from("subscription_plans")
            .select("name")
            .eq("id", result.planId)
            .maybeSingle()
        if (planRow?.name) planName = planRow.name

        const amountStr = typeof payment.amount === "number"
            ? `${(payment.amount / 100).toLocaleString("cs-CZ")} ${payment.currency === "CZK" || !payment.currency ? "Kč" : payment.currency}`
            : null

        const invoiceLine = invoice.status === "issued" && invoice.publicUrl
            ? `Daňový doklad č. <strong>${invoice.number}</strong>: <a href="${invoice.publicUrl}">zobrazit fakturu →</a>`
            : invoice.status === "issued"
                ? `Daňový doklad č. <strong>${invoice.number}</strong> jsme vám poslali samostatným e-mailem.`
                : `Daňový doklad vám zašleme e-mailem během okamžiku.`

        await sendNotification({
            to,
            kind: "transactional",
            subject: result.isRenewal
                ? `Předplatné ${planName} obnoveno`
                : `Potvrzení platby — plán ${planName} je aktivní`,
            body: `Dobrý den,

${amountStr ? `přijali jsme vaši platbu ${amountStr}${payment.label ? ` (${payment.label})` : ""}. ` : ""}${result.isRenewal
                    ? `Předplatné <strong>${planName}</strong> bylo úspěšně obnoveno na další období.`
                    : `Plán <strong>${planName}</strong> je aktivní — generování příspěvků je odemčené.`}

${invoiceLine}

<a href="${siteUrl()}/dashboard/instagram">Přejít do studia →</a>

Tým Chrlit`,
        })
    } catch (err: any) {
        console.warn(`on-paid: doručení dokladu/potvrzení selhalo: ${err?.message}`)
    }
}

/**
 * Zrušená platba → zruší **jen** to nezaplacené pending předplatné z inicializace.
 *
 * U obnovy se nesmí volat vůbec: odmítnutá automatická obnova jde do dunningu
 * (billing-worker to zkouší dál) a nesmí na místě zabít živé předplatné.
 * Podmínka `status='pending'` je druhá pojistka téhož.
 */
export async function cancelPendingSubscription(payment: PaidPaymentRow): Promise<void> {
    if (!payment.subscription_id) return
    await supabaseAdmin
        .from("subscriptions")
        .update({
            status: "cancelled",
            cancelled_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        })
        .eq("id", payment.subscription_id)
        .eq("status", "pending")
    console.log(`❌ Pending předplatné zrušeno pro klienta ${payment.client_id}`)
}

// ════════════════════════════════════════════════════════════════════════════
// Jediná cesta pro „brána řekla X"
// ════════════════════════════════════════════════════════════════════════════

/** Lokátor platby u dané brány. Každá má vlastní sloupec — sémantika je stejná. */
export type PaymentLocator =
    | { provider: "comgate"; transId: string }
    | { provider: "stripe"; sessionId: string }

export type GatewayStatus = "PENDING" | "PAID" | "CANCELLED" | "AUTHORIZED" | "FAILED"

export interface ApplyGatewayInput {
    locator: PaymentLocator
    /** Co brána řekla — už **serverově ověřené**, nikdy ne hodnota z requestu. */
    status: GatewayStatus
    method?: string | null
    /** Syrová odpověď brány pro forenziku (ukládá se do `payments.comgate_response`). */
    raw?: unknown
    sandbox: boolean
    /** Token pro budoucí obnovy — ukládá se jen u PRVNÍ platby v sérii. */
    recurringToken?: string | null
    source: "callback" | "webhook" | "reconcile"
}

export interface ApplyGatewayResult {
    /** false = řádek nebyl zabrán (replay, neznámá platba) → volající končí. */
    claimed: boolean
    paymentId?: string
    clientId?: string
    activated?: boolean
    isRenewal?: boolean
}

/**
 * Zabere stav platby a udělá, co z něj plyne. **Tohle je jediné místo, kde se
 * `payments.status` mění na základě brány.**
 *
 * Idempotence: podmíněný UPDATE `WHERE <lokátor> AND status != 'PAID'` vrátí
 * řádek jen prvnímu volajícímu. Když nevrátí nic, je to konec — nikdy insert
 * fallback. Tím je ošetřený i souběh callbacku a reconcileru na téže platbě.
 *
 * Tři důsledky, které tu musí být pohromadě, protože všechny plynou z jednoho
 * zabraného řádku:
 *  1. PAID → aktivace plánu; když selže, založí se návrh na ruční opravu
 *     (zaplaceno a nedodáno je nejhorší stav, jaký umíme mít).
 *  2. CANCELLED/FAILED u **obnovy** → inkrement dunningu + oznámení zákazníkovi.
 *     Bez tohohle se odmítnutá obnova nikde neprojevila: řádek zmizel z filtru
 *     „PENDING obnova", čítač zůstal na nule a billing-worker to druhý den zkusil
 *     znovu. A další den zase — donekonečna, potichu, bez expirace.
 *  3. CANCELLED u **první** platby → zruší nezaplacené pending předplatné.
 */
export async function applyGatewayStatus(input: ApplyGatewayInput): Promise<ApplyGatewayResult> {
    const isPaid = input.status === "PAID"

    let claim = supabaseAdmin
        .from("payments")
        .update({
            status: input.status,
            payment_method: input.method || undefined,
            paid_at: isPaid ? new Date().toISOString() : null,
            // Sloupec vznikl pro ComGate a jméno mu zůstalo; drží syrovou odpověď
            // té které brány. Dřív se neplnil nikdy, takže po selhané platbě
            // nezbývalo vůbec nic, čím by šlo zpětně zjistit proč.
            comgate_response: (input.raw ?? null) as never,
            updated_at: new Date().toISOString(),
        })

    claim = input.locator.provider === "comgate"
        ? claim.eq("comgate_trans_id", input.locator.transId)
        : claim.eq("provider", "stripe").eq("provider_ref", input.locator.sessionId)

    const { data: payment } = await claim
        .neq("status", "PAID")
        .select("id, subscription_id, client_id, ref_id, payer_email, amount, currency, label")
        .maybeSingle()

    if (!payment) return { claimed: false }

    const isRenewal = isRenewalRefId(payment.ref_id)
    const base = { claimed: true as const, paymentId: payment.id, clientId: payment.client_id, isRenewal }

    if (isPaid && payment.client_id) {
        const result = await finalizePaidPayment(payment, {
            provider: input.locator.provider,
            isRenewal,
            recurringToken: input.recurringToken ?? null,
            sandbox: input.sandbox,
        })

        if (!result.activated) {
            // Peníze na účtu, produkt nedodán. Řádek zůstává PAID pro ruční
            // opravu a zakladatel dostane návrh s jedním tlačítkem OKAMŽITĚ —
            // tohle je jediná věc, která nesmí čekat na ranní brief.
            await proposeRepairActivation(payment.id, payment.client_id, result.planId)
            return { ...base, activated: false }
        }

        deliverLater(payment, result)
        return { ...base, activated: true }
    }

    if (input.status === "CANCELLED" || input.status === "FAILED") {
        if (isRenewal) await handleFailedRenewal(payment, input.source)
        else await cancelPendingSubscription(payment)
    }

    return base
}

/**
 * Doklad a potvrzení mimo kritickou cestu. `after()` funguje jen v requestu —
 * skripty a testy běží mimo něj, tam se dodá rovnou (nikdy nehází výjimku).
 */
function deliverLater(payment: PaidPaymentRow, result: FinalizeResult): void {
    try {
        after(() => deliverPaidArtifacts(payment, result))
    } catch {
        void deliverPaidArtifacts(payment, result)
    }
}

/**
 * Odmítnutá **obnova**: dunning čítač + oznámení. Nikdy nezabíjí živé
 * předplatné na místě — od toho je billing-worker a jeho MAX_BILLING_FAILURES.
 */
async function handleFailedRenewal(payment: PaidPaymentRow, source: string): Promise<void> {
    if (!payment.subscription_id) return

    const { data: sub } = await supabaseAdmin
        .from("subscriptions")
        .select("id, billing_failures, clients(name)")
        .eq("id", payment.subscription_id)
        .maybeSingle()
    if (!sub) return

    const attempt = (sub.billing_failures || 0) + 1
    await supabaseAdmin
        .from("subscriptions")
        .update({ billing_failures: attempt, updated_at: new Date().toISOString() })
        .eq("id", sub.id)

    const client = (Array.isArray(sub.clients) ? sub.clients[0] : sub.clients) as { name?: string } | null
    console.warn(`⚠️ Obnova odmítnuta (${source}) pro platbu ${payment.id} — dunning ${attempt}/3`)

    try {
        const { proposeCustomerNotice } = await import("@/lib/agents/customer-notices")
        await proposeCustomerNotice({
            clientId: payment.client_id,
            kind: "charge_failed",
            email: payment.payer_email,
            // Klíč je číslo pokusu: druhé selhání téhož dne pošle druhý e-mail,
            // ale replay téhož pokusu už ne.
            dedupeKey: `${payment.subscription_id}:${attempt}`,
            vars: { clientName: client?.name ?? null, clientId: payment.client_id, attempt },
        })
    } catch (err: any) {
        console.warn(`on-paid: oznámení o selhané obnově se nepodařilo založit: ${err?.message}`)
    }
}

/** Návrh na ruční opravu „zaplaceno, neaktivováno" — dedupe na id platby. */
async function proposeRepairActivation(paymentId: string, clientId: string, planId: string): Promise<void> {
    try {
        const { count } = await supabaseAdmin
            .from("agent_actions")
            .select("id", { count: "exact", head: true })
            .eq("task_type", "repair_activation")
            .eq("payload->>paymentId", paymentId)
            .in("status", ["proposed", "approved", "executed"])
        if ((count || 0) > 0) return

        const { requestAction } = await import("@/lib/agent-safety")
        await requestAction({
            clientId,
            agentType: "billing",
            action: "Zaplaceno, plán NEAKTIVOVÁN — opravit",
            // Nevratné: schválení plán skutečně aktivuje. Čeká na člověka a
            // e-mail dorazí hned, ne až ráno.
            riskTier: "irreversible",
            taskType: "repair_activation",
            payload: { paymentId, clientId, planId },
            notify: true,
        })
    } catch (err: any) {
        console.warn(`on-paid: návrh na opravu aktivace se nepodařilo založit: ${err?.message}`)
    }
}
