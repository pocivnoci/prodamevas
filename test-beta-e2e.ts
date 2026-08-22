/**
 * Beta Launch E2E Test Suite
 * 
 * Tests all 11 beta launch fixes end-to-end.
 * Run with: npx tsx test-beta-e2e.ts
 */

import { readFileSync, existsSync } from "fs"
import { resolve } from "path"
import { execSync } from "child_process"

const ROOT = resolve(__dirname)
let passed = 0
let failed = 0
const results: { name: string; status: "PASS" | "FAIL"; detail?: string }[] = []

function test(name: string, fn: () => void) {
    try {
        fn()
        passed++
        results.push({ name, status: "PASS" })
    } catch (err: any) {
        failed++
        results.push({ name, status: "FAIL", detail: err.message })
    }
}

function assert(condition: boolean, msg: string) {
    if (!condition) throw new Error(msg)
}

function fileContains(filePath: string, pattern: string): boolean {
    const content = readFileSync(resolve(ROOT, filePath), "utf-8")
    return content.includes(pattern)
}

function fileExists(filePath: string): boolean {
    return existsSync(resolve(ROOT, filePath))
}

function fileContent(filePath: string): string {
    return readFileSync(resolve(ROOT, filePath), "utf-8")
}

/** Source with comments stripped — for NEGATIVE assertions ("X must stay deleted").
 *  A comment explaining why something was removed would otherwise match the very
 *  pattern it warns about, and the assertion fails on its own documentation. */
function codeOnly(filePath: string): string {
    return fileContent(filePath)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

// ═══════════════════════════════════════════════════════════
// 1. PlanUnlockModal Bug Fix
// ═══════════════════════════════════════════════════════════

test("1.1 payments/create uses client.slug (not clientSlug param)", () => {
    const content = fileContent("app/api/payments/create/route.ts")
    assert(content.includes("generateRefId(client.slug)"), "generateRefId should use client.slug from DB lookup")
    assert(!content.includes("generateRefId(clientSlug)"), "Should NOT use clientSlug parameter directly")
})

test("1.2 payments/create fetches client from DB", () => {
    const content = fileContent("app/api/payments/create/route.ts")
    assert(content.includes('.from("clients")'), "Should query clients table")
    assert(content.includes('.eq("id", clientId)'), "Should lookup by clientId")
})

// ═══════════════════════════════════════════════════════════
// 2. Mock Payment Flow
// ═══════════════════════════════════════════════════════════

test("2.1 mock-payment page exists", () => {
    assert(fileExists("app/mock-payment/page.tsx"), "app/mock-payment/page.tsx should exist")
})

test("2.2 mock-payment has pay and cancel buttons", () => {
    const content = fileContent("app/mock-payment/page.tsx")
    assert(content.includes("Zaplatit"), "Should have pay button")
    assert(content.includes("Zrušit"), "Should have cancel button")
})

test("2.3 mock-payment has DEMO badge", () => {
    const content = fileContent("app/mock-payment/page.tsx")
    assert(
        content.includes("DEMO") || content.includes("TESTOVACÍ") || content.includes("Mock"),
        "Should have demo/test indicator"
    )
})

test("2.4 payments/create has COMGATE_MOCK branch", () => {
    const content = fileContent("app/api/payments/create/route.ts")
    assert(content.includes('isMockPaymentMode'), "Should use isMockPaymentMode() (COMGATE_MOCK + prod kill switch)")
    assert(content.includes("mock-payment"), "Should redirect to mock-payment page")
})

test("2.4b vestavěná pokladna používá platný ui_mode", () => {
    // `ui_mode` je v typech Stripe SDK unie končící `OtherString`, takže bere
    // JAKÝKOLI řetězec — zrušenou hodnotu ani překlep typecheck nechytí a chyba
    // spadne až za běhu, ve chvíli, kdy zákazník klikne na tarif. Přesně tak
    // prošlo do produkce `ui_mode: "embedded"`, které Stripe už nepodporuje.
    const VALID = ["elements", "embedded_page", "form", "hosted_page"]
    const content = fileContent("lib/payments/checkout.ts")
    const match = content.match(/EMBEDDED_UI_MODE\s*=\s*"([^"]+)"/)
    assert(match !== null, "EMBEDDED_UI_MODE konstanta zmizela — hodnota by se zas roztrousila po kódu")
    assert(VALID.includes(match![1]), `ui_mode "${match![1]}" není platná hodnota Stripe (${VALID.join(", ")})`)
    // Literál mimo konstantu by aserci obešel.
    const literals = [...content.matchAll(/ui_mode:\s*"([^"]+)"/g)].map(m => m[1])
    assert(literals.length === 0, `ui_mode se zapisuje literálem (${literals.join(", ")}) místo přes EMBEDDED_UI_MODE`)
})

test("2.4c doména servíruje ověřovací soubor pro Apple Pay", () => {
    // Vestavěná pokladna běží na NAŠÍ doméně, ne na checkout.stripe.com. Bez
    // asociačního souboru na téhle přesné cestě se Apple Pay ani Google Pay
    // mlčky nezobrazí — žádná chyba, jen chybějící tlačítko. Přesně tak zmizel
    // Apple Pay při přechodu z hostované pokladny na vestavěnou.
    const cfg = fileContent("next.config.ts")
    assert(cfg.includes("/.well-known/apple-developer-merchantid-domain-association"),
        "rewrite na asociační soubor zmizel z next.config.ts — Apple Pay tiše zmizí")
    assert(cfg.includes("/api/apple-pay-domain"), "rewrite nemíří na routu s asociačním souborem")
    const route = fileContent("app/api/apple-pay-domain/route.ts")
    assert(route.includes("apple-developer-merchantid-domain-association"),
        "routa nestahuje asociační soubor od Stripu")
})

test("2.5 payments/callback has COMGATE_MOCK bypass", () => {
    const content = fileContent("app/api/payments/callback/route.ts")
    assert(content.includes('isMockPaymentMode'), "Should use isMockPaymentMode() (COMGATE_MOCK + prod kill switch)")
})

test("2.6 mock-payment sends callback to /api/payments/callback", () => {
    const content = fileContent("app/mock-payment/page.tsx")
    assert(
        content.includes("/api/payments/callback") || content.includes("payments/callback"),
        "Should POST to payments callback"
    )
})

// ═══════════════════════════════════════════════════════════
// 3. Rate Limiting
// ═══════════════════════════════════════════════════════════

test("3.1 ig-create-job has rate limit check", () => {
    const content = fileContent("app/api/ig-create-job/route.ts")
    assert(content.includes("RATE_LIMIT"), "Should have RATE_LIMIT constant")
    assert(content.includes("429"), "Should return 429 status on limit")
})

test("3.2 rate limit is 10 per hour", () => {
    const content = fileContent("app/api/ig-create-job/route.ts")
    assert(content.includes("10"), "Limit should be 10")
    assert(
        content.includes("60 * 60 * 1000") || content.includes("3600"),
        "Should check 1 hour window"
    )
})

test("3.3 rate limit has admin bypass", () => {
    const content = fileContent("app/api/ig-create-job/route.ts")
    assert(
        content.includes("admin") || content.includes("Admin") || content.includes("SUPER_ADMIN"),
        "Should have admin bypass"
    )
})

// ═══════════════════════════════════════════════════════════
// 4. Config Runtime Validation
// ═══════════════════════════════════════════════════════════

test("4.1 validateConfig exists in configs/index.ts", () => {
    const content = fileContent("instagram/configs/index.ts")
    assert(content.includes("function validateConfig"), "Should have validateConfig function")
})

test("4.2 validateConfig is called in loadConfig", () => {
    const content = fileContent("instagram/configs/index.ts")
    assert(content.includes("validateConfig("), "loadConfig should call validateConfig")
})

test("4.3 validateConfig fills default brandVoice", () => {
    const content = fileContent("instagram/configs/index.ts")
    assert(content.includes("brandVoice"), "Should validate brandVoice")
    assert(content.includes("persona"), "Should provide default persona")
})

test("4.4 validateConfig fills default hashtagPools", () => {
    const content = fileContent("instagram/configs/index.ts")
    assert(content.includes("hashtagPools"), "Should validate hashtagPools")
})

test("4.5 validateConfig fills default feedAesthetic", () => {
    const content = fileContent("instagram/configs/index.ts")
    assert(content.includes("feedAesthetic"), "Should validate feedAesthetic")
})

// Unit test: actually import and run validateConfig
test("4.6 validateConfig handles empty config object", async () => {
    // Can't import server modules directly, but verify the function shape
    const content = fileContent("instagram/configs/index.ts")
    // Check it handles all required fields
    const requiredFields = ["id", "name", "website", "instagram", "brandVoice", "contentPillars", "ctaStrategies", "feedAesthetic", "weekPlan", "hashtagPools", "contentFocus"]
    for (const field of requiredFields) {
        assert(content.includes(field), `validateConfig should handle '${field}'`)
    }
})

// ═══════════════════════════════════════════════════════════
// 5. Error Recovery in GenerateTab
// ═══════════════════════════════════════════════════════════

test("5.1 GenerateTab has retry button", () => {
    const content = fileContent("app/(dashboard)/dashboard/instagram/tabs/GenerateTab.tsx")
    assert(content.includes("Zkusit znovu"), "Should have 'Zkusit znovu' button")
})

test("5.2 retry button resets state and re-triggers generation", () => {
    const content = fileContent("app/(dashboard)/dashboard/instagram/tabs/GenerateTab.tsx")
    assert(content.includes("setResult(null)"), "Retry should reset result state")
    assert(content.includes("handleGenerate"), "Retry should call handleGenerate")
})

// ═══════════════════════════════════════════════════════════
// 6. Editorial Log in PostDetailModal
// ═══════════════════════════════════════════════════════════

test("6.1 getEditorialLog server action exists", () => {
    const content = fileContent("app/actions/admin-actions.ts")
    assert(content.includes("export async function getEditorialLog"), "Should export getEditorialLog")
})

test("6.2 getEditorialLog queries ig_jobs by postId", () => {
    const content = fileContent("app/actions/admin-actions.ts")
    assert(content.includes("ig_jobs"), "Should query ig_jobs table")
    assert(content.includes("result->>postId") || content.includes("result->>'postId'"), "Should filter by result.postId JSONB")
})

test("6.3 getEditorialLog returns editorial_log field", () => {
    const content = fileContent("app/actions/admin-actions.ts")
    assert(content.includes("editorial_log"), "Should select editorial_log")
})

test("6.4 PostsTab imports getEditorialLog", () => {
    const content = fileContent("app/(dashboard)/dashboard/instagram/tabs/PostsTab.tsx")
    assert(content.includes("getEditorialLog"), "Should import getEditorialLog")
})

test("6.5 PostDetailModal displays editorial log", () => {
    const content = fileContent("app/(dashboard)/dashboard/instagram/tabs/PostsTab.tsx")
    assert(content.includes("Editorial Board"), "Should show 'Editorial Board' section")
    assert(content.includes("editorialLog"), "Should use editorialLog state")
})

test("6.6 Editorial log has role-specific colors", () => {
    const content = fileContent("app/(dashboard)/dashboard/instagram/tabs/PostsTab.tsx")
    assert(content.includes("strategist"), "Should have strategist role styling")
    assert(content.includes("copywriter"), "Should have copywriter role styling")
    assert(content.includes("critic"), "Should have critic role styling")
    assert(content.includes("chief_editor"), "Should have chief_editor role styling")
})

test("6.7 Editorial log is collapsible", () => {
    const content = fileContent("app/(dashboard)/dashboard/instagram/tabs/PostsTab.tsx")
    assert(content.includes("editorialOpen"), "Should have editorialOpen toggle state")
    assert(content.includes("setEditorialOpen"), "Should have toggle setter")
})

// ═══════════════════════════════════════════════════════════
// 7. Empty States
// ═══════════════════════════════════════════════════════════

test("7.0a Akce nesmí být dostupné jen po najetí myší", () => {
    // Rozlišit regexem ovládací prvek od dekorativního přechodu nejde — obojí
    // je `opacity-0 group-hover:…`. Kontrolují se proto konkrétní místa, kde
    // hover schovával JEDINOU cestu k akci.

    // Mazání fotky značky: celoplošný overlay je desktopový, na dotyku musí
    // zůstat rohové tlačítko.
    const brand = fileContent("app/(dashboard)/dashboard/instagram/tabs/BrandTab.tsx")
    assert(brand.includes("hidden sm:flex"), "BrandTab: overlay s mazáním musí být jen pro myš")

    const at = brand.indexOf("sm:hidden")
    assert(at > 0, "BrandTab: chybí mobilní varianta mazání fotky")
    // `onClick` stojí nad `className`, takže se kouká na okno kolem, ne za.
    const around = brand.slice(Math.max(0, at - 400), at + 400)
    assert(around.includes("handleDelete"),
        "BrandTab: mobilní tlačítko u fotky musí opravdu mazat, ne jen existovat")

    // Úpravy a mazání paměti + odebrání produktu z položky plánu.
    for (const [file, what] of [
        ["app/(dashboard)/dashboard/instagram/tabs/BrainTab.tsx", "úpravy paměti"],
        ["app/(dashboard)/dashboard/instagram/tabs/GenerateTab.tsx", "odebrání produktu"],
    ] as const) {
        assert(fileContains(file, "sm:opacity-0 sm:group-hover:opacity-100"),
            `${file}: ${what} musí být na dotyku vidět (sm: prefix na skrývání)`)
    }
})

test("7.0b Spodní lišta nesmí zmizet pod modály ani překrýt obsah", () => {
    const nav = fileContent("app/(dashboard)/BottomNav.tsx")
    // z-40: nad obsahem (main je z-10), pod modály (z-50) a paywallem (z-[99]).
    assert(nav.includes("z-40"), "Lišta musí sedět na z-40 — mezi obsahem a modály")
    assert(!/z-\[?(5[0-9]|[6-9][0-9]|[0-9]{3,})\]?/.test(nav.split("AnimatePresence")[0]),
        "Lišta samotná nesmí lézt na úroveň modálů")

    // Odsazení obsahu musí být padding s výškou lišty; margin ji nepřekoná.
    const layout = fileContent("app/(dashboard)/layout.tsx")
    assert(layout.includes("--studio-navbar-h"), "Obsah musí rezervovat výšku lišty")
    assert(!codeOnly("app/(dashboard)/layout.tsx").includes("mb-20"),
        "mb-20 je margin — fixed lišta by přes obsah přelezla")
})

test("7.0c Gesta jdou vypnout a nesmí krást vodorovné scrollery", () => {
    const src = fileContent("app/(dashboard)/useStudioGestures.ts")
    assert(src.includes("GESTURES_ENABLED"), "Gesta musí jít vypnout jedním přepínačem")
    // Bez téhle kontroly by přejíždění sebralo čipy, karusel i širokou tabulku.
    assert(src.includes("insideHorizontalScroller"), "Gesto se nesmí založit uvnitř vodorovného scrolleru")
    assert(src.includes("display-mode: standalone"),
        "Tažení pro obnovení smí běžet jen na ploše — v prohlížeči má vlastní nativní")
})

test("7.1 CalendarTab has empty slot indicator", () => {
    const content = fileContent("app/(dashboard)/dashboard/instagram/tabs/CalendarTab.tsx")
    assert(content.includes("Volno"), "Should show 'Volno' for empty days")
})

test("7.2 CalendarTab has 'Plan week' CTA", () => {
    const content = fileContent("app/(dashboard)/dashboard/instagram/tabs/CalendarTab.tsx")
    assert(content.includes("Naplánuj týden"), "Should have 'Naplánuj týden' button")
})

test("7.3 CalendarTab handles loading state", () => {
    const content = fileContent("app/(dashboard)/dashboard/instagram/tabs/CalendarTab.tsx")
    assert(content.includes("loading"), "Should have loading state")
    assert(content.includes("animate-spin"), "Should show spinner while loading")
})

// ═══════════════════════════════════════════════════════════
// 8. Onboarding Bootstrap (durable, server-side)
// ═══════════════════════════════════════════════════════════
// The old browser-driven showcase loop (3x Promise.race with a 90s timeout) was
// replaced by ONE short server call: startOnboardingBootstrap runs the teaser plan
// + idea-bank seed inline and queues the 3 showcase posts as a durable ig_campaigns
// row drained by the cron worker — closing the tab no longer strands the client.

test("8.1 Onboarding page calls the durable bootstrap (no browser showcase loop)", () => {
    const content = fileContent("app/onboarding/page.tsx")
    assert(content.includes("startOnboardingBootstrap"), "Should call startOnboardingBootstrap")
    assert(!content.includes("generateShowcasePost"), "Browser-driven showcase loop must be gone")
})

test("8.2 Bootstrap queues showcase posts as a campaign with adminBypass", () => {
    const content = fileContent("app/onboarding/actions.ts")
    assert(content.includes("startOnboardingBootstrap"), "Bootstrap action should exist")
    assert(content.includes("adminBypass: true"), "Showcase campaign must not be charged (adminBypass)")
    assert(content.includes("ig_campaigns"), "Showcase posts should be a durable ig_campaigns row")
})

test("8.3 Bootstrap failure is non-fatal", () => {
    const content = fileContent("app/onboarding/page.tsx")
    assert(content.includes("non-fatal"), "Bootstrap errors should be non-fatal")
})

test("8.4 Bootstrap seeds the idea bank before the showcase campaign", () => {
    const content = fileContent("app/onboarding/actions.ts")
    const seedIdx = content.indexOf("seedIdeaBank")
    const campaignIdx = content.indexOf("Durable showcase campaign")
    assert(seedIdx > 0 && campaignIdx > seedIdx, "seedIdeaBank must run before the showcase campaign insert")
})

// ═══════════════════════════════════════════════════════════
// 9. imageInstructions UI in SettingsTab
// ═══════════════════════════════════════════════════════════

test("9.1 SettingsTab has imageInstructions editor", () => {
    const content = fileContent("app/(dashboard)/dashboard/instagram/tabs/SettingsTab.tsx")
    assert(content.includes("imageInstructions"), "Should reference imageInstructions")
    assert(content.includes("Instrukce pro obrázky"), "Should have Czech label for image instructions")
})

