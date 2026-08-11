/**
 * POST /api/payments/callback
 *
 * ComGate posílá POST při každé změně stavu platby. **Jediné spolehlivé
 * potvrzení** — klientskému redirectu (`/return`) se nikdy nevěří.
 *
 * ComGate posílá: application/x-www-form-urlencoded
 * Pole: merchant, test, price, curr, label, refId, transId, secret, status, email, method, …
 *
 * Tahle routa dělá právě dvě věci: **ověří** stav u brány a předá ho do
 * `applyGatewayStatus`. Zabrání stavu, aktivace, doklad, dunning i oprava
 * „zaplaceno-neaktivováno" žijí ve sdíleném jádře (`lib/payments/on-paid.ts`),
 * protože stejnou cestou chodí i Stripe webhook a reconciler zaseklých plateb.
 *
 * DŮLEŽITÉ: musí vracet HTTP 200 s „code=0&message=OK", jinak to ComGate opakuje.
 */

import { NextRequest } from "next/server"
import { getPaymentStatus, isMockPaymentMode } from "@/lib/comgate"
import { applyGatewayStatus, type GatewayStatus } from "@/lib/payments/on-paid"

const OK = () =>
    new Response("code=0&message=OK", {
        status: 200,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
    })

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData()
        const transId = formData.get("transId") as string
        const status = formData.get("status") as string
        const method = formData.get("method") as string

        console.log(`💳 Comgate callback: transId=${transId}, status=${status}`)

        if (!transId) {
            return new Response("code=1&message=Missing transId", {
                status: 200, // ComGate čeká 200 i u chyby
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
            })
        }

        // Stav se ověřuje na serveru brány; hodnotě z requestu se věří jen v mocku.
        let confirmedStatus: string
        let raw: unknown = { source: "callback", status, method }
        if (isMockPaymentMode()) {
            confirmedStatus = status
            console.log(`💳 [MOCK] Callback: transId=${transId}, status=${confirmedStatus}`)
        } else {
            const verified = await getPaymentStatus(transId)
            if (verified.code !== 0) {
                console.error("Comgate status verification failed:", verified)
                return OK()
            }
            confirmedStatus = verified.status || status
            raw = verified
        }

        const sandbox = isMockPaymentMode() || transId.startsWith("MOCK-")

        const result = await applyGatewayStatus({
            locator: { provider: "comgate", transId },
            status: confirmedStatus as GatewayStatus,
            method,
            raw,
            sandbox,
            // Obnovy se odkazují na transId PRVNÍ platby v sérii. Mock transId se
            // uložit nesmí — strhlo by se podle něj později doopravdy.
            recurringToken: sandbox ? null : transId,
            source: "callback",
        })

        if (!result.claimed) console.log(`💳 Callback pro ${transId} nic nezabral (replay nebo neznámá platba)`)

        return OK()
    } catch (err: any) {
        console.error("Payment callback error:", err?.message || err)
        // I tak 200 — jinak to ComGate opakuje donekonečna.
        return OK()
    }
}
