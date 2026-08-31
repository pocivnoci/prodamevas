/**
 * Sken webu → katalog: co je nový produkt a co dvojče (bez DB, bez sítě).
 *   npx tsx scripts/test-product-scrape.ts
 *
 * Tenhle sken teď spouští i onboarding, hned potom, co do katalogu zapsal produkty
 * z brand analýzy. Ty dvě sady se PŘEKRÝVAJÍ a každá má vlastní slugy — kdyby se
 * dvojče poznávalo jen podle slugu, klient by po onboardingu našel „Svatební kytice"
 * dvakrát. Chyba, kterou nikdo nehlásí, jen si o produktu myslí své.
 *
 * Zvlášť ohlídané:
 *   • dvojče podle názvu, i když se slug liší (přesně případ onboardingu),
 *   • fotka se doplní jen tomu, kdo žádnou nemá — ruční fotka klienta je víc,
 *   • dva různé produkty s jedním slugem od modelu se nesmí navzájem sníst.
 */

import { planCatalogWrite, type CatalogRow, type ScrapedProduct } from "../lib/product-scrape"

let passed = 0
let failed = 0

function test(name: string, fn: () => void) {
    try {
        fn()
        passed++
        console.log(`  ✅ ${name}`)
    } catch (e) {
        failed++
        console.log(`  ❌ ${name}`)
        console.log(`     └─ ${(e as Error).message}`)
    }
}

function assert(condition: boolean, msg: string) {
    if (!condition) throw new Error(msg)
}

const product = (p: Partial<ScrapedProduct> & { name: string }): ScrapedProduct => ({
    slug: p.slug ?? p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    ...p,
})

const row = (r: Partial<CatalogRow> & { name: string; slug: string }): CatalogRow => ({
    id: r.id ?? `id-${r.slug}`,
    image_urls: r.image_urls ?? [],
    ...r,
})

console.log("\n🧪 Sken webu → katalog\n")

test("prázdný katalog vezme všechno", () => {
    const plan = planCatalogWrite([], [
        product({ name: "Svatební kytice", slug: "svatebni-kytice", imageUrl: "https://web.cz/a.jpg" }),
        product({ name: "Rozvoz květin", slug: "rozvoz-kvetin" }),
    ])
    assert(plan.inserts.length === 2, `měly se vložit 2 produkty, ne ${plan.inserts.length}`)
    assert(plan.backfills.length === 0, "nemá co doplňovat, katalog byl prázdný")
})

test("stejný slug = dvojče, ne druhý řádek", () => {
    const plan = planCatalogWrite(
        [row({ name: "Svatební kytice", slug: "svatebni-kytice" })],
        [product({ name: "Svatební kytice", slug: "svatebni-kytice" })],
    )
    assert(plan.inserts.length === 0, "produkt už v katalogu je")
})

test("dvojče se pozná i podle názvu, když slug sedí jinak", () => {
    // Přesně onboarding: analýza zapsala produkt pod vlastním slugem, sken ho zná jinak.
    const plan = planCatalogWrite(
        [row({ id: "p1", name: "Svatební kytice", slug: "svatebni-kytice-premium" })],
        [product({ name: "Svatební kytice", slug: "svatebni-kytice", imageUrl: "https://web.cz/a.jpg" })],
    )
    assert(plan.inserts.length === 0, "ten samý produkt se nesmí založit podruhé jen kvůli jinému slugu")
    assert(plan.backfills.length === 1 && plan.backfills[0].productId === "p1",
        "místo dvojčete se má doplnit fotka tomu, co už v katalogu je")
})

test("diakritika a velká písmena rozdíl nedělají", () => {
    const plan = planCatalogWrite(
        [row({ name: "Šípková růže", slug: "ruze-1" })],
        [product({ name: "ŠÍPKOVÁ RŮŽE", slug: "sipkova-ruze" })],
    )
    assert(plan.inserts.length === 0, "ŠÍPKOVÁ RŮŽE a Šípková růže je jeden produkt")
})

test("produkt s vlastní fotkou se nepřepisuje", () => {
    const plan = planCatalogWrite(
        [row({ name: "Svatební kytice", slug: "svatebni-kytice", image_urls: ["https://storage/moje.jpg"] })],
        [product({ name: "Svatební kytice", slug: "svatebni-kytice", imageUrl: "https://web.cz/a.jpg" })],
    )
    assert(plan.backfills.length === 0, "fotka od klienta má přednost před fotkou z webu")
})

test("tentýž produkt dvakrát v jedné dávce spadne na jeden řádek", () => {
    // Model ho najde na homepage i na podstránce a pokaždé si vymyslí jiný slug.
    const plan = planCatalogWrite([], [
        product({ name: "Svatební kytice", slug: "svatebni-kytice" }),
        product({ name: "Svatební kytice", slug: "kytice-svatebni" }),
    ])
    assert(plan.inserts.length === 1, `jeden produkt = jeden řádek, ne ${plan.inserts.length}`)
})

test("dva různé produkty s jedním slugem se nesnědí", () => {
    const plan = planCatalogWrite([], [
        product({ name: "Dárkový poukaz 500", slug: "poukaz" }),
        product({ name: "Dárkový poukaz 1000", slug: "poukaz" }),
    ])
    assert(plan.inserts.length === 2, "různé produkty musí projít oba, i když jim model dal stejný slug")
    assert(plan.inserts[1].slug === "poukaz-2", `druhý má dostat volný slug, dostal ${plan.inserts[1].slug}`)
})

test("slug obsazený v katalogu se nepřepíše", () => {
    const plan = planCatalogWrite(
        [row({ name: "Poukaz na masáž", slug: "poukaz" })],
        [product({ name: "Dárkový poukaz", slug: "poukaz" })],
    )
    assert(plan.inserts.length === 1, "jiný produkt se má vložit")
    assert(plan.inserts[0].slug === "poukaz-2",
        `nesmí sáhnout na cizí slug (UNIQUE by shodil celý insert), dostal ${plan.inserts[0].slug}`)
})

console.log(`\n──────────────────────────────────────────────────`)
console.log(`  ✅ ${passed} prošlo | ❌ ${failed} selhalo`)
console.log(`──────────────────────────────────────────────────\n`)

if (failed > 0) process.exit(1)