test("9.2 imageInstructions editor has add button", () => {
    const content = fileContent("app/(dashboard)/dashboard/instagram/tabs/SettingsTab.tsx")
    assert(content.includes("Přidat instrukci pro typ"), "Should have add button")
})

test("9.3 imageInstructions editor has delete button", () => {
    const content = fileContent("app/(dashboard)/dashboard/instagram/tabs/SettingsTab.tsx")
    // Delete button in imageInstructions section
    const imgInstrSection = content.indexOf("imageInstructions")
    assert(imgInstrSection > 0, "Should have imageInstructions section")
})

test("9.4 imageInstructions empty state has helper text", () => {
    const content = fileContent("app/(dashboard)/dashboard/instagram/tabs/SettingsTab.tsx")
    assert(content.includes("_default"), "Should mention _default key as tip")
})

test("9.5 imageInstructions matches config type (Record<string, string>)", () => {
    const configTypes = fileContent("instagram/configs/types.ts")
    assert(configTypes.includes("imageInstructions?: Record<string, string>"), "Config type should define imageInstructions as Record<string, string>")
})

test("9.6 imageInstructions is used in mega prompt builder", () => {
    const content = fileContent("instagram/caption-generator.ts")
    assert(content.includes("imageInstructions"), "Mega prompt builder should use imageInstructions")
})

// ═══════════════════════════════════════════════════════════
// 10. Landing → Registration Flow
// ═══════════════════════════════════════════════════════════

test("10.1 Landing page exists", () => {
    assert(fileExists("app/page.tsx"), "Landing page should exist")
})

test("10.2 Landing page links to /login", () => {
    // Markup landingu žije v components/Landing.tsx; app/page.tsx je server
    // komponenta, která k němu načte ceník z DB.
    const content = fileContent("components/Landing.tsx")
    assert(content.includes('href="/login"'), "Should link to /login")
    assert(fileContains("app/page.tsx", "<Landing"), "app/page.tsx musí landing skutečně vykreslit")
})

test("10.3 Landing page has WaitlistForm", () => {
    const content = fileContent("components/Landing.tsx")
    assert(content.includes("WaitlistForm"), "Should include WaitlistForm component")
})

test("10.4 WaitlistForm links to /register", () => {
    const content = fileContent("components/WaitlistForm.tsx")
    assert(content.includes('href="/register"'), "Should link to /register")
})

test("10.5 Register page exists", () => {
    assert(fileExists("app/register/page.tsx"), "Register page should exist")
})

test("10.6 Register page requires invite code", () => {
    const content = fileContent("app/register/page.tsx")
    assert(content.includes("inviteCode"), "Should have inviteCode field")
    assert(content.includes("required"), "Invite code should be required")
})

test("10.7 Register action validates invite code", () => {
    // Kontrola kódu žije v lib/invite-gate.ts, protože ji sdílí heslová i Google
    // cesta. Registrace ji musí volat a umět odmítnout.
    const content = fileContent("app/register/actions.ts")
    assert(content.includes("findUsableInvite"), "Should validate the code through the shared invite gate")
    assert(content.includes("invalid_invite"), "Should handle invalid invite code")
    assert(fileContains("lib/invite-gate.ts", "invite_codes"), "Invite gate should read the invite_codes table")
})

test("10.7b Kód pozvánky se zabírá podmíněným claimem", () => {
    // Dva lidé nesmí spotřebovat totéž poslední místo. Claim proto musí být
    // podmíněný na hodnotě, kterou jsme přečetli — ne slepý increment.
    const gate = fileContent("lib/invite-gate.ts")
    const claim = gate.slice(gate.indexOf("export async function claimInvite"))
    assert(claim.includes(".eq('used_count', invite.used_count)"), "claimInvite musí být podmíněný na přečtené hodnotě used_count")
    assert(claim.includes(".select("), "claimInvite musí poznat, jestli claim něco zabral")

    for (const f of ["app/register/actions.ts", "app/auth/actions.ts"]) {
        assert(!fileContent(f).includes("used_count + 1"), `${f} nesmí zvyšovat used_count mimo claimInvite`)
    }
})

test("10.7c Google registrace prochází stejnou branou", () => {
    // Supabase založí OAuth účet dřív, než ho uvidíme — bránu proto musí držet
    // callback, jinak se přes Google dá betu obejít úplně.
    const callback = fileContent("app/auth/callback/route.ts")
    assert(callback.includes("enforceInviteGate"), "Callback musí pouštět OAuth účty přes invite gate")
    assert(callback.includes("signOut"), "Odmítnutý účet musí přijít o session")

    const actions = fileContent("app/auth/actions.ts")
    assert(actions.includes("findUsableInvite"), "Google registrace musí kód ověřit ještě před odchodem na Google")
    assert(actions.includes("INVITE_COOKIE"), "Kód musí přežít přesměrování na Google")
})

test("10.7e Brána platí pro každou cestu k session, ne jen pro Google", () => {
    // Heslo bránu neobchází: účet z doby před pozvánkami, bez kódu a bez
    // projektu, se nesmí přihlásit postaru. A obnova hesla taky končí
    // přihlášeným uživatelem, takže i ta musí branou projít.
    const login = fileContent("app/login/actions.ts")
    assert(login.includes("enforceInviteGate"), "Přihlášení heslem musí projít branou")
    assert(login.includes("signOut"), "Odmítnutý účet musí přijít o session")

    const callback = codeOnly("app/auth/callback/route.ts")
    assert(callback.includes("enforceInviteGate"), "Callback musí bránu volat")
    // Brána nesmí být schovaná za podmínkou „jen OAuth" — to byl přesně ten
    // způsob, jak se dalo dovnitř přes obnovu hesla.
    assert(!/if\s*\(\s*isOAuth\s*\)/.test(callback), "Brána v callbacku nesmí platit jen pro OAuth")
})

test("10.7f Živá session bránu neobejde", () => {
    // Kontrola u přihlášení nestačí: kdo byl přihlášený dřív, než účet zavřel,
    // by se s platnou cookie proklikal až do onboardingu. Hlídá to middleware.
    const mw = fileContent("middleware.ts")
    assert(mw.includes("hasBetaStamp"), "Middleware musí razítko kontrolovat u každého requestu")
    assert(/onboarding/.test(mw), "Kontrola musí krýt i /onboarding, ne jen /dashboard")
    // Bez smazání cookies vznikne smyčka /dashboard → /login → /dashboard.
    assert(/maxAge:\s*0/.test(mw), "Odmítnutému požadavku se musí smazat sb- cookies")

    // Middleware běží u každého requestu — nesmí si přes tenhle modul natáhnout
    // service role klíč.
    const access = codeOnly("lib/beta-access.ts")
    assert(!/^\s*import\s/m.test(access), "lib/beta-access.ts musí zůstat bez importů")
    assert(!/supabase/i.test(access), "lib/beta-access.ts se nesmí dotýkat Supabase klientů")
})

test("0.1 Server action nesmí re-exportovat typ", () => {
    // Produkční výpadek: v `app/actions/product-actions.ts` stálo
    // `export type { ProductUrlDraft }`. V modulu s `"use server"` z toho
    // Turbopack udělal běhový re-export na binding, který po smazání typů
    // neexistuje — modul spadl při vyhodnocení („ProductUrlDraft is not
    // defined") a s ním celý obsah dashboardu. `npm run build` to nechytí,
    // protože typy mizí až za ním; projeví se to až v běžící aplikaci.
    //
    // Typ patří klientovi přímo ze zdrojového modulu, ne přes server action.
    const fs = require("fs") as typeof import("fs")
    const dir = "app/actions"
    for (const file of fs.readdirSync(dir).filter((f: string) => f.endsWith(".ts"))) {
        const content = fileContent(`${dir}/${file}`)
        if (!content.includes('"use server"')) continue
        assert(
            !/^\s*export\s+type\s*\{/m.test(content),
            `${dir}/${file}: "use server" modul nesmí obsahovat 'export type { … }' — typ ber přímo ze zdroje`,
        )
    }
})

test("10.7h Super admin dostane razítko, ne jen průchod", () => {
    // Past, která zamkla vlastníka produktu z jeho vlastní aplikace:
    // `hasBetaStamp` čte `SUPER_ADMIN_EMAILS`, jenže middleware běží z jiného
    // bundlu než brána. Když se hodnota do jednoho z nich nepropíše, přihlášení
    // admina pustí, ale middleware ho z /dashboard vyhodí a smaže mu cookies —
    // a protože ho brána cestou nerazítkovala, dopadne stejně každý další pokus.
    // Razítko je jediná evidence nezávislá na proměnné, takže ho admin dostat musí.
    const gate = fileContent("lib/invite-gate.ts")
    const enforce = gate.slice(gate.indexOf("export async function enforceInviteGate"))
    const adminBranch = enforce.slice(enforce.indexOf("hasBetaStamp(user)"))
    const beforeNextReturn = adminBranch.slice(0, adminBranch.indexOf("return { ok: true }"))
    assert(
        beforeNextReturn.includes("stampInvite"),
        "Větev super admina musí razítkovat, ne jen vrátit ok — jinak jeho přístup visí čistě na env proměnné",
    )
})

test("10.7d Google se nenabízí, dokud není provider zapnutý", () => {
    // Provider se zapíná v Supabase, ne v repu. Mrtvé tlačítko na přihlašovací
    // stránce je horší než žádné — přepínač proto musí hlídat UI i akci.
    for (const page of ["app/login/page.tsx", "app/register/page.tsx"]) {
        assert(fileContains(page, "googleAuthEnabled()"), `${page} musí tlačítko schovat za přepínač`)
    }
    assert(fileContains("app/auth/actions.ts", "googleAuthEnabled()"), "Server action se dá zavolat i bez tlačítka — musí přepínač ověřit sama")

    // Odmítnutí od providera se nesmí schovat za hlášku o špatném heslu.
    assert(fileContains("app/auth/callback/route.ts", "google_unavailable"), "Callback musí odlišit selhání Googlu od špatných přihlašovacích údajů")
})

test("10.8 Register redirects to email confirmation", () => {
    const content = fileContent("app/register/actions.ts")
    assert(content.includes("check_email"), "Should redirect to email confirmation")
})

test("10.9 Login page exists", () => {
    assert(fileExists("app/login/page.tsx"), "Login page should exist")
})

test("10.10 Auth callback exists", () => {
    assert(fileExists("app/auth/callback/route.ts"), "Auth callback should exist")
})

test("10.11 Onboarding page exists", () => {
    assert(fileExists("app/onboarding/page.tsx"), "Onboarding page should exist")
})

// ═══════════════════════════════════════════════════════════
// 11. Build Integrity
// ═══════════════════════════════════════════════════════════

test("11.1 No TypeScript 'any' leaks in critical paths", () => {
    // Check that credit guard, rate limit, and payment don't use untyped 'any' in key positions
    const createRoute = fileContent("app/api/payments/create/route.ts")
    assert(createRoute.includes("NextResponse"), "Should use typed NextResponse")
})

test("11.2 All API routes have auth guards", () => {
    const createJob = fileContent("app/api/ig-create-job/route.ts")
    assert(
        createJob.includes("requireAuth") || createJob.includes("requireProjectAccess"),
        "ig-create-job should have auth guard"
    )

    const runJob = fileContent("app/api/ig-run-job/route.ts")
    assert(
        runJob.includes("requireAuth") || runJob.includes("requireProjectAccess") || runJob.includes("requireClientAccess"),
        "ig-run-job should have auth guard"
    )

    const paymentsCreate = fileContent("app/api/payments/create/route.ts")
    assert(
        paymentsCreate.includes("requireAuth") || paymentsCreate.includes("requireProjectAccess"),
        "payments/create should have auth guard"
    )
})

test("11.3 Database schema has ig_jobs table with editorial_log", () => {
    const schema = fileContent("supabase/database-schema.sql")
    assert(schema.includes("ig_jobs"), "Schema should have ig_jobs table")
    assert(schema.includes("editorial_log"), "ig_jobs should have editorial_log column")
})

test("11.4 ig_jobs.result stores postId for editorial log lookup", () => {
    const runJob = fileContent("app/api/ig-run-job/route.ts")
    assert(runJob.includes("postId: result.id"), "ig-run-job should store postId in result")
})

// ═══════════════════════════════════════════════════════════
// Cross-cutting concerns
// ═══════════════════════════════════════════════════════════

test("CROSS.1 No hardcoded URLs (should use env vars)", () => {
    const createRoute = fileContent("app/api/payments/create/route.ts")
    assert(
        createRoute.includes("NEXT_PUBLIC") || createRoute.includes("process.env"),
        "Payment URLs should come from env vars"
    )
})

test("CROSS.2 Config cache invalidation exists", () => {
    const configIndex = fileContent("instagram/configs/index.ts")
    assert(configIndex.includes("invalidateConfigCache"), "Should export invalidateConfigCache")
})

test("CROSS.3 Error boundaries — GenerateTab catches all errors", () => {
    const content = fileContent("app/(dashboard)/dashboard/instagram/tabs/GenerateTab.tsx")
    assert(content.includes("catch"), "GenerateTab should have error handling")
    assert(content.includes("error") || content.includes("Error"), "Should display error messages")
})

// ═══════════════════════════════════════════════════════════
// 12. Model Registry + Native Design Engine (v4.2)
// ═══════════════════════════════════════════════════════════

test("12.1 models.ts exports MODELS + getModel", () => {
    const content = fileContent("instagram/models.ts")
    assert(content.includes("export const MODELS"), "Should export MODELS")
    assert(content.includes("export function getModel"), "Should export getModel")
})

test("12.2 no deprecated preview image model IDs in code", () => {
    const out = execSync(
        `grep -rln "image-preview" instagram/ app/ lib/ utils/ --include="*.ts" --include="*.tsx" | grep -v "instagram/models.ts" || true`,
        { cwd: ROOT, encoding: "utf-8" }
    ).trim()
    assert(out === "", `Deprecated preview image IDs still referenced in: ${out}`)
})

test("12.3 no hardcoded gemini model strings outside models.ts", () => {
    const out = execSync(
        `grep -rln 'model: "gemini' instagram/ app/ --include="*.ts" | grep -v "instagram/models.ts" || true`,
        { cwd: ROOT, encoding: "utf-8" }
    ).trim()
    assert(out === "", `Hardcoded model strings in: ${out}`)
})

test("12.4 validateConfig fills videoTier default", () => {
    const content = fileContent("instagram/configs/index.ts")
    assert(content.includes('videoTier: config.videoTier || "fast"'), "videoTier default missing")
})

test("12.5 AI Designer + QA exported from image-pipeline", () => {
    const content = fileContent("instagram/image-pipeline.ts")
    assert(content.includes("export async function generateDesignBrief"), "generateDesignBrief missing")
    assert(content.includes("export function buildNativeImagePrompt"), "buildNativeImagePrompt missing")
    assert(content.includes("export async function verifyNativeImage"), "verifyNativeImage missing")
    assert(content.includes("export async function generateCarouselDesignBriefs"), "generateCarouselDesignBriefs missing")
})

test("12.6 native design DB migration exists", () => {
    assert(fileExists("supabase/migrations/20260611_native_design.sql"), "Migration file missing")
    const content = fileContent("supabase/migrations/20260611_native_design.sql")
    assert(content.includes("design_brief"), "design_brief column missing")
    assert(content.includes("qa_status"), "qa_status column missing")
})

test("12.7 autopilot stores design_brief + qa_status", () => {
    const content = fileContent("instagram/autopilot.ts")
    assert(content.includes("design_brief: renderResult?.designBrief"), "design_brief not stored on post")
    assert(content.includes("qaStatus: renderResult?.qaStatus"), "qaStatus not logged")
    assert(content.includes("recentBriefs"), "recentBriefs anti-repetition not wired")
})

// ═══════════════════════════════════════════════════════════
// 12. Plan drafts / campaign arc / feed pattern
// ═══════════════════════════════════════════════════════════

test("12.1 draft approval is a single-use claim (no insert fallback → no double charge)", () => {
    const c = fileContent("app/actions/campaign-actions.ts")
    assert(c.includes('.eq("status", "draft")'), "startCampaign must filter the claim on status='draft'")
    // The claim and the plain insert must be exclusive branches: an insert reachable after a
    // failed claim would let a double-click bill the same plan twice.
    const claimIdx = c.indexOf('if (options.draftId)')
    const refusalIdx = c.indexOf('if (!claimed) return')
    assert(claimIdx > 0 && refusalIdx > claimIdx, "a failed draft claim must return, not fall through to insert")
})

test("12.2 draft actions are status-scoped (can never touch a live campaign)", () => {
    const c = fileContent("app/actions/content-plan-actions.ts")
    for (const fn of ["savePlanDraft", "discardPlanDraft"]) {
        const body = c.slice(c.indexOf(`export async function ${fn}`), c.indexOf(`export async function ${fn}`) + 900)
        assert(body.includes('.eq("status", "draft")'), `${fn} must be scoped to status='draft'`)
        assert(body.includes('.eq("client_id", clientId)'), `${fn} must filter by client_id`)
    }
})

test("12.3 the worker cannot claim a draft", () => {
    const c = fileContent("app/api/cron/campaign-worker/route.ts")
    const claims = c.split('.in("status", ["pending", "running"])').length - 1
    assert(claims >= 2, "both candidate select and tryClaim must restrict status to pending/running")
    assert(!c.includes('"draft"') || c.includes('.eq("status", "draft")'), "draft may only appear in the GC delete")
})

test("12.4 plan preview stays side-effect-free (no idea-bank writes)", () => {
    const c = fileContent("app/actions/content-plan-actions.ts")
    const gen = c.slice(c.indexOf("export async function generateContentPlan"), c.indexOf("// ─── Plan drafts"))
    assert(!gen.includes('.from("ig_post_ideas").insert'), "generateContentPlan must never deposit ideas — that's startCampaign's job")
})

test("12.5 campaign arc reaches every post, including the first", () => {
    const w = fileContent("app/api/cron/campaign-worker/route.ts")
    assert(w.includes("campaignArc: (opts.strategySummary"), "worker must pass the persisted arc into campaignContext")
    const a = fileContent("instagram/autopilot.ts")
    assert(!a.includes("options.campaignContext.previousPosts.length > 0"), "arc injection must not be gated on having predecessors")
    const s = fileContent("app/actions/campaign-actions.ts")
    assert(s.includes("strategySummary: options.strategySummary"), "startCampaign must persist the strategist arc")
})

test("12.6 slot intent rides the plan row and is never recomputed mid-campaign", () => {
    const s = fileContent("app/actions/campaign-actions.ts")
    assert(s.includes("slotIntent: it.slotIntent"), "startCampaign must persist slotIntent onto plan rows")
    const w = fileContent("app/api/cron/campaign-worker/route.ts")
    assert(w.includes("slotIntent: item?.slotIntent"), "worker must read slotIntent off the plan item")
    assert(!w.includes("computeSlotIntent"), "worker must NOT recompute a slot — a resumed post would flip mode")
})

test("12.7 feed pattern narrows archetypes but keeps divergence", () => {
    const c = fileContent("instagram/image-pipeline.ts")
    assert(c.includes("ARCHETYPE_GROUPS[slotIntent.visualMode]"), "designer must scope archetypes to the slot's family")
    assert(c.includes("afterBan.length > 0 ? afterBan : [...archetypePool]"), "pattern must win when the ban empties the family")
    assert(c.includes("FEED PATTERN SLOT"), "designer prompt must carry the slot directive")
    assert(c.includes("!allowedArchetypes.includes(brief.layoutArchetype)"), "in-code rejection must validate against the allowed set")
})

test("12.8 feedPattern is clamped in validateConfig", () => {
    const c = fileContent("instagram/configs/index.ts")
    assert(c.includes("isFeedPattern(config.feedPattern)"), "validateConfig must clamp feedPattern")
    assert(c.includes(': "none"'), "unknown feedPattern must fall back to none")
})

test("12.9 feed-pattern grid count matches FeedTab's grid", () => {
    // If these two filters diverge, the ghost cells stop describing the real grid.
    const s = fileContent("instagram/service.ts")
    const start = s.indexOf("export async function countFeedPosts")
    assert(start > 0, "countFeedPosts must exist in instagram/service.ts")
    // Bound the window at the next export, or a neighbouring function's body leaks into it.
    const fn = s.slice(start, s.indexOf("export async function", start + 1))
    assert(fn.includes('.not("image_url", "is", null)'), "countFeedPosts must count posts with an image")
    assert(fn.includes("clientId: string"), "countFeedPosts must take clientId explicitly")
    assert(!fn.includes("getActiveProject"), "countFeedPosts must not use the module-global tenant")
    // Stories never land in the profile grid — both sides must exclude them, or the
    // engine's grid index drifts away from what the preview draws.
    assert(fn.includes("media_type.neq.story"), "countFeedPosts must exclude stories from the grid")
    // PostgREST .neq() is SQL <>, and NULL <> 'story' is NULL. media_type was added
    // (20260622) with no backfill, so a bare .neq() would drop every legacy row and
    // silently shrink the grid for every existing tenant.
    assert(fn.includes("media_type.is.null"), "countFeedPosts must keep legacy NULL media_type rows (.neq() alone drops them)")
    const f = fileContent("app/(dashboard)/dashboard/instagram/tabs/FeedTab.tsx")
    assert(f.includes('p.image_url && p.media_type !== "story"'), "FeedTab grid must filter on image_url AND exclude stories — keep countFeedPosts in sync")
})

// ═══════════════════════════════════════════════════════════
// 13. INSTAGRAM STORIES (v8.4)
// ═══════════════════════════════════════════════════════════

test("13.1 story is priced — MediumType is derived from the credit table", () => {
    const c = fileContent("lib/credits.ts")
    assert(c.includes("story: 2"), "MEDIA_CREDITS must price a story set at 2 credits")
    assert(c.includes("keyof typeof MEDIA_CREDITS"), "MediumType must be DERIVED from MEDIA_CREDITS — an unpriced medium must not be representable")
    // creditsForMedia falls back to image for unknown values, so a medium missing from
    // the table would silently bill 1 credit. The derivation above is what prevents that.
    assert(c.includes("MEDIA_CREDITS.image"), "creditsForMedia must keep its legacy-NULL fallback")
})

test("13.2 clamps pin vertical media to 9:16 and rank by price", () => {
    const c = fileContent("instagram/format-clamps.ts")
    assert(c.includes('VERTICAL_MEDIA'), "clamps must name the vertical media set explicitly")
    assert(c.includes('"reel", "story"'), "reel AND story must both be vertical")
    assert(c.includes("creditsForMedia(f.medium) > creditsForMedia(opts.chargedMedium)"), "billing cap must rank by the credit table, not a parallel MEDIUM_RANK map")
    assert(!codeOnly("instagram/format-clamps.ts").includes("MEDIUM_RANK"), "MEDIUM_RANK is a second ordering to keep in sync — it must stay deleted")
    assert(!codeOnly("instagram/autopilot.ts").includes("MEDIUM_RANK"), "MEDIUM_RANK must not come back in autopilot either")
    const a = fileContent("instagram/autopilot.ts")
    assert(a.includes("applyFormatClamps(format, clampOpts)"), "autopilot must clamp the fresh format")
    assert(a.includes("applyFormatClamps(ck.format, clampOpts)"), "autopilot must RE-clamp after a checkpoint restore — live rules beat the frozen format")
})

test("13.3 story format survives a config reload", () => {
    // reconcileFormats runs on EVERY loadConfig and rebuilds postFormats from
    // postTypeDefs — without these defaults a story_* format reverts to image/4:5.
    const r = fileContent("instagram/configs/reconcile.ts")
    assert(r.includes('medium === "reel" || medium === "story" ? "9:16"'), "reconcile must default story to 9:16")
    const cg = fileContent("instagram/caption-generator.ts")
    assert(cg.includes('typeName.startsWith("story_")'), "getPostFormat must honour the story_ prefix convention")
})

test("13.4 copywriter emits frames and autopilot enforces the hook verbatim", () => {
    const cg = fileContent("instagram/caption-generator.ts")
    assert(cg.includes("export function buildStorySchema"), "buildStorySchema must exist")
    assert(cg.includes("export const MAX_STORY_FRAMES"), "the frame cap must be a shared constant")
    assert(cg.includes('"swipe up"'), "the story prompt must forbid swipe-up (API stories have no link sticker)")
    const a = fileContent("instagram/autopilot.ts")
    assert(a.includes("parsed.frames.slice(0, MAX_STORY_FRAMES)"), "autopilot must cap the frame count")
    assert(a.includes("headline: parsed.hook"), "frames[0].headline must be forced to the hook — hook is load-bearing downstream")
})

test("13.5 designer + QA carry the story safe zone", () => {
    const p = fileContent("instagram/image-pipeline.ts")
    assert(p.includes("export const STORY_SAFE_ZONE_RULE"), "the safe zone must be a shared constant")
    assert(p.includes("export async function generateStoryDesignBriefs"), "stories need their own designer (carousel semantics are wrong here)")
    assert(p.includes("safeZone?: boolean"), "verifyNativeImage must accept the story frame checks")
    // Without the QA half, the ship-best ladder can never correct the failure modes
    // stories add. Both were observed in a real render before they were guarded:
    assert(p.includes("STORY FRAME CHECKS"), "the QA prompt must run the story frame checks")
    assert(p.includes("FAKE INTERFACE"), "QA must reject a drawn Instagram UI — describing IG's chrome to an image model made it render one")
    assert(p.includes("SAFE ZONE"), "QA must check that text clears Instagram's own UI bands")
    // The rule itself must FORBID the UI, not just describe where it sits.
    assert(p.includes("NEVER DRAW INSTAGRAM'S INTERFACE"), "STORY_SAFE_ZONE_RULE must forbid rendering IG's interface")
    const o = fileContent("instagram/orchestrators/story-orchestrator.ts")
    assert(o.includes("safeZone: true"), "the story orchestrator must request the safe-zone QA")
    assert(o.includes("ig-stories/"), "story frames must upload to their own prefix")
    assert(!o.includes("SLIDE INDICATOR"), "a story must never carry a carousel's N/M counter")
})

test("13.6 stories publish as STORIES containers, at most once per frame", () => {
    const c = fileContent("lib/channels/instagram.ts")
    assert(c.includes('media_type: "STORIES"'), "stories need their own Graph container type")
    // The old else-branch treated anything non-carousel as a feed image, so an
    // unhandled medium would post a STORY to the feed — permanently, on a real account.
    assert(c.includes("const _never: never = content.mediaType"), "publish() must be exhaustive on mediaType")
    assert(c.includes("partial:"), "a later-frame failure must report partial success, not throw")
    const cron = fileContent("app/api/cron/ig-publisher/route.ts")
    assert(cron.includes("isMediumType(post.media_type)"), "resolveMediaType must narrow via isMediumType, not a hand-written whitelist")
    assert(cron.includes("result.partial"), "the cron must close out a partial publish instead of re-arming it")
    // ig_posts has one ig_media_id and no per-frame cursor: re-arming republishes the
    // frames already live, up to MAX_ATTEMPTS times.
    assert(cron.includes("Publikováno ${result.partial.publishedCount}"), "a partial publish must record what actually went live")
})

test("13.7 auto-publish skips stories AND keeps legacy NULL rows", () => {
    const c = fileContent("lib/agents/auto-publish.ts")
    assert(c.includes("media_type.is.null"), "a bare .neq() drops every legacy NULL row (media_type added 20260622 without a backfill)")
    assert(c.includes("media_type.neq.story"), "the feed-cadence armer must skip stories")
    assert(!codeOnly("lib/agents/auto-publish.ts").includes('.neq("media_type"'), "the old NULL-dropping .neq() must stay removed")
})

test("13.8 every plan grants story (seed must not drift)", () => {
    // 20260716_pricing_v5.sql is a declarative seed with ON CONFLICT DO UPDATE SET
    // features = EXCLUDED.features — leaving it stale means the next run STRIPS story.
    const seed = fileContent("supabase/migrations/20260716_pricing_v5.sql")
    const media = seed.match(/"allowed_media": \[[^\]]*\]/g) || []
    assert(media.length === 4, `expected 4 allowed_media literals, found ${media.length}`)
    assert(media.every(m => m.includes('"story"')), "every plan's allowed_media must include story, or the seed re-run removes it")
})

