/**
 * Jazyk UI — vlastnost UŽIVATELE.
 * ================================
 * Druhá jazyková osa (první je jazyk značky, `instagram/language.ts`). Tenhle modul
 * je bez závislostí a smí ho importovat klient i server: drží jen seznam locale,
 * jméno cookie a heuristiky nad hlavičkou prohlížeče. Čtení cookies a headers je
 * v `./server.ts`, přepnutí v `app/actions/locale-actions.ts`.
 *
 * Bez prefixu v URL schválně: dashboard je hash-SPA (`#posts`) a marketingové
 * adresy jsou indexované — `/en/…` by rozbilo hluboké odkazy i SEO.
 *
 * Pořadí rozhodování (viz `resolveUiLocale`): cookie → `Accept-Language` → čeština.
 * Volba přihlášeného uživatele se ukládá i do `user_metadata.locale`, aby přežila
 * nové zařízení; do cookie se z ní opisuje při přihlášení (`syncLocaleCookieFromUser`).
 */

export const UI_LOCALES = ["cs", "en"] as const
export type UiLocale = (typeof UI_LOCALES)[number]

export const DEFAULT_UI_LOCALE: UiLocale = "cs"

/** Jméno, které next-intl i dokumentace považují za konvenci. */
export const LOCALE_COOKIE = "NEXT_LOCALE"
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** Vlastní jméno jazyka — v přepínači se každý jazyk píše sám sebou. */
export const UI_LOCALE_NAMES: Record<UiLocale, string> = {
    cs: "Čeština",
    en: "English",
}

/** BCP-47 pro `Intl` (data, čísla). Angličtina evropská: 12. 9. 2026, ne 9/12/2026. */
export const UI_LOCALE_TAGS: Record<UiLocale, string> = {
    cs: "cs-CZ",
    en: "en-GB",
}

/** Časová zóna pro formátování dat v UI — produkt je pražský (posting times jsou pražské). */
export const UI_TIME_ZONE = "Europe/Prague"

export function isUiLocale(value: unknown): value is UiLocale {
    return typeof value === "string" && (UI_LOCALES as readonly string[]).includes(value)
}

/**
 * První podporovaný jazyk z `Accept-Language`, v pořadí, jak ho prohlížeč seřadil
 * (`en-US,en;q=0.9,cs;q=0.8` → en). Základ jazyka stačí: `en-US` je angličtina.
 * Nic podporovaného = null, ať si volající zvolí default sám.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): UiLocale | null {
    if (!header) return null
    const ranked = header
        .split(",")
        .map((part, index) => {
            const [tag, ...params] = part.trim().split(";")
            const q = params.map(p => p.trim()).find(p => p.startsWith("q="))
            const weight = q ? Number(q.slice(2)) : 1
            return { base: tag.trim().toLowerCase().split("-")[0], weight: Number.isFinite(weight) ? weight : 0, index }
        })
        .filter(r => r.weight > 0)
        .sort((a, b) => b.weight - a.weight || a.index - b.index)
    for (const r of ranked) if (isUiLocale(r.base)) return r.base
    return null
}
