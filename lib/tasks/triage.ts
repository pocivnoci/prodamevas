/**
 * Třídič úkolů — z řádku v tabulce udělá zadání.
 * ═══════════════════════════════════════════════
 * Úkol vzniká jako věta, kterou si někdo napsal pro sebe: „prezentace zpracování
 * změna". Pracují s ním ale tři strany — Tomáš, Luděk a agent — a ani jedna z ní
 * nepozná, co je hotovo, čím začít a kdo na to smí sáhnout.
 *
 * Třídič doplní právě tohle a **nic jiného**:
 *   spec.cil / spec.hotovo / spec.kde_zacit · next_step · effort · agent · client_id
 *
 * Do `title`, `note` ani `priority` nesahá — ty patří člověku. Kdyby je model
 * přepisoval, nikdo by v seznamu nepoznal větu, kterou tam sám napsal, a přestal
 * by mu věřit i to ostatní.
 *
 * **Když si není jistý, ptá se.** Úkol, ze kterého nejde odvodit „hotovo", není
 * úkol pro agenta ani pro člověka v deset večer — je to otázka. Zapíše se do
 * vlákna (`task_events`), úkol se odloží (`blocked_on`) a čeká na odpověď.
 * Domýšlet si zadání je horší než se zeptat: špatně pochopený úkol spolkne den.
 *
 * **Třídí se jednou.** `spec_at` je razítko; další běh úkol přeskočí. Odpověď na
 * otázku razítko vynuluje, takže se přečte znovu — už s odpovědí ve vlákně.
 * Bez toho by seznam platil model při každém průchodu za totéž.
 */

import { QUESTION_PREFIX } from "@/lib/tasks/question"
import supabaseAdmin from "@/supabase/admin"
import { judgeText } from "@/instagram/judge"

export interface TaskSpec {
    /** K čemu to je — jedna věta, ne odstavec. */
    cil: string
    /** Podle čeho se pozná konec. Tohle je to jediné, co z věty dělá zadání. */
    hotovo: string
    /** Kde začít: soubor, obrazovka, člověk, odkaz. */
    kde_zacit?: string
}

export interface TriageSummary {
    roztrideno: number
    otazek: number
    preskoceno: number
}

interface TaskRow {
    id: string
    title: string
    note: string | null
    owner_email: string | null
    priority: number | null
    status: string
}

/** Co model vrátí. Volnější než `TaskSpec` — všechno se validuje ručně. */
interface TriageOutput {
    cil?: string
    hotovo?: string
    kde_zacit?: string
    next_step?: string
    effort?: string
    agent?: string
    klient?: string
    otazka?: string
    ceka_na?: string
    ceka_do?: string
}

const MAX_PER_RUN = 12

/**
 * Roztřídí úkoly, které ještě nemají zadání.
 *
 * Strop na běh je schválně nízký: úkolů přibývá pár týdně a horní mez je
 * pojistka proti tomu, aby jeden pokažený sync (nebo omylem smazané `spec_at`)
 * neproběhl přes celou historii a nezaplatil model za tři sta řádků.
 */
export async function triageTasks(opts?: { limit?: number }): Promise<TriageSummary> {
    const limit = Math.min(opts?.limit ?? MAX_PER_RUN, MAX_PER_RUN)

    const { data: tasks } = await supabaseAdmin
        .from("tasks")
        .select("id, title, note, owner_email, priority, status")
        .is("spec_at", null)
        .in("status", ["todo", "doing", "blocked"])
        .order("priority", { ascending: true, nullsFirst: false })
        .limit(limit)

    if (!tasks?.length) return { roztrideno: 0, otazek: 0, preskoceno: 0 }

    // Katalog klientů a týmu se načte JEDNOU pro celou dávku — je to kontext
    // promptu, ne data úkolu, a dvanáct dotazů navíc by nic nepřineslo.
    const [{ data: clients }, { data: team }] = await Promise.all([
        supabaseAdmin.from("clients").select("id, slug, name").eq("is_active", true),
        supabaseAdmin.from("team_members").select("email, name, role").eq("active", true),
    ])

    let roztrideno = 0
    let otazek = 0
    let preskoceno = 0

    for (const task of tasks as TaskRow[]) {
        try {
            const answers = await recentAnswers(task.id)
            const out = await askModel(task, answers, clients || [], team || [])
            if (!out) { preskoceno++; continue }

            const asked = await applyTriage(task, out, clients || [])
            if (asked) otazek++
            roztrideno++
        } catch (err) {
            // Jeden nepovedený úkol nesmí shodit dávku — zbytek se roztřídí
            // a tenhle se zkusí příště, protože razítko nedostal.
            console.warn(`⚠️ triage: úkol ${task.id} se nepodařilo roztřídit: ${(err as Error)?.message?.slice(0, 120)}`)
            preskoceno++
        }
    }

    console.log(`🗂️ Třídění úkolů: ${roztrideno} roztříděno (${otazek} s otázkou), ${preskoceno} přeskočeno`)
    return { roztrideno, otazek, preskoceno }
}

