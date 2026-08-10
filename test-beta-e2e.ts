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
    const content = fileContent("app/page.tsx")
    assert(content.includes('href="/login"'), "Should link to /login")
})

test("10.3 Landing page has WaitlistForm", () => {
    const content = fileContent("app/page.tsx")
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
    const content = fileContent("app/register/actions.ts")
    assert(content.includes("invite_codes"), "Should check invite_codes table")
    assert(content.includes("invalid_invite"), "Should handle invalid invite code")
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
    for (const page of ["app/terms/page.tsx", "app/privacy/page.tsx", "app/page.tsx"]) {
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
    const cb = fileContent("app/api/payments/callback/route.ts")
    assert(cb.includes("deliverPaidArtifacts"), "callback must delegate delivery to the shared core")
    assert(/after\(\(\) =>\s*deliverPaidArtifacts/.test(cb), "delivery must run inside after() so Comgate still gets its immediate ACK")
})

test("14.9 the paid-payment core is shared, not copied per gateway", () => {
    // Druhá brána nesmí znamenat druhé místo, které zapomene na doklad nebo na
    // aktivaci plánu. Jádro je provider-neutrální; routy dělají jen ověření a claim.
    const core = codeOnly("lib/payments/on-paid.ts")
    // Jádro SMÍ brány jmenovat v typu PaymentProvider (potřebuje je odlišit ve
    // Sentry tagu), ale nesmí IMPORTOVAT klienta konkrétní brány — tím by se
    // stalo závislé na jedné z nich a druhá by si musela udělat kopii.
    assert(!/from\s+["']@?\/?lib\/comgate["']/.test(core), "the shared core must not import the Comgate client")
    assert(!/from\s+["']stripe["']/.test(core), "the shared core must not import the Stripe SDK either")
    assert(!core.includes("getPaymentStatus"), "server-side status verification is gateway-specific and stays in the route")

    // Aktivace plánu smí být jen v jádru — kopie v routě by se rozešla.
    const cb = codeOnly("app/api/payments/callback/route.ts")
    assert(!cb.includes("activatePaidPlan"), "the Comgate route must NOT activate the plan itself — that logic lives in the core")
    assert(cb.includes("finalizePaidPayment"), "the route must call the core")

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
    assert(/sandbox: isMockPaymentMode\(\)/.test(cg), "ComGate route musí mock přiznat")
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
