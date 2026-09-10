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
    check("trefa se pozná (`matched`), aby šlo v logu odlišit výběr od losu", trefa.matched)
    check("trefa vrací tu správnou fotku první",
        trefa.picks[0]?.description.startsWith("Koupelna"))

    const nic = pickBrandPhotos(knihovna, ["Kvantová fyzika a teorie strun"], 3)
    check("bez shody se losuje a hlásí se to (`matched: false`)", !nic.matched && nic.picks.length === 3)

    check("míň fotek než slotů = vezmou se všechny",
        pickBrandPhotos(knihovna.slice(0, 2), ["cokoliv"], 3).picks.length === 2)

    check("nikdy se nevrátí víc, než kolik slotů volající chce",
        pickBrandPhotos(knihovna, ["koupelna kuchyň fasáda zahrada"], 3).picks.length === 3)

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
    check("ruční nahrání zná jméno značky stejně jako onboarding",
        /tagBrandImage\(buffer, 'image\/jpeg', brandRow\?\.name/.test(akce))

    console.log("\n🏷️  SLOVNÍK ŠTÍTKŮ\n")

    check("každý štítek má českou jmenovku i nápovědu",
        BRAND_IMAGE_TAGS.every(t => t.id && t.label && t.hint))
    check("štítek `person` existuje — na něm stojí věrnost obličeje",
        BRAND_IMAGE_TAGS.some(t => t.id === "person"))

    console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`)
    if (failed > 0) process.exit(1)
}

main()
