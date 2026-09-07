/**
 * Úkoly — čisté kontroly (bez sítě, bez DB).
 *   npx tsx scripts/test-ukoly.ts
 *
 * Dvě věci se tu hlídají, protože obě selžou tiše:
 *
 * 1. **Sync nesmí sáhnout na sloupce, které vlastní aplikace.** Kdyby ano, každé
 *    pondělí a čtvrtek by přepsal stav i vlastníka a nikdo by si toho nevšiml až
 *    do chvíle, kdy by se hledal odbavený úkol.
 * 2. **Každá akce nad úkoly musí projít `requireSuperAdmin()`.** Chybějící brána
 *    nic nerozbije — jen otevře interní backlog komukoliv s odkazem.
 */

import { readFileSync } from "fs"
import { resolve } from "path"
import { parseSheetRows, sourceKeyFor } from "../lib/tasks/sheet-parse"
import { suggestRole, normalizeText } from "../lib/team"

const ROOT = resolve(__dirname, "..")

let passed = 0
let failed = 0
const fails: string[] = []

function check(name: string, cond: boolean, detail?: string) {
    if (cond) { passed++; console.log(`  ✅ ${name}`) }
    else { failed++; fails.push(name); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`) }
}

/** Kód bez komentářů — aserce nesmí projít jen proto, že se slovo vyskytlo v komentáři. */
function codeOnly(rel: string): string {
    return readFileSync(resolve(ROOT, rel), "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
}

function file(rel: string): string {
    return readFileSync(resolve(ROOT, rel), "utf-8")
}

console.log("\n📋 ÚKOLY\n")

// ── 1. Parser listu ÚKOLY ───────────────────────────────────
// Skutečný tvar dat: sloučené buňky přes A–H, stav v I, poznámka v J.
const SAMPLE: string[][] = [
    ["termích schůze 6.9.", "", "", "", "", "", "", "", "stav", "poznámka"],
    ["zmenit fotky na instagramu", "", "", "", "", "", "", "", "prio 1", "ruzne obory"],
    ["", "", "", "", "", "", "", "", "", ""],
    ["NOVÉ požadavky viz. níže", "", "", "", "", "", "", "", "", ""],
    ["hydroizolace - zkontrolovat fakta!!", "", "", "", "", "", "", "", "", ""],
    ["zmenit  FOTKY na Instagramu", "", "", "", "", "", "", "", "prio 2", ""],
]
const parsed = parseSheetRows(SAMPLE)

check("hlavička tabulky není úkol", !parsed.some(t => t.title.startsWith("termích")))
check("oddělovač „NOVÉ požadavky“ není úkol", !parsed.some(t => t.title.startsWith("NOVÉ")))
check("prázdný řádek se přeskočí", parsed.length === 2, `dostal ${parsed.length}`)
check("priorita se čte ze sloupce I", parsed[0]?.priority === 1)
check("poznámka se čte ze sloupce J", parsed[0]?.note === "ruzne obory")
check("řádek bez priority ji má prázdnou", parsed[1]?.priority === null)

// Diakritika, velikost písmen ani zdvojená mezera nesmí založit druhý úkol vedle
// prvního — jinak by oprava překlepu v tabulce seznam rozdvojila.
check(
    "klíč řádku přežije diakritiku, velikost písmen i dvojité mezery",
    sourceKeyFor("Změnit  FOTKY na Instagramu") === sourceKeyFor("zmenit fotky na instagramu"),
)
check("duplicitní řádek se do výsledku nedostane dvakrát", parsed.length === 2)

// ── 2. Návrh vlastníka ──────────────────────────────────────
check("„zavolat klientovi“ je obchod", suggestRole("zavolat Michalovi ohledne schuzky") === "manager")
check("„opravit generování postů“ je produkt", suggestRole("opravit generovani prispevku v appce") === "founder")
check("neutrální text nikoho nenavrhne", suggestRole("koupit kafe") === null)
check("bez diakritiky se hledá stejně", normalizeText("SCHŮZKA") === "schuzka")

// ── 3. Sync nesahá na sloupce aplikace ──────────────────────
const syncCode = codeOnly("lib/tasks/sheet-sync.ts")

// Update větev smí nést jen sloupce tabulky. `owner_email` se v souboru vyskytuje
// legitimně u ZAKLÁDÁNÍ nového úkolu (návrh vlastníka), proto se kontroluje tvar
// zápisu, ne pouhý výskyt slova.
const updateBlock = syncCode.slice(syncCode.indexOf('.from("tasks")\n            .update('))
check(
    "update ze syncu nepřepisuje stav úkolu",
    !/\bstatus:/.test(updateBlock),
    "sync by přepsal, co tým odbavil",
)
check(
    "update ze syncu nepřepisuje vlastníka",
    !/owner_email:/.test(updateBlock),
    "ručně přiřazený úkol by se v úterý vrátil na návrh podle klíčových slov",
)
check(
    "update ze syncu nepřepisuje termín",
    !/due_date:/.test(updateBlock),
)
check("sync nemaže úkoly, které z tabulky zmizely", !syncCode.includes(".delete("))
check("sync zakládá přes source_key", syncCode.includes("source_key: task.sourceKey"))

// Unikátní index je to, na čem stojí idempotence — bez něj sync duplikuje.
// Bez komentářů: `client_id` se v hlavičce migrace legitimně vysvětluje slovy.
const migration = file("supabase/migrations/20260907_ukoly.sql").replace(/^\s*--.*$/gm, "")
check(
    "migrace má unikátní index na source_key",
    /create unique index[\s\S]*?on tasks \(source_key\)/i.test(migration),
)
check("tasks nemá client_id", !/client_id/.test(migration))
check("RLS je zapnuté na obou tabulkách",
    /alter table team_members enable row level security/i.test(migration) &&
    /alter table tasks enable row level security/i.test(migration))

// ── 4. Brána ────────────────────────────────────────────────
const actions = codeOnly("app/actions/task-actions.ts")
const exported = [...actions.matchAll(/export async function (\w+)/g)].map(m => m[1])
check("akce nad úkoly existují", exported.length >= 6, `našel ${exported.length}`)

// Každá exportovaná akce musí mít bránu ve svém vlastním těle. Jedna zapomenutá
// otevře interní backlog komukoliv, kdo trefí URL — a nic se nerozbije.
const missingGuard = exported.filter(name => {
    const start = actions.indexOf(`export async function ${name}`)
    const next = actions.indexOf("export async function ", start + 1)
    const body = actions.slice(start, next === -1 ? undefined : next)
    return !body.includes("requireSuperAdmin()")
})
check("každá akce volá requireSuperAdmin()", missingGuard.length === 0, missingGuard.join(", "))

const cron = codeOnly("app/api/cron/tasks-sync/route.ts")
check("cron route kontroluje CRON_SECRET", cron.includes("CRON_SECRET") && cron.includes("Bearer"))

// ── 5. Registr navigace ─────────────────────────────────────
// Sekce mimo registr je dosažitelná jen ručním hashem a v sidebaru chybí — přesně
// ta chyba, kvůli které registr vznikl.
check('nav.ts zná sekci "tasks"', file("app/(dashboard)/nav.ts").includes('id: "tasks"'))
check('StudioSection zná "tasks"', file("app/(dashboard)/StudioContext.tsx").includes('| "tasks"'))
const page = file("app/(dashboard)/dashboard/instagram/page.tsx")
check(
    "sekce Úkoly je za adminskou bránou i v renderu",
    page.includes('activeSection === "tasks" && isAdmin'),
    "bez toho ji otevře kdokoliv přes #tasks",
)

// ── 6. Ruční úprava textu příspěvku ─────────────────────────
const postEdit = codeOnly("app/actions/post-edit-actions.ts")
const manualStart = postEdit.indexOf("export async function saveManualText")
check("saveManualText existuje", manualStart !== -1)
const manualBody = manualStart === -1 ? "" : postEdit.slice(manualStart, postEdit.indexOf("export async function revertPostEdit"))

check("ruční text se zapisuje na místě, nikdy novým řádkem", !manualBody.includes(".insert("))
check("zápis je omezený na klienta", manualBody.includes('.eq("client_id", clientId)'))
check("předchozí znění jde do historie", manualBody.includes("edit_history"))
check("publikovaný příspěvek se ručně přepsat nedá", manualBody.includes('post.status === "posted"'))
// Tohle je celý smysl té cesty: když engine napíše nepravdu, další model ji nemá
// přepisovat — text bere doslova, jak ho člověk napsal.
check("ruční úprava nevolá copywritera", !manualBody.includes("reviseCaption"))
check("ruční úprava nekreslí obrázek",
    !manualBody.includes("renderImage") && !manualBody.includes("editExistingImage"))
// Bez tohohle by na opraveném textu zůstal viset příznak ze staré verze.
check("ruční úprava osvěží stav faktické brány", manualBody.includes("refreshFactStatus"))

// Brána nad hotovým postem smí jen značkovat. `safe` a `balanced` umí přepisovat —
// a přepsat člověku jeho vlastní text je horší než tvrzení nechat označené.
const refreshStart = postEdit.indexOf("async function refreshFactStatus")
const refreshBody = refreshStart === -1 ? "" : postEdit.slice(refreshStart)
check("brána nad hotovým postem jede jen v režimu bold", refreshBody.includes('factCheckMode: "bold"'))
check("stav se zapisuje k nejnovějšímu logu", refreshBody.includes("fact_status") && refreshBody.includes("ig_generation_log"))

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} prošlo, ${failed} selhalo`)
if (failed > 0) {
    console.log(`\nSelhalo:\n${fails.map(f => `  · ${f}`).join("\n")}\n`)
    process.exit(1)
}
console.log()
