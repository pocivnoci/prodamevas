import { NextIntlClientProvider } from "next-intl"
import { getLocale, getMessages } from "next-intl/server"
import { HtmlLang } from "./HtmlLang"

/**
 * Obálka pro části aplikace, které mluví jazykem uživatele: dashboard a auth
 * stránky. Kořenový layout ji nemá schválně — je statický a marketing je česky.
 * Zpráv se posílá celý soubor: dashboard je jedna stránka s dvaceti taby, takže
 * se stejně načte všechno.
 */
export async function UiLocaleProvider({ children }: { children: React.ReactNode }) {
    const locale = await getLocale()
    const messages = await getMessages()
    return (
        <NextIntlClientProvider locale={locale} messages={messages}>
            <HtmlLang locale={locale} />
            {children}
        </NextIntlClientProvider>
    )
}
