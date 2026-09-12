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
 *
 * Jediná výjimka z „ke čtení" jsou příchozí kontakty z landingu: tam jsme slíbili
 * hovor do jednoho pracovního dne, takže je to práce pro člověka. Proto stojí
 * první a proto mají vlastní řádek pro ty, co čekají déle než den.
 */

import supabaseAdmin from "@/supabase/admin"
import type { BriefLine } from "@/lib/agents/daily-brief"
import { DAILY_SEND_CAP } from "./pipeline"
import { isOutreachConfigured, outreachSetupHint } from "./transport"
import { countLabel, DAYS, LEADS } from "@/lib/plural"

const DEN_MS = 24 * 3600_000

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

/** Interní adresy a testy se do briefu počítat nesmí — stejné pravidlo jako
 *  v `lib/agents/waitlist-invite.ts`, jen se tu nesmí sáhnout na auth. */
function jeInterni(email: string): boolean {
    const e = email.toLowerCase()
    return e.endsWith("@example.com") || e.includes("qa-test")
        || e.endsWith("@prodamevas.cz") || e.endsWith("@chrlit.cz")
}

/**
 * Kdo si na landingu řekl o hovor a ještě ho nedostal.
 *
 * Tohle je jediná část briefu, kterou si vynutil samotný web: landing od 9/2026
 * neslibuje pořadník, ale že se ozve člověk. Slib, který nikdo nehlídá, je
 * přesně to, co se tu už jednou stalo — 8. 9. 2026 čekalo v tabulce šest
 * skutečných lidí, nejstarší od 18. května, a nikdo se jim neozval.
 *
 * Řádky jsou dva schválně: „noví" je práce na dnešek, „čekají" je dluh. Kdyby
 * to byl jeden součet, dluh by se schoval mezi nové a nikdy by nedošel.
 */
async function inboundLines(now: Date, since: Date): Promise<BriefLine[]> {
    const { data, error } = await supabaseAdmin
        .from("waitlist")
        .select("email, phone, website, plan_interest, created_at")
        .is("contacted_at", null)
        .is("invited_at", null)
        .order("created_at", { ascending: true })
    if (error || !data) return []

    const cekaji = data.filter(r => !jeInterni(r.email))
    if (cekaji.length === 0) return []

    const lines: BriefLine[] = []
    const popis = (r: (typeof cekaji)[number]) =>
        [r.email, r.phone, r.website, r.plan_interest].filter(Boolean).join(" · ")

    const novi = cekaji.filter(r => new Date(r.created_at) >= since)
    if (novi.length > 0) {
        lines.push({
            icon: "🙋",
            text: `${novi.length}× nechal kontakt na webu`,
            detail: `${novi.map(popis).join(" | ")} — slíbili jsme hovor do jednoho pracovního dne`,
        })
    }

    // Dluh: kdo čeká přes den. Nejstarší je celý příběh, nemusí se vypisovat všichni.
    const stari = cekaji.filter(r => new Date(r.created_at) < since)
    if (stari.length > 0) {
        const dni = Math.floor((now.getTime() - new Date(stari[0].created_at).getTime()) / DEN_MS)
        lines.push({
            icon: dni >= 3 ? "🔴" : "⏳",
            text: `${countLabel(stari.length, LEADS)} čeká na ozvání`,
            detail: `nejdéle ${countLabel(dni, DAYS)} — ${popis(stari[0])}`,
        })
    }

    return lines
}

/**
 * Řádky za posledních 24 h. Prázdné pole = ticho, brief o prodeji nenapíše nic.
 * Tichý den nesmí generovat text — jinak se přestane číst i ten důležitý.
 */
export async function buildSalesLines(now: Date = new Date()): Promise<BriefLine[]> {
    const since = new Date(now.getTime() - 24 * 3600_000)
    const lines: BriefLine[] = []

    // Příchozí kontakty úplně první: člověk, který sám zvedl ruku, je nejteplejší
    // kontakt, jaký produkt má — a jediný, kde se čeká na nás.
    lines.push(...await inboundLines(now, since))

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
            detail: days >= 1 ? `vystačí na ${countLabel(days, DAYS)}` : "vystačí na necelý den",
        })
    }

    // Nenastavená přeprava se musí ozvat — jinak fronta roste a nic neodchází.
    if (!isOutreachConfigured() && queued > 0) {
        lines.push({ icon: "🔌", text: "oslovení se neodesílá", detail: outreachSetupHint() })
    }

    return lines
}
