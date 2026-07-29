/**
 * Product line validation + weighting — pure checks (no DB, no model calls).
 *   npx tsx scripts/test-product-lines.ts
 *
 * validateLine is the safety net between "the model said it obeyed the brief" and
 * "these rows go into the catalog". Every rule here is one the prompt already
 * states, so a compliant model trips none of them — they exist because a duplicate
 * step number silently reorders a line and a price that dips mid-range makes the
 * whole thing read as randomly assembled.
 */

import { validateLine, slugifyLine, type GeneratedLine, type LineSku } from "../instagram/line-generator"

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail?: string) {
    if (cond) { passed++; console.log(`  ✅ ${name}`) }
    else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`) }
}

function eq<T>(name: string, actual: T, expected: T) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    check(name, a === e, `expected ${e}, got ${a}`)
}

function sku(over: Partial<LineSku> & { step: number; name: string }): LineSku {
    return {
        role: `role-${over.step}`,
        description: "popis",
        specs: { volume: "500 ml" },
        priceCzk: 100 * over.step,
        designDirection: "d",
        ...over,
    }
}

/** A realistic, fully valid autokosmetika line — the baseline everything deviates from. */
function goodLine(): GeneratedLine {
    return {
        line: {
            name: "Garage Ritual",
            slug: "garage-ritual",
            positioning: "pro kutily",
            targetAudience: "majitelé aut",
            priceTier: "mid",
            namingConvention: "Garage + krok",
            systemLogic: "mytí → dekontaminace → leštění → ochrana → údržba",
        },
        skus: [
            sku({ step: 1, name: "Garage Wash", role: "mytí", priceCzk: 290 }),
            sku({ step: 2, name: "Garage Decon", role: "dekontaminace", priceCzk: 390 }),
            sku({ step: 3, name: "Garage Polish", role: "leštění", priceCzk: 590 }),
            sku({ step: 4, name: "Garage Shield", role: "ochrana", priceCzk: 890 }),
            sku({ step: 5, name: "Garage Detailer", role: "údržba", priceCzk: 340 }),
        ],
    }
}

const expected = { skuCount: 5, priceTier: "mid" as const }

console.log("\n🧩 PRODUCT LINES\n")

// ── Baseline ──
console.log("Platná řada:")
eq("čistá řada nemá výhrady", validateLine(goodLine(), expected), [])
check("poslední krok smí být levnější (detailer po ochraně)",
    validateLine(goodLine(), expected).length === 0)

// ── Step integrity ──
console.log("\nCelistvost kroků:")
const dupStep = goodLine()
dupStep.skus[2].step = 2
check("duplicitní krok je odhalen", validateLine(dupStep, expected).some(i => i.field === "step"))

const gapStep = goodLine()
gapStep.skus[4].step = 9
check("mezera v krocích je odhalena", validateLine(gapStep, expected).some(i => i.field === "step"))

const zeroStep = goodLine()
zeroStep.skus = zeroStep.skus.map((s, i) => ({ ...s, step: i }))  // 0..4 místo 1..5
check("kroky od nuly jsou odhaleny", validateLine(zeroStep, expected).some(i => i.field === "step"))

// Order of the array must not matter — the worker sorts by step, not by position
const shuffled = goodLine()
shuffled.skus = [shuffled.skus[3], shuffled.skus[0], shuffled.skus[4], shuffled.skus[1], shuffled.skus[2]]
eq("pořadí v poli nehraje roli, rozhoduje step", validateLine(shuffled, expected), [])

// ── Count ──
console.log("\nPočet SKU:")
const short = goodLine()
short.skus = short.skus.slice(0, 3)
check("míň SKU než zadáno je odhaleno", validateLine(short, expected).some(i => i.field === "skus"))
const empty: GeneratedLine = { ...goodLine(), skus: [] }
eq("prázdná řada vrací jednu jasnou výhradu", validateLine(empty, expected).length, 1)

// ── Names ──
console.log("\nNázvy:")
const dupName = goodLine()
dupName.skus[3].name = "Garage Wash"
check("duplicitní název v řadě", validateLine(dupName, expected).some(i => i.field === "name"))
check("shoda názvů ignoruje velikost písmen a mezery",
    validateLine(goodLine(), expected, ["  garage POLISH  "]).some(i => i.field === "name"))
check("konflikt se stávajícím katalogem",
    validateLine(goodLine(), expected, ["Garage Wash"]).some(i => i.field === "name"))
eq("nesouvisející katalog nevadí", validateLine(goodLine(), expected, ["Něco jiného"]), [])

// ── Prices ──
console.log("\nCenový žebříček:")
const crash = goodLine()
crash.skus[2].priceCzk = 90   // 390 → 90 uprostřed řady
check("propad ceny uprostřed je odhalen", validateLine(crash, expected).some(i => i.field === "priceCzk"))

const zeroPrice = goodLine()
zeroPrice.skus[1].priceCzk = 0
check("nulová cena je odhalena", validateLine(zeroPrice, expected).some(i => i.field === "priceCzk"))

const flat = goodLine()
flat.skus = flat.skus.map(s => ({ ...s, priceCzk: 500 }))
eq("stejné ceny napříč řadou jsou v pořádku", validateLine(flat, expected), [])

// ── Roles ──
console.log("\nRole v systému:")
const echoRole = goodLine()
echoRole.skus[0].role = "Garage Wash"
check("role, která jen opakuje název", validateLine(echoRole, expected).some(i => i.field === "role"))
const noRole = goodLine()
noRole.skus[0].role = "   "
check("prázdná role", validateLine(noRole, expected).some(i => i.field === "role"))

// ── mustInclude ──
console.log("\nVyžádané prvky:")
eq("splněný požadavek (přes roli)",
    validateLine(goodLine(), { ...expected, mustInclude: ["ochrana"] }), [])
check("nesplněný požadavek",
    validateLine(goodLine(), { ...expected, mustInclude: ["keramika"] }).some(i => i.field === "mustInclude"))
eq("prázdný řetězec se ignoruje",
    validateLine(goodLine(), { ...expected, mustInclude: ["", "  "] }), [])

// ── Price tier ──
console.log("\nCenová hladina:")
check("hladina musí odpovídat zadání",
    validateLine(goodLine(), { skuCount: 5, priceTier: "premium" }).some(i => i.field === "priceTier"))

// ── slugifyLine ──
console.log("\nSlug:")
eq("diakritika se skládá, nemizí", slugifyLine("Řada Péče o Lak"), "rada-pece-o-lak")
eq("mezery a interpunkce → pomlčky", slugifyLine("Garage Ritual — Pro!"), "garage-ritual-pro")
eq("bez úvodních a koncových pomlček", slugifyLine("  ***  Test  ***  "), "test")
check("délka je omezená", slugifyLine("a".repeat(200)).length <= 60)
check("výsledek je vždy URL-safe",
    /^[a-z0-9-]*$/.test(slugifyLine("Šílený NÁZEV 2026 (v2) ©")))

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