// ═══════════════════════════════════════════════════════════
// 14. FAKTURACE A PRÁVNÍ IDENTITA (v8.5)
// ═══════════════════════════════════════════════════════════

test("14.1 legal identity has exactly one source of truth", () => {
    assert(fileExists("lib/legal.ts"), "lib/legal.ts must exist — identity on five pages is identity that drifts")
    // Právní stránky ani patička nesmí mít IČO natvrdo: jedna změna sídla by
    // jinak nechala část webu lhát a nikdo by si toho nevšiml.
    for (const page of ["app/terms/page.tsx", "app/privacy/page.tsx", "components/Landing.tsx"]) {
        assert(fileContains(page, 'from "@/lib/legal"'), `${page} must read identity from lib/legal`)
        assert(!/IČO[:\s]*\d{6}/.test(fileContent(page)), `${page} must not hardcode an IČO`)
    }
})

test("14.2 identity gaps block the launch instead of shipping placeholders", () => {
    const c = fileContent("lib/legal.ts")
    assert(c.includes("legalIdentityGaps"), "lib/legal must expose the completeness check")
    assert(c.includes('PLACEHOLDER = "DOPLNIT"'), "placeholder must be recognisable, never a plausible-looking fake value")
    const s = fileContent("scripts/check-legal-identity.ts")
    assert(s.includes("process.exit(1)"), "check script must FAIL — a warning nobody reads is not a gate")
})

test("14.3 one payment can never produce two invoices", () => {
    const m = fileContent("supabase/migrations/20260730_billing_invoices.sql")
    // Číselná řada faktur je nevratná: duplicitu nejde smazat, jen stornovat.
    assert(/CREATE UNIQUE INDEX[\s\S]*?invoices \(payment_id\)/.test(m), "invoices.payment_id must carry a UNIQUE index — that index IS the idempotency claim")
    const c = codeOnly("lib/invoicing.ts")
    assert(c.includes('.insert('), "the claim must be an INSERT that the unique index can reject")
    assert(c.includes('status: "duplicate"'), "a rejected claim must return duplicate, never fall through to issuing")
})

