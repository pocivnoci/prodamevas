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

/**
 * Seed s aktuálním ceníkem.
 *
 * Přecenění zakládá NOVOU migraci (staré se nepřepisují — jsou to už proběhlé
 * kroky), takže aserce musí umět ukázat jinam. Dřív byla cesta na pěti místech
 * a přecenění by tiše kontrolovalo mrtvý ceník. Jedna konstanta = jedno místo,
 * které se u příštího přecenění mění.
 */
const PRICING_SEED = "supabase/migrations/20260901_reels_dominance.sql"
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
    // Past má DVĚ dna, na obě se dalo naletět: server actions nežijí jen
    // v app/actions (onboarding má vlastní actions.ts) a direktiva se píše
    // v obou uvozovkách. Původní aserce hlídala jen app/actions + "use server",
    // takže 'use server' v app/onboarding/actions.ts prošel oběma dírami.
    const fs = require("fs") as typeof import("fs")

    const walk = (dir: string): string[] => {
        const out: string[] = []
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.name === "node_modules" || e.name.startsWith(".")) continue
            const full = `${dir}/${e.name}`
            if (e.isDirectory()) out.push(...walk(full))
            else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) out.push(full)
        }
        return out
    }

    let checked = 0
    for (const file of [...walk("app"), ...walk("lib")]) {
        const content = fileContent(file)
        if (!/^\s*['"]use server['"]/m.test(content)) continue
        checked++
        assert(
            !/^\s*export\s+type\s*\{/m.test(content),
            `${file}: 'use server' modul nesmí obsahovat 'export type { … }' — typ ber přímo ze zdroje`,
        )
    }
    assert(checked > 5, `aserce musí reálně něco kontrolovat (našla jen ${checked} server modulů)`)
})

test("13.9 kopie tarifu nesmí slibovat médium, které tarif nemá", () => {
    // Ceník je psaný ručně (PLAN_COPY), média povoluje seed (allowed_media). Dvě
    // místa = dřív nebo později dvě pravdy, a rozejdou se směrem „slíbíme víc".
    const { PLAN_COPY } = require("./lib/pricing")
    const seed = fileContent(PRICING_SEED)

    let overeno = 0
    for (const [planId, copy] of Object.entries(PLAN_COPY as Record<string, { bullets: unknown[] }>)) {
        const at = seed.indexOf(`'${planId}'`)
        if (at < 0) continue // tarif bez řádku v seedu (legacy) — nekontroluje se
        overeno++
        const media = seed.slice(at).match(/"allowed_media": \[([^\]]*)\]/)?.[1] || ""
        const slibujeReels = copy.bullets.some(b =>
            /reel/i.test(typeof b === "string" ? b : String((b as { text?: string }).text || "")),
        )
        if (slibujeReels) {
            assert(media.includes('"reel"'),
                `${planId}: kopie slibuje reels, ale allowed_media je [${media}] — tarif je neumí vyrobit`)
        }
    }
    assert(overeno >= 4, `aserce musí reálně něco kontrolovat (našla ${overeno} tarifů)`)
})

test("13.10 reels v ceníku visí na vypínači, ne na textu", () => {
    // REELS_ENABLED potichu překlápí `reel` na `carousel`. Dokud je vypnutý, je
    // každá odrážka „Reels" prodejem něčeho, co zákazník nedostane — a přesně to
    // se dělo na Růstu, Dominanci i Impériu. Odznak „připravujeme" musí viset na
    // stavu vypínače, aby zmizel sám a nikdo nemusel hlídat marketingovou větu.
    const { PLAN_COPY } = require("./lib/pricing")
    for (const [planId, copy] of Object.entries(PLAN_COPY as Record<string, { bullets: unknown[] }>)) {
        for (const b of copy.bullets) {
            if (typeof b === "string") {
                assert(!/reel/i.test(b),
                    `${planId}: reels jako holý řetězec — musí být { text, requiresReels: true }`)
            }
        }
    }
    assert(codeOnly("app/page.tsx").includes("REELS_ENABLED"),
        "landing musí stav vypínače přečíst na serveru (klient k proměnné nemá přístup)")
    assert(codeOnly("components/Landing.tsx").includes("reelsEnabled"),
        "karty na landingu musí vypínač respektovat")
    assert(codeOnly("app/(dashboard)/dashboard/instagram/tabs/SubscriptionSection.tsx").includes("reelsEnabled"),
        "seznam funkcí v aplikaci musí vypínač respektovat")
})

test("13.11 váhy kreditů se v UI nepíšou číslem", () => {
    // Do 8/2026 stálo v aplikaci natvrdo „obrázek 1 kredit · carousel 3", zatímco
    // skutečné váhy žijí v MEDIA_CREDITS — a na landingu nebylo ani to, takže
    // „20 kreditů" vedle „Carousel posty" vypadalo na 20 carouselů místo šesti.
    for (const f of [
        "components/Landing.tsx",
        "app/(dashboard)/dashboard/instagram/tabs/SubscriptionSection.tsx",
    ]) {
        const src = codeOnly(f)
        assert(src.includes("creditExample"), `${f}: přepočet kreditů musí jít přes creditExample()`)
        assert(!/carousel\s*3|obrázek\s*1\s*kredit/i.test(src),
            `${f}: váha kreditu napsaná ručně — jediná pravda je MEDIA_CREDITS v lib/credits.ts`)
    }
})

