/**
 * Import produktu z odkazu — čtení stránky (bez DB, bez sítě).
 *   npx tsx scripts/test-product-url.ts
 *
 * Tady se rozhoduje, jestli se do katalogu dostane „Košile modrá / 1 290 Kč" nebo
 * „Košile modrá | Obchod.cz — sleva! / 1290.00". Rozdíl je vidět až v hotovém postu,
 * kdy už nikdo nedohledá, že to rozbil parser — proto to má aserce.
 *
 * Zvlášť ohlídané:
 *   • strukturovaná data mají přednost před modelem (jinak platíme za to, co jde přečíst),
 *   • SSRF: adresu zadává uživatel a stahuje ji server,
 *   • dedup stojí na normalizované URL — utm_* nesmí založit dvojče.
 */

import {
    normalizeProductUrl,
    assertFetchableUrl,
    extractStructured,
    needsAiFallback,
    mergeAiResult,
    pageToText,
    buildProductPrompt,
    hasEnoughTextForAi,
    MAX_PRODUCT_IMAGES,
} from "../lib/product-url"

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail?: string) {
    if (cond) { passed++; console.log(`  ✅ ${name}`) }
    else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`) }
}

function eq<T>(name: string, actual: T, expected: T) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    check(name, a === e, `čekal ${e}, dostal ${a}`)
}

async function rejects(name: string, fn: () => Promise<unknown>) {
    try {
        await fn()
        check(name, false, "neodmítnuto")
    } catch {
        check(name, true)
    }
}

const PAGE = "https://obchod.cz/produkt/keramicka-ochrana"

async function main() {
    console.log("\n🔗 IMPORT PRODUKTU Z ODKAZU\n")

    // ── Normalizace adresy ──
    console.log("Normalizace adresy:")
    eq("doplní chybějící schéma", normalizeProductUrl("obchod.cz/p/1"), "https://obchod.cz/p/1")
    eq("nechá http, když ho odkaz má", normalizeProductUrl("http://obchod.cz/p/1"), "http://obchod.cz/p/1")
    eq("ořízne fragment", normalizeProductUrl("https://obchod.cz/p/1#galerie"), "https://obchod.cz/p/1")
    // Bez tohohle by „stejný produkt z newsletteru" byl v katalogu podruhé.
    eq("zahodí utm_* a klikací ID",
        normalizeProductUrl("https://obchod.cz/p/1?varianta=m&utm_source=mail&fbclid=xy&gclid=z"),
        "https://obchod.cz/p/1?varianta=m")
    eq("parametr, který mění produkt, zůstává",
        normalizeProductUrl("https://obchod.cz/p?id=42"), "https://obchod.cz/p?id=42")
    eq("prázdný vstup → null", normalizeProductUrl("   "), null)
    eq("holý text není odkaz", normalizeProductUrl("keramická ochrana laku"), null)
    eq("hostname bez tečky není odkaz", normalizeProductUrl("http://intranet/p/1"), null)
    eq("javascript: schéma odmítnuto", normalizeProductUrl("javascript:alert(1)"), null)
    eq("file: schéma odmítnuto", normalizeProductUrl("file:///etc/passwd"), null)

    // ── SSRF: adresu píše uživatel, stahuje ji server ──
    console.log("\nOchrana proti sáhnutí na interní síť:")
    await rejects("localhost", () => assertFetchableUrl("http://localhost/admin"))
    await rejects("loopback IP", () => assertFetchableUrl("http://127.0.0.1:3000/"))
    await rejects("privátní 10.x", () => assertFetchableUrl("http://10.0.0.5/"))
    await rejects("privátní 192.168.x", () => assertFetchableUrl("http://192.168.1.1/"))
    await rejects("privátní 172.16–31.x", () => assertFetchableUrl("http://172.20.0.1/"))
    // Tohle je metadata endpoint cloudu — nejdražší jednotlivá adresa v celém seznamu.
    await rejects("link-local 169.254.169.254", () => assertFetchableUrl("http://169.254.169.254/"))
    await rejects("IPv6 loopback", () => assertFetchableUrl("http://[::1]/"))
    await rejects("doména .internal", () => assertFetchableUrl("https://api.internal/"))
    await rejects("doména .local", () => assertFetchableUrl("https://nas.local/"))

    // ── JSON-LD: hlavní cesta, na kterou spoléhá skoro každý e-shop ──
    console.log("\nJSON-LD Product:")
    {
        const html = `<html><head><script type="application/ld+json">${JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
                { "@type": "WebSite", name: "Obchod.cz" },
                {
                    "@type": "Product",
                    name: "Keramická ochrana laku",
                    description: "Devítiměsíční ochrana laku proti UV a solím.",
                    category: "Domů > Autokosmetika > Ochrana laku",
                    image: ["https://cdn.obchod.cz/a.jpg", { "@type": "ImageObject", url: "https://cdn.obchod.cz/b.jpg" }],
                    offers: { "@type": "Offer", price: "1290.00", priceCurrency: "CZK" },
                },
            ],
        })}</script></head><body><h1>Něco jiného</h1></body></html>`

        const d = extractStructured(html, PAGE)
        eq("název z JSON-LD, ne z <h1>", d.name, "Keramická ochrana laku")
        eq("popis", d.description, "Devítiměsíční ochrana laku proti UV a solím.")
        // Katalog drží cenu jako text; „1290.00 CZK" v postu vypadá jako chyba.
        eq("cena se zformátuje česky", d.price, "1 290 Kč")
        eq("z breadcrumb kategorie se bere list, ne celá cesta", d.type, "Ochrana laku")
        eq("fotky ze stringu i z ImageObject", d.imageUrls, ["https://cdn.obchod.cz/a.jpg", "https://cdn.obchod.cz/b.jpg"])
        eq("označeno jako odečtené", d.extraction, "structured")
        check("s názvem, cenou i popisem se model nevolá", !needsAiFallback(d))
    }

    {
        // ProductGroup + priceSpecification + lowPrice: tři tvary, co v praxi chodí.
        const html = `<script type="application/ld+json">${JSON.stringify({
            "@type": "ProductGroup",
            name: "Šampon",
            offers: [{ "@type": "AggregateOffer", lowPrice: 249, priceCurrency: "CZK" }],
        })}</script>`
        eq("lowPrice u AggregateOffer projde", extractStructured(html, PAGE).price, "249 Kč")
    }
    {
        const html = `<script type="application/ld+json">${JSON.stringify({
            "@type": "Product",
            name: "Kurz detailingu",
            offers: { priceSpecification: { price: 4500, priceCurrency: "EUR" } },
        })}</script>`
        eq("cena z priceSpecification + symbol měny", extractStructured(html, PAGE).price, "4 500 €")
    }
    {
        // Rozbité JSON-LD je na webu běžné — nesmí shodit celý import.
        const html = `<script type="application/ld+json">{ tohle není JSON </script>
            <meta property="og:title" content="Vosk na kola">`
        eq("rozbité JSON-LD se přeskočí a jede se dál", extractStructured(html, PAGE).name, "Vosk na kola")
    }

    // ── OpenGraph a poslední instance ──
    console.log("\nOpenGraph a fallbacky:")
    {
        const html = `<html><head>
            <meta property="og:title" content="Šampon s vysokou pěnivostí">
            <meta property="og:description" content="pH neutrální šampon pro pravidelné mytí.">
            <meta property="og:image" content="//cdn.obchod.cz/sampon.jpg">
            <meta property="product:price:amount" content="349">
            <meta property="product:price:currency" content="CZK">
            </head><body></body></html>`
        const d = extractStructured(html, PAGE)
        eq("název z og:title", d.name, "Šampon s vysokou pěnivostí")
        eq("cena z product:price:*", d.price, "349 Kč")
        eq("protokolově relativní fotka se doplní podle stránky", d.imageUrls, ["https://cdn.obchod.cz/sampon.jpg"])
    }
    {
        const html = `<html><head><title>Košile modrá | Obchod.cz</title></head>
            <body><h1></h1></body></html>`
        // Jinak se do katalogu dostane produkt jménem „Košile modrá | Obchod.cz".
        eq("název e-shopu se z <title> odřízne", extractStructured(html, PAGE).name, "Košile modrá")
    }
    {
        const html = `<meta property="og:title" content="Keramická ochrana – Obchod.cz">`
        eq("patička se ořízne i z og:title", extractStructured(html, PAGE).name, "Keramická ochrana")
    }
    {
        const html = `<meta property="og:site_name" content="Autokosmetika Novák">
            <meta property="og:title" content="Vosk na kola | Autokosmetika Novák">`
        // Jméno e-shopu neodpovídá doméně — musí se poznat přes og:site_name
        eq("patička podle og:site_name", extractStructured(html, PAGE).name, "Vosk na kola")
    }
    {
        const html = `<title>Sada – šampon a vosk</title>`
        // Slepý ořez první části by z tohohle udělal produkt „Sada".
        eq("pomlčka uvnitř názvu se neořezává", extractStructured(html, PAGE).name, "Sada – šampon a vosk")
    }
    {
        const html = `<script type="application/ld+json">${JSON.stringify({
            "@type": "Product", name: "Balíček Jaro | Léto",
        })}</script>`
        eq("jméno z JSON-LD zůstává nedotčené", extractStructured(html, PAGE).name, "Balíček Jaro | Léto")
    }
    {
        const html = `<title>Vosk | Autokosmetika | Obchod.cz</title>`
        // Ořízne se jen to, co se dá ztotožnit s webem — kategorie je součást názvu
        eq("ořezává se jen segment s doménou, ne kategorie",
            extractStructured(html, PAGE).name, "Vosk | Autokosmetika")
    }
    {
        const html = `<meta property="og:site_name" content="Obchod.cz">
            <title>Vosk | Obchod.cz | Obchod.cz</title>`
        eq("dvě patičky za sebou se oříznou obě", extractStructured(html, PAGE).name, "Vosk")
    }
    {
        const html = `<html><head><title>Obchod.cz</title></head><body><h1>Pasta na kola</h1></body></html>`
        eq("<h1> má přednost před <title>", extractStructured(html, PAGE).name, "Pasta na kola")
    }
    {
        const html = `<h1>Sada Zim&aacute;k &amp; l&eacute;to</h1>`
        eq("HTML entity se dekódují", extractStructured(html, PAGE).name, "Sada Zimák & léto")
    }
    {
        eq("číselné entity, desítkově i hexa",
            extractStructured(`<h1>&#352;ampon &#x2013; 5&#160;l</h1>`, PAGE).name, "Šampon – 5 l")
    }
    {
        // Kdyby se &amp; rozbalilo první, „&amp;scaron;" by skončilo jako „š".
        eq("dvojitě escapovaná entita se nerozbalí dvakrát",
            extractStructured(`<h1>Kód &amp;scaron; v názvu</h1>`, PAGE).name, "Kód &scaron; v názvu")
    }
    {
        eq("neznámá entita se nezahodí",
            extractStructured(`<h1>Model &neznama; X</h1>`, PAGE).name, "Model &neznama; X")
    }
    {
        const d = extractStructured(`<h1>Bez ceny i bez popisu</h1>`, PAGE)
        check("samotné jméno na model nestačí — chybí popis i cena", needsAiFallback(d))
        eq("název se přesto vezme", d.name, "Bez ceny i bez popisu")
    }
    eq("prázdná stránka nedá jméno", extractStructured("<html></html>", PAGE).name, null)

    // ── Fotky ──
    console.log("\nVýběr fotek:")
    {
        const html = `
            <img src="/img/logo.png">
            <img src="/img/icon-cart.svg">
            <img src="https://analytics.cz/pixel.gif">
            <img src="/img/produkt-1.jpg" width="800" height="800">
            <img src="/img/odznak.png" width="24" height="24">
            <img src="/img/produkt-2.jpg">`
        const d = extractStructured(html, PAGE)
        eq("logo, ikona, pixel a malý odznak vypadnou",
            d.imageUrls, ["https://obchod.cz/img/produkt-1.jpg", "https://obchod.cz/img/produkt-2.jpg"])
    }
    {
        const many = Array.from({ length: 12 }, (_, i) => `<img src="/img/foto-${i}.jpg">`).join("")
        check(`galerie se zastropuje na ${MAX_PRODUCT_IMAGES}`,
            extractStructured(many, PAGE).imageUrls.length === MAX_PRODUCT_IMAGES)
    }
    {
        const html = `<meta property="og:image" content="https://cdn.obchod.cz/a.jpg">
            <img src="https://cdn.obchod.cz/a.jpg">`
        eq("stejná fotka z OG i z <img> se nezdvojí",
            extractStructured(html, PAGE).imageUrls, ["https://cdn.obchod.cz/a.jpg"])
    }
    {
        eq("lazy-load přes data-src se neztratí",
            extractStructured(`<img data-src="/img/lazy.jpg">`, PAGE).imageUrls,
            ["https://obchod.cz/img/lazy.jpg"])
    }
    {
        // Shopify servíruje jeden snímek v deseti velikostech; bez tohohle by
        // galerie byla pětkrát tentýž obrázek a skutečné pohledy by vypadly.
        const html = `
            <meta property="og:image" content="https://cdn.sh.com/bota.png?v=1&width=100">
            <img src="https://cdn.sh.com/bota.png?v=1&width=1200">
            <img src="https://cdn.sh.com/bota.png?v=1&width=300">
            <img src="https://cdn.sh.com/detail.png?width=800">`
        const d = extractStructured(html, PAGE)
        eq("varianty téže fotky se sloučí a nechá se největší",
            d.imageUrls, ["https://cdn.sh.com/bota.png?v=1&width=1200", "https://cdn.sh.com/detail.png?width=800"])
    }
    {
        const html = `<img src="https://cdn.sh.com/files/vosk_300x300.png">
            <img src="https://cdn.sh.com/files/vosk_1024x1024.png">`
        eq("rozměr v názvu souboru se bere jako tatáž fotka",
            extractStructured(html, PAGE).imageUrls, ["https://cdn.sh.com/files/vosk_1024x1024.png"])
    }
    {
        // JSON-LD uvádí http://, OG https:// — jeden snímek, ne dva
        const html = `<script type="application/ld+json">${JSON.stringify({
            "@type": "Product", name: "Bota", image: "http://cdn.sh.com/bota.png",
        })}</script>
        <meta property="og:image" content="https://cdn.sh.com/bota.png">`
        const d = extractStructured(html, PAGE)
        eq("http a https varianta jsou tatáž fotka", d.imageUrls.length, 1)
        eq("při shodě rozlišení vyhraje https", d.imageUrls, ["https://cdn.sh.com/bota.png"])
    }

    // ── Model je záchranná síť, ne první volba ──
    console.log("\nSloučení s výsledkem modelu:")
    {
        const structured = extractStructured(
            `<script type="application/ld+json">${JSON.stringify({
                "@type": "Product", name: "Pravda ze stránky", offers: { price: 100, priceCurrency: "CZK" },
            })}</script>`, PAGE)
        const merged = mergeAiResult(structured, {
            name: "Model si vymyslel jiné jméno", price: "999 Kč", description: "Doplněný popis", type: "produkt",
        })
        // Odečtená data jsou přesnější než odhad — model smí jen doplňovat díry.
        eq("odečtený název model nepřepíše", merged.name, "Pravda ze stránky")
        eq("odečtená cena model nepřepíše", merged.price, "100 Kč")
        eq("chybějící popis model doplní", merged.description, "Doplněný popis")
        eq("označeno jako kombinace", merged.extraction, "mixed")
    }
    {
        const merged = mergeAiResult(extractStructured("<html></html>", PAGE), { name: "Jen z modelu" })
        eq("bez odečteného jména je zdroj čistě model", merged.extraction, "ai")
        eq("název z modelu", merged.name, "Jen z modelu")
    }
    {
        const structured = extractStructured(`<h1>Produkt</h1>`, PAGE)
        const merged = mergeAiResult(structured, null)
        eq("selhání modelu nepřepíše odečtený název na null", merged.name, "Produkt")
        eq("chybějící pole zůstanou prázdná", [merged.price, merged.description], [null, null])
    }

    // ── Text a prompt pro model ──
    console.log("\nPříprava vstupu pro model:")
    {
        const html = `<html><head><style>.a{color:red}</style></head><body>
            <nav>Domů Kontakt Košík</nav>
            <script>window.dataLayer=[]</script>
            <h1>Vosk na kola</h1><p>Odolný vosk.</p>
            <footer>© 2026 Obchod.cz</footer></body></html>`
        const text = pageToText(html)
        check("skript, styl, navigace i patička jdou pryč",
            !/dataLayer|color:red|Košík|© 2026/.test(text), text)
        check("obsah produktu zůstane", text.includes("Vosk na kola") && text.includes("Odolný vosk."))
        check("nadpis je označený", text.includes("[NADPIS]"))
    }
    {
        check("dlouhá stránka se ořízne", pageToText("x".repeat(50_000)).length <= 6000)
        // Prázdná SPA slupka: model by produkt vymyslel, a vymyšlený produkt
        // v katalogu je horší než hláška, že to nešlo.
        check("prázdná SPA slupka se modelu nepředkládá",
            !hasEnoughTextForAi(pageToText(`<html><body><div id="root"></div><script>app()</script></body></html>`)))
        check("skutečná stránka na model stačí",
            hasEnoughTextForAi(pageToText(`<h1>Vosk</h1><p>${"Odolný vosk na kola. ".repeat(20)}</p>`)))
        const prompt = buildProductPrompt("text stránky", PAGE, extractStructured("<h1>Vosk</h1>", PAGE))
        check("prompt nese adresu i to, co už víme", prompt.includes(PAGE) && prompt.includes("Vosk"))
        check("prompt zakazuje související produkty z patičky", prompt.includes("patičce"))
    }

    console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`)
    process.exit(failed === 0 ? 0 : 1)
}

main()
