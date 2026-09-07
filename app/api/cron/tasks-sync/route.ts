import { NextResponse } from "next/server"
import { syncTasksFromSheet } from "@/lib/tasks/sheet-sync"

/**
 * Sync úkolů z Google tabulky — pondělí a čtvrtek ráno.
 *
 * Proč cron v aplikaci a ne naplánovaná relace agenta: egress proxy blokuje
 * `www.chrlit.cz`, takže agent běžící mimo produkci nemá kam zapsat. Tady se navíc
 * nic neděje, když zrovna nikdo nic nespustil.
 *
 * Auth: `CRON_SECRET` bearer (v cronu není uživatelská session).
 */
export async function GET(req: Request) {
    const secret = process.env.CRON_SECRET
    const auth = req.headers.get("authorization")
    if (!secret || auth !== `Bearer ${secret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    try {
        const summary = await syncTasksFromSheet()
        if (summary.skipped) {
            // Chybějící konfigurace není chyba běhu — jen se nic nestalo.
            console.log(`⏭️  Sync úkolů přeskočen: ${summary.skipped}`)
            return NextResponse.json({ ok: true, ...summary })
        }

        console.log(
            `✅ Sync úkolů: ${summary.novych} nových, ${summary.zmenenych} změněných, ` +
            `${summary.bezeZmeny} beze změny, ${summary.chybiVTabulce.length} už není v tabulce`
        )
        return NextResponse.json({ ok: true, ...summary })
    } catch (err) {
        const message = (err as Error)?.message || "sync selhal"
        console.error("tasks-sync error:", message)
        return NextResponse.json({ ok: false, error: message }, { status: 500 })
    }
}
