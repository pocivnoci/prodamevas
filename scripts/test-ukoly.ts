/**
 * Úkoly — čisté kontroly (bez sítě, bez DB).
 *   npx tsx scripts/test-ukoly.ts
 *
 * Dvě věci se tu hlídají, protože obě selžou tiše:
 *
 * 1. **Import z Google tabulky smí jen zakládat.** Zdroj pravdy je databáze;
 *    jediný `.update()` v importéru by tiše přepsal, co do úkolu někdo napsal
 *    v appce — a všimlo by si toho až ve chvíli, kdy se to hledá.
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

// ── 3. Import z tabulky jen zakládá ─────────────────────────
// Do 9/2026 tabulka vlastnila title/note/priority a sync je přepisoval. Dneska
// je zdroj pravdy databáze, takže importér smí jen INSERT. Kontroluje se tvar
// zápisu nad `tasks`, ne jednotlivé sloupce — jedna silná aserce místo tří
// slabých, které by přehlédly, kdyby se do update větve přidal sloupec nový.
const syncCode = codeOnly("lib/tasks/sheet-sync.ts")

check(
    "import nikdy neupravuje existující úkol",
    !/\.update\(/.test(syncCode),
    "co člověk v appce upřesnil, by příští import zahodil",
)
check("sync nemaže úkoly, které z tabulky zmizely", !syncCode.includes(".delete("))
check("sync zakládá přes source_key", syncCode.includes("source_key: task.sourceKey"))

// Cron by z importu udělal zpátky sync — a s ním i tichý přepis. Rozvrh proto
// ve `vercel.json` být nesmí; route zůstává jako ruční spuštění za CRON_SECRET.
const vercelJson = file("vercel.json")
check(
    "import úkolů nemá cron ve vercel.json",
    !vercelJson.includes("tasks-sync"),
    "naplánovaný běh by z jednosměrného importu udělal zpátky obousměrný sync",
)

// Unikátní index je to, na čem stojí idempotence — bez něj sync duplikuje.
// Bez komentářů: `client_id` se v hlavičce migrace legitimně vysvětluje slovy.
const migration = file("supabase/migrations/20260907_ukoly.sql").replace(/^\s*--.*$/gm, "")
check(
    "migrace má unikátní index na source_key",
    /create unique index[\s\S]*?on tasks \(source_key\)/i.test(migration),
)
// `client_id` v původní migraci schválně NEBYL: úkoly jsou backlog firmy, ne
// obsah tenanta, a sloupec by sváděl k tomu chovat se k nim jako k `ig_*`.
// Od 9/2026 tam je — jako NULLABLE ukazatel, aby šlo z úkolu „hydroizolace —
// zkontrolovat fakta" skočit do studia toho klienta. Hranice, která platí dál:
// **nikdy povinný a nikdy podmínka přístupu**. Kdo se dostane do admin sekce,
// vidí všechny úkoly; `client_id` je proklik, ne filtr oprávnění.
const migration2 = file("supabase/migrations/20260908_ukoly_pro_lidi_i_ai.sql").replace(/^\s*--.*$/gm, "")
check("client_id je nepovinný ukazatel, ne tenant filtr",
    /add column if not exists client_id uuid references clients\(id\)/i.test(migration2) &&
    !/client_id[^;]*not null/i.test(migration2))
check("původní migrace tasks zůstává bez client_id", !/client_id/.test(migration))
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

// Zakládací formulář byl dlouho jen „název + vlastník" a zbytek polí se nedal
// vyplnit odnikud. Termín a klient musí jít zadat rovnou, jinak se nedoplní nikdy.
const createBody = actions.slice(
    actions.indexOf("export async function createTask"),
    actions.indexOf("export async function setTaskStatus"))
check("createTask umí termín i klienta",
    /dueDate\?:/.test(createBody) && /clientId\?:/.test(createBody) &&
    createBody.includes("due_date:") && createBody.includes("client_id:"))

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

// Sekce je stav, ne route: `setProjectId` sám přepne tenanta a nechá člověka
// stát na Úkolech. Přepínat se smí jen přes `useStudioNavigate()`.
const tasksTab = codeOnly("app/(dashboard)/dashboard/instagram/tabs/TasksTab.tsx")
check("TasksTab přepíná sekce přes useStudioNavigate", tasksTab.includes("useStudioNavigate"))
// Odznak s počtem otázek patří do registru, ne natvrdo do sidebaru — jinak ho
// spodní lišta ani rozbalovací panel mít nebudou.
const navFile = file("app/(dashboard)/nav.ts")
check("odznak u Úkolů je součást registru navigace",
    /id: "tasks"[^}]*badge: "tasksAwaitingAnswer"/.test(navFile))
check("sidebar i spodní lišta čtou odznaky z kontextu",
    file("app/(dashboard)/StudioNavPanel.tsx").includes("navBadges[item.badge]") &&
    file("app/(dashboard)/BottomNav.tsx").includes("navBadges[item.badge]"))

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

// ── 5. Třídič a navrhovač (AI vrstva) ───────────────────────
const triage = codeOnly("lib/tasks/triage.ts")
const propose = codeOnly("lib/tasks/propose.ts")

// Vlastnictví sloupců je celý vtip téhle tabulky. Sheet vlastní title/note/priority;
// kdyby do nich sáhla AI, sync a model by se přetahovaly a `updateTask` by úkol
// navíc vytrhlo z tabulky (source='app').
// Kontroluje se ZÁPIS, ne výskyt slova: `title` a `note` v souboru legitimně
// stojí v typu načteného řádku, protože z nich model vychází.
const triagePatch = triage.slice(triage.indexOf("const patch: Record<string, unknown> = {"), triage.indexOf("const { error } = await supabaseAdmin.from(\"tasks\").update(patch)"))
check("třídič nepíše do sloupců, které vlastní tabulka",
    !/\b(title|note|priority):/.test(triagePatch),
    "sync a model by se přetahovaly o tentýž text")

// Navrhovač úkol ZAKLÁDÁ, takže `title` psát musí — nesmí ale sahat na poznámku
// a prioritu, které u řádku z tabulky patří tabulce.
const proposeInsert = propose.slice(propose.indexOf('.from("tasks")\n            .insert({'), propose.indexOf('.select("id")'))
check("navrhovač nepíše do poznámky ani priority",
    !/\b(note|priority):/.test(proposeInsert))

// Razítko `spec_at` je jediná pojistka proti tomu, aby se za totéž platilo znovu.
check("třídí se jednou — razítko spec_at", triage.includes("spec_at") && triage.includes('.is("spec_at", null)'))
check("odpověď člověka vrací úkol k přetřídění",
    codeOnly("app/actions/task-actions.ts").includes("spec_at: null"))

// Nejistota končí otázkou, ne domyšleným zadáním. Špatně pochopený úkol spolkne den.
check("třídič se umí zeptat místo domýšlení", triage.includes('"question"') && triage.includes("blocked_on"))

// Návrh vzniká jednou: klíč `ai:` je claim přes týž unikátní index jako sync.
check("návrhy mají claim přes source_key", propose.includes("AI_KEY_PREFIX") && propose.includes("source_key"))
check("zahozený návrh se nevrací", propose.includes('.select("id").eq("source_key"') || propose.includes('.eq("source_key", sourceKey)'))
check("navrhuje se nejvýš pár úkolů na běh", /MAX_PER_RUN\s*=\s*[1-5]\b/.test(propose))

// Sync nesmí hlásit návrhy AI jako „chybí v tabulce" — v tabulce nikdy nebyly.
check("sync přeskakuje návrhy od AI", file("lib/tasks/sheet-sync.ts").includes('"ai:%"'))

// Běh přes agent stack, ne mimo něj: i ruční spuštění musí nechat řádek v auditu.
const dailyOps = codeOnly("app/api/cron/daily-ops/route.ts")
check("třídič i navrhovač běží přes requestAction", dailyOps.includes("task_triage") && dailyOps.includes("task_propose"))

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} prošlo, ${failed} selhalo`)
if (failed > 0) {
    console.log(`\nSelhalo:\n${fails.map(f => `  · ${f}`).join("\n")}\n`)
    process.exit(1)
}
console.log()
