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
/**
 * Je kód pozvánky pořád podmínkou vstupu?
 *
 * Výchozí stav je ZAVŘENO. Otevření dveří je obchodní rozhodnutí vázané na to,
 * že se dají vzít peníze — ne default, do kterého se spadne zapomenutou
 * proměnnou. Proto se otevírá výslovným `BETA_INVITE_REQUIRED=0` a cokoliv
 * jiného (chybějící hodnota, překlep, prázdný řetězec) znamená zavřeno.
 *
 * Čte to i landing, aby hlavní tlačítko slibovalo přesně to, co registrace
 * splní: dokud je brána zavřená, zve na waitlist; po otevření vede rovnou do
 * registrace. Jeden spínač, jeden trychtýř — stejný vzor jako `REELS_ENABLED`.
 */
export function inviteRequired(): boolean {
    return (process.env.BETA_INVITE_REQUIRED || '').trim() !== '0'
}

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
