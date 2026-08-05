/**
 * Fakturoid API v3 — vystavování daňových dokladů.
 * ================================================
 * Proč externí fakturační služba a ne vlastní PDF: číselná řada, archivace,
 * storna a případný přechod na plátcovství DPH jsou regulované věci, které
 * musí sedět účetní. Fakturoid je zároveň místo, kam se účetní přihlásí sama.
 *
 * Autentizace: OAuth 2 client credentials. Token platí 2 hodiny a NEMÁ refresh —
 * bere se vždy znovu. Cache je per-instance (Fluid Compute recykluje instance,
 * takže se tím ušetří většina volání), ale správnost na ní nestojí.
 *
 * ⚠️ Částky: `payments.amount` je v HALÉŘÍCH (99000 = 990 Kč), Fakturoid chce
 * korunu jako jednotku. Převod dělá `haleruToCzk()` — nikdy neposílej surové
 * `amount`, jinak vystavíš fakturu na stonásobek.
 *
 * Doklady se vystavují rovnou jako ZAPLACENÉ: platba proběhla v Comgate dřív,
 * než se sem vůbec dostaneme.
 */

import { withRetry } from "@/utils/retry"
import { LEGAL } from "@/lib/legal"

const API_BASE = "https://app.fakturoid.cz/api/v3"

export class FakturoidError extends Error {
    constructor(message: string, readonly status?: number, readonly body?: string) {
        super(message)
        this.name = "FakturoidError"
    }
}

/** Bez kompletní konfigurace se fakturace tiše přeskočí — nikdy neshodí platbu. */
export function isFakturoidEnabled(): boolean {
    return Boolean(
        process.env.FAKTUROID_CLIENT_ID &&
        process.env.FAKTUROID_CLIENT_SECRET &&
        process.env.FAKTUROID_SLUG
    )
}

/** Fakturoid vrací 400 na požadavek bez User-Agentu s kontaktem. */
function userAgent(): string {
    return process.env.FAKTUROID_USER_AGENT || `Chrlit (${LEGAL.email})`
}

// ─────────────────────────────────────────────────────────────
// Token
// ─────────────────────────────────────────────────────────────

let cachedToken: { value: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string> {
    // 60s rezerva, aby token nevypršel mezi kontrolou a použitím.
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
        return cachedToken.value
    }

    const basic = Buffer.from(
        `${process.env.FAKTUROID_CLIENT_ID}:${process.env.FAKTUROID_CLIENT_SECRET}`
    ).toString("base64")

    const res = await fetch(`${API_BASE}/oauth/token`, {
        method: "POST",
        headers: {
            "Authorization": `Basic ${basic}`,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": userAgent(),
        },
        body: JSON.stringify({ grant_type: "client_credentials" }),
    })

    if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new FakturoidError(`Fakturoid: získání tokenu selhalo (${res.status})`, res.status, body)
    }

    const json = await res.json() as { access_token: string; expires_in: number }
    cachedToken = {
        value: json.access_token,
        expiresAt: Date.now() + (json.expires_in ?? 7200) * 1000,
    }
    return cachedToken.value
}

// ─────────────────────────────────────────────────────────────
// Nízkoúrovňové volání
// ─────────────────────────────────────────────────────────────

async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const slug = process.env.FAKTUROID_SLUG
    const token = await getAccessToken()

    const res = await fetch(`${API_BASE}/accounts/${slug}${path}`, {
        method: init?.method || "GET",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": userAgent(),
        },
        body: init?.body ? JSON.stringify(init.body) : undefined,
    })

    // 401 = token mezitím zneplatněn; zahoď cache, ať další pokus vezme nový.
    if (res.status === 401) {
        cachedToken = null
        throw new FakturoidError("Fakturoid: 401 Unauthorized (token zneplatněn)", 401)
    }

    // 429 obsahuje slovo "rate limit", které withRetry rozpozná jako přechodné.
    if (res.status === 429) {
        throw new FakturoidError("Fakturoid: rate limit exceeded", 429)
    }

    if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new FakturoidError(
            `Fakturoid ${init?.method || "GET"} ${path} → ${res.status}: ${body.slice(0, 300)}`,
            res.status,
            body
        )
    }

    if (res.status === 204) return undefined as T
    return await res.json() as T
}

// ─────────────────────────────────────────────────────────────
// Subjekty (odběratelé)
// ─────────────────────────────────────────────────────────────

export interface BillingDetails {
    customerType: "company" | "consumer"
    name: string
    ico?: string | null
    dic?: string | null
    street: string
    city: string
    zip: string
    countryCode: string
    email?: string | null
}

interface FakturoidSubject { id: number; custom_id: string | null }

/**
 * Najde subjekt podle `custom_id` (= náš client UUID) nebo ho založí.
 * Díky custom_id nevzniká při každé platbě nový odběratel.
 */
