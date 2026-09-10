/**
 * Fotky značky — výběr, popis, věrnost
 *   npx tsx scripts/test-brand-photos.ts
 *
 * Fotky značky jsou jediné místo, kde do generovaného obrázku vstupuje SKUTEČNOST
 * klienta — jeho prostor, jeho produkt, jeho obličej. Když se vybere špatná fotka
 * (nebo se losuje), model si scénu vymyslí a zákazník dostane fotobankový obrázek
 * za cenu vlastní značky. Proto se tady hlídají tři věci:
 *
 *   1. VÝBĚR má jednu implementaci. Do 9/2026 stálo skórování ve dvou kopiích
 *      (obraz + reel) a rozcházely se.
 *   2. ČEŠTINA. Porovnávalo se `context.includes(slovo)` nad syrovým textem, takže
 *      „koupelna" se netrefila do „koupelně" a `bar` sedělo doprostřed „barvy“.
 *   3. POPIS od člověka je konečný. Jde k modelu doslova, takže ho AI nesmí přepsat.
 */

import fs from "fs"
import path from "path"
import { scoreBrandPhoto, pickBrandPhotos, words } from "../instagram/brand-photo-match"
import { BRAND_IMAGE_TAGS, BRAND_DESCRIPTION_MAX } from "../instagram/configs/types"

