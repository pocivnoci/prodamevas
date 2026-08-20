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
    // Normalizace je schválně zkopírovaná z `lib/super-admins.ts` a ne importovaná:
    // tenhle soubor musí zůstat bez importů (viz hlavička + aserce v `npm run guard`),
    // protože ho natahuje middleware u každého requestu. Drž obě kopie stejné.
    const normalize = (v: string) => v.replace(/["']/g, '').trim().toLowerCase()
    const admins = (process.env.SUPER_ADMIN_EMAILS || '').split(',').map(normalize).filter(Boolean)
    const email = user.email ? normalize(user.email) : ''
    if (email && admins.includes(email)) return true

    return Boolean(user.app_metadata?.invite_code || user.user_metadata?.invite_code)
}
