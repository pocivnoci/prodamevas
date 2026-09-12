import { NextResponse } from "next/server"
import { syncTasksFromSheet } from "@/lib/tasks/sheet-sync"

/**
 * Ruční import úkolů z Google tabulky.
 *
 * **Není to cron.** Zdroj pravdy o úkolech je databáze; tabulka je historický
 * vstup, ze kterého se jednou za čas dotáhne, co se do appky nedostalo. Rozvrh
 * ve `vercel.json` proto zmizel a route zůstala jako tlačítko na zavolání
 * (`curl -H "Authorization: Bearer $CRON_SECRET"`).
 *
 * Cesta přes API, ne přes skript: `lib/tasks/sheet-sync.ts` je server-only
 * a z lokálu se k produkční databázi nedostane.
 *
 * Auth: `CRON_SECRET` bearer — zůstává, mimo session se nedá ověřit člověk.
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
            console.log(`⏭️  Import úkolů přeskočen: ${summary.skipped}`)
            return NextResponse.json({ ok: true, ...summary })
        }

        console.log(
            `✅ Import úkolů: ${summary.novych} nových, ${summary.preskocenych} už v databázi bylo, ` +
            `${summary.chybiVTabulce.length} už není v tabulce`
        )

        // Nové řádky roztřídit HNED, ne až ranním cronem: kdo import spustil,
        // se na seznam dívá teď a holé věty z tabulky se nedají vzít do ruky.
        // Přes agent stack, ne přímo — ať je z toho řádek v auditu a ať se běh
        // chová stejně jako každá jiná agentská akce.
        if (summary.novych > 0) {
            const { requestAction } = await import("@/lib/agent-safety")
            await requestAction({
                agentType: "ops",
                action: `Roztřídění ${summary.novych} nových úkolů z importu`,
                riskTier: "internal",
                taskType: "task_triage",
                clientId: null,
                payload: {},
            })
        }
        return NextResponse.json({ ok: true, ...summary })
    } catch (err) {
        const message = (err as Error)?.message || "sync selhal"
        console.error("tasks-sync (import) error:", message)
        return NextResponse.json({ ok: false, error: message }, { status: 500 })
    }
}
