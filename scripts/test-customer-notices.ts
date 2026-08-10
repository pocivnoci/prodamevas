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

console.log("\n── Konvence refId ──")

check("obnova se pozná podle prefixu", isRenewalRefId(generateRenewalRefId("kvetiny")))
check("první platba není obnova", !isRenewalRefId(generateRefId("kvetiny")))
check("prázdný refId není obnova", !isRenewalRefId(null) && !isRenewalRefId(undefined) && !isRenewalRefId(""))

console.log("\n── Šablony oznámení ──")

async function templates() {
    const { buildCustomerNotice } = await import("../lib/agents/customer-notices")

    const kinds = [
        "renewal_upcoming", "charge_failed", "manual_renew",
        "expired", "payment_recovered", "generation_failed", "publish_failed",
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
