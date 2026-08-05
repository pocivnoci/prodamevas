/**
 * Kontrola, že identita podnikatele je vyplněná dřív, než se začne prodávat.
 *
 * Nevyplněné IČO na obchodních podmínkách není kosmetická vada — je to porušení
 * informační povinnosti vůči spotřebiteli (§ 435 obč. zák., § 1811 obč. zák.).
 * Proto tenhle skript končí nenulovým exit kódem a hodí se do launch checklistu
 * i do CI.
 *
 * Spuštění:  npx tsx scripts/check-legal-identity.ts
 */

import { config } from "dotenv"
config({ path: ".env.local" })

import { LEGAL, legalIdentityGaps, formatIdentityLine, vatNotice } from "../lib/legal"
import { isFakturoidEnabled } from "../lib/fakturoid"

function main(): void {
    console.log("\n🧾 Kontrola právní identity\n" + "─".repeat(48))

    const gaps = legalIdentityGaps()

    console.log(`Podnikatel:  ${LEGAL.name}`)
    console.log(`Identifikace: ${formatIdentityLine()}`)
    console.log(`Režim DPH:    ${LEGAL.vatStatus}  →  „${vatNotice()}"`)
    console.log(`Fakturoid:    ${isFakturoidEnabled() ? "✅ nakonfigurován" : "❌ chybí FAKTUROID_CLIENT_ID / _SECRET / _SLUG"}`)
    console.log("─".repeat(48))

    // DIČ bez režimu identifikované osoby je skoro jistě překlep — zákazníkům by
    // se ukazovalo DIČ u někoho, kdo se tváří jako čistý neplátce.
    if (LEGAL.dic && LEGAL.vatStatus === "none") {
        console.warn("⚠️  Máš vyplněné DIČ, ale NEXT_PUBLIC_BUSINESS_VAT_STATUS=none.")
        console.warn("    Po registraci identifikované osoby přepni na \"identified\".\n")
    }

    if (gaps.length > 0) {
        console.error(`❌ Chybí ${gaps.length} povinných údajů:\n`)
        for (const gap of gaps) console.error(`   • ${gap}`)
        console.error("\nDoplň je v lib/legal.ts nebo přes NEXT_PUBLIC_BUSINESS_* proměnné.")
        console.error("Postup je v docs/LEGAL_SETUP.md, kapitola 9.\n")
        process.exit(1)
    }

    if (!isFakturoidEnabled()) {
        console.error("❌ Fakturoid není nakonfigurován — platby by proběhly bez daňového dokladu.")
        console.error("   Postup je v docs/LEGAL_SETUP.md, kapitola 7.\n")
        process.exit(1)
    }

    console.log("✅ Identita je kompletní a fakturace nakonfigurovaná — můžeš prodávat.\n")
}

main()
