/**
 * Jazyk UI na serveru — čtení cookie a hlavičky, opis z účtu do cookie.
 * Jen pro server (next/headers); klientská část je v `./locales.ts`.
 */

import { cookies, headers } from "next/headers"
import {
    DEFAULT_UI_LOCALE, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, isUiLocale,
    localeFromAcceptLanguage, type UiLocale,
} from "./locales"

export function localeCookieOptions() {
    return {
        path: "/",
        maxAge: LOCALE_COOKIE_MAX_AGE,
        sameSite: "lax" as const,
        secure: process.env.NODE_ENV === "production",
    }
}

/** cookie → Accept-Language → čeština. Nic dalšího se tu nedomýšlí. */
export async function resolveUiLocale(): Promise<UiLocale> {
    const jar = await cookies()
    const fromCookie = jar.get(LOCALE_COOKIE)?.value
    if (isUiLocale(fromCookie)) return fromCookie
    const h = await headers()
    return localeFromAcceptLanguage(h.get("accept-language")) ?? DEFAULT_UI_LOCALE
}

/**
 * Po přihlášení: volba uložená u účtu (`user_metadata.locale`) vyhrává nad tím,
 * co náhodou sedí v cookie tohohle prohlížeče. Volat jen z server action nebo
 * route handleru — jinde Next zápis cookie odmítne.
 */
export async function syncLocaleCookieFromUser(user: { user_metadata?: Record<string, unknown> | null } | null | undefined): Promise<void> {
    const preferred = user?.user_metadata?.locale
    if (!isUiLocale(preferred)) return
    const jar = await cookies()
    if (jar.get(LOCALE_COOKIE)?.value === preferred) return
    jar.set(LOCALE_COOKIE, preferred, localeCookieOptions())
}

/**
 * Jazyk platební stránky (ComGate `lang`, Stripe `locale`) = jazyk UI, ve kterém
 * kupující právě klikl na „Zaplatit". Brány umí jen podmnožinu; co neumí, jede
 * anglicky, ne česky.
 */
export async function paymentPageLanguage(): Promise<"cs" | "en"> {
    const locale = await resolveUiLocale()
    return locale === "cs" ? "cs" : "en"
}

/** Jazyk, který si návštěvník zvolil ještě před registrací — ať se uloží k účtu. */
export async function currentLocaleCookie(): Promise<UiLocale | null> {
    const jar = await cookies()
    const value = jar.get(LOCALE_COOKIE)?.value
    return isUiLocale(value) ? value : null
}
