import { createClient } from '@/supabase/server'
import supabaseAdmin from '@/supabase/admin'
import { isSuperAdminEmail, superAdminEmails } from '@/lib/super-admins'
import { actionTranslator } from '@/lib/i18n/actions'

export type AuthErrorCode = 'unauthenticated' | 'missingProject' | 'missingClient' | 'forbidden' | 'noAdmins' | 'notAdmin'

/**
 * Chyba brány. Zpráva je v jazyce toho, kdo klikl (namespace `common`, klíče
 * `auth.*`), a proto se podle ní NIKDY nerozhoduje — kód si čti z `code`
 * (`isAuthError(err)`), ne z `err.message.includes('Neautorizovaný')`.
 */
export class AuthError extends Error {
    readonly code: AuthErrorCode
    constructor(code: AuthErrorCode, message: string) {
        super(message)
        this.name = 'AuthError'
        this.code = code
    }
}

/** Poznat chybu brány i přes hranici bundlu (instanceof nemusí držet). */
export function isAuthError(err: unknown): err is AuthError {
    return err instanceof AuthError || (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AuthError')
}

async function authError(code: AuthErrorCode): Promise<AuthError> {
    const t = await actionTranslator('common')
    return new AuthError(code, t(`auth.${code}`))
}

/**
 * Ověří, zda je uživatel přihlášen. Necontroluje admin práva.
 * Použij pro běžné user-facing akce (generování, settings, onboarding).
 */
export async function requireAuth(): Promise<{ email: string; userId: string }> {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()

    if (error || !user?.email) {
        throw await authError('unauthenticated')
    }

    return { email: user.email, userId: user.id }
}

/**
 * Ověří přihlášení + přístup k projektu přes user_clients tabulku.
 * Vrací { userId, clientId, email, isSuperAdmin } — nahrazuje ruční resolveClientId() volání.
 * Použij na KAŽDÉ server action, která přijímá projectSlug.
 */
export async function requireProjectAccess(projectSlug: string): Promise<{ userId: string; clientId: string; email: string; isSuperAdmin: boolean }> {
    if (!projectSlug) {
        throw await authError('missingProject')
    }
    // Auth BEFORE slug resolution — unauthenticated callers must not be able
    // to probe which tenant slugs exist via error-message differences.
    await requireAuth()
    const { resolveClientId } = await import('@/instagram/configs')
    const clientId = await resolveClientId(projectSlug)
    return requireClientAccess(clientId)
}

/**
 * Ověří přihlášení + přístup ke klientovi podle UUID (`clients.id`).
 * Použij pro ownership check řádků, které už nesou client_id (ig_jobs, ig_posts, ig_brand_memory…).
 */
export async function requireClientAccess(clientId: string): Promise<{ userId: string; clientId: string; email: string; isSuperAdmin: boolean }> {
    const { userId, email } = await requireAuth()
    if (!clientId) {
        throw await authError('missingClient')
    }

    // Super admins bypass user_clients check
    if (isSuperAdminEmail(email)) {
        return { userId, clientId, email, isSuperAdmin: true }
    }

    const { data } = await supabaseAdmin
        .from('user_clients')
        .select('role')
        .eq('user_id', userId)
        .eq('client_id', clientId)
        .single()

    if (!data) {
        throw await authError('forbidden')
    }

    return { userId, clientId, email, isSuperAdmin: false }
}

/**
 * Ověří, zda je aktuálně přihlášený uživatel Super Admin.
 * Pokud není, vyhodí výjimku (zastaví provádění Server Action).
 * Použij POUZE pro admin-only akce (waitlist, debug, systémové nastavení).
 */
export async function requireSuperAdmin(): Promise<{ email: string; userId: string }> {
    const { email, userId } = await requireAuth()

    const admins = superAdminEmails()

    if (admins.length === 0) {
        throw await authError('noAdmins')
    }

    if (!isSuperAdminEmail(email)) {
        throw await authError('notAdmin')
    }

    return { email, userId }
}

