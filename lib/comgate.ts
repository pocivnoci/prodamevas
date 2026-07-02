/**
 * Comgate Payment Gateway Client
 * ================================
 * Czech payment gateway — https://comgate.eu
 * 
 * API Docs: https://apidoc.comgate.cz/en
 * Client Portal: https://portal.comgate.cz
 * 
 * Flow:
 * 1. Create payment (server) → get transId + redirect URL
 * 2. Redirect user to Comgate payment page
 * 3. Comgate sends callback (POST) to our /api/payments/callback
 * 4. User is redirected back to our site
 * 
 * Auth: Basic auth (merchant:secret) in Authorization header
 * Content-Type: application/x-www-form-urlencoded
 * Prices: in smallest currency unit (haléře for CZK, cents for EUR)
 * 
 * ── SETUP TODO ──────────────────────────────────────────────
 * 1. Spustit migraci v Supabase: supabase/migrations/20260515_payments.sql
 * 2. V Comgate portálu (https://portal.comgate.cz) získat MERCHANT_ID a SECRET
 * 3. Vyplnit env vars: COMGATE_MERCHANT_ID, COMGATE_SECRET (v .env.local + Vercel)
 * 4. V Comgate portálu nastavit callback URL: https://chrlit.cz/api/payments/callback
 * 5. V Comgate portálu nastavit return URL:   https://chrlit.cz/api/payments/return
 * 6. Přepnout COMGATE_TEST="false" až půjde do produkce
 * 7. Vytvořit pricing UI stránku (výběr plánu → platba)
 * ────────────────────────────────────────────────────────────
 */

const COMGATE_API = "https://payments.comgate.cz/v1.0"

/**
 * Mock payment mode — allowed only OUTSIDE production.
 * Prevents COMGATE_MOCK=true accidentally left on prod from letting
 * anyone approve their own payments via a forged callback.
 */
export function isMockPaymentMode(): boolean {
    const wantsMock = process.env.COMGATE_MOCK === "true"
    if (wantsMock && process.env.VERCEL_ENV === "production") {
        console.error("⛔ COMGATE_MOCK=true ignored on production — using real gateway")
        return false
    }
    return wantsMock
}

// Environment config
function getConfig() {
    const merchant = process.env.COMGATE_MERCHANT_ID
    const secret = process.env.COMGATE_SECRET
    const isTest = process.env.COMGATE_TEST === "true"

    if (!merchant || !secret) {
        throw new Error("Missing COMGATE_MERCHANT_ID or COMGATE_SECRET env vars")
    }

    return { merchant, secret, isTest }
}

function authHeader(merchant: string, secret: string): string {
    return "Basic " + Buffer.from(`${merchant}:${secret}`).toString("base64")
}

// ─── Types ───────────────────────────────────────────────────────────

export interface CreatePaymentParams {
    /** Our internal reference ID (e.g. "sub-chrlit-1715790000") */
    refId: string
    /** Amount in smallest currency unit (haléře/cents) */
    price: number
    /** Currency code */
    curr?: "CZK" | "EUR"
    /** Short label shown to payer */
    label: string
    /** Payer email */
    email: string
    /** Payment method — "ALL" for all, or specific like "CARD_CZ_CSOB" */
    method?: string
    /** Language of payment page */
    lang?: "cs" | "en" | "sk"
    /** Mark this payment as the INIT of a recurring series (its transId becomes the token for chargeRecurring) */
    initRecurring?: boolean
}

/**
 * Recurring payments kill switch — initRecurring/chargeRecurring only work after
 * Comgate enables "opakované platby" on the merchant account (contractual).
 * Until then requesting initRecurring would fail payment creation, so it's opt-in.
 */
export function isRecurringEnabled(): boolean {
    return process.env.COMGATE_RECURRING === "1"
}

export interface ComgateCreateResponse {
    code: number
    message: string
    transId?: string
    redirect?: string
}

export interface ComgateStatusResponse {
    code: number
    message: string
    merchant?: string
    test?: boolean
    price?: number
    curr?: string
    label?: string
    refId?: string
    email?: string
    transId?: string
    status?: "PENDING" | "PAID" | "CANCELLED" | "AUTHORIZED"
    method?: string
}

// ─── API Methods ─────────────────────────────────────────────────────