/** Odpovědi lidí ve vlákně — kvůli nim se úkol třídí podruhé, tak musí do promptu. */
async function recentAnswers(taskId: string): Promise<string[]> {
    const { data } = await supabaseAdmin
        .from("task_events")
        .select("actor, kind, body")
        .eq("task_id", taskId)
        .in("kind", ["answer", "note"])
        .order("at", { ascending: true })
        .limit(10)
    return (data || []).map(e => `${e.actor}: ${e.body}`).filter(Boolean)
}

async function askModel(
    task: TaskRow,
    answers: string[],
    clients: { slug: string; name: string }[],
    team: { email: string; name: string; role: string }[],
): Promise<TriageOutput | null> {
    const teamLine = team.map(t => `${t.name} <${t.email}> — ${t.role === "founder" ? "produkt a kód" : "obchod, klienti, papíry"}`).join("\n")
    const clientLine = clients.slice(0, 60).map(c => `${c.slug} = ${c.name}`).join("\n")

    const prompt = `Jsi provozní asistent malé firmy (Chrlit — AI generátor instagramového obsahu).
Dostaneš JEDEN řádek z firemního seznamu úkolů, tak jak si ho někdo narychlo napsal.
Tvůj úkol: udělat z něj zadání, které pochopí druhý člověk i agent.

ÚKOL
název: ${task.title}
poznámka: ${task.note || "(žádná)"}
vlastník: ${task.owner_email || "(nepřiřazeno)"}
${answers.length ? `\nODPOVĚDI Z VLÁKNA (ptali jsme se dřív, tohle nám lidi odpověděli):\n${answers.join("\n")}` : ""}

TÝM (zakladatel = všechno uvnitř systému: kód, produkt, web, data, kontrola obsahu; obchod = všechno, co znamená mluvit s někým ven: klient, banka, prezentace, schůzka)
${teamLine}

KLIENTI (slug = název), když se úkol týká konkrétního
${clientLine}

PRAVIDLA
- Piš česky, krátce, konkrétně. Žádná vata typu "je třeba zajistit".
- "hotovo" musí být OVĚŘITELNÉ: podle čeho se pozná, že je konec. Ne "bude hotová prezentace", ale "prezentace existuje jako soubor a Luděk ji použil na schůzce".
- Když z řádku NEJDE odvodit, co je hotovo, nevymýšlej si: vrať pole "otazka" s JEDNOU krátkou otázkou pro autora. Ostatní pole pak vyplň, jak nejlíp umíš.
- "agent" = kdo to smí udělat bez člověka:
    "code" = změna v aplikaci nebo webu (skončí to pull requestem),
    "ops"  = práce s daty, e-maily, kontroly, rešerše uvnitř systému,
    null   = potřebuje člověka ve světě (banka, schůzka, focení, čekání na někoho cizího).
- "effort": S = do půl hodiny, M = do půl dne, L = víc.
- "ceka_na": vyplň JEN když úkol zjevně čeká na vnější událost (verifikace v bance, výsledky spolupráce). Krátce, co to je.
- "ceka_do": datum (YYYY-MM-DD), do kdy se tím nemá cenu zabývat. Odhadni podle poznámky ("během neděle" → nejbližší neděle). Neznámé = null; úkol pak zůstane v seznamu.
- Ptej se JEN když si to nejde rozumně domyslet. Když se dá vyjít z rozumného předpokladu a omyl by nic nestál, předpoklad napiš do "kde_zacit" a otázku vynech.
- "klient": slug z výpisu výš, jen když se úkol týká právě jednoho klienta.

Vrať POUZE JSON:
{"cil":"...","hotovo":"...","kde_zacit":"...","next_step":"...","effort":"S|M|L","agent":"code|ops|null","klient":"slug nebo null","otazka":"... nebo null","ceka_na":"... nebo null"}`

    // Soudcovská brána (Claude, s fallbackem na Pro ladder) schválně: tříděných
    // úkolů je pár týdně, ale výsledek čte člověk a řídí se jím agent. Flash-grade
    // zadání by byla vata, kterou stejně někdo musí přepsat — a to je dražší.
    const raw = await judgeText(prompt, { label: "task-triage", maxTokens: 700 })
    return parseJson(raw)
}