let passed = 0
let failed = 0
function check(name: string, cond: boolean, detail?: string) {
    if (cond) { passed++; console.log(`  ✅ ${name}`) }
    else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`) }
}

const ctx = (s: string) => words(s)
const img = (tags: string[], description = "") => ({ tags, description })

function main() {
    console.log("\n🔤 ČEŠTINA — skloňování a diakritika\n")

    check("popis se trefí do skloňovaného tvaru („koupelna“ → „v koupelně“)",
        scoreBrandPhoto(img([], "Moderní koupelna s vanou"), ctx("Jak si zařídit pořádek v koupelně")) > 0)

    check("diakritika nerozhoduje („zahrada“ → „zahradě“)",
        scoreBrandPhoto(img([], "Zahrada s posezením"), ctx("Posezení na zahradě")) > 0)

    check("štítek se trefí i podle ČESKÉ jmenovky, ne jen anglického ID",
        scoreBrandPhoto(img(["bathroom"]), ctx("Rekonstrukce koupelny na klíč")) > 0,
        "štítek bathroom má jmenovku „Koupelna“ — česká věta na anglické ID nesedí")

    check("krátká slova jsou pořád informace („auto“ → „auta“)",
        scoreBrandPhoto(img([], "Závodní auto s polepy"), ctx("Připrav auta na zimu")) > 0)

    console.log("\n🚫 FALEŠNÉ SHODY — horší než žádné, vytlačí správnou fotku\n")

    check("`bar` se netrefí doprostřed „barvy“",
        scoreBrandPhoto(img(["bar"]), ctx("Vybíráme barvy na fasádu")) === 0)

    check("štítek se porovnává na hranici slova, ne podřetězcem věty",
        scoreBrandPhoto(img(["pool"]), ctx("Liverpool hraje v neděli")) === 0)

    check("dvouznakové slovo z popisu nic neváží",
        scoreBrandPhoto(img([], "Auto na CZ trhu"), ctx("Trh v CZ roste")) === 0
        || scoreBrandPhoto(img([], "xy"), ctx("xy")) === 0)

    console.log("\n⚖️  VÁHY — kurátorský štítek nesmí přebít dlouhý popis\n")

    const dlouhyPopis = img([], "koupelna vana sprcha obklady dlazba zrcadlo baterie umyvadlo")
    const jedenStitek = img(["bathroom"], "")
    const kontext = ctx("koupelna vana sprcha obklady dlazba zrcadlo baterie umyvadlo")
    check("popis má strop, aby nepřeválcoval štítky",
        scoreBrandPhoto(dlouhyPopis, kontext) <= 6,
        `popis dal ${scoreBrandPhoto(dlouhyPopis, kontext)} bodů`)
    check("štítek váží víc než jedno slovo popisu",
        scoreBrandPhoto(jedenStitek, ctx("koupelna")) > scoreBrandPhoto(img([], "koupelna"), ctx("koupelna")))

    console.log("\n🎲 VÝBĚR — kdy je to kurátorské a kdy losování\n")

    const knihovna = [
        img(["bathroom"], "Koupelna s vanou"),
        img(["kitchen"], "Kuchyň s ostrůvkem"),
        img(["exterior"], "Fasáda domu"),
        img(["garden"], "Zahrada s bazénem"),
    ]
    const trefa = pickBrandPhotos(knihovna, ["Rekonstrukce koupelny"], 3)
    check("trefa se hlásí jako `matched`, ať jde v logu odlišit výběr od losu",
        trefa.mode === "matched")
    check("trefa vrací tu správnou fotku první",
        trefa.picks[0]?.description.startsWith("Koupelna"))

    const nic = pickBrandPhotos(knihovna, ["Kvantová fyzika a teorie strun"], 3)
    check("bez shody se losuje a hlásí se to (`random`)",
        nic.mode === "random" && nic.picks.length === 3)

    const vsechny = pickBrandPhotos(knihovna.slice(0, 2), ["cokoliv"], 3)
    check("míň fotek než slotů = vezmou se všechny", vsechny.picks.length === 2)
    // Dřív to hlásilo `matched: false` a log tvrdil „nic se netrefilo — náhodné
    // fotky“, přestože se nelosovalo ani nevybíralo. Diagnostika, která lže, je
    // horší než žádná.
    check("„vzalo se všechno“ NENÍ totéž co „losovalo se“", vsechny.mode === "all")

    check("nikdy se nevrátí víc, než kolik slotů volající chce",
        pickBrandPhotos(knihovna, ["koupelna kuchyň fasáda zahrada"], 3).picks.length === 3)

    // `sort(() => Math.random() - 0.5)` není zamíchání — komparátor je nekonzistentní
    // a výsledek závisí na řadicím algoritmu. Naměřeno 739× vs 254× místo 360×.
    const velka = Array.from({ length: 25 }, (_, i) => img(["xxxx"], "zzzz " + i))
    const pocty = new Array(25).fill(0)
    for (let i = 0; i < 3000; i++) {
        for (const p of pickBrandPhotos(velka, ["naprosto nesouvisejici text"], 3).picks) {
            pocty[velka.indexOf(p)]++
        }
    }
    const ocekavano = (3000 * 3) / 25
    const odchylka = Math.max(...pocty.map(c => Math.abs(c - ocekavano))) / ocekavano
    check("los je opravdu náhodný, ne zkreslený k prvním fotkám",
        odchylka < 0.25,
        `největší odchylka od rovnoměrného rozdělení je ${Math.round(odchylka * 100)} %`)

    console.log("\n🧍 JEDNA IMPLEMENTACE — obraz i reel\n")

    const root = path.join(__dirname, "..")
    const obraz = fs.readFileSync(path.join(root, "instagram/orchestrators/image-orchestrator.ts"), "utf-8")
    const reel = fs.readFileSync(path.join(root, "instagram/orchestrators/reel-orchestrator.ts"), "utf-8")

    for (const [jmeno, kod] of [["obraz", obraz], ["reel", reel]] as const) {
        check(`${jmeno} vybírá přes pickBrandPhotos`, /pickBrandPhotos\(/.test(kod))
        check(`${jmeno} nemá vlastní kopii skórování`,
            !/score\s*\+=\s*3/.test(kod),
            "druhá kopie skóre se vždycky rozejde s první")
    }

    check("tvář značky se přikládá mimo skórování",
        /hasPersonRef/.test(obraz) && /personRefs\[0\]/.test(obraz),
        "portrét se skoro nikdy netrefí do textu postu — musí jít natvrdo")

    console.log("\n✍️  POPIS OD ČLOVĚKA JE KONEČNÝ\n")

    const akce = fs.readFileSync(path.join(root, "app/actions/brand-images-action.ts"), "utf-8")
    check("popis jde přepsat ručně (setBrandImageTags bere description)",
        /description\?:\s*string/.test(akce))
    check("nezadaný popis se nesmaže (undefined ≠ prázdný řetězec)",
        /description === undefined/.test(akce))
    check("ruční zásah se značí userTagged",
        /userTagged: true/.test(akce))
    check("přeznačení AI ruční fotky přeskakuje",
        /if \(img\.userTagged\) \{ retagged\.push\(img\); continue \}/.test(akce))
    check("popis má strop, ať nesoupeří s promptem", BRAND_DESCRIPTION_MAX > 0 && BRAND_DESCRIPTION_MAX <= 400)
    // Selhání štítkování není vzácnost (přetížený model, timeout). Když se při něm
    // uloží holé URL místo objektu, `append_brand_image` hledá `p_image->>'url'`,
    // nad JSON řetězcem dostane NULL a zápis odmítne — fotka skončí ve storage
    // a do galerie se nikdy nedostane.
    check("i fotka bez štítků se ukládá jako OBJEKT s url",
        /const brandImageObj: BrandImage = \{ url: imageUrl/.test(akce)
        && !/brandImageObj: any = imageUrl/.test(akce),
        "holé URL neprojde přes append_brand_image a fotka tiše zmizí")

    check("ruční nahrání zná jméno značky stejně jako onboarding",
        /tagBrandImage\(buffer, 'image\/jpeg', brandRow\?\.name/.test(akce))

    console.log("\n📤 NAHRÁVÁNÍ — hlášeno zákazníkem 10. 9. 2026\n")

    // „nejdřív po 5ks a pak jen po 1…1 se nahrála…a další už se nenahrála“
    // „Jen tahle se nahrála a koukám že 2×“ — obojí je tentýž závod nad config JSONB.
    check("zápis do konfigurace jde přes atomické append_brand_image",
        /rpc\('append_brand_image'/.test(akce),
        "přečti-uprav-zapiš mezi sharpem a vision modelem ztrácí souběžné nahrání")
    check("název souboru je z OBSAHU, ne z času",
        /createHash\('sha256'\)/.test(akce) && !/\$\{category\}-\$\{timestamp\}/.test(akce),
        "Date.now() dělal ze druhého nahrání téže fotky druhý řádek")
    check("po nahrání se zahodí kešovaná konfigurace",
        /invalidateConfigCache\(clientSlug\)/.test(akce.slice(0, akce.indexOf("Delete a brand"))),
        "engine drží config 60 s — čerstvá fotka by se do příspěvků nedostala")

    const migrace = fs.readdirSync(path.join(root, "supabase/migrations"))
        .filter(f => f.endsWith(".sql"))
        .map(f => fs.readFileSync(path.join(root, "supabase/migrations", f), "utf-8"))
    check("append_brand_image existuje a je idempotentní",
        migrace.some(m => /CREATE OR REPLACE FUNCTION append_brand_image/.test(m) && /pg_advisory_xact_lock/.test(m)))

    const tab = fs.readFileSync(path.join(root, "app/(dashboard)/dashboard/instagram/tabs/BrandTab.tsx"), "utf-8")
    check("fotka se zmenší v prohlížeči, než se odešle",
        /shrinkForUpload/.test(tab),
        "8MB fotka z telefonu trhá bodySizeLimit a táhne se desítky sekund")
    // POZOR: tohle NEZNAMENÁ paralelní upload. Next.js server actions z jednoho
    // klienta se řadí do fronty (naměřeno: osm fotek po ~6 s za sebou). Smyčka je
    // tu proto, aby se zmenšování obrázku v prohlížeči překrývalo s čekáním na server.
    check("nahrávání běží ve smyčce, ne jedním blokujícím průchodem", /CONCURRENCY/.test(tab))
    check("uživatel vidí, kolikátá fotka se nahrává", /progress\.total/.test(tab),
        "ukazatel bez čísel se po minutě nedá odlišit od zaseknutého programu")
    check("částečný neúspěch se přizná (`Nahráno X z Y`)", /Nahráno \$\{successCount\} z/.test(tab),
        "dřív se ukázala jen poslední chyba, takže 3 z 5 vypadaly jako úspěch")

    // Naměřeno na produkci: osm fotek bylo ve storage i v konfiguraci, a přesto se
    // na obrazovce točilo kolečko dál — `setUploading(false)` stálo za
    // `await loadImages()` bez try/finally, takže ho jediná odmítnutá server action
    // přeskočila. Ukazatel průběhu nesmí viset na tom, že poslední krok dopadne dobře.
    const vypnutiUkazatele = tab.match(/\} finally \{[\s\S]{0,200}?setUploading\(false\)/)
    check("kolečko nahrávání se vypíná ve `finally`, ne na šťastné cestě",
        !!vypnutiUkazatele,
        "bez finally přežije ukazatel dokončenou práci a vypadá to jako zásek")
    check("i načtení seznamu vypíná své kolečko ve `finally`",
        /\} finally \{\s*setLoading\(false\)/.test(tab))
    check("selhání dotažení seznamu neshodí celé nahrání",
        /seznam se nepodařilo načíst/.test(tab))
    check("fotka se objeví v mřížce hned, ne až na konci dávky",
        /setImages\(prev => prev\.some/.test(tab),
        "server actions jedou po jedné — bez průběžného doplňování je to minuta u kolečka")

    const cfg = fs.readFileSync(path.join(root, "next.config.ts"), "utf-8")
    const limitMb = Number(cfg.match(/bodySizeLimit:\s*"(\d+)mb"/)?.[1] ?? 0)
    const guardBytes = Number(akce.match(/file\.size > ([\d_]+)/)?.[1]?.replace(/_/g, "") ?? 0)
    check("strop v akci nepřeslibuje, co platforma pustí",
        limitMb > 0 && guardBytes > 0 && guardBytes <= limitMb * 1_000_000,
        `akce pouští ${guardBytes} B, bodySizeLimit je ${limitMb} MB`)

    console.log("\n🏷️  SLOVNÍK ŠTÍTKŮ\n")

    check("každý štítek má českou jmenovku i nápovědu",
        BRAND_IMAGE_TAGS.every(t => t.id && t.label && t.hint))
    check("štítek `person` existuje — na něm stojí věrnost obličeje",
        BRAND_IMAGE_TAGS.some(t => t.id === "person"))

    console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`)
    if (failed > 0) process.exit(1)
}

main()
