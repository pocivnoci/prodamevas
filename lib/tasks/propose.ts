/**
 * Navrhovač úkolů — co by nám dneska nemělo uniknout.
 * ═══════════════════════════════════════════════════
 * Seznam úkolů dosud plnili jen lidi ručně z Google tabulky. Jenže věci, které
 * je potřeba udělat, se dají poznat z dat: klient s odpojeným Instagramem,
 * příspěvky, kterým faktická brána označila tvrzení, schválení, které leží týden,
 * úkol zablokovaný od června.
 *
 * Tenhle modul z takových signálů udělá **návrhy úkolů** pro Tomáše a Luďka —
 * s rovnou vyplněným zadáním, takže se s nimi dá začít pracovat bez třídění.
 *
 * Tři pravidla, bez kterých by z toho byl generátor šumu:
 *
 * 1. **Jen z doloženého signálu.** Model dostane snímek stavu firmy a smí
 *    navrhnout jen to, co v něm stojí. Žádný brainstorming — nápady bez opory
 *    zaplevelí seznam a lidi ho přestanou číst.
 * 2. **Nejvýš tři na běh.** Seznam, který ráno naroste o deset položek, je
 *    trest, ne pomoc.
 * 3. **Každý návrh jednou.** Klíč v `source_key` (prefix `ai:`) je claim přes
 *    unikátní index — stejná doktrína jako u syncu z tabulky. Zahozený návrh
 *    se proto nevrátí příští ráno; `dropped` úkol klíč drží dál.
 */

import supabaseAdmin from "@/supabase/admin"
import { NOT_SHOWCASE } from "@/lib/audience"
import { judgeText } from "@/instagram/judge"
import { buildClientHealth, describeRisks } from "@/lib/agents/client-health"
import { buildHealthCheck } from "@/lib/agents/health-check"
import { listPendingApprovals } from "@/lib/agent-safety"
import { logEvent } from "@/lib/tasks/triage"

/** Prefix klíče, podle kterého se pozná návrh od AI. Sync z tabulky si ho nevšímá. */
export const AI_KEY_PREFIX = "ai:"

const MAX_PER_RUN = 3
const DAY_MS = 24 * 60 * 60 * 1000

export interface ProposeSummary {
    navrzeno: number
    preskoceno: number
    signalu: number
}

interface Proposal {
    key?: string
    title?: string
    cil?: string
    hotovo?: string
    kde_zacit?: string
    next_step?: string
    effort?: string
    agent?: string
    role?: string
    klient?: string
}

