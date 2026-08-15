/**
 * GET /.well-known/apple-developer-merchantid-domain-association
 * (přepsáno sem přes rewrite v next.config.ts)
 *
 * Ověření domény pro Apple Pay ve VESTAVĚNÉ pokladně.
 *
 * PROČ TO VŮBEC POTŘEBUJEME
 * ─────────────────────────
 * V hostované pokladně běžel formulář na `checkout.stripe.com` — Stripova vlastní
 * doména, kterou má u Applu ověřenou, takže se Apple Pay zobrazoval sám. Vestavěná
 * pokladna běží na NAŠÍ doméně, a ta ověřená není: Apple Pay ani Google Pay se pak
 * mlčky nezobrazí. Žádná chyba, žádné hlášení — jen chybějící tlačítko.
 *
 * Apple vyžaduje, aby doména na téhle cestě vracela asociační soubor. Stripe je
 * u Apple Pay merchant of record, takže je ten soubor pro všechny jeho účty
 * stejný a Stripe ho veřejně hostuje.
 *
 * PROČ PROXY A NE KOPIE V `public/`
 * ─────────────────────────────────
 * Zkopírovaný soubor by tiše zestaral, kdyby ho Stripe otočil — a projevilo by se
 * to zase jen tím, že tlačítko zmizí. Proxy si ho bere od zdroje a drží v cache,
 * takže se opraví sama. Apple i Stripe si tuhle cestu sahají zřídka, takže to nic
 * nestojí.
 */

import { NextResponse } from "next/server"

const STRIPE_ASSOCIATION_FILE =
    "https://stripe.com/files/apple-pay/apple-developer-merchantid-domain-association"

/** Den v CDN, den ve stale-while-revalidate — výpadek stripe.com nesmí shodit ověření. */
export const revalidate = 86_400

export async function GET() {
    try {
        const upstream = await fetch(STRIPE_ASSOCIATION_FILE, {
            next: { revalidate },
        })
        if (!upstream.ok) throw new Error(`stripe.com vrátil ${upstream.status}`)
        const body = await upstream.text()

        // Apple soubor stahuje jako prostý text; `application/json` ani HTML neprojde.
        return new NextResponse(body, {
            status: 200,
            headers: {
                "Content-Type": "text/plain; charset=utf-8",
                "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
            },
        })
    } catch (err) {
        // Hlasitě: tichý 500 by znamenal, že Apple Pay zmizí a nikdo se nedozví proč.
        console.error(
            `❌ Ověřovací soubor pro Apple Pay se nepodařilo načíst (${(err as Error).message}). ` +
            `Apple Pay ve vestavěné pokladně se tím pádem nezobrazí.`
        )
        return new NextResponse("association file unavailable", { status: 502 })
    }
}
