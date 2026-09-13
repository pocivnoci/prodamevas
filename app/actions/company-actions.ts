"use server"

import supabaseAdmin from "@/supabase/admin"
import { requireSuperAdmin } from "@/lib/auth-guard"

/**
 * Přehled firmy — cross-tenant pohled na zdraví zákaznických účtů.
 *
 * Doteď neexistovalo místo, kde by šlo vidět všechny klienty najednou:
 * `admin-actions.ts` je navzdory jménu per-projekt a týdenní report dává jen
 * agregáty. Tenhle tab je zároveň jediný rozumný způsob, jak ladit ranní brief —
 * e-mail se odkrokovat nedá, tabulka ano.
 *
 * **Vůči zákazníkovi read-only, s jedinou výjimkou: ruční karanténa.** Zásah,
 * který zákazníkovi něco pošle nebo mu něco strhne, sem dál nepatří — patří do
 * briefu, kde má schvalovací tlačítko. Karanténa je jiný druh rozhodnutí:
 * netýká se zákazníka, ale nás („tenhle profil je testovací, přestaň ho
 * obsluhovat"), je vratná jedním klikem a `setClientQuarantine` po sobě nechává
 * týž auditní řádek v `agent_actions` jako každá agentí akce. Druhá cesta
 * k témuž rozhodnutí tím nevzniká — vzniká první, která nevede přes terminál.
 */

export interface ClientHealthDTO {
    clientId: string
    name: string
    slug: string
    plan: string | null
    status: string | null
    periodEnd: string | null
    billingFailures: number
    cancelAtPeriodEnd: boolean
    lastContentAt: string | null
    postsLast14d: number
    igConnected: boolean
    creditsRemaining: number
    creditsTotal: number
    risks: string[]
    risksLabel: string
    /** `false` = značka je v karanténě (deaktivovaná, čeká na úklid). */
    isActive: boolean
    deactivatedAt: string | null
}

export interface CompanyOverview {
    clients: ClientHealthDTO[]
    /** Kolik ŽIVÝCH účtů má aspoň jedno riziko — číslo, které má smysl sledovat.
     *  Deaktivované se nepočítají: jejich „rizika" už nikdo neřeší. */
    atRisk: number
    /** Kolik značek je v karanténě (deaktivované, ještě nesmazané). */
    deactivated: number
    /** Registrace, které nikdy nedojely do studia. */
    stalledOnboardings: number
    generatedAt: string
}

export async function getCompanyOverview(): Promise<CompanyOverview> {
    await requireSuperAdmin()

    const { buildClientHealth, describeRisks, countStalledOnboardings } = await import("@/lib/agents/client-health")
    // Deaktivované se tady ukazují schválně: přehled je jediné místo, kde je
    // správce uvidí dřív, než je druhý stupeň úklidu smaže. Brief ani návrhy
    // úkolů je dál nedostávají — to je výchozí chování buildClientHealth.
    const [rows, stalled] = await Promise.all([
        buildClientHealth(new Date(), { includeDeactivated: true }),
        countStalledOnboardings(),
    ])

    const clients: ClientHealthDTO[] = rows.map(r => ({
        clientId: r.clientId,
        name: r.name,
        slug: r.slug,
        plan: r.plan,
        status: r.status,
        periodEnd: r.periodEnd,
        billingFailures: r.billingFailures,
        cancelAtPeriodEnd: r.cancelAtPeriodEnd,
        lastContentAt: r.lastContentAt,
        postsLast14d: r.postsLast14d,
        igConnected: r.igConnected,
        creditsRemaining: r.creditsRemaining,
        creditsTotal: r.creditsTotal,
        risks: r.risks,
        risksLabel: describeRisks(r.risks),
        isActive: r.isActive,
        deactivatedAt: r.deactivatedAt,
    }))

    return {
        clients,
        atRisk: clients.filter(c => c.isActive && c.risks.length > 0).length,
        deactivated: clients.filter(c => !c.isActive).length,
        stalledOnboardings: stalled.count,
        generatedAt: new Date().toISOString(),
    }
}

/** Stavy předplatného, které znamenají „tenhle účet žije" — stejná množina jako v `scripts/neaktivni-klienti.ts`. */
const ZIVE_PREDPLATNE = new Set(["active", "trialing"])

export interface QuarantineResult {
    ok: boolean
    /** Jméno značky, se kterou se pohnulo — do hlášky v UI. */
    name?: string
    error?: string
}

