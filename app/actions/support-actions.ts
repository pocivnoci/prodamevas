"use server"

/**
 * Agent podpory — brána a zahájení konverzace.
 * ============================================
 * Jediná cesta, jak se v prohlížeči otevře konverzace s agentem podpory
 * (ElevenLabs Agents Platform). Dělá tři věci a žádnou z nich nesmí dělat klient:
 *
 * 1. **Přeloží slug na tenanta a ověří přístup** — `requireProjectAccess(slug)`.
 *    `projectId` z `StudioContext` je vstup z prohlížeče jako každý jiný.
 * 2. **Rozhodne o nároku** — `canUseSupportAgent()` nad předplatným z DB.
 *    Tarif (Dominance, Impérium) A skutečná platba. Nikdy ne podle toho, co
 *    tvrdí klient.
 * 3. **Vyrobí podepsanou URL** — `xi-api-key` zůstává na serveru. Kdyby klíč šel
 *    do prohlížeče, kdokoli s konzolí má celý účet ElevenLabs, včetně hlasů
 *    značek a fakturace.
 *
 * ⚠️ **Proměnné pro agenta putují přes prohlížeč.** Widget je posílá při zahájení
 * sezení (`dynamic-variables`), takže si je technicky zdatný klient může přepsat.
 * Proto jsou to čísla, která už zná ze své vlastní obrazovky (tarif, kredity,
 * stav fakturace) — lhal by jimi jen sám sobě. Žádný nástroj agenta na nich
 * nesmí stavět akci; až bude eskalace (fáze 3 návrhu), ponese vlastní podepsaný
 * token a `client_id` se vezme z něj, ne odsud. Návrh:
 * `docs/DESIGN_podpora-agentem_2026-09-13.md`.
 */

import { requireProjectAccess } from "@/lib/auth-guard"
import { getClientSubscription, canUseSupportAgent, deriveBillingState } from "@/lib/subscription"
import { formatCzk } from "@/lib/pricing"

/** Platnost podepsané URL u ElevenLabs. Sezení smí trvat dál, ale musí v okně začít. */
const SIGNED_URL_TTL_MINUTES = 15

export interface SupportSession {
    signedUrl: string
    /** Widget si ho bere i s podepsanou URL. Není to tajemství — je v každém embedu. */
    agentId: string
    /** Co agent ví o účtu, než klient řekne první větu. Viz varování v hlavičce. */
    variables: Record<string, string>
}

export type SupportSessionResult =
    | { ok: true; session: SupportSession }
    | { ok: false; reason: "not_entitled" | "not_configured" | "upstream" }

/**
 * Id agenta „Luděk" ve workspace Chrlitu.
 *
 * Konstanta v gitu + env override, tedy stejný režim jako identita podnikatele
 * v `lib/legal.ts` a ze stejných tří důvodů:
 *  - **není to tajemství** — id jde do prohlížeče v každém embedu widgetu,
 *    takže ho vidí každý klient, který si otevře Nápovědu;
 *  - je **jedno na celé nasazení**, ne jedno na tenanta, takže `ClientConfig`
 *    by pro něj byl špatný dům;
 *  - bez výchozí hodnoty by podpora mlčela do chvíle, než někdo doplní
 *    proměnnou v dashboardu Vercelu — a „funguje to, jen to nikdo nezapnul"
 *    je přesně ta třída chyby, kterou pravidlo „nic nehardcoduj" řešit nemá.
 *
 * `ELEVENLABS_AGENT_ID` má přednost, takže testovací agent se dá podstrčit bez
 * zásahu do kódu.
 */
const DEFAULT_AGENT_ID = "agent_5501m2ct1vh6f9hb1n78h0y97782"

function agentId(): string {
    return process.env.ELEVENLABS_AGENT_ID?.trim() || DEFAULT_AGENT_ID
}

/**
 * Je agent podpory vůbec zapnutý? Čte se v Nápovědě, aby se nemlčelo jinak při
 * „nemáš nárok" a jinak při „není nastavené" — první je stav účtu, druhé naše chyba.
 *
 * Agenta máme vždy (výchozí id), takže zbývá jedna podmínka: klíč. Ten je
 * tajemství a v env být MUSÍ — je to tentýž `ELEVENLABS_API_KEY`, kterým mluví
 * hlas značky v reelech, takže kde jedou reely, jede i podpora.
 */
