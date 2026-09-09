/**
 * Showcase kity — čisté kontroly bez DB a bez sítě.
 *   npx tsx scripts/test-showcase-kit.ts
 *
 * Dvě věci se tu hlídají, protože obě selžou tiše a draho:
 *
 *  1. `applyShowcaseKit` nesmí sáhnout na vstup. `CLIENT_CONFIG` v autopilotu
 *     je modulově globální a cachovaná napříč posty jedné lambdy — mutace by
 *     obarvila i další posty klienta a poznalo by se to až na hotovém feedu.
 *  2. Anonymita série. Portfoliové firmy nejsou zákazníci a nevědí o sobě;
 *     na Instagramu není místo na disclaimer, takže jmenovitá ukázka by
 *     tvrdila obchodní vztah, který neexistuje.
 */

import { applyShowcaseKit, buildSegmentTopic, buildShowcaseTopic, isDeadShowcaseColor, isRegulatedShowcase, isTooCloseToOwnPalette, SHOWCASE_BENEFITS, type ShowcaseKit } from "../instagram/showcase-kit"
import { KITS, SHOWCASE_TYPE, SHOWCASE_TYPE_DEF } from "../instagram/showcase-kits"
import { FORMAT_BRIEF_LIMITS, type ClientConfig } from "../instagram/configs/types"
import { PORTFOLIO_BRANDS } from "../lib/portfolio-data"

