/**
 * Odpověď modelu → rozhodnutí. Čistá funkce, žádná síť ani DB.
 * =============================================================
 * Oddělené od `lib/agents/telegram-agent.ts` schválně: tohle je poslední místo
 * mezi jazykovým modelem a skupinou tří lidí, ve které se schvaluje reálná
 * práce. Chce to test, a test se sem nedostane přes soubor, který si při
 * importu otevírá Supabase.
 *
 * Doktrína: **cokoli nejasného znamená mlčet.** Do skupiny nesmí spadnout
 * surový výstup modelu ani „```json" — a když si model protiřečí, je ticho
 * vždycky lepší odpověď než dohad.
 */

export type ReplyReason = "mention" | "command" | "correction" | "none"

export interface AgentDecision {
    respond: boolean
    reason: ReplyReason
    text: string
    /** Záměr, který si žádá provedení. Autorizuje ho VOLAJÍCÍ, ne model. */
    intent: "none" | "approve" | "reject"
    actionId: string | null
}

export const SILENT: AgentDecision = {
    respond: false, reason: "none", text: "", intent: "none", actionId: null,
}

/**
 * Vytáhne rozhodnutí z odpovědi modelu.
 *
 * `addressed` rozhoduje, jak se čte CHYBĚJÍCÍ důvod: bez oslovení je to
 * z definice nevyžádaný vstup, a ten musí spadat pod cooldown. Kdyby se
 * mapoval na „mention", stačilo by pole v JSONu vynechat a agent by mohl
 * skákat do řeči bez omezení.
 */
export function parseDecision(raw: string, addressed: boolean): AgentDecision {
    // Model občas obalí JSON do ```json bloku i přes instrukci.
    const cleaned = String(raw || "").trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/, "")
        .trim()
    const start = cleaned.indexOf("{")
    const end = cleaned.lastIndexOf("}")
    if (start < 0 || end <= start) return SILENT

    let parsed: Partial<AgentDecision>
    try {
        parsed = JSON.parse(cleaned.slice(start, end + 1)) as Partial<AgentDecision>
    } catch {
        return SILENT
    }

    // `respond` musí být doslova true. "true", 1 ani "ano" neprojde — laxní
    // čtení by z nejistoty modelu udělalo zprávu do skupiny.
    if (parsed.respond !== true) return SILENT

    const text = typeof parsed.text === "string" ? parsed.text.trim() : ""
    // Odpovědět bez textu je rozporný vstup. Mlčíme.
    if (!text) return SILENT

    const reason: ReplyReason =
        parsed.reason === "mention" || parsed.reason === "correction" || parsed.reason === "command"
            ? parsed.reason
            : "none"

    const intent = parsed.intent === "approve" || parsed.intent === "reject" ? parsed.intent : "none"

    return {
        respond: true,
        reason: reason !== "none" ? reason : (addressed ? "mention" : "correction"),
        text,
        intent,
        actionId: typeof parsed.actionId === "string" && parsed.actionId.trim()
            ? parsed.actionId.trim()
            : null,
    }
}
