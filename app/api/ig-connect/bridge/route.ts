import { NextResponse } from "next/server"
import { requireProjectAccess } from "@/lib/auth-guard"

/**
 * GET /api/ig-connect/bridge?slug={projectSlug}[&external=1]
 *
 * Začátek připojení přes most (transport `uploadpost`). Ověří, že volající projekt
 * vlastní, nechá si od upload-postu podepsat 48hodinovou přihlašovací adresu a
 * rovnou na ni prohlížeč přesměruje.
 *
 * Proč to je ROUTA a ne server action + window.open(): popup blocker. Akce nejdřív
 * založí profil a vygeneruje JWT (dvě volání cizího API), takže než se `window.open`
 * dostane ke slovu, je uživatelské gesto dávno promlčené a prohlížeč okno zahodí.
 * Navenek to vypadá přesně jako hlášená chyba — profil na upload-postu vznikne, ale
 * přihlašovací stránka se nikdy neotevře. Odkaz na tuhle routu je normální navigace,
 * kterou blokovat nejde; stejně to dělá i naše vlastní OAuth (/api/ig-connect/start).
 *
 * Podepsaná adresa je CREDENTIAL — žije jen v odpovědi na tenhle jeden ověřený
 * požadavek (hlavička Location, nebo odkaz na mezistránce), nikam se neloguje ani
 * neukládá. Proto `no-store` na obou větvích.
 */
export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const slug = searchParams.get("slug")
    if (!slug) {
        return NextResponse.json({ error: "Chybí slug projektu." }, { status: 400 })
    }
    // Volající říká, že běží v prostředí, ze kterého se přihlášení k Instagramu
    // nedá dokončit (appka přidaná na plochu iPhonu). Viz interstitial() níž.
    const external = searchParams.get("external") === "1"

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || origin
    const dashboard = `${siteUrl}/dashboard/instagram`

    let clientId: string
    try {
        ;({ clientId } = await requireProjectAccess(slug))
    } catch {
        // Nepřihlášený / cizí projekt — ven na login, ať se z chybové hlášky nedá
        // vyčíst, které slugy existují.
        return NextResponse.redirect(`${siteUrl}/login`)
    }

    try {
        const { generateConnectUrl } = await import("@/lib/channels/uploadpost-profiles")
        let returnUrl = `${siteUrl}/api/ig-connect/bridge/return?slug=${encodeURIComponent(slug)}`
        // Návrat z externího prohlížeče nemá naši session (viz return routa), takže
        // musí vědět, že se nemá pokoušet o redirect do dashboardu.
        if (external) returnUrl += "&external=1"
        const url = await generateConnectUrl(clientId, returnUrl)

        if (external) return interstitial(url)

        const res = NextResponse.redirect(url)
        // Adresa je jednorázová a podepsaná; cache by ji nechala viset v historii
        // i proxy dávno po vypršení JWT.
        res.headers.set("Cache-Control", "no-store, max-age=0")
        return res
    } catch (err) {
        const message = (err as Error).message || ""
        console.error(`ig-connect/bridge: klient ${clientId} — ${message}`)
        // Vyčerpaný tarif profilů je jediná chyba, kterou uživatel umí sám vyřešit
        // (a kterou jinak nepozná od výpadku), tak ať se od ostatních liší.
        const reason = /\blimit\b|quota|plan|upgrade/i.test(message) ? "limit" : "error"
        return NextResponse.redirect(`${dashboard}?ig=${reason}#settings`)
    }
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
}

/**
 * Mezistránka, která poslední krok předá SKUTEČNÉMU prohlížeči.
 *
 * Chrlit je instalovatelná PWA (`display: standalone`). Když je přidaná na plochu
 * iPhonu, drží si iOS veškerou navigaci uvnitř svého WKWebView — včetně odchodu na
 * upload-post. Meta v embedded prohlížečích přihlášení blokuje, takže uživatel dojde
 * až na hostovanou stránku, klepne na Instagram a dostane „something went wrong".
 * Ověřeno 2026-09-01: tentýž účet přes tentýž odkaz na desktopu projde.
 *
 * Ven z webview vede jediná spolehlivá cesta: odkaz s `target="_blank"`, který iOS
 * otevře v Safari. Kliknout na něj musí uživatel — proto mezistránka, ne redirect,
 * a proto se nic neotevírá skriptem.
 *
 * Míří rovnou na adresu upload-postu, ne zpátky na naši routu: Safari má vlastní
 * cookie jar, takže naše session tam není a `requireProjectAccess` by uživatele
 * poslal na login. Podepsaný odkaz upload-postu žádnou naši session nepotřebuje.
 */
function interstitial(url: string): NextResponse {
    const html = `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Připojení Instagramu</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
       background:#050505;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif}
  main{max-width:420px;width:100%;border:1px solid rgba(255,255,255,.05);border-radius:2px;padding:28px 24px}
  .label{margin:0 0 10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.18em;color:rgba(255,255,255,.35)}
  h1{margin:0 0 12px;font-size:18px;font-weight:800;letter-spacing:-.02em;line-height:1.25}
  p.text{margin:0 0 22px;font-size:13px;line-height:1.6;color:rgba(255,255,255,.55)}
  a.btn{display:block;text-align:center;padding:14px 20px;border-radius:2px;text-decoration:none;
        font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.18em;
        background:rgba(236,72,153,.12);color:#f472b6;border:1px solid rgba(236,72,153,.25)}
  a.btn:active{background:rgba(236,72,153,.22)}
  .hint{margin:18px 0 0;font-size:10px;line-height:1.6;color:rgba(255,255,255,.28)}
</style>
</head>
<body>
<main>
  <p class="label">Připojení Instagramu</p>
  <h1>Poslední krok otevři v prohlížeči</h1>
  <p class="text">Instagram odmítá přihlášení uvnitř aplikace přidané na plochu. Tlačítko níž otevře přihlášení v Safari.</p>
  <a class="btn" href="${escapeHtml(url)}" target="_blank" rel="noopener">Otevřít přihlášení</a>
  <p class="hint">Až připojení dokončíš, přepni se zpátky do Chrlitu — účet se tu ověří sám.</p>
</main>
</body>
</html>`
    return new NextResponse(html, {
        status: 200,
        headers: {
            "Content-Type": "text/html; charset=utf-8",
            // Stránka nese podepsaný přihlašovací odkaz. Nikdy do cache.
            "Cache-Control": "no-store, max-age=0",
            "Referrer-Policy": "no-referrer",
        },
    })
}
