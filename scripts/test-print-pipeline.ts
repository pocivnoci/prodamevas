/**
 * Print pipeline geometry + chroma key — pure checks (no DB, no model calls).
 *   npx tsx scripts/test-print-pipeline.ts
 *
 * These are the parts that fail silently. A wrong mm→px conversion produces a file
 * that looks fine on screen and prints at the wrong physical size; a chroma key with
 * the wrong tolerance leaves a magenta halo nobody notices until it is on a label.
 * The old pipeline had none of this — it hardcoded a 1:1 ratio for every product.
 */

import sharp from "sharp"
import {
    parsePrintSize,
    mmToPx,
    closestRatio,
    resolvePrintGeometry,
    chromaKeyToAlpha,
    finalizePrintFile,
    printQaScore,
    CHROMA_KEY,
    SUPPORTED_RATIOS,
    type PrintCategory,
    type PrintQA,
} from "../instagram/print-pipeline"

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

function cat(over: Partial<PrintCategory> = {}): PrintCategory {
    return { slug: "test", label: "Test", ...over }
}

async function main() {
    console.log("\n🖨️  PRINT PIPELINE\n")

    // ── parsePrintSize ──
    console.log("Rozměr tisku:")
    eq("90x130", parsePrintSize("90x130"), { widthMm: 90, heightMm: 130 })
    eq("s mezerami a ×", parsePrintSize(" 220 × 100 "), { widthMm: 220, heightMm: 100 })
    eq("desetinné", parsePrintSize("85.6x54"), { widthMm: 85.6, heightMm: 54 })
    eq("null → čtverec 200", parsePrintSize(null), { widthMm: 200, heightMm: 200 })
    eq("nesmysl → čtverec", parsePrintSize("velké"), { widthMm: 200, heightMm: 200 })
    // Regression: "90 x 130 cm" must not silently parse as millimetres
    eq("s jednotkou → fallback", parsePrintSize("90x130mm"), { widthMm: 200, heightMm: 200 })

    // ── mmToPx ──
    console.log("\nPřevod mm → px:")
    eq("25.4 mm @300 = 300 px", mmToPx(25.4, 300), 300)
    eq("90 mm @300 = 1063 px", mmToPx(90, 300), 1063)
    eq("výchozí DPI je 300", mmToPx(25.4), 300)
    eq("A3 na výšku 297 mm", mmToPx(297), 3508)
    // The whole honesty argument: the model gives ~1024 px, which is this many mm.
    check("1024 px @300 DPI je jen ~87 mm", Math.round((1024 / 300) * 25.4) === 87)

    // ── closestRatio ──
    console.log("\nVýběr poměru stran:")
    eq("čtverec", closestRatio(100, 100), "1:1")
    eq("lahev 75×160 → 9:16", closestRatio(75, 160), "9:16")
    eq("etiketa 90×130 → 3:4", closestRatio(90, 130), "3:4")
    eq("ovin 220×100 → 16:9", closestRatio(220, 100), "16:9")
    eq("plakát A3 297×420 → 3:4", closestRatio(297, 420), "3:4")
    // 85×55 (1.545) sedí skoro přesně mezi 4:3 (1.333) a 16:9 (1.778); v log prostoru
    // je 16:9 o vlas blíž. Shoda se seedem kategorie `card` v migraci.
    eq("vizitka 85×55 → 16:9", closestRatio(85, 55), "16:9")
    eq("nulový rozměr → čtverec", closestRatio(0, 100), "1:1")
    check("vrací jen podporované poměry",
        [[75, 160], [220, 100], [1, 3], [3, 1], [10, 11]]
            .every(([w, h]) => (SUPPORTED_RATIOS as readonly string[]).includes(closestRatio(w, h))))
    // Symmetry in log space — portrait and landscape must not be biased differently
    eq("16:9 a 9:16 jsou zrcadlové", closestRatio(160, 90), "16:9")
    eq("9:16 a 16:9 jsou zrcadlové", closestRatio(90, 160), "9:16")

    // ── resolvePrintGeometry ──
    console.log("\nGeometrie z kategorie:")
    const bottle = resolvePrintGeometry(cat({
        artwork_kind: "label", print_size_mm: "75x160", aspect_ratio: "9:16",
        safe_margin_mm: 4, bleed_mm: 3,
    }))
    eq("typ artworku", bottle.kind, "label")
    eq("rozměr", [bottle.widthMm, bottle.heightMm], [75, 160])
    eq("pixely @300 DPI", [bottle.pixelWidth, bottle.pixelHeight], [886, 1890])
    eq("okraje", [bottle.safeMarginMm, bottle.bleedMm], [4, 3])

    // Nastavený poměr má přednost před odvozeným — jinak by ruční volba v UI nešla přebít
    eq("explicitní poměr vyhrává",
        resolvePrintGeometry(cat({ print_size_mm: "220x100", aspect_ratio: "1:1" })).ratio, "1:1")
    eq("neplatný poměr → odvozený z rozměru",
        resolvePrintGeometry(cat({ print_size_mm: "220x100", aspect_ratio: "2.5:1" })).ratio, "16:9")
    eq("chybějící poměr → odvozený",
        resolvePrintGeometry(cat({ print_size_mm: "75x160" })).ratio, "9:16")

    // Defaults must be safe: a category seeded before this migration has nulls everywhere
    const bare = resolvePrintGeometry(cat())
    eq("prázdná kategorie → flat", bare.kind, "flat")
    eq("prázdná kategorie → čtverec 200 mm", [bare.widthMm, bare.heightMm], [200, 200])
    eq("prázdná kategorie → spadávka 3 mm", bare.bleedMm, 3)
    check("prázdná kategorie dá kladné rozlišení", bare.pixelWidth > 0 && bare.pixelHeight > 0)

    // ── chromaKeyToAlpha ──
    console.log("\nChroma key → alfa:")
    // 4×1 px: pure key · noisy key · brand color · near-magenta but outside tolerance
    const raw = Buffer.from([
        CHROMA_KEY.r, CHROMA_KEY.g, CHROMA_KEY.b,
        250, 8, 248,
        0x0a, 0x0a, 0x0a,
        200, 0, 200,
    ])
    const src = await sharp(raw, { raw: { width: 4, height: 1, channels: 3 } }).png().toBuffer()
    const keyed = await chromaKeyToAlpha(src)
    const { data, info } = await sharp(keyed).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

    eq("zůstává 4 kanály", info.channels, 4)
    eq("rozměr beze změny", [info.width, info.height], [4, 1])
    check("čistá magenta je průhledná", data[3] === 0)
    check("magenta s kompresním šumem je taky průhledná", data[7] === 0, `alpha=${data[7]}`)
    check("tmavá barva značky zůstává neprůhledná", data[11] === 255, `alpha=${data[11]}`)
    check("barva mimo toleranci zůstává neprůhledná", data[15] === 255, `alpha=${data[15]}`)

    // Tolerance is a knob, not a constant — verify it actually widens
    const wide = await chromaKeyToAlpha(src, 100)
    const wideData = (await sharp(wide).ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data
    check("vyšší tolerance zachytí i vzdálenější odstín", wideData[15] === 0)
    check("vyšší tolerance nesmaže barvu značky", wideData[11] === 255)

    // ── finalizePrintFile ──
    // The file has to come out at EXACTLY the physical target with the density
    // embedded, otherwise it opens at 72 DPI in every layout program and prints
    // at roughly four times the intended size.
    console.log("\nFinální tiskový soubor:")
    const artwork = await sharp({
        create: { width: 1024, height: 1820, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 1 } },
    }).png().toBuffer()

    const label = cat({ artwork_kind: "label", print_size_mm: "75x160", aspect_ratio: "9:16" })
    const brief = {
        name: "Test", artworkKind: "label" as const, concept: "c", composition: "x",
        typography: { headline: "Krok 2" }, colors: ["#101010"], placement: "p",
        suggestedTexts: [], negativePrompt: "",
    }
    const { printBuffer, dielineBuffer, spec } = await finalizePrintFile(artwork, label, brief)
    const printMeta = await sharp(printBuffer).metadata()

    eq("přesný cílový rozměr v px", [printMeta.width, printMeta.height], [mmToPx(75), mmToPx(160)])
    eq("vložená hustota 300 DPI", printMeta.density, 300)
    eq("spec sedí s reálným souborem", [spec.pixelWidth, spec.pixelHeight], [printMeta.width, printMeta.height])
    eq("spec drží fyzický rozměr", [spec.widthMm, spec.heightMm], [75, 160])
    check("die-line má stejný rozměr jako tisk",
        (await sharp(dielineBuffer).metadata()).width === printMeta.width)

    // Label keeps its own background; only "flat" artwork gets cut out.
    const labelStats = await sharp(printBuffer).stats()
    check("etiketa zůstává neprůhledná (klíčuje se jen potisk)",
        labelStats.channels.length < 4 || labelStats.channels[3].min === 255)

    // ── printQaScore ──
    console.log("\nQA skóre (nižší = lepší):")
    const ok: PrintQA = { ok: true, textAccurate: true, isFlat: true, logoIntact: true, withinSafeArea: true, issues: [] }
    eq("průchod = 0", printQaScore(ok), 0)

    const notFlat: PrintQA = { ...ok, ok: false, isFlat: false, issues: ["je to fotka produktu"], severity: "severe" }
    const typo: PrintQA = { ...ok, ok: false, textAccurate: false, issues: ["chybí háček"], severity: "cosmetic" }
    check("fotka místo ploché grafiky je horší než překlep",
        printQaScore(notFlat) > printQaScore(typo),
        `${printQaScore(notFlat)} vs ${printQaScore(typo)}`)

    const clipped: PrintQA = { ...ok, ok: false, withinSafeArea: false, issues: ["text u kraje"], severity: "cosmetic" }
    check("ořezaný text je horší než překlep", printQaScore(clipped) > printQaScore(typo))
    check("rozbité logo je horší než ořez",
        printQaScore({ ...ok, ok: false, logoIntact: false, issues: ["logo překreslené"] }) > printQaScore(clipped))
    check("každý neúspěch má skóre > 0", printQaScore(typo) > 0)

    console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`)
    process.exit(failed === 0 ? 0 : 1)
}

main().catch(err => {
    console.error("\n❌ Test crashed:", err)
    process.exit(1)
})
