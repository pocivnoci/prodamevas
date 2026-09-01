import { NextResponse } from "next/server"
import { syncUploadPostConnection } from "@/app/actions/ig-connection-actions"

/**
 * GET /api/ig-connect/bridge/return?slug={projectSlug}[&external=1]
 *
 * Návrat z hostované stránky upload-postu (tlačítko „Zpět do Chrlitu", které jsme
 * si vyžádali přes `redirect_url`). Most nemá OAuth callback — autorizace proběhla
 * celá u nich —, takže tohle je jediný okamžik, kdy si stav můžeme srovnat dřív,
 * než uživatel uvidí Nastavení.
 *
 * Ověření dělá `syncUploadPostConnection` přes `requireProjectAccess`: uživatel se
 * sem vrací ve vlastním prohlížeči i se session cookie, takže na rozdíl od našeho
 * OAuth callbacku tu není co podepisovat.
 *
 * Sesouhlasení tady není náhrada za ověření při focusu — kdyby uživatel tlačítko
 * nepoužil a jen přepnul zpátky na záložku, chytí ho ten focus listener.
 */
export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || origin
    const dashboard = `${siteUrl}/dashboard/instagram`

    const slug = searchParams.get("slug")
    // Návrat z mezistránky (viz ../route.ts): tenhle požadavek přišel ze Safari,
    // které má vlastní cookie jar — naše session tu být NEMUSÍ. Redirect do
    // dashboardu by skončil na přihlašovací stránce v cizím prohlížeči, což vypadá
    // jako selhání přesně v momentě, kdy se to povedlo.
    const external = searchParams.get("external") === "1"

    // Přímá autorizační cesta (viz generateAuthorizeUrl) přidá k návratové adrese
    // vlastní výsledek. Bez něj o výsledku nic netvrdíme.
    const failed = searchParams.get("connect_status") === "error"

    if (!slug) {
        return external ? handoffBack(failed) : NextResponse.redirect(`${dashboard}?ig=error#settings`)
    }

    // Sesouhlasení se bez session neprojde. `syncUploadPostConnection` chybu polyká
    // a vrací `success: false`, takže tady není co ošetřovat — u externího návratu
    // stav stejně dorovná appka sama, jakmile se do ní uživatel přepne.
    const res = await syncUploadPostConnection(slug)
    if (external) return handoffBack(failed)

    // `connected: false` není chyba, jen nedokončené připojení: uživatel se mohl
    // vrátit dřív, než účet skutečně propojil. Vlastní stav proto, aby mu Nastavení
    // řeklo „dokonči to", a ne „nepovedlo se".
    const flag = res.success ? (res.connected ? "connected" : "pending") : "error"
    return NextResponse.redirect(`${dashboard}?ig=${flag}#settings`)
}

/**
 * Konec cesty v externím prohlížeči.
 *
 * Nikam nepřesměrovává a nic netvrdí o výsledku: tenhle požadavek nemusí mít naši
 * session, takže o stavu připojení tu nic jistého nevíme. Skutečné sesouhlasení
 * udělá otevřená appka při návratu (listener na `focus` + `visibilitychange`
 * v SettingsTab). Stránka jen řekne uživateli, že má přepnout zpátky.
 */
function handoffBack(failed = false): NextResponse {
    const heading = failed ? "Připojení se nedokončilo" : "Hotovo — přepni se zpátky do Chrlitu"
    const body = failed
        ? "Instagram autorizaci nedokončil. Vrať se do Chrlitu a zkus Připojit znovu; účet musí být profesní (Business nebo Creator)."
        : "Tuhle záložku můžeš zavřít. V aplikaci se stav připojení ověří sám; kdyby ne, klepni v Nastavení na „Ověřit“."
    const html = `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Hotovo</title>
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
  <h1>${heading}</h1>
  <p>${body}</p>
</main>
</body>
</html>`
    return new NextResponse(html, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store, max-age=0" },
    })
}
