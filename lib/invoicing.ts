/**
 * Vystavení daňového dokladu k přijaté platbě.
 * ============================================
 * Volá se z Comgate callbacku po přechodu platby do PAID. Celá cesta je
 * best-effort vůči callbacku: fakturace NIKDY nesmí shodit potvrzení platby,
 * protože zaplacený a neaktivovaný zákazník je horší stav než chybějící doklad.
 * Neúspěch se ale musí zapsat (`invoices.status='failed'`), jinak by o něm
 * nikdo nevěděl a zákazník by zůstal bez dokladu.
 *
 * IDEMPOTENCE: nárok na vystavení se zabírá INSERTem do `invoices`, kde
 * unikátní index na `payment_id` propustí jen první pokus. Přehraný callback
 * dostane konflikt a skončí. Je to stejná doktrína jako u plan draftů — s tím
 * rozdílem, že tady je fallback ještě nebezpečnější: číselná řada faktur je
 * nevratná a duplicitní doklad se musí stornovat, ne smazat.
 */

import supabaseAdmin from "@/supabase/admin"
import { LEGAL } from "@/lib/legal"
import {
    isFakturoidEnabled,
    issueInvoice,
    sendInvoiceByEmail,
    type BillingDetails,
} from "@/lib/fakturoid"

/** Sazba DPH na doklad. Neplátce fakturuje s nulou a poznámkou o neplátcovství. */
function vatRate(): number {
    return LEGAL.vatStatus === "payer" ? 21 : 0
}

/**
 * Fakturační údaje klienta. Když je zákazník ještě nevyplnil, doklad se musí
 * vystavit i tak — zákon nezná výmluvu „neměli jsme adresu". Nouzové údaje se
 * poznají podle `isFallback` a patří do hlášení, aby je někdo doplnil.
 */
async function loadBillingDetails(
    clientId: string,
    fallbackEmail: string | null
): Promise<{ billing: BillingDetails; isFallback: boolean }> {
    const { data } = await supabaseAdmin
        .from("ig_billing_details")
        .select("customer_type, name, ico, dic, street, city, zip, country_code, email")
        .eq("client_id", clientId)
        .maybeSingle()

    if (data?.name && data.street && data.city && data.zip) {
        return {
            isFallback: false,
            billing: {
                customerType: data.customer_type === "consumer" ? "consumer" : "company",
                name: data.name,
                ico: data.ico,
                dic: data.dic,
                street: data.street,
                city: data.city,
                zip: data.zip,
                countryCode: data.country_code || "CZ",
                email: data.email || fallbackEmail,
            },
        }
    }

    const { data: client } = await supabaseAdmin
        .from("clients")
        .select("name")
        .eq("id", clientId)
        .maybeSingle()

    return {
        isFallback: true,
        billing: {
            customerType: "company",
            name: client?.name || fallbackEmail || "Neuvedeno",
            street: "Neuvedeno",
            city: "Neuvedeno",
            zip: "00000",
            countryCode: "CZ",
            email: fallbackEmail,
        },
    }
}

export interface IssueForPaymentInput {
    paymentId: string
    clientId: string
    /** Částka v haléřích, přímo z `payments.amount`. */
    amountHaleru: number
    currency?: string | null
    /** `payments.label`, např. „Růst — Kavárna U Lípy". */
    label?: string | null
    payerEmail?: string | null
    paidAt?: Date
}

export interface IssueForPaymentResult {
    status: "issued" | "skipped" | "failed" | "duplicate"
    number?: string
    publicUrl?: string | null
    error?: string
}

/**
 * Vystaví doklad k jedné zaplacené platbě.
 * Nikdy nevyhazuje výjimku — chybu vrací ve výsledku a zapisuje do DB.
 */
