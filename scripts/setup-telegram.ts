/**
 * Zapojení týmového kanálu — jeden příkaz, tři kontroly.
 *   npx tsx scripts/setup-telegram.ts            # jen ověří, co je nastavené
 *   npx tsx scripts/setup-telegram.ts --register # navíc zaregistruje webhook
 *
 * Proč skript a ne návod v dokumentaci: registrace webhooku je jediný krok,
 * který se dělá RUČNĚ a jednou — a přesně u takového kroku se pak půl hodiny
 * hledá, jestli selhal token, adresa, nebo jestli bota nikdo nepřidal do
 * skupiny. Skript rozliší které.
 */

import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })

import { getMe, sendTelegram, setWebhook, telegramCall } from "../lib/telegram/client"
import { describeTeam, isTelegramConfigured, teamChatId, teamMembers } from "../lib/telegram/team"

const register = process.argv.includes("--register")

function fail(message: string): never {
    console.error(`\n❌ ${message}\n`)
    process.exit(1)
}

async function main() {
    console.log("\n── Telegramový kanál ──\n")

    if (!process.env.TELEGRAM_BOT_TOKEN) {
        fail("TELEGRAM_BOT_TOKEN chybí.\n"
            + "   Založ bota u @BotFather (/newbot), zkopíruj token do .env.local.")
    }

    const me = await getMe().catch(err => fail(`Token neplatí: ${err.message}`))
    console.log(`✅ Bot: @${me.username || me.first_name} (id ${me.id})`)
    if (me.username && !process.env.TELEGRAM_BOT_USERNAME) {
        console.log(`   ⚠️ Doplň do .env.local: TELEGRAM_BOT_USERNAME=${me.username}`)
        console.log("      Bez toho agent pozná oslovení jen podle odpovědi na svou zprávu.")
    }

    const chat = teamChatId()
    if (!chat) {
        fail("TELEGRAM_CHAT_ID chybí.\n"
            + "   Přidej bota do skupiny, napiš tam cokoli a spusť:\n"
            + "   curl -s \"https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getUpdates\" | grep -o '\"chat\":{\"id\":[-0-9]*'\n"
            + "   Skupinové ID začíná mínusem (např. -1001234567890).")
    }

    // Ověřuje víc než existenci chatu: `getChat` projde jen když je bot uvnitř.
    const info = await telegramCall<{ title?: string; type?: string }>("getChat", { chat_id: chat })
        .catch(err => fail(`Chat ${chat} není dostupný: ${err.message}\n   Je bot ve skupině?`))
    console.log(`✅ Chat: ${info.title || chat} (${info.type})`)

    const members = teamMembers()
    if (members.length === 0) {
        fail("TELEGRAM_TEAM chybí nebo je celý neplatný.\n"
            + "   Formát: TELEGRAM_TEAM=111:Thomas:founder,222:Hanz:investor,333:Luděk:manager\n"
            + "   Číselné ID zjistíš tak, že každý napíše do skupiny a mrkneš do getUpdates.")
    }
    console.log(`✅ Tým: ${describeTeam()}`)
    const approvers = members.filter(m => m.role !== "investor")
    if (approvers.length === 0) {
        console.log("   ⚠️ Nikdo nesmí schvalovat — ve skupině není zakladatel ani manažer.")
    }

    if (!process.env.TELEGRAM_WEBHOOK_SECRET) {
        fail("TELEGRAM_WEBHOOK_SECRET chybí.\n"
            + "   Vygeneruj: openssl rand -hex 32")
    }
    if (!process.env.ANTHROPIC_API_KEY) {
        console.log("   ⚠️ ANTHROPIC_API_KEY chybí — agent bude mlčet. Brief a tlačítka fungují dál.")
    }

    if (register) {
        const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "")
        if (!site || site.includes("localhost")) {
            fail(`Webhook potřebuje veřejnou adresu, NEXT_PUBLIC_SITE_URL je '${site || "prázdné"}'.\n`
                + "   Telegram na localhost nedosáhne — registruj až proti produkci.")
        }
        const url = `${site}/api/telegram/webhook`
        await setWebhook(url, process.env.TELEGRAM_WEBHOOK_SECRET)
        console.log(`✅ Webhook zaregistrován: ${url}`)

        await sendTelegram(
            "🤖 <b>Jsem tu.</b>\n\n"
            + "Čtu, co si píšete. Ozvu se, když se na mě obrátíte, nebo když někdo řekne číslo, "
            + "které nesedí s daty. Jinak mlčím.\n\n"
            + "<b>/stav</b> — čísla · <b>/ceka</b> — co čeká na schválení · <b>/help</b>",
        )
        console.log("✅ Uvítací zpráva odeslána do skupiny")
    } else {
        const hook = await telegramCall<{ url?: string; pending_update_count?: number; last_error_message?: string }>(
            "getWebhookInfo", {})
        console.log(hook.url
            ? `✅ Webhook: ${hook.url}${hook.last_error_message ? ` (poslední chyba: ${hook.last_error_message})` : ""}`
            : "⚠️ Webhook není zaregistrovaný — spusť znovu s --register")
    }

    console.log(`\n${isTelegramConfigured() ? "Kanál je připravený." : "Kanál ještě není úplný."}\n`)
}

main().catch(err => fail(err?.message || String(err)))
