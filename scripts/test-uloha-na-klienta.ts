/**
 * Aserce nad rozesláním denní práce na klienta (`lib/agents/fan-out.ts`).
 *   npx tsx scripts/test-uloha-na-klienta.ts
 *
 * Statické, bez databáze. Hlídá to, co by se při další úpravě dalo pokazit tiše:
 *
 *  1. Plánovač NESMÍ volat model ani dělat dotaz na klienta. Kdyby to dělal,
 *     vrátí se přesně ten problém, kvůli kterému vznikl — jeden běh s rozpočtem
 *     600 s, do kterého se vejde ~20 klientů.
 *  2. Dvojí zařazení drží databáze (unikátní index), ne kontrola před zápisem.
 *     „Zjisti a pak zapiš" je závod, ve kterém se model zaplatí dvakrát.
 *  3. Pojistky zůstávají v práci na klienta, ne v plánovači.
 *  4. Kolize klíče je normální výsledek, ne výjimka — ale JEN u fan-outu.
 *  5. Index je částečný (jen pending/running), jinak by agent umřel po prvním
 *     dni: zítřejší běh by se o tentýž klíč nepřihlásil.
 */

import fs from "fs"

let failed = 0
function check(name: string, ok: boolean, hint?: string) {
    if (ok) console.log(`  ✓ ${name}`)
    else { failed++; console.log(`  ✗ ${name}${hint ? `\n      ${hint}` : ""}`) }
}

const read = (p: string) => fs.readFileSync(p, "utf-8")
const fanout = read("lib/agents/fan-out.ts")
const replenish = read("lib/agents/idea-replenish.ts")
const handlers = read("lib/agents/handlers.ts")
const runner = read("lib/agent-runner.ts")
const brief = read("lib/agents/daily-brief.ts")
const migration = read("supabase/migrations/20260910_uloha_na_klienta.sql")

console.log("\nRozeslání práce na klienta — hranice, které se nesmí posunout\n")

// ── 1. Plánovač zůstává levný ───────────────────────────────────────────────
const planner = replenish.slice(replenish.indexOf("export async function planIdeaReplenish"))
check(
    "plánovač nevolá generování nápadů",
    !/generateAIIdeas/.test(planner),
    "Volání modelu v plánovači vrací zpátky sdílený běh s rozpočtem 600 s.",
)
check(
    "plánovač nevolá replenishClient",
    !/replenishClient\(/.test(planner),
)
check(
    "aktivitu klientů čte plánovač jedním dotazem, ne v cyklu",
    /\.in\("client_id", eligible\.map/.test(planner) && !/for \(const .*of eligible\)[\s\S]{0,300}await supabaseAdmin/.test(planner),
    "Dotaz na klienta v plánovači je přesně to, čemu se rozeslání vyhýbá.",
)

// ── 2. Dedupe drží databáze ─────────────────────────────────────────────────
check(
    "existuje unikátní index na dedupe_key",
    /create unique index[\s\S]{0,200}agent_tasks \(dedupe_key\)/i.test(migration),
)
check(
    "index platí JEN mezi pending/running",
    /where dedupe_key is not null and status in \('pending', 'running'\)/i.test(migration),
    "Kdyby platil i na `done`, zítřejší běh se o tentýž klíč nepřihlásí a agent umře po prvním dni.",
)
check(
    "fan-out nekontroluje existenci úlohy před zápisem",
    !/select[\s\S]{0,200}agent_tasks/i.test(fanout),
    "„Zjisti a pak zapiš“ je závod — dva plánovače projdou kontrolou oba.",
)
check(
    "kolize 23505 se čte jako „už zařazeno“, ne jako chyba",
    /23505/.test(runner) && /return null/.test(runner),
)

// ── 3. Pojistky zůstávají dole ──────────────────────────────────────────────
const perClient = replenish.slice(
    replenish.indexOf("export async function replenishClient"),
    replenish.indexOf("export async function replenishIdeaBanks"),
)
check(
    "opt-out se kontroluje v práci na klienta",
    /autoReplenishIdeas === false/.test(perClient),
)
check(
    "spící klient se kontroluje v práci na klienta",
    /ACTIVITY_WINDOW_DAYS/.test(perClient),
    "Filtr v plánovači je optimalizace, ne bezpečnostní hranice — úloha se dá zavolat i jinudy.",
)
check(
    "strop dávek na běh zůstává",
    /MAX_BATCHES_PER_RUN/.test(replenish),
)

// ── 4. Kolize je normální jen u fan-outu ────────────────────────────────────
check(
    "enqueueTask dál hází při kolizi",
    /export async function enqueueTask[\s\S]{0,1800}throw new Error/.test(runner),
    "Mimo rozesílání je chybějící úloha problém, o kterém se volající musí dozvědět.",
)
check(
    "tryEnqueueTask vrací null místo výjimky",
    /export async function tryEnqueueTask[\s\S]{0,300}Promise<string \| null>/.test(runner),
)
check(
    "fan-out používá tryEnqueueTask, ne enqueueTask",
    /tryEnqueueTask/.test(fanout) && !/[^y]\benqueueTask\(/.test(fanout),
)
check(
    "chyba u jednoho klienta nezastaví ostatní",
    /try \{[\s\S]{0,600}catch \(err\)[\s\S]{0,200}result\.failed\.push/.test(fanout),
)

// ── 5. Zapojení a viditelnost ───────────────────────────────────────────────
check(
    "handler idea_replenish je plánovač",
    /registerHandler\("idea_replenish"[\s\S]{0,300}planIdeaReplenish/.test(handlers),
)
check(
    "handler idea_replenish_client existuje a vyžaduje client_id",
    /registerHandler\("idea_replenish_client"[\s\S]{0,300}task\.client_id[\s\S]{0,200}throw new Error/.test(handlers),
    "Úloha bez klienta by tiše nedělala nic — a nikdo by se to nedozvěděl.",
)
check(
    "obě úlohy mají český štítek v ranním briefu",
    /idea_replenish:/.test(brief) && /idea_replenish_client:/.test(brief),
    "Bez štítku spadne rozeslaná práce do „Ostatní“ a v jediném e-mailu, který se čte, zmizí.",
)
check(
    "sweepClients zůstává pro levné průchody",
    /sweepClients/.test(read("lib/agents/auto-publish.ts")),
    "Rozeslání je pro AI-náročnou práci; u pár dotazů do databáze je sweep levnější.",
)

console.log(failed === 0 ? "\n✅ Rozeslání práce: všechny aserce prošly\n" : `\n❌ Rozeslání práce: ${failed} aserce selhalo\n`)
process.exitCode = failed === 0 ? 0 : 1
