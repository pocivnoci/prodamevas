/**
 * buildPostEditPrompt — pure prompt-shape tests
 *
 * The whole feature rests on one claim: the prompt we hand the image model asks it to
 * RETOUCH the picture, never to design a new one. That claim is checkable without an
 * API key, so it is checked here on every run.
 *
 * Run: npx tsx scripts/test-post-edit-prompt.ts
 */

import { buildPostEditPrompt, normalizeEditRegion } from "../instagram/image-pipeline"

let passed = 0
let failed = 0

function test(name: string, fn: () => void) {
    try {
        fn()
        passed++
        console.log(`  ✅ ${name}`)
    } catch (err: any) {
        failed++
        console.log(`  ❌ ${name}\n     ${err.message}`)
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg)
}

console.log("\n═══ normalizeEditRegion ═══")

test("plná oblast projde beze změny", () => {
    const r = normalizeEditRegion({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 })
    assert(!!r && r.x === 0.1 && r.y === 0.2 && r.w === 0.3 && r.h === 0.4, `dostal ${JSON.stringify(r)}`)
})

test("box přetékající rám se ořízne dovnitř", () => {
    const r = normalizeEditRegion({ x: 0.8, y: 0.9, w: 0.5, h: 0.5 })
    assert(!!r, "box zmizel")
    assert(r!.x + r!.w <= 1.0001 && r!.y + r!.h <= 1.0001, `přetéká: ${JSON.stringify(r)}`)
})

test("záporné souřadnice se přitáhnou k nule", () => {
    const r = normalizeEditRegion({ x: -0.5, y: -0.2, w: 0.4, h: 0.4 })
    assert(!!r && r.x === 0 && r.y === 0, `dostal ${JSON.stringify(r)}`)
})

test("nulová plocha (klik bez tažení) se zahodí", () => {
    assert(normalizeEditRegion({ x: 0.5, y: 0.5, w: 0, h: 0 }) === undefined, "0×0 box prošel")
    assert(normalizeEditRegion({ x: 0.5, y: 0.5, w: 0.001, h: 0.3 }) === undefined, "degenerovaný box prošel")
})

test("chybějící / neúplná oblast je undefined", () => {
    assert(normalizeEditRegion(undefined) === undefined, "undefined neprošlo")
    assert(normalizeEditRegion(null) === undefined, "null neprošlo")
    assert(normalizeEditRegion({ x: 0.1, y: 0.1 }) === undefined, "neúplný box prošel")
    assert(normalizeEditRegion({ x: NaN, y: 0.1, w: 0.2, h: 0.2 }) === undefined, "NaN prošel")
})

console.log("\n═══ buildPostEditPrompt — ochrana ═══")

const base = buildPostEditPrompt({ instruction: "dej nadpis výš" })

test("instrukce uživatele je první blok", () => {
    assert(base.startsWith("Apply this change to the image: dej nadpis výš"), `začíná: ${base.slice(0, 60)}`)
})

test("ochranná klauzule je vždy přítomná", () => {
    assert(/Keep the composition, framing, photo, colors, typography style, logo and layout\s+EXACTLY the same/.test(base), "chybí klauzule o zachování")
    assert(base.includes("targeted retouch of an existing finished design"), "chybí věta o retuši")
    assert(base.includes("not a new design"), "chybí zákaz nového návrhu")
})

test("česká diakritika je hlídaná vždy", () => {
    assert(base.includes("exact spelling and diacritics"), "chybí požadavek na diakritiku")
})

test("prompt nikdy nevyzývá k vytvoření nového vizuálu", () => {
    // Přesně tohle dělá generateDesignBrief → renderImage, tedy cesta, kterou tenhle
    // prompt nahrazuje. Kdyby se sem taková formulace dostala, model klidně nakreslí
    // nový návrh a jsme zpátky u „napíšu uprav a změní se celá grafika".
    for (const banned of [
        /create a new/i,
        /generate a new/i,
        /design a new/i,
        /new composition/i,
        /photorealistic, editorial/i,
    ]) {
        assert(!banned.test(base), `prompt obsahuje zakázanou formulaci: ${banned}`)
    }
})

