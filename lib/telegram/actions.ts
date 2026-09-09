/**
 * Tlačítka pod čekající akcí — a jejich zpáteční cesta.
 * =====================================================
 * Odesílatel (ranní brief, okamžitá výzva) a příjemce (webhook) musí mluvit
 * stejným jazykem. Kdyby si každý skládal `callback_data` po svém, rozešly by
 * se tiše: tlačítko by se zobrazilo a stisk by neudělal nic.
 *
 * `callback_data` má strop **64 BAJTŮ** (ne znaků) — Bot API delší hodnotu
 * odmítne už při odeslání zprávy. `a:` + UUID = 38, takže se to vejde
 * s rezervou; víc než prefix a id se sem ale nikdy nevejde, a proto se
 * autorizace NEDĚLÁ podpisem v datech. Dělá ji `canApprove(from.id)` nad
 * identitou, kterou u callbacku ručí sám Telegram a kterou k nám pustil jen
 * webhook ověřený secret tokenem.
 */

import type { InlineButton } from "./client"

const APPROVE = "a"
const REJECT = "r"

/** Dvojice tlačítek pod jednou čekající akcí. */
export function approvalButtons(actionId: string): InlineButton[][] {
    return [[
        { text: "✅ Schválit", callbackData: `${APPROVE}:${actionId}` },
        { text: "✖️ Zamítnout", callbackData: `${REJECT}:${actionId}` },
    ]]
}

export interface ParsedCallback {
    decision: "approve" | "reject"
    actionId: string
}

/** Rozebere `callback_data` zpátky. `null` = cizí nebo poškozený tvar. */
export function parseCallbackData(data: string | undefined | null): ParsedCallback | null {
    if (!data) return null
    const separator = data.indexOf(":")
    if (separator !== 1) return null
    const prefix = data.slice(0, 1)
    const actionId = data.slice(2)
    if (!actionId) return null
    if (prefix === APPROVE) return { decision: "approve", actionId }
    if (prefix === REJECT) return { decision: "reject", actionId }
    return null
}
