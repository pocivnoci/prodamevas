/**
 * Kdo je zákazník — a kdo jsme my.
 * ================================
 * Agenti, kteří píšou lidem, potřebují jednu odpověď na otázku „je tohle vůbec
 * zákazník?". Bez ní se fronta schválení plní návrhy, které nikdo nikdy
 * neschválí: 8. 9. 2026 v ní čekalo 27 akcí, nejstarší 46 dní, a jedenáct z nich
 * mířilo na značky z výlohy (Rohlík, Portu, Ambiente…) nebo na testovací adresy.
 * Zakladatel měl schvalovat, že sám sobě pošle pobídku k aktivaci demo účtu.
 *
 * Obě pravidla jsou schválně **čisté predikáty bez databáze** — jdou tak použít
 * v dotazu i nad načteným řádkem a otestovat bez `.env.local`.
 *
 * ⚠️ Tohle NENÍ bezpečnostní hranice. Neříká, kdo se kam dostane (to drží
 * `SUPER_ADMIN_EMAILS` a RLS), jen komu má smysl psát.
 */

/**
 * Značka z výlohy, ne zákazník.
 *
 * Seed portfolia (`scripts/seed-portfolio-clients.ts`) zakládá deset značek
 * s `isPortfolio: true` v configu. Vypadají jako tenanti — mají klienta,
 * příspěvky i vlastníka — ale vlastník jsme my, takže churn, spící účet ani
 * aktivace u nich nedávají smysl.
 */
export function isShowcaseConfig(config: unknown): boolean {
    return (config as { isPortfolio?: unknown } | null)?.isPortfolio === true
}

/**
 * Filtr do PostgREST dotazu nad `clients`, který značky z výlohy vynechá.
 *
 * Musí to být `or(is.null, eq.false)`, ne `neq.true`: `config->isPortfolio` je
 * u běžného klienta prostě **není** a `NULL <> true` je v SQL zase NULL, takže
 * `neq` vyhodí i všechny skutečné zákazníky. Ověřeno na produkčních datech —
 * `neq` vrátilo 1 klienta z 26, tenhle tvar správných 14.
 */
export const NOT_SHOWCASE = "config->isPortfolio.is.null,config->isPortfolio.eq.false"

/**
 * Naše vlastní adresa, ne zákazníkova.
 *
 * Pravidlo žilo v `waitlist-invite.ts` a platilo jen pro pozvánky, takže
 * `qa-test-chrlit@example.com` dál sbíral návrhy na waitlistovou připomínku.
 * Doména `@chrlit.cz` i stará `@prodamevas.cz` jsou tu obě — obchodní pošta
 * sama sobě je v lepším případě šum, v horším smyčka.
 */
export function isInternalEmail(email: string | null | undefined): boolean {
    const e = (email || "").trim().toLowerCase()
    if (!e) return true
    return e.endsWith("@example.com")
        || e.includes("qa-test")
        || e.endsWith("@prodamevas.cz")
        || e.endsWith("@chrlit.cz")
}
