/**
 * Jazyk UI — statické zámky (npm run guard).
 *
 * Zdrojový jazyk je čeština, texty žijí v `messages/cs.json`; překlad musí mít
 * STEJNÉ klíče (chybějící klíč next-intl vypíše jako holou cestu do UI). Registr
 * navigace nese klíče, ne texty; soubory, které už prošly migrací, nesmí dostat
 * česky natvrdo zpátky — jinak by se anglické UI rozpadlo po prvním „rychlém“
 * zásahu do JSX.
 *
 * Spuštění: npx tsx scripts/test-i18n.ts
 */

import { readFileSync, readdirSync } from "fs"
import { resolve } from "path"

const ROOT = resolve(__dirname, "..")
let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, cond: boolean, detail?: string) {
    if (cond) { passed++; console.log(`  ✅ ${name}`) }
    else { failed++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  ❌ ${name}${detail ? `\n     └─ ${detail}` : ""}`) }
}

const file = (p: string) => readFileSync(resolve(ROOT, p), "utf-8")
/** Bez komentářů — komentáře smí být česky vždycky. */
const codeOnly = (p: string) => file(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")

type Tree = { [k: string]: string | Tree }
function flatten(tree: Tree, prefix = ""): Map<string, string> {
    const out = new Map<string, string>()
    for (const [k, v] of Object.entries(tree)) {
        const key = prefix ? `${prefix}.${k}` : k
        if (typeof v === "string") out.set(key, v)
        else for (const [ck, cv] of flatten(v, key)) out.set(ck, cv)
    }
    return out
}

console.log("\n🌐 Jazyk UI — messages a shell\n")

/** Všechny soubory jazyka sloučené do jedné mapy `namespace.klíč → text`. */
function loadLocale(locale: string): Map<string, string> {
    const dir = resolve(ROOT, "messages", locale)
    const out = new Map<string, string>()
    for (const f of readdirSync(dir).filter(f => f.endsWith(".json")).sort()) {
        for (const [k, v] of flatten(JSON.parse(file(`messages/${locale}/${f}`)))) out.set(k, v)
    }
    return out
}

// ── 1. Překlady mají stejné klíče jako zdroj ──
const cs = loadLocale("cs")
const en = loadLocale("en")
const csFiles = readdirSync(resolve(ROOT, "messages/cs")).filter(f => f.endsWith(".json")).sort()
const enFiles = readdirSync(resolve(ROOT, "messages/en")).filter(f => f.endsWith(".json")).sort()
check("cs a en mají stejné soubory zpráv", csFiles.join(",") === enFiles.join(","), `cs: ${csFiles.join(",")} | en: ${enFiles.join(",")}`)
const registered = [...codeOnly("lib/i18n/messages.ts").matchAll(/^\s+"([a-z-]+)",$/gm)].map(m => m[1]).sort()
check("každý soubor zpráv je v MESSAGE_FILES (a naopak)", registered.join(",") === csFiles.map(f => f.replace(/\.json$/, "")).join(","),
    `registr: ${registered.join(",")} | soubory: ${csFiles.join(",")}`)
const missingEn = [...cs.keys()].filter(k => !en.has(k))
const extraEn = [...en.keys()].filter(k => !cs.has(k))
check("en.json má všechny klíče z cs.json", missingEn.length === 0, missingEn.slice(0, 5).join(", "))
check("en.json nemá klíče navíc", extraEn.length === 0, extraEn.slice(0, 5).join(", "))
check("žádný prázdný text v cs.json", [...cs.values()].every(v => v.trim().length > 0))
check("žádný prázdný text v en.json", [...en.values()].every(v => v.trim().length > 0))
// ICU: stejné proměnné v obou jazycích, jinak překlad vyhodí chybu až za běhu.
const vars = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map(m => m[1]).sort().join(",")
const icuDrift = [...cs.entries()].filter(([k, v]) => en.has(k) && vars(v) !== vars(en.get(k)!)).map(([k]) => k)
check("ICU proměnné se v překladu neztrácejí", icuDrift.length === 0, icuDrift.slice(0, 5).join(", "))

// ── 2. Registr navigace nese klíče ──
const nav = codeOnly("app/(dashboard)/nav.ts")
const items = [...nav.matchAll(/\{ id: "([a-z]+)", label: "([^"]*)"(?:, shortLabel: "([^"]*)")?/g)]
check("registr navigace má položky", items.length >= 15, String(items.length))
check("label v registru je klíč items.<id>.label",
    items.every(m => m[2] === `items.${m[1]}.label`),
    items.filter(m => m[2] !== `items.${m[1]}.label`).map(m => m[1]).join(", "))
check("shortLabel v registru je klíč items.<id>.short",
    items.every(m => !m[3] || m[3] === `items.${m[1]}.short`))
check("každá položka má text v cs.json", items.every(m => cs.has(`nav.items.${m[1]}.label`) && (!m[3] || cs.has(`nav.items.${m[1]}.short`))),
    items.filter(m => !cs.has(`nav.items.${m[1]}.label`)).map(m => m[1]).join(", "))
const groups = [...nav.matchAll(/^\s+(\w+): "(groups\.\w+|)",$/gm)]
check("skupiny v registru jsou klíče groups.<id> nebo prázdné", groups.length >= 5 && groups.every(g => !g[2] || cs.has(`nav.${g[2]}`)))
const sub = nav.match(/SUBSECTIONS: StudioSection\[\] = \[([^\]]*)\]/)
const subIds = [...(sub?.[1] || "").matchAll(/"([a-z]+)"/g)].map(m => m[1])
check("sub-sekce mají nadpis v sections.subsections", subIds.length > 0 && subIds.every(id => cs.has(`sections.subsections.${id}`)))
const allSections = [...new Set([...items.map(m => m[1]), ...subIds])]
check("každá sekce má popisek v sections.descriptions", allSections.every(id => cs.has(`sections.descriptions.${id}`)),
    allSections.filter(id => !cs.has(`sections.descriptions.${id}`)).join(", "))

// ── 3. Migrované soubory nesmí dostat češtinu natvrdo zpátky ──
const MIGRATED = [
    "app/(dashboard)/nav.ts",
    "app/(dashboard)/StudioNavPanel.tsx",
    "app/(dashboard)/BottomNav.tsx",
    "app/(dashboard)/MobileTopBar.tsx",
    "app/(dashboard)/ErrorBoundary.tsx",
    "app/(dashboard)/BillingBanner.tsx",
    "app/(dashboard)/dashboard/instagram/page.tsx",
    "app/login/page.tsx",
    "app/register/page.tsx",
    "app/forgot-password/page.tsx",
    "app/reset-password/page.tsx",
    "components/auth/PasswordField.tsx",
    "components/i18n/LanguageSwitcher.tsx",
]
const CZECH = /[ěščřžýáíéúůťďňĚŠČŘŽÝÁÍÉÚŮŤĎŇ]/
for (const f of MIGRATED) {
    const offenders = codeOnly(f).split("\n").filter(l => CZECH.test(l))
    check(`${f}: žádný český text mimo komentáře`, offenders.length === 0, offenders[0]?.trim().slice(0, 80))
}

// ── 4. Zapojení ──
check("dashboard layout je uvnitř UiLocaleProvider", codeOnly("app/(dashboard)/layout.tsx").includes("<UiLocaleProvider>"))
check("next.config registruje next-intl request config", codeOnly("next.config.ts").includes('createNextIntlPlugin("./lib/i18n/request.ts")'))
check("přihlášení opisuje jazyk účtu do cookie", codeOnly("app/login/actions.ts").includes("syncLocaleCookieFromUser(data.user)"))
check("callback (OAuth, potvrzení e-mailu) opisuje jazyk účtu do cookie", codeOnly("app/auth/callback/route.ts").includes("syncLocaleCookieFromUser(user)"))
check("registrace ukládá zvolený jazyk k účtu", codeOnly("app/register/actions.ts").includes("currentLocaleCookie()"))
check("přepínač jazyka je v navigaci studia", codeOnly("app/(dashboard)/StudioNavPanel.tsx").includes("<LanguageSwitcher />"))
check("kořenový layout zůstává statický (bez next-intl)", !codeOnly("app/layout.tsx").includes("next-intl"))
check("locale-actions exportuje jen async funkce", !/^export (const|function|let)/m.test(codeOnly("app/actions/locale-actions.ts")))

console.log("\n" + "─".repeat(60))
console.log(`  ✅ ${passed} prošlo | ❌ ${failed} selhalo`)
console.log("─".repeat(60))
if (failed > 0) {
    console.log("\n⚠️  SELHALO:")
    failures.forEach(f => console.log(`  - ${f}`))
    process.exit(1)
}
process.exit(0)
