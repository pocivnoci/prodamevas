/**
 * Obchodní řádky do denního briefu
 * ================================
 * ZÁMĚRNĚ to není vlastní e-mail. V repu už existuje `daily_brief` — jediná
 * denní zpráva zakladateli, která pohltila health check i compliance. Druhý
 * denní mail je nejspolehlivější způsob, jak se přestanou číst oba.
 *
 * Obsah je ke ČTENÍ, ne k odklikání: kvalitu odchozích zpráv drží soudce
 * (`instagram/judge.ts`), ne rozhodnutí člověka. Sem patří jen to, co se
 * skutečně stalo, a to, co je rozbité.
 */

import supabaseAdmin from "@/supabase/admin"
import type { BriefLine } from "@/lib/agents/daily-brief"
import { DAILY_SEND_CAP } from "./pipeline"
import { isOutreachConfigured, outreachSetupHint } from "./transport"

async function countEvents(kind: string, since: Date): Promise<number> {
    const { count } = await supabaseAdmin
        .from("lead_events").select("id", { count: "exact", head: true })
        .eq("kind", kind).gte("created_at", since.toISOString())
    return count ?? 0
}

async function countLeads(filter: (q: any) => any): Promise<number> {
    const { count } = await filter(
        supabaseAdmin.from("leads").select("id", { count: "exact", head: true }),
    )
    return count ?? 0
}

/**
 * Řádky za posledních 24 h. Prázdné pole = ticho, brief o prodeji nenapíše nic.
 * Tichý den nesmí generovat text — jinak se přestane číst i ten důležitý.
 */
export async function buildSalesLines(now: Date = new Date()): Promise<BriefLine[]> {
    const since = new Date(now.getTime() - 24 * 3600_000)
    const lines: BriefLine[] = []

    const [sent, previewed, replied, blocked, unsub] = await Promise.all([
        countEvents("sent", since),
        countEvents("previewed", since),
        countEvents("replied", since),
        countEvents("blocked", since),
        countEvents("unsubscribed", since),
    ])

    // Odpovědi první — je to jediná věc, kde je člověk skutečně potřeba.
    if (replied > 0) {
        lines.push({ icon: "💬", text: `${replied}× odpověď na oslovení`, detail: "tohle je na tobě" })
    }

    if (sent > 0) {
        const openRate = sent > 0 ? Math.round((previewed / sent) * 100) : 0
        lines.push({
            icon: "📤",
            text: `odesláno ${sent} z ${DAILY_SEND_CAP} oslovení`,
            detail: previewed > 0
                ? `ukázku otevřelo ${previewed} (${openRate} %)`
                : "ukázku zatím nikdo neotevřel",
        })
    }

    // Zablokované zprávy jsou signál o KVALITĚ, ne provozní šum: soudce je
    // zastavil, protože něco slibovaly nebo nebyly konkrétní.
    if (blocked > 0) {
        lines.push({
            icon: "🛑", text: `${blocked}× zpráva neprošla kontrolou`,
            detail: "soudce ji zastavil — když se to opakuje, je vadná šablona, ne jednotlivá zpráva",
        })
    }

    // Odhlášení hlídá doručitelnost. Přes práh se objem NEZVYŠUJE.
    if (unsub > 0) {
        const rate = sent > 0 ? Math.round((unsub / sent) * 100) : 0
        lines.push({
            icon: rate >= 3 ? "🔴" : "⚠️",
            text: `${unsub}× odhlášení${rate ? ` (${rate} % z odeslaných)` : ""}`,
            detail: rate >= 3 ? "vysoké — zastav objem a přepiš zprávu, tohle jde po doručitelnosti" : undefined,
        })
    }

    // Fronta: kolik čeká a jestli je z čeho brát.
    const queued = await countLeads((q: any) => q.eq("status", "qualified"))
    if (queued === 0 && sent > 0) {
        lines.push({ icon: "📭", text: "fronta kvalifikovaných leadů je prázdná", detail: "bez nových leadů se zítra nic nepošle" })
    } else if (queued > 0) {
        const days = Math.floor(queued / Math.max(1, DAILY_SEND_CAP))
        lines.push({
            icon: "📥", text: `${queued} kvalifikovaných leadů ve frontě`,
            detail: days >= 1 ? `vystačí na ${days} dní` : "vystačí na necelý den",
        })
    }

    // Nenastavená přeprava se musí ozvat — jinak fronta roste a nic neodchází.
    if (!isOutreachConfigured() && queued > 0) {
        lines.push({ icon: "🔌", text: "oslovení se neodesílá", detail: outreachSetupHint() })
    }

    return lines
}
