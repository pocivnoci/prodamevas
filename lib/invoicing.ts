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

/**
 * Návrh na doplnění fakturačních údajů po dokladu s náhradními hodnotami.
 *
 * Dedupe na `paymentId`: jeden doklad = jeden úkol, i kdyby se `issueInvoiceForPayment`
 * z jakéhokoli důvodu zavolalo znovu. Nikdy nevyhazuje — fakturace je best-effort
 * vůči potvrzení platby a tenhle krok je best-effort i vůči fakturaci.
 */
async function proposeBillingDetailsFix(
    clientId: string,
    paymentId: string,
    payerEmail: string | null,
): Promise<void> {
    try {
        const { count } = await supabaseAdmin
            .from("agent_actions")
            .select("id", { count: "exact", head: true })
            .eq("task_type", "fix_billing_details")
            .eq("payload->>paymentId", paymentId)
            .in("status", ["proposed", "approved", "executed"])
        if ((count || 0) > 0) return

        const { requestAction } = await import("@/lib/agent-safety")
        await requestAction({
            clientId,
            agentType: "billing",
            action: "Doklad vystaven s náhradní adresou — doplnit údaje a vystavit opravný doklad",
            // Nápravou je OPRAVNÝ doklad v nevratné číselné řadě, ne přepsání
            // toho původního — proto `irreversible`. Bez `taskType` se nic samo
            // nespustí: je to záznam, který čeká na člověka.
            riskTier: "irreversible",
            payload: { paymentId, clientId, payerEmail },
            notify: true,
        })
    } catch (err: any) {
        console.warn(`invoicing: návrh na doplnění fakturačních údajů se nepodařilo založit: ${err?.message}`)
    }
}

export interface IssueForPaymentInput {
    paymentId: string
    clientId: string
    /** Částka v haléřích, přímo z `payments.amount`. */
    amountHaleru: number
    currency?: string | null
    /** `payments.label`, např. „Chrlit Růst — předplatné na 12 měsíců". */
    label?: string | null
    payerEmail?: string | null
    paidAt?: Date
    /**
     * Zaplacené období. U předplatného na rok je to údaj, bez kterého účetní
     * nemá z čeho udělat časové rozlišení — z data vystavení se nedozví, že
     * jedna platba pokrývá dvanáct měsíců.
     */
    period?: { start: Date; end: Date } | null
    /**
     * Platba nepřišla z ostré brány (mock ComGate, Stripe `sk_test_`).
     * Volající to ví, invoicing to sám poznat nemůže — a musí to vědět,
     * protože doklad na fiktivní platbu je zásah do nevratné číselné řady.
     */
    sandbox?: boolean
}

/**
 * Text položky na dokladu.
 *
 * Datum vystavení říká, KDY se platilo — ne, ZA CO. U předplatného na rok je to
 * rozdíl dvanácti měsíců a účetní z něj musí umět udělat časové rozlišení, takže
 * období patří přímo do názvu položky: „Chrlit Růst — předplatné na 12 měsíců
 * (12. 8. 2026 – 12. 8. 2027)".
 */
export function invoiceLineName(
    label: string | null | undefined,
    period: { start: Date; end: Date } | null | undefined,
): string {
    const base = label || "Předplatné Chrlit"
    if (!period) return base
    const cz = (d: Date) => d.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" })
    if (Number.isNaN(period.start.getTime()) || Number.isNaN(period.end.getTime())) return base
    return `${base} (${cz(period.start)} – ${cz(period.end)})`
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

    // 2. ⛔ Ostrá číselná řada patří ostrým platbám. Testovací platba, která
    //    vystaví skutečný doklad, je účetní zásah, který jde jen stornovat —
    //    proto je tahle brána PŘED voláním Fakturoidu a je dvojitá:
    //    (a) volající přiznal sandbox, (b) neběžíme na produkci.
    //    Stačí jedna podmínka a doklad se nevystaví. Backstop (b) je tu proto,
    //    že (a) se dá zapomenout předat — a příští brána ho zapomene určitě.
    const nonProd = process.env.VERCEL_ENV !== "production"
    const override = process.env.FAKTUROID_ALLOW_NONPROD === "true"
    if (input.sandbox || (nonProd && !override)) {
        const why = input.sandbox
            ? "platba je sandboxová/mock"
            : `běh mimo produkci (VERCEL_ENV=${process.env.VERCEL_ENV || "unset"})`
        const msg = `Doklad se vědomě nevystavuje: ${why}. Ostrá číselná řada je nevratná.`
        console.warn(`🧾 invoicing: ${msg} (platba ${input.paymentId})`)
        await markSkipped(invoiceRowId, msg)
        return { status: "skipped", error: msg }
    }

    // 3. Bez konfigurace Fakturoidu doklad nevystavíme — a tohle JE selhání
    //    ('failed'), protože na produkci se to musí spravit dřív než při
    //    daňové kontrole.
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
            // Varování v logu nikdo nečte. Doklad přitom právě odešel do NEVRATNÉ
            // číselné řady s adresou „Neuvedeno" a PSČ „00000" — pro podnikatelského
            // odběratele je to vadný daňový doklad, který si nemůže uplatnit,
            // a opravit se dá jen opravným dokladem, ne přepsáním.
            //
            // Prodej se kvůli tomu nezastavuje (UI si údaje vyžádá před pokladnou
            // a ta kontrola smí selhat propustně — neprodat je horší). Ale zůstat
            // o tom zticha znamená, že se na to přijde až při kontrole účetnictví.
            await proposeBillingDetailsFix(input.clientId, input.paymentId, input.payerEmail || null)
        }

        const invoice = await issueInvoice({
            clientId: input.clientId,
            billing,
            lineName: invoiceLineName(input.label, input.period),
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

/**
 * Doklad se vědomě nevystavil. Vlastní stav, ne 'failed' — jinak by testovací
 * platby zaplavily frontu „chybí doklad, spravit", kterou řeší člověk.
 * Řádek zůstává, takže unikátní index dál brání pozdějšímu vystavení k téže platbě.
 */
async function markSkipped(invoiceRowId: string | undefined, error: string): Promise<void> {
    if (!invoiceRowId) return
    await supabaseAdmin
        .from("invoices")
        .update({ status: "skipped", error, updated_at: new Date().toISOString() })
        .eq("id", invoiceRowId)
}