/** Sesbírá signály a založí z nich návrhy úkolů. */
export async function proposeTasks(): Promise<ProposeSummary> {
    const signals = await collectSignals()
    if (signals.length === 0) return { navrzeno: 0, preskoceno: 0, signalu: 0 }

    const [{ data: team }, { data: openTasks }, { data: clients }] = await Promise.all([
        supabaseAdmin.from("team_members").select("email, name, role").eq("active", true),
        // Otevřené úkoly jdou do promptu proto, aby model nenavrhl potřetí totéž
        // jinými slovy. Klíč chrání před duplicitou v databázi, tohle před tím,
        // aby ji vůbec vymyslel.
        supabaseAdmin.from("tasks").select("title, status").neq("status", "dropped").limit(60),
        supabaseAdmin.from("clients").select("id, slug").eq("is_active", true).or(NOT_SHOWCASE),
    ])

    const raw = await askModel(signals, team || [], (openTasks || []).map(t => t.title))
    const proposals = (raw || []).slice(0, MAX_PER_RUN)

    let navrzeno = 0
    let preskoceno = 0

    for (const p of proposals) {
        const title = clean(p.title)
        const key = clean(p.key)
        if (!title || !key) { preskoceno++; continue }

        const sourceKey = `${AI_KEY_PREFIX}${key}`
        const { data: existing } = await supabaseAdmin
            .from("tasks").select("id").eq("source_key", sourceKey).maybeSingle()
        if (existing) { preskoceno++; continue }

        const owner = pickOwner(clean(p.role), team || [])
        const clientId = (clients || []).find(c => c.slug === clean(p.klient))?.id ?? null

        // Vzniká rovnou s razítkem `spec_at`: návrh přichází se zadáním, takže
        // ho třídič nemá co třídit podruhé.
        const { data: task, error } = await supabaseAdmin
            .from("tasks")
            .insert({
                title,
                owner_email: owner,
                status: "todo",
                source: "app",
                source_key: sourceKey,
                created_by: "ai",
                updated_by: "ai",
                spec: { cil: clean(p.cil) || title, hotovo: clean(p.hotovo), kde_zacit: clean(p.kde_zacit) || undefined },
                spec_at: new Date().toISOString(),
                next_step: clean(p.next_step) || null,
                effort: ["S", "M", "L"].includes(String(p.effort)) ? p.effort : null,
                agent: ["ops", "code"].includes(String(p.agent)) ? p.agent : null,
                client_id: clientId,
            })
            .select("id")
            .single()

        if (error || !task) {
            // 23505 = někdo (nebo souběžný běh) klíč zabral dřív. Konec, ne důvod
            // zakládat úkol bez klíče — to je přesně ta cesta k duplicitám.
            if (error?.code !== "23505") console.warn(`propose: návrh „${title}" se nepodařilo založit: ${error?.message}`)
            preskoceno++
            continue
        }

        await logEvent(task.id, "ai", "note", "Návrh od AI — vznikl ze stavu systému, ne z tabulky. Když to není téma, zahoď ho a už se nevrátí.")
        navrzeno++
    }

    console.log(`🧭 Návrhy úkolů: ${navrzeno} nových, ${preskoceno} přeskočeno (z ${signals.length} signálů)`)
    return { navrzeno, preskoceno, signalu: signals.length }
}

/**
 * Snímek stavu firmy v holých větách.
 *
 * Schválně se skládá z existujících detektorů (`health-check`, `client-health`,
 * fronta schválení) místo vlastních dotazů — jeden zdroj pravdy o tom, co je
 * špatně, ne druhý, který se s ním časem rozejde.
 */
async function collectSignals(): Promise<string[]> {
    const out: string[] = []

    const health = await buildHealthCheck().catch(() => null)
    for (const p of health?.problems ?? []) out.push(`PROVOZ: ${p.title} — ${p.detail}`)

    const rows = await buildClientHealth().catch(() => [])
    for (const r of rows) {
        if (r.risks.length) out.push(`KLIENT ${r.slug} (${r.name}): ${describeRisks(r.risks)}; posty za 14 dní: ${r.postsLast14d}`)
    }

    const approvals = await listPendingApprovals().catch(() => [])
    const stale = approvals.filter(a => Date.now() - new Date(a.createdAt).getTime() > 3 * DAY_MS)
    if (stale.length) out.push(`SCHVÁLENÍ: ${stale.length} akcí čeká na kliknutí déle než 3 dny (nejstarší: ${stale[0].action})`)

    // Příspěvky, kterým brána označila tvrzení. Je to práce pro člověka — buď
    // doložit fakt, nebo tvrzení z textu vyhodit — a dnes na ni nic neupozorní.
    const since = new Date(Date.now() - 14 * DAY_MS).toISOString()
    const { data: flagged } = await supabaseAdmin
        .from("ig_generation_log")
        .select("client_id")
        .eq("fact_status", "flagged")
        .gte("created_at", since)
    if (flagged?.length) {
        const perClient = new Map<string, number>()
        for (const f of flagged) perClient.set(f.client_id, (perClient.get(f.client_id) ?? 0) + 1)
        // Výloha sem nepatří: označené tvrzení u demo značky je vyřešené tím, že
        // se takový příspěvek do portfolia nepustí (`scripts/export-portfolio.ts`).
        // Bez tohohle filtru vznikl 7. 9. 2026 úkol „projít označená tvrzení
        // u klientů" se seznamem, kde bylo všech pět jmen z výlohy — 155 ze 180
        // označených příspěvků nemá žádného zákazníka, který by je četl.
        const { data: names } = await supabaseAdmin.from("clients")
            .select("id, slug").in("id", [...perClient.keys()]).or(NOT_SHOWCASE)
        for (const c of names || []) out.push(`FAKTA: klient ${c.slug} má ${perClient.get(c.id)} příspěvků s označeným tvrzením (14 dní)`)
    }

    // Úkol, který visí v blokaci měsíc, je buď mrtvý, nebo o něm nikdo neví.
    const monthAgo = new Date(Date.now() - 30 * DAY_MS).toISOString()
    const { data: stuck } = await supabaseAdmin
        .from("tasks")
        .select("title, blocked_on, updated_at")
        .eq("status", "blocked")
        .lt("updated_at", monthAgo)
        .limit(5)
    for (const t of stuck || []) out.push(`ZASEKLÝ ÚKOL: „${t.title}" (${t.blocked_on || "bez důvodu"}) se měsíc nehnul`)

    return out
}

