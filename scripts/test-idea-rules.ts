/**
 * Pravidla zásobníku nápadů — čisté funkce, bez DB a bez modelu.
 *   npx tsx scripts/test-idea-rules.ts
 *
 * Regrese tady nic neshodí: nápad „zábavné reels video" jen zase tiše proklouzne do
 * obrázkového slotu plánu a nápady bez kategorie zůstanou pod čipy neviditelné.
 * Proto se pravidla ověřují na konkrétních větách z produkce (září 2026).
 */

import {
    prescribesFormat,
    formatWordsIn,
    formatWordsList,
    violatesSlot,
    findMiscategorized,
    categoryKeySet,
    categoryLine,
} from "../instagram/idea-rules"

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

console.log("\n— Nápad, který předepisuje formát (věty z produkce) —")
{
    const bad = [
        "Zábavné reels video, jak trenér ukazuje chyby u dřepu.",
        "Humorné POV video ukazující teenagera, který poprvé vchází do Olympie sám.",
        "Formou reels ukážeme cestu na recepci, kde student předloží ISIC.",
        "Natočíme krátký klip z natáčení v dílně.",
        "Video s naším certifikovaným trenérem rozebírá nejčastější chyby.",
        "Krátké emotivní videjko, kde cvičenec objímá stroj.",
        "Rychlý TikTok trend s přechodem před logem.",
        "Sdílej do stories, ať to vidí i kamarádi.",
        "Na pěti slidech rozebereme rozdíl mezi pachtem a nájmem.",
        "Karusel s postupem: od holé střechy k hotové izolaci.",
    ]
    for (const s of bad) check(`předepisuje: „${s.slice(0, 48)}…"`, prescribesFormat(s), formatWordsList(s).join(","))

    const good = [
        "Trenér ukazuje tři nejčastější chyby u dřepu — každou s tím, co za ni tělo zaplatí.",
        "Evidence o ceně půdy: proč hektar u Vídně stojí dvakrát tolik.",
        "Storytelling o zakladateli: jak z jedné pece vznikla pekárna.",
        "Provider vs. providence — slovní hříčka, ve které se schovává slovo, ale ne formát.",
        "Cvičenec dramaticky objímá madla stroje jako kamaráda po prázdninách.",
        "Mýtus: cvičení do selhání každý den zastavuje růst.",
    ]
    for (const s of good) check(`nepředepisuje: „${s.slice(0, 48)}…"`, !prescribesFormat(s), formatWordsList(s).join(","))
}

console.log("\n— Skupiny slov a česká flexe —")
{
    const w = formatWordsIn("Video, videa, videu i videem — reel, reels i reelsy; natočíme a natáčení; karusel, slidy, story.")
    eq("video skupina", w.video.map(x => x.toLowerCase()), ["video", "videa", "videu", "videem", "reel", "reels", "reelsy", "natočíme", "natáčení"])
    eq("karusel skupina", w.carousel.map(x => x.toLowerCase()), ["karusel", "slidy"])
    eq("story skupina", w.story.map(x => x.toLowerCase()), ["story"])
    eq("seznam bez duplicit", formatWordsList("video Video VIDEO"), ["video"])
}

console.log("\n— Porušení slotu (koncept plánu už slot má) —")
{
    const video = "Za 60 sekund ti ukážu video, jak se to dělá"
    eq("video u obrázku vadí", violatesSlot(video, "image"), ["video"])
    eq("video u karuselu vadí", violatesSlot(video, "carousel"), ["video"])
    eq("video u reelu je v pořádku", violatesSlot(video, "reel"), [])
    eq("video u dlouhého reelu je v pořádku", violatesSlot(video, "reel_long"), [])

    const slides = "Na pěti slidech rozebereme, co dělá pacht s cenou"
    eq("slidy u karuselu jsou v pořádku", violatesSlot(slides, "carousel"), [])
    eq("slidy u obrázku vadí", violatesSlot(slides, "image"), ["slidech"])
    eq("slidy u reelu vadí", violatesSlot(slides, "reel"), ["slidech"])

    eq("story vadí všude (plán story nezná)", violatesSlot("Přidej do stories", "reel"), ["stories"])
    eq("čistý koncept nikde nevadí", violatesSlot("Tři chyby u dřepu, které stojí kolena", "image"), [])
}

console.log("\n— Nápady bez platné kategorie —")
{
    const pillars = {
        reach: { categories: [{ id: "technika" }, { id: "myty" }] },
        sales: { categories: [{ id: "permanentky" }] },
        community: { categories: [] },
    }
    const ideas = [
        { id: "a", category: "reach", subcategory: "technika" },     // v pořádku
        { id: "b", category: "reach", subcategory: null },           // chybí
        { id: "c", category: "reach", subcategory: "gym_meme" },     // sirotek po přegenerování
        { id: "d", category: "sales", subcategory: "technika" },     // kategorie cizího pilíře
        { id: "e", category: "community", subcategory: null },       // pilíř bez kategorií — není kam
        { id: "f", category: "retired", subcategory: "cokoli" },     // pilíř už neexistuje — nehodnotí se
    ]
    eq("najde chybějící, sirotky i cizí pilíř", findMiscategorized(ideas, pillars).map(i => i.id), ["b", "c", "d"])
    eq("prázdná konfigurace = nic k zařazení", findMiscategorized(ideas, {}), [])
    eq("množina klíčů pilíř:kategorie", [...categoryKeySet(pillars)].sort(), ["reach:myty", "reach:technika", "sales:permanentky"])
}

console.log("\n— Řádek katalogu do promptu —")
{
    eq("plný řádek", categoryLine({ id: "myty", emoji: "🎭", label: "Mýty", prompt: "vyvracej omyly", weight: 0.4 }),
        "- myty: 🎭 Mýty — vyvracej omyly (váha 40 %)")
    eq("bez volitelných polí", categoryLine({ id: "x" }), "- x: 📌 x")
}

console.log(`\n${failed === 0 ? "✅" : "❌"} idea-rules: ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