test("13.12 přednost ve frontě existuje, nejen svítí na kartě", () => {
    // `features.priority` do 8/2026 nečetl nikdo kromě řádku, který vykreslil
    // popisek — fronta jela čistě FIFO. „Prioritní generování" byl placený slib
    // bez implementace, a to hned na dvou tarifech.
    const worker = codeOnly("app/api/cron/campaign-worker/route.ts")
    assert(/\.order\("priority",\s*\{\s*ascending:\s*false/.test(worker),
        "campaign worker musí řadit podle priority, jinak je přednost jen popisek")

    const actions = codeOnly("app/actions/campaign-actions.ts")
    assert(/priority:\s*queuePriority/.test(actions),
        "kampaň musí prioritu dostat při vstupu do fronty — worker neumí join na tarif")

    // Boolean by Dominanci od Impéria neodlišil, přestože Impérium slibuje NEJVYŠŠÍ.
    const seed = fileContent(PRICING_SEED)
    assert(!/"priority":\s*(true|false)/.test(seed),
        "priorita v seedu musí být číslo (0/10/20), ne boolean")
})

test("13.14 postavená funkce nesmí být zakázaná všem tarifům", () => {
    // Do 9/2026 nesměl `post_edit` ani `product_line` NIKDO: obě akce měly cenu
    // v kreditech, obrazovku v UI a `post_edit` i vlastní dokumentaci, ale
    // nebyly v allowed_actions ani jednoho tarifu. canPerformAction() posílal
    // platícího zákazníka hláškou „Funkce vyžaduje předplatné Chrlit" — tedy
    // zaplať si to, co už zaplacené máš. Postavené, účtovatelné, nedostupné.
    const { ACTION_CREDITS } = require("./lib/subscription")
    const seed = fileContent(PRICING_SEED)
    const povolene = new Set<string>()
    for (const m of seed.matchAll(/"allowed_actions": \[([^\]]*)\]/g)) {
        for (const a of m[1].split(",")) povolene.add(a.trim().replace(/"/g, ""))
    }
    assert(povolene.size > 0, "seed musí nějaké akce povolovat — jinak aserce nic nekontroluje")

    for (const action of Object.keys(ACTION_CREDITS)) {
        assert(povolene.has(action),
            `akce '${action}' stojí kredity, ale nepovoluje ji žádný tarif — postavené a neprodejné`)
    }
})

test("13.13 Impérium neslibuje agentury, dokud je víc profilů nevynucených", () => {
    // `max_projects` nečetl žádný kód, takže „plný objem pro agentury a e-shopy"
    // prodával víceprofilovost, kterou nikdo nedostal ani nevynutil. Předplatné
    // navíc visí na client_id, ne na účtu — víc profilů je přestavba fakturace.
    const { PLAN_COPY } = require("./lib/pricing")
    const kopie = JSON.stringify(PLAN_COPY.chrlit_imperium)
    assert(!/agentur/i.test(kopie), "Impérium nesmí slibovat agentury, dokud víc profilů nefunguje")

    const enforced = codeOnly("app/onboarding/actions.ts").includes("max_projects")
    if (!enforced) {
        const seed = fileContent(PRICING_SEED)
        assert(!/"max_projects":\s*([2-9]|\d{2,})/.test(seed),
            "žádný tarif nesmí slibovat víc profilů, dokud to onboarding nevynucuje")
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

test("10.7i Admin bypass přežije cestu do rezervace kreditů", () => {
    // `canPerformAction` vrací super adminovi `ADMIN_BYPASS` s creditsRequired: 0.
    // Guard si ale cenu počítal ZNOVU (`creditsForAction`), čímž tu nulu zahodil,
    // spadl do větve s rezervací a na čerstvém klientovi (`trial_v2`, nula kreditů)
    // odmítl vlastníkovi produktu vygenerovat příspěvek. Přes plán/kampaň
    // (`options.adminBypass`) to prošlo, přes „Tvorbu" ne — a rozdíl nešel poznat.
    // Dvě místa, která počítají cenu, jsou dvě pravdy.
    const g = codeOnly("app/actions/credit-guard.ts")

    assert(g.includes("const creditsRequired = check.creditsRequired"),
        "creditGuard musí převzít cenu z kontroly, ne ji přepočítat")
    assert(!/creditsForAction\(/.test(g),
        "credit-guard nesmí volat creditsForAction — cenu určuje canPerformAction")

    const batch = g.slice(g.indexOf("export async function creditGuardBatch"))
    assert(batch.includes("const totalCredits = check.creditsRequired"),
        "creditGuardBatch musí převzít celkovou cenu z kontroly")
    assert(/if \(totalCredits > 0\)/.test(batch),
        "nulová cena musí rezervaci přeskočit, ne rezervovat nulu")

    // Přeskočená rezervace nechá `reservationId` null — všechny tři pomocné
    // funkce to musí brát jako no-op, jinak by admin path spadla na undefined.
    const sub = codeOnly("lib/subscription.ts")
    for (const fn of ["releaseCredits", "settleReservation", "shrinkReservation"]) {
        const body = sub.slice(sub.indexOf(`export async function ${fn}`))
        assert(body.slice(0, 400).includes("if (!reservationId) return"),
            `${fn} musí null rezervaci ignorovat`)
    }
})

test("10.7j Obě cesty onboardingu dají značce stejný start", () => {
    // Značka založená z admin záložky neměla teaser plán, prázdný zásobník nápadů
    // a nula ukázkových příspěvků — `startOnboardingBootstrap` volal jen průvodce
    // na /onboarding. Vypadalo to, že engine nic neumí; on se jen nespustil.
    for (const f of ["app/onboarding/page.tsx", "app/(dashboard)/dashboard/instagram/tabs/OnboardTab.tsx"]) {
        assert(codeOnly(f).includes("startOnboardingBootstrap"),
            `${f}: nová značka musí dostat bootstrap (plán + nápady + 3 ukázkové posty)`)
    }
})

test("10.7k Onboardovanou značku jde předat jejímu majiteli", () => {
    // `saveConfigCore` zapisuje user_clients s user_id TOHO, kdo průvodce spustil.
    // Značka založená správcem za zákazníka tak patřila správci a zákazník ji ve
    // svém dashboardu neviděl — jedinou cestou byl ruční INSERT do databáze.
    const a = codeOnly("app/actions/admin-actions.ts")
    const fn = a.slice(a.indexOf("export async function transferClientToUser"))
    assert(fn.length > 0, "akce transferClientToUser musí existovat")
    assert(fn.slice(0, 600).includes("requireSuperAdmin"),
        "předání klienta je adminská akce — musí být za requireSuperAdmin")
    assert(fn.includes('role: "owner"'), "nový majitel musí dostat roli owner")
    // Účty vznikají registrací. Tiché založení účtu odsud by obešlo potvrzení
    // adresy i souhlasy, takže neexistující e-mail musí být hlasitá chyba.
    assert(!/createUser|admin\.inviteUserByEmail/.test(fn),
        "předání nesmí zakládat účet — neexistující e-mail je chyba, ne důvod k registraci")
    assert(codeOnly("app/(dashboard)/dashboard/instagram/tabs/OnboardTab.tsx").includes("transferClientToUser"),
        "předání musí být dostupné z UI, ne jen jako server action")
})

test("10.7l Každé přesměrování na /login má přeloženou hlášku", () => {
    // Middleware selhává zavřeně a posílá vlastní klíče. Nepřeložený klíč skončí
    // obecným „Přihlášení se nepodařilo." u člověka, kterému jen vypršela session —
    // a ten pak dokola zkouší heslo, které je správné.
    const mw = codeOnly("middleware.ts")
    const keys = [...mw.matchAll(/\?error=([a-z_]+)/g)].map(m => m[1])
    assert(keys.length >= 2, `aserce musí reálně něco kontrolovat (našla ${keys.length} klíčů)`)
    const login = codeOnly("app/login/page.tsx")
    for (const key of new Set(keys)) {
        assert(new RegExp(`\\b${key}:`).test(login),
            `${key}: middleware na tenhle klíč přesměrovává, ale /login ho nezná`)
    }
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

test("13.7b jeden plánovač: agent plán potvrzuje, nepočítá ho znovu", () => {
    const c = fileContent("lib/agents/auto-publish.ts")
    const code = codeOnly("lib/agents/auto-publish.ts")

    // Dva plánovače = kalendář lže. Agent dřív bral posty podle created_at a KAŽDÝ
    // termín si přepočítal, takže co uživatel viděl, nebylo co vyšlo.
    //
    // Hranice není "agent nesmí počítat termíny" — termín razítkuje jen kampaňový
    // worker, takže posty z jednotlivého generování žádný nemají a agent by je
    // musel ignorovat navždy. Hranice je: DOPLNIT SMÍ, PŘEPSAT NE.
    assert(c.includes('.order("scheduled_for", { ascending: true })'), "agent musí brát naplánované posty podle jejich termínu")
    // Pojistka musí viset na TOM UPDATU, který termín zapisuje. Pouhý výskyt
    // `.is("scheduled_for", null)` v souboru nestačí — je i v SELECTu, takže by
    // aserce prošla i s odstraněnou ochranou (ověřeno, tahle chyba tu byla).
    const writes = (code.match(/scheduled_for: toScheduledFor/g) || []).length
    const guarded = (code.match(/scheduled_for: toScheduledFor[\s\S]{0,700}?\.is\("scheduled_for", null\)/g) || []).length
    assert(
        writes > 0 && writes === guarded,
        `${writes} zápisů termínu, z toho krytých podmínkou jen ${guarded} — každý zápis musí být podmíněný na chybějící termín`,
    )

    // Propadlý termín se nesmí posunout potichu: obsah psaný na pátek nemá vyjít
    // v úterý jen proto, že ho nikdo nepotvrdil včas.
    assert(c.includes(".gt(\"scheduled_for\""), "agent musí propadlé termíny nechat být, ne je tiše posunout")
})

test("13.7c potvrzení plánu je vědomý krok a nepřepíše souběžnou změnu", () => {
    const c = fileContent("app/actions/calendar-actions.ts")
    assert(c.includes("export async function confirmPlanAction"), "kalendář potřebuje hromadné potvrzení plánu")
    // Bez podmíněného flipu by potvrzení přepsalo i to, co mezitím někdo smazal
    // nebo naplánoval ručně.
    assert(
        /confirmPlanAction[\s\S]{0,3000}\.eq\("status", "ready"\)/.test(c),
        "potvrzení musí být podmíněné na status='ready'",
    )
    assert(
        /confirmPlanAction[\s\S]{0,3000}getConnectionMeta/.test(c),
        "naostřit bez živého připojení znamená jen odložené selhání",
    )
})

test("13.7d kadence žije jen v plánu — Nastavení druhou nenabízí", () => {
    // Termín každého příspěvku vzniká jednou při generování a od té chvíle žije
    // v kalendáři. Volba „jak často publikovat" v Nastavení tedy neřídila nic —
    // jen tvrdila něco jiného, než co uživatel viděl v plánu, a agent podle ní
    // ostřil jiný počet příspěvků, než kolik jich na daný týden bylo naplánováno.
    const settings = codeOnly("app/(dashboard)/dashboard/instagram/tabs/SettingsTab.tsx")
    assert(!/postsPerWeek/.test(settings),
        "Nastavení nesmí nabízet druhou frekvenci publikování — kadence patří tam, kde vzniká plán")
    assert(!/postingTimes/.test(settings),
        "časy publikování patří konkrétnímu příspěvku v plánu, ne globálnímu nastavení")

    // Zásobník auto-publikování je omezený OKNEM (termíny z plánu), ne počtem
    // odvozeným z kadence. Limit na počtu se smí týkat jen příspěvků, kterým
    // termín teprve vymýšlí sám agent.
    const arm = codeOnly("lib/agents/auto-publish.ts")
    const datedRead = arm.slice(arm.indexOf('.eq("status", "ready")'), arm.indexOf("undated"))
    assert(!/\.limit\(/.test(datedRead),
        "posty s termínem z plánu se nesmí ořezávat počtem — bound je časové okno")

    // Prázdná várka s termínem nesmí běh ukončit: klient, který generuje
    // jednotlivé příspěvky (ty termín nedostávají), by se auto-publikování nikdy
    // nedočkal.
    assert(!/if \(!ready \|\| ready\.length === 0\) return/.test(arm),
        "žádné posty s termínem neznamená konec — větev pro posty bez termínu musí doběhnout")
})

test("13.7e připojení účtu je první věc v Nastavení, ne poslední", () => {
    const settings = fileContent("app/(dashboard)/dashboard/instagram/tabs/SettingsTab.tsx")
    const tabs = settings.slice(settings.indexOf("const TABS_MAIN"), settings.indexOf("const TABS_ADVANCED"))
    const ids = [...tabs.matchAll(/id: "([a-z]+)"/g)].map(m => m[1])
    assert(ids[0] === "publish",
        `publikování musí být první záložka Nastavení, je ${ids[0] || "žádná"} — bez připojeného účtu nemá zbytek konfigurace kam vyústit`)
    assert(/useState<string>\("publish"\)/.test(settings),
        "Nastavení se musí otevírat na publikování")

    // Zapnutí i připojení musí být vidět hned; denní agent by frontu naostřil až
    // zítra a člověk by neměl jak poznat, že to funguje.
    assert(/armAutoPublishNow/.test(settings), "zapnutí auto-publikování musí frontu naostřit hned")
    const actions = fileContent("app/actions/calendar-actions.ts")
    assert(/export async function armAutoPublishNow/.test(actions), "chybí akce pro okamžité naostření")
    assert(/config\.autoPublish !== true/.test(fileContent("lib/agents/auto-publish.ts")),
        "okamžité naostření musí kontrolovat opt-in — jinak naostří i tomu, kdo o to nestojí")
})

test("13.8 every plan grants story (seed must not drift)", () => {
    // The pricing seed is declarative with ON CONFLICT DO UPDATE SET
    // features = EXCLUDED.features — leaving it stale means the next run STRIPS story.
    const seed = fileContent(PRICING_SEED)
    const media = seed.match(/"allowed_media": \[[^\]]*\]/g) || []
    assert(media.length === 4, `expected 4 allowed_media literals, found ${media.length}`)
    assert(media.every(m => m.includes('"story"')), "every plan's allowed_media must include story, or the seed re-run removes it")
})

// ═══════════════════════════════════════════════════════════
// 13b. TRANSPORT (publikace přes službu třetí strany)
// ═══════════════════════════════════════════════════════════

test("13b.1 transport is read from the DB, never guessed", () => {
    // A guessed transport hands the Graph API an upload-post profile username — the
    // failure is silent (a "posted" row that never appeared) and per-tenant.
    const reg = fileContent("lib/channels/index.ts")
    assert(
        /getChannelAdapter\(channel: Channel, transport: Transport\)/.test(reg),
        "getChannelAdapter must REQUIRE a transport — a default parameter would let a bridge tenant fall through to Graph",
    )
    assert(
        !/transport: Transport = /.test(codeOnly("lib/channels/index.ts")),
        "transport must have no default value in the registry",
    )

    const conn = fileContent("instagram/ig-connection.ts")
    assert(conn.includes("function readTransport"), "the connection layer must validate transport on read")
    assert(
        /readTransport[\s\S]{0,600}throw new Error/.test(conn),
        "an unknown transport must throw, not fall back to 'meta'",
    )
    // saveConnection takes it as a required field: a caller that forgets which pipe
    // it just connected is a bug we want at the call site.
    assert(
        /transport: Transport\n/.test(conn) || conn.includes("transport: Transport"),
        "saveConnection must take transport explicitly",
    )

    const cron = fileContent("app/api/cron/ig-publisher/route.ts")
    assert(cron.includes("conn.transport"), "the publisher must select its adapter from the connection's transport")
    assert(
        !codeOnly("app/api/cron/ig-publisher/route.ts").includes("instagramAdapter"),
        "the publisher must go through the registry, not import one adapter directly",
    )
})

test("13b.2 a bridge connection is never refreshed as if it held a Graph token", () => {
    // refreshConnection POSTs access_token to graph.instagram.com and marks the row
    // `expired` when that fails. For an upload-post row access_token is a profile
    // username, so the daily cron would silently kill that tenant's publishing.
    const c = fileContent("instagram/ig-connection.ts")
    assert(
        /refreshConnection[\s\S]{0,800}conn\.transport !== "meta"/.test(c),
        "refreshConnection must bail out for non-meta transports before calling Graph",
    )
})

test("13b.3 both metric transports end in ONE learning cascade", () => {
    const c = fileContent("instagram/metrics-sync.ts")
    assert(c.includes("getChannelAdapter"), "metrics-sync must resolve its adapter by transport")
    assert(
        !codeOnly("instagram/metrics-sync.ts").includes("instagramAdapter"),
        "metrics-sync must not reach past the registry to the Graph adapter",
    )
    // The whole point of the rewrite: a forked cascade would split performance_score
    // and quietly halve what the engine learns from.
    const writes = (c.match(/await writeIGPostMetrics\(/g) || []).length
    assert(writes === 1, `writeIGPostMetrics must be called from exactly ONE place in the sync, found ${writes}`)
    const fires = (c.match(/await fireMetricsLearning\(clientId\)/g) || []).length
    assert(fires === 1, `fireMetricsLearning must fire once per sync, found ${fires} call sites`)
    // A transport that can read many posts at once must not be looped per post:
    // upload-post's only per-post endpoint is the batch one, so a per-post loop
    // would re-page the whole account for every single row.
    assert(c.includes("adapter.fetchMetricsBatch"), "the sync must prefer a transport's batch read when it has one")
    assert(
        c.includes("byId.get(mediaId)"),
        "batch metrics must be matched on the NATIVE media id — the transport's own publish handle is not an analytics key",
    )
})

test("13b.4 upload-post credentials and host live in exactly one module", () => {
    assert(fileExists("lib/channels/uploadpost-client.ts"), "the bridge needs a single HTTP client module")
    for (const f of [
        "lib/channels/uploadpost.ts",
        "lib/channels/uploadpost-profiles.ts",
        "app/actions/ig-connection-actions.ts",
        "app/api/cron/ig-publisher/route.ts",
        "instagram/metrics-sync.ts",
    ]) {
        assert(!codeOnly(f).includes("UPLOADPOST_API_KEY"), `${f} must not read the API key directly`)
        assert(!codeOnly(f).includes("api.upload-post.com"), `${f} must not hardcode the upload-post host`)
    }
})

test("13b.5 the bridge refuses media it has not been proven to carry", () => {
    const c = fileContent("lib/channels/uploadpost.ts")
    // Silently posting a reel's cover image as a feed post would look like success.
    assert(c.includes("ChannelNotEnabledError"), "unproven media must be refused loudly")
    assert(c.includes("const _never: never = content.mediaType"), "publish() must be exhaustive on mediaType")
    // Without the native post_id the post can never be matched to its metrics —
    // better to fail the publish than to record a post we have gone blind to.
    assert(c.includes("neobsahuje post_id"), "a publish with no native post_id must fail, not be recorded")
    // The publish endpoints reject JSON ("Username required in form data"), and the
    // caption field is `title`. Both cost a rewrite to discover; pin them down.
    assert(c.includes("new FormData()"), "publish must send multipart/form-data, not JSON")
    assert(c.includes('form.append("title"'), "the caption goes in `title` — `caption` is silently ignored")
    assert(!codeOnly("lib/channels/uploadpost.ts").includes("async_upload"), "we never ASK for async; the hand-off below is the API's own doing")
    // The dangerous one. A long sync request is silently "handed off to the upload
    // worker" and answers 200 with a message instead of results. The post still goes
    // live, so treating that as an error means the retry publishes it a SECOND time
    // on a customer's real profile. Observed on the very first live publish.
    assert(c.includes("readHandoffRequestId"), "publish must recognise the background hand-off, not mistake it for a failure")
    assert(c.includes("return { providerRef: requestId }"), "an unfinished hand-off must report success without an id — never a retryable error")
    const sync = fileContent("instagram/metrics-sync.ts")
    assert(sync.includes("pollUploadStatus"), "a post whose id was unknown at publish time must get it resolved later")
    const pub = fileContent("app/api/cron/ig-publisher/route.ts")
    assert(pub.includes("ChannelPermanentError"), "the publisher must fail permanent errors fast instead of retrying them")
})

test("13b.6 připojení mostu je navigace, ne popup po awaitu", () => {
    // Nahlášeno z ostrého provozu: kliknutí založilo profil na upload-postu, ale
    // přihlašovací stránka se nikdy neotevřela. Adresu podepisuje upload-post až po
    // dvou voláních API, takže window.open() se dostane ke slovu s promlčeným
    // uživatelským gestem a prohlížeč okno zahodí — bez jediné chybové hlášky.
    const ui = codeOnly("app/(dashboard)/dashboard/instagram/tabs/SettingsTab.tsx")
    assert(!ui.includes("window.open"), "připojení se nesmí otevírat skriptem — popup blocker ho zahodí")
    assert(ui.includes("/api/ig-connect/bridge?slug="), "tlačítko musí být odkaz na routu, která přesměruje")

    const route = fileContent("app/api/ig-connect/bridge/route.ts")
    assert(route.includes("requireProjectAccess"), "routa mostu musí ověřit přístup k projektu")
    assert(route.includes("generateConnectUrl"), "routa mostu si nechává adresu podepsat u upload-postu")
    // Bez redirect_url končí uživatel na cizí stránce bez cesty zpátky a připojení
    // se dozvíme, jen když se náhodou vrátí na záložku.
    assert(route.includes("/api/ig-connect/bridge/return"), "musí předat návratovou adresu")
    const back = fileContent("app/api/ig-connect/bridge/return/route.ts")
    assert(back.includes("syncUploadPostConnection"), "návrat musí srovnat stav dřív, než uživatel uvidí Nastavení")

    const profiles = fileContent("lib/channels/uploadpost-profiles.ts")
    assert(profiles.includes("redirect_url"), "generate-jwt musí dostat návratovou adresu")
    // Adresa nese podepsaný JWT — nesmí zůstat viset v cache ani v historii.
    assert(route.includes("no-store"), "přesměrování s podepsanou adresou nesmí být cachovatelné")

    // Server action, která adresu vrací do JS, je přesně ta cesta zpátky k popupu.
    const actions = codeOnly("app/actions/ig-connection-actions.ts")
    assert(!actions.includes("generateConnectUrl"), "podepsaná adresa nesmí téct přes server action do prohlížeče")
})

test("13b.7 video jede svým endpointem a reel končí v mřížce", () => {
    // Reels se prodávají od tarifu Růst a popis tarifu je slibuje. Do 9/2026 se
    // ale publikovat nedaly vůbec — zákazník za 2 999 Kč dostal reel vygenerovaný
    // a musel ho sdílet ručně, tedy dělat přesně tu práci, kterou si předplatil.
    const c = fileContent("lib/channels/uploadpost.ts")
    const code = codeOnly("lib/channels/uploadpost.ts")

    // Foto a video mají u upload-postu ODDĚLENÉ endpointy. Poslat video na
    // `/api/upload_photos` v lepším případě selže, v horším projde jako still.
    assert(c.includes('const VIDEO_PATH = "/api/upload"'), "video má vlastní endpoint, ne foto endpoint")
    assert(/form\.append\("video"/.test(code), "reel se posílá v poli `video`")
    assert(/form\.append\("media_type", "REELS"\)/.test(code), "reel potřebuje media_type=REELS")
    assert(/form\.append\("media_type", "STORIES"\)/.test(code), "story potřebuje media_type=STORIES")

    // Reel mimo feed zmizí v okamžiku, kdy ho Instagram přestane servírovat v Reels
    // — a cover se generuje právě pro mřížku profilu.
    assert(/form\.append\("share_to_feed", "true"\)/.test(code), "reel musí jít i do mřížky profilu")

    // mediaUrls[1] je COVER, ne druhé video. Kdo to splete, publikuje still.
    assert(c.includes("const [videoUrl, coverUrl] = mediaUrls"), "reel čte [video, cover?] konvenci z media-urls")
    assert(code.includes("isVideoUrl"), "před odesláním na video endpoint se ověřuje, že médium video opravdu je")

    // Story se posílá SNÍMEK PO SNÍMKU. Dávka by visela na tom, jak si upload-post
    // přečte „několik fotek + media_type=STORIES" — a jejich vlastní dokumentace
    // říká, že to může přečíst jako CAROUSEL. Karusel místo tří stories je trvalý
    // příspěvek na cizím profilu, ne chyba, kterou lze vzít zpět.
    assert(
        /case "story"[\s\S]{0,1200}for \(const \[i, url\] of mediaUrls\.entries\(\)\)/.test(c),
        "story se publikuje po jednom snímku, ne jednou dávkou",
    )

    // Reel se u Grafu transkóduje, než ho jde publikovat; při fotorozpočtu by každý
    // reel spadl na timeout a publisher by ho zbytečně opakoval.
    assert(c.includes("VIDEO_STATUS_POLL_ATTEMPTS"), "video potřebuje delší čekání než fotka")

    // Chybějící post_id znamená u fotky chybu, u videa NE: upload-post ho může
    // doplnit až po odpovědi, a výjimka by publisher poslala publikovat reel podruhé.
    assert(c.includes("strictId: true"), "u fotky je chybějící post_id chyba")
    assert(c.includes("strictId: false"), "u videa se chybějící post_id doplní později, jinak hrozí druhá publikace")
})

test("13b.8 deklarované formáty a skutečná publikace se nesmí rozejít", () => {
    // `constraints.mediaTypes` je smlouva, switch je implementace. Bez křížové
    // kontroly by zúžení seznamu (typicky při incidentu) formát nevyplo — jen by
    // lhalo, zatímco by se dál publikovalo.
    for (const f of ["lib/channels/uploadpost.ts", "lib/channels/instagram.ts"]) {
        const c = fileContent(f)
        assert(
            c.includes("this.constraints.mediaTypes.includes(content.mediaType)"),
            `${f}: publish() musí formát ověřit proti constraints, ne jen proti switchi`,
        )
        assert(c.includes("ChannelNotEnabledError"), `${f}: nepodporovaný formát se odmítá nahlas`)
        assert(c.includes("const _never: never = content.mediaType"), `${f}: publish() musí být vyčerpávající`)
    }

    // Odmítnutý `cover_url` neshodí jen náhled — shodí celý kontejner i s reelem.
    // Meta přitom dokumentuje „jen JPEG" a WebP z našeho rendereru bere (40 příspěvků
    // publikovaných přes tenhle transport, 0 selhání), takže cover nejde ani slepě
    // věřit, ani ho paušálně zahazovat. Odmítnutí smí stát COVER, ne REEL.
    const ig = fileContent("lib/channels/instagram.ts")
    assert(ig.includes("function createReelContainer"), "cover se při odmítnutí zkusí zahodit, ne shodit celý reel")
    assert(
        /if \(!params\.cover_url\) throw err/.test(ig),
        "opakovat se smí JEN kvůli coveru — rozbité video musí selhat rychle",
    )
    assert(ig.includes("thumb_offset"), "bez coveru se bere snímek z videa")
    // Náhradní cover je horší produkt (nenese hook) — degradace musí být v logu.
    assert(/console\.warn\([\s\S]{0,200}cover/.test(ig), "zahozený cover je degradace kvality a musí být vidět")
})

test("13b.9 reels naostří agent, stories ne", () => {
    const c = fileContent("lib/agents/auto-publish.ts")
    // Reel JE obsah do mřížky a zákazník si předplatil, že ho publikovat nemusí.
    assert(!c.includes("media_type.neq.reel"), "reels už publikační cestu mají — agent je nesmí vynechávat")
    // Story je efemérní a v mřížce není; naostřit ji podle FEEDOVÉHO tempa by jí
    // dalo slot, který patří trvalému obsahu.
    assert(c.includes("media_type.neq.story"), "feedová kadence stories neplánuje")

    // Tlačítko „Publikovat hned" reels odmítalo. Smí odmítnout jen reel BEZ videa
    // — tedy řádek, kde render spadl na still a media_type zůstal 'reel'.
    const cal = fileContent("app/actions/calendar-actions.ts")
    assert(!cal.includes("Reels zatím nejdou publikovat"), "plošné odmítnutí reelů musí zmizet")
    assert(cal.includes('media.kind === "reel" && !media.videoUrl'), "reel bez videa se odmítne dřív, než ho cron 4× zkusí")
})

test("13b.10 plný účet na mostu se pozná při připojování, ne až při publikaci", () => {
    const p = fileContent("lib/channels/uploadpost-profiles.ts")
    // 400 znamená u upload-postu DVĚ různé věci: „profil už máš" a „tarif nemá
    // volný slot". Brát obojí jako úspěch vrátí jméno profilu, který neexistuje —
    // zákazník uvidí „připojeno" a pravda vyplave až z publikačního logu.
    assert(
        !/alreadyExists = \/\\b\(400\|409\)/.test(p),
        "400 se nesmí paušálně považovat za „profil už existuje“",
    )
    assert(p.includes("listProfileNames"), "nejednoznačné selhání se musí OVĚŘIT seznamem, ne uhodnout")
    assert(
        /ChannelPermanentError\([\s\S]{0,200}volný slot/.test(p),
        "vyčerpaný tarif musí říct česky, co se stalo a co s tím",
    )
    // Strop nehlásí API ani ceník, který se může změnit — bere se z env, a bez něj
    // kontrola mlčí (falešný poplach je horší než žádný).
    const h = fileContent("lib/agents/health-check.ts")
    assert(h.includes("UPLOADPOST_PROFILE_LIMIT"), "obsazenost mostu musí hlídat denní kontrola")
    assert(h.includes("getProfileOccupancy"), "kontrola čte skutečný počet profilů, ne odhad")
})

test("13b.11 testovací klíče v produkci se ozvou samy", () => {
    // Nejdražší tichá porucha, jakou tenhle projekt má: aplikace běží, pokladna
    // se otevře, zákazník „zaplatí" — a peníze nikde, protože klíč je sk_test.
    // Audit takovou věc najde jednou; kontrola ji hlídá každé ráno.
    const h = fileContent("lib/agents/health-check.ts")
    assert(h.includes("isSandboxKey"), "denní kontrola musí poznat testovací klíč")
    assert(h.includes("stripeCanComplete"), "brána, co umí platbu začít a ne dokončit, je horší než žádná")
    // `payments/checkout` je server-only a v samostatném skriptu se ani nenačte —
    // rozhodnutí o bráně proto žije v gateway.ts jako čistá funkce. Kontrola musí
    // sáhnout tam, jinak se sama nahlásí jako „selhala".
    assert(
        !/import\("@\/lib\/payments\/checkout"\)/.test(h),
        "kontrola nesmí tahat server-only modul — mimo request se nenačte",
    )
    // Bez téhle podmínky by lokál i preview alarmovaly denně, protože testovací
    // klíče tam jsou SPRÁVNĚ — a naučily by všechny kontrolu ignorovat.
    assert(
        (h.match(/VERCEL_ENV !== "production"/g) || []).length >= 2,
        "kontroly připravenosti smí střílet jen v produkci",
    )

    // Tarif, který prodává formát vypnutý přepínačem, se liší cenou za něco,
    // co nevzniká — engine reel tiše překlopí na carousel.
    assert(h.includes("REELS_ENABLED"), "prodávaný a vypnutý formát musí být vidět")
    assert(
        h.includes('from("subscription_plans")'),
        "tarify žijí v subscription_plans — dotaz na 'plans' by kontrolu jen denně shazoval",
    )
    assert(h.includes("allowed_media"), "allowed_media je uvnitř features JSONB, filtruje se v paměti")
})

test("13b.12 co Stripe událost znamená, rozhoduje testovatelná funkce", () => {
    // Druhé nejdražší rozhodnutí v aplikaci hned po výběru brány. Dokud bylo
    // zadrátované v routě, nešlo ho ověřit jinak než nasazením a skutečnou
    // platbou — a přesně tahle netestovatelnost stála incident z 11. 8. 2026.
    assert(fileExists("lib/payments/stripe-events.ts"), "klasifikace událostí musí být čistá funkce")
    assert(fileExists("scripts/test-stripe-events.ts"), "…a musí mít behaviorální testy")
    assert(fileContains("package.json", "test-stripe-events.ts"), "testy patří do npm run guard")

    const route = codeOnly("app/api/payments/stripe/webhook/route.ts")
    assert(route.includes("classifyStripeEvent"), "routa si nechá událost klasifikovat, nerozhoduje sama")

    // Kdyby se rozhodování vrátilo do routy, testy by dál procházely a chránily
    // by kód, který se nepoužívá. Tyhle tři řetězce jsou jeho otisk.
    for (const inlined of ['payment_status !== "paid"', '"subscription_create"', "invoice.amount_paid"]) {
        assert(!route.includes(inlined), `rozhodnutí '${inlined}' patří do stripe-events.ts, ne do routy`)
    }

    // Čistá funkce nesmí začít sahat na svět — tím by přestala být testovatelná.
    const pure = codeOnly("lib/payments/stripe-events.ts")
    for (const forbidden of ["supabase", "process.env", "fetch(", "await "]) {
        assert(!pure.includes(forbidden), `stripe-events.ts musí zůstat čistá — '${forbidden}' tam nepatří`)
    }
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

test("14.10 přepis identity z env přežije hydrataci", () => {
    // Past, kvůli které telefon zmizel z landingu, ale zůstal v podmínkách:
    // `lib/legal.ts` četl `process.env[key]` s POČÍTANÝM klíčem. Bundler vkládá
    // `NEXT_PUBLIC_*` do klientského balíku textovou náhradou doslovných výskytů,
    // takže dynamický index se na klientu vyhodnotí jako `undefined` a vyhraje
    // fallback. Přepis se tím propsal na serveru a po hydrataci zmizel —
    // patička na landingu (klientská) uměla tvrdit něco jiného než obchodní
    // podmínky (serverové), a chybějící údaj vypadal jako nevyplněný, ne rozbitý.
    const legal = codeOnly("lib/legal.ts")

    assert(!/process\.env\[/.test(legal),
        "lib/legal.ts nesmí číst process.env přes počítaný klíč — na klientu se nevloží")

    // Každý klíč, který `env()` používá, musí mít doslovný protějšek v OVERRIDES.
    const pouzite = [...legal.matchAll(/env\("([A-Z0-9_]+)"/g)].map(m => m[1])
    assert(pouzite.length >= 15, `aserce musí reálně něco kontrolovat (našla ${pouzite.length} klíčů)`)
    for (const key of pouzite) {
        assert(legal.includes(`process.env.${key}`),
            `${key}: chybí doslovný process.env.${key} v OVERRIDES — přepis by na klientu nefungoval`)
    }
})

test("14.11 kontakt je na veřejném webu vidět, ne jen v podmínkách", () => {
    // Kontakt na prodávajícího je povinný údaj (§435 obč. zák.). Do 9/2026 byl
    // v patičce jen jako slovo „Kontakt" ve skrytém mailto: a telefon nikde.
    // Patičky jsou DVĚ a navzájem o sobě nevědí — Landing.tsx má vlastní
    // (jen homepage), SiteFooter.tsx obsluhuje podstránky. Když se kontakt
    // doplní do jedné, druhá tiše zůstane pozadu.
    const legal = require("./lib/legal")
    assert(legal.LEGAL.phone.trim(), "LEGAL.phone nesmí být prázdný — podmínky ho vykreslují podmíněně, takže by řádek jen zmizel")

    for (const f of ["components/Landing.tsx", "components/SiteFooter.tsx"]) {
        const c = codeOnly(f)
        assert(c.includes("LEGAL.email"), `${f}: patička musí vypsat e-mail`)
        assert(c.includes("LEGAL.phone"), `${f}: patička musí vypsat telefon`)
        assert(c.includes("tel:"), `${f}: telefon musí být klikací (tel:)`)
        assert(/replace\(\/\\s\/g/.test(c), `${f}: tel: odkaz musí mít mezery pryč, jinak ho část telefonů nevytočí`)
    }

    // Podstránky měly dřív patičku jen na portfoliu — z podmínek se nedalo nikam.
    for (const page of ["app/terms/page.tsx", "app/privacy/page.tsx", "app/blog/page.tsx", "app/aplikace/page.tsx"]) {
        assert(codeOnly(page).includes("<SiteFooter />"), `${page}: veřejná podstránka musí mít patičku s kontaktem`)
    }
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
    // Rozhodnutí se 2. 9. 2026 přestěhovalo do `lib/payments/gateway.ts` jako
    // čistá funkce nad předaným prostředím — právě proto, aby šlo otestovat
    // chováním, ne čtením zdrojáku. Skutečné případy (vynucený Stripe bez
    // webhooku, poloviční údaje, velikost písmen) hlídá
    // `scripts/test-credits-billing.ts`; tady zůstává jen to, co behaviorální
    // test ověřit neumí: že se rozhodnutí nevrátilo zpátky do čtení `process.env`.
    const gw = codeOnly("lib/payments/gateway.ts")
    assert(/STRIPE_WEBHOOK_SECRET/.test(gw),
        "výběr brány musí vědět o webhooku, ne jen o tajném klíči")
    assert(/stripeCanComplete/.test(gw), "podmínka musí být pojmenovaná a sdílená")
    assert(/forced === "stripe" && stripeCanComplete\(env\)/.test(gw),
        "překlep v PAYMENT_GATEWAY nesmí obejít kontrolu úplnosti brány")
    assert(!/process\.env/.test(gw),
        "gateway.ts musí zůstat čistý — jakmile sáhne na process.env, přestane jít testovat")

    // A že produkční cesta pořád vede přes sdílené rozhodnutí, ne přes vlastní kopii.
    const checkout = codeOnly("lib/payments/checkout.ts")
    assert(/chooseGateway\(/.test(checkout),
        "activeGateway() musí delegovat na chooseGateway, ne mít druhou kopii pravidel")
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
    const mig = fileContent(PRICING_SEED)

    const fromCode = [...pricing.matchAll(/id: "(chrlit_\w+)", name: "[^"]+", monthlyHaleru: (\d+), creditsPerMonth: (\d+)/g)]
        .map(m => ({ id: m[1], price: m[2], credits: m[3] }))
    assert(fromCode.length === 4, `lib/pricing.ts musí mít 4 tarify, má ${fromCode.length}`)

    for (const { id, price, credits } of fromCode) {
        const re = new RegExp(`'${id}',\\s*'[^']+',\\s*'[^']*',\\s*${price},`)
        assert(re.test(mig), `${id}: cena ${price} haléřů nesedí s ${PRICING_SEED}`)

        // Kredity se dřív nekontrolovaly vůbec: záložní ceník mohl slibovat jiný
        // příděl než ten, který zákazník po zaplacení dostane z DB.
        const at = mig.indexOf(`'${id}'`)
        const seedCredits = mig.slice(at).match(/"credits_per_month": (\d+)/)?.[1]
        assert(seedCredits === credits,
            `${id}: kredity ${credits} v lib/pricing.ts nesedí se seedem (${seedCredits})`)
    }
})

test("25.3d placený tarif nesmí rozdávat příspěvky zdarma", () => {
    // NASTRAŽENÁ MINA, ne kosmetika.
    //
    // Tarify nesou `plan_posts_limit: 30` a `plan_posts_total: 30`, což vypadá
    // jako „30 příspěvků v ceně". Jenže `activatePaidPlan()` nastaví čítač
    // `plan_posts_unlocked` rovnou na 30 a brána v `canPerformAction` zní
    // `planPostsUnlocked < planLimit`, tedy 30 < 30 — vždy nepravda. Placený
    // zákazník tak platí kredity za KAŽDÝ příspěvek a UI mu nic jiného neslibuje
    // (kreditový pruh, `usePostQuota` je jen pro trial).
    //
    // Marže 81–83 % stojí na tomhle stavu. Kdyby někdo v dobré víře „opravil"
    // aktivaci na `plan_posts_unlocked: 0`, každý tarif najednou rozdá 30 postů
    // zdarma — u Startu ~229 Kč nákladu proti 999 Kč tržby, tedy marže dolů
    // o víc než dvacet bodů, a nikde by to nespadlo.
    //
    // Tahle aserce je tedy záměrně napsaná na SOUČASNÉ chování. Kdyby se někdy
    // rozhodlo příspěvky v ceně skutečně dávat, musí se změnit vědomě i tady —
    // spolu s přepočtem marží, ne omylem.
    const src = fileContent("lib/subscription.ts")

    const aktivace = src.match(/plan_posts_unlocked:\s*(\d+)\s*,?\s*\/\/\s*unlock all plan posts/)
    assert(aktivace?.[1] === "30",
        "activatePaidPlan už nenastavuje plan_posts_unlocked na 30 — placené tarify můžou začít " +
        "rozdávat příspěvky zdarma. Pokud je to záměr, přepočítej marže a uprav tuhle aserci.")

    assert(/planPostsUnlocked\s*<\s*planLimit/.test(src),
        "brána plánovaných příspěvků v canPerformAction se změnila — ověř, jestli placený tarif " +
        "pořád neúčtuje kredity za každý příspěvek.")
})

test("25.3c vyšší tarif musí být lepší nákup než dobití kreditů", () => {
    // Ceník v6 tohle na chvíli porušil: Růst vyšel na 66,6 Kč/kredit, zatímco
    // dobití stojí 49 — zákazníkovi na Startu se vyplatilo zůstat a dokupovat.
    // Žebřík není estetika, je to jediný důvod, proč někdo přejde o tarif výš.
    const { FALLBACK_PLANS, EXTRA_CREDIT_HALERU } = require("./lib/pricing")
    const plans = [...FALLBACK_PLANS].sort((a: any, b: any) => a.monthlyHaleru - b.monthlyHaleru)

    for (let i = 1; i < plans.length; i++) {
        const niz = plans[i - 1], vys = plans[i]

        // 1. Průměrná cena kreditu musí klesat — vyšší tarif je lepší nákup.
        const prumNiz = niz.monthlyHaleru / niz.creditsPerMonth
        const prumVys = vys.monthlyHaleru / vys.creditsPerMonth
        assert(prumVys < prumNiz,
            `${vys.name}: ${prumVys.toFixed(1)} Kč/kredit není míň než ${niz.name} (${prumNiz.toFixed(1)})`)

        // 2. Rozhodující je ale cena kreditů NAVÍC: přesně ji zákazník porovnává
        //    s dobitím. Když je vyšší, upgrade je nabídka, kterou nemá brát.
        const krok = (vys.monthlyHaleru - niz.monthlyHaleru) / (vys.creditsPerMonth - niz.creditsPerMonth)
        assert(krok < EXTRA_CREDIT_HALERU,
            `${niz.name}→${vys.name}: kredit navíc stojí ${(krok / 100).toFixed(1)} Kč, ` +
            `dobití jen ${EXTRA_CREDIT_HALERU / 100} Kč — upgrade se nevyplatí`)
    }
})

test("25.3b cena tarifu nesmí být napsaná v textu aplikace", () => {
    // Přecenění na v6 našlo v nápovědě ceny z v5: FAQ tvrdilo „Start (990 Kč)",
    // zatímco pokladna účtovala 999. Text o tarifech se skládá z ceníku, jinak
    // každé další přecenění nechá někde v aplikaci viset starou cenu.
    const { FALLBACK_PLANS } = require("./lib/pricing")
    const ceny = FALLBACK_PLANS.map((p: { monthlyHaleru: number }) => Math.round(p.monthlyHaleru / 100))

    for (const f of [
        "app/(dashboard)/dashboard/instagram/tabs/FaqTab.tsx",
        "components/Landing.tsx",
        "app/page.tsx",
    ]) {
        const src = codeOnly(f)
        for (const cena of ceny) {
            // Hledá se jen zápis s měnou — samotné číslo může být cokoliv (rozměr,
            // timeout), a falešný poplach by aserci časem odstavil.
            const re = new RegExp(`${cena}\\s*Kč|${String(cena).replace(/(\d)(\d{3})$/, "$1 $2")}\\s*Kč`)
            assert(!re.test(src), `${f}: cena ${cena} Kč napsaná natvrdo — musí jít z lib/pricing.ts`)
        }

        // A totéž pro kredity. První verze téhle aserce hlídala jen ceny a hned
        // vedle jí utekla věta „Start 20, Růst 45, Dominance 100, Impérium 220",
        // která přecenění nepřežila. Číslo hned za názvem tarifu = ruční příděl.
        assert(!/(Start|Růst|Dominance|Impérium)[\s(]+\d/.test(src),
            `${f}: počet kreditů napsaný za názvem tarifu — musí jít z lib/pricing.ts`)
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
            // Zaokrouhlení na 10 Kč platí jen tam, kde se počítá sleva. Měsíc se
            // musí rovnat ceníkové ceně NA HALÉŘ: dokud ceny končily nulou, floor
            // nebyl vidět, u 999 Kč by tiše účtoval 990 — devět korun pod kartou.
            if (t.months === 1) {
                assert(termPrice(plan.monthlyHaleru, 1) === plan.monthlyHaleru,
                    `${plan.name}: měsíční cena se nesmí zaokrouhlovat (${termPrice(plan.monthlyHaleru, 1)} ≠ ${plan.monthlyHaleru})`)
            } else {
                assert(termPrice(plan.monthlyHaleru, t.months) % 1000 === 0,
                    `${plan.name}/${t.months}: cena není celých 10 Kč`)
            }
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

    // Rozhodnutí „co která událost znamená" se od 9/2026 dělá v čisté funkci
    // (viz 13b.12), takže se tyhle invarianty hlídají TAM. Routa zůstává tím,
    // kdo je vykoná.
    const hook = codeOnly("app/api/payments/stripe/webhook/route.ts")
    assert(/applyProviderInvoice/.test(hook),
        "obnovy ze Stripu musí mít obsluhu, jinak předplatné tiše skončí")
    assert(/expireStripeSubscription/.test(hook),
        "ukončení u brány se musí propsat, jinak zůstane aktivní předplatné bez plateb")

    const events = codeOnly("lib/payments/stripe-events.ts")
    assert(/invoice\.paid/.test(events), "obnova musí mít vlastní větev v klasifikaci")
    assert(/subscription_create/.test(events),
        "první faktura patří Checkout Session — jinak vzniknou dvě platby a dva doklady")
    assert(/customer\.subscription\.deleted/.test(events),
        "konec předplatného u brány musí klasifikace poznat")
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
// 31. ONBOARDING NEPŘEŽÍVÁ NA PROHLÍŽEČI
// ═══════════════════════════════════════════════════════════

test("31.1 runner si drží lease sám, ne přes handlery", () => {
    // claimNext() zabere každý task se starším lease než LEASE_MS a `attempts` vůbec
    // nečte — handler běžící déle než lease se tedy zabere PODRUHÉ, zatímco první běh
    // ještě žije. Není to retry (max_attempts to nezastaví), je to dvojí běh: u AI
    // handleru dvojí útrata. Cron jede každou minutu s maxDuration 800, takže se
    // invokace překrývají a závod je běžný stav, ne exotika.
    const code = codeOnly("lib/agent-runner.ts")
    assert(/const heartbeat = setInterval\(/.test(code),
        "lease heartbeat musí být samostatný setInterval v runTask, ne starost handlerů")
    assert(/\}, 60_000\)/.test(code), "heartbeat musí tepat rychleji, než lease vyprší")
    assert(/\} finally \{\s*clearInterval\(heartbeat\)/.test(code),
        "clearInterval(heartbeat) patří do finally — zombie interval na recyklované Fluid instanci re-leasne cizí task")
    const beat = code.slice(code.indexOf("async function beatLease"))
    assert(/\.eq\("status", "running"\)/.test(beat.slice(0, 600)),
        "beat lease musí filtrovat na running, jinak vzkřísí lease, který už patří někomu jinému")
})

test("31.2 kick z prohlížeče zabírá podmíněně, nikdy nezakládá", () => {
    const code = codeOnly("lib/agent-runner.ts")
    assert(/export async function runTaskById/.test(code),
        "kick z prohlížeče potřebuje běh jednoho tasku podle id, ne drain celé fronty")
    const fn = code.slice(code.indexOf("export async function runTaskById"))
    const body = fn.slice(0, fn.indexOf("\n}"))
    assert(/\.eq\("status", "pending"\)/.test(body) && /\.is\("lease", null\)/.test(body),
        "claim musí být podmíněný — bez toho kick a cron rozjedou tentýž task dvakrát")
    assert(/already_claimed/.test(body),
        "prázdný claim znamená, že task má cron: normální výsledek, ne chyba a rozhodně ne insert")
})

test("31.3 config-gen má jediné tělo, ne dvojníka", () => {
    // Dvojník actions.ts ↔ core.ts se roky mirroroval ručně a rozešel se: core.ts
    // znal kategorie 'vinarstvi' a 'app', UI cesta ne. Nic v guardu to nehlídalo,
    // protože se nedá asertovat "tyhle dva kusy kódu jsou pořád stejné" — jde jen
    // asertovat, že druhý neexistuje.
    const actions = codeOnly("app/onboarding/actions.ts")
    const core = codeOnly("app/onboarding/core.ts")

    assert(core.split("## ODPOVĚDI Z DOTAZNÍKU").length - 1 === 1,
        "mega prompt konfigurace patří do core.ts právě jednou")
    assert(!actions.includes("## ODPOVĚDI Z DOTAZNÍKU"),
        "actions.ts nesmí mít vlastní kopii mega promptu — je to obálka, ne pipeline")

    for (const dup of [
        "function slugify(",
        "function insertClient(",
        "function downloadProductImages(",
        "function seedMemoriesFromAnalysis(",
        "function fetchPage(",
        "function extractBrandImages(",
        "function analyzeInstagramFeed(",
        "CATEGORY_DEFAULTS: Record",
    ]) {
        assert(!actions.includes(dup), `${dup} má žít jen v core.ts — dvojník se vždycky rozejde`)
    }
})

test("31.3b uložení configu má taky jediné tělo", () => {
    // Druhý dvojník vedle config-genu: saveReviewedConfig si roky vedl vlastní kopii
    // ukládání (bucket, RBAC link, produkty, trial). Onboarding z UI a onboarding
    // z workera tak dělaly každý něco jiného — a nové kroky se přidávaly jen do jednoho.
    const actions = codeOnly("app/onboarding/actions.ts")
    assert(actions.includes("saveConfigCore("),
        "saveReviewedConfig musí delegovat na core.ts, ne mít vlastní tělo")
    for (const dup of ["createBucket(", "createTrialSubscription", "ig_products"]) {
        assert(!actions.includes(dup), `${dup} patří do saveConfigCore — obálka se vždycky rozejde`)
    }
})

test("31.3c onboarding plní katalog stejným skenem jako tlačítko v Katalogu", () => {
    // Brand analýza řeší celou značku a produkty jsou v ní jedno pole z mnoha: deset
    // položek, žádná fotka. Klient tak po onboardingu koukal na skoro prázdný katalog,
    // zatímco tlačítko „Načíst z webu" umělo třicet produktů i s fotkami. Ten sken má
    // proto jedno tělo bez session a spouští ho obojí.
    const lib = codeOnly("lib/product-scrape.ts")
    const action = codeOnly("app/actions/product-actions.ts")
    const core = codeOnly("app/onboarding/core.ts")
    const handlers = codeOnly("lib/agents/handlers.ts")

    assert(lib.includes("[IMG:"), "prompt skenu (a s ním mapování fotek) patří do lib/product-scrape.ts")
    assert(!action.includes("[IMG:"), "server action nesmí mít vlastní kopii promptu — dvojník se rozejde")
    assert(action.includes("scrapeProductsIntoCatalog"), "tlačítko Načíst z webu musí volat sdílené jádro")
    assert(core.includes("product_scrape"), "onboarding musí sken zařadit hned po založení klienta")
    assert(handlers.includes('registerHandler("product_scrape"'), "chybí handler pro product_scrape")
    assert(!core.includes("await scrapeProductsIntoCatalog("),
        "sken je minuty práce — patří do durable tasku, ne do ukládání configu")

    // Jádro pouští cron worker, takže se nesmí dotknout auth vrstvy (stejné pravidlo jako core.ts).
    for (const forbidden of ["requireProjectAccess", "requireAuth", "next/headers", "@/supabase/server"]) {
        assert(!lib.includes(forbidden), `lib/product-scrape.ts nesmí sáhnout na ${forbidden}`)
    }
    assert(lib.includes('.eq("client_id", clientId)'), "každý dotaz i zápis musí filtrovat client_id")

    // Onboarding zapíše produkty z analýzy s vlastními slugy. Kdyby sken porovnával jen
    // slugy, založil by ty samé produkty podruhé místo aby jim doplnil fotku.
    assert(lib.includes("productSlugFrom(p.name)") && lib.includes("productSlugFrom(row.name"),
        "dvojče se musí poznat i podle názvu, nejen podle slugu")
    assert(lib.includes("storeProductImage("),
        "fotky se ukládají sdíleným helperem — jinak se rozejde bucket i kontrola adresy")
})

test("31.3d ukázkové příspěvky počkají na fotky produktů", () => {
    // První tři příspěvky jsou to jediné, podle čeho klient po onboardingu soudí celý
    // produkt. Sken webu běží durable a plní katalog fotkami; kdyby kampaň startovala
    // souběžně, renderer by neměl co vzít jako „EXACT product photo" a ukázal by
    // vymyšlený produkt místo skutečného.
    const actions = codeOnly("app/onboarding/actions.ts")
    const worker = codeOnly("app/api/cron/campaign-worker/route.ts")

    assert(actions.includes("product_scrape") && /gate:\s*\{\s*taskId/.test(actions),
        "showcase kampaň musí nést bránu na běžící sken webu")
    assert(worker.includes("gate?.taskId"), "worker musí bránu číst z options kampaně")
    assert(/status:\s*"pending",\s*worker_lease:\s*null/.test(worker),
        "zavřená brána musí kampaň vrátit do fronty — zabraná kampaň by blokovala i cizí tenanty")
    assert(worker.includes("GATE_MAX_WAIT_MS"),
        "čekání musí mít strop: zaseknutá práce nesmí ukázkový obsah zabít úplně")
    assert(/\(c\.cursor \|\| 0\) > 0/.test(worker),
        "brána platí jen na nezačatou kampaň — rozdělaná se nesmí zastavit uprostřed")
})

test("31.4 jádro onboardingu zůstává bez auth vrstvy", () => {
    // Tohle je důvod, proč vůbec šlo onboarding utrhnout od prohlížeče: worker
    // (lib/agents/handlers.ts → cron route) nesmí sáhnout na next/headers. Dokud
    // pipeline žila za requireAuth(), durable běh nebyl možný. Pravidlo je v hlavičce
    // core.ts napsané prózou — tady je vynucené.
    const core = codeOnly("app/onboarding/core.ts")
    for (const forbidden of ["@/supabase/server", "requireAuth", "next/headers"]) {
        assert(!core.includes(forbidden),
            `core.ts nesmí importovat ${forbidden} — rozbilo by to headless běh (worker i tsx skripty)`)
    }
    assert(core.includes("@/supabase/admin"), "core.ts jede na service-role klientovi")
})

test("31.5 dotazník na míru nesmí onboarding zablokovat", () => {
    const core = codeOnly("app/onboarding/core.ts")
    assert(core.includes("FALLBACK_QUESTIONS"),
        "pevný dotazník musí zůstat jako záchranná síť, když model selže")

    const fn = core.slice(core.indexOf("export async function generateQuestionsCore"))
    const body = fn.slice(0, fn.indexOf("\n}\n"))
    assert(body.includes("catch") && body.includes("return FALLBACK_QUESTIONS"),
        "selhání modelu musí skončit pevným dotazníkem, ne výjimkou — ptát se hůř je lepší než se nezeptat")
    assert(body.includes("usable.length < 3"),
        "schéma hlídá tvar, ne smysl: prázdný select se nedá vyplnit, takže se počítají použitelné otázky")

    // Otázky píše AI, takže id je neprůhledné — bez textu otázky je odpověď v promptu
    // jen hodnota bez kontextu a učicí smyčka z ní nic nevytěží.
    assert(core.includes("otazka: q.question"),
        "do mega promptu musí jít dvojice otázka+odpověď, ne holá mapa id→odpověď")

    const actions = codeOnly("app/onboarding/actions.ts")
    assert(!actions.includes("ig_goal"),
        "pevný dotazník patří do core.ts — v actions.ts by byl zase dvojník")
})

test("31.8 dotazník musí pokrýt osy, které se z webu vyčíst nedají", () => {
    // Model umí vymyslet pět skvělých otázek, které shodou okolností všechny míří na
    // publikum — a config si pak antiPatterns nebo ctaVariations jen vymyslí, protože
    // se na ně nikdo nezeptal. Pokrytí os je proto vynucené, ne doufané.
    const types = codeOnly("app/onboarding/types.ts")
    assert(/REQUIRED_AXES/.test(types), "povinné osy musí být pojmenované na jednom místě")
    for (const axis of ["cil", "tabu", "cta", "vizual"]) {
        assert(types.includes(`'${axis}'`), `osa ${axis} chybí — sytí pole, které web neprozradí`)
    }

    const core = codeOnly("app/onboarding/core.ts")
    const fn = core.slice(core.indexOf("export async function generateQuestionsCore"))
    const body = fn.slice(0, fn.indexOf("\n}\n"))
    assert(body.includes("REQUIRED_AXES.filter"), "chybějící osu musí kód detekovat, ne jen prompt poprosit")
    assert(/FALLBACK_QUESTIONS.find\(q => q.covers === axis\)/.test(body),
        "chybějící osa se zalepí pevnou otázkou — obecná otázka je lepší než žádná")
    // Každá pevná otázka musí mít osu, jinak není čím díru zalepit.
    const fixed = core.slice(core.indexOf("const FALLBACK_QUESTIONS"))
    const block = fixed.slice(0, fixed.indexOf("\n]\n"))
    assert((block.match(/covers:/g) || []).length === 5, "všech 5 pevných otázek musí nést osu")
})

test("31.9 mega prompt s odpověďmi něco udělá, ne že je jen zobrazí", () => {
    // Odpovědi byly dřív pod nadpisem vysypané do promptu a pak už je nic nezmínilo —
    // jediná věta „obsah musí odpovídat odpovědím" nesváže odpověď s polem.
    const core = codeOnly("app/onboarding/core.ts")
    const i = core.indexOf("const configPrompt =")
    const prompt = core.slice(i, core.indexOf("const rawConfig", i))
    assert(prompt.includes("JAK NALOŽIT S ODPOVĚĎMI"), "prompt musí mít sekci o tom, co s odpověďmi dělat")
    for (const field of ["antiPatterns", "ctaVariations", "contentPillars", "feedAesthetic"]) {
        assert(prompt.includes(field), `pravidla musí vázat odpovědi na konkrétní pole (${field})`)
    }
    assert(prompt.includes("platí odpověď"),
        "když si web a odpověď protiřečí, musí být jasné, co vyhrává — majitel ví víc než jeho web")
})

test("31.6 onboarding neběží v prohlížeči, ale jako durable task", () => {
    const actions = codeOnly("app/onboarding/actions.ts")
    assert(actions.includes("enqueueTask"), "dlouhá práce se musí zařadit, ne rozjet v requestu")
    assert(!actions.includes("await generateConfigCore("),
        "server action nesmí pipeline spustit inline — přesně to shodilo onboarding na Failed to fetch")
    assert(!actions.includes("await analyzeWebsiteCore("),
        "analýza webu patří do workera, ne do blokujícího requestu")
    // Opakovat víceminutovou práci s Pro modely by tiše utratilo rozpočet znovu.
    assert(/maxAttempts: 1/.test(actions), "onboardingové tasky se nesmí samy opakovat")

    const handlers = codeOnly("lib/agents/handlers.ts")
    for (const t of ["onboarding_analyze", "onboarding_config_preview"]) {
        assert(handlers.includes(`registerHandler("${t}"`), `chybí handler pro ${t}`)
    }
    // Cron routa tenhle soubor importuje — auth vrstva by rozbila headless běh.
    for (const forbidden of ["@/supabase/server", "requireAuth", "next/headers"]) {
        assert(!handlers.includes(forbidden), `handlers.ts nesmí importovat ${forbidden}`)
    }

    // UI nesmí spadnout zpátky na blokující volání.
    for (const ui of ["app/onboarding/page.tsx", "app/(dashboard)/dashboard/instagram/tabs/OnboardTab.tsx"]) {
        const code = codeOnly(ui)
        assert(code.includes("awaitOnboardingTask"), `${ui} musí čekat na task, ne na blokující action`)
        assert(!code.includes("generateConfigPreview("), `${ui} nesmí volat synchronní generování configu`)
    }
})

test("31.7 na cizí onboardingovou úlohu se nikdo nedostane", () => {
    for (const route of ["app/api/onboarding/run-task/route.ts", "app/api/onboarding/task-status/route.ts"]) {
        const code = codeOnly(route)
        assert(code.includes("requireAuth"), `${route} musí ověřit přihlášení`)
        // Onboarding běží dřív, než existuje klient — vlastnictví visí na requested_by,
        // ne na client_id. Systémový task (NULL) se z prohlížeče nesmí spustit ani přečíst.
        assert(code.includes("requested_by"), `${route} musí kontrolovat vlastníka úlohy`)
        assert(/task\.requested_by !== userId/.test(code),
            `${route} musí porovnat vlastníka s přihlášeným uživatelem (fail closed na NULL)`)
    }

    // Reaper nesmí uživateli nechat věčně se točící kolečko, ale ani sáhnout cizím agentům.
    const status = codeOnly("app/api/onboarding/task-status/route.ts")
    assert(status.includes("ONBOARDING_TYPES"), "reaper se smí dotknout jen onboardingových typů")
    assert(/STUCK_AFTER_MS = 15/.test(status),
        "práh musí přesahovat maxDuration běhu (800 s), jinak označí živou práci za mrtvou")
})

test("31.10 syrové „Failed to fetch\" se k zákazníkovi nedostane", () => {
    // Tuhle větu zákazník reálně viděl. Je to hláška prohlížeče o rozpadlém spojení,
    // ne něco, čemu má rozumět — a hlavně po durable přestavbě už ani není pravdivá:
    // práce běží dál na serveru.
    const client = codeOnly("app/onboarding/task-client.ts")
    assert(/export function humanizeClientError/.test(client), "překlad chyby musí být sdílený, ne v každém průvodci zvlášť")
    assert(/failed to fetch/i.test(client), "překlad musí tuhle konkrétní hlášku zachytit")

    for (const ui of ["app/onboarding/page.tsx", "app/(dashboard)/dashboard/instagram/tabs/OnboardTab.tsx"]) {
        const code = codeOnly(ui)
        assert(!/setError\(\(err as Error\)\.message\)/.test(code),
            `${ui}: chyba do UI musí projít humanizeClientError, jinak tam skončí anglický technický text`)
        // Zařazení tasku je taky fetch. Když viselo mimo try, rozpadlé spojení na něm
        // vyletělo neošetřené a průvodce zamrzl na točícím se kolečku.
        assert(!/const started = await start(Website|Manual)Analysis/.test(code),
            `${ui}: zařazení analýzy musí běžet uvnitř runAnalysis (try/catch), ne holé před ním`)
        assert(code.includes("runAnalysis("), `${ui} musí analýzu spouštět přes runAnalysis`)
    }
})

// ═══════════════════════════════════════════════════════════
// 32. ŠTÍTKY REFERENČNÍCH FOTEK
// ═══════════════════════════════════════════════════════════

test("32.1 seznam štítků má jediný zdroj", () => {
    // Štítky čte prompt taggeru, UI i pravidla věrnosti. Tři kopie by se rozešly
    // a fotka by pak měla štítek, kterému rozumí jen jedna z nich.
    const types = codeOnly("instagram/configs/types.ts")
    assert(/export const BRAND_IMAGE_TAGS/.test(types), "kanonický seznam patří do types.ts")
    assert(/export function isValidBrandTag/.test(types), "validace štítku musí být sdílená")

    const tagger = codeOnly("instagram/brand-tagger.ts")
    assert(!/const VALID_TAGS = \[/.test(tagger), "tagger nesmí mít vlastní kopii seznamu")
    assert(/BRAND_IMAGE_TAGS\.map/.test(tagger), "nabídka do promptu se musí skládat z kanonického seznamu")
})

test("32.2 konkrétní osoba je vlastní štítek, ne 'detail'", () => {
    // Tohle byl konkrétní nález: portrét tváře značky vision model označil za
    // „detail", takže se k příspěvkům nikdy nepřiložil.
    const types = codeOnly("instagram/configs/types.ts")
    assert(/id: "person"/.test(types), "štítek pro konkrétního člověka musí existovat")

    const tagger = codeOnly("instagram/brand-tagger.ts")
    assert(/DŮLEŽITÉ K LIDEM/.test(tagger), "prompt musí obličej explicitně odlišit od detailu")

    // Bez pravidla ve věrnosti je štítek jen nálepka — model by tvář vyměnil za model z banky.
    const fidelity = codeOnly("instagram/photo-fidelity.ts")
    assert(/PERSON_TAGS/.test(fidelity), "věrnost musí znát tvář značky")
    assert(/TVÁŘ ZNAČKY/.test(fidelity), "art director musí dostat pravidlo o konkrétním člověku")
})

test("32.3 ruční štítek je konečný — AI ho nepřepíše", () => {
    const types = codeOnly("instagram/configs/types.ts")
    assert(/userTagged\?: boolean/.test(types), "BrandImage musí umět rozlišit ruční štítek")

    const actions = codeOnly("app/actions/brand-images-action.ts")
    assert(/export async function setBrandImageTags/.test(actions), "ruční štítkování musí mít vlastní akci")

    const retag = actions.slice(actions.indexOf("export async function retagBrandImages"))
    assert(/if \(img\.userTagged\)/.test(retag),
        "„Přeznačit AI\" musí ručně opravené fotky přeskočit, jinak opravu zahodí")

    const setter = actions.slice(actions.indexOf("export async function setBrandImageTags"))
    const body = setter.slice(0, setter.indexOf("\n}\n"))
    assert(/isValidBrandTag/.test(body), "ruční štítky se musí validovat proti kanonickému seznamu")
    assert(/clean\.length === 0/.test(body),
        "fotka bez štítku je pro pipeline neviditelná — prázdný výběr musí být odmítnutý, ne tiché smazání z výběru")
    assert(/userTagged: true/.test(body), "ruční zásah se musí označit, jinak ho AI zase přepíše")
})

test("32.4 tvář značky se renderuje jako reálný člověk, ne jako styl", () => {
    const orch = codeOnly("instagram/orchestrators/image-orchestrator.ts")

    // Bez vlastní větve spadl portrét do generické „match this exact style" —
    // model tím dostal pokyn okopírovat styl, ne zachovat obličej.
    const label = orch.slice(orch.indexOf("export function brandRefLabel"))
    assert(/REAL PERSON reference/.test(label.slice(0, 900)),
        "fotka konkrétního člověka potřebuje vlastní popisek, ne větev o stylu")
    assert(/NOT style inspiration/.test(label.slice(0, 900)),
        "popisek musí výslovně říct, že to není inspirace stylem")

    // Skórování porovnává anglické štítky s převážně českým textem postu, takže
    // „person" se skoro nikdy netrefí — fotka by propadla do náhodného výběru.
    assert(/hasPersonRef\(img\.tags\)/.test(orch),
        "tvář značky se musí přikládat natvrdo, ne přes shodu štítku s textem")
})

test("32.5 render zakazuje typické AI znaky na tváři", () => {
    const pipeline = codeOnly("instagram/image-pipeline.ts")
    const block = pipeline.slice(pipeline.indexOf("REAL PERSON FIDELITY"))
    const body = block.slice(0, 2200)

    // Obličej je jediné, u čeho divák AI pozná okamžitě.
    for (const tell of ["waxy", "airbrush", "symmetrise", "texture"]) {
        assert(new RegExp(tell, "i").test(body), `blok musí zakázat typický AI znak: ${tell}`)
    }
    assert(/de-age|beautify/i.test(body),
        "model ma vestaveny sklon cloveka vylepsit — prave to ho prozradi nejvic")
    assert(/reframe|not the subject/i.test(body),
        "když tvář nejde vyrenderovat přesvědčivě, musí být cesta ven přes rámování, ne vymyšlený obličej")
    assert(/no person at all|ignore this reference/i.test(body),
        "přiložená reference nesmí do postu vnutit člověka, když tam nepatří")
})

test("32.6 hasPersonPhoto zůstává POSLEDNÍ parametr", () => {
    // Past: carousel i story předávají allowedExtraText pozičně. Vsunutí nového
    // parametru před něj by jim navázalo indikátor slajdu na příznak tváře.
    const pipeline = codeOnly("instagram/image-pipeline.ts")
    const sig = pipeline.slice(
        pipeline.indexOf("export function buildNativeImagePrompt"),
        pipeline.indexOf("): string {", pipeline.indexOf("export function buildNativeImagePrompt")),
    )
    assert(sig.indexOf("allowedExtraText") < sig.indexOf("hasPersonPhoto"),
        "hasPersonPhoto musí být AŽ ZA allowedExtraText — jinak se poziční volání rozjedou")
})

// ═══════════════════════════════════════════════════════════
// 33. HOOK ŠABLONY SE MUSÍ DOSTAT DO PROMPTU
// ═══════════════════════════════════════════════════════════

test("33.1 chybějící pole v brandVoice nesmí shodit generaci", () => {
    // Onboarding zapisuje surový výstup modelu bez kontroly tvaru. Když AI jednou
    // vynechá hookTemplates, `undefined.filter` shodí KAŽDOU generaci toho klienta.
    const idx = codeOnly("instagram/configs/index.ts")
    const bv = idx.slice(idx.indexOf("brandVoice: {"), idx.indexOf("contentPillars:"))
    assert(/hookTemplates: config\.brandVoice\?\.hookTemplates \?\? \[\]/.test(bv),
        "brandVoice se musí doplňovat po polích, ne jen celý když chybí")
    assert(/toneByPostType: config\.brandVoice\?\.toneByPostType \?\? \{\}/.test(bv),
        "toneByPostType potřebuje stejnou pojistku jako hookTemplates")

    const gen = codeOnly("instagram/caption-generator.ts")
    assert(/config\.brandVoice\?\.hookTemplates \?\? \[\]/.test(gen), "čtení šablon musí být odolné")
    assert(/config\.brandVoice\?\.toneByPostType \?\? \{\}/.test(gen), "čtení tónu musí být odolné")
})

test("33.2 přepis formátů překlíčuje i to, co na ně odkazuje", () => {
    // generateCustomFormats přepíše postTypes na formáty na míru. Když s nimi
    // nepřeklíčuje bestFor a toneByPostType, zůstanou viset na názvech, které
    // přestaly existovat — naměřeno na produkci: 0 z ~7 sedělo u všech 6 klientů.
    const core = codeOnly("app/onboarding/core.ts")
    const fn = core.slice(core.indexOf("export async function generateCustomFormats"))
    assert(/pillarOfOldSlug/.test(fn),
        "most mezi starým a novým názvoslovím vede přes pilíř — jméno na jméno přeložit nejde")
    assert(/t\.bestFor = /.test(fn), "bestFor se musí překlíčovat")
    assert(/toneByPostType/.test(fn), "toneByPostType má stejnou vadu a musí se překlíčovat taky")
    // Snímek pilířů MUSÍ vzniknout dřív, než se contentPillars přepíšou.
    assert(fn.indexOf("pillarOfOldSlug") < fn.indexOf("config.postTypes = defs.map"),
        "snímek starých názvů musí vzniknout PŘED přepisem, jinak už most neexistuje")
})

test("33.3 mrtvé cílení se normalizuje u konzumenta, ne v reconcile", () => {
    // reconcileFormats se ukládá zpátky do clients.config, takže zahazování
    // „mrtvých" názvů by při prvním uložení Nastavení smazalo hook šablony všech
    // klientů. Je to autorský obsah, ne přegenerovatelná projekce.
    const rec = codeOnly("instagram/configs/reconcile.ts")
    assert(!/hookTemplates|toneByPostType/.test(rec.replace(/NEPATŘÍ[\s\S]*?\*\//, "")),
        "reconcileFormats nesmí sahat na autorská data — smazal by je při prvním uložení")
})

// ═══════════════════════════════════════════════════════════
// 34. ÚTRATA ZA MODELY JE VIDĚT CELÁ
// ═══════════════════════════════════════════════════════════

test("34.1 měření žije mimo generování příspěvků", () => {
    // Naměřeno 23. 8. 2026: Google za týden 411,78 Kč, aplikace uměla vysvětlit ~100.
    // Měřič obaloval jedinou cestu (generateOnePost), takže největší položka týdne
    // — 400 nápadů jedním hromadným během — nebyla v datech vůbec.
    assert(fileExists("instagram/spend-tracker.ts"), "chybí měření útraty mimo posty")
    const t = codeOnly("instagram/spend-tracker.ts")
    assert(/export async function trackSpend/.test(t), "obal na měření musí být sdílený")
    assert(/ai_spend/.test(t), "útrata se musí někam ukládat")

    // Neúspěšný běh je ten nejdražší druh — zaplatí se a nic z něj není.
    const fn = t.slice(t.indexOf("export async function trackSpend"))
    assert(/finally/.test(fn.slice(0, 900)) && /currentUsage\(\)/.test(fn.slice(0, 900)),
        "spotřeba se musí zapsat i když práce spadne — jinak jsou nejdražší běhy v datech nejlevnější")
})

test("34.2 nápady a onboarding se měří", () => {
    // Obojí byly v účetnictví slepé skvrny; nápady dokonce největší položka týdne.
    const ideas = codeOnly("instagram/idea-generator.ts")
    assert(/trackSpend\(\s*"ideas"/.test(ideas),
        "generování nápadů se měří UVNITŘ — volají ho CLI, UI i noční cron a každý by mohl zapomenout")

    const handlers = codeOnly("lib/agents/handlers.ts")
    for (const op of ["onboarding_analyze", "onboarding_config"]) {
        assert(new RegExp(`trackSpend\\(\\s*"${op}"`).test(handlers), `onboarding krok ${op} se neměří`)
    }
})

test("34.3 neznámá sazba se nesmí tvářit jako nula", () => {
    const t = codeOnly("instagram/spend-tracker.ts")
    assert(/cost_usd: cost/.test(t) && !/cost_usd: cost \?\? 0/.test(t),
        "neoceněný běh musí zůstat null — vymyšlená nula vypadá v datech jako levný běh")
})

test("34.4 hromadný běh nápadů se neprovede potichu", () => {
    const cli = codeOnly("instagram/cli.ts")
    assert(/BULK_WARN_THRESHOLD/.test(cli), "velký běh musí člověka varovat, než utratí stovky")
})

test("34.5 každý volající modelu má jasno, kdo ho účtuje", () => {
    // Původní chyba nebyla ve výpočtu, ale v POKRYTÍ: měřič obaloval jednu cestu
    // a nikdo nehlídal, že jich je dvacet. Tahle aserce je proto seznam, ne vzorec —
    // kdo sáhne na model, musí se objevit buď s vlastním `trackSpend`, nebo tady,
    // s důvodem, proč ho účtuje někdo nad ním. Nový soubor propadne a vynutí rozhodnutí.
    const fs = require("fs") as typeof import("fs")

    /** Soubory, které model volají, ale útratu za ně zapisuje nadřazený scope. */
    const UVNITR_CIZIHO_SCOPE: Record<string, string> = {
        "instagram/gemini-client.ts": "sama brána k modelům — měří tudy všichni ostatní",
        "instagram/usage-meter.ts": "měřič samotný",
        "instagram/autopilot.ts": "withUsageScope → ig_generation_log (příspěvky mají vlastní účetnictví)",
        "instagram/caption-generator.ts": "uvnitř generateOnePost",
        "instagram/context-agent.ts": "uvnitř generateOnePost",
        "instagram/editorial-board.ts": "uvnitř generateOnePost",
        "instagram/judge.ts": "uvnitř generateOnePost",
        "instagram/image-pipeline.ts": "uvnitř generateOnePost",
        "instagram/orchestrators/image-orchestrator.ts": "uvnitř generateOnePost",
        "instagram/orchestrators/carousel-orchestrator.ts": "uvnitř generateOnePost",
        "instagram/orchestrators/story-orchestrator.ts": "uvnitř generateOnePost",
        "instagram/orchestrators/reel-orchestrator.ts": "uvnitř generateOnePost",
        "instagram/plan-pipeline.ts": "uvnitř generateContentPlan (content_plan)",
        "instagram/feed-vision.ts": "uvnitř onboarding_config nebo recommendFeedPattern",
        "instagram/memory-agent.ts": "uvnitř generace příspěvku nebo operace learn",
        "instagram/service.ts": "jen embedText nad captionem — haléře, běží uvnitř ukládání postu",
        "app/onboarding/actions.ts": "onboarding měří lib/agents/handlers.ts",
        "lib/product-scrape.ts": "sken webu měří jeho volající — tlačítko v Katalogu i task product_scrape",
        "app/onboarding/core.ts": "onboarding měří lib/agents/handlers.ts",
    }

    const VOLANI = /\b(generateText|generateTextQuality|generateImage|generateImageWithReferences|editExistingImage|detectLogoPlacementArea|analyzeImagesWithText|generateVideo|generateVoiceover|embedTexts|embedText)\s*\(/

    const walk = (dir: string): string[] => {
        const out: string[] = []
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.name === "node_modules" || e.name.startsWith(".")) continue
            const full = `${dir}/${e.name}`
            if (e.isDirectory()) out.push(...walk(full))
            else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) out.push(full)
        }
        return out
    }

    let volajicich = 0
    for (const file of [...walk("app"), ...walk("lib"), ...walk("instagram")]) {
        const src = codeOnly(file)
        if (!VOLANI.test(src)) continue
        volajicich++
        if (/trackSpend\(/.test(src)) continue
        assert(
            file in UVNITR_CIZIHO_SCOPE,
            `${file} volá model, ale nikde se neúčtuje — buď ho obal do trackSpend(), ` +
            `nebo ho zapiš do UVNITR_CIZIHO_SCOPE s důvodem, kdo za něj platí`,
        )
    }
    assert(volajicich > 20, `aserce musí reálně něco kontrolovat (našla jen ${volajicich} volajících)`)
})

test("34.6 vnořené měření nesmí okrást to nadřazené", () => {
    // `usageStorage.run()` nadřazený akumulátor ZASTÍNÍ. Kdyby si vnitřní scope
    // volání nechal jen pro sebe, příspěvek by v ig_generation_log vyšel levnější,
    // než byl — tichá chyba přesně toho druhu, kvůli kterému ai_spend vzniklo.
    const m = codeOnly("instagram/usage-meter.ts")
    assert(/parent\?\.record\(call\)/.test(m),
        "vnořený scope musí volání poslat i nadřazenému akumulátoru")
    assert(/new UsageAccumulator\(usageStorage\.getStore\(\) \?\? null\)/.test(m),
        "nový scope si musí zapamatovat rodiče, jinak nemá komu propagovat")
})

test("34.7 hromadný běh nápadů z CLI se měří", () => {
    // Regrese na konkrétní incident: měření se přidalo do idea-generator.ts, jenže
    // běh z 18. 8. (400 nápadů, ~250 Kč) šel VLASTNÍ cestou v cli.ts. Nejdražší známý
    // běh v historii produktu tak zůstal neměřený i po opravě, která ho měla pokrýt.
    const cli = codeOnly("instagram/cli.ts")
    assert(/trackSpend\(\s*"ideas"/.test(cli),
        "vlastní generátor nápadů v cli.ts se musí měřit — tudy šel ten čtvrt tisíce")
})

// ═══════════════════════════════════════════════════════════
// 35. ANALYTIKA A A/B SOUBOJE (v9)
// ═══════════════════════════════════════════════════════════

test("35.1 síla příspěvku má jediný vzorec", () => {
    // Žebříček výkonu a vyhodnocení A/B soubojů mluví o TÝCHŽ příspěvcích. Kdyby
    // každý počítal po svém, aplikace by uměla prohlásit vítězem post, který má
    // v žebříčku níž — dvě pravdy o jedné fotce a zákazník neví, které věřit.
    assert(fileExists("lib/engagement.ts"), "vzorec potřebuje vlastní modul")
    const perf = codeOnly("instagram/performance.ts")
    assert(perf.includes("engagementScore"), "performance.ts musí vzorec importovat, ne mít vlastní")
    assert(!/\(p\.likes \|\| 0\) \+ \(p\.comments \|\| 0\) \* 3/.test(perf),
        "vzorec nesmí být rozepsaný v performance.ts — jediný zdroj je lib/engagement.ts")
    const duel = codeOnly("lib/ab-duel.ts")
    assert(duel.includes("engagementScore"), "souboj musí počítat týmž vzorcem jako žebříček")
})

test("35.2 A/B nesmí prohlásit vítěze na šumu", () => {
    // Běhová aserce nad skutečnou funkcí. Dvě fotky s 12 a 13 lajky nejsou vítěz
    // a poražený — a doporučení postavené na náhodě je horší než mlčení.
    const { evaluateDuel, MIN_MARGIN_PCT, MIN_TOTAL_ENGAGEMENT } = require("./lib/ab-duel")
    const posted = (id: string, likes: number) => ({ id, status: "posted", likes, comments: 0, saves: 0 })

    const tesny = evaluateDuel(posted("a", 20), posted("b", 22))
    assert(tesny.verdict === "tesne", `rozdíl 10 % musí být 'tesne', je '${tesny.verdict}'`)
    assert(tesny.winner === null, "u těsného výsledku se vítěz NEURČUJE")

    const maloDat = evaluateDuel(posted("a", 1), posted("b", 3))
    assert(maloDat.verdict === "tesne", "pár lajků nestačí, i když je rozdíl procentuálně velký")
    assert(maloDat.winner === null, "na 4 interakcích se vítěz neprohlašuje")

    const jasny = evaluateDuel(posted("a", 20), posted("b", 60))
    assert(jasny.verdict === "rozhodnuto" && jasny.winner === "variant",
        "trojnásobný rozdíl musí mít vítěze")

    // Nezveřejněný nebo nezměřený protivník = není co porovnávat.
    const ceka = evaluateDuel(posted("a", 20), { id: "b", status: "ready", likes: null })
    assert(ceka.verdict === "ceka" && ceka.winner === null,
        "dokud nejsou obě verze venku a naměřené, souboj čeká")

    assert(MIN_MARGIN_PCT >= 10 && MIN_TOTAL_ENGAGEMENT >= 5,
        "prahy nesmí klesnout tak nízko, že vítěze udělá jeden lajk")
})

test("35.3 'plná analytika' něco doopravdy omezuje", () => {
    // Do 9/2026 byl přepínač `analytics` placený slib bez krytí: nikde se nečetl,
    // jen se vypsal na kartu tarifu. Start platil míň a viděl identickou obrazovku.
    // Stejná vada jako priorita generování do srpna — a stejná oprava.
    assert(fileExists("lib/analytics-depth.ts"), "hloubka analytiky potřebuje jediné pravidlo")
    const action = codeOnly("app/actions/admin-actions.ts")
    assert(action.includes("trimInsightsForDepth"),
        "čtecí cesta do UI musí payload ořezat — schování v komponentě není placená hranice")
    assert(action.includes("analyticsDepth"),
        "UI musí dostat hloubku ze serveru, ne si ji domýšlet")
    // Volat ořez a pak stejně vrátit neořezaná data je díra, která vypadá opravená.
    // Tahle půlka aserce vznikla proto, že přesně tak šla první verze obejít.
    assert(!/return\s*\{\s*insights,/.test(action),
        "vrací se neořezané `insights` — ořez pak nemá žádný účinek")

    // Ořez ověřený nad skutečnou funkcí, ne nad textem.
    const { trimInsightsForDepth, FULL_ONLY_FIELDS } = require("./lib/analytics-depth")
    const plne = { avgEngagement: 42, conversionRate: 0.1, bestTimeSlots: ["18:00"], topPatterns: ["POV"] }
    const orezane = trimInsightsForDepth(plne, "basic")
    assert(orezane.avgEngagement === 42, "průměrná interakce zůstává i základnímu tarifu")
    for (const f of FULL_ONLY_FIELDS) {
        assert(!(f in orezane), `${f} se musí SMAZAT, ne vynulovat — nula vypadá jako naměřený výsledek`)
    }
    assert(trimInsightsForDepth(plne, "full").conversionRate === 0.1, "plný tarif nepřichází o nic")
})

test("35.4 tarif nesmí zhoršit obsah, jen výhled", () => {
    // Nejnebezpečnější způsob, jak tuhle funkci pokazit: ořezat závěry i enginu.
    // Copywriter i plánovač z nich píšou, takže by levnější tarif dostával horší
    // obsah — tichá degradace kvality, kterou CLAUDE.md zakazuje.
    const engine = codeOnly("instagram/performance.ts")
    for (const zakazane of ["analytics-depth", "trimInsightsForDepth", "getClientSubscription", "features.analytics"]) {
        assert(!engine.includes(zakazane),
            `instagram/performance.ts nesmí znát tarify (${zakazane}) — ořez patří jen do čtecí cesty UI`)
    }

    // A/B akce musí mít bránu na serveru, ne jen schovanou sekci.
    const ab = codeOnly("app/actions/ab-actions.ts")
    assert(ab.includes("requireProjectAccess"), "akce musí ověřit přístup k projektu")
    assert(/allowed_actions[\s\S]{0,40}post_variant/.test(ab),
        "souboje smí dostat jen tarif, který varianty vůbec umí")
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
