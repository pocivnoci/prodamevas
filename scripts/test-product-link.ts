/**
 * Který produkt post doopravdy propaguje — párování textu na katalog (bez DB, bez sítě).
 *   npx tsx scripts/test-product-link.ts
 *
 * Plánovač napíše hook, který jmenuje konkrétní produkt („Náš termobox udrží Brownie
 * na čtyřech stupních"), a k postu se pak připojí produkt vybraný úplně jiným pravidlem
 * — round-robin přes kampaňové produkty, nebo cooldown v enginu. Dokud ta dvě pravidla
 * nespojíme, sedí produkt k textu jen náhodou: popisek mluví o antinikotinovém programu
 * a vyrenderuje se k němu fotka dětského sezení.
 *
 * Zvlášť ohlídané:
 *   • česká deklinace — katalog má „Kytice na míru", hook „kytici na míru",
 *   • přísnost: shodovat se musí VŠECHNA obsahová slova, jinak si podobné produkty
 *     ukradnou hooky navzájem („Kytice na míru" vs „Kytice pro radost"),
 *   • u shody více produktů vyhrává ten konkrétnější,
 *   • krátké generické názvy nesmí sedět na cokoliv.
 */

import { matchProductInText, normalizeForMatch } from "../lib/product-match"

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail?: string) {
    if (cond) { passed++; console.log(`  ✅ ${name}`) }
    else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`) }
}

const P = (name: string) => ({ id: name.toLowerCase().replace(/\W+/g, "-"), name })

function matches(name: string, products: string[], text: string, expected: string | null) {
    const hit = matchProductInText(products.map(P), text)
    const got = hit?.name ?? null
    check(name, got === expected, `čekal ${expected ?? "žádnou shodu"}, dostal ${got ?? "žádnou shodu"}`)
}

async function main() {
    console.log("\n🔗 Připojení produktu k příspěvku\n")

    {
        console.log("── Doslovná zmínka ──")
        const katalog = ["Brownie", "Kinder Bueno", "Mila Speciál", "Výběrová sada 12ks + Doprava ZDARMA"]
        matches("hook jmenuje produkt", katalog,
            "Náš termobox udrží luxusní Brownie na čtyřech stupních až osmnáct hodin.", "Brownie")
        matches("dvouslovný název", katalog,
            "Tajemství našeho Kinder Bueno odhaleno vrstvu po vrstvě.", "Kinder Bueno")
        matches("diakritika nevadí", katalog,
            "Proc zvykat pilinu, kdyz muzes mit Mila Special?", "Mila Speciál")
        matches("hook bez produktu nic nepřipojí", katalog,
            "Zatímco fitness guru chroustá celer, ty spokojeně bagruješ.", null)
    }

    {
        console.log("\n── Česká deklinace ──")
        const katalog = ["Kytice na míru", "Kytice pro radost", "Svatby & smuteční vazby", "Dárky a doplňky"]
        matches("4. pád — kytici na míru", katalog,
            "Rozvoz po Praze s přesností na hodinu doručí vaši kytici na míru.", "Kytice na míru")
        matches("1. pád projde taky", katalog,
            "Každá kytice pro radost začíná brzy ráno s hlínou za nehty.", "Kytice pro radost")
        matches("ampersand v názvu", katalog,
            "Poznáte květinu definující naše svatby a smuteční vazby tohoto roku?", "Svatby & smuteční vazby")
    }

    {
        console.log("\n── Přísnost: podobné produkty si nekradou hooky ──")
        const katalog = ["Kytice na míru", "Kytice pro radost"]
        matches("společné slovo samo nestačí", katalog,
            "Kytice vážeme každé ráno od šesti.", null)
        matches("rozhodne rozlišující slovo", katalog,
            "Tuhle kytici na míru jsme vázali pět minut před zavíračkou.", "Kytice na míru")

        const dvojice = ["Vstupní testování a základní programy pro dospělé", "Následné biorezonanční sezení pro dospělé"]
        matches("dlouhé názvy se stejným koncem se nepletou", dvojice,
            "Jak Vstupní testování a základní programy pro dospělé probíhají?",
            "Vstupní testování a základní programy pro dospělé")
    }

    {
        console.log("\n── Konkrétnější vyhrává ──")
        const katalog = ["Sada", "Výběrová sada 12ks + Doprava ZDARMA"]
        matches("delší název přebije obecný", katalog,
            "Výběrová sada 12ks + Doprava ZDARMA udělá z pátku degustaci.",
            "Výběrová sada 12ks + Doprava ZDARMA")
    }

    {
        console.log("\n── Žádné falešné shody ──")
        // Krátký generický název sedí na půlku češtiny; radši nepřipojit nic, než špatně.
        matches("krátký generický název se nechytá", ["Set", "Mix", "Káva"],
            "Set kolem sedmé, mix všeho možného.", null)
        matches("prázdný text", ["Brownie"], "", null)
        matches("prázdný katalog", [], "Brownie je nejlepší.", null)
        check("název jen ze spojek nikoho nechytí",
            matchProductInText([{ id: "x", name: "a na pro" }], "a na pro do se") === undefined)
    }

    {
        console.log("\n── Normalizace ──")
        check("diakritika padá", normalizeForMatch("Pistácie – čokoláda") === "pistacie cokolada")
        check("interpunkce se mění na mezery", normalizeForMatch("Triko VĚŘ V SÁČEK!") === "triko ver v sacek")
    }

    console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`)
    process.exit(failed === 0 ? 0 : 1)
}

main()
