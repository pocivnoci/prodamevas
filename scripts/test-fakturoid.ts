/**
 * Ověření napojení na Fakturoid proti REÁLNÉMU účtu.
 *
 * Spusť po nastavení nebo rotaci `FAKTUROID_*` klíčů:
 *   npx tsx scripts/test-fakturoid.ts
 *
 * Co dělá ve výchozím režimu (bezpečné, vratné):
 *   • ověří OAuth client credentials a načte účet,
 *   • zkontroluje, že režim DPH v účtu souhlasí s `lib/legal.ts`,
 *   • otestuje `ensureSubject` včetně idempotence (druhé volání nesmí založit duplikát),
 *   • testovací subjekt zase smaže.
 *
 * ⚠️ `--invoice` navíc vystaví SKUTEČNOU fakturu. Číselná řada je nevratná — doklad
 * se dá jen smazat či stornovat, což vidí účetní. Používej vědomě a na čerstvém účtu.
 */

import { config } from "dotenv"
config({ path: ".env.local" })

import { LEGAL, vatNotice } from "../lib/legal"
import {
    isFakturoidEnabled,
    ensureSubject,
    issueInvoice,
    haleruToCzk,
    type BillingDetails,
} from "../lib/fakturoid"

/** Stabilní custom_id, aby opakované běhy nezakládaly nové subjekty. */
const TEST_CUSTOM_ID = "chrlit-selftest-subject"

const API_BASE = "https://app.fakturoid.cz/api/v3"

function userAgent(): string {
    return process.env.FAKTUROID_USER_AGENT || `Chrlit (${LEGAL.email})`
}

