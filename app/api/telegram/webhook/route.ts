import { after, NextResponse } from "next/server"
import supabaseAdmin from "@/supabase/admin"
import { answerCallback, editTelegram, esc, sendTelegram } from "@/lib/telegram/client"
import { approvalButtons, parseCallbackData } from "@/lib/telegram/actions"
import { canApprove, findMember, isOurChat, isTelegramConfigured } from "@/lib/telegram/team"
import { decideReply } from "@/lib/agents/telegram-agent"
import { approveAction, rejectAction } from "@/lib/agent-safety"

export const maxDuration = 300
// Webhook nesmí být nikdy staticky vyhodnocený ani cachovaný — každý update je
// jiný a odpověď se nesmí sdílet mezi voláními.
export const dynamic = "force-dynamic"

/**
 * POST /api/telegram/webhook
 * ==========================
 * Vstup ze skupinového kanálu (zakladatel + manažer + investor + agent).
 *
 * Čtyři brány, každá zavírá jinou díru — a všechny jsou PŘED jakoukoli prací:
 *
 *  1. **Secret token.** Adresa webhooku je veřejná. `X-Telegram-Bot-Api-Secret-Token`
 *     je jediný důkaz, že POST přišel od Telegramu a ne od někoho, kdo URL uhodl.
 *     Porovnává se v konstantním čase — délka i obsah.
 *  2. **Náš chat.** Bota může do libovolného chatu přidat kdokoli, kdo zná jeho
 *     jméno, a psát mu i soukromě. Cokoli mimo `TELEGRAM_CHAT_ID` se zahazuje
 *     bez odpovědi: cizí chat se nesmí dozvědět ani to, že bot funguje.
 *  3. **Dedupe.** `update_id` je UNIQUE. Zápis řádku JE claim na zpracování
 *     (viz „podmíněný claim, nikdy insert fallback" v CLAUDE.md) — Telegramův
 *     retry po timeoutu narazí na konflikt a skončí, místo aby agent odpověděl
 *     nebo schválil dvakrát.
 *  4. **Role.** Schvalovat smí jen `founder`/`manager`. Členství ve skupině
 *     pravomoc nedává — viz `lib/telegram/team.ts`.
 *
 * Odpověď 200 letí HNED a práce běží v `after()`. Telegram čeká na ACK a po
 * timeoutu update opakuje; kdybychom drželi spojení po dobu volání modelu,
 * vyrobili bychom si přesně ty duplicitní updaty, proti kterým stojí brána 3.
 *
 * Auth výjimka: tahle routa NEMÁ `requireAuth()` — nemá uživatelskou session,
 * autentizuje ji secret token. Stejná třída jako platební webhooky.
 */

/** Co Telegram posílá (jen to, co čteme — zbytek payloadu ignorujeme). */
interface TelegramUpdate {
    update_id: number
    message?: {
        message_id: number
        chat: { id: number | string; type?: string }
        from?: { id: number; is_bot?: boolean; first_name?: string; username?: string }
        text?: string
        reply_to_message?: { from?: { is_bot?: boolean } }
        entities?: { type: string; offset: number; length: number }[]
    }
    callback_query?: {
        id: string
        from: { id: number; first_name?: string }
        data?: string
        message?: { message_id: number; chat: { id: number | string }; text?: string }
    }
}

/** Porovnání tajemství bez časového úniku. */
function secretMatches(received: string | null): boolean {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET?.trim()
    if (!expected || !received) return false
    if (received.length !== expected.length) return false
    let diff = 0
    for (let i = 0; i < expected.length; i++) diff |= received.charCodeAt(i) ^ expected.charCodeAt(i)
    return diff === 0
}

/**
 * Zapíše update a tím si ho zabere. `false` = tenhle update už někdo zpracoval.
 *
 * Konflikt na UNIQUE (23505) je OČEKÁVANÝ stav, ne chyba — je to přesně ten
 * retry, kvůli kterému tu ten index je.
 */
async function claimUpdate(row: Record<string, unknown>): Promise<boolean> {
    const { error } = await supabaseAdmin.from("telegram_messages").insert(row)
    if (!error) return true
    if (error.code === "23505") return false
    // Nedostupná DB nesmí shodit ACK — radši zpracovat bez paměti než nechat
    // Telegram tlouct retry do routy, která stejně nemá kam zapsat.
    console.warn(`telegram: zápis updatu selhal (${error.code}) — ${error.message}`)
    return true
}

