/**
 * Jediné místo, kde se čte `SUPER_ADMIN_EMAILS`.
 *
 * Předtím to bylo osmkrát zkopírované `split(",").map(trim).includes(email)`.
 * Porovnání bylo přesné na písmenko a nesundávalo uvozovky — a protože brána při
 * neshodě jen tiše vrátí `false`, jediný překlep v hodnotě odřízne admina od celé
 * admin sekce (Mailing, Šablony, Waitlist, Onboarding…) bez jediného řádku v logu.
 *
 * Hlavní past je rozdíl mezi `.env` a nástěnkou Vercelu: v souboru `dotenv`
 * uvozovky kolem hodnoty sundá, takže lokálně všechno funguje, ale ve Vercelu se
 * vloží do hodnoty a zůstanou v ní. `"admin@x.cz"` se pak nikdy nerovná
 * `admin@x.cz` a rozdíl není v UI vidět. Normalizace proto patří sem, ne
 * k volajícím — ti se musí ptát funkcí, ne parsovat env po svém.
 */

/**
 * Uvozovky se zahazují celé, ne jen párové na krajích: hodnota se do nástěnky
 * vkládá ručně a chybí v ní i jen jedna (`"admin@x.cz`) stejně často jako obě.
 * V praxi se uvozovky v adrese admina nevyskytují — RFC je v quoted local-partu
 * povoluje, ale to je teorie, kvůli které by past zůstala otevřená.
 */
function normalize(value: string): string {
    return value.replace(/["']/g, "").trim().toLowerCase()
}

/** Adresy super-adminů z env, znormalizované. Prázdné pole = nikdo není admin. */
export function superAdminEmails(): string[] {
    return (process.env.SUPER_ADMIN_EMAILS || "")
        .split(",")
        .map(normalize)
        .filter(Boolean)
}

/**
 * Je tahle adresa super-admin? Porovnává se nezávisle na velikosti písmen —
 * Supabase adresy ukládá malými, takže se nedá zaregistrovat jinak psaná
 * varianta a tím se do admin sekce dostat.
 */
export function isSuperAdminEmail(email: string | null | undefined): boolean {
    if (!email) return false
    const needle = normalize(email)
    return needle.length > 0 && superAdminEmails().includes(needle)
}

/** Vypadá to jako adresa? Slouží jen k varování při startu, nic to neblokuje. */
export function looksLikeEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}
