/**
 * Odkazy a escapování pro e-maily.
 * ================================
 * Přesunuto z `lib/notifications.ts`, aby to šlo sdílet i s cestami, které na
 * transakční poštu sáhnout nesmějí (obchodní agent — viz aserce 24.1). Proto
 * tenhle modul **nesmí obsahovat odesílání ani zmínku o Resendu**; hlídá to
 * aserce 29.10.
 */

import { signEmail } from "@/lib/email-sign"

/**
 * Základ pro všechny generované odkazy (odhlášení, deep linky, ukázky).
 *
 * Dvě pasti, obě chycené naostro 2026-08-11:
 *
 *  1. **Zástupný text projde `||`.** V `.env.local` bylo `[SENSITIVE]` —
 *     neprázdný řetězec, takže se použil a všechny odkazy vedly na
 *     `[SENSITIVE]/...`. Stejná chyba jako `[SET_ME]` u HikerAPI klíče.
 *  2. **`chrlit.cz` přesměrovává na `www.chrlit.cz` (308).** Prohlížeč to
 *     přežije, STROJ ne — Stripe webhooky přesměrování nenásledují, takže
 *     platba prošla a plán se neaktivoval. Výchozí hodnota je proto kanonická.
 */
export function siteUrl(): string {
    const v = (process.env.NEXT_PUBLIC_SITE_URL || "").trim()
    const usable = v.startsWith("http") ? v.replace(/\/$/, "") : ""
    if (v && !usable) {
        console.warn(`⚠️ NEXT_PUBLIC_SITE_URL není URL ("${v.slice(0, 20)}") — používám výchozí doménu`)
    }
    return usable || "https://www.chrlit.cz"
}

/**
 * Kanonický původ pro **obrázky v e-mailu** — schválně ne `siteUrl()`.
 *
 * `siteUrl()` vrací `NEXT_PUBLIC_SITE_URL`, což je na preview deploymentu jeho
 * dočasná adresa. Odkaz se dá po rozkliknutí opravit, ale obrázek zapečený do
 * odeslané zprávy žije v cizí schránce navždy — a jakmile Vercel deployment
 * uklidí, je z něj natrvalo 404.
 */
export const MAIL_ASSET_ORIGIN = "https://www.chrlit.cz"

/** Absolutní adresa statického assetu pro `<img>` v e-mailu. */
export function assetUrl(path: string): string {
    return `${MAIL_ASSET_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`
}

/** Deep link into the studio: selects the project (?project=) and opens a tab (#hash). */
export function studioDeepLink(clientId: string, section: string = "calendar"): string {
    return `${siteUrl()}/dashboard/instagram?project=${encodeURIComponent(clientId)}#${section}`
}

/**
 * Podepsaný odkaz na jednoklikové odhlášení.
 *
 * Tvar `?e=&s=` musí souhlasit s `app/api/email/unsubscribe/route.ts`. Dřív se
 * skládal na dvou místech zvlášť (transakční patička a obchodní oslovení), což
 * je přesně ten druh duplicity, kde se jedna kopie časem rozejde a půlka
 * odhlašovacích odkazů tiše přestane fungovat.
 */
export function unsubscribeUrl(email: string): string {
    const addr = email.trim().toLowerCase()
    return `${siteUrl()}/api/email/unsubscribe?e=${encodeURIComponent(addr)}&s=${signEmail(addr)}`
}

export function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