/**
 * Create a new payment. Returns Comgate transId + redirect URL.
 * The user should be redirected to the `redirect` URL to complete payment.
 */
export async function createPayment(params: CreatePaymentParams): Promise<ComgateCreateResponse> {
    const { merchant, secret, isTest } = getConfig()

    const body = new URLSearchParams({
        merchant,
        test: isTest ? "true" : "false",
        country: "CZ",
        price: String(params.price),
        curr: params.curr || "CZK",
        label: params.label,
        refId: params.refId,
        email: params.email,
        method: params.method || "ALL",
        lang: params.lang || "cs",
        prepareOnly: "true", // always prepare — we redirect manually
    })
    if (params.initRecurring) body.set("initRecurring", "true")

    const resp = await fetch(`${COMGATE_API}/create`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": authHeader(merchant, secret),
        },
        body: body.toString(),
    })

    const text = await resp.text()
    const parsed = parseComgateResponse(text)

    if (parsed.code !== 0) {
        console.error("Comgate create error:", parsed)
        throw new Error(`Comgate error ${parsed.code}: ${parsed.message}`)
    }

    return parsed as ComgateCreateResponse
}

/**
 * Charge a follow-up payment on a recurring series — server-to-server, no payer
 * interaction/redirect. `initRecurringId` is the transId of the ORIGINAL payment
 * created with initRecurring=true (always reference the initial one, not the last
 * renewal). Confirmation arrives via the standard payment callback (and/or
 * getPaymentStatus polling), exactly like a redirect payment.
 */
export async function chargeRecurring(params: {
    refId: string
    price: number
    curr?: "CZK" | "EUR"
    label: string
    email: string
    initRecurringId: string
}): Promise<ComgateCreateResponse> {
    const { merchant, secret, isTest } = getConfig()

    const body = new URLSearchParams({
        merchant,
        test: isTest ? "true" : "false",
        country: "CZ",
        price: String(params.price),
        curr: params.curr || "CZK",
        label: params.label,
        refId: params.refId,
        email: params.email,
        method: "ALL",
        lang: "cs",
        prepareOnly: "true",
        initRecurringId: params.initRecurringId,
    })

    const resp = await fetch(`${COMGATE_API}/create`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": authHeader(merchant, secret),
        },
        body: body.toString(),
    })

    const text = await resp.text()
    const parsed = parseComgateResponse(text)

    if (parsed.code !== 0) {
        console.error("Comgate recurring charge error:", parsed)
        throw new Error(`Comgate recurring error ${parsed.code}: ${parsed.message}`)
    }

    return parsed as ComgateCreateResponse
}

/**
 * Get status of an existing payment by transId.
 */
export async function getPaymentStatus(transId: string): Promise<ComgateStatusResponse> {
    const { merchant, secret } = getConfig()

    const body = new URLSearchParams({
        merchant,
        transId,
    })

    const resp = await fetch(`${COMGATE_API}/status`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": authHeader(merchant, secret),
        },
        body: body.toString(),
    })

    const text = await resp.text()
    return parseComgateResponse(text) as ComgateStatusResponse
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Parse Comgate's URL-encoded response format.
 * Response is: "code=0&message=OK&transId=ABC-123&redirect=https://..."
 */
function parseComgateResponse(text: string): Record<string, any> {
    const params = new URLSearchParams(text)
    const result: Record<string, any> = {}

    for (const [key, value] of params.entries()) {
        // Auto-convert numeric fields
        if (key === "code" || key === "price") {
            result[key] = parseInt(value, 10)
        } else if (key === "test") {
            result[key] = value === "true"
        } else {
            result[key] = value
        }
    }

    return result
}

/**
 * Generate a unique refId for a subscription payment.
 */
export function generateRefId(clientSlug: string): string {
    return `sub-${clientSlug}-${Date.now()}`
}

/**
 * refId for an automatic renewal charge. The `renew-` prefix tells the payment
 * callback this is a renewal: a CANCELLED/declined renewal must NOT cancel the
 * live subscription (the billing worker retries with dunning instead).
 */
export function generateRenewalRefId(clientSlug: string): string {
    return `renew-${clientSlug}-${Date.now()}`
}

export function isRenewalRefId(refId?: string | null): boolean {
    return !!refId?.startsWith("renew-")
}