async function askModel(
    signals: string[],
    team: { email: string; name: string; role: string }[],
    openTitles: string[],
): Promise<Proposal[] | null> {
    const teamLine = team.map(t => `${t.role} = ${t.name}: ${t.role === "founder" ? "produkt, kód, web" : "obchod, klienti, papíry, prezentace"}`).join("\n")

    const prompt = `Jsi provozní asistent malé firmy (Chrlit — AI generátor instagramového obsahu pro firmy).
Dostaneš SNÍMEK STAVU systému. Navrhni nejvýš ${MAX_PER_RUN} úkoly, které z něj plynou.

SNÍMEK
${signals.join("\n")}

UŽ OTEVŘENÉ ÚKOLY (nenavrhuj totéž jinými slovy)
${openTitles.slice(0, 40).join("\n") || "(žádné)"}

TÝM
${teamLine}

PRAVIDLA
- Navrhuj JEN to, co má oporu ve snímku. Žádné obecné rady ("dělat marketing"), žádné nápady bez signálu.
- Když ze snímku nic naléhavého neplyne, vrať prázdné pole. Nic je lepší než vata.
- "key": krátký stabilní identifikátor bez diakritiky, ze kterého je poznat, čeho se to týká (např. "ig-odpojeny-liqui-moly", "fakta-hydroizolace"). Stejný problém = stejný klíč i za měsíc.
- "hotovo" musí být ověřitelné.
- "role": "founder" = všechno UVNITŘ systému (kód, produkt, web, data, fronta schválení, kontrola obsahu); "manager" = všechno, co znamená MLUVIT S NĚKÝM VEN (klient, banka, dodavatel, prezentace, schůzka). Když se úkol dá udělat bez kontaktu ven, patří zakladateli.
- "agent": "code" = skončí to změnou v aplikaci, "ops" = práce s daty uvnitř systému, null = potřebuje člověka ve světě.
- "effort": S do půl hodiny, M do půl dne, L víc.
- Piš česky a konkrétně, včetně názvu klienta, když se to týká jeho.

Vrať POUZE JSON pole:
[{"key":"...","title":"...","cil":"...","hotovo":"...","kde_zacit":"...","next_step":"...","effort":"S|M|L","agent":"code|ops|null","role":"founder|manager","klient":"slug nebo null"}]`

    const raw = await judgeText(prompt, { label: "task-propose", maxTokens: 1200 })
    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim()
    const start = cleaned.indexOf("[")
    const end = cleaned.lastIndexOf("]")
    if (start < 0 || end <= start) return null
    try { return JSON.parse(cleaned.slice(start, end + 1)) as Proposal[] } catch { return null }
}

/** Role → konkrétní člověk. Když role nesedí, návrh zůstane nepřiřazený — to je lepší než hodit ho náhodnému člověku. */
function pickOwner(role: string, team: { email: string; role: string }[]): string | null {
    return team.find(t => t.role === role)?.email ?? null
}

function clean(v: unknown): string {
    const s = typeof v === "string" ? v.trim() : ""
    return s && s.toLowerCase() !== "null" && s !== "-" ? s : ""
}
