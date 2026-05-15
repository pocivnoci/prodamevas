/**
 * GET /api/payments/return
 * 
 * User is redirected here after completing payment on Comgate.
 * This is NOT the payment confirmation — that happens via callback.
 * This just shows a "thank you" page or redirects to dashboard.
 */

import { NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url)
    const refId = searchParams.get("refId")
    const id = searchParams.get("id") // Comgate transId

    // Redirect to dashboard with payment confirmation
    const redirectUrl = new URL("/dashboard/instagram", req.url)
    redirectUrl.searchParams.set("tab", "settings")
    if (id) redirectUrl.searchParams.set("paymentId", id)
    redirectUrl.searchParams.set("payment", "success")

    return NextResponse.redirect(redirectUrl)
}
