/**
 * Překladač pro e-maily — bez request kontextu.
 * ==============================================
 * E-maily se skládají v callbacku, v cronech a v agentech, kde `getTranslations()`
 * z next-intl nemá odkud vzít cookie. `createTranslator` pracuje nad stejnými
 * zprávami (`messages/<locale>/mail.json`) a stejným ICU, jen mu jazyk příjemce
 * řekne volající — typicky z `user_metadata.locale` (`localeOfUser`).
 */

import { createTranslator } from "next-intl"
import { DEFAULT_UI_LOCALE, isUiLocale, type UiLocale } from "@/lib/i18n/locales"
import { loadMessages } from "@/lib/i18n/messages"

/** Jazyk z účtu Supabase; cokoli neznámého = čeština. */
export function localeOfUser(user: { user_metadata?: Record<string, unknown> | null } | null | undefined): UiLocale {
    const value = user?.user_metadata?.locale
    return isUiLocale(value) ? value : DEFAULT_UI_LOCALE
}

export async function mailTranslator(locale: UiLocale) {
    const messages = await loadMessages(locale)
    return createTranslator({ locale, messages: messages as Parameters<typeof createTranslator>[0]["messages"], namespace: "mail" })
}
