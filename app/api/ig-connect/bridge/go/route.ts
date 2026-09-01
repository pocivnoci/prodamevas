import { NextResponse } from "next/server"
import { verifyHandoff } from "@/lib/ig-connect-handoff"

/**
 * GET /api/ig-connect/bridge/go?t={podepsaná autorizační adresa}
 *
 * Poslední skok na Instagram — schválně jako REDIRECT, ne jako odkaz.
 *
 * iOS na klepnutí na odkaz vedoucí na instagram.com sáhne po Universal Links a
 * otevře nativní aplikaci Instagramu, která autorizační adresu neobslouží a
 * skončí na „something went wrong". Na redirect Universal Links nereagují, takže
 * prohlížeč zůstane v Safari a ukáže přihlašovací formulář.
 *
 * ZÁMĚRNĚ bez `requireAuth`: sem uživatel dorazí z externího prohlížeče, který
 * naši session nemá (Safari má vlastní cookie jar). Oprávnění nese podpis tokenu
 * — ten vydala jen ověřená mezistránka a platí 15 minut. Cíl je navíc omezený
 * allowlistem hostů, takže ani z tohohle nejde udělat otevřený redirect.
 */
export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const target = verifyHandoff(searchParams.get("t"))

    if (!target) {
        // Propadlý nebo zmanipulovaný token. Uživatel s tím sám nic nesvede a
        // v cizím prohlížeči nemá smysl ho posílat do dashboardu (nemá session),
        // tak mu rovnou řekni, co má udělat.
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || origin
        return new NextResponse(expiredHtml(siteUrl), {
            status: 400,
            headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store, max-age=0" },
        })
    }

    const res = NextResponse.redirect(target)
    // Adresa nese jednorázový `state` upload-postu. Do cache nepatří.
    res.headers.set("Cache-Control", "no-store, max-age=0")
    res.headers.set("Referrer-Policy", "no-referrer")
    return res
}

function expiredHtml(siteUrl: string): string {
    return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Odkaz vypršel</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
       background:#050505;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif}
  main{max-width:420px;width:100%;border:1px solid rgba(255,255,255,.05);border-radius:2px;padding:28px 24px;text-align:center}
  .label{margin:0 0 10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.18em;color:rgba(255,255,255,.35)}
  h1{margin:0 0 12px;font-size:18px;font-weight:800;letter-spacing:-.02em;line-height:1.25}
  p{margin:0;font-size:13px;line-height:1.6;color:rgba(255,255,255,.55)}
</style>
</head>
<body>
<main>
  <p class="label">Připojení Instagramu</p>
  <h1>Odkaz vypršel</h1>
  <p>Platí patnáct minut. Vrať se do Chrlitu (${siteUrl}) a klepni na Připojit znovu.</p>
</main>
</body>
</html>`
}
