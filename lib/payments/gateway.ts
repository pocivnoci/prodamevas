/**
 * Která brána vezme peníze — čisté rozhodnutí, bez `process.env` a bez SDK.
 * ═══════════════════════════════════════════════════════════════════════════
 * Tohle je nejdražší `if` v celé aplikaci: rozhoduje, kam poteče platba.
 * A už jednou se spletl — 11. 8. 2026 nebyly na produkci ComGate údaje, Stripe
 * klíč ano, a výběr proto tiše směroval platby na bránu **bez webhooku**.
 * Zákazník zaplatil a plán se mu neaktivoval, protože bez `STRIPE_WEBHOOK_SECRET`
 * se podpis nedá ověřit a routa vrátí 400.
 *
 * Proto tady, jako funkce nad předaným prostředím, a ne nad `process.env`:
 * jinak se to nedá otestovat jinak než nasazením. `lib/payments/checkout.ts`
 * si sem chodí pro odpověď a přidává jen čtení skutečného prostředí.
 *
 * Soubor **nesmí** importovat `server-only` ani klienty bran — sahá na něj
 * i testovací skript v `npm run guard`, který běží v holém Node.
 */

export type Gateway = "comgate" | "stripe"

/** Jen ty proměnné, které do rozhodnutí vstupují. */
export interface GatewayEnv {
    PAYMENT_GATEWAY?: string
    STRIPE_SECRET_KEY?: string
    STRIPE_WEBHOOK_SECRET?: string
    COMGATE_MERCHANT_ID?: string
    COMGATE_SECRET?: string
}

/**
 * Stripe umí vzít peníze už se samotným tajným klíčem — ale **aktivovat plán umí
 * až s webhookem**. Za „nakonfigurovanou" se proto považuje jen brána, která
 * zvládne CELOU cestu, ne jen její začátek.
 *
 * Zaplacený a neaktivovaný zákazník je nejhorší možný stav — horší než platba,
 * která vůbec nezačne.
 */
export function stripeCanComplete(env: GatewayEnv): boolean {
    return Boolean(env.STRIPE_SECRET_KEY) && Boolean(env.STRIPE_WEBHOOK_SECRET)
}

export function comgateConfigured(env: GatewayEnv): boolean {
    return Boolean(env.COMGATE_MERCHANT_ID) && Boolean(env.COMGATE_SECRET)
}

/**
 * Pravidla, v tomhle pořadí:
 *
 *  1. `PAYMENT_GATEWAY=stripe` vyhrává — ale jen když Stripe dojede do konce.
 *     I vynucená volba musí umět aktivovat, jinak by se překlep v proměnné
 *     projevil až tím, že zákazník zaplatí a nic nedostane.
 *  2. `PAYMENT_GATEWAY=comgate` vyhrává bezpodmínečně (původní brána se smlouvou).
 *  3. Bez vynucení má přednost ComGate, dokud má údaje.
 *  4. Když ComGate údaje nemá, naskočí Stripe — zase jen když dojede do konce.
 *  5. Jinak ComGate, i když je nenakonfigurovaný: selhat při zakládání platby
 *     je nesrovnatelně lepší než ji poslat bránou, která ji nedokáže dokončit.
 */
export function chooseGateway(env: GatewayEnv): Gateway {
    const forced = (env.PAYMENT_GATEWAY || "").toLowerCase()
    if (forced === "stripe" && stripeCanComplete(env)) return "stripe"
    if (forced === "comgate") return "comgate"
    if (!comgateConfigured(env) && stripeCanComplete(env)) return "stripe"
    return "comgate"
}

/**
 * Sandbox se pozná z PREFIXU klíče, ne z příznaku v prostředí. Příznak se dá
 * zapomenout přepnout; prefix lže jen tehdy, když někdo vloží špatný klíč.
 *
 * **Chybějící klíč = sandbox.** Vypadá to jako detail, ale je to směr selhání:
 * `sandbox` rozhoduje, jestli se smí sáhnout na OSTROU číselnou řadu dokladů,
 * a ta je nevratná. Bez klíče žádná platba stejně neproběhne (`getStripe()`
 * vyhodí dřív), takže tahle větev je v praxi nedosažitelná — ale kdyby někdy
 * dosažitelná byla, má mlčet, ne vystavovat.
 */
export function isSandboxKey(secretKey: string | undefined): boolean {
    if (!secretKey) return true
    return secretKey.startsWith("sk_test_")
}