let passed = 0
let failed = 0
function check(name: string, cond: boolean, detail?: string) {
    if (cond) { passed++; console.log(`  ✅ ${name}`) }
    else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`) }
}

// ─── 1. Neměnnost vstupu ──────────────────────────────────────────────

console.log("\nNemutuje vstupní config:")

const HOME: ClientConfig = {
    id: "chrlit",
    name: "Chrlit",
    logoFile: "logo-chrlit.png",
    feedAesthetic: {
        colorPalette: "Temně černá (#050505), sytě červená (#c0392b)",
        overlayOpacity: "55-65%",
        textPosition: "BOTTOM",
        font: "Inter",
        feel: "Temný technologický minimalismus",
        phoneModel: "iPhone 17 Pro Max",
        typographyStyle: "bold condensed grotesque, uppercase",
        accentColor: "#ffffff",
    },
    overlayGradient: { topColor: "#0d0202", midColor: "#1c0706", bottomColor: "#42100d" },
    brandVoice: { persona: "drzý parťák", values: [], voiceTraits: [], antiPatterns: [], hookTemplates: [], ctaVariations: [], toneByPostType: {} },
} as unknown as ClientConfig

const KIT: ShowcaseKit = {
    key: "test", sourceSlug: "agro-invest", industryLabel: "Investice do zemědělské půdy",
    brandName: "ORNICE", dominantColor: "#1e3f20", visualMode: "photo",
    feedAesthetic: { colorPalette: "#1e3f20, #d4af37", typographyStyle: "serif", feel: "půda" },
    overlayGradient: { topColor: "#0f2010", midColor: "#152a16", bottomColor: "#2e1e0f" },
    voiceBrief: "věcný", guardrails: "žádná čísla",
    persona: "Hospodář, co půdu obchází.", voiceTraits: ["věcný", "konzervativní"], benefit: "cas",
}

const before = JSON.stringify(HOME)
const out = applyShowcaseKit(HOME, KIT)

check("vstupní config zůstal bit po bitu stejný", JSON.stringify(HOME) === before)
check("vrací NOVÝ objekt", out !== HOME)
check("nesdílí objekt feedAesthetic se vstupem", out.feedAesthetic !== HOME.feedAesthetic)
check("paleta se přepsala", out.feedAesthetic.colorPalette === "#1e3f20, #d4af37",
    out.feedAesthetic.colorPalette)
check("typografie se přepsala", out.feedAesthetic.typographyStyle === "serif")
check("gradient se přepsal", out.overlayGradient?.topColor === "#0f2010")
check("nepřepsané pole zůstává z domácího configu", out.feedAesthetic.textPosition === "BOTTOM")

// Hlas i logo zůstávají značce: popisek pod postem píše Chrlit a obálka
// nese chrlití logo (loadLogo odvozuje cestu z názvu souboru, ne z klienta).
// Hlas se PŘEPISUJE. Napřed byl jen v zadání a copywriter ho přebil vlastními
// pilíři: nadpis poslechl, ale podtitulek se vrátil k „Chrlit maká".
check("persona se přepsala na ukázkovou značku", out.brandVoice.persona === KIT.persona)
check("naše hookTemplates zmizely", out.brandVoice.hookTemplates.length === 0)
check("naše ctaVariations zmizely", out.brandVoice.ctaVariations.length === 0)
// caption-generator.ts označuje few-shot vzory za „nejsilnější jednotlivou páku
// na konzistenci hlasu" — ty naše jsou sarkastické prodejní posty.
check("hlasové vzory se vyprázdnily", out.brandVoiceExamples?.length === 0)
check("naše brandFacts zmizely — vymyšlená značka je nemá odkud mít",
    out.brandFacts?.length === 0)

// `gatherContext()` čte config.industry a nastuduje z něj sezónu a dění v oboru.
// Bez tohohle přepisu by si engine nastudoval marketing na sítích a hook by
// zůstal básnička — přesně to, co uživatel vytkl.
check("obor se přepsal — context agent nastuduje TEN obor", out.industry === KIT.industryLabel)

// Dvě třetiny feedu jsou naše běžné formáty mířené na segment. Tam se hlas
// NEPŘEPISUJE: mýtus o AI v kadeřnických barvách je pořád náš mýtus.
console.log("\nRežim tema — mluvíme my, jen mířeně:")
const tema = applyShowcaseKit(HOME, KIT, "tema")
check("barevnost se přepsala i v režimu tema", tema.feedAesthetic.colorPalette === KIT.feedAesthetic.colorPalette)
check("obor se přepsal i v režimu tema", tema.industry === KIT.industryLabel)
check("hlas ZŮSTAL náš — prodáváme sebe", tema.brandVoice.persona === HOME.brandVoice.persona)
check("hookTemplates zůstaly naše", tema.brandVoice.hookTemplates === HOME.brandVoice.hookTemplates)
// První běh vysázel „STUDIO VLNA" na post, kde mluvíme my — vymyšlená značka
// na naší vlastní reklamě je matoucí a tvrdí vztah, který neexistuje.
const temaCi = tema.feedAesthetic.customInstructions ?? ""
check("v režimu tema se nesmí objevit vymyšlená značka",
    /Do NOT invent or render any company name/.test(temaCi) && !temaCi.includes(KIT.brandName))
check("v režimu tema se podepisujeme my", /attached Chrlit logo/.test(temaCi))
check("i téma drží světlo a barvu z fotky",
    /bright, high-key daylight/.test(temaCi) && /OUT OF THE PHOTOGRAPH/.test(temaCi))
check("vstup ani v režimu tema nemutoval", JSON.stringify(HOME) === before)
check("logoFile se NEpřepisuje — obálka musí nést logo Chrlitu",
    out.logoFile === "logo-chrlit.png")

// Pravidlo obálkového pruhu je jediné místo v BRAND KIT bez limitu délky.
const ci = out.feedAesthetic.customInstructions ?? ""
check("podpis říká, že jde o hotový post pro tu značku", /FINISHED POST FOR THE BRAND/.test(ci))

// Tohle je ta konkrétní chyba, kvůli které první série vypadala lacině:
// tvrdý mustr (plochá výplň + vsazená fotka + pruh) udělal z devíti značek
// jednu šablonu. Podpis smí předepisovat identitu, nikdy kompozici.
check("kompozice se NEpředepisuje — žádný pruh", !/COVER LOCKUP/.test(ci) && ci.includes("do NOT add a footer bar") && ci.includes("No band, no bar"))
check("plochá barva se vsazenou fotkou je výslovně zakázaná", /Do NOT build a flat/.test(ci))
check("kompozice je výslovně svobodná", /the layout is free/.test(ci))
// Model vysázel naše logo velké a značku pod něj jako podtitulek — obráceně.
check("značka má přednost před naším podpisem", /BRANDING ORDER/.test(ci) && /outranks us/.test(ci))
check("podpis má strop velikosti", /12% of the frame/.test(ci))
check("logo a značka se nesmí spojit do jednoho odznaku", /Never lock the two together/.test(ci))
check("vládnoucí barva je předepsaná", ci.includes("#1e3f20"))
// Obrazový model umí instrukci o řezu přebít svým výchozím tučným groteskem —
// a ten je náhodou domácí styl účtu, takže dlaždice pak dokazuje opak.
check("řez písma je nesmlouvavý", /TYPEFACE — NON-NEGOTIABLE/.test(ci))
check("výchozí grotesk je pojmenovaný jako zakázaný", /grotesque/.test(ci) && /Do NOT fall back/.test(ci))
// Model umí logo místo zkopírování „vysázet" po svém — a špatné logo na vlastní
// značce je horší vada než špatný font.
check("logo se má kopírovat, ne kreslit", /do NOT redraw it/i.test(ci) && /attached logo/i.test(ci))

// Grandhotel Pupp má naučený accentColor #111111 — designér z něj udělal
// černou obálku a v mřížce vznikla další tmavá dlaždice. Tenhle predikát je
// ta konkrétní zkušenost zapsaná tak, aby se nemohla vrátit.
console.log("\nBarva obálky musí v mřížce udělat barvu:")
check("#111111 (accent Pupp) je mrtvá barva", isDeadShowcaseColor("#111111"))
check("#050505 (chrlití černá) je mrtvá barva", isDeadShowcaseColor("#050505"))
check("#1e3f20 (lesní zeleň) projde", !isDeadShowcaseColor("#1e3f20"))
check("#041e41 (noční modř) projde", !isDeadShowcaseColor("#041e41"))
check("nesmysl neprojde", isDeadShowcaseColor("tmavomodrá"))

// Generátor kitů navrhl pro vietnamskou restauraci „chilli červenou" #D82800.
// Pro ten obor je to správně, ale vedle naší #c0392b je to tatáž dlaždice.
console.log("\nBarva se musí odlepit od naší vlastní palety:")
check("#D82800 (chilli) je moc blízko naší červené", isTooCloseToOwnPalette("#D82800"))
check("#c0392b (naše červená) neprojde", isTooCloseToOwnPalette("#c0392b"))
check("#050505 (naše černá) neprojde", isTooCloseToOwnPalette("#050505"))
check("#c88c64 (terakota) projde", !isTooCloseToOwnPalette("#c88c64"))
check("#004B93 (závodní modř) projde", !isTooCloseToOwnPalette("#004B93"))

// ─── 2. Anonymita a zákazy ────────────────────────────────────────────

console.log("\nAnonymita série:")

const realCompanies = PORTFOLIO_BRANDS.map(b => b.company.toLowerCase())
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim()

for (const kit of KITS) {
    const brand = norm(kit.brandName)
    const collision = realCompanies.find(c => norm(c) === brand || norm(c).includes(brand) || brand.includes(norm(c)))
    check(`${kit.key}: „${kit.brandName}" není jméno skutečné portfoliové firmy`,
        !collision, collision)
    check(`${kit.key}: kit nepřepisuje logoFile`,
        !("logoFile" in (kit.feedAesthetic as Record<string, unknown>)))
    // Paleta a akcent se doplňují ŽIVĚ ze zdrojového klienta — kdyby byly
    // natvrdo v registru, série by tiše zamrzla na barvách z doby zápisu.
    // Kit s předlohou bere paletu ŽIVĚ (jinak by zamrzla na hodnotě z doby zápisu);
    // kit bez předlohy si ji nese sám, protože žádnou předlohu mít nemůže.
    check(`${kit.key}: paleta odpovídá tomu, jestli má předlohu`,
        kit.sourceSlug ? !kit.feedAesthetic.colorPalette : Boolean(kit.feedAesthetic.colorPalette))
    check(`${kit.key}: má autorskou typografii`, Boolean(kit.feedAesthetic.typographyStyle))
    check(`${kit.key}: má vlastní personu a rysy hlasu`,
        kit.persona.length > 20 && kit.voiceTraits.length >= 3)
    check(`${kit.key}: barva „${kit.dominantColor}" udělá v mřížce barvu`,
        !isDeadShowcaseColor(kit.dominantColor))
    check(`${kit.key}: barva se odlepila od naší palety`,
        !isTooCloseToOwnPalette(kit.dominantColor))
    // Popisek pod postem musí přiznat, že jde o koncept.
    const topic = buildShowcaseTopic(kit)
    check(`${kit.key}: topic žádá přiznání, že jde o ukázkový koncept`,
        /ukázkový koncept/.test(topic))
    check(`${kit.key}: topic říká, že značka je vymyšlená`, /VYMYŠLENÁ značka/.test(topic))
    // Původně tady stálo, že náš hlas se má z obrázku vyhnat úplně. To bylo
    // špatně pochopené zadání: Instagram Chrlitu je prodejní kanál na majitele
    // firem, takže hook dokazuje řemeslo a podtitulek prodává výhodu. Obojí
    // patří na snímek — jen každé na svůj řádek.
    check(`${kit.key}: topic drží dvě vrstvy, ne jeden hlas`,
        /1\) HOOK/.test(topic) && /2\) PODTITULEK/.test(topic))
    check(`${kit.key}: náš hlas na snímku má SVOU vrstvu, nezakázaný`,
        !/Žádná zmínka o AI/.test(topic))
}