function parseJson(raw: string): TriageOutput | null {
    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim()
    try {
        return JSON.parse(cleaned) as TriageOutput
    } catch {
        const start = cleaned.indexOf("{")
        const end = cleaned.lastIndexOf("}")
        if (start < 0 || end <= start) return null
        try { return JSON.parse(cleaned.slice(start, end + 1)) as TriageOutput } catch { return null }
    }
}

/** Zapíše zadání. Vrací true, když se třídič na něco zeptal. */
async function applyTriage(
    task: TaskRow,
    out: TriageOutput,
    clients: { id: string; slug: string }[],
): Promise<boolean> {
    const cil = clean(out.cil)
    const hotovo = clean(out.hotovo)
    const question = clean(out.otazka)
    const waiting = clean(out.ceka_na)

    const spec: TaskSpec | null = cil || hotovo
        ? { cil: cil || task.title, hotovo: hotovo || "", kde_zacit: clean(out.kde_zacit) || undefined }
        : null

    const patch: Record<string, unknown> = {
        spec,
        spec_at: new Date().toISOString(),
        next_step: clean(out.next_step) || null,
        effort: ["S", "M", "L"].includes(String(out.effort)) ? out.effort : null,
        agent: ["ops", "code"].includes(String(out.agent)) ? out.agent : null,
        updated_at: new Date().toISOString(),
        updated_by: "ai",
    }

    // Klienta bere jen z výpisu, nikdy z toho, co model napsal — halucinovaný
    // slug by ukázal na cizího tenanta.
    const slug = clean(out.klient)
    let hit = slug ? clients.find(c => c.slug === slug) : undefined

    // Model klienta občas jen zmíní v textu a do pole nedá nic („hydroizolace —
    // zkontrolovat fakta"). Slug začíná názvem firmy, takže první slovo z názvu
    // úkolu ho dohledá spolehlivě a zadarmo. Shoda musí být na CELÉM slově,
    // ne na podřetězci — jinak by „pupp" trefil kdejaké slovo.
    if (!hit) {
        const words = task.title.toLowerCase().match(/[a-z0-9á-ž]{5,}/gi) || []
        hit = clients.find(c => words.some(w => c.slug.startsWith(w.toLowerCase())))
    }
    if (hit) patch.client_id = hit.id

    // Otázka a čekání jsou dva různé důvody, proč se úkol teď nedělá. Oba končí
    // v `blocked_on`, protože pro člověka v seznamu je to tatáž informace:
    // „tenhle si teď nevezmu a tady je proč".
    if (question) patch.blocked_on = `${QUESTION_PREFIX} ${question}`
    else if (waiting) patch.blocked_on = waiting
    else patch.blocked_on = null

    // Datum návratu je to jediné, co z „čeká na banku" dělá něco jiného než
    // věčně otevřený řádek. Bez data by se na úkol každý den znovu koukal
    // člověk i model.
    const until = clean(out.ceka_do)
    patch.blocked_until = /^\d{4}-\d{2}-\d{2}$/.test(until) ? until : null

    const { error } = await supabaseAdmin.from("tasks").update(patch).eq("id", task.id)
    if (error) throw new Error(error.message)

    await logEvent(task.id, "ai", "triage", summarize(spec, out), {
        effort: patch.effort, agent: patch.agent, next_step: patch.next_step,
    })
    if (question) await logEvent(task.id, "ai", "question", question)

    return !!question
}

function summarize(spec: TaskSpec | null, out: TriageOutput): string {
    if (!spec) return "Zadání se nepodařilo odvodit."
    const parts = [`Cíl: ${spec.cil}`]
    if (spec.hotovo) parts.push(`Hotovo, když: ${spec.hotovo}`)
    if (out.next_step) parts.push(`Další krok: ${out.next_step}`)
    return parts.join("\n")
}

function clean(v: unknown): string {
    const s = typeof v === "string" ? v.trim() : ""
    // Model občas napíše "null" jako řetězec — pro nás je to prázdno.
    return s && s.toLowerCase() !== "null" && s !== "-" ? s : ""
}

/** Zápis do vlákna. Nikdy nevyhodí — ztracená stopa nesmí shodit práci, kterou popisuje. */
export async function logEvent(
    taskId: string,
    actor: string,
    kind: "triage" | "question" | "answer" | "note" | "status" | "result",
    body?: string | null,
    meta?: Record<string, unknown>,
): Promise<void> {
    const { error } = await supabaseAdmin
        .from("task_events")
        .insert({ task_id: taskId, actor, kind, body: body || null, meta: meta || null })
    if (error) console.warn(`task_events: zápis (${kind}) selhal: ${error.message}`)
}
