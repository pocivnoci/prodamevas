/**
 * GET /api/payments/return?id=<transId>
 * 
 * User is redirected here after completing payment on Comgate.
 * We verify the actual payment status and redirect to dashboard
 * with the correct result so UI can show a toast.
 */

import { NextRequest, NextResponse } from "next/server"
import { getPaymentStatus } from "@/lib/comgate"

export async function GET(req: NextRequest) {
    const transId = req.nextUrl.searchParams.get("id")

    const dashUrl = new URL("/dashboard/instagram", req.url)

    if (!transId) {
        dashUrl.searchParams.set("payment", "error")
        return NextResponse.redirect(dashUrl)
    }

    try {
        const status = await getPaymentStatus(transId)

        if (status.status === "PAID") {
            dashUrl.searchParams.set("payment", "success")
        } else if (status.status === "CANCELLED") {
            dashUrl.searchParams.set("payment", "cancelled")
        } else {
            // PENDING or AUTHORIZED
            dashUrl.searchParams.set("payment", "pending")
        }
    } catch (err) {
        console.error("Payment return error:", err)
        dashUrl.searchParams.set("payment", "error")
    }

    return NextResponse.redirect(dashUrl)
}
