/**
 * GET /api/email/unsubscribe?e=<email>&s=<hmac>
 *
 * Public one-click unsubscribe for broadcast emails. Verifies the HMAC signature,
 * records a global opt-out (email_optouts), and returns a small Czech confirmation
 * page. No auth — low-stakes (worst case a marketing opt-out), signed so links
 * aren't trivially forgeable.
 */

import { NextRequest } from "next/server"
import supabaseAdmin from "@/supabase/admin"
import { verifyEmailSig } from "@/lib/email-sign"

function page(title: string, message: string): Response {
    return new Response(
        `<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
        <body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#050505;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px">
          <div style="text-align:center;max-width:420px">
            <h1 style="font-size:22px;text-transform:uppercase;letter-spacing:-0.5px;margin:0 0 12px">${title}</h1>
            <p style="color:#888;font-size:14px;line-height:1.6;margin:0">${message}</p>
          </div>
        </body></html>`,
        { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
    )
}

export async function GET(req: NextRequest) {
    const email = (req.nextUrl.searchParams.get("e") || "").trim().toLowerCase()
    const sig = req.nextUrl.searchParams.get("s") || ""

    if (!email || !sig || !verifyEmailSig(email, sig)) {
        return page("Neplatný odkaz", "Odkaz pro odhlášení je neplatný nebo poškozený. Zkuste to prosím přes odkaz v poslední zprávě.")
    }

    try {
        await supabaseAdmin.from("email_optouts").upsert({ email }, { onConflict: "email" })
    } catch (err: any) {
        console.error("unsubscribe upsert failed:", err?.message)
        return page("Něco se pokazilo", "Odhlášení se nepodařilo uložit. Zkuste to prosím znovu později.")
    }

    return page("Odhlášeno ✓", `Adresa <strong>${email}</strong> už od nás nebude dostávat e-maily. Můžete tuto stránku zavřít.`)
}