export async function ensureSubject(clientId: string, billing: BillingDetails): Promise<number> {
    const existing = await api<FakturoidSubject[]>(
        `/subjects.json?custom_id=${encodeURIComponent(clientId)}`
    )
    if (Array.isArray(existing) && existing.length > 0) {
        return existing[0].id
    }

    const created = await api<FakturoidSubject>("/subjects.json", {
        method: "POST",
        body: {
            custom_id: clientId,
            type: "customer",
            name: billing.name,
            // IČO/DIČ posílej jen u firmy — u spotřebitele nedávají smysl
            // a Fakturoid by je vytiskl na doklad.
            registration_no: billing.customerType === "company" ? billing.ico || undefined : undefined,
            vat_no: billing.customerType === "company" ? billing.dic || undefined : undefined,
            street: billing.street,
            city: billing.city,
            zip: billing.zip,
            country: billing.countryCode,
            email: billing.email || undefined,
            language: "cz",
            currency: "CZK",
        },
    })
    return created.id
}

// ─────────────────────────────────────────────────────────────
// Faktury
// ─────────────────────────────────────────────────────────────

export interface FakturoidInvoice {
    id: number
    number: string
    total: string
    public_html_url: string | null
    pdf_url: string | null
}

/** Haléře → koruny. Jediné povolené místo pro tenhle převod. */
export function haleruToCzk(haleru: number): number {
    return Math.round(haleru) / 100
}

/** `YYYY-MM-DD` v místním čase — Fakturoid nechce ISO s časovou zónou. */
function isoDate(d: Date = new Date()): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export interface IssueInvoiceInput {
    clientId: string
    billing: BillingDetails
    /** Text položky, např. „Chrlit Růst — předplatné 1. 8. – 31. 8. 2026". */
    lineName: string
    /** Částka v HALÉŘÍCH (přímo z payments.amount). */
    amountHaleru: number
    /** Kdy byla platba přijata. Určuje datum vystavení i zdanitelného plnění. */
    paidAt: Date
    /** Naše ID platby → custom_id faktury, pro dohledatelnost z obou stran. */
    paymentRef: string
    /** Sazba DPH v procentech. Neplátce = 0. */
    vatRate?: number
}

/**
 * Vystaví fakturu a rovnou ji označí jako zaplacenou.
 *
 * Není idempotentní na své úrovni — o to, aby se nevystavil druhý doklad na
 * tutéž platbu, se stará unikátní index `invoices.payment_id` v DB.
 */
export async function issueInvoice(input: IssueInvoiceInput): Promise<FakturoidInvoice> {
    const subjectId = await withRetry(
        () => ensureSubject(input.clientId, input.billing),
        2,
        "fakturoid:subject"
    )

    const issuedOn = isoDate(input.paidAt)

    const invoice = await withRetry(
        () => api<FakturoidInvoice>("/invoices.json", {
            method: "POST",
            body: {
                subject_id: subjectId,
                custom_id: input.paymentRef,
                issued_on: issuedOn,
                taxable_fulfillment_due: issuedOn,
                // Splatnost 0 dnů: doklad vzniká až po přijetí platby, takže
                // nikdy není „po splatnosti" a nespustí upomínky.
                due: 0,
                payment_method: "card",
                currency: "CZK",
                language: "cz",
                lines: [{
                    name: input.lineName,
                    quantity: 1,
                    unit_name: "ks",
                    unit_price: haleruToCzk(input.amountHaleru),
                    vat_rate: input.vatRate ?? 0,
                }],
            },
        }),
        2,
        "fakturoid:invoice"
    )

    // Zaevidování platby → doklad je „zaplaceno". Selhání tohohle kroku
    // nesmí shodit už vystavenou fakturu: doklad existuje, jen bude
    // ve Fakturoidu viset jako neuhrazený a dá se doplnit ručně.
    try {
        await api(`/invoices/${invoice.id}/payments.json`, {
            method: "POST",
            body: { paid_on: issuedOn },
        })
    } catch (err: any) {
        console.warn(`⚠️ Fakturoid: faktura ${invoice.number} vystavena, ale označení jako zaplacené selhalo: ${err?.message}`)
    }

    return invoice
}

/**
 * Odešle vystavenou fakturu odběrateli e-mailem z Fakturoidu.
 *
 * `replace_with_defaults: true` nechá předmět i text doplnit z nastavení účtu,
 * takže znění e-mailu se mění ve Fakturoidu, ne v kódu.
 *
 * ⚠️ Rozesílání e-mailů je funkce placených tarifů Fakturoidu. Volající to musí
 * brát jako best-effort — odkaz na doklad posíláme i vlastním e-mailem.
 */
export async function sendInvoiceByEmail(invoiceId: number, email: string): Promise<void> {
    await api(`/invoices/${invoiceId}/message.json`, {
        method: "POST",
        body: { email, replace_with_defaults: true },
    })
}
