/**
 * Otevření platební brány, které nespolkne blokátor oken.
 * =======================================================
 * `window.open(url, "_blank")` volané AŽ PO `await fetch(...)` prohlížeč nepovažuje
 * za akci vyvolanou uživatelem — kliknutí už dávno skončilo — a tiše ho zablokuje.
 * Uživatel klikne na „Přejít na Růst", server v pořádku založí checkout session
 * (ověřeno na produkci: řádek v `payments` vznikl, provider_ref `cs_test_…`),
 * odkaz se vrátí — a nestane se nic. Nerozeznatelné od „tlačítko nefunguje".
 *
 * Řešení: okno se otevře PRÁZDNÉ ještě v synchronní části obsluhy kliknutí, kdy na
 * něj gesto uživatele ještě „platí", a adresa se do něj doplní až potom.
 *
 * Když se okno nepodaří otevřít ani tak (přísný blokátor, in-app prohlížeč),
 * přesměrujeme rovnou v aktuální kartě. U platby je odchod z aplikace v pořádku —
 * návrat řeší callback brány — a je to nekonečně lepší než mlčení.
 */

export interface CheckoutWindow {
    /** Doplní adresu do dřív otevřeného okna, nebo přesměruje aktuální kartu. */
    go: (url: string) => void
    /** Zavře prázdné okno, když platba nakonec nevznikne (chyba serveru). */
    abort: () => void
}

/**
 * Zavolej SYNCHRONNĚ na začátku obsluhy kliknutí, ještě před jakýmkoli `await`.
 * Vrácený objekt použij po dokončení požadavku.
 */
export function openCheckoutWindow(): CheckoutWindow {
    let win: Window | null = null
    try {
        win = window.open("", "_blank")
        if (win) {
            // Prázdné okno vypadá jako pád prohlížeče; tohle drží uživatele v obraze,
            // než brána odpoví. Přepíše se přesměrováním.
            win.document.write(
                '<!doctype html><meta charset="utf-8"><title>Přesměrování na platbu…</title>' +
                '<body style="margin:0;display:grid;place-items:center;height:100vh;' +
                'background:#050505;color:#fff;font:600 13px/1.6 system-ui,sans-serif">' +
                'Připravuji platební bránu…</body>'
            )
        }
    } catch {
        win = null
    }

    return {
        go: (url: string) => {
            if (win && !win.closed) win.location.href = url
            else window.location.href = url
        },
        abort: () => {
            try { if (win && !win.closed) win.close() } catch { /* nevadí */ }
        },
    }
}