/** Zápis boční zprávy od agenta (odpověď, brief, výsledek schválení). */
async function recordBotMessage(opts: {
    chatId: string | number
    messageId?: number
    text: string
    reason: string
}): Promise<void> {
    // Botovy vlastní zprávy nemají `update_id` — Telegram ho dává jen příchozím.
    // Záporná, klesající řada je drží mimo obor příchozích, takže UNIQUE index
    // dál chrání jen to, co má.
    const syntheticId = -Date.now() - Math.floor(Math.random() * 1000)
    await supabaseAdmin.from("telegram_messages").insert({
        update_id: syntheticId,
        chat_id: String(opts.chatId),
        message_id: opts.messageId ?? null,
        is_bot: true,
        author: "Chrlit",
        text: opts.text,
        replied: true,
        reply_reason: opts.reason,
    }).then(({ error }) => {
        if (error) console.warn(`telegram: zápis odpovědi selhal — ${error.message}`)
    })
}

/** Byl bot osloven? Zmínka `@bot`, nebo odpověď na jeho zprávu. */
function isAddressed(message: NonNullable<TelegramUpdate["message"]>): boolean {
    if (message.reply_to_message?.from?.is_bot) return true
    const text = message.text || ""
    if (text.startsWith("/")) return true
    const username = process.env.TELEGRAM_BOT_USERNAME?.trim()
    if (username && text.toLowerCase().includes(`@${username.toLowerCase().replace(/^@/, "")}`)) return true
    // Bez nastaveného jména bereme jako oslovení aspoň mention entitu.
    return (message.entities || []).some(e => e.type === "mention")
}

// ── Zpracování textové zprávy ──────────────────────────────────────────────

async function handleMessage(update: TelegramUpdate): Promise<void> {
    const message = update.message!
    const chatId = message.chat.id
    const text = (message.text || "").trim()
    const member = findMember(message.from?.id)

    const claimed = await claimUpdate({
        update_id: update.update_id,
        chat_id: String(chatId),
        message_id: message.message_id,
        tg_user_id: message.from?.id ?? null,
        author: member?.name || message.from?.first_name || message.from?.username || "neznámý",
        team_role: member?.role ?? null,
        is_bot: Boolean(message.from?.is_bot),
        text,
    })
    if (!claimed) return                       // retry téhož updatu
    if (message.from?.is_bot) return           // vlastní zprávy nekomentujeme
    if (!text) return

    // Příkazy obsluhuje kód, ne model: `/stav` musí vrátit čísla i ve chvíli,
    // kdy je Anthropic nedostupný nebo chybí klíč.
    if (text.startsWith("/")) {
        const handled = await handleCommand(text, chatId, message.message_id, message.from?.id)
        if (handled) return
    }

    const decision = await decideReply({
        chatId,
        latestText: text,
        author: member,
        addressed: isAddressed(message),
    })
    if (!decision.respond) return

    // Záměr se provádí až po ověření role — model o pravomoci nerozhoduje.
    let suffix = ""
    if (decision.intent !== "none" && decision.actionId) {
        if (!canApprove(message.from?.id)) {
            suffix = "\n\n<i>Schvalovat může jen zakladatel nebo manažer.</i>"
        } else {
            const actor = `telegram:${message.from?.id}${member ? ` (${member.name})` : ""}`
            const result = decision.intent === "approve"
                ? await approveAction(decision.actionId, actor)
                : await rejectAction(decision.actionId, actor)
            suffix = result.ok
                ? `\n\n${decision.intent === "approve" ? "✅ Schváleno" : "✖️ Zamítnuto"} · <code>${esc(decision.actionId)}</code>`
                : `\n\n⚠️ ${esc(result.error || "nepovedlo se")}`
        }
    }

    const body = `${decision.text}${suffix}`
    const sent = await sendTelegram(body, { chatId, replyToMessageId: message.message_id })
    await recordBotMessage({ chatId, messageId: sent?.messageId, text: body, reason: decision.reason })
}

// ── Příkazy ────────────────────────────────────────────────────────────────

