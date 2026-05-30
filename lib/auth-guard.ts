import { createClient } from '@/supabase/server'
import supabaseAdmin from '@/supabase/admin'

/**
 * Ověří, zda je uživatel přihlášen. Necontroluje admin práva.
 * Použij pro běžné user-facing akce (generování, settings, onboarding).
 */
export async function requireAuth(): Promise<{ email: string; userId: string }> {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()

    if (error || !user?.email) {
        throw new Error('Neautorizovaný přístup: Uživatel není přihlášen.')
    }

    return { email: user.email, userId: user.id }
}

/**
 * Ověří přihlášení + přístup k projektu přes user_clients tabulku.
 * Vrací { userId, clientId } — nahrazuje ruční resolveClientId() volání.
 * Použij na KAŽDÉ server action, která přijímá projectSlug.
 */
export async function requireProjectAccess(projectSlug: string): Promise<{ userId: string; clientId: string }> {
    const { userId, email } = await requireAuth()
    const { resolveClientId } = await import('@/instagram/configs')
    const clientId = await resolveClientId(projectSlug)

    // Super admins bypass user_clients check
    const admins = (process.env.SUPER_ADMIN_EMAILS || "").split(",").map(e => e.trim()).filter(Boolean)
    if (admins.includes(email)) {
        return { userId, clientId }
    }

    const { data } = await supabaseAdmin
        .from('user_clients')
        .select('role')
        .eq('user_id', userId)
        .eq('client_id', clientId)
        .single()

    if (!data) {
        throw new Error('Nemáte přístup k tomuto projektu.')
    }

    return { userId, clientId }
}

/**
 * Ověří, zda je aktuálně přihlášený uživatel Super Admin.
 * Pokud není, vyhodí výjimku (zastaví provádění Server Action).
 * Použij POUZE pro admin-only akce (waitlist, debug, systémové nastavení).
 */
export async function requireSuperAdmin(): Promise<void> {
    const { email } = await requireAuth()

    const admins = (process.env.SUPER_ADMIN_EMAILS || "").split(",").map(e => e.trim()).filter(Boolean)
    
    if (admins.length === 0) {
        throw new Error('Neautorizovaný přístup: Systém nemá definované žádné administrátory (SUPER_ADMIN_EMAILS).')
    }

    if (!admins.includes(email)) {
        throw new Error('Neautorizovaný přístup: Uživatel nemá administrátorská práva.')
    }
}

