/**
 * Konfigurace next-intl pro každý request (registrovaná v `next.config.ts`).
 * Locale se nebere z URL, ale z cookie/hlavičky — viz `./locales.ts`.
 */

import { getRequestConfig } from "next-intl/server"
import { resolveUiLocale } from "./server"
import { loadMessages } from "./messages"
import { UI_TIME_ZONE } from "./locales"

export default getRequestConfig(async () => {
    const locale = await resolveUiLocale()
    return {
        locale,
        timeZone: UI_TIME_ZONE,
        messages: await loadMessages(locale),
    }
})
