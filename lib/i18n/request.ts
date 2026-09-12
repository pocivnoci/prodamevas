/**
 * Konfigurace next-intl pro každý request (registrovaná v `next.config.ts`).
 * Locale se nebere z URL, ale z cookie/hlavičky — viz `./locales.ts`.
 */

import { getRequestConfig } from "next-intl/server"
import { resolveUiLocale } from "./server"
import { loadMessages } from "./messages"
import { UI_TIME_ZONE, isUiLocale } from "./locales"

export default getRequestConfig(async ({ requestLocale }) => {
    // Bez routování je `requestLocale` prázdné — kromě volání s explicitním
    // jazykem (`getTranslations({ locale })`), které musí vyhrát nad cookie.
    const requested = await requestLocale
    const locale = isUiLocale(requested) ? requested : await resolveUiLocale()
    return {
        locale,
        timeZone: UI_TIME_ZONE,
        messages: await loadMessages(locale),
    }
})