const covers = KITS.map(k => k.dominantColor.toLowerCase())
check("žádné dvě ukázky nemají stejnou barvu", new Set(covers).size === covers.length, covers.join(" "))

// `visualMode` NENÍ kosmetika: `ARCHETYPE_GROUPS` z něj dělá tvrdý výběr
// archetypů, který engine vynucuje v kódu. Rodina „graphic" má jen
// `color-block-graphic` a `split-layout` — obojí je barevný panel. Srovnávací
// kolo proto vyrobilo třikrát panel, ačkoli zadání znělo „fotka vede":
// instrukce v promptu ten výběr přebít nemůže.
const modes = KITS.map(k => k.visualMode)
const count = (m: string) => modes.filter(x => x === m).length
check("fotografická rodina VEDE — to je zvolený směr série",
    count("photo") > modes.length / 2, `photo ${count("photo")}/${modes.length}`)
check("grafická rodina zůstává menšinou (jinak se vrátí panely)",
    count("graphic") <= Math.ceil(modes.length / 4), `graphic ${count("graphic")}`)
check("v sérii je i jiná rodina než photo — mřížka potřebuje rytmus",
    count("typography") + count("graphic") >= 2)

console.log("\nRegulované obory:")
// Precedens commitu 2ba162e6: portfolio AGRO INVEST záměrně NEŠLO na web,
// protože vygenerované příspěvky nesly „8% zhodnocení", „garanci odkupu"
// a „absolutní jistotu". Ukázka pro tentýž obor nesmí ten omyl zopakovat.
for (const kit of KITS.filter(isRegulatedShowcase)) {
    check(`${kit.key}: regulovaný obor má neprázdné guardrails`, Boolean(kit.guardrails?.trim()))
    check(`${kit.key}: guardrails jsou v topicu`, buildShowcaseTopic(kit).includes(kit.guardrails ?? "∅"))
}
// Instagram Chrlitu je prodejní kanál na majitele firem, ne portfolio. Ukázka
// proto nese dvě vrstvy: hook dokazuje řemeslo, podtitulek prodává výhodu.
console.log("\nDvě vrstvy ukázky:")
for (const kit of KITS.slice(0, 3)) {
    const t = buildShowcaseTopic(kit)
    check(`${kit.key}: hook je vrstva DŮKAZU`, /1\) HOOK/.test(t) && /DŮKAZ/.test(t))
    check(`${kit.key}: podtitulek je vrstva VÝHODY`, /2\) PODTITULEK/.test(t) && t.includes(SHOWCASE_BENEFITS[kit.benefit]))
    // „Hook od firmy musí dávat smysl" — proti básničce drží konkrétní protipříklad.
    check(`${kit.key}: hook je bráněný proti básničce`, /ŠPATNĚ \(básnička\)/.test(t))
    check(`${kit.key}: obor má být na snímku poznat`, /pro jaký obor to je/.test(t))
    const seg = buildSegmentTopic(kit)
    check(`${kit.key}: téma míří na jeden segment, ne na „podnikatele"`,
        seg.includes(kit.industryLabel) && /JEDEN segment/.test(seg))
}

