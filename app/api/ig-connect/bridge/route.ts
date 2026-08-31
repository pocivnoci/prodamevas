import { NextResponse } from "next/server"
import { requireProjectAccess } from "@/lib/auth-guard"

/**
 * GET /api/ig-connect/bridge?slug={projectSlug}
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
 * Podepsaná adresa je CREDENTIAL — žije jen v hlavičce Location téhle odpovědi,
 * nikam se neloguje ani neukládá.
 */
export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const slug = searchParams.get("slug")
    if (!slug) {
        return NextResponse.json({ error: "Chybí slug projektu." }, { status: 400 })
    }

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
        const returnUrl = `${siteUrl}/api/ig-connect/bridge/return?slug=${encodeURIComponent(slug)}`
        const url = await generateConnectUrl(clientId, returnUrl)

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
