import { createClient } from '@/supabase/server'

/**
 * Ověří, zda je aktuálně přihlášený uživatel Super Admin.
 * Pokud není, vyhodí výjimku (zastaví provádění Server Action).
 * Tato funkce chrání serverové akce před neoprávněným spuštěním z klienta.
 */
export async function requireSuperAdmin(): Promise<void> {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()

    if (error || !user?.email) {
        throw new Error('Neautorizovaný přístup: Uživatel není přihlášen.')
    }

    const admins = (process.env.SUPER_ADMIN_EMAILS || "").split(",").map(e => e.trim()).filter(Boolean)
    
    if (admins.length === 0) {
        throw new Error('Neautorizovaný přístup: Systém nemá definované žádné administrátory (SUPER_ADMIN_EMAILS).')
    }

    if (!admins.includes(user.email)) {
        throw new Error('Neautorizovaný přístup: Uživatel nemá administrátorská práva.')
    }
}