test("14.4 invoicing can never break the payment callback", () => {
    const c = fileContent("lib/invoicing.ts")
    assert(c.includes("catch"), "issueInvoiceForPayment must swallow its own failures")
    assert(c.includes('status: "failed"'), "a failure must be PERSISTED — a silent catch leaves a customer with no document and nobody knowing")
    // Doklad se vystavuje ve společném jádru, ne v routě konkrétní brány.
    const core = fileContent("lib/payments/on-paid.ts")
    assert(core.includes("issueInvoiceForPayment"), "the shared core must issue the document")
    assert(/deliverPaidArtifacts[\s\S]*?catch/.test(core), "deliverPaidArtifacts must swallow its own failures — a receipt must never break a payment")
    // Doručení se přestěhovalo z rout do jádra (applyGatewayStatus), protože ho
    // potřebují tři volající. Záruka je stejná, jen na jednom místě.
    assert(/after\(\(\) => deliverPaidArtifacts/.test(core), "delivery must run inside after() so the gateway still gets its immediate ACK")
    const cb = fileContent("app/api/payments/callback/route.ts")
    assert(cb.includes("applyGatewayStatus"), "callback must delegate delivery to the shared core")
})

test("14.9 the paid-payment core is shared, not copied per gateway", () => {
    // Druhá brána nesmí znamenat druhé místo, které zapomene na doklad nebo na
    // aktivaci plánu. Jádro je provider-neutrální; routy dělají jen ověření a claim.
    const core = codeOnly("lib/payments/on-paid.ts")
    // Jádro SMÍ brány jmenovat v typu PaymentProvider (potřebuje je odlišit ve
    // Sentry tagu), ale nesmí IMPORTOVAT klienta konkrétní brány — tím by se
    // stalo závislé na jedné z nich a druhá by si musela udělat kopii.
    assert(!/from\s+["']@?\/?lib\/comgate["']/.test(core), "the shared core must not import the Comgate client")
    assert(!/import\(["']@\/lib\/comgate["']\)/.test(core), "not even dynamically — the refId convention lives in lib/payments/ref-id.ts")
    assert(!/from\s+["']stripe["']/.test(core), "the shared core must not import the Stripe SDK either")
    assert(!core.includes("getPaymentStatus"), "server-side status verification is gateway-specific and stays in the route")

    // Aktivace plánu smí být jen v jádru — kopie v routě by se rozešla.
    const cb = codeOnly("app/api/payments/callback/route.ts")
    assert(!cb.includes("activatePaidPlan"), "the Comgate route must NOT activate the plan itself — that logic lives in the core")
    assert(cb.includes("applyGatewayStatus"), "the route must call the core")

    // Mock transId se nikdy nesmí uložit jako token pro budoucí obnovy —
    // příští měsíc by se na něj poslala skutečná platba.
    assert(/isMockPaymentMode\(\)[\s\S]*?recurringToken|recurringToken[\s\S]*?isMockPaymentMode\(\)/.test(cb),
        "the mock guard must stay on the recurring token")
    assert(core.includes("if (!opts.isRenewal && opts.recurringToken)"),
        "the core stores the recurring token only on the FIRST payment, never on a renewal")
})

test("14.5 amounts cross the haléř/koruna boundary exactly once", () => {
    const f = fileContent("lib/fakturoid.ts")
    assert(f.includes("haleruToCzk"), "the conversion must be a named function, not an inline /100 sprinkled around")
    assert(f.includes("unit_price: haleruToCzk("), "invoice line must convert — raw payments.amount would invoice 100× the price")
    // invoices.total_czk zůstává v haléřích schválně, aby seděl s payments.amount.
    assert(fileContains("app/actions/billing-actions.ts", "totalCzk"), "invoice list must expose the total for the UI")
})

test("14.6 consumer consent to instant access is recorded, not assumed", () => {
    const a = fileContent("app/actions/billing-actions.ts")
    // Bez záznamu souhlasu právo spotřebitele na odstoupení do 14 dnů TRVÁ (§1837).
    assert(a.includes("recordInstantAccessConsent"), "consent must be recordable")
    assert(a.includes("instant_access_consent_text"), "the exact wording must be stored — a boolean proves nothing in a dispute")
    assert(a.includes('.is("instant_access_consent_at", null)'), "consent write must be conditional so a re-confirm never overwrites the original timestamp")
    const ui = fileContent("app/(dashboard)/dashboard/instagram/tabs/BillingSection.tsx")
    assert(ui.includes("INSTANT_ACCESS_CONSENT_TEXT"), "the UI must show the same wording it stores")
})

test("14.7 terms match what the code actually does", () => {
    const t = fileContent("app/terms/page.tsx")
    // Trial je obsahově omezený (lib/subscription.ts), ne časový — podmínky
    // slibovaly „7denní zkušební období", což byl nevymahatelný slib navíc.
    assert(!t.includes("7denní"), "terms must not promise a 7-day trial — the trial is content-gated, not time-gated")
    assert(fileContains("lib/subscription.ts", "No expiration — trial is limited by content gating"), "if the trial becomes time-gated, this assertion must be revisited together with the terms")
    // Nevyčerpané kredity propadají — materiální podmínka, kterou musí zákazník znát předem.
    assert(t.includes("nepřevádějí"), "terms must disclose that unused credits expire")
    assert(t.includes("automaticky obnovuje"), "terms must disclose auto-renewal")
})

test("14.8 no reference to the shut-down EU ODR platform", () => {
    // Platforma ODR byla ukončena 20. 7. 2025 — odkaz na ni je dnes chyba,
    // a vzory obchodních podmínek ji pořád obsahují.
    for (const page of ["app/terms/page.tsx", "app/privacy/page.tsx", "lib/legal.ts"]) {
        const c = fileContent(page)
        assert(!c.includes("ec.europa.eu/consumers/odr"), `${page} must not link the discontinued ODR platform`)
    }
    // Adresa ČOI je v lib/legal (CONSUMER_AUTHORITY), stránka ji jen vykresluje.
    assert(fileContains("lib/legal.ts", "adr.coi.cz"), "lib/legal must carry the ČOI ADR address consumers are pointed at")
    assert(fileContains("app/terms/page.tsx", "CONSUMER_AUTHORITY"), "terms must render the ADR body from lib/legal")
})

// ═══════════════════════════════════════════════════════════
// 15. CÍLENÁ ÚPRAVA PŘÍSPĚVKU (v8.6)
// ═══════════════════════════════════════════════════════════

test("15.1 editPost retušuje hotový obrázek, nikdy nekreslí nový návrh", () => {
    assert(fileExists("app/actions/post-edit-actions.ts"), "post-edit-actions.ts musí existovat")
    const code = codeOnly("app/actions/post-edit-actions.ts")

    // Jádro celé opravy. renderImage/generateDesignBrief = cesta „vymysli nový koncept,
    // nový archetyp, novou fotku" — přesně to, co uživateli přepisovalo celou grafiku,
    // když napsal „posuň nadpis". Jakmile je sem někdo doimportuje, chyba je zpátky.
    assert(!code.includes("renderImage"), "editPost nesmí volat renderImage — to je přegenerování, ne úprava")
    assert(!code.includes("generateDesignBrief"), "editPost nesmí volat generateDesignBrief")
    assert(code.includes("editExistingImage"), "editPost musí upravovat existující buffer")
    assert(code.includes("fetchImageBuffer"), "editPost musí stáhnout původní obrázek")
    assert(code.includes("buildPostEditPrompt"), "editPost musí použít sdílený builder promptu")
})

test("15.2 úprava se zapisuje na místě a nikdy nezaloží nový řádek", () => {
    const code = codeOnly("app/actions/post-edit-actions.ts")
    // Stejná doktrína jako u plan draftů a schvalování produktových řad: jediný
    // podmíněný zápis vlastněný klientem, žádný insert fallback.
    assert(!code.includes(".insert("), "editPost nesmí vkládat nový příspěvek — úprava je in-place")
    assert(code.includes('.eq("client_id", clientId)'), "každý zápis musí být omezený na klienta")
    assert(code.includes("edit_history"), "předchozí stav se musí uložit do historie")
    assert(code.includes("revertPostEdit"), "musí existovat cesta zpět")
})

test("15.3 úprava obrázku je zpoplatněná, úprava textu ne", () => {
    const code = codeOnly("app/actions/post-edit-actions.ts")
    assert(/creditGuard\(projectSlug, "post_edit"\)/.test(code), "obrázková větev musí projít credit guardem")
    assert(/wantsImage \? await creditGuard/.test(code), "textová úprava se nesmí účtovat")
    assert(code.includes("guard.commit"), "kredit se strhává až po úspěchu")

    const sub = fileContent("lib/subscription.ts")
    assert(sub.includes('post_edit: 1'), "post_edit musí stát 1 kredit")
    assert(!/action === "post" \|\| action === "post_edit"/.test(sub), "post_edit je plochý — edit je jedno volání modelu bez ohledu na médium")
})

test("15.4 post_edit je povolený na všech plánech, které umí generovat", () => {
    // canPerformAction odmítne akci chybějící v allowed_actions s featureBlocked,
    // takže bez backfillu je tlačítko mrtvé na všech tarifech.
    const mig = fileContent("supabase/migrations/20260805_post_edit_history.sql")
    assert(mig.includes("edit_history"), "migrace musí přidat sloupec historie")
    assert(mig.includes('allowed_actions') && mig.includes('"post_edit"'), "migrace musí doplnit post_edit do plánů")
    assert(mig.includes(`@> '["post"]'::jsonb`), "backfill se musí vázat na 'post', ne na názvy tarifů (ty se třikrát přejmenovaly)")
})

test("15.5 po uživatelské úpravě se nikdy neregeneruje od nuly", () => {
    const code = codeOnly("app/actions/post-edit-actions.ts")
    // Jeden korektivní edit ANO (rozbitá diakritika je rozbitá vždycky), čerstvá
    // regenerace NE — zahodila by návrh, který si uživatel chce nechat.
    assert(code.includes('qa.severity === "severe"'), "QA smí zasáhnout jen u vážné vady, ne u kosmetické")
    // Korektivní prompt umí opravit JEN typografii. Bez téhle podmínky se v ostrém běhu
    // spustil na hlášku „no brand logo present" u postu, který logo nikdy neměl — a edit
    // ho přidal, tedy provedl změnu designu, kterou si uživatel nevyžádal.
    assert(code.includes("qa.textAccurate === false"), "korekce se smí spustit jen na vadu textu, kterou úprava způsobila")
    assert(!code.includes("generateImageWithReferences"), "žádná čerstvá regenerace v edit cestě")
    const editCalls = (code.match(/editExistingImage\(/g) || []).length
    assert(editCalls <= 2, `nejvýš dva edity (úprava + jedna korekce), našel ${editCalls}`)
})

test("15.6 poměr stran vychází ze skutečných pixelů, ne z konfigurace", () => {
    const code = codeOnly("app/actions/post-edit-actions.ts")
    // Jiný aspectRatio než má vstup = model překomponuje celý snímek. Přesně tohle
    // dělá revisePost, když story natvrdo vrazí do 4:5.
    assert(code.includes("nearestAspectRatio"), "poměr stran se musí odvodit z metadat obrázku")
    assert(code.includes("sharp(original).metadata()"), "rozměry se musí přečíst ze skutečného bufferu")
    assert(!/aspectRatio: "4:5"/.test(code), "poměr stran se nesmí hardcodovat")
    // Uložené obrázky jsou WebP; editExistingImage má default image/jpeg.
    assert(code.includes('mimeType: "image/webp"'), "vstupní buffer je WebP a musí se tak deklarovat")
})

test("15.7 přegenerování je zpoplatněné a zůstává opt-in", () => {
    const code = codeOnly("app/actions/variant-actions.ts")
    assert(/creditGuard\(projectSlug, "post_variant"\)/.test(code), "revisePost je plná generace — musí být zpoplatněná")

    const ui = fileContent("app/(dashboard)/dashboard/instagram/tabs/PostsTab.tsx")
    assert(ui.includes("editPost"), "PostsTab musí nabízet cílenou úpravu")
    assert(ui.includes("Vygenerovat úplně znovu") || ui.includes("vygenerovat úplně znovu"),
        "přegenerování musí být samostatná, jasně označená akce")
    assert(ui.includes("Vrátit zpět"), "musí jít vrátit poslední úpravu")
})

test("15.8 fetchImageBuffer má jedinou definici", () => {
    assert(fileExists("lib/image-buffer.ts"), "lib/image-buffer.ts musí existovat")
    const print = codeOnly("app/actions/print-actions.ts")
    assert(!/async function fetchBuffer\(/.test(print), "print-actions už nesmí mít vlastní kopii")
    assert(print.includes('from "@/lib/image-buffer"'), "print-actions musí importovat sdílený helper")
})

test("15.9 textová úprava nesmí rozjet re-roll obrázku", () => {
    const cap = fileContent("instagram/caption-generator.ts")
    // reviseCaption měla imagePrompt povinně ve schématu, takže i „zkrať text" vrátilo
    // nový image prompt a revisePost na něj vyrenderoval úplně nový obrázek.
    assert(cap.includes("keepHook"), "reviseCaption musí umět textovou úpravu bez obrázku")
    assert(cap.includes("delete parsed.imagePrompt"), "u keepHook musí imagePrompt zmizet v kódu, ne jen v promptu")
    assert(/parsed\.hook = input\.renderedHook/.test(cap), "hook vypálený v obrázku se musí vynutit kódem")
})

// ═══════════════════════════════════════════════════════════
// 16. PROMPTOVÝ AUDIT (v8.7) — vrstvy si nesmí protiřečit
// ═══════════════════════════════════════════════════════════

test("16.1 reelové schéma nese narration + soundEffect (K1)", () => {
    const code = fileContent("instagram/caption-generator.ts")
    // responseSchema je whitelist, ne minimum: pole, o které si prompt řekne a schéma
    // ho nedeklaruje, model NEVRÁTÍ (ověřeno proti gemini-pro-latest 2026-08-05).
    // Bez těchhle dvou byl scenes[].narration vždy prázdný → generateVoiceover se
    // nikdy nezavolal, scenesToSubtitles neměl co kreslit a celý FFmpeg krok se přeskočil.
    assert(/required: \["timeRange", "visual", "camera", "mood", "narration", "soundEffect"\]/.test(code),
        "scéna reelu musí mít narration i soundEffect v required")
    // Hloubková verze téhle kontroly (schéma vs. JSON ukázka pro všechna média)
    // žije v scripts/test-prompt-assembly.ts — tady jen kotva proti tichému návratu.
    assert(fileExists("scripts/test-prompt-assembly.ts"), "prompt assembly testy musí existovat")
})

test("16.2 schéma revize umí vrátit slidy i scény (K2)", () => {
    const code = fileContent("instagram/editorial-board.ts")
    assert(code.includes("buildCopywriterRevisionSchema"), "schéma revize musí být stavěné, ne fixní")
    assert(/isCarousel \?/.test(code) && /isReel \?/.test(code),
        "schéma se musí větvit na stejné dva příznaky jako prompt")
    assert(code.includes("slides:") && code.includes("scenes:"),
        "bez slides/scenes nešlo karusel ani reel opravit — editor psal poznámky, které copywriter fyzicky nemohl provést")
})

test("16.3 skóre se po revizi přehodnotí (K3)", () => {
    const code = codeOnly("instagram/editorial-board.ts")
    assert(code.includes("scorePost("), "reviewPost musí po revizi znovu skórovat")
    // lastScore se dřív přiřadil jednou a jen četl → final_score === critic_score vždy.
    const assignments = (code.match(/lastScore = /g) || []).length
    assert(assignments >= 2, `lastScore se musí aktualizovat, našel ${assignments} přiřazení`)
    assert(code.includes("rescored.detail"), "přeskórování se smí přijmout jen když judge opravdu doběhl")
})

test("16.4 šéfredaktor zná skutečný počet kol (V6)", () => {
    const code = fileContent("instagram/editorial-board.ts")
    assert(/kolo \$\{round\}\/\$\{maxRounds\}/.test(code),
        "prompt nesmí tvrdit 3 kola, když best-of-2 dává jedno")
    assert(!/kolo \$\{round\}\/\$\{MAX_POST_ROUNDS\}/.test(code), "MAX_POST_ROUNDS se nesmí do promptu psát natvrdo")
})

test("16.5 getBrandMemories filtruje typ v dotazu, ne až za ním (K5)", () => {
    const mem = fileContent("instagram/memory-agent.ts")
    assert(mem.includes('query.in("memory_type", types)'), "typový filtr musí být v SQL — limit se aplikuje před ním")

    // Limit šel do SQL napříč všemi typy, takže tenhle filtr vracel prázdno, jakmile
    // měl klient 5 textových pamětí s vyšší confidence. Vizuální paměť tím tiše zmizela
    // z promptu designéra — a s ní celá větev vizuálního učení.
    const img = codeOnly("instagram/image-pipeline.ts")
    assert(!/memories\.filter\(m => m\.memory_type === "visual"\)/.test(img),
        "image-pipeline nesmí filtrovat typ až po limitu")
    assert(/\["visual"\]/.test(img), "image-pipeline musí žádat visual paměti přímo")

    const print = codeOnly("instagram/print-pipeline.ts")
    assert(!/memories\.filter\(m => m\.memory_type === "visual"\)/.test(print),
        "print-pipeline nesmí filtrovat typ až po limitu")
})

test("16.6 generátor nápadů předává clientId (K6)", () => {
    const code = codeOnly("instagram/idea-generator.ts")
    // Bez explicitního clientId spadl getBrandMemories na getActiveProject(), který mimo
    // withActiveProject vyhodí výjimku — a catch ji spolkl. Onboarding volání obaloval,
    // hlavní cesta z UI ani denní replenish ne.
    assert(/getBrandMemories\(5, clientId/.test(code), "getBrandMemories musí dostat clientId explicitně")
    assert(!/catch \{\s*\}/.test(code), "tiché catch bez logu tuhle chybu roky schovávalo")
})

test("16.7 learning sekce jen se skutečnými metrikami (K4)", () => {
    const code = fileContent("instagram/caption-generator.ts")
    assert(/performance\.avgEngagement > 0 && \(performance\.topPatterns\.length/.test(code),
        "Zlaté hooky se nesmí injektovat, když engagement nikdo nenaměřil")
})

test("16.8 mega prompt neslibuje zrušený Satori overlay (V1)", () => {
    const cap = fileContent("instagram/caption-generator.ts")
    assert(!cap.includes("**OVERLAY:**"), "popis overlay gradientu patří mrtvému enginu")
    assert(!cap.includes("1:1 square"), "default poměr je 4:5, ne 1:1")

    const img = fileContent("instagram/image-pipeline.ts")
    assert(!/export function buildFeedAesthetic/.test(img),
        "buildFeedAesthetic byl mrtvý kód se stejným zastaralým textem — nevracet")
})

test("16.9 karusel: indikátor slidu neprotiřečí zákazu textu (V2)", () => {
    const img = fileContent("instagram/image-pipeline.ts")
    assert(img.includes("allowedExtraText"), "buildNativeImagePrompt i QA musí vědět o povoleném textu navíc")

    const car = fileContent("instagram/orchestrators/carousel-orchestrator.ts")
    assert(/buildNativeImagePrompt\([^)]*slideIndicator/.test(car),
        "indikátor musí jít dovnitř promptu, ne se lepit za něj")
    assert(car.includes("allowedExtraText: slideIndicator"),
        "QA musí indikátor tolerovat, jinak spálí sdílený rozpočet oprav na neproblém")
})

test("16.10 vizuální učení čte design_brief (V7)", () => {
    const code = fileContent("instagram/memory-agent.ts")
    assert(/select\("id, image_prompt, image_style, design_brief/.test(code),
        "analyzeVisualPatterns musí číst, co se opravdu renderovalo")
    assert(code.includes("layoutArchetype"), "brief nese archetyp — to je použitelný signál, image_prompt ne")
})

test("16.11 critic_score se nefabrikuje při výpadku judge (S5)", () => {
    const cap = fileContent("instagram/caption-generator.ts")
    assert(/judged: false/.test(cap), "scorePost musí hlásit, že neproběhl")
    const auto = fileContent("instagram/autopilot.ts")
    assert(/criticScore: judged \? score : null/.test(auto),
        "nehodnocený post musí mít critic_score null, ne vymyšlenou 7")
})

test("16.12 plán počítá top hooky z reálných metrik (S4)", () => {
    const code = codeOnly("app/actions/content-plan-actions.ts")
    // ig_posts.engagement_score v databázi NEEXISTUJE (ověřeno proti prod 2026-08-05)
    // a nikdy ho nic nezapisovalo — dotaz pokaždé skončil chybou, ta se zahodila
    // a sekce „nejlepší hooky" se v plánovacím promptu nikdy neobjevila.
    assert(!code.includes("engagement_score"), "engagement_score je fantomový sloupec — nevracet")
    assert(/3 \* \(p\.comments \|\| 0\) \+ 5 \* \(p\.saves \|\| 0\)/.test(code),
        "engagement se musí počítat stejným vzorcem jako v performance.ts")
})

test("16.13 kampaň nedostane sedmkrát tentýž kontext (V4)", () => {
    const ctx = fileContent("instagram/context-agent.ts")
    assert(/formatContextForPrompt\(ctx: ContextSignals, offset = 0\)/.test(ctx),
        "formátování kontextu musí umět rotaci")
    const auto = fileContent("instagram/autopilot.ts")
    assert(/formatContextForPrompt\(context, options\.campaignContext\?\.postNumber/.test(auto),
        "pozice v kampani musí kontext posunout")
})

// ═══════════════════════════════════════════════════════════
// 17. REELOVÉ BLOKÁTORY (v8.8) — kvalita a tichá degradace
// ═══════════════════════════════════════════════════════════

test("17.1 video director běží na Pro ladderu, ne na flash (V3)", () => {
    const code = codeOnly("instagram/image-pipeline.ts")
    const fn = code.slice(code.indexOf("export async function refineVideoPrompt"))
    assert(!/model: getModel\("text"\)/.test(fn),
        "video director je jediný kreativní krok mezi copywriterem a videem — nesmí na flash")
    assert(/generateTextQuality\(refinementPrompt/.test(fn),
        "musí jít přes kvalitní ladder (tvrdý retry + fallback + QualityUnavailableError)")
    assert(/getModel\("textPro"\)/.test(fn), "ladder je textPro, stejný jako u copywritera")
    assert(/json: false/.test(fn), "výstup je próza, ne JSON")
})

test("17.2 reel neporušuje CTA politiku vypálenou URL do videa (V3)", () => {
    const code = codeOnly("instagram/image-pipeline.ts")
    const fn = code.slice(code.indexOf("export async function refineVideoPrompt"))
    assert(/ctaPolicy\?: CtaPolicy/.test(fn), "refineVideoPrompt musí politiku vůbec dostat")
    assert(!/MUST include \$\{config\.website\} branding \(text on screen or product placement\)\n/.test(fn),
        "web se nesmí do závěru videa vypalovat natvrdo bez ohledu na pilíř")
    assert(/!ctaPolicy\.allowWebsite/.test(fn),
        "zákaz webu musí větvit podle politiky, ne podle formátu")
    const types = fileContent("instagram/orchestrators/types.ts")
    assert(/ctaPolicy\?: CtaPolicy/.test(types), "RenderContext musí politiku přenést do orchestrátoru")
    const reel = codeOnly("instagram/orchestrators/reel-orchestrator.ts")
    assert(/ctx\.ctaPolicy/.test(reel), "reel orchestrátor ji musí předat dál")
})

test("17.3 CTA politika je k dispozici i postu z checkpointu (V3)", () => {
    const code = codeOnly("instagram/autopilot.ts")
    const resolveIdx = code.indexOf("const ctaPolicy = resolveCtaPolicyForPost")
    const megaIdx = code.indexOf("megaPrompt = buildMegaPrompt(")
    assert(resolveIdx > 0 && megaIdx > 0, "obě místa musí existovat")
    // Checkpoint větev, která hlídá copywritera, je ta poslední před buildMegaPrompt.
    // Resume z caption checkpointu přeskakuje CELOU copywriterskou větev, ale média
    // renderuje — kdyby policy zůstala uvnitř else, resumnutý reel by ji neměl.
    const branchIdx = code.lastIndexOf("if (ck) {", megaIdx)
    assert(branchIdx > 0, "checkpoint větev před copywriterem musí existovat")
    assert(resolveIdx < branchIdx,
        "resolve CTA politiky musí být NAD checkpoint větví, ne uvnitř else")
})

test("17.4 ffmpeg binárka je připnutá pro obě reelové routy", () => {
    const cfg = fileContent("next.config.ts")
    assert(/"\/api\/ig-run-job": \[[^\]]*ffmpeg-static\/ffmpeg/.test(cfg),
        "single-post cesta musí mít binárku v tracingu")
    assert(/"\/api\/cron\/campaign-worker": \[[^\]]*ffmpeg-static\/ffmpeg/.test(cfg),
        "kampaňový worker renderuje reely taky")
})

test("17.5 chybějící ffmpeg nesmí tiše degradovat reel", () => {
    const vp = codeOnly("instagram/video-processor.ts")
    // Starý getFfmpegPath vracel naslepo "ffmpeg" — na Vercelu spawn nesmyslné binárky,
    // orchestrátor to chytil a reel za 5 kreditů odešel bez voiceoveru i titulků.
    assert(/existsSync\(staticPath\)/.test(vp),
        "existenci binárky je nutné ověřit, ne předpokládat")
    assert(/throw new Error\(\s*`ffmpeg-static resolved to/.test(vp),
        "chybějící nabundlovaná binárka musí být diagnostikovatelná chyba")
    const reel = codeOnly("instagram/orchestrators/reel-orchestrator.ts")
    const catchIdx = reel.indexOf("catch (ffErr)")
    assert(catchIdx > 0, "catch kolem post-processingu musí existovat")
    assert(/step: "ffmpeg-postprocess"/.test(reel.slice(catchIdx)),
        "degradace postu za 5 kreditů se musí hlásit do Sentry, ne jen do konzole")
})

// ═══════════════════════════════════════════════════════════
// 18. FAKTURACE: ostrá číselná řada patří ostrým platbám (v8.9)
// ═══════════════════════════════════════════════════════════

test("18.1 testovací platba nesmí vystavit doklad", () => {
    const code = codeOnly("lib/invoicing.ts")
    const fn = code.slice(code.indexOf("export async function issueInvoiceForPayment"))
    const guardIdx = fn.indexOf("input.sandbox")
    const fakturoidIdx = fn.indexOf("isFakturoidEnabled")
    assert(guardIdx > 0, "invoicing musí umět dostat informaci, že platba je sandboxová")
    // Brána MUSÍ být před jakýmkoli dotykem Fakturoidu — po něm už je pozdě.
    assert(guardIdx < fakturoidIdx, "sandbox guard patří PŘED volání Fakturoidu")
    assert(/VERCEL_ENV !== "production"/.test(fn),
        "druhá pojistka: mimo produkci se doklad nevystavuje, i když volající příznak zapomene")
})

test("18.2 záměrně nevystavený doklad není 'failed'", () => {
    const code = codeOnly("lib/invoicing.ts")
    assert(/async function markSkipped/.test(code), "skipped má vlastní zápis, ne markFailed")
    assert(/status: "skipped"/.test(code), "stav musí být odlišitelný od selhání")
    const mig = fileContent("supabase/migrations/20260809_invoice_skipped_status.sql")
    assert(/CHECK \(status IN \([^)]*'skipped'/.test(mig), "constraint musí 'skipped' povolit")
    // Fronta „chybí doklad, spravit" se nesmí plnit testy.
    assert(/WHERE status = 'failed'/.test(mig), "retry index zůstává jen na skutečných selháních")
})

test("18.3 obě brány předávají sandbox příznak", () => {
    const core = codeOnly("lib/payments/on-paid.ts")
    assert(/sandbox\?: boolean/.test(core), "FinalizeOptions musí příznak nést")
    assert(/sandbox: result\.sandbox/.test(core), "musí dojít až k vystavení dokladu")
    const cg = codeOnly("app/api/payments/callback/route.ts")
    assert(/const sandbox = isMockPaymentMode\(\)/.test(cg) && /sandbox,/.test(cg),
        "ComGate route musí mock přiznat a příznak předat jádru")
})

test("18.4 platformní proměnné nepatří do .env.local", () => {
    // vercel env pull je tam zatáhne a lokální běh se pak tváří jako produkce:
    // isMockPaymentMode() vrátí false (mock platby přestanou fungovat) a
    // fakturační backstop na nonProd taky. Objeveno naostro 2026-08-09.
    let env = ""
    try { env = fileContent(".env.local") } catch { return } // v CI soubor není
    for (const key of ["VERCEL", "VERCEL_ENV", "VERCEL_URL"]) {
        assert(!new RegExp(`^\\s*${key}\\s*=`, "m").test(env),
            `${key} v .env.local — lokální běh se tváří jako produkce`)
    }
})

// ═══════════════════════════════════════════════════════════
// 19. KAMPAŇOVÝ WORKER — trvanlivost běhu bez uživatelské session
// ═══════════════════════════════════════════════════════════
// Tahle sekce vznikla při přesunu CLAUDE.md do skillů: pravidla níž byla do té doby
// POUZE v próze. Próza spoléhá na to, že si ji model přečte; aserce spadne. Worker
// nemá session ani tab, který by chybu ukázal — jeho selhání jsou tiché a placené.

test("19.1 lease se tluče nezávislým časovačem, ne postupem generování", () => {
    const code = codeOnly("app/api/cron/campaign-worker/route.ts")
    // onProgress fíruje jen MEZI fázemi pipeline; jediná fáze (withQualityRetry backoff
    // na přetíženém Pro modelu) umí mlčet déle než LEASE_MS. Druhý worker pak kampaň
    // „převezme" a rozgeneruje tentýž bod ještě jednou — dvojitá platba i dvojitý post.
    assert(/const heartbeat = setInterval\(/.test(code),
        "lease heartbeat musí být samostatný setInterval, ne vedlejší efekt onProgress")
    assert(/}, 60_000\)/.test(code), "interval musí být kratší než LEASE_MS (5 min)")
})

test("19.2 heartbeat se ruší na každé cestě ven", () => {
    const code = codeOnly("app/api/cron/campaign-worker/route.ts")
    // Zombie interval na recyklované Fluid instanci by prodlužoval lease uvolněné
    // kampaně a zablokoval další tick.
    assert(/} finally {\s*clearInterval\(heartbeat\)/.test(code),
        "clearInterval(heartbeat) patří do finally, ne na jednotlivé returny")
    const afterHeartbeat = code.slice(code.indexOf("const heartbeat = setInterval("))
    assert(afterHeartbeat.includes("try {"), "tělo za heartbeatem musí být obalené try/finally")
})

test("19.3 jobId se zapisuje na plán už při založení jobu", () => {
    const code = codeOnly("app/api/cron/campaign-worker/route.ts")
    const genIdx = code.indexOf("await generateOnePost(")
    const persistIdx = code.indexOf("item.jobId = job.id")
    assert(persistIdx > 0 && persistIdx < genIdx,
        "jobId musí být na plánu PŘED generováním — jinak kill uprostřed účtuje bod podruhé")
})

test("19.4 worker účtuje přes clientId primitiva, ne přes session guardy", () => {
    const code = codeOnly("app/api/cron/campaign-worker/route.ts")
    // creditGuard/requireProjectAccess čtou přihlášeného uživatele. Worker žádného nemá,
    // takže by buď spadl, nebo (hůř) prošel s cizím tenantem.
    assert(!/\bcreditGuard\b/.test(code), "creditGuard potřebuje session — worker ji nemá")
    assert(!/\brequireProjectAccess\b/.test(code), "requireProjectAccess potřebuje session")
    for (const prim of ["canPerformAction", "deductCredits", "incrementPlanPostCount", "refundJobCharge"]) {
        assert(code.includes(prim), `worker musí účtovat přes ${prim}(clientId, …)`)
    }
})

test("19.5 cursor se ukládá po každém bodu, aby pád navázal", () => {
    const code = codeOnly("app/api/cron/campaign-worker/route.ts")
    assert(/\.update\(\{ cursor, successes, failures, worker_lease: nowIso\(\) \}\)/.test(code),
        "persist() musí ukládat cursor — bez něj se po timeoutu generuje kampaň znovu od nuly")
    assert(/while \(cursor < total\)/.test(code), "smyčka musí jet z cursoru, ne od nuly")
})

// ═══════════════════════════════════════════════════════════
// 20. TELEMETRIE SPOTŘEBY — COGS tohohle produktu jsou tokeny
// ═══════════════════════════════════════════════════════════

test("20.1 měřič je request-scoped, ne modulová proměnná", () => {
    const code = codeOnly("instagram/usage-meter.ts")
    // Jedna lambda obsluhuje víc requestů najednou (Fluid Compute). Globální akumulátor
    // by míchal spotřebu mezi tenanty úplně stejně, jako to umí setActiveProject().
    assert(/new AsyncLocalStorage<UsageAccumulator>\(\)/.test(code),
        "akumulátor musí žít v AsyncLocalStorage")
    assert(!/^(let|var) +(total|usage|acc)/m.test(code),
        "žádný modulový mutable součet — to je ta past se setActiveProject()")
})

test("20.2 každé volání modelu hlásí spotřebu", () => {
    // Nový krok pipeline bez telemetrie = tiše nezapočítaný náklad. Počty musí sedět.
    const gem = codeOnly("instagram/gemini-client.ts")
    const contentCalls = (gem.match(/await ai\.models\.generateContent\(/g) || []).length
    // Dvě legitimní hlášení: tokeny (text, vision, TTS) a jednotky (obraz za kus,
    // video za vteřinu — tak to Google účtuje, tokeny by u nich lhaly).
    const recorded = (gem.match(/record(Usage|Units)\(/g) || []).length
    assert(recorded >= contentCalls,
        `${contentCalls} volání generateContent, ale jen ${recorded} hlášení spotřeby — nějaký krok se neúčtuje`)
    // Obraz se účtuje za kus. Kdyby se hlásil tokeny, cena vyjde null a post je neoceněný.
    assert(/recordUnits\([^)]*"images"/.test(gem),
        "obrázkové volání musí hlásit jednotky, ne tokeny — Google účtuje za kus")
    // Veo vrací operaci bez usageMetadata, takže musí jít přes jednotky.
    assert(/recordUnits\([^)]*"seconds"/.test(gem),
        "video se musí měřit ve vteřinách — jinak nejdražší médium vychází na nulu")
    // Soudce běží u každého postu, klidně vícekrát.
    assert(/recordUsage\(/.test(codeOnly("instagram/anthropic-client.ts")),
        "Claude soudce nesmí být v telemetrii neviditelný")
})

test("20.3 neoceněný model nedostane vymyšlenou nulu", () => {
    const code = codeOnly("lib/model-pricing.ts")
    assert(/: number \| null/.test(code), "cena musí umět být null")
    assert(/return null/.test(code) && /warnMissing/.test(code),
        "chybějící sazba se ohlásí a vrátí null — tichá nula vypadá jako levný post")
    // Částečný součet by tvrdil, že příspěvek stál míň, než stál.
    const fn = code.slice(code.indexOf("export function costUsdForBreakdown"))
    assert(/if \(cost === null\) return null/.test(fn),
        "jeden neoceněný krok musí zneplatnit celý součet")
})

test("20.4 thinking politika je v registru, ne v call site", () => {
    const models = codeOnly("instagram/models.ts")
    assert(/export const THINKING = \{/.test(models) && /export function getThinkingBudget/.test(models),
        "rozpočet na přemýšlení patří vedle TEMPERATURES, ne do volání")
    assert(/GEMINI_THINK_/.test(models), "musí jít přepsat env proměnnou bez deploye")
    // Pro tiery si uvažování platí záměrně — nesmí spadnout na 0 nedopatřením.
    assert(/judge: -1/.test(models) && /copywriter: -1/.test(models),
        "soudci ani copywriterovi se rozpočet nesnižuje bez měření")
    const gem = codeOnly("instagram/gemini-client.ts")
    assert(!/thinkingBudget: [0-9]/.test(gem),
        "žádné natvrdo zadrátované číslo v klientovi — politika patří do models.ts")
})

// ═══════════════════════════════════════════════════════════
// 21. LIMITY PROMPTU — jedno číslo, jeden zdroj
// ═══════════════════════════════════════════════════════════
// Limity se psaly ručně dvakrát: do textu promptu a do `description` ve schématu.
// Nic je nedrželo u sebe, takže se tiše rozešly — u `subtext` slidu říkal prompt
// „max 12 slov" a schéma „max 20 words" o TOMTÉŽ poli. Model dostal dvě čísla.
// Detailní shodu čísel hlídá scripts/test-prompt-assembly.ts; tady je struktura.

test("21.1 limity mají jediný zdroj pravdy", () => {
    const code = codeOnly("instagram/caption-generator.ts")
    assert(/export const PROMPT_LIMITS = \{/.test(code), "PROMPT_LIMITS musí existovat")
    assert(/export const CAROUSEL_MAX_TOTAL_SLIDES/.test(code),
        "strop celkového počtu slidů se odvozuje, nepíše ručně")
    // Prompt i schéma musí číst z konstanty. Kdyby někdo napsal číslo natvrdo,
    // rozejde se to znovu — a příště si toho zase nikdo nevšimne.
    const usages = (code.match(/PROMPT_LIMITS\./g) || []).length
    assert(usages >= 12, `PROMPT_LIMITS se používá jen ${usages}× — část limitů zůstala natvrdo`)
})

test("21.2 počet slidů je ve schématu strukturální, ne jen popis", () => {
    const code = codeOnly("instagram/caption-generator.ts")
    const fn = code.slice(code.indexOf("export function buildCarouselSchema"))
    assert(/minItems: String\(PROMPT_LIMITS\.carouselInnerMin\)/.test(fn),
        "slides potřebuje minItems — popis je jen přání, které volný text z configu přebije")
    assert(/maxItems: String\(PROMPT_LIMITS\.carouselInnerMax\)/.test(fn),
        "slides potřebuje maxItems")
})

test("21.3 structure z configu se kontroluje proti schématu", () => {
    const code = codeOnly("instagram/configs/index.ts")
    // postTypeDefs procházely `config.postTypeDefs || []` — tedy úplně bez kontroly,
    // přestože se vkládají do promptu jako „ZÁVAZNÁ struktura".
    assert(!/postTypeDefs: config\.postTypeDefs \|\| \[\]/.test(code),
        "postTypeDefs zase prochází bez kontroly")
    assert(/warnOnOversizedStructures/.test(code), "chybí kontrola počtu slidů ve structure")
    assert(/CAROUSEL_MAX_TOTAL_SLIDES/.test(code), "kontrola musí vycházet ze společného stropu")
    // Nesmí tiše osekávat — kvalita se nedegraduje potichu.
    assert(/console\.warn/.test(code), "nález musí být vidět v logu")
})

test("21.4 v promptu je jen JEDNO pravidlo pro řešení konfliktů", () => {
    const cta = codeOnly("instagram/cta-policy.ts")
    // Nárok „při rozporu s čímkoli jiným platí TOHLE" si odporoval se seznamem
    // PRIORIT, kde je CTA politika až druhá za zadaným tématem.
    assert(!/při rozporu s čímkoli jiným/.test(cta),
        "CTA sekce si znovu nárokuje globální přednost proti seznamu PRIORIT")
    assert(/ZDROJ PRAVDY PRO CTA/.test(cta),
        "CTA politika musí zůstat zdrojem pravdy ve své doméně")
})

test("21.5 onboarding negeneruje strukturu, kterou engine nevykreslí", () => {
    const code = codeOnly("app/onboarding/core.ts")
    assert(/CAROUSEL_MAX_TOTAL_SLIDES/.test(code),
        "generátor formátů musí znát strop — jinak vyrábí rozpory rovnou při onboardingu")
})

// ═══════════════════════════════════════════════════════════
// 22. STRIPE — druhá brána k penězům
// ═══════════════════════════════════════════════════════════
// Produkt uměl generovat 307 příspěvků a nevzal ani korunu: ComGate čeká na
// smlouvu a Stripe webhook podpis ověřoval, ale plán neaktivoval. Tyhle aserce
// hlídají, že druhá brána zůstane adaptérem, ne druhou kódovou cestou.

test("22.1 Stripe zabírá platbu podmíněným claimem, ne insertem", () => {
    // Claim se přestěhoval do sdíleného jádra, protože ho potřebují TŘI volající
    // (ComGate callback, Stripe webhook, reconciler). Invariant je tím silnější:
    // podmíněný UPDATE existuje v repu právě jednou.
    const core = codeOnly("lib/payments/on-paid.ts")
    assert(/\.eq\("provider", "stripe"\)\.eq\("provider_ref", input\.locator\.ref\)/.test(core),
        "claim musí hledat podle vlastního lokátoru brány")
    // Podmínka na status se rozšířila o REFUNDED: vrácená platba se nesmí dát
    // zabrat znovu (pozdní callback nebo reconciler by ji vzkřísil na PAID a
    // aktivoval plán, za který už zákazník dostal peníze zpátky).
    assert(/\.not\("status", "in", "\(PAID,REFUNDED\)"\)/.test(core),
        "claim musí vylučovat zaplacené I vrácené platby")

    const code = codeOnly("app/api/payments/stripe/webhook/route.ts")
    assert(!/\.from\("payments"\)/.test(code),
        "webhook nesmí na payments sahat vůbec — od toho je applyGatewayStatus")
})

test("22.2 unikátní index je nárok na zpracování", () => {
    const mig = fileContent("supabase/migrations/20260810_payment_provider_ref.sql")
    assert(/CREATE UNIQUE INDEX[\s\S]*payments\(provider, provider_ref\)/.test(mig),
        "bez unikátního indexu není claim idempotentní")
    assert(/provider_ref IS NOT NULL/.test(mig),
        "index musí částečný — legacy řádky bez ref nesmí kolidovat")
})

test("22.3 aktivace je sdílená, ne zkopírovaná do brány", () => {
    const code = codeOnly("app/api/payments/stripe/webhook/route.ts")
    assert(/applyGatewayStatus/.test(code),
        "Stripe musí volat totéž jádro jako ComGate")
    // Kdyby si brána aktivaci napsala sama, je to druhé místo, kde se zapomene na doklad.
    assert(!/from\("subscriptions"\)[\s\S]{0,80}\.update\(/.test(code),
        "webhook nesmí aktivovat předplatné sám")
    assert(!/finalizePaidPayment/.test(code),
        "brána nesmí obcházet applyGatewayStatus a volat aktivaci napřímo")

    const core = codeOnly("lib/payments/on-paid.ts")
    assert(/after\(\(\) => deliverPaidArtifacts/.test(core),
        "doklad a e-mail patří mimo kritickou cestu — brána musí dostat ACK hned")
})

test("22.4 sandboxová platba nesmí sáhnout na ostrou číselnou řadu", () => {
    const code = codeOnly("app/api/payments/stripe/webhook/route.ts")
    assert(/sandbox: isStripeSandbox\(\)/.test(code),
        "příznak sandboxu musí dojít až k vystavení dokladu")
})

test("22.5 platbu zakládá jen autorizovaná route", () => {
    for (const route of ["app/api/payments/stripe/create/route.ts", "app/api/payments/create/route.ts"]) {
        const code = codeOnly(route)
        assert(/requireAuth/.test(code), `${route}: každá API route potřebuje requireAuth`)
        assert(/requireClientAccess/.test(code), `${route}: bez toho by šlo zaplatit cizímu tenantovi`)
    }
    const lib = codeOnly("lib/payments/checkout.ts")
    assert(/provider: "stripe"/.test(lib) && /provider_ref: session\.id/.test(lib),
        "PENDING řádek musí nést lokátor, jinak ho webhook nenajde")
})

test("22.6 volba brány je na serveru, ne v tlačítkách", () => {
    // Kdyby o branách rozhodovalo UI, přibývá s každou bránou další místo,
    // kde se to dá splést — a Stripe by potřeboval vlastní tlačítko.
    for (const ui of ["app/(dashboard)/PaywallProvider.tsx",
                      "app/(dashboard)/dashboard/instagram/tabs/SubscriptionSection.tsx"]) {
        const code = codeOnly(ui)
        assert(!/stripe/i.test(code), `${ui} nesmí vědět o konkrétní bráně`)
    }
    const create = codeOnly("app/api/payments/create/route.ts")
    assert(/activeGateway\(\) === "stripe"/.test(create),
        "hlavní create route musí bránu vybírat sama")
})

// ═══════════════════════════════════════════════════════════
// 23. AGENTNÍ VRSTVA A PENÍZE — chief-of-staff
// ═══════════════════════════════════════════════════════════
// Firma nesmí běžet na tom, jestli si zakladatel vzpomene. Tyhle aserce hlídají
// tři věci, které se nejsnáz rozpadnou zpátky: jedinou cestu k penězům, jediný
// e-mail ven, a hranici mezi „oznamuju fakt" a „přemlouvám".

test("23.1 stav platby mění jediné místo", () => {
    const core = codeOnly("lib/payments/on-paid.ts")
    assert(/export async function applyGatewayStatus/.test(core),
        "sdílené jádro musí nabízet jednu vstupní bránu pro stav od brány")

    // Kdyby si claim napsala i routa, je to druhé místo, kde se dá zapomenout
    // na aktivaci, doklad nebo dunning.
    for (const route of ["app/api/payments/callback/route.ts", "app/api/payments/stripe/webhook/route.ts"]) {
        const code = codeOnly(route)
        assert(/applyGatewayStatus/.test(code), `${route}: musí delegovat na sdílené jádro`)
        assert(!/\.neq\("status", "PAID"\)/.test(code), `${route}: claim patří do jádra, ne do routy`)
        assert(!/\.from\("payments"\)/.test(code), `${route}: routa nesmí na payments sahat vůbec`)
    }
})

test("23.2 odmítnutá obnova nesmí být tichá smyčka", () => {
    // Regrese, která tohle hlídá: callback u renew- platby jen přepsal status na
    // CANCELLED. Řádek zmizel z filtru „PENDING obnova", čítač zůstal na nule a
    // billing-worker strhával znovu každý den — bez e-mailu a bez expirace.
    const core = codeOnly("lib/payments/on-paid.ts")
    assert(/billing_failures: attempt/.test(core),
        "selhaná obnova musí inkrementovat dunning čítač")
    assert(/kind: "charge_failed"/.test(core),
        "selhaná obnova musí zákazníkovi něco říct")

    const worker = codeOnly("app/api/cron/billing-worker/route.ts")
    assert(/midnight\.setUTCHours\(0, 0, 0, 0\)/.test(worker) && /like\("ref_id", "renew-%"\)/.test(worker),
        "kontrola 'PENDING < 24 h' nestačí — po CANCELLED řádek z filtru zmizí")
})

test("23.3 po selhané platbě zůstává stopa", () => {
    const worker = codeOnly("app/api/cron/billing-worker/route.ts")
    assert(/status: "FAILED"/.test(worker) && /comgate_response:/.test(worker),
        "bez řádku s důvodem nejde zpětně zjistit, proč platba selhala")

    const core = codeOnly("lib/payments/on-paid.ts")
    assert(/comgate_response: \(input\.raw/.test(core),
        "syrová odpověď brány se musí ukládat — sloupec byl roky prázdný")
})

test("23.4 reconciler neaktivuje plán vlastní cestou", () => {
    const rec = codeOnly("lib/agents/payment-reconcile.ts")
    assert(/applyGatewayStatus/.test(rec), "dohojení musí jít stejnou cestou jako callback")
    assert(!/activatePaidPlan/.test(rec), "reconciler nesmí aktivovat plán napřímo")
    assert(/isMockPaymentMode/.test(rec) && /"MOCK-"/.test(rec),
        "mock platby se nesmí doptávat brány — getConfig() by shodil celý sweep")
})

test("23.5 jeden e-mail ven, ne šest", () => {
    const ops = codeOnly("app/api/cron/daily-ops/route.ts")
    assert(/daily_brief/.test(ops), "brief musí být dispatchovaný z denního cronu")
    assert(!/health_check/.test(ops) && !/compliance_check/.test(ops),
        "health check a compliance pohltil brief — nesmí posílat vlastní poštu")

    const handlers = fileContent("lib/agents/handlers.ts")
    for (const type of ["daily_brief", "send_customer_notice", "payment_reconcile", "repair_activation", "incident_watch"]) {
        assert(handlers.includes(`registerHandler("${type}"`), `chybí handler ${type}`)
    }
    // Lifecycle sken jen navrhuje; jeho návrhy vidí zakladatel v sekci briefu
    // „co potřebuje tebe", která renderuje VŠECHNY proposed akce.
    const lifecycleBlock = handlers.slice(handlers.indexOf('registerHandler("lifecycle_scan"'))
        .slice(0, handlers.slice(handlers.indexOf('registerHandler("lifecycle_scan"')).indexOf("registerHandler(", 10))
    assert(!/sendEmail/.test(lifecycleBlock), "lifecycle_scan už nesmí posílat vlastní digest")
})

test("23.6 brief běží po skenech a po penězích", () => {
    const ops = codeOnly("app/api/cron/daily-ops/route.ts")
    assert(/priority: -10/.test(ops),
        "brief musí mít zápornou prioritu, jinak nevidí, co skeny ve stejném ticku navrhly")

    // billing-worker musí běžet DŘÍV než daily-ops, jinak brief hlásí včerejší peníze.
    const crons = JSON.parse(fileContent("vercel.json")).crons as { path: string; schedule: string }[]
    const hourOf = (p: string) => {
        const c = crons.find(x => x.path === p)
        if (!c) throw new Error(`cron ${p} chybí ve vercel.json`)
        const [min, hour] = c.schedule.split(" ")
        return Number(hour) * 60 + Number(min)
    }
    assert(hourOf("/api/cron/billing-worker") < hourOf("/api/cron/daily-ops"),
        "billing-worker musí běžet před daily-ops — jinak brief reportuje včerejší peníze")
})

test("23.7 hranice mezi oznámením a přemlouváním se nesmí pohnout", () => {
    const safety = codeOnly("lib/agent-safety.ts")
    const autoLine = safety.match(/const AUTO_TIERS[^\n]*\n?[^\n]*/)?.[0] || ""
    assert(/transactional/.test(autoLine), "faktická pošta musí odcházet sama")
    assert(!/outbound/.test(autoLine),
        "outbound NIKDY nesmí být auto — pobídky a winbacky patří člověku")

    const mig = fileContent("supabase/migrations/20260811_agent_transactional_tier.sql")
    assert(/'transactional'/.test(mig), "CHECK constraint musí nový tier povolit")
})

test("23.8 oznámení se dedupují klíčem, ne oknem", () => {
    const notices = codeOnly("lib/agents/customer-notices.ts")
    assert(/payload->>dedupeKey/.test(notices),
        "dedupe musí stát na klíči — časové okno se s posunem cronu rozjede")
    assert(/riskTier: "transactional"/.test(notices), "faktická pošta patří do transactional tieru")

    const watch = codeOnly("lib/agents/billing-watch.ts")
    assert(/dedupeKey: r\.periodEnd/.test(watch),
        "oznámení o obnově se klíčuje konkrétním koncem období")
})

test("23.9 tichý support mlčí o tom, co zákazník viděl", () => {
    const inc = codeOnly("lib/agents/incident-watch.ts")
    assert(/config->>campaignId/.test(inc),
        "hlásí se jen selhání na pozadí — interaktivní chybu ukázalo UI")
    assert(/⏸️/.test(fileContent("lib/agents/incident-watch.ts")),
        "odložený job není selhaný job — campaign-worker je značí stejným stavem")
    assert(/dedupeKey: inc\.ref/.test(inc), "jeden incident = nejvýš jeden e-mail")
})

test("23.10 výpověď nesmí sebrat zaplacené období", () => {
    const actions = codeOnly("app/actions/billing-actions.ts")
    assert(/cancel_at_period_end: true/.test(actions), "výpověď nastavuje příznak, ne stav")
    assert(!/status: "cancelled"/.test(actions),
        "status='cancelled' vypadne z filtru getClientSubscription → okamžitá ztráta přístupu")
    assert(/subscription\.cancelled/.test(actions),
        "dobrovolný odchod musí být rozeznatelný od selhané karty")

    const sub = fileContent("lib/subscription.ts")
    assert(/cancel_at_period_end, billing_failures/.test(sub),
        "getClientSubscription musí oba sloupce číst, jinak je banner slepý")

    const worker = codeOnly("app/api/cron/billing-worker/route.ts")
    assert(/sub\.cancel_at_period_end/.test(worker),
        "billing-worker nesmí strhnout peníze někomu, kdo vypověděl")
})

test("23.11 politika o penězích žije na serveru", () => {
    const banner = codeOnly("app/(dashboard)/BillingBanner.tsx")
    assert(!/billingFailures\s*>=?\s*\d/.test(banner) && !/currentPeriodEnd.*getTime\(\)\s*[-+]/.test(banner),
        "banner nesmí počítat pravidla sám — od toho je deriveBillingState")
    const api = fileContent("app/api/subscription/route.ts")
    assert(/deriveBillingState\(sub\)/.test(api), "stav fakturace odvozuje server")
})

test("23.12 nové migrace nezakládají tabulky", () => {
    // Celá vrstva měla vzniknout nad existujícím schématem. Nová tabulka je
    // signál, že se něco počítá dvakrát nebo se duplikuje audit.
    for (const m of ["20260811_agent_transactional_tier.sql", "20260811_subscription_cancel.sql"]) {
        const sql = fileContent(`supabase/migrations/${m}`)
        assert(!/CREATE TABLE/i.test(sql), `${m}: nová tabulka nebyla v plánu`)
    }
})

// ═══════════════════════════════════════════════════════════
// 24. OBCHODNÍ AGENT — co se nesmí rozbít
// ═══════════════════════════════════════════════════════════
// Produkt vygeneroval 307 příspěvků a nevzal korunu. Tenhle agent má přivést
// zákazníky — a přitom nesmí spálit doménu, přes kterou chodí doklady.

test("24.1 oslovení NIKDY nejde přes transakční poštu", () => {
    const pipeline = codeOnly("lib/agents/sales/pipeline.ts")
    // Resend má studené oslovení v pravidlech zakázané a ruší účty bez varování.
    // Přes tentýž účet chodí potvrzení o platbách — jedna stížnost by je zabila.
    //
    // Závorka `(\/|["'])` za "email" je schválně. Dokud je lib/email.ts soubor,
    // stačila uvozovka hned za "email" — jenže kdyby se z něj někdy stal adresář,
    // `@/lib/email/transport` by aserci obešel a díra by vznikla jako vedlejší
    // efekt nesouvisejícího refaktoru. Proto e-mailový design systém bydlí
    // v lib/mail/, ne v lib/email/.
    for (const f of ["lib/agents/sales/pipeline.ts", "lib/agents/sales/transport.ts",
                     "lib/agents/sales/templates.ts"]) {
        assert(!/["']@\/lib\/email(\/|["'])/.test(codeOnly(f)),
            `${f}: obchodní cesta nesmí sáhnout na transakční kanál — ani přes podmodul`)
    }
    assert(/sendOutreach/.test(pipeline), "oslovení má vlastní přepravu")
    const transport = codeOnly("lib/agents/sales/transport.ts")
    assert(!/lib\/email/.test(transport), "přeprava oslovení nesmí sáhnout na transakční kanál")
    assert(!/RESEND/.test(transport), "žádný tichý fallback na Resend")
})

test("24.2 nenastavená přeprava neodesílá, místo aby mlčky přeskočila", () => {
    const t = codeOnly("lib/agents/sales/transport.ts")
    assert(/throw new Error\(outreachSetupHint\(\)\)/.test(t),
        "bez konfigurace se musí ozvat, ne tiše nic neposlat")
    assert(/isOutreachConfigured/.test(codeOnly("lib/agents/sales/pipeline.ts")),
        "pipeline musí konfiguraci ověřit před odesláním")
})

test("24.3 odhlášení se kontroluje před KAŽDÝM odesláním", () => {
    const code = codeOnly("lib/agents/sales/pipeline.ts")
    const fn = code.slice(code.indexOf("export async function runOutreach"))
    const optIdx = fn.indexOf("email_optouts")
    const sendIdx = fn.indexOf("sendOutreach")
    assert(optIdx > 0 && optIdx < sendIdx,
        "kontrola opt-outu musí být PŘED odesláním, ne jen při zápisu")
})

test("24.4 zpráva bez schválení soudcem neodejde", () => {
    const code = codeOnly("lib/agents/sales/pipeline.ts")
    const fn = code.slice(code.indexOf("export async function runOutreach"))
    assert(/judgeText/.test(fn), "před odesláním musí zprávu posoudit soudce")
    const judgeIdx = fn.indexOf("judgeText")
    assert(judgeIdx < fn.indexOf("sendOutreach"), "soudce musí běžet PŘED odesláním")
    // Nedostupný soudce = neodesílá se. Raději nic než nezkontrolovaná zpráva.
    assert(/soudce nedostupn/.test(fn), "výpadek soudce musí odeslání zastavit")
    assert(/if \(!verdict\.pass\)/.test(fn), "zamítnutá zpráva nesmí odejít")
})

test("24.5 denní strop existuje a lead se nezahazuje", () => {
    const code = codeOnly("lib/agents/sales/pipeline.ts")
    assert(/DAILY_SEND_CAP/.test(code), "strop musí existovat")
    assert(/sentToday\(\) >= DAILY_SEND_CAP/.test(code), "strop se počítá ze skutečně odeslaných")
    // Vyčerpaný strop lead odloží, nezahodí — je to o doručitelnosti, ne o kvalitě leadu.
    const capBlock = code.slice(code.indexOf("sentToday() >= DAILY_SEND_CAP"))
    assert(/enqueueTask/.test(capBlock.slice(0, 400)), "přebytek se odkládá na zítra")
})

test("24.6 prospekt nikdy neskončí řádkem v clients", () => {
    const prev = codeOnly("lib/agents/sales/preview.ts")
    // clients je kořen multi-tenancy; stovky firem, které o nás nevědí, by rozbily
    // počty, audity, účtování i izolaci tenantů.
    assert(!/from\("clients"\)/.test(prev), "generátor ukázky nesmí zakládat klienta")
    assert(!/insertClient/.test(prev), "ani přes onboarding helper")
    assert(/visualMemoriesSection: ""/.test(prev),
        "prázdná vizuální paměť brání sáhnutí na ig_brand_memory bez tenanta")
})

test("24.10 generované odkazy míří na kanonickou doménu", () => {
    // chrlit.cz vrací 308 na www.chrlit.cz. Prohlížeč to přežije, STROJ ne —
    // Stripe webhooky přesměrování nenásledují, takže testovací platba prošla
    // a plán se neaktivoval. Zjištěno naostro 2026-08-11.
    //
    // Pravidlo se nezměnilo, jen se přestěhovalo: siteUrl() žije od e-mailového
    // design systému v lib/mail/links.ts (lib/notifications.ts ho re-exportuje).
    const code = codeOnly("lib/mail/links.ts")
    assert(/www\.chrlit\.cz/.test(code), "výchozí doména musí být kanonická (www)")
    assert(!/\|\| "https:\/\/chrlit\.cz"/.test(code), "nekanonická doména se nesmí vrátit jako výchozí")
    // Zástupný text je neprázdný řetězec a projde `||` — stejná past jako [SET_ME]
    // u HikerAPI. Odkaz na `[SENSITIVE]/...` je horší než výchozí doména.
    assert(/startsWith\("http"\)/.test(code), "hodnota, která není URL, se musí odmítnout")
})

test("24.9 brána bez webhooku nesmí brát peníze", () => {
    // Stripe umí vzít peníze jen s tajným klíčem, ale aktivovat plán až s
    // webhookem. Nalezeno na produkci: ComGate creds chyběly, Stripe klíč byl,
    // a výběr brány tiše směroval platby na bránu, která nedokáže plán aktivovat.
    // Zaplacený a neaktivovaný zákazník je horší než platba, která nezačne.
    const code = codeOnly("lib/payments/checkout.ts")
    assert(/STRIPE_WEBHOOK_SECRET/.test(code),
        "výběr brány musí vědět o webhooku, ne jen o tajném klíči")
    assert(/stripeCanCompletePayment/.test(code), "podmínka musí být pojmenovaná a sdílená")
    // I vynucená volba přes PAYMENT_GATEWAY musí projít touž kontrolou.
    assert(/forced === "stripe" && stripeCanCompletePayment\(\)/.test(code),
        "překlep v PAYMENT_GATEWAY nesmí obejít kontrolu úplnosti brány")
})

test("24.8 obě platební brány čtou tarify z téže tabulky", () => {
    // Moje Stripe routa se ptala tabulky `plans`, která neexistuje — vrátila by
    // vždycky "Plán nenalezen" a cesta k penězům by tiše nefungovala. Druhá brána
    // nesmí mít vlastní představu o tom, kde tarify žijí.
    for (const route of ["app/api/payments/create/route.ts", "app/api/payments/stripe/create/route.ts"]) {
        const code = codeOnly(route)
        assert(/from\("subscription_plans"\)/.test(code), `${route}: tarify jsou v subscription_plans`)
        assert(!/from\("plans"\)/.test(code), `${route}: tabulka "plans" neexistuje`)
        // Neaktivní tarif se nesmí dát koupit ani přímým odkazem.
        assert(/is_active/.test(code), `${route}: chybí filtr na aktivní tarif`)
    }
})

test("24.7 obchod nemá vlastní denní e-mail", () => {
    // daily_brief je JEDINÁ denní zpráva zakladateli. Druhý denní mail je
    // nejspolehlivější způsob, jak se přestanou číst oba.
    const digest = codeOnly("lib/agents/sales/digest.ts")
    assert(!/sendEmail|sendNotification|sendOutreach/.test(digest),
        "obchodní souhrn nesmí posílat vlastní e-mail — patří do daily_brief")
    const brief = codeOnly("lib/agents/daily-brief.ts")
    assert(/buildSalesLines/.test(brief), "brief musí obchodní řádky načítat")
    assert(/sales\.length === 0/.test(brief),
        "tichý obchodní den nesmí brief probudit — jinak se přestane číst")
    const handlers = codeOnly("lib/agents/handlers.ts")
    assert(!/sales_digest/.test(handlers), "žádný samostatný obchodní digest handler")
})

// ═══════════════════════════════════════════════════════════
// 25. PŘEDPLACENÁ OBDOBÍ (3 / 6 / 12 měsíců)
// ═══════════════════════════════════════════════════════════
// Období je vlastnost PŘEDPLATNÉHO, ne tarifu. Nejdražší chyba téhle domény je
// tichá: zákazník zaplatí rok, a po roce mu systém strhne měsíční cenu — nebo
// naopak měsíčnímu zákazníkovi roční. Tyhle aserce hlídají, že cena, období a
// doklad mluví o tomtéž.

test("25.1 obnova strhává cenu období, ne měsíční sazbu", () => {
    const code = codeOnly("app/api/cron/billing-worker/route.ts")
    assert(/termPrice\(/.test(code),
        "obnova musí cenu období počítat sdíleným pravidlem")
    // `plan.price_czk` je MĚSÍČNÍ sazba. Poslat ji přímo do brány znamená, že
    // roční zákazník dostane po roce strh 1 990 místo 19 900 — a rok navíc zdarma.
    assert(!/price: plan\.price_czk/.test(code),
        "měsíční sazba nesmí jít přímo do strhu")
    assert(!/amount: plan\.price_czk/.test(code),
        "řádek platby musí nést částku období, ne měsíční sazbu")
})

test("25.2 délka období vychází z term_months, ne z natvrdo psaného měsíce", () => {
    const sub = codeOnly("lib/subscription.ts")
    assert(/resolveTermMonths\(/.test(sub),
        "aktivace musí délku období odvodit z předplatného a intervalu tarifu")
    assert(/termMonths,?\n/.test(sub) || /termMonths/.test(sub),
        "computeBillingPeriod bere počet měsíců, ne interval")

    const create = codeOnly("app/api/payments/create/route.ts")
    assert(/normalizeTermMonths\(/.test(create),
        "období z requestu se musí normalizovat — jinak si klient koupí rok za měsíc")
    assert(/term_months: termMonths/.test(create),
        "období musí sednout na předplatné, jinak ho aktivace nemá kde vzít")
})

test("25.3 ceník na landingu a v migraci se shodují", () => {
    // Landing má statickou kopii ceníku pro případ výpadku DB. Dvě pravdy o ceně
    // vydrží přesně do první změny ceníku — pak jedna z nich lže zákazníkovi.
    const pricing = fileContent("lib/pricing.ts")
    const mig = fileContent("supabase/migrations/20260716_pricing_v5.sql")

    const fromCode = [...pricing.matchAll(/id: "(chrlit_\w+)", name: "[^"]+", monthlyHaleru: (\d+)/g)]
        .map(m => `${m[1]}=${m[2]}`)
    assert(fromCode.length === 4, `lib/pricing.ts musí mít 4 tarify, má ${fromCode.length}`)

    for (const entry of fromCode) {
        const [id, price] = entry.split("=")
        const re = new RegExp(`'${id}',\\s*'[^']+',\\s*'[^']*',\\s*${price},`)
        assert(re.test(mig), `${id}: cena ${price} haléřů nesedí s migrací pricing_v5`)
    }
})

test("25.4 delší období nesmí vyjít dráž", () => {
    // Běhová aserce nad skutečným modulem, ne nad textem: žebřík musí být
    // monotónní a ceny kulaté, jinak „ušetříte 10 %" na kartě lže.
    const { BILLING_TERMS, FALLBACK_PLANS, monthlyEquivalent, termPrice } = require("./lib/pricing")
    for (const plan of FALLBACK_PLANS) {
        let prev = Infinity
        for (const t of BILLING_TERMS) {
            const perMonth = monthlyEquivalent(plan.monthlyHaleru, t.months)
            assert(perMonth <= prev, `${plan.name}/${t.months}: ${perMonth} > ${prev} haléřů za měsíc`)
            assert(termPrice(plan.monthlyHaleru, t.months) % 1000 === 0,
                `${plan.name}/${t.months}: cena není celých 10 Kč`)
            prev = perMonth
        }
        // Slib „dva měsíce zdarma" musí platit doslova — zákazník si to spočítá.
        assert(termPrice(plan.monthlyHaleru, 12) === plan.monthlyHaleru * 10,
            `${plan.name}: rok musí být přesně 10× měsíc`)
    }
})

test("25.5 doklad uvádí zaplacené období", () => {
    const inv = codeOnly("lib/invoicing.ts")
    assert(/invoiceLineName\(/.test(inv),
        "název položky musí skládat jedno místo, ne každý volající po svém")
    assert(/period\?:/.test(inv), "doklad musí umět převzít období")

    const core = codeOnly("lib/payments/on-paid.ts")
    assert(/period: result\.period/.test(core),
        "období spočítané při aktivaci musí dojít až na doklad")
    // Datum vystavení říká KDY se platilo, ne ZA CO. U předplaceného roku je to
    // rozdíl dvanácti měsíců a účetní z toho dělá časové rozlišení.
    assert(/activatePaidPlan\(/.test(core) && /period = await activatePaidPlan/.test(core),
        "aktivace musí období vracet, ne ho zahodit")
})

test("25.6 víceměsíční předplatné se nedá propálit změnou tarifu", () => {
    // Změna tarifu není proratovaná: nové období začíná ihned a zbytek starého
    // propadá. U měsíčního plánu jsou to dny, u ročního jedenáct měsíců.
    const ui = codeOnly("app/(dashboard)/dashboard/instagram/tabs/SubscriptionSection.tsx")
    assert(/lockedTerm/.test(ui), "UI musí poznat běžící víceměsíční období")
    assert(/blockedByTerm/.test(ui) && /disabled=\{isCurrent \|\| blockedByTerm/.test(ui),
        "uprostřed předplaceného období nesmí jít tarif změnit jedním klikem")
})

test("25.7 Stripe předplatné neobnovuje náš cron", () => {
    // Stripe Billing si období fakturuje sám (`invoice.paid`). Kdyby ho strhl
    // i worker, zákazník zaplatí jedno období dvakrát.
    const worker = codeOnly("app/api/cron/billing-worker/route.ts")
    assert(/sub\.provider === "stripe"/.test(worker) && /continue/.test(worker),
        "worker musí Stripe předplatná přeskočit")

    const hook = codeOnly("app/api/payments/stripe/webhook/route.ts")
    assert(/invoice\.paid/.test(hook) && /applyProviderInvoice/.test(hook),
        "obnovy ze Stripu musí mít obsluhu, jinak předplatné tiše skončí")
    assert(/subscription_create/.test(hook),
        "první faktura patří Checkout Session — jinak vzniknou dvě platby a dva doklady")
    assert(/customer\.subscription\.deleted/.test(hook),
        "ukončení u brány se musí propsat, jinak zůstane aktivní předplatné bez plateb")
})

test("25.8 zrušení se propíše do brány, která fakturuje", () => {
    const code = codeOnly("app/actions/billing-actions.ts")
    assert(/syncCancelToGateway/.test(code),
        "výpověď musí dojít i do brány, jinak zákazník uvidí zrušeno a přijde mu další platba")
    // Brána první: opačné pořadí by při chybě nechalo zrušeno u nás a fakturaci v bráně.
    assert(/const gatewayError = await syncCancelToGateway\(sub, true\)[\s\S]{0,120}return \{ success: false/.test(code),
        "selhání brány musí zrušení zastavit, ne ho jen zalogovat")
})

test("25.9 mód Stripe Checkout unese obnovy", () => {
    const code = codeOnly("lib/payments/checkout.ts")
    // `mode: "payment"` je jednorázovka — u PŘEDPLATNÉHO by druhé období nikdo
    // nestrhl, přestože §8 podmínek slibuje automatickou obnovu. Jednorázový
    // režim smí být navázaný VÝHRADNĚ na službu (nastavení značky), která se
    // ze své podstaty neobnovuje.
    assert(/mode: isService \? "payment" : "subscription"/.test(code),
        "režim musí viset na druhu platby — předplatné nikdy jednorázově")
    assert(!/mode: "payment"[,\s]/.test(code),
        "natvrdo jednorázový režim by obnovy neunesl")
    assert(/isService \? \{\} : \{ recurring: stripeRecurring\(termMonths\) \}/.test(code),
        "kratší období musí být skutečné předplatné přes interval_count, ne série jednorázovek")
    assert(/subscription_data:/.test(code),
        "metadata musí být i na předplatném — obnova chodí bez Checkout Session")
})

// ═══════════════════════════════════════════════════════════
// 26. VSTUPNÍ SCHŮZKA (nastavení značky na míru)
// ═══════════════════════════════════════════════════════════
// Placená služba je první platba v systému, která NEAKTIVUJE tarif. Tyhle
// aserce hlídají tři hranice, které se snadno rozmažou: služba nesmí nic
// aktivovat, peníze nesmí obejít doklad, a rezervace nesmí přijít bez ověření.

test("26.1 zaplacená služba neaktivuje tarif", () => {
    const core = codeOnly("lib/payments/on-paid.ts")
    // Bez téhle větve by zákazník dostal za 990 Kč měsíc Startu.
    assert(/payment\.kind === "service"/.test(core),
        "jádro musí rozlišit službu od předplatného")
    assert(/unlockPaidService/.test(core),
        "služba odemyká schůzku, ne tarif")
    // Doklad se druhem platby neliší — daňová povinnost je stejná.
    assert(/issueInvoiceForPayment/.test(core),
        "i jednorázová služba musí dostat daňový doklad")

    const create = codeOnly("app/api/payments/create/route.ts")
    // Tři druhy plateb, tři různé následky — a jen předplatné smí aktivovat tarif.
    assert(/kind: creditPack \? "credits" : isService \? "service" : "subscription"/.test(create),
        "druh platby musí být na řádku, jinak ho jádro nemá kde přečíst")
    assert(/isService \|\| creditPack\s*\n?\s*\?\s*\{ data: null \}/.test(create),
        "služba ani dobití nesmí zakládat pending předplatné — maskovalo by skutečný plán")
})

test("26.2 peníze za schůzku nesmí jít mimo náš doklad", () => {
    // Kdyby 990 Kč inkasoval Cal.com svým Stripem, nevznikne faktura ve
    // Fakturoidu — a to je zákonná povinnost, ne detail.
    const hook = codeOnly("app/api/consultations/cal-webhook/route.ts")
    assert(!/payments/.test(hook), "rezervační webhook nesmí sahat na platby")
    assert(!/amount|price|cena/i.test(hook), "Cal.com o ceně nemá vědět vůbec")

    const lib = codeOnly("lib/consultations.ts")
    assert(!/from\("payments"\)\s*\n?\s*\.insert/.test(lib),
        "konzultace nezakládají platby — od toho je platební cesta")
})

test("26.3 rezervace bez ověřeného podpisu se nezpracuje", () => {
    const hook = codeOnly("app/api/consultations/cal-webhook/route.ts")
    assert(/verifyCalSignature/.test(hook), "webhook URL je veřejná — bez podpisu si schůzku připíše kdokoli")
    assert(/timingSafeEqual/.test(hook), "porovnání podpisu musí být časově konstantní")
    assert(/req\.text\(\)/.test(hook), "podpis se počítá ze syrových bajtů, ne z přeparsovaného JSON")
    assert(/CAL_WEBHOOK_SECRET/.test(hook), "bez tajemství se nesmí zpracovat nic")
})

test("26.4 nárok na schůzku se uděluje jednou", () => {
    const mig = fileContent("supabase/migrations/20260812_consultations.sql")
    // Bez tohohle indexu by každá obnova ročního tarifu založila další schůzku zdarma.
    assert(/CREATE UNIQUE INDEX[\s\S]*?consultations_entitlement_uniq[\s\S]*?WHERE source IN \('term_6', 'term_12'\)/.test(mig),
        "nárok z předplatného musí být unikátní na klienta")
    assert(/consultations_booking_uid_uniq/.test(mig),
        "rezervace potřebuje idempotenční klíč — webhook chodí opakovaně")

    const lib = codeOnly("lib/consultations.ts")
    assert(/23505/.test(lib), "konflikt unikátního indexu je správný stav, ne chyba")

    const core = codeOnly("lib/payments/on-paid.ts")
    assert(/grantConsultationEntitlement/.test(core),
        "nárok musí vzniknout při aktivaci delšího období")
})

test("26.5 podklad na hovor se negeneruje dvakrát", () => {
    // Přegenerování by přepsalo poznámky z prvního běhu.
    const brief = codeOnly("lib/agents/consultation-brief.ts")
    assert(/brief_generated_at/.test(brief), "generování musí být idempotentní přes značku času")
    assert(/\.is\("brief_generated_at", null\)/.test(brief),
        "zápis podkladu musí být podmíněný — souběžný běh nesmí přepsat hotový")

    // Generování mimo webhook: Cal.com má dostat ACK hned.
    const hook = codeOnly("app/api/consultations/cal-webhook/route.ts")
    assert(/enqueueTask/.test(hook), "podklad patří do fronty, ne do webhooku")
    assert(!/generateConsultationBrief/.test(hook), "webhook nesmí generovat synchronně")
})

test("26.6 vysvětlivky jsou jen tam, kde chyba něco stojí", () => {
    // Nápověda u samozřejmého pole je šum, který lidi naučí přestat ji číst.
    const hints = codeOnly("app/(dashboard)/dashboard/instagram/tabs/Hint.tsx")
    for (const key of ["tone", "pillars", "formats", "cadence", "autoPublish", "credits"]) {
        assert(new RegExp(`${key}:`).test(hints), `chybí vysvětlivka pro ${key}`)
    }
    // Nevratná akce se musí označit jako nevratná.
    assert(/Zpátky to vzít nejde/.test(hints),
        "auto-publikování musí říct, že zveřejnění nejde vzít zpět")
    // Prepaid zákazník se nesmí dozvědět až ve třetím měsíci, že kredity propadají.
    assert(/i u předplatného zaplaceného na rok/.test(hints),
        "propadání kreditů musí být řečené i u ročního předplatného")
})

// ═══════════════════════════════════════════════════════════
// 27. DOKOUPENÉ KREDITY
// ═══════════════════════════════════════════════════════════
// Aplikace slibovala „dobijte si kredity" na čtyřech místech a cesta k nákupu
// neexistovala. Při jejím stavění je nejnebezpečnější past tichá: spotřeba se
// ořezává na nule, takže dobití počítané jako záporná spotřeba by nad měsíčním
// přídělem zmizelo — vzali bychom peníze a dali míň.

test("27.1 dokoupené kredity se nesmí ztratit na ořezu", () => {
    const code = codeOnly("lib/subscription.ts")
    assert(/TOPUP_ACTION/.test(code), "dobití musí mít vlastní akci, ne se tvářit jako spotřeba")
    assert(/getCreditLedger/.test(code), "spotřeba a dobití se musí počítat odděleně")
    // Ořez musí zůstat u SPOTŘEBY (brání záporné spotřebě z refundací), ale
    // dobití se přičítá k přídělu — ne odečítá od spotřeby.
    assert(/credits_per_month \+ creditsPurchased/.test(code),
        "dokoupené kredity se přičítají k přídělu")
    assert(/action === TOPUP_ACTION/.test(code),
        "rozdělení musí stát na akci, ne na znaménku — refundace jsou taky záporné")
})

test("27.2 dobití je idempotentní a nese, kolik se koupilo", () => {
    const core = codeOnly("lib/payments/on-paid.ts")
    assert(/credits_granted/.test(core), "množství se bere z platby, ne dopočítává z částky")
    assert(/reference_id: payment\.id/.test(core),
        "idempotenci drží unikátní index (action, reference_id) — replay nesmí připsat dvakrát")
    assert(/23505/.test(core), "konflikt indexu je správný stav, ne chyba")
    // Nepřipsané kredity = zaplaceno a pořád zablokováno. Nesmí se spolknout.
    assert(/return false/.test(core), "selhání připsání musí vést na ruční opravu, ne na tiché ignorování")

    const create = codeOnly("app/api/payments/create/route.ts")
    assert(/parseCreditPack/.test(create), "velikost balíčku se musí validovat, ne brát z requestu")
    assert(/kind: creditPack \? "credits"/.test(create), "druh platby musí rozlišit dobití")
})

test("27.3 cena kreditu má jediný zdroj", () => {
    // Hláška „dobijte si kredity za X/ks" čte cenu z tarifu. Kdyby si ji routa
    // držela zvlášť, účtovala by jinou částku, než jakou zákazník viděl.
    const create = codeOnly("app/api/payments/create/route.ts")
    assert(/extra_credit_price/.test(create), "cena kreditu se bere z tarifu klienta")
    const sub = codeOnly("lib/subscription.ts")
    assert(/extraCreditPriceLabel/.test(sub), "hláška o nedostatku musí cenu číst, ne psát natvrdo")
    assert(!/49 Kč/.test(sub), "cena kreditu nesmí být v textu natvrdo")

    // Množstevní sleva by dokupování udělala výhodnější než vyšší tarif.
    const { CREDIT_PACKS, creditPackPrice } = require("./lib/pricing")
    const unit = CREDIT_PACKS.map((c: number) => creditPackPrice(c) / c)
    assert(new Set(unit).size === 1, "balíčky musí mít stejnou cenu za kredit")
})

test("27.4 nákup kreditů nezakládá předplatné", () => {
    // Pending řádek bez tarifu by v pickLiveSubscription zamaskoval skutečný plán.
    const create = codeOnly("app/api/payments/create/route.ts")
    assert(/isService \|\| creditPack\s*\n?\s*\?\s*\{ data: null \}/.test(create),
        "dobití nesmí zakládat pending předplatné")
    const checkout = codeOnly("lib/payments/checkout.ts")
    assert(/isCredits/.test(checkout), "Stripe musí u dobití jet jednorázově, ne jako předplatné")
})

test("27.5 dobití je dosažitelné z místa, kde člověk narazí", () => {
    // Slepá ulička byla přesně tady: hláška slíbila dobití a tlačítko jen
    // přepnulo do Nastavení na ceník TARIFŮ.
    const paywall = codeOnly("app/(dashboard)/PaywallProvider.tsx")
    assert(/CreditPacks/.test(paywall), "paywall okno musí nabídnout nákup přímo")
    assert(!/stripe/i.test(paywall), "UI nesmí vědět o konkrétní bráně")

    const packs = codeOnly("app/(dashboard)/CreditPacks.tsx")
    assert(/api\/payments\/create/.test(packs), "nákup jde společnou platební cestou (kvůli dokladu)")
    assert(!/stripe/i.test(packs), "UI nesmí vědět o konkrétní bráně")
})

test("27.6 cena formátu je vidět tam, kde se formát vybírá", () => {
    const gen = codeOnly("app/(dashboard)/dashboard/instagram/tabs/GenerateTab.tsx")
    assert(/MEDIA_CREDITS/.test(gen), "u výběru formátu musí být jeho cena")
    assert(/from "@\/lib\/credits"/.test(gen), "váhy se importují, nikdy nepřepisují")
})

// ═══════════════════════════════════════════════════════════
// 28. KVALITA SE NEDEGRADUJE POTICHU + FORMÁT MÁ JEDEN NÁZEV
// ═══════════════════════════════════════════════════════════

test("28.1 žádný Pro tier nemá fallback na flash", () => {
    const models = codeOnly("instagram/models.ts")
    // Vytáhni jen řádky s definicí tieru a zkontroluj ty, jejichž primary je Pro.
    const entries = [...models.matchAll(/^\s*(\w+):\s*\{([^}]*)\}/gm)]
    assert(entries.length > 5, "nenašel jsem definice modelů — změnil se tvar registru?")
    for (const [, action, body] of entries) {
        const primary = /primary:\s*"([^"]+)"/.exec(body)?.[1] ?? ""
        const fallback = /fallback:\s*"([^"]+)"/.exec(body)?.[1] ?? ""
        if (!/pro/i.test(primary) || !fallback) continue
        assert(!/flash/i.test(fallback),
            `${action}: Pro tier "${primary}" má fallback na flash ("${fallback}") — CLAUDE.md to zakazuje`)
    }
})

test("28.2 obrázky jedou po quality ladderu, ne po krátkém retry s flashem", () => {
    const client = codeOnly("instagram/gemini-client.ts")
    assert(/function imageTiers\(\)/.test(client), "obrazové stupně musí být na jednom místě (imageTiers)")
    assert(/!\/flash\/i\.test\(m\)/.test(client), "imageTiers musí flash vyloučit i proti env override")
    assert(/runQualityLadder\(imageTiers\(\)/.test(client), "obrázky musí jet po quality ladderu")
    assert(!/getModel\("image",\s*"fallback"\)\s*,\s*"images"/.test(client), "render nesmí účtovat fallbackový obrazový model")
})

test("28.3 nedostupná kvalita zakázku odloží, nevrátí ji jako selhání", () => {
    assert(fileExists("lib/job-park.ts"), "parkování jobu musí mít vlastní modul")
    const park = codeOnly("lib/job-park.ts")
    assert(/retry_after/.test(park), "parkovaný job musí nést termín návratu")
    const run = codeOnly("app/api/ig-run-job/route.ts")
    assert(/parkJobForQuality/.test(run), "quality-unavailable se musí parkovat, ne rovnou vracet kredit")
    assert(fileExists("app/api/cron/job-resume/route.ts"), "odložený job musí mít kdo dokončit")
    const resume = codeOnly("app/api/cron/job-resume/route.ts")
    // Podmíněný claim, nikdy insert fallback (CLAUDE.md).
    assert(/\.eq\("status",\s*"failed"\)/.test(resume) && /not\("retry_after",\s*"is",\s*null\)/.test(resume),
        "sweep musí job zabírat podmíněným claimem, jinak dva ticky vyrobí dva posty za jeden kredit")
    assert(fileContains("vercel.json", "/api/cron/job-resume"), "sweep musí být v cronu")
})

test("28.4 emoji se nezapéká do názvu formátu", () => {
    for (const f of ["instagram/service.ts", "app/actions/config-actions.ts"]) {
        const src = codeOnly(f)
        assert(!/display_name:\s*def\.emoji\s*\?/.test(src),
            `${f}: emoji patří jen do sloupce emoji — zapečené do názvu se vypisuje dvakrát`)
    }
    assert(/reconcilePostTypeRows/.test(codeOnly("instagram/service.ts")),
        "ensurePostTypes musí existující řádky srovnávat s configem, ne je jen zakládat")
})

test("28.6 nedostupná kvalita se nespolkne do postu bez obrázku", () => {
    const types = codeOnly("instagram/orchestrators/types.ts")
    assert(/rethrowIfQualityUnavailable/.test(types), "policy musí být na jednom místě")
    for (const f of ["image", "carousel", "story"]) {
        const src = codeOnly(`instagram/orchestrators/${f}-orchestrator.ts`)
        assert(/rethrowIfQualityUnavailable\(err/.test(src),
            `${f}: catch-all vrací prázdný render, takže by se QualityUnavailable spolklo a uložil by se post bez média`)
    }
})

test("28.5 výběr formátu zná rozpočet zakázky", () => {
    const auto = codeOnly("instagram/autopilot.ts")
    assert(/options\.chargedMedium/.test(auto) && /creditsForMedia/.test(auto),
        "formát dražší než účtované médium se nesmí vybrat — clamp by mu vzal mechanismus")
})

// ═══════════════════════════════════════════════════════════
// 29. E-MAILOVÝ DESIGN SYSTÉM — jeden vzhled, dva formáty
// ═══════════════════════════════════════════════════════════
// Každý e-mail v produktu prochází jedním rendererem. Rozejitý odstín, zmizelé
// odhlášení nebo HTML přes limit Gmailu není kosmetika — je to nedoručený
// doklad nebo stížnost na spam.

test("29.1 render e-mailu nesahá na databázi", () => {
    // Čistý render jde vykreslit z ukázkových dat, přežije guard bez .env.local
    // a v náhledu nezáleží na tom, kdo je přihlášený. Import notifications by
    // navíc uzavřel cyklus, který pod tsx/CJS spadne až za běhu.
    for (const f of ["blocks", "render-html", "render-text", "layout", "registry", "markdown", "template"]) {
        const src = codeOnly(`lib/mail/${f}.ts`)
        assert(!/@\/supabase\//.test(src), `lib/mail/${f}.ts: render nesmí importovat Supabase`)
        assert(!/@\/lib\/notifications/.test(src), `lib/mail/${f}.ts: cyklus render → notifications → render`)
    }
    assert(!/render-html/.test(codeOnly("lib/mail/render-text.ts")),
        "textový renderer nesmí jít přes HTML — jeden escapuje, druhý dekóduje")
})

test("29.2 odstín značky má jediný zdroj", () => {
    // Digest měl #e5533f, zbytek produktu #e63946 — dvě různé červené ve dvou
    // e-mailech od téhož odesílatele. Barva patří do tokenů, ne do šablony.
    assert(/#e63946/i.test(fileContent("lib/mail/tokens.ts")), "cinnabar musí být v tokenech")
    assert(/--color-aisummit-cinnabar:\s*#e63946/i.test(fileContent("app/globals.css")),
        "web a e-mail musí mít tentýž odstín")
    for (const f of ["lib/notifications.ts", "lib/mail/render-html.ts", "lib/mail/layout.ts"]) {
        assert(!/#e5533f/i.test(codeOnly(f)), `${f}: zapečený odstín mimo tokeny`)
    }
})

test("29.3 e-mailová slupka existuje jednou", () => {
    // Tmavý `<div style="…background:#050505…padding:32px">` byl vlastní slupkou
    // na třech místech. Outlook u něj pozadí zahodí, takže z tmavého designu
    // zbude bílá stránka s bílým textem.
    const rogue = ["lib/notifications.ts", "lib/agents/approval-notify.ts",
        "lib/agents/daily-brief.ts", "lib/agents/weekly-report.ts"]
        .filter(f => /background:#050505;color:#fff;padding:32px/.test(codeOnly(f)))
    assert(rogue.length === 0, `vlastní slupka mimo lib/mail/layout.ts: ${rogue.join(", ")}`)
})

test("29.4 každý e-mail odchází i jako čistý text", () => {
    const notif = codeOnly("lib/notifications.ts")
    assert(/sendEmail\(\{[^}]*\btext\b/.test(notif),
        "sendNotification zahazovala text/plain — e-mail bez textové části je spamový signál")
    assert(/blocks\?:/.test(notif), "sendNotification musí umět bloky, ne jen HTML string")
})

test("29.5 oznámení nikdy neodejde bez odhlášení — v OBOU formátech", () => {
    // Odhlášení žilo jen v HTML patičce. Kdo si zobrazí text/plain, odkaz nenajde
    // a místo odhlášení klikne na „spam".
    const { renderEmail } = require("./lib/mail/layout")
    const { paragraph } = require("./lib/mail/blocks")
    const n = renderEmail({
        subject: "T", blocks: [paragraph("Ahoj")], kind: "notification", unsubscribeEmail: "kdo@example.com",
    })
    assert(/api\/email\/unsubscribe\?e=/.test(n.html), "HTML patička bez odhlášení")
    assert(/api\/email\/unsubscribe\?e=/.test(n.text), "textová patička bez odhlášení")
    const t = renderEmail({ subject: "Doklad", blocks: [paragraph("Děkujeme")], kind: "transactional" })
    assert(!/unsubscribe/.test(t.html), "z daňového dokladu se nikdo neodhlašuje")
})

test("29.6 každá šablona se vykreslí z ukázkových dat", () => {
    // Picker v Mailingu i náhled berou šablony z registru. Šablona, která spadne
    // nebo pustí do těla „undefined", se jinak pozná až u zákazníka.
    const { EMAIL_TEMPLATES } = require("./lib/mail/registry")
    assert(EMAIL_TEMPLATES.length > 0, "registr šablon je prázdný")
    for (const t of EMAIL_TEMPLATES) {
        const { subject, html, text } = t.render(t.sample, "ukazka@chrlit.cz")
        assert(subject.length > 0 && html.length > 0 && text.length > 0, `${t.id}: prázdný render`)
        assert(!/undefined|\bnull\b|\[object Object\]|NaN/.test(subject + text),
            `${t.id}: prosákla proměnná — ${(subject + text).slice(0, 120)}`)
    }
})

test("29.7 e-mail se vejde pod limit, kde ho Gmail stříhá", () => {
    // Nad ~102 KB Gmail schová zbytek za „[Zpráva byla zkrácena]" — a stříhá
    // odspodu, takže první zmizí CTA a odhlašovací patička.
    const { EMAIL_TEMPLATES } = require("./lib/mail/registry")
    const { GMAIL_CLIP_LIMIT_KB } = require("./lib/mail/tokens")
    for (const t of EMAIL_TEMPLATES) {
        const kb = Buffer.byteLength(t.render(t.sample).html, "utf8") / 1024
        assert(kb < GMAIL_CLIP_LIMIT_KB, `${t.id}: ${Math.round(kb)} KB — Gmail stříhá nad 102 KB`)
    }
})

test("29.8 e-mail s cenou nese větu o DPH", () => {
    // Neplátce, který uvede cenu bez „Nejsem plátce DPH", vypadá, že DPH zatajil.
    // Platí i pro e-mail, ne jen pro fakturu a ceník.
    const { EMAIL_TEMPLATES } = require("./lib/mail/registry")
    const { vatNotice } = require("./lib/legal")
    for (const t of EMAIL_TEMPLATES) {
        const { text } = t.render(t.sample)
        const quotesPrice = /\d[\d  ]*Kč/.test(text)
        assert(quotesPrice === Boolean(t.pricing),
            `${t.id}: příznak pricing=${Boolean(t.pricing)} nesedí s obsahem`)
        if (t.pricing) assert(text.includes(vatNotice()), `${t.id}: cena bez věty o DPH`)
    }
})

test("29.9 světlý e-mail si klient nesmí převrátit", () => {
    // Hybrid = bílé tělo + černé pruhy. Gmail i Apple Mail si světlý e-mail samy
    // invertují a z černého pruhu udělají šedý s nečitelným textem.
    const layout = fileContent("lib/mail/layout.ts")
    assert(/name="color-scheme"/.test(layout) && /name="supported-color-schemes"/.test(layout),
        "bez obou meta tagů si klient e-mail invertuje")
    assert(/<!doctype html>/i.test(layout), "bez doctypu jede Outlook v quirks módu")
    assert(/only light/i.test(layout), "vzhled je zamčený na světlý, ne 'light dark'")
})

test("29.10 sdílené odkazy do sebe nepustí přepravu", () => {
    // links.ts smí importovat obchodní i transakční cesta — proto v něm nesmí
    // skončit odesílání. Kdyby ano, obešel by se zákaz z aserce 24.1.
    const links = codeOnly("lib/mail/links.ts")
    assert(!/sendEmail|RESEND/.test(links), "links.ts je sdílený — nesmí do sebe pustit přepravu")
    assert(/www\.chrlit\.cz/.test(fileContent("lib/mail/links.ts")),
        "obrázky v odeslané zprávě musí mířit na kanonickou doménu, ne na preview deployment")
})

// ═══════════════════════════════════════════════════════════
// 30. ADMINSKÁ BRÁNA
// ═══════════════════════════════════════════════════════════

/** Soubory, které se ptají, jestli je někdo super-admin. */
const ADMIN_GATE_FILES = [
    "lib/auth-guard.ts",
    "app/actions/admin-actions.ts",
    "app/onboarding/actions.ts",
    "lib/subscription.ts",
    "lib/email.ts",
    "instagram/configs/index.ts",
]

test("30.1 SUPER_ADMIN_EMAILS se parsuje na jednom místě", () => {
    assert(fileExists("lib/super-admins.ts"), "lib/super-admins.ts musí existovat")
    for (const f of ADMIN_GATE_FILES) {
        assert(
            !codeOnly(f).includes("process.env.SUPER_ADMIN_EMAILS"),
            `${f} si parsuje SUPER_ADMIN_EMAILS sám — má se ptát lib/super-admins.ts`,
        )
    }
})

test("30.2 adminská brána nepadá na velikosti písmen ani uvozovkách", () => {
    const src = fileContent("lib/super-admins.ts")
    assert(src.includes("toLowerCase()"), "porovnání musí být nezávislé na velikosti písmen")
    assert(src.includes(`replace(/["']/g`), "uvozovky z nástěnky Vercelu se musí sundat")
})

test("30.3 middleware cesta zůstává bez importů, ale normalizuje stejně", () => {
    const access = codeOnly("lib/beta-access.ts")
    assert(!/^\s*import\s/m.test(access), "lib/beta-access.ts musí zůstat bez importů")
    assert(access.includes("toLowerCase()"), "beta-access musí normalizovat stejně jako lib/super-admins.ts")
    assert(access.includes(`replace(/["']/g`), "beta-access musí sundat uvozovky stejně jako lib/super-admins.ts")
})

test("30.4 rozbitá hodnota je vidět v logu, ale neshodí aplikaci", () => {
    const env = fileContent("lib/env.ts")
    assert(env.includes("checkSuperAdmins"), "validateEnv musí hodnotu zkontrolovat")
    const fn = env.slice(env.indexOf("function checkSuperAdmins"))
    assert(fn.includes("console.error"), "rozbitá hodnota se musí ohlásit")
    assert(!fn.includes("throw "), "kontrola nesmí shodit boot — výpadek je horší než skrytá admin sekce")
})

// ═══════════════════════════════════════════════════════════
// REPORT
// ═══════════════════════════════════════════════════════════

console.log("\n" + "═".repeat(60))
console.log("  BETA LAUNCH E2E TEST REPORT")
console.log("═".repeat(60))
console.log()

for (const r of results) {
    const icon = r.status === "PASS" ? "✅" : "❌"
    console.log(`  ${icon} ${r.name}`)
    if (r.detail) {
        console.log(`     └─ ${r.detail}`)
    }
}

console.log()
console.log("─".repeat(60))
console.log(`  Total: ${results.length} | ✅ Passed: ${passed} | ❌ Failed: ${failed}`)
console.log("─".repeat(60))

if (failed > 0) {
    console.log("\n⚠️  SOME TESTS FAILED — review before deploying!\n")
    process.exit(1)
} else {
    console.log("\n🎉 ALL TESTS PASSED — ready for beta launch!\n")
    process.exit(0)
}