// Kdyby se výhody nerotovaly, série by vyložila jednu a na zbytek nabídky
// by se nedostalo.
const benefits = KITS.map(k => k.benefit)
for (const b of Object.keys(SHOWCASE_BENEFITS)) {
    check(`výhoda „${b}" se v sérii vyskytuje`, benefits.includes(b as never))
}
check("žádná výhoda nesežere víc než třetinu série",
    Math.max(...Object.keys(SHOWCASE_BENEFITS).map(b => benefits.filter(x => x === b).length)) <= Math.ceil(KITS.length / 3))

check("agropuda je rozpoznaná jako regulovaný obor",
    KITS.some(k => k.key === "agropuda" && isRegulatedShowcase(k)))

// ─── 3. Formát ────────────────────────────────────────────────────────

console.log("\nFormát ukazka_oboru:")
// Samostatný post = samostatná dlaždice. U karuselu je v mřížce vidět jen
// obálka, takže rozmanitost se schová až za proklik — a právě to mě dotlačilo
// k jednotnému podpisu, který sérii shodil.
check("je samostatný obrázek 4:5", SHOWCASE_TYPE_DEF.medium === "image" && SHOWCASE_TYPE_DEF.aspectRatio === "4:5")
// Bez manualOnly by autopilot formát náhodně vybral BEZ kitu — vyrobil by
// „ukázku pro obor" v chrlití červené a s oborem, který si vymyslel.
check("je manualOnly — bez kitu nesmí vzniknout", SHOWCASE_TYPE_DEF.manualOnly === true)
// S vyplněným mechanismem by se brief četl ze sdílené tabulky mechanismů
// a structure/visualStyle níž by se zahodily.
check("nemá mechanism — jinak by se structure/visualStyle ignorovaly",
    !SHOWCASE_TYPE_DEF.mechanism)
check("name sedí na exportovanou konstantu", SHOWCASE_TYPE_DEF.name === SHOWCASE_TYPE)
for (const [field, limit] of Object.entries(FORMAT_BRIEF_LIMITS)) {
    const v = (SHOWCASE_TYPE_DEF as unknown as Record<string, string>)[field] ?? ""
    check(`${field} se vejde do ${limit} znaků (${v.length})`, v.length <= limit)
}

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
