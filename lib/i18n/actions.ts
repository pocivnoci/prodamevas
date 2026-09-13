/**
 * Překladač pro server actions.
 * =============================
 * Hlášky, které akce vrací do UI (`{ success: false, error }`, `message`,
 * `warning`), jdou v jazyce toho, kdo na tlačítko klikl — `getTranslations()`
 * si ho vezme z request configu (cookie). Tytéž funkce ale volají i crony,
 * agenti a skripty, kde žádný request není a `cookies()` vyhodí výjimku:
 * tam se spadne na češtinu přes `createTranslator`, ne na výjimku.
 *
 * Použití v akci (uvnitř funkce, ne na úrovni modulu — request je per volání):
 *   const t = await actionTranslator("actionsContent")
 *   return { success: false, error: t("post.notFound") }
 */

import { getTranslations } from "next-intl/server"
import { createTranslator } from "next-intl"
import { loadMessages } from "./messages"
import { DEFAULT_UI_LOCALE } from "./locales"

export type ActionTranslator = ((key: string, values?: Record<string, string | number | Date>) => string) & {
    has: (key: string) => boolean
}

export async function actionTranslator(namespace: string): Promise<ActionTranslator> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let base: any
    try {
        base = await getTranslations(namespace)
    } catch {
        const messages = await loadMessages(DEFAULT_UI_LOCALE)
        base = createTranslator({
            locale: DEFAULT_UI_LOCALE,
            messages: messages as Parameters<typeof createTranslator>[0]["messages"],
            namespace,
        })
    }
    const t = ((key: string, values?: Record<string, string | number | Date>) => base(key, values)) as ActionTranslator
    t.has = (key: string) => base.has(key)
    return t
}
