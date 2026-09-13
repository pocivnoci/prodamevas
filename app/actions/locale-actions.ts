"use server"

import { cookies } from "next/headers"
import { createClient } from "@/supabase/server"
import { LOCALE_COOKIE, isUiLocale } from "@/lib/i18n/locales"
import { localeCookieOptions } from "@/lib/i18n/server"
import { actionTranslator } from "@/lib/i18n/actions"

/**
 * Přepnutí jazyka UI. Cookie platí hned (i pro nepřihlášeného), přihlášenému se
 * volba uloží k účtu, aby ji dostal i na jiném zařízení. Selhání zápisu k účtu
 * volbu neshodí — cookie už sedí a metadata se dopíšou příště.
 */
export async function setUiLocale(locale: string): Promise<{ success: boolean; error?: string }> {
    if (!isUiLocale(locale)) {
        const t = await actionTranslator("actionsAccount")
        return { success: false, error: t("locale.setUiLocale.unsupported", { locale }) }
    }

    const jar = await cookies()
    jar.set(LOCALE_COOKIE, locale, localeCookieOptions())

    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (user && user.user_metadata?.locale !== locale) {
            const { error } = await supabase.auth.updateUser({ data: { locale } })
            if (error) console.warn(`setUiLocale: volba se neuložila k účtu ${user.id}: ${error.message}`)
        }
    } catch (err) {
        console.warn(`setUiLocale: ${(err as Error)?.message}`)
    }
    return { success: true }
}
