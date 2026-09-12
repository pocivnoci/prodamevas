/**
 * Zákaznická oznámení a stav fakturace — čistá logika (bez sítě).
 *   npx tsx scripts/test-customer-notices.ts
 *
 * Tři třídy chyb, které se naostro projeví až stížností zákazníka:
 *  1. Špatná hranice okna T-3 → oznámení dorazí den po stržení, nebo vůbec.
 *  2. Přehozená priorita stavů → někomu, kdo vypověděl, svítí „selhala platba".
 *  3. Šablona s chybějící proměnnou → e-mail s „undefined" v textu. Ten už nikdy
 *     nevezmeš zpátky.
 */

import { deriveBillingState, EXPIRING_SOON_DAYS } from "../lib/billing-period"
import { generateRefId, generateRenewalRefId, isRenewalRefId } from "../lib/payments/ref-id"

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail?: string) {
    if (cond) { passed++; console.log(`  ✅ ${name}`) }
    else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`) }
}

function eq<T>(name: string, actual: T, expected: T) {
    check(name, actual === expected, `čekáno ${JSON.stringify(expected)}, dostal ${JSON.stringify(actual)}`)
}

const NOW = new Date("2026-08-10T12:00:00.000Z")
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString()

console.log("\n── Stav fakturace ──")

eq("expirované předplatné je expired",
    deriveBillingState({ status: "expired", currentPeriodEnd: inDays(-1) }, NOW), "expired")

eq("selhaná platba bije vše ostatní",
    deriveBillingState({ status: "active", billingFailures: 1, cancelAtPeriodEnd: true, currentPeriodEnd: inDays(10) }, NOW),
    "dunning")

eq("výpověď se hlásí, dokud platba neselhává",
    deriveBillingState({ status: "active", cancelAtPeriodEnd: true, currentPeriodEnd: inDays(10) }, NOW), "cancelled")

eq("po konci období běží odklad",
    deriveBillingState({ status: "active", currentPeriodEnd: inDays(-1) }, NOW), "grace")

// Hranice okna: přesně na T-3 se oznámení POSÍLÁ, o hodinu dřív ještě ne.
eq(`přesně ${EXPIRING_SOON_DAYS} dny dopředu = expiring_soon`,
    deriveBillingState({ status: "active", currentPeriodEnd: inDays(EXPIRING_SOON_DAYS) }, NOW), "expiring_soon")

eq(`${EXPIRING_SOON_DAYS} dny a hodina dopředu ještě ne`,
    deriveBillingState({ status: "active", currentPeriodEnd: new Date(NOW.getTime() + EXPIRING_SOON_DAYS * 86_400_000 + 3_600_000).toISOString() }, NOW),
    "ok")

eq("předplatné bez data konce je v pořádku",
    deriveBillingState({ status: "active", currentPeriodEnd: null }, NOW), "ok")

eq("rozbité datum nespadne, jen mlčí",
    deriveBillingState({ status: "active", currentPeriodEnd: "není-datum" }, NOW), "ok")

// Tarif zdarma nese příznak konce období, ale nic nevypověděl — „předplatné jste
// zrušili, můžete ho obnovit" by klientovi lhalo dvakrát.
eq("tarif zdarma se nehlásí jako výpověď",
    deriveBillingState({ status: "active", provider: "gift", cancelAtPeriodEnd: true, currentPeriodEnd: inDays(10) }, NOW), "ok")

eq(`tarif zdarma ${EXPIRING_SOON_DAYS} dny před koncem = gift_ending`,
    deriveBillingState({ status: "active", provider: "gift", cancelAtPeriodEnd: true, currentPeriodEnd: inDays(EXPIRING_SOON_DAYS) }, NOW), "gift_ending")

eq("tarif zdarma po konci období nehlásí odklad obnovy",
    deriveBillingState({ status: "active", provider: "gift", cancelAtPeriodEnd: true, currentPeriodEnd: inDays(-1) }, NOW), "gift_ending")

eq("doběhlý tarif zdarma je expired",
    deriveBillingState({ status: "expired", provider: "gift", cancelAtPeriodEnd: true, currentPeriodEnd: inDays(-1) }, NOW), "expired")

console.log("\n── Konvence refId ──")

check("obnova se pozná podle prefixu", isRenewalRefId(generateRenewalRefId("kvetiny")))
check("první platba není obnova", !isRenewalRefId(generateRefId("kvetiny")))
check("prázdný refId není obnova", !isRenewalRefId(null) && !isRenewalRefId(undefined) && !isRenewalRefId(""))

console.log("\n── Šablony oznámení ──")

async function templates() {
    // Čisté znění žije v `notice-templates.ts`; `customer-notices.ts` k němu přidává
    // dedupe přes Supabase, takže by se sem bez `.env.local` nedalo ani doimportovat.
    const { buildCustomerNotice } = await import("../lib/agents/notice-templates")

    const kinds = [
        "renewal_upcoming", "charge_failed", "manual_renew",
        "expired", "payment_recovered", "generation_failed", "publish_failed",
        "facts_pending",
    ] as const

    for (const kind of kinds) {
        // Záměrně chudý payload: šablona musí obstát i s tím, co reálně přijde
        // (klient bez fakturačního jména, incident bez rozpoznaného důvodu).
        const { subject, body } = buildCustomerNotice(kind, { clientName: null, clientId: null })
        check(`${kind}: má předmět i tělo`, subject.length > 0 && body.length > 0)
        check(`${kind}: neprosakuje undefined/null`,
            !/undefined|\bnull\b|\[object Object\]/.test(subject + body),
            (subject + body).slice(0, 120))
    }

    // Automatické stržení a ruční obnova jsou dvě různé zprávy: u první se nemá
    // dělat nic, u druhé je potřeba jednat. Splynout nesmí.
    const auto = buildCustomerNotice("renewal_upcoming", { clientName: "Květiny", auto: true, amountHaleru: 149_000, date: "3. 9. 2026" })
    const manual = buildCustomerNotice("renewal_upcoming", { clientName: "Květiny", auto: false, date: "3. 9. 2026" })
    check("automatická obnova zmíní částku", /1\s?490 Kč/.test(auto.body), auto.body.slice(0, 160))
    check("automatická obnova říká, že se nemusí nic dělat", /nemusíte nic dělat/i.test(auto.body))
    check("ruční obnova vyzývá k akci", /obnovte/i.test(manual.body))
    check("obě varianty mají jiný předmět", auto.subject !== manual.subject)

    // Haléře se na koruny převádějí právě jednou — dvojí dělení by ukázalo 14,90 Kč.
    check("částka se nedělí dvakrát", !/14,9|14\.9/.test(auto.body), auto.body.slice(0, 160))

    // ── Peníze: co se oznamuje, to se strhne ────────────────────────────────
    const { vatNotice } = await import("../lib/legal")
    const { MAX_BILLING_FAILURES } = await import("../lib/billing-period")
    const { formatCzk, renewalChargeHaleru } = await import("../lib/pricing")

    // Roční Růst: e-mail dřív sliboval základ (29 990 Kč) a z karty šlo 36 288 Kč.
    const net = 2_999_00 * 10
    const gross = renewalChargeHaleru(net, new Date("2026-12-01T00:00:00Z"))
    const yearly = buildCustomerNotice("renewal_upcoming", {
        clientName: "Květiny", auto: true, amountHaleru: gross, netHaleru: net,
        date: "3. 12. 2026", termLabel: "na 12 měsíců",
    })
    check("obnova uvádí částku, která se strhne", yearly.body.includes(formatCzk(gross)), yearly.body.slice(0, 220))
    check("obnova uvádí i základ bez DPH", yearly.body.includes(`${formatCzk(net)} bez DPH`), yearly.body.slice(0, 220))
    check("obnova uvádí délku období", yearly.body.includes("na 12 měsíců"), yearly.body.slice(0, 220))
    check("u ceny stojí věta o DPH", yearly.body.includes(vatNotice()))

    // Počet pokusů je tentýž, podle kterého dunning končí.
    const failed = buildCustomerNotice("charge_failed", { clientName: "Květiny", attempt: 2, amountHaleru: gross, netHaleru: net })
    check("dunning počítá pokusy podle MAX_BILLING_FAILURES",
        failed.body.includes(`pokus 2 z ${MAX_BILLING_FAILURES}`), failed.body.slice(0, 200))
    check("selhaná platba nese větu o DPH", failed.body.includes(vatNotice()))

    // ── Zadržené příspěvky: jeden e-mail denně, správně skloněný ────────────
    // Oznámení chodí souhrnně, takže v něm padne počet — a „3 příspěvek čeká"
    // je přesně ten strojový překlad, kvůli kterému by si klient kontrolu vypnul.
    const one = buildCustomerNotice("facts_pending", { clientName: "Hydroizolace MIVA", count: 1 })
    const few = buildCustomerNotice("facts_pending", { clientName: "Hydroizolace MIVA", count: 3 })
    const many = buildCustomerNotice("facts_pending", { clientName: "Hydroizolace MIVA", count: 7 })
    check("jeden příspěvek se skloňuje jednotně", /1 příspěvek čeká/.test(one.subject), one.subject)
    check("tři příspěvky mají tvar pro 2–4", /3 příspěvky čekají/.test(few.subject), few.subject)
    check("sedm příspěvků má tvar pro 5+", /7 příspěvků čeká/.test(many.subject), many.subject)
    check("zpráva říká, že příspěvky samy nevyjdou", /nevyjd/.test(few.body), few.body.slice(0, 200))
    check("zpráva vede do studia", /kalend/i.test(few.body))
    check("drží vykání a podpis", /Dobrý den,/.test(few.body) && /Tým Chrlit/.test(few.body))
    // Chybějící počet nesmí prosáknout jako „0 příspěvků" ani „undefined".
    const noCount = buildCustomerNotice("facts_pending", { clientName: "Hydroizolace MIVA" })
    check("bez počtu zpráva pořád dává smysl", /1 příspěvek/.test(noCount.subject), noCount.subject)

    // Zpráva bez čísla větu o DPH nepotřebuje — a nesmí ji mít.
    const noPrice = buildCustomerNotice("manual_renew", { clientName: "Květiny" })
    check("zpráva bez ceny je bez věty o DPH", !noPrice.body.includes(vatNotice()))
}

templates()
    .then(() => {
        console.log(`\n${failed === 0 ? "🎉" : "⚠️ "} ${passed} prošlo, ${failed} selhalo\n`)
        if (failed > 0) process.exit(1)
    })
    .catch(err => {
        console.error("💥 Test spadl:", err?.message || err)
        process.exit(1)
    })