/**
 * Ruční karanténa značky — „tenhle profil je testovací, přestaň ho obsluhovat".
 *
 * `scripts/neaktivni-klienti.ts --deaktivuj` umí totéž, ale jen podle kritéria
 * (90 dní bez obsahu ∧ bez živého předplatného ∧ nikdy nezaplatil). Testovací
 * profil s čerstvým obsahem tím kritériem nikdy neprojde — a právě ten má zmizet
 * z přehledů. Heuristika podle e-mailové domény nebo názvu by přitom byla horší
 * než ruční klik: „testovací" není vlastnost dat, ale náš úmysl.
 *
 * Zápis je **podmíněný claim**, ne slepý update: kdyby značku mezitím oživil
 * nebo uspal někdo jiný, `eq("is_active", …)` nevrátí řádek a **je to konec**.
 *
 * PROČ SE PLATÍCÍ ZNAČKA DO KARANTÉNY NEDOSTANE. `deactivated_at` je start
 * třicetidenní lhůty, po které `scripts/smazat-opustene-klienty.ts` obsah smaže
 * nebo anonymizuje. Omyl u zákazníka, který platí, by tedy nebyl „vratný klik",
 * ale tikající budík — proto se sem zavírá stejná pojistka jako do automatického
 * kritéria: živé předplatné nebo jakákoli zaplacená platba = odmítnuto, a odchod
 * zákazníka řeší obchod, ne tenhle přehled.
 */
export async function setClientQuarantine(clientId: string, quarantine: boolean): Promise<QuarantineResult> {
    const { email } = await requireSuperAdmin()

    // Chybějící identifikátor se nikdy nedefaultuje na skutečného tenanta.
    if (!clientId || typeof clientId !== "string") return { ok: false, error: "Chybí identifikátor značky." }

    const { data: client, error: fetchErr } = await supabaseAdmin
        .from("clients")
        .select("id, name, slug, is_active")
        .eq("id", clientId)
        .maybeSingle()
    if (fetchErr) return { ok: false, error: fetchErr.message }
    if (!client) return { ok: false, error: "Značka nenalezena." }

    if (quarantine) {
        const [{ data: subs, error: subsErr }, { data: pays, error: paysErr }] = await Promise.all([
            supabaseAdmin.from("subscriptions").select("status").eq("client_id", clientId),
            supabaseAdmin.from("payments").select("status").eq("client_id", clientId),
        ])
        // Nedostupná odpověď není „nemá předplatné". Pojistka, která se při chybě
        // dotazu otevře, není pojistka.
        if (subsErr || paysErr) return { ok: false, error: `Peníze se nepodařilo ověřit: ${(subsErr || paysErr)?.message}` }
        if ((subs || []).some(s => ZIVE_PREDPLATNE.has(String(s.status).toLowerCase()))) {
            return { ok: false, error: "Značka má živé předplatné. Odchod platícího zákazníka patří obchodu, ne karanténě." }
        }
        if ((pays || []).some(p => String(p.status).toLowerCase() === "paid")) {
            return { ok: false, error: "Značka už někdy zaplatila. Takovou do karantény neposílám — karanténa po 30 dnech maže obsah." }
        }
    }

    const patch = quarantine
        ? { is_active: false, deactivated_at: new Date().toISOString() }
        // Návrat z karantény musí razítko smazat, jinak by druhý stupeň úklidu
        // počítal třicet dní dál u značky, která je zpátky v provozu.
        : { is_active: true, deactivated_at: null }

    // Podmíněný claim se ptá na stav PŘED přepnutím: do karantény smí jen
    // značka, která je právě aktivní, a zpátky jen ta, která je právě
    // v karanténě. Obojí je shodou okolností `is_active === quarantine`.
    const stavPredZmenou = quarantine

    const { data: claimed, error: updateErr } = await supabaseAdmin
        .from("clients")
        .update(patch)
        .eq("id", clientId)
        .eq("is_active", stavPredZmenou)
        .select("id, name")
        .maybeSingle()
    if (updateErr) return { ok: false, error: updateErr.message }
    if (!claimed) {
        return {
            ok: false,
            error: quarantine
                ? "Značka už v karanténě je — načti přehled znovu."
                : "Značka už je v provozu — načti přehled znovu.",
        }
    }

    // Auditní řádek vzniká i u ručního kliku, ze stejného důvodu jako
    // u `runTaskAgentNow`: jinak by v `agent_actions` chyběl přesně ten zásah,
    // který někdo udělal mimo agenta. `reversible` → nic nečeká na schválení,
    // jen se to zapíše. Kdo klikl, je v payloadu — `requestAction` si `actor`
    // plní samo.
    try {
        const { requestAction } = await import("@/lib/agent-safety")
        await requestAction({
            clientId,
            agentType: "ops",
            action: quarantine ? "Značka do karantény (ručně)" : "Značka zpět do provozu (ručně)",
            riskTier: "reversible",
            payload: { slug: client.slug, name: client.name, quarantine, by: email },
        })
    } catch (err) {
        // Audit selhal, ale stav značky se už změnil — zamlčet by to znamenalo
        // zásah bez stopy. Hlásit, ne vracet chybu: klik proběhl.
        console.error(`🚨 karanténa: auditní zápis selhal pro ${client.slug}: ${(err as Error)?.message}`)
    }

    return { ok: true, name: claimed.name }
}
