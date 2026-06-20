import { NextResponse } from "next/server"
import crypto from "crypto"
import supabaseAdmin from "@/supabase/admin"

/**
 * Meta Data Deletion Callback — required for Instagram App Review.
 *
 * POST: Meta sends a `signed_request` (HMAC-SHA256 with the app secret) carrying
 * the user id whose data must be deleted. We verify the signature, delete every
 * ig_connections row for that Instagram user id (the stored access token), and
 * return Meta's expected `{ url, confirmation_code }` JSON.
 *
 * GET: human-readable instructions (the URL is also linked from /privacy).
 *
 * Auth-exempt like the payment webhook — the signed_request signature IS the auth.
 */

function b64urlDecode(input: string): Buffer {
    const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4))
    return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64")
}

/** Verify + parse Meta's signed_request → payload, or null if the signature is bad. */
function parseSignedRequest(signedRequest: string, appSecret: string): Record<string, unknown> | null {
    const [encodedSig, payload] = signedRequest.split(".")
    if (!encodedSig || !payload) return null
    const expected = crypto.createHmac("sha256", appSecret).update(payload).digest()
    const actual = b64urlDecode(encodedSig)
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null
    try {
        return JSON.parse(b64urlDecode(payload).toString("utf8"))
    } catch {
        return null
    }
}

export async function POST(req: Request) {
    const appSecret = process.env.META_APP_SECRET
    if (!appSecret) {
        return NextResponse.json({ error: "Not configured" }, { status: 503 })
    }

    // Meta posts application/x-www-form-urlencoded with a signed_request field.
    let signedRequest: string | null = null
    const contentType = req.headers.get("content-type") || ""
    if (contentType.includes("application/json")) {
        signedRequest = (await req.json())?.signed_request ?? null
    } else {
        const form = await req.formData()
        signedRequest = (form.get("signed_request") as string) || null
    }
    if (!signedRequest) {
        return NextResponse.json({ error: "Missing signed_request" }, { status: 400 })
    }

    const payload = parseSignedRequest(signedRequest, appSecret)
    if (!payload || !payload.user_id) {
        return NextResponse.json({ error: "Invalid signed_request" }, { status: 400 })
    }

    const igUserId = String(payload.user_id)
    // Delete the stored token(s) for this Instagram user across all tenants.
    const { error } = await supabaseAdmin.from("ig_connections").delete().eq("ig_user_id", igUserId)
    if (error) {
        console.error("data-deletion: delete failed:", error.message)
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin
    // Confirmation code Meta surfaces to the user for status tracking.
    const confirmationCode = `igdel_${igUserId}_${Date.now().toString(36)}`
    return NextResponse.json({
        url: `${siteUrl}/api/data-deletion?code=${confirmationCode}`,
        confirmation_code: confirmationCode,
    })
}

export async function GET(req: Request) {
    const code = new URL(req.url).searchParams.get("code")
    const body = code
        ? `Žádost o výmaz dat (kód ${code}) byla zpracována. Uložený přístupový token k Instagramu byl odstraněn.`
        : "Pro výmaz dat získaných z Instagramu odpojte účet v Nastavení projektu, nebo nás kontaktujte na info@chrlit.cz. Meta data deletion požadavky jsou zpracovány automaticky."
    return new NextResponse(body, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } })
}
