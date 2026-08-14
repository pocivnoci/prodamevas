/**
 * Odchod na platební bránu.
 * =========================
 * Přesměrovává AKTUÁLNÍ kartu. Vypadá to jako ústupek, ale je to jediná varianta,
 * která funguje všude — a u platby je to zároveň správné chování.
 *
 * PROČ NE NOVÉ OKNO
 * ─────────────────
 * Původně tu bylo `window.open(url, "_blank")` volané až po `await fetch(...)`.
 * V tu chvíli prohlížeč kliknutí už nepovažuje za živé gesto a okno tiše zahodí:
 * uživatel klikne na tarif, server v pořádku založí checkout session — a nestane
 * se nic.
 *
 * První oprava otevírala okno prázdné ještě v synchronní části obsluhy a adresu
 * do něj doplnila potom. V prohlížeči to zabralo, v NAINSTALOVANÉ APLIKACI ne:
 * ve standalone režimu `window.open` buď nic neudělá, nebo vrátí okno, které
 * nikam nevede — a záloha se nespustí, protože formálně žádná chyba nenastala.
 * Ověřeno na produkci: kliknutí založilo Stripe session `cs_test_a1G3Ymr…`,
 * ale uživatel zůstal stát na místě.
 *
 * Nové okno má jedinou výhodu — aplikace zůstane otevřená. To za tichý pád
 * platby nestojí. Brána se po zaplacení i po zrušení vrací zpátky, takže
 * přesměrování aktuální karty je u checkoutu běžný standard, ne omezení.
 */

export interface CheckoutWindow {
    /** Odejde na bránu. */
    go: (url: string) => void
    /** Platba nakonec nevznikla — u přesměrování aktuální karty není co uklízet. */
    abort: () => void
}

/**
 * Volá se na začátku obsluhy kliknutí, ještě před `await`. Vrácený objekt se
 * použije po odpovědi serveru.
 *
 * Tvar API zůstal z doby, kdy se otevíralo nové okno: volající si drží handle
 * přes celý požadavek. Dává smysl i teď — kdyby se sem někdy vracelo chování
 * závislé na gestu uživatele, je pro něj místo připravené.
 */
export function openCheckoutWindow(): CheckoutWindow {
    return {
        go: (url: string) => {
            // `assign` místo přiřazení do `href`: chová se stejně, ale nechává
            // stránku v historii, takže „zpět" z brány vrátí uživatele do aplikace.
            window.location.assign(url)
        },
        abort: () => { /* nic k úklidu — nikam jsme neodešli */ },
    }
}