export async function issueInvoiceForPayment(
    input: IssueForPaymentInput
): Promise<IssueForPaymentResult> {
    const paidAt = input.paidAt ?? new Date()

    // 1. Zabrání nároku. Konflikt = doklad už někdo vystavil (nebo o to zrovna
    //    usiluje) → končíme, kromě případu, kdy minulý pokus selhal.
    const { data: claimed, error: claimErr } = await supabaseAdmin
        .from("invoices")
        .insert({
            client_id: input.clientId,
            payment_id: input.paymentId,
            provider: "fakturoid",
            total_czk: input.amountHaleru,
            currency: input.currency || "CZK",
            status: "pending",
            attempts: 1,
        })
        .select("id")
        .single()

    let invoiceRowId = claimed?.id as string | undefined

    if (claimErr) {
        const { data: existing } = await supabaseAdmin
            .from("invoices")
            .select("id, status, number, public_url, attempts")
            .eq("payment_id", input.paymentId)
            .maybeSingle()

        if (!existing) {
            console.error(`🚨 invoicing: nárok na doklad selhal a řádek neexistuje (payment ${input.paymentId}): ${claimErr.message}`)
            return { status: "failed", error: claimErr.message }
        }
        if (existing.status !== "failed") {
            console.log(`🧾 invoicing: doklad k platbě ${input.paymentId} už existuje (${existing.status}) — přeskakuji`)
            return { status: "duplicate", number: existing.number || undefined, publicUrl: existing.public_url }
        }
        // Předchozí pokus selhal → zkusíme znovu na TÉMŽE řádku, aby unikátní
        // index dál garantoval jeden doklad na platbu.
        invoiceRowId = existing.id
        await supabaseAdmin
            .from("invoices")
            .update({ status: "pending", attempts: (existing.attempts ?? 0) + 1, updated_at: new Date().toISOString() })
            .eq("id", existing.id)
    }

    // 2. Bez konfigurace Fakturoidu doklad nevystavíme — ale řádek zůstane
    //    jako 'failed', takže se na to přijde dřív než při daňové kontrole.
    if (!isFakturoidEnabled()) {
        const msg = "Fakturoid není nakonfigurován (FAKTUROID_CLIENT_ID / _SECRET / _SLUG)"
        console.warn(`⚠️ invoicing: ${msg} — doklad k platbě ${input.paymentId} nevystaven`)
        await markFailed(invoiceRowId, msg)
        return { status: "skipped", error: msg }
    }

    try {
        const { billing, isFallback } = await loadBillingDetails(input.clientId, input.payerEmail || null)
        if (isFallback) {
            console.warn(`⚠️ invoicing: klient ${input.clientId} nemá fakturační údaje — doklad jde s náhradními`)
        }

        const invoice = await issueInvoice({
            clientId: input.clientId,
            billing,
            lineName: input.label || "Předplatné Chrlit",
            amountHaleru: input.amountHaleru,
            paidAt,
            paymentRef: input.paymentId,
            vatRate: vatRate(),
        })

        await supabaseAdmin
            .from("invoices")
            .update({
                provider_invoice_id: String(invoice.id),
                number: invoice.number,
                pdf_url: invoice.pdf_url,
                public_url: invoice.public_html_url,
                status: "issued",
                issued_at: paidAt.toISOString(),
                error: null,
                updated_at: new Date().toISOString(),
            })
            .eq("id", invoiceRowId!)

        // Odeslání z Fakturoidu je funkce placených tarifů — když selže, doklad
        // je pořád vystavený a odkaz na něj posílá náš vlastní potvrzovací e-mail.
        const recipient = billing.email || input.payerEmail
        if (recipient) {
            try {
                await sendInvoiceByEmail(invoice.id, recipient)
            } catch (mailErr: any) {
                console.warn(`⚠️ invoicing: Fakturoid neodeslal fakturu ${invoice.number}: ${mailErr?.message}`)
            }
        }

        console.log(`🧾 Faktura ${invoice.number} vystavena k platbě ${input.paymentId}`)
        return { status: "issued", number: invoice.number, publicUrl: invoice.public_html_url }
    } catch (err: any) {
        const msg = String(err?.message || err).slice(0, 500)
        console.error(`🚨 invoicing: vystavení dokladu k platbě ${input.paymentId} selhalo: ${msg}`)
        await markFailed(invoiceRowId, msg)
        try {
            const Sentry = await import("@sentry/nextjs")
            Sentry.captureException(err, {
                tags: { area: "invoicing" },
                extra: { paymentId: input.paymentId, clientId: input.clientId },
            })
        } catch { /* Sentry je volitelný */ }
        return { status: "failed", error: msg }
    }
}

async function markFailed(invoiceRowId: string | undefined, error: string): Promise<void> {
    if (!invoiceRowId) return
    await supabaseAdmin
        .from("invoices")
        .update({ status: "failed", error, updated_at: new Date().toISOString() })
        .eq("id", invoiceRowId)
}
