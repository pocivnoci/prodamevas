/**
 * Ranní brief v Telegramu — tentýž obsah, jiný nosič.
 * ===================================================
 * `lib/agents/daily-brief.ts` skládá brief a rozhoduje, jestli je co hlásit.
 * Tenhle soubor ho jen obléká pro skupinu. Sběr dat se NEKOPÍRUJE: dvě verze
 * briefu by po první změně začaly hlásit dvě různá čísla.
 *
 * Proč to není jen e-mail převedený na text:
 *  - **Telegram nemá předmět.** V e-mailu nese verdikt („2 věci pro tebe")
 *    předmět; tady musí být v prvním řádku, jinak se ztratí v náhledu notifikace.
 *  - **Tlačítka jsou nativní.** Schválení nepotřebuje podepsaný odkaz do
 *    aplikace — stiskne se přímo v chatu (`callback_query`, viz webhook).
 *    Proto jde každá čekající akce jako VLASTNÍ zpráva: `inline_keyboard`
 *    patří ke zprávě, ne k odstavci v ní.
 *  - **Je to skupina.** Brief čtou tři lidi, ne jeden. Formulace „co potřebuje
 *    tebe" má proto u sebe jméno, kdo to má rozhodnout — jinak se každý spolehne
 *    na ostatní dva.
 */

import { approvalButtons } from "./actions"
import { esc, sendTelegram } from "./client"
import { teamMembers } from "./team"
import type { BriefLine, DailyBrief } from "@/lib/agents/daily-brief"

/** Zakladatel je ten, kdo rozhoduje. Když v týmu není, oslovíme skupinu. */
function decider(): string {
    const founder = teamMembers().find(m => m.role === "founder")
    return founder ? founder.name : "někdo z vás"
}

function line(l: BriefLine): string {
    const detail = l.detail ? `\n    <i>${esc(l.detail)}</i>` : ""
    return `${l.icon} ${esc(l.text)}${detail}`
}

function section(title: string, lines: string[]): string {
    if (lines.length === 0) return ""
    return `<b>${title.toUpperCase()}</b>\n${lines.join("\n")}\n\n`
}

/** Hlavní tělo briefu (bez čekajících akcí — ty jdou zvlášť s tlačítky). */
export function renderBriefBody(b: DailyBrief): string {
    const todo = b.needsYou.length
    const head = todo > 0
        ? `☕ <b>Ranní brief</b> — ${todo} ${todo === 1 ? "věc" : todo < 5 ? "věci" : "věcí"} pro ${esc(decider())}`
        : "☕ <b>Ranní brief</b> — jen ke čtení"

    let body = `${head}\n\n`
    body += section("Peníze", b.money.map(line))
    body += section("Obchod", b.sales.map(line))
    body += section("Zákazníci v riziku", b.risk.map(line))
    body += section("Systém", b.system.map(p => line({ icon: p.icon, text: p.title, detail: p.detail })))
    body += section("Termíny", b.compliance.map(i => line({
        icon: i.urgency === "now" ? "🔴" : "🟠",
        text: `${i.action}${i.deadline ? ` — ${i.deadline}` : ""}`,
        detail: i.why,
    })))
    body += section("Co jsem udělal sám", b.did.map(line))

    return body.trimEnd()
}

/**
 * Pošle brief do skupiny. Vrací počet odeslaných zpráv (0 = nic se neposlalo).
 *
 * Čekající akce jdou jako samostatné zprávy AŽ ZA tělem: každá si nese vlastní
 * tlačítka a po rozhodnutí se přepíše na „✅ Schválil Thomas" — v jednom velkém
 * bloku by to nešlo.
 */
export async function sendBriefToTelegram(b: DailyBrief): Promise<number> {
    let sent = 0

    const body = renderBriefBody(b)
    if (body.trim()) {
        // Brief je rutina — nemá v šest ráno budit tři telefony zvukem.
        if (await sendTelegram(body, { silent: true })) sent++
    }

    for (const action of b.needsYou) {
        const label = action.clientId ? (b.clientLabels[action.clientId] || action.clientId) : "OPS (celý systém)"
        const payload = action.payload && Object.keys(action.payload).length > 0
            ? `\n<pre>${esc(JSON.stringify(action.payload, null, 2).slice(0, 500))}</pre>`
            : ""
        const text = `<b>${esc(action.action)}</b>\n`
            + `${esc(action.agentType)} · <i>${esc(action.riskTier)}</i>\n`
            + `Klient: ${esc(label)}${payload}`
        if (await sendTelegram(text, { buttons: approvalButtons(action.id) })) sent++
    }

    return sent
}
