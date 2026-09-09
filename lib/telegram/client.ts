/**
 * Telegram Bot API — jediná brána ven do skupiny (server-only).
 * =============================================================
 * Stejná role jako `gemini-client.ts` u modelů: jedno místo, kde se drží token,
 * jedno místo k auditu při úniku, jedno místo k opravě, až se endpoint pohne.
 *
 * Tři věci, které Bot API nedělá tak, jak by člověk čekal, a stály by ladění:
 *
 *  1. **4096 znaků je tvrdý strop na zprávu.** Delší text neprojde ořezaný —
 *     celé volání skončí 400. Brief o osmi sekcích tenhle strop reálně
 *     přeleze, takže se dělí tady, ne u volajícího.
 *  2. **`parse_mode: HTML` je přísný parser, ne prohlížeč.** Nezavřený tag
 *     nebo holé `<` v textu shodí CELOU zprávu. Proto `esc()` a proto se
 *     výsledek při chybě parsování pošle ještě jednou jako čistý text —
 *     zpráva o selhané platbě musí dorazit i ošklivá.
 *  3. **Zpráva z Bot API se dá poslat jen do chatu, který bota zná.** Dokud
 *     někdo bota do skupiny nepřidá, každé volání vrátí 400 „chat not found".
 *
 * Nic tady nevyhazuje ven (mimo `telegramCall`, které si volající ošetřují) —
 * stejná politika jako `sendNotification`: selhání zprávy nesmí shodit tok,
 * který ji vyvolal (webhook, cron, platební callback).
 */

import { withRetry } from "@/utils/retry"
import { teamChatId } from "./team"

const API_BASE = "https://api.telegram.org"

/** Bot API strop na jednu textovou zprávu. Delší text = 400, ne ořez. */
const MAX_MESSAGE_CHARS = 4096
/** Rezerva pod stropem: HTML entity nabobtnají až šestinásobně (`&` → `&amp;`),
 *  a délku počítá Telegram po jejich rozbalení. 200 znaků stačí i na text
 *  poskládaný ze samých ampersandů. */
const CHUNK_BUDGET = MAX_MESSAGE_CHARS - 200

function botToken(): string {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
    if (!token) {
        // Není to přechodná chyba — retry nepomůže, jen zahltí log.
        throw new Error("TELEGRAM_BOT_TOKEN není nastavený — telegramový kanál není v této instalaci nakonfigurovaný.")
    }
    return token
}

/**
 * Escape do Telegramového HTML podmnožiny.
 *
 * Telegram povoluje jen `& < >` jako entity; apostrof ani uvozovku escapovat
 * nechce (a `&quot;` by se v textu ukázal doslova). Proto NENÍ možné použít
 * `escapeHtml` z `lib/mail/links.ts` — ten je psaný pro e-mail a uvozovky
 * escapuje, protože je vkládá do atributů.
 */
export function esc(text: string): string {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** Tlačítko pod zprávou. `callbackData` má tvrdý strop 64 BAJTŮ (ne znaků). */
export interface InlineButton {
    text: string
    callbackData: string
}

interface TelegramResponse<T = unknown> {
    ok: boolean
    result?: T
    description?: string
    error_code?: number
}

/**
 * Jedno volání Bot API. Vyhazuje při chybě — volající rozhodne, jestli ji
 * spolknout (odesílání zpráv) nebo předat dál (setWebhook ze skriptu).
 */
export async function telegramCall<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
    const token = botToken()
    return withRetry(async () => {
        const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        })
        const json = (await res.json().catch(() => ({ ok: false, description: "nečitelná odpověď" }))) as TelegramResponse<T>
        if (!res.ok || !json.ok) {
            // 429 a 5xx nechá withRetry zopakovat (jeho slovník transientních
            // chyb zabírá na „rate limit"); 400 je konfigurace nebo náš tvar
            // zprávy a opakování by jen zdrželo.
            throw new Error(`Telegram ${method} ${res.status}: ${json.description || "bez popisu"}`)
        }
        return json.result as T
    }, 3, `telegram:${method}`)
}

/**
 * Rozdělení dlouhého textu na zprávy pod stropem.
 *
 * Dělí se na hranici odstavce, a teprve když ani jeden odstavec nestačí, na
 * hranici řádku. Uprostřed HTML tagu se dělit nesmí — rozpůlený `<b>` shodí
 * obě půlky, takže odstavec, který se sám o sobě nevejde, se posílá vcelku
 * a nechá se na Telegramu, ať řekne ne (viditelné selhání > tichý zmatek).
 */
export function splitMessage(text: string, budget = CHUNK_BUDGET): string[] {
    if (text.length <= budget) return [text]

    const chunks: string[] = []
    let current = ""

    const flush = () => {
        if (current.trim()) chunks.push(current.trimEnd())
        current = ""
    }

    for (const block of text.split(/\n\n/)) {
        const candidate = current ? `${current}\n\n${block}` : block
        if (candidate.length <= budget) {
            current = candidate
            continue
        }
        flush()
        if (block.length <= budget) {
            current = block
            continue
        }
        // Jediný obří odstavec — dělíme po řádcích.
        for (const line of block.split("\n")) {
            const lineCandidate = current ? `${current}\n${line}` : line
            if (lineCandidate.length <= budget) {
                current = lineCandidate
            } else {
                flush()
                current = line
            }
        }
    }
    flush()
    return chunks.length > 0 ? chunks : [text.slice(0, budget)]
}

