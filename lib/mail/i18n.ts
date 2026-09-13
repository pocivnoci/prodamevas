/**
 * Překladač pro e-maily — bez request kontextu.
 * ==============================================
 * E-maily se skládají v callbacku, v cronech a v agentech, kde `getTranslations()`
 * z next-intl nemá odkud vzít cookie. `createTranslator` pracuje nad stejnými
 * zprávami (`messages/<locale>/mail.json`, `notices.json`, `worker.json`) a stejným ICU, jen mu
 * jazyk příjemce řekne volající — typicky z `user_metadata.locale` (`localeOfUser`)
 * nebo z účtu vlastníka značky (`localeOfClientOwner`).
 *
 * Zprávy e-mailů jsou naimportované staticky, aby šel překladač postavit i
 * SYNCHRONNĚ (`mailTranslatorSync`): šablony v `lib/mail/templates` jsou čisté
 * funkce `vars → draft` a registr je renderuje bez `await` (náhled v Mailingu,
 * guard bez `.env.local`). Jde jen o dva malé soubory na jazyk, ne o celé UI.
 */

import { createTranslator } from "next-intl"
import { DEFAULT_UI_LOCALE, isUiLocale, type UiLocale } from "@/lib/i18n/locales"
import csMail from "@/messages/cs/mail.json"
import enMail from "@/messages/en/mail.json"
import csNotices from "@/messages/cs/notices.json"
import enNotices from "@/messages/en/notices.json"
import csWorker from "@/messages/cs/worker.json"
import enWorker from "@/messages/en/worker.json"

export type MailNamespace = "mail" | "notices" | "worker"

type MailMessages = Parameters<typeof createTranslator>[0]["messages"]
const MAIL_MESSAGES: Record<UiLocale, MailMessages> = {
    cs: { ...csMail, ...csNotices, ...csWorker } as MailMessages,
    en: { ...enMail, ...enNotices, ...enWorker } as MailMessages,
}

export type MailTranslator = ReturnType<typeof createTranslator>

/** Jazyk z účtu Supabase; cokoli neznámého = čeština. */
export function localeOfUser(user: { user_metadata?: Record<string, unknown> | null } | null | undefined): UiLocale {
    const value = user?.user_metadata?.locale
    return isUiLocale(value) ? value : DEFAULT_UI_LOCALE
}

/**
 * Jazyk vlastníka značky — příjemce zákaznických oznámení. Stejné řazení jako
 * `getOwnerEmail` (nejnovější vazba `owner` vyhrává): oznámení musí mluvit
 * jazykem toho, komu přijde. Bez vlastníka nebo mimo DB = čeština.
 */
export async function localeOfClientOwner(clientId: string): Promise<UiLocale> {
    try {
        const { default: supabaseAdmin } = await import("@/supabase/admin")
        const { data: link } = await supabaseAdmin
            .from("user_clients")
            .select("user_id")
            .eq("client_id", clientId)
            .eq("role", "owner")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        if (!link) return DEFAULT_UI_LOCALE
        const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(link.user_id)
        return localeOfUser(user)
    } catch {
        return DEFAULT_UI_LOCALE
    }
}

/** Synchronní překladač — pro čisté šablony (`build(vars, t)`) a registr. */
export function mailTranslatorSync(locale: UiLocale, namespace: MailNamespace = "mail"): MailTranslator {
    const safe = isUiLocale(locale) ? locale : DEFAULT_UI_LOCALE
    return createTranslator({ locale: safe, messages: MAIL_MESSAGES[safe], namespace })
}

/** Asynchronní varianta — kvůli stávajícím volajícím; dělá totéž co `mailTranslatorSync`. */
export async function mailTranslator(locale: UiLocale, namespace: MailNamespace = "mail"): Promise<MailTranslator> {
    return mailTranslatorSync(locale, namespace)
}
