/**
 * Které způsoby přihlášení jsou skutečně zapojené.
 *
 * Provider se zapíná v Supabase, ne v repozitáři, takže o něm kód sám od sebe
 * neví — a nabídnout tlačítko k bráně, která není nastavená, je horší než
 * nenabídnout nic. Stejný přepínač skrývá i IG connect (`META_APP_ID`).
 */

/** Zapni po vytvoření OAuth klienta v Google Cloud a zapnutí provideru v Supabase. */
export function googleAuthEnabled(): boolean {
    return process.env.GOOGLE_AUTH_ENABLED === '1'
}