export async function isSupportAgentConfigured(): Promise<boolean> {
    return Boolean(process.env.ELEVENLABS_API_KEY?.trim())
}

/**
 * Smí tenhle tenant na agenta? Odpovídá i obrazovce, která se jen rozhoduje,
 * jestli vykreslit widget — proto vrací boolean a ne výjimku.
 */
export async function canProjectUseSupportAgent(slug: string): Promise<boolean> {
    const { clientId } = await requireProjectAccess(slug)
    return canUseSupportAgent(await getClientSubscription(clientId))
}

/**
 * Zahájí sezení s agentem podpory pro daný tenant.
 *
 * Nárok se ověřuje TADY, ne v komponentě: skrytý widget je kosmetika, brána je
 * tohle. Superadmin bránu obchází záměrně — jinak by se agent nedal vyzkoušet
 * na jiném než vlastním platícím tenantovi.
 */
export async function startSupportConversation(slug: string): Promise<SupportSessionResult> {
    const { clientId, isSuperAdmin } = await requireProjectAccess(slug)

    const id = agentId()
    const apiKey = process.env.ELEVENLABS_API_KEY?.trim()
    if (!apiKey) {
        console.warn("Podpora: ELEVENLABS_API_KEY není nastavený — podepsanou URL nejde vyrobit")
        return { ok: false, reason: "not_configured" }
    }

    const sub = await getClientSubscription(clientId)
    if (!canUseSupportAgent(sub) && !isSuperAdmin) {
        return { ok: false, reason: "not_entitled" }
    }

    const url = `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(id)}`
    let signedUrl: string
    try {
        const res = await fetch(url, { headers: { "xi-api-key": apiKey }, cache: "no-store" })
        if (!res.ok) {
            // Tělo nese `detail.status` (invalid_api_key, agent_not_found, quota…).
            // Do logu patří celé: bez něj se „podpora nejde otevřít" nedá odlišit
            // od vyčerpaného tarifu.
            const detail = (await res.text()).replace(/\s+/g, " ").slice(0, 300)
            console.error(`Podpora: podepsaná URL selhala — HTTP ${res.status}: ${detail}`)
            return { ok: false, reason: "upstream" }
        }
        const body = (await res.json()) as { signed_url?: string }
        if (!body.signed_url) {
            console.error("Podpora: odpověď ElevenLabs neobsahuje signed_url")
            return { ok: false, reason: "upstream" }
        }
        signedUrl = body.signed_url
    } catch (err) {
        console.error(`Podpora: podepsaná URL selhala — ${(err as Error)?.message?.slice(0, 200)}`)
        return { ok: false, reason: "upstream" }
    }

    return { ok: true, session: { signedUrl, agentId: id, variables: supportVariables(sub) } }
}

/**
 * Kontext účtu pro agenta. Držet krátké a v češtině — je to text, který jde do
 * promptu, ne API.
 *
 * Nejcennější položka je `stav_fakturace`: nejčastější dotaz podpory bude „proč
 * mi nejde generovat" a odpověď je skoro vždycky tady (`dunning`, `grace`) nebo
 * v `kredity_zbyva`. Bez toho by se agent musel ptát na věci, které vidíme.
 */
function supportVariables(sub: Awaited<ReturnType<typeof getClientSubscription>>): Record<string, string> {
    if (!sub) return {}
    return {
        tarif: sub.planName,
        kredity_zbyva: String(sub.creditsRemaining),
        kredity_celkem: String(sub.creditsTotal),
        stav_predplatneho: sub.status,
        stav_fakturace: deriveBillingState(sub),
        cena_extra_kreditu: formatCzk(sub.features.extra_credit_price ?? 4900),
        obnova: sub.currentPeriodEnd ?? "neznámá",
        kredity_reset: sub.creditPeriodEnd ?? "neznámý",
        // Pro promptovou větu „lidskou podporu máte v tarifu" — slib platí jen
        // tam, kde ho tarif skutečně nese.
        lidska_podpora: sub.features.human_support === true ? "ano" : "ne",
        platnost_odkazu_min: String(SIGNED_URL_TTL_MINUTES),
    }
}
