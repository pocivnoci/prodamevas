/**
 * Stálý souhlas s druhem agentní akce.
 * =====================================
 * Odpověď na otázku, kterou `requestAction()` položí u každé akce vyžadující
 * člověka: „řekl mi někdo dopředu, že tohle mám dělat sám?"
 *
 * PROČ TO EXISTUJE
 * ----------------
 * Za čtyři měsíce provozu bylo navrženo 27 akcí ke schválení a schváleno nula
 * (kontrola produkce 10. 9. 2026). Stroj byl přitom v pořádku — brief chodil,
 * odkazy platily, expirace běžela. Nefungovala otázka: „schválíš tenhle jeden
 * e-mail?" položená každý den znovu je trvale otevřená smyčka a ta se u
 * zahlceného člověka vždycky prohraje.
 *
 * Stálý souhlas se ptá jednou na DRUH: „mám aktivační pobídky posílat sám?".
 * Odpověď se uloží a platí, dokud ji někdo nezruší.
 *
 * HRANICE, KTERÁ SE TÍM NEPOSOUVÁ
 * -------------------------------
 * `outbound` se nepřidává do `AUTO_TIERS`. Druh akce, ke kterému tu není
 * platný řádek, čeká na člověka úplně stejně jako předtím — default-deny
 * zůstává. Tohle jen dovoluje rozhodnout dopředu místo dokola.
 */

import supabaseAdmin from "@/supabase/admin"

/** Výchozí strop na den pro nově udělený souhlas. */
export const DEFAULT_DAILY_CAP = 5

/** Prefix v `agent_actions.actor` u akce, která prošla díky stálému souhlasu. */
export const POLICY_ACTOR_PREFIX = "policy:"

export interface AgentPolicy {
    key: string
    mode: "auto" | "ask"
    dailyCap: number
    decidedBy: string
    decidedAt: string
    revokedAt: string | null
    note: string | null
}

/** Tvar řádku tak, jak ho vrací PostgREST — snake_case, bez domýšlení. */
interface PolicyRow {
    key: string
    mode: "auto" | "ask"
    daily_cap: number
    decided_by: string
    decided_at: string
    revoked_at: string | null
    note: string | null
}

function toPolicy(r: PolicyRow): AgentPolicy {
    return {
        key: r.key,
        mode: r.mode,
        dailyCap: r.daily_cap,
        decidedBy: r.decided_by,
        decidedAt: r.decided_at,
        revokedAt: r.revoked_at,
        note: r.note,
    }
}

/**
 * Smí akce s tímhle klíčem odejít bez ptaní?
 *
 * Vrací důvod i při „ne" — volající ho loguje do `agent_actions`, aby v auditu
 * nebylo jen „navrženo", ale i proč to nešlo samo (žádný souhlas × vyčerpaný
 * strop). Bez toho se vyčerpaný strop tváří jako chybějící rozhodnutí a člověk
 * ho „opraví" podruhé udělením souhlasu, který už má.
 */
export async function canRunUnattended(
    key: string | undefined | null,
): Promise<{ allowed: boolean; reason: "no-key" | "no-policy" | "revoked" | "ask" | "cap-reached" | "ok"; policy?: AgentPolicy; usedToday?: number }> {
    if (!key) return { allowed: false, reason: "no-key" }

    const { data, error } = await supabaseAdmin
        .from("agent_policies")
        .select("key, mode, daily_cap, decided_by, decided_at, revoked_at, note")
        .eq("key", key)
        .maybeSingle()

    // Chyba čtení znamená „nevím", a nevím se u brány řeší zavřeno. Tichý
    // fallback na `allowed: true` by z výpadku databáze udělal rozesílku.
    if (error) {
        console.warn(`agent-policy: čtení souhlasu „${key}" selhalo: ${error.message}`)
        return { allowed: false, reason: "no-policy" }
    }
    if (!data) return { allowed: false, reason: "no-policy" }

    const policy = toPolicy(data)
    if (policy.revokedAt) return { allowed: false, reason: "revoked", policy }
    if (policy.mode !== "auto") return { allowed: false, reason: "ask", policy }

    const usedToday = await countUsedToday(key)
    if (usedToday >= policy.dailyCap) return { allowed: false, reason: "cap-reached", policy, usedToday }

    return { allowed: true, reason: "ok", policy, usedToday }
}

