/**
 * Webhook Stripu — behaviorální testy nad tím, co která událost ZNAMENÁ.
 *   npx tsx scripts/test-stripe-events.ts
 *
 * Bez DB a bez SDK: `classifyStripeEvent` je čistá funkce právě proto, aby tahle
 * rozhodnutí šlo ověřit dřív, než je zaplatí zákazník. Do 9/2026 byla zadrátovaná
 * v routě a jediný způsob, jak je otestovat, bylo nasadit a poslat platbu.
 *
 * Každý test tady odpovídá jednomu způsobu, jak přijít o peníze nebo je vzít dvakrát.
 */

import {
    classifyStripeEvent,
    refOf,
    subscriptionRefOf,
    type StripeEventPlan,
} from "../lib/payments/stripe-events"

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail?: string) {
    if (cond) { passed++; console.log(`  ✅ ${name}`) }
    else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`) }
}

const ev = (type: string, object: unknown): { id: string; type: string; data: { object: unknown } } =>
    ({ id: "evt_1", type, data: { object } })

/** Zúžení pro čtení polí bez `any` v každém testu. */
function as<K extends StripeEventPlan["kind"]>(plan: StripeEventPlan, kind: K): Extract<StripeEventPlan, { kind: K }> | null {
    return plan.kind === kind ? (plan as Extract<StripeEventPlan, { kind: K }>) : null
}

function main() {
    console.log("\n💳 PRVNÍ PLATBA\n")

    const paidSession = classifyStripeEvent(
        ev("checkout.session.completed", { id: "cs_1", payment_status: "paid", subscription: "sub_1" }),
    )
    check("zaplacená session aktivuje", paidSession.kind === "first_payment")
    check("lokátorem je id Session (podle něj se zabírá řádek)",
        as(paidSession, "first_payment")?.sessionId === "cs_1")
    check("id předplatného se vytáhne pro pozdější párování obnov",
        as(paidSession, "first_payment")?.subscriptionRef === "sub_1")

    // Nejdražší záměna v celém webhooku: typ události ≠ zaplaceno.
    // Session se uzavře i u odložených metod. Aktivovat podle typu = tarif zdarma.
    for (const status of ["unpaid", "no_payment_required", undefined]) {
        const plan = classifyStripeEvent(ev("checkout.session.completed", { id: "cs_2", payment_status: status }))
        check(`nezaplacená session (payment_status=${status}) NEAKTIVUJE`,
            plan.kind === "ignore" && plan.reason === "session_not_paid")
    }

    check("session bez id se nezpracuje (není podle čeho zabrat řádek)",
        classifyStripeEvent(ev("checkout.session.completed", { payment_status: "paid" })).kind === "ignore")

    // Chybějící předplatné nesmí zabít aktivaci — zákazník zaplatil.
    const noSub = classifyStripeEvent(ev("checkout.session.completed", { id: "cs_3", payment_status: "paid" }))
    check("session bez předplatného se přesto aktivuje", noSub.kind === "first_payment")
    check("…a chybějící id předplatného se hlásí jako null, ne jako prázdný řetězec",
        as(noSub, "first_payment")?.subscriptionRef === null)

    console.log("\n🔁 OBNOVA\n")

    const renewal = classifyStripeEvent(
        ev("invoice.paid", { id: "in_1", subscription: "sub_1", amount_paid: 299900, currency: "czk", billing_reason: "subscription_cycle" }),
    )
    check("zaplacená faktura cyklu je obnova", renewal.kind === "renewal")
    check("obnova je označená jako zaplacená", as(renewal, "renewal")?.paid === true)
    check("částka se bere OD BRÁNY (amount_paid), ne z ceníku",
        as(renewal, "renewal")?.amount === 299900)
    check("měna se normalizuje na velká písmena", as(renewal, "renewal")?.currency === "CZK")

    // ══ Dvojí doklad na tytéž peníze ══
    // První fakturu předplatného už zpracovala Session. Kdyby prošla i tudy,
    // vznikne druhá platba a druhý daňový doklad — a číselná řada je nevratná.
    const firstInvoice = classifyStripeEvent(
        ev("invoice.paid", { id: "in_0", subscription: "sub_1", amount_paid: 299900, billing_reason: "subscription_create" }),
    )
    check("PRVNÍ faktura předplatného se ignoruje (jinak druhý doklad na tytéž peníze)",
        firstInvoice.kind === "ignore" && firstInvoice.reason === "first_invoice")

    // …ale jen u zaplacené. Selhání první faktury je pořád selhání.
    const firstInvoiceFailed = classifyStripeEvent(
        ev("invoice.payment_failed", { id: "in_0", subscription: "sub_1", amount_due: 299900, billing_reason: "subscription_create" }),
    )
    check("selhání první faktury se NEignoruje (dunning musí naskočit)",
        firstInvoiceFailed.kind === "renewal" && firstInvoiceFailed.paid === false)

    const failedRenewal = classifyStripeEvent(
        ev("invoice.payment_failed", { id: "in_2", subscription: "sub_1", amount_due: 299900, billing_reason: "subscription_cycle" }),
    )
    check("odmítnutá obnova jde do dunningu, ne do aktivace",
        failedRenewal.kind === "renewal" && failedRenewal.paid === false)
    check("u odmítnuté se bere amount_due, ne amount_paid",
        as(failedRenewal, "renewal")?.amount === 299900)

    // amount_paid u odmítnuté faktury bývá 0 — kdyby se četlo špatné pole,
    // dunning by zaznamenal nulovou pohledávku.
    const failedZero = classifyStripeEvent(
        ev("invoice.payment_failed", { id: "in_3", subscription: "sub_1", amount_paid: 0, amount_due: 149900 }),
    )
    check("odmítnutá faktura nečte amount_paid (bylo by to 0)",
        as(failedZero, "renewal")?.amount === 149900)

    check("faktura bez předplatného není obnova (jednorázový doklad)",
        classifyStripeEvent(ev("invoice.paid", { id: "in_4", amount_paid: 100 })).kind === "ignore")
    check("faktura bez id se nezpracuje",
        classifyStripeEvent(ev("invoice.paid", { subscription: "sub_1" })).kind === "ignore")

    check("chybějící měna padá na CZK",
        as(classifyStripeEvent(ev("invoice.paid", { id: "in_5", subscription: "sub_1", amount_paid: 1 })), "renewal")?.currency === "CZK")
    check("chybějící částka je 0, ne undefined (jinak by se doklad vystavil na NaN)",
        as(classifyStripeEvent(ev("invoice.paid", { id: "in_6", subscription: "sub_1" })), "renewal")?.amount === 0)

    console.log("\n🔗 TVAR ODKAZU NA PŘEDPLATNÉ\n")

    check("id jako řetězec", refOf("sub_1") === "sub_1")
    check("id jako rozbalený objekt", refOf({ id: "sub_1" }) === "sub_1")
    check("null zůstane null", refOf(null) === null)
    check("objekt bez id je null, ne undefined", refOf({}) === null)

    // Novější verze API stěhují id předplatného pod parent.subscription_details.
    // Číst jen staré místo = tichá ztráta VŠECH obnov po upgradu verze API.
    check("nové umístění (parent.subscription_details) se přečte",
        subscriptionRefOf({ parent: { subscription_details: { subscription: "sub_new" } } }) === "sub_new")
    check("staré umístění má přednost, když je vyplněné",
        subscriptionRefOf({ subscription: "sub_old", parent: { subscription_details: { subscription: "sub_new" } } }) === "sub_old")
    check("obnova z nového umístění se klasifikuje jako obnova",
        classifyStripeEvent(ev("invoice.paid", {
            id: "in_7",
            parent: { subscription_details: { subscription: "sub_new" } },
            amount_paid: 999,
        })).kind === "renewal")

    console.log("\n🚪 KONEC PŘEDPLATNÉHO\n")

    const ended = classifyStripeEvent(ev("customer.subscription.deleted", { id: "sub_1" }))
    check("zrušené předplatné se expiruje", ended.kind === "subscription_ended")
    check("…podle id předplatného", as(ended, "subscription_ended")?.subscriptionRef === "sub_1")
    check("bez id se nic neexpiruje",
        classifyStripeEvent(ev("customer.subscription.deleted", {})).kind === "ignore")

    console.log("\n🤫 CO SE IGNORUJE\n")

    // Stripe posílá desítky typů. Cokoli neznámého musí skončit tichým 200 —
    // 4xx/5xx by Stripe nutilo opakovat něco, co nikdy nezpracujeme.
    for (const t of ["payment_intent.succeeded", "charge.refunded", "customer.created", "invoice.finalized"]) {
        const plan = classifyStripeEvent(ev(t, { id: "x" }))
        check(`${t} se ignoruje`, plan.kind === "ignore" && plan.reason === "unhandled_type")
    }
    check("událost bez typu se ignoruje", classifyStripeEvent({ id: "evt" }).kind === "ignore")
    check("událost bez data se nezhroutí",
        classifyStripeEvent({ id: "evt", type: "checkout.session.completed" }).kind === "ignore")

    console.log(`\n${failed === 0 ? "🎉" : "💥"} ${passed} prošlo, ${failed} selhalo\n`)
    if (failed > 0) process.exit(1)
}

main()