export interface SendOptions {
    /** Kam. Výchozí je týmová skupina z `TELEGRAM_CHAT_ID`. */
    chatId?: string | number
    /** Tlačítka pod zprávou. Připnou se jen k POSLEDNÍMU dílu dlouhé zprávy. */
    buttons?: InlineButton[][]
    /** Odpověď na konkrétní zprávu (vlákno v Telegramu). */
    replyToMessageId?: number
    /** Bez zvuku — pro rutinní hlášení, co nemají budit telefon. */
    silent?: boolean
}

export interface SentMessage {
    messageId: number
    chatId: string
}

/**
 * Pošle zprávu do skupiny. NIKDY nevyhazuje — vrátí null, když se to nepovede.
 *
 * Když Telegram odmítne HTML (náš tag, který se nepovedlo escapovat), pošle se
 * tentýž text ještě jednou bez `parse_mode`. Zpráva s viditelnými značkami je
 * pořád nekonečně lepší než hlášení o problému, které nikam nedorazilo.
 */
export async function sendTelegram(text: string, opts: SendOptions = {}): Promise<SentMessage | null> {
    const chatId = opts.chatId ?? teamChatId()
    if (!chatId) {
        console.warn("telegram: TELEGRAM_CHAT_ID není nastavený — zpráva se nikam neposlala")
        return null
    }

    const parts = splitMessage(text)
    let last: SentMessage | null = null

    for (let i = 0; i < parts.length; i++) {
        const isLast = i === parts.length - 1
        const payload: Record<string, unknown> = {
            chat_id: chatId,
            text: parts[i],
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
            disable_notification: opts.silent === true,
        }
        if (isLast && opts.buttons?.length) {
            payload.reply_markup = {
                inline_keyboard: opts.buttons.map(row =>
                    row.map(b => ({ text: b.text, callback_data: b.callbackData })),
                ),
            }
        }
        if (i === 0 && opts.replyToMessageId) {
            payload.reply_parameters = { message_id: opts.replyToMessageId, allow_sending_without_reply: true }
        }

        try {
            const result = await telegramCall<{ message_id: number }>("sendMessage", payload)
            last = { messageId: result.message_id, chatId: String(chatId) }
        } catch (err) {
            const message = (err as Error)?.message || ""
            if (/can't parse entities|unsupported start tag|unclosed/i.test(message)) {
                try {
                    const plain = { ...payload }
                    delete plain.parse_mode
                    const result = await telegramCall<{ message_id: number }>("sendMessage", {
                        ...plain,
                        text: parts[i].replace(/<[^>]+>/g, ""),
                    })
                    last = { messageId: result.message_id, chatId: String(chatId) }
                    console.warn(`telegram: HTML odmítnuto, posláno jako čistý text (${message})`)
                    continue
                } catch { /* propadne do warnu níž */ }
            }
            console.warn(`telegram: zprávu se nepodařilo poslat — ${message}`)
            return last
        }
    }
    return last
}

/**
 * Odpověď na stisk tlačítka. Telegram na tlačítku točí „hodinky", dokud tohle
 * nedorazí — a po ~15 vteřinách ho označí za rozbité. Volá se PRVNÍ, ještě
 * před vlastní prací, ne až s výsledkem.
 */
export async function answerCallback(callbackQueryId: string, text?: string, alert = false): Promise<void> {
    try {
        await telegramCall("answerCallbackQuery", {
            callback_query_id: callbackQueryId,
            ...(text ? { text: text.slice(0, 200), show_alert: alert } : {}),
        })
    } catch (err) {
        console.warn(`telegram: answerCallbackQuery selhalo — ${(err as Error)?.message}`)
    }
}

/**
 * Přepíše už odeslanou zprávu — po rozhodnutí se z „[Schválit] [Zamítnout]"
 * stane „✅ Schválil Thomas". Tlačítka, která už nic nedělají, se musí
 * odstranit: druhý stisk by jinak vypadal jako by se nic nestalo.
 */
export async function editTelegram(
    chatId: string | number,
    messageId: number,
    text: string,
): Promise<void> {
    try {
        await telegramCall("editMessageText", {
            chat_id: chatId,
            message_id: messageId,
            text: splitMessage(text)[0],
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
            reply_markup: { inline_keyboard: [] },
        })
    } catch (err) {
        console.warn(`telegram: editMessageText selhalo — ${(err as Error)?.message}`)
    }
}

/** Registrace webhooku. Volá se ze skriptu, ne za běhu — proto vyhazuje. */
export async function setWebhook(url: string, secretToken: string): Promise<void> {
    await telegramCall("setWebhook", {
        url,
        secret_token: secretToken,
        // Přesně to, co umíme obsloužit. `message` nese i příkazy.
        allowed_updates: ["message", "callback_query"],
        // Resty z doby, kdy byl webhook jinde, nechceme přehrát.
        drop_pending_updates: true,
    })
}

export async function getMe(): Promise<{ id: number; username?: string; first_name?: string }> {
    return telegramCall("getMe", {})
}
