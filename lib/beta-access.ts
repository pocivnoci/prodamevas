/**
 * Razítko opravňující ke vstupu do bety — čte se **jen z účtu**, bez dotazu
 * do databáze.
 *
 * Proto tenhle soubor nesmí nic importovat: sahá po něm middleware, který běží
 * u každého requestu. Kdyby odsud vedla cesta k `supabase/admin`, natáhl by si
 * service role klíč do každého průchodu.
 *
 * Razítko rozdává `enforceInviteGate()` při přihlášení — kódem z registrace,
 * nebo `LEGACY` u zákazníků, kteří tu byli dřív než pozvánky. Účet bez razítka
 * se sem tedy nedostane ani se živou session.
 */
export function hasBetaStamp(user: {
    email?: string | null
    app_metadata?: Record<string, unknown> | null
    user_metadata?: Record<string, unknown> | null
}): boolean {
    const admins = (process.env.SUPER_ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean)
    if (user.email && admins.includes(user.email)) return true

    return Boolean(user.app_metadata?.invite_code || user.user_metadata?.invite_code)
}