console.log("\n═══ buildPostEditPrompt — oblast ═══")

test("bez oblasti se o oblasti nemluví", () => {
    assert(!base.includes("APPLY THE CHANGE ONLY"), "omezení oblasti se objevilo bez oblasti")
})

test("oblast se převede na procenta i na slovní popis", () => {
    const p = buildPostEditPrompt({
        instruction: "zmenši logo",
        region: { x: 0.62, y: 0.08, w: 0.32, h: 0.23 },
    })
    assert(p.includes("APPLY THE CHANGE ONLY"), "chybí omezení na oblast")
    assert(p.includes("62%") && p.includes("94%"), `chybí vodorovná procenta: ${p}`)
    assert(p.includes("8%") && p.includes("31%"), `chybí svislá procenta: ${p}`)
    assert(p.includes("upper-right area"), `chybí slovní popis kvadrantu: ${p}`)
    assert(p.includes("pixel-identical"), "chybí požadavek na neměnnost okolí")
})

test("slovní popis sedí na jednotlivé kvadranty", () => {
    const name = (x: number, y: number) =>
        buildPostEditPrompt({ instruction: "x", region: { x, y, w: 0.15, h: 0.15 } })
    assert(name(0.05, 0.05).includes("upper-left area"), "levý horní")
    assert(name(0.8, 0.8).includes("lower-right area"), "pravý dolní")
    assert(name(0.45, 0.45).includes("the centre of the frame"), "střed")
    assert(name(0.45, 0.05).includes("upper centre"), "horní střed")
})

test("výběr přes celý snímek se nevydává za lokalizaci", () => {
    const p = buildPostEditPrompt({ instruction: "x", region: { x: 0, y: 0, w: 1, h: 1 } })
    assert(p.includes("almost the entire frame"), `dostal: ${p}`)
})

test("degenerovaná oblast blok o oblasti nevytvoří", () => {
    const p = buildPostEditPrompt({ instruction: "x", region: { x: 0.5, y: 0.5, w: 0, h: 0 } })
    assert(!p.includes("APPLY THE CHANGE ONLY"), "0×0 oblast se dostala do promptu")
})

console.log("\n═══ buildPostEditPrompt — hook a „nesahej na\" ═══")

test("„nesahej na\" se přenese doslova", () => {
    const p = buildPostEditPrompt({ instruction: "zvětši text", preserve: "foto a barvy" })
    assert(p.includes("KEEP UNCHANGED"), "chybí blok KEEP UNCHANGED")
    assert(p.includes("foto a barvy"), "chybí uživatelův text")
})

test("prázdné „nesahej na\" blok nevytvoří", () => {
    const p = buildPostEditPrompt({ instruction: "zvětši text", preserve: "   " })
    assert(!p.includes("KEEP UNCHANGED"), "prázdné pole vytvořilo blok")
})

test("hook se vyžaduje znak po znaku", () => {
    const p = buildPostEditPrompt({ instruction: "posuň logo doleva", hook: "Příliš žluťoučký kůň" })
    assert(p.includes("character-for-character"), "chybí požadavek na doslovnost")
    assert(p.includes("Příliš žluťoučký kůň"), "chybí samotný hook")
})

test("úprava textu smí hook přepsat — jinak by si prompt odporoval", () => {
    // „změň nadpis na X" + „nadpis musí znít přesně Y" = model dostane dvě protichůdné
    // instrukce a typicky vyhraje ta druhá, takže by uživatelova změna tiše zmizela.
    const p = buildPostEditPrompt({ instruction: "změň nadpis na Sleva 50 %", hook: "Původní nadpis" })
    assert(p.includes("unless the change above explicitly rewords it"), `chybí úniková klauzule: ${p}`)

    const q = buildPostEditPrompt({ instruction: "posuň logo doleva", hook: "Původní nadpis" })
    assert(!q.includes("unless the change above"), "úniková klauzule se objevila u netextové změny")
})

console.log()
console.log("═".repeat(60))
console.log(`  ${passed} passed, ${failed} failed`)
console.log("═".repeat(60))
process.exit(failed > 0 ? 1 : 0)