async function token(): Promise<string> {
    const basic = Buffer.from(
        `${process.env.FAKTUROID_CLIENT_ID}:${process.env.FAKTUROID_CLIENT_SECRET}`
    ).toString("base64")
    const res = await fetch(`${API_BASE}/oauth/token`, {
        method: "POST",
        headers: {
            Authorization: `Basic ${basic}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": userAgent(),
        },
        body: JSON.stringify({ grant_type: "client_credentials" }),
    })
    if (!res.ok) throw new Error(`token → ${res.status}`)
    return (await res.json()).access_token
}

async function raw<T>(path: string, method = "GET"): Promise<T> {
    const res = await fetch(`${API_BASE}/accounts/${process.env.FAKTUROID_SLUG}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${await token()}`,
            Accept: "application/json",
            "User-Agent": userAgent(),
        },
    })
    if (!res.ok && res.status !== 204) throw new Error(`${method} ${path} → ${res.status}`)
    return res.status === 204 ? (undefined as T) : await res.json()
}

const TEST_BILLING: BillingDetails = {
    customerType: "company",
    name: "TEST Chrlit selftest — smazat",
    ico: "04656679",
    dic: null,
    street: "Testovací 1",
    city: "Praha",
    zip: "110 00",
    countryCode: "CZ",
    email: "selftest@example.com",
}

let failures = 0
function check(ok: boolean, msg: string, detail = "") {
    console.log(`  ${ok ? "✅" : "❌"} ${msg}${detail ? ` — ${detail}` : ""}`)
    if (!ok) failures++
}

async function main(): Promise<void> {
    const withInvoice = process.argv.includes("--invoice")

    console.log("\n🧾 Fakturoid — ověření napojení\n" + "─".repeat(52))

    if (!isFakturoidEnabled()) {
        console.error("❌ Chybí FAKTUROID_CLIENT_ID / _SECRET / _SLUG v .env.local\n")
        process.exit(1)
    }

    // 1. Převod jednotek — nejtišší a nejdražší chyba celé integrace.
    console.log("\n1) Převod haléřů na koruny")
    check(haleruToCzk(99000) === 990, "99 000 haléřů = 990 Kč", String(haleruToCzk(99000)))
    check(haleruToCzk(199000) === 1990, "199 000 haléřů = 1 990 Kč", String(haleruToCzk(199000)))
    check(haleruToCzk(799000) === 7990, "799 000 haléřů = 7 990 Kč", String(haleruToCzk(799000)))

    // 2. Účet
    console.log("\n2) Účet a režim DPH")
    const acc = await raw<any>("/account.json")
    check(true, "autentizace prošla", acc.name)
    check(
        acc.registration_no === LEGAL.ico,
        "IČO v účtu souhlasí s lib/legal.ts",
        `${acc.registration_no} vs ${LEGAL.ico}`
    )
    // Nesoulad by znamenal doklady s DPH, kterou neplátce nesmí účtovat (nebo naopak).
    const expectedNonPayer = LEGAL.vatStatus !== "payer"
    check(
        expectedNonPayer === (acc.vat_mode === "non_vat_payer"),
        `režim DPH souhlasí (kód: ${LEGAL.vatStatus})`,
        `Fakturoid: ${acc.vat_mode}`
    )
    if (!acc.bank_account) {
        console.log("  ⚠️  účet nemá vyplněný bankovní účet — na dokladu pak chybí")
    }
    console.log(`  ℹ️  „${vatNotice()}"`)

    // 3. Subjekty
    console.log("\n3) Zakládání odběratele (ensureSubject)")
    const id1 = await ensureSubject(TEST_CUSTOM_ID, TEST_BILLING)
    check(Number.isFinite(id1), "subjekt vytvořen", `id=${id1}`)
    const id2 = await ensureSubject(TEST_CUSTOM_ID, TEST_BILLING)
    check(id1 === id2, "druhé volání NAJDE týž subjekt (žádný duplikát)", `${id1} / ${id2}`)

    // 4. Volitelně skutečná faktura
    let invoiceId: number | null = null
    if (withInvoice) {
        console.log("\n4) Vystavení SKUTEČNÉ faktury (--invoice)")
        const inv = await issueInvoice({
            clientId: TEST_CUSTOM_ID,
            billing: TEST_BILLING,
            lineName: "TEST — Chrlit selftest, prosím smazat",
            amountHaleru: 99000,
            paidAt: new Date(),
            paymentRef: `selftest-${Date.now()}`,
            vatRate: LEGAL.vatStatus === "payer" ? 21 : 0,
        })
        invoiceId = inv.id
        check(Boolean(inv.number), "faktura vystavena", `č. ${inv.number}`)
        check(
            String(inv.total) === "990.0" || Number(inv.total) === 990,
            "částka je 990 Kč, ne 99 000",
            String(inv.total)
        )
        console.log(`  🔗 ${inv.public_html_url || "(bez veřejného odkazu)"}`)
        console.log(`  ⚠️  SMAŽ ji ve Fakturoidu — je to testovací doklad v číselné řadě.`)
    } else {
        console.log("\n4) Vystavení faktury — přeskočeno (spusť s --invoice)")
        console.log("     Číselná řada je nevratná, proto to není výchozí chování.")
    }

    // 5. Úklid
    console.log("\n5) Úklid")
    if (invoiceId) {
        console.log(`  ⏭️  faktura ${invoiceId} zůstává — smaž ji ručně (API mazání záměrně nepoužíváme)`)
    }
    try {
        await raw(`/subjects/${id1}.json`, "DELETE")
        check(true, "testovací subjekt smazán")
    } catch (err: any) {
        // Se vystavenou fakturou smazat nejde — to je správné chování Fakturoidu.
        console.log(`  ⚠️  subjekt ${id1} nešel smazat (${err?.message}) — smaž ho ručně`)
    }

    console.log("\n" + "─".repeat(52))
    if (failures > 0) {
        console.error(`❌ ${failures} kontrol selhalo\n`)
        process.exit(1)
    }
    console.log("✅ Napojení na Fakturoid funguje.\n")
}

main().catch(err => {
    console.error(`\n❌ ${err?.message || err}\n`)
    process.exit(1)
})