/** `true` = příkaz obsloužen, model se už neptáme. */
async function handleCommand(
    text: string,
    chatId: string | number,
    replyTo: number,
    fromId: number | undefined,
): Promise<boolean> {
    const command = text.split(/[\s@]/)[0].toLowerCase()

    if (command === "/stav" || command === "/status") {
        const { buildCompanySnapshot, describeSnapshot } = await import("@/lib/agents/company-snapshot")
        const snapshot = await buildCompanySnapshot()
        const body = `<b>Stav firmy</b>\n<pre>${esc(describeSnapshot(snapshot))}</pre>`
        const sent = await sendTelegram(body, { chatId, replyToMessageId: replyTo })
        await recordBotMessage({ chatId, messageId: sent?.messageId, text: "/stav", reason: "command" })
        return true
    }

    if (command === "/ceka" || command === "/schvaleni") {
        const { listPendingApprovals } = await import("@/lib/agent-safety")
        const pending = await listPendingApprovals()
        if (pending.length === 0) {
            await sendTelegram("Nic nečeká na schválení.", { chatId, replyToMessageId: replyTo })
            return true
        }
        // Jedna zpráva na akci — tlačítka patří ke konkrétnímu záznamu a
        // společný podpis pod seznamem by nešel přiřadit.
        for (const action of pending.slice(0, 10)) {
            const body = `<b>${esc(action.agentType)}</b> · ${esc(action.action)}\n`
                + `<i>${esc(action.riskTier)}</i> · čeká od ${new Date(action.createdAt).toLocaleString("cs-CZ")}`
            await sendTelegram(body, {
                chatId,
                buttons: canApprove(fromId) ? approvalButtons(action.id) : undefined,
            })
        }
        await recordBotMessage({ chatId, text: `/ceka (${pending.length})`, reason: "command" })
        return true
    }

    if (command === "/help" || command === "/start") {
        const body = [
            "<b>Co umím</b>",
            "",
            "Čtu, co si tu píšete, a ozvu se ve dvou případech: když se na mě obrátíte,",
            "a když někdo řekne číslo, které nesedí s daty. Jinak mlčím.",
            "",
            "<b>/stav</b> — všechna čísla najednou",
            "<b>/ceka</b> — co čeká na schválení (s tlačítky)",
            "",
            "Ráno sem posílám brief, když je co hlásit.",
        ].join("\n")
        await sendTelegram(body, { chatId, replyToMessageId: replyTo })
        return true
    }

    return false
}

// ── Zpracování stisku tlačítka ─────────────────────────────────────────────

async function handleCallback(update: TelegramUpdate): Promise<void> {
    const query = update.callback_query!
    const chatId = query.message?.chat.id
    const data = query.data || ""

    // Telegram točí na tlačítku „hodinky", dokud tohle nedorazí, a po ~15 s ho
    // označí za rozbité. Odbavuje se PRVNÍ, ještě před prací.
    await answerCallback(query.id)

    if (!chatId || !isOurChat(chatId)) return

    const member = findMember(query.from.id)
    const claimed = await claimUpdate({
        update_id: update.update_id,
        chat_id: String(chatId),
        message_id: query.message?.message_id ?? null,
        tg_user_id: query.from.id,
        author: member?.name || query.from.first_name || "neznámý",
        team_role: member?.role ?? null,
        is_bot: false,
        text: `[tlačítko] ${data}`,
    })
    if (!claimed) return

    const parsed = parseCallbackData(data)
    if (!parsed) return

    if (!canApprove(query.from.id)) {
        // Alert místo zprávy do skupiny: odmítnutí je věc toho, kdo klikl,
        // a nemá zaplevelit kanál ostatním.
        await answerCallback(query.id, "Schvalovat může jen zakladatel nebo manažer.", true)
        return
    }

    const actor = `telegram:${query.from.id}${member ? ` (${member.name})` : ""}`
    const result = parsed.decision === "approve"
        ? await approveAction(parsed.actionId, actor)
        : await rejectAction(parsed.actionId, actor)

    const original = query.message?.text || ""
    const verdict = result.ok
        ? `${parsed.decision === "approve" ? "✅ Schválil" : "✖️ Zamítl"} ${esc(member?.name || query.from.first_name || "?")}`
        : `⚠️ ${esc(result.error || "nepovedlo se")}`

    // Přepíšeme původní zprávu a tlačítka odstraníme — jinak druhý stisk vypadá,
    // že se nic nestalo, a `approveAction` na něj odpoví „už není proposed".
    if (query.message?.message_id) {
        await editTelegram(chatId, query.message.message_id, `${esc(original)}\n\n${verdict}`)
    }
    await recordBotMessage({ chatId, text: verdict, reason: "command" })
}

// ── Vstupní bod ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
    if (!secretMatches(req.headers.get("x-telegram-bot-api-secret-token"))) {
        // 401 bez detailu: kdo netrefil tajemství, se nemá dozvědět proč.
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (!isTelegramConfigured()) {
        return NextResponse.json({ error: "Telegram není nakonfigurovaný" }, { status: 503 })
    }

    let update: TelegramUpdate
    try {
        update = (await req.json()) as TelegramUpdate
    } catch {
        return NextResponse.json({ ok: true }) // nečitelné tělo neopakovat
    }

    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id
    if (!isOurChat(chatId)) {
        // Cizí chat: 200 a ticho. Odpověď „nemáš sem přístup" by potvrdila,
        // že bot žije a že tahle adresa je ta pravá.
        return NextResponse.json({ ok: true })
    }

    // ACK teď, práce potom — jinak si Telegramovým retryem vyrobíme duplicitní
    // updaty přesně tam, kde se schvaluje reálná práce.
    after(async () => {
        try {
            if (update.message) await handleMessage(update)
            else if (update.callback_query) await handleCallback(update)
        } catch (err) {
            console.error(`telegram webhook: ${(err as Error)?.message}`, err)
        }
    })

    return NextResponse.json({ ok: true })
}
