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
}
