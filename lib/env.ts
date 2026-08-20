import { superAdminEmails, looksLikeEmail } from "@/lib/super-admins"

/**
 * Startup env validation — fail fast on missing required vars instead of
 * surfacing cryptic runtime errors mid-request. Called from instrumentation.ts.
 */

const REQUIRED = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "GEMINI_API_KEY",
    "SUPER_ADMIN_EMAILS",
    "NEXT_PUBLIC_SITE_URL",
] as const

const OPTIONAL = [
    "HIKERAPI_KEY",       // onboarding IG scraping (skipped gracefully when missing)
    "COMGATE_MERCHANT_ID", // payments — unset during beta
    "COMGATE_SECRET",
    "SENTRY_DSN",
    "META_APP_ID",        // Instagram OAuth — IG connect disabled until set
    "META_APP_SECRET",
    "IG_TOKEN_ENCRYPTION_KEY", // AES-256-GCM key for IG token storage (openssl rand -hex 32)
    "FAKTUROID_CLIENT_ID",     // fakturace — bez ní se doklad nevystaví (invoices.status='failed')
    "FAKTUROID_CLIENT_SECRET",
    "FAKTUROID_SLUG",          // název účtu v URL Fakturoidu
    "STRIPE_SECRET_KEY",       // druhá brána — zatím SANDBOX, cesta k penězům není dopojená
    "STRIPE_WEBHOOK_SECRET",   // bez něj webhook odmítne každou událost (podpis nelze ověřit)
    "RESEND_API_KEY",          // bez něj neodejde uvítání, doklad ani dunning — a sendNotification chybu spolkne
    "REPORT_FROM_EMAIL",       // bez ověřené domény se posílá z onboarding@resend.dev, který doručí JEN na adresu majitele Resend účtu
] as const

export function validateEnv(): void {
    const missing = REQUIRED.filter(key => !process.env[key])
    if (missing.length > 0) {
        throw new Error(`Chybí povinné env proměnné: ${missing.join(", ")}`)
    }

    const missingOptional = OPTIONAL.filter(key => !process.env[key])
    if (missingOptional.length > 0) {
        console.warn(`⚠️ Volitelné env proměnné nejsou nastavené: ${missingOptional.join(", ")}`)
    }

    checkSuperAdmins()
}

/**
 * Adminská brána při neshodě jen tiše vrátí `false` — admin pak nevidí celou
 * admin sekci a v aplikaci to nevypadá jako chyba, ale jako by ta sekce
 * neexistovala. Překlep v hodnotě proto musí být vidět při startu.
 *
 * Schválně se tu nic nevyhazuje: pokud je hodnota rozbitá už teď, shodil by
 * `validateEnv()` celou aplikaci při bootu (volá ho `instrumentation.ts`).
 * Výpadek je horší než chybějící admin sekce.
 */
function checkSuperAdmins(): void {
    const admins = superAdminEmails()

    if (admins.length === 0) {
        console.error("❌ SUPER_ADMIN_EMAILS je nastavené, ale nezbyl z něj žádný admin — admin sekce bude pro všechny skrytá.")
        return
    }

    const malformed = admins.filter(e => !looksLikeEmail(e))
    if (malformed.length > 0) {
        console.error(`❌ SUPER_ADMIN_EMAILS obsahuje hodnoty, které nevypadají jako adresa: ${malformed.join(", ")} — tihle se do admin sekce nedostanou.`)
    }

    console.log(`🔑 Super-adminů načteno: ${admins.length} (${admins.join(", ")})`)
}
