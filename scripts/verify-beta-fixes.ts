/**
 * Beta Launch — Automated Verification Script
 * =============================================
 * Tests all 5 fixes without requiring a running server.
 * Validates code-level correctness through file parsing.
 */

import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dirname, '..')
let passed = 0
let failed = 0

function test(name: string, fn: () => boolean) {
    try {
        if (fn()) {
            console.log(`  ✅ ${name}`)
            passed++
        } else {
            console.log(`  ❌ ${name}`)
            failed++
        }
    } catch (err: any) {
        console.log(`  ❌ ${name} — ${err.message}`)
        failed++
    }
}

function readFile(relativePath: string): string {
    return readFileSync(join(ROOT, relativePath), 'utf-8')
}

// ═══════════════════════════════════════════════
// FIX 1: PlanUnlockModal bug — generateRefId(client.slug)
// ═══════════════════════════════════════════════
console.log('\n🔧 Fix 1: PlanUnlockModal bug')

test('payments/create uses client.slug (not clientSlug from body)', () => {
    const code = readFile('app/api/payments/create/route.ts')
    return code.includes('generateRefId(client.slug)') && !code.includes('generateRefId(clientSlug)')
})

// ═══════════════════════════════════════════════
// FIX 2: Mock Payment Flow
// ═══════════════════════════════════════════════
console.log('\n💳 Fix 2: Mock Payment Flow')

test('mock-payment page exists', () => {
    const code = readFile('app/mock-payment/page.tsx')
    return code.includes('MockPaymentPage') || code.includes('MockPaymentContent')
})

test('mock page calls /api/payments/callback with PAID status', () => {
    const code = readFile('app/mock-payment/page.tsx')
    return code.includes("form.set('status', 'PAID')") && code.includes('/api/payments/callback')
})

test('mock page has DEMO badge', () => {
    const code = readFile('app/mock-payment/page.tsx')
    return code.includes('DEMO')
})

test('mock page has cancel flow', () => {
    const code = readFile('app/mock-payment/page.tsx')
    return code.includes('payment=cancelled')
})

test('payments/create has COMGATE_MOCK branch', () => {
    const code = readFile('app/api/payments/create/route.ts')
    return code.includes('COMGATE_MOCK') && code.includes('isMock') && code.includes('/mock-payment')
})

test('payments/create creates DB records in both mock and real flows', () => {
    const code = readFile('app/api/payments/create/route.ts')
    // subscription insert is after the mock/real branch (shared code)
    const mockBranchEnd = code.indexOf('// 4. Create subscription')
    return mockBranchEnd > code.indexOf('isMock')
})

test('payments/callback has COMGATE_MOCK bypass', () => {
    const code = readFile('app/api/payments/callback/route.ts')
    return code.includes('COMGATE_MOCK') && code.includes('Trust mock callback')
})

test('payments/callback does NOT reference undefined verified in shared code', () => {
    const code = readFile('app/api/payments/callback/route.ts')
    // After our fix, 'verified' should only appear inside the else block
    const updateBlock = code.substring(
        code.indexOf('// Update payment record'),
        code.indexOf('.eq("comgate_trans_id"')
    )
    return !updateBlock.includes('verified')
})

test('.env.local has COMGATE_MOCK=true', () => {
    const code = readFile('.env.local')
    return code.includes('COMGATE_MOCK="true"')
})

// ═══════════════════════════════════════════════
// FIX 3: Rate Limiting
// ═══════════════════════════════════════════════
console.log('\n🛡️ Fix 3: Rate Limiting')

test('ig-create-job has rate limit check', () => {
    const code = readFile('app/api/ig-create-job/route.ts')
    return code.includes('RATE_LIMIT_PER_HOUR') && code.includes('10')
})

test('rate limit uses DB count from ig_jobs', () => {
    const code = readFile('app/api/ig-create-job/route.ts')
    return code.includes('ig_jobs') && code.includes('count') && code.includes('oneHourAgo')
})

test('rate limit returns 429 status', () => {
    const code = readFile('app/api/ig-create-job/route.ts')
    return code.includes('429')
})

test('rate limit has admin bypass', () => {
    const code = readFile('app/api/ig-create-job/route.ts')
    return code.includes('isAdmin') && code.includes('SUPER_ADMIN_EMAILS')
})

test('rate limit check is before credit guard', () => {
    const code = readFile('app/api/ig-create-job/route.ts')
    const rateLimitPos = code.indexOf('RATE_LIMIT_PER_HOUR')
    const creditGuardPos = code.indexOf('creditGuard')
    return rateLimitPos < creditGuardPos
})

// ═══════════════════════════════════════════════
// FIX 4: Config Runtime Validation
// ═══════════════════════════════════════════════
console.log('\n🛡️ Fix 4: Config Runtime Validation')

test('loadConfig calls validateConfig', () => {
    const code = readFile('instagram/configs/index.ts')
    return code.includes('validateConfig(data.config')
})

test('validateConfig provides defaults for brandVoice', () => {
    const code = readFile('instagram/configs/index.ts')
    return code.includes('brandVoice: config.brandVoice ||') && code.includes('persona:')
})

test('validateConfig provides defaults for feedAesthetic', () => {
    const code = readFile('instagram/configs/index.ts')
    return code.includes('feedAesthetic: config.feedAesthetic ||') && code.includes('colorPalette:')
})

test('validateConfig provides defaults for hashtagPools', () => {
    const code = readFile('instagram/configs/index.ts')
    return code.includes('hashtagPools: config.hashtagPools ||') && code.includes('core: []')
})

test('validateConfig provides defaults for ctaStrategies', () => {
    const code = readFile('instagram/configs/index.ts')
    return code.includes('ctaStrategies: config.ctaStrategies ||') && code.includes('soft: []')
})

test('validateConfig provides defaults for contentFocus', () => {
    const code = readFile('instagram/configs/index.ts')
    return code.includes('contentFocus: config.contentFocus ||')
})

// ═══════════════════════════════════════════════
// FIX 5: Error Recovery
// ═══════════════════════════════════════════════
console.log('\n🔄 Fix 5: Error Recovery')

test('GenerateTab has retry button for single post failures', () => {
    const code = readFile('app/(dashboard)/dashboard/instagram/tabs/GenerateTab.tsx')
    return code.includes('Zkusit znovu') && code.includes('!result.success')
})

test('GenerateTab retry re-triggers handleGenerate', () => {
    const code = readFile('app/(dashboard)/dashboard/instagram/tabs/GenerateTab.tsx')
    return code.includes('setResult(null); setStep(1); setTimeout(() => handleGenerate()')
})

test('GenerateTab has retry for batch failures', () => {
    const code = readFile('app/(dashboard)/dashboard/instagram/tabs/GenerateTab.tsx')
    return code.includes('Zkusit selhané znovu') && code.includes('batchResult.errors > 0')
})

// ═══════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`)
console.log(`📊 Results: ${passed} passed, ${failed} failed`)
console.log(`${'═'.repeat(50)}`)

if (failed > 0) {
    process.exit(1)
}
