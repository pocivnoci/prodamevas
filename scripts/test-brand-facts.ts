/**
 * Fakta z webu — čisté funkce, ŽÁDNÉ volání modelu ani sítě.
 *
 * Hlídá jedinou věc, na které tahle vrstva stojí: extrakce je REŠERŠE, ne psaní.
 * Jakmile by model směl fakt odvodit, dopočítat nebo mu přiřknout zdroj, který
 * nečetl, stane se z „ověřeného faktu" halucinace s razítkem — a faktická brána
 * (instagram/fact-check.ts) ji pak pustí do každého dalšího příspěvku.
 *
 * Spuštění: npx tsx scripts/test-brand-facts.ts
 */

import { buildFactExtractionPrompt, mergeFacts } from "../lib/brand-facts"
import { readFileSync } from "fs"
import { resolve } from "path"

let passed = 0
let failed = 0
const failures: string[] = []

function test(name: string, fn: () => void) {
    try { fn(); passed++; console.log(`  ✅ ${name}`) }
    catch (err: any) { failed++; failures.push(`${name}: ${err.message}`); console.log(`  ❌ ${name}\n     └─ ${err.message}`) }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg) }

const pages = [
    { url: "https://pekarna.cz", text: "Pečeme od roku 1998. Rozvoz po Praze do druhého dne." },
    { url: "https://pekarna.cz/o-nas", text: "Máme tři pobočky a vlastní mlýn." },
]

console.log("\n🧾 Extrakce faktů z webu")

test("prompt trvá na doslovném znění a zakazuje odvozování", () => {
    const p = buildFactExtractionPrompt("Pekárna", pages)
    assert(p.includes("DOSLOVA"), "bez tohohle je z rešerše volné psaní")
    assert(/odvodit|spočítat|zaokrouhlit|odhadnout/.test(p),
        "model musí mít výslovně zakázané dopočítávání — z 'přes 20 let' se nesmí stát 'od roku 2005'")
    assert(p.includes("prázdné pole"), "web bez údajů musí mít legitimní prázdný výsledek, jinak si model něco vymyslí")
})

test("prompt nese obsah stránek i jejich URL", () => {
    const p = buildFactExtractionPrompt("Pekárna", pages)
    assert(p.includes("https://pekarna.cz/o-nas") && p.includes("vlastní mlýn"),
        "zdroj i text musí být v promptu, jinak nemá fakt čím být podložený")
})

test("reklamní vata se do faktů nesmí", () => {
    const p = buildFactExtractionPrompt("Pekárna", pages)
    assert(/CO FAKT NENÍ/.test(p) && /kvalita|přístup|láskou/.test(p),
        "bez negativního výčtu se seznam zaplní frázemi a brána pak povolí prázdné superlativy")
})

console.log("\n🔗 Slučování se stávajícím seznamem")

test("sken nikdy nepřepíše ruční fakt", () => {
    const human = [{ text: "Otevřeno do 18:00", source: "od klienta" }]
    const merged = mergeFacts(human, [{ text: "Otevřeno do 17:00", source: "https://pekarna.cz" }])
    assert(merged[0].source === "od klienta", "ruční fakt musí zůstat první a beze změny")
    assert(merged.length === 2, "rozporný údaj z webu se přidá jako druhý — mazat cizí tvrzení skript nesmí")
})

test("druhý běh nic nezdvojí", () => {
    const first = mergeFacts([], [{ text: "Pečeme od roku 1998", source: "https://pekarna.cz" }])
    const second = mergeFacts(first, [{ text: "pečeme od roku 1998.", source: "https://pekarna.cz" }])
    assert(second.length === 1, `normalizované znění se má poznat jako duplicita, vzniklo ${second.length}`)
})

test("prázdné znění se nepřidává", () => {
    assert(mergeFacts([], [{ text: "   ", source: "x" }]).length === 0, "prázdný řádek není fakt")
})

console.log("\n🔒 Zápis je rozhodnutí člověka, ne skenu")

test("akce v Nastavení jen navrhuje", () => {
    const code = readFileSync(resolve(__dirname, "../app/actions/config-actions.ts"), "utf-8")
    const fn = code.slice(code.indexOf("export async function suggestBrandFacts"))
    const body = fn.slice(0, fn.indexOf("\n}\n"))
    assert(body.includes("requireProjectAccess"), "akce musí ověřit přístup k projektu")
    assert(!body.includes(".update("), "sken nesmí zapisovat do configu — o tvrzení o značce rozhoduje člověk")
})

test("onboarding zapisuje fakta doslova, ne přes konfigurační prompt", () => {
    const core = readFileSync(resolve(__dirname, "../app/onboarding/core.ts"), "utf-8")
    assert(/config\.brandFacts = analysis\.brandFacts/.test(core),
        "fakta se musí do configu kopírovat deterministicky — přeformulovaný fakt už není citace webu")
})

console.log("\n" + "─".repeat(60))
console.log(`  Total: ${passed + failed} | ✅ ${passed} | ❌ ${failed}`)
console.log("─".repeat(60))
if (failed > 0) { console.log("\n⚠️  FAILURES:"); failures.forEach(f => console.log(`  - ${f}`)); process.exit(1) }
console.log("\n🎉 Brand facts OK\n")
process.exit(0)
