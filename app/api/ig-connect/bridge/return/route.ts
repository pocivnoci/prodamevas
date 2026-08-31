import { NextResponse } from "next/server"
import { syncUploadPostConnection } from "@/app/actions/ig-connection-actions"

/**
 * GET /api/ig-connect/bridge/return?slug={projectSlug}
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
    if (!slug) return NextResponse.redirect(`${dashboard}?ig=error#settings`)

    const res = await syncUploadPostConnection(slug)
    // `connected: false` není chyba, jen nedokončené připojení: uživatel se mohl
    // vrátit dřív, než účet skutečně propojil. Vlastní stav proto, aby mu Nastavení
    // řeklo „dokonči to", a ne „nepovedlo se".
    const flag = res.success ? (res.connected ? "connected" : "pending") : "error"
    return NextResponse.redirect(`${dashboard}?ig=${flag}#settings`)
}