/**
 * Kolik akcí toho druhu dnes už odešlo díky souhlasu.
 *
 * Počítá se z `agent_actions.actor`, ne z vlastního počítadla: audit trail je
 * jediný zdroj pravdy o tom, co se opravdu stalo, a druhé počítadlo by se s ním
 * dřív nebo později rozešlo. Den je kalendářní v UTC — stejná hranice, na které
 * stojí denní crony.
 */
export async function countUsedToday(key: string): Promise<number> {
    const since = new Date()
    since.setUTCHours(0, 0, 0, 0)
    const { count, error } = await supabaseAdmin
        .from("agent_actions")
        .select("id", { count: "exact", head: true })
        .eq("actor", `${POLICY_ACTOR_PREFIX}${key}`)
        .gte("created_at", since.toISOString())
    if (error) {
        // Nespočítané je pro strop totéž co plné: raději se zeptáme zbytečně,
        // než abychom při výpadku počítadla poslali neomezeně.
        console.warn(`agent-policy: počítání stropu „${key}" selhalo: ${error.message}`)
        return Number.MAX_SAFE_INTEGER
    }
    return count ?? 0
}

/** Udělit stálý souhlas (nebo obnovit dřív zrušený). */
export async function grantPolicy(
    key: string,
    decidedBy: string,
    opts?: { dailyCap?: number; note?: string | null },
): Promise<{ ok: boolean; error?: string }> {
    const { error } = await supabaseAdmin
        .from("agent_policies")
        .upsert(
            {
                key,
                mode: "auto",
                daily_cap: opts?.dailyCap ?? DEFAULT_DAILY_CAP,
                decided_by: decidedBy,
                decided_at: new Date().toISOString(),
                // Obnovení dřív zrušeného souhlasu musí razítko zrušení SMAZAT,
                // jinak by `canRunUnattended` četlo „revoked" u čerstvého ano.
                revoked_at: null,
                note: opts?.note ?? null,
            },
            { onConflict: "key" },
        )
    if (error) return { ok: false, error: error.message }
    return { ok: true }
}

/** Zrušit stálý souhlas — akce toho druhu se zase začnou navrhovat. */
export async function revokePolicy(key: string, actor: string): Promise<{ ok: boolean; error?: string }> {
    const { data, error } = await supabaseAdmin
        .from("agent_policies")
        .update({ revoked_at: new Date().toISOString(), note: `zrušil ${actor}` })
        .eq("key", key)
        .is("revoked_at", null)
        .select("key")
        .maybeSingle()
    if (error) return { ok: false, error: error.message }
    if (!data) return { ok: false, error: "Souhlas neexistuje nebo už je zrušený." }
    return { ok: true }
}

/** Platné souhlasy, nejnovější první — pro dashboard i pro ranní brief. */
export async function listActivePolicies(): Promise<AgentPolicy[]> {
    const { data } = await supabaseAdmin
        .from("agent_policies")
        .select("key, mode, daily_cap, decided_by, decided_at, revoked_at, note")
        .is("revoked_at", null)
        .eq("mode", "auto")
        .order("decided_at", { ascending: false })
    return (data || []).map(toPolicy)
}

/**
 * Lidský název druhu akce. Klíč je strojový (`lifecycle:winback`), ale ve
 * frontě i v e-mailu musí stát česky, jinak člověk neschvaluje rozhodnutí,
 * ale hádanku.
 */
const LABELS: Record<string, string> = {
    "lifecycle:activation_nudge": "Pobídka k aktivaci účtu",
    "lifecycle:credit_low": "Upozornění na docházející kredity",
    "lifecycle:winback": "Oslovení po vypršení předplatného",
    "lifecycle:waitlist_drip": "Připomínka čekatelům na pozvánku",
    "lifecycle:dormant": "Oslovení spícího účtu",
    "lifecycle:ig_disconnected": "Upozornění na odpojený Instagram",
}

export function policyLabel(key: string): string {
    return LABELS[key] ?? key
}
