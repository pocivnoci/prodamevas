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
import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser"

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
const stripBlockComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "")
/** Řádkový komentář za kódem (ne `://` v URL, ne `//` uvnitř řetězce). */
const stripLineComment = (line: string) => line.replace(/(^|[^:"'`])\/\/.*$/, "$1")
const codeOnly = (p: string) => stripBlockComments(file(p)).replace(/^\s*\/\/.*$/gm, "")

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
const registered = [...codeOnly("lib/i18n/messages.ts").matchAll(/^\s+"([a-zA-Z-]+)",$/gm)].map(m => m[1]).sort()
check("každý soubor zpráv je v MESSAGE_FILES (a naopak)", registered.join(",") === csFiles.map(f => f.replace(/\.json$/, "")).join(","),
    `registr: ${registered.join(",")} | soubory: ${csFiles.join(",")}`)
const missingEn = [...cs.keys()].filter(k => !en.has(k))
const extraEn = [...en.keys()].filter(k => !cs.has(k))
check("en.json má všechny klíče z cs.json", missingEn.length === 0, missingEn.slice(0, 5).join(", "))
check("en.json nemá klíče navíc", extraEn.length === 0, extraEn.slice(0, 5).join(", "))
check("žádný prázdný text v cs.json", [...cs.values()].every(v => v.trim().length > 0))
check("žádný prázdný text v en.json", [...en.values()].every(v => v.trim().length > 0))
// ICU: každá zpráva musí jít naparsovat (rozbitý plural spadne až v prohlížeči) a
// překlad musí brát STEJNÉ proměnné a rich tagy jako zdroj — jinak next-intl vyhodí
// chybu až za běhu, u jednoho jazyka a jednoho stavu.
function icuArgs(message: string): string[] | null {
    const out = new Set<string>()
    const walk = (els: MessageFormatElement[]) => {
        for (const el of els) {
            if (el.type === TYPE.argument || el.type === TYPE.number || el.type === TYPE.date || el.type === TYPE.time) out.add(el.value)
            else if (el.type === TYPE.plural || el.type === TYPE.select) { out.add(el.value); for (const opt of Object.values(el.options)) walk(opt.value) }
            else if (el.type === TYPE.tag) { out.add(`<${el.value}>`); walk(el.children) }
        }
    }
    try { walk(parse(message)) } catch { return null }
    return [...out].sort()
}
const broken: string[] = []
const drift: string[] = []
for (const [k, v] of cs) {
    const a = icuArgs(v)
    const b = en.has(k) ? icuArgs(en.get(k)!) : undefined
    if (a === null) broken.push(`cs:${k}`)
    if (b === null) broken.push(`en:${k}`)
    if (a && b && a.join(",") !== b.join(",")) drift.push(`${k} (cs: ${a.join(",") || "—"} | en: ${b.join(",") || "—"})`)
}
check("každá zpráva je platné ICU", broken.length === 0, broken.slice(0, 5).join(", "))
check("ICU proměnné a tagy se v překladu neztrácejí", drift.length === 0, drift.slice(0, 3).join("; "))

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
    // taby studia (vlna 1)
    ...[
        "SettingsTab", "GenerateTab", "PostsTab", "PublishHandoffModal", "ReelPlayer", "ReelSubtitlesPanel",
        "DashboardTab", "PlanTab", "CalendarTab", "FeedTab", "InspirationTab", "IdeasTab", "ReviewsTab",
        "BrandTab", "PerformanceTab", "BrainTab", "FaqTab", "TutorialOverlay", "Hint", "shared",
        "SubscriptionSection", "BillingSection", "ConsultationSection",
        // vlna 2
        "OnboardTab", "TasksTab", "ApprovalsTab", "CompanyTab", "LogsTab",
        "LeadsTab", "MailingTab", "WaitlistTab", "EmailsTab",
        "ProductsTab", "products/CatalogSection", "products/PrintSection", "products/LinesSection",
    ].map(f => `app/(dashboard)/dashboard/instagram/tabs/${f}.tsx`),
    // průvodce novým zákazníkem
    "app/onboarding/page.tsx",
    "app/onboarding/TaskProgress.tsx",
    "app/onboarding/task-client.ts",
    "app/onboarding/layout.tsx",
    // adminský JSON editor konfigurace
    "app/(dashboard)/dashboard/settings/page.tsx",
    // API routy s hláškami pro prohlížeč
    "app/api/ig-create-job/route.ts",
    "app/api/ig-run-job/route.ts",
    "app/api/ig-job-status/route.ts",
    "app/api/onboarding/task-status/route.ts",
    "app/api/onboarding/run-task/route.ts",
    "app/api/payments/stripe/create/route.ts",
    "app/api/ig-connect/start/route.ts",
    "app/api/ig-connect/bridge/route.ts",
    "app/api/ig-connect/bridge/return/route.ts",
    "app/api/ig-connect/bridge/go/route.ts",
    // server actions (vlna 3) — hlášky přes actionTranslator, prompty v i18n-ignore blocích
    ...[
        "admin-actions", "lead-actions", "mailing-actions", "growth-actions", "waitlist-admin",
        "content-plan-actions", "calendar-actions", "campaign-actions", "task-actions",
        "approval-actions", "ab-actions", "line-actions",
        "ig-generate-action", "post-edit-actions", "brand-images-action", "variant-actions", "post-actions",
        "memory-actions", "product-actions", "product-brief-actions", "product-category-actions", "print-actions",
        "config-actions", "billing-actions", "credit-guard", "settings-actions", "ig-connection-actions",
        "company-actions", "contact", "consultation-actions", "locale-actions",
    ].map(f => `app/actions/${f}.ts`),
    "app/onboarding/actions.ts",
    "app/onboarding/types.ts",
    "lib/auth-guard.ts",
    "app/api/plans/route.ts",
    "components/CookieConsent.tsx",
]
const CZECH = /[ěščřžýáíéúůťďňĚŠČŘŽÝÁÍÉÚŮŤĎŇ]/
// `console.*` jsou logy, ne UI; `i18n-ignore` na řádku = vědomá výjimka (sentinel
// v datech, text vázaný na prompt) — musí mít vedle sebe důvod. Víceřádkový blok
// (prompt pro model, který je schválně česky) se ohraničí
// `// i18n-ignore-start: <důvod>` … `// i18n-ignore-end`.
const IGNORED = /console\.(log|warn|error|info)|i18n-ignore/
/** Řádky mimo komentáře a mimo bloky i18n-ignore-start/end. */
function checkedLines(f: string): string[] {
    const out: string[] = []
    let skipping = false
    for (const raw of file(f).split("\n")) {
        if (/\/\/\s*i18n-ignore-start/.test(raw)) { skipping = true; continue }
        if (/\/\/\s*i18n-ignore-end/.test(raw)) { skipping = false; continue }
        if (!skipping) out.push(raw)
    }
    return stripBlockComments(out.join("\n")).split("\n")
}
for (const f of MIGRATED) {
    // Čeština se hledá v kódu bez komentáře za ním; značka `i18n-ignore` ale žije
    // právě v tom komentáři, proto se testuje na celém řádku.
    const offenders = checkedLines(f).filter(l => CZECH.test(stripLineComment(l)) && !IGNORED.test(l))
    check(`${f}: žádný český text mimo komentáře`, offenders.length === 0, offenders[0]?.trim().slice(0, 100))
    check(`${f}: každý blok i18n-ignore-start je uzavřený`,
        (file(f).match(/i18n-ignore-start/g) || []).length === (file(f).match(/i18n-ignore-end/g) || []).length)
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

// ── 5. Platby, doklady, e-maily ──
check("platební stránka ComGate jde v jazyce UI kupujícího", codeOnly("app/api/payments/create/route.ts").includes("lang: await paymentPageLanguage()"))
check("Stripe Checkout dostává locale kupujícího", codeOnly("lib/payments/checkout.ts").includes("locale:") && codeOnly("app/api/payments/create/route.ts").includes("locale: await paymentPageLanguage()"))
check("jazyk dokladu Fakturoidu jde podle země odběratele, ne natvrdo", !/language: "cz"/.test(codeOnly("lib/fakturoid.ts")) && (codeOnly("lib/fakturoid.ts").match(/fakturoidLanguage\(/g) || []).length >= 3)
check("layout e-mailu nese jazyk příjemce (lang + patička)", codeOnly("lib/mail/layout.ts").includes("doc.locale") && !codeOnly("lib/mail/layout.ts").includes('<html lang="cs">'))
check("uvítací e-mail jde v jazyce účtu přes mailTranslator", codeOnly("app/auth/callback/route.ts").includes("mailTranslator(locale)") && cs.has("mail.welcome.subject"))

console.log("\n" + "─".repeat(60))
console.log(`  ✅ ${passed} prošlo | ❌ ${failed} selhalo`)
console.log("─".repeat(60))
if (failed > 0) {
    console.log("\n⚠️  SELHALO:")
    failures.forEach(f => console.log(`  - ${f}`))
    process.exit(1)
}
process.exit(0)
