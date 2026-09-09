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

import { applyShowcaseKit, buildShowcaseTopic, isRegulatedShowcase, type ShowcaseKit } from "../instagram/showcase-kit"
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
    brandName: "ORNICE",
    feedAesthetic: { colorPalette: "#1e3f20, #d4af37", typographyStyle: "serif", feel: "půda" },
    overlayGradient: { topColor: "#0f2010", midColor: "#152a16", bottomColor: "#2e1e0f" },
    voiceBrief: "věcný", guardrails: "žádná čísla",
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
check("brandVoice se NEpřepisuje — popisek pod postem je Chrlitův",
    out.brandVoice.persona === HOME.brandVoice.persona)
check("logoFile se NEpřepisuje — obálka musí nést logo Chrlitu",
    out.logoFile === "logo-chrlit.png")

// Pravidlo obálkového pruhu je jediné místo v BRAND KIT bez limitu délky.
const ci = out.feedAesthetic.customInstructions ?? ""
check("customInstructions nesou pravidlo obálkového pruhu", /COVER LOCKUP/.test(ci))
check("pruh je zakázaný na vnitřních slidech", /INNER SLIDES/.test(ci) && /NO Chrlit logo/.test(ci))
check("do pruhu se propsal obor", ci.includes("INVESTICE DO ZEMĚDĚLSKÉ PŮDY"))

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
    check(`${kit.key}: paleta není natvrdo v registru (doplňuje ji hydrate)`,
        !kit.feedAesthetic.colorPalette)
    check(`${kit.key}: má autorskou typografii`, Boolean(kit.feedAesthetic.typographyStyle))
    // Popisek pod postem musí přiznat, že jde o koncept.
    const topic = buildShowcaseTopic(kit)
    check(`${kit.key}: topic žádá přiznání, že jde o ukázkový koncept`,
        /ukázkový koncept/.test(topic))
    check(`${kit.key}: topic říká, že značka je vymyšlená`, /VYMYŠLENÁ značka/.test(topic))
}

console.log("\nRegulované obory:")
// Precedens commitu 2ba162e6: portfolio AGRO INVEST záměrně NEŠLO na web,
// protože vygenerované příspěvky nesly „8% zhodnocení", „garanci odkupu"
// a „absolutní jistotu". Ukázka pro tentýž obor nesmí ten omyl zopakovat.
for (const kit of KITS.filter(isRegulatedShowcase)) {
    check(`${kit.key}: regulovaný obor má neprázdné guardrails`, Boolean(kit.guardrails?.trim()))
    check(`${kit.key}: guardrails jsou v topicu`, buildShowcaseTopic(kit).includes(kit.guardrails ?? "∅"))
}
check("agropuda je rozpoznaná jako regulovaný obor",
    KITS.some(k => k.key === "agropuda" && isRegulatedShowcase(k)))

// ─── 3. Formát ────────────────────────────────────────────────────────

console.log("\nFormát ukazka_oboru:")
check("je karusel 4:5", SHOWCASE_TYPE_DEF.medium === "carousel" && SHOWCASE_TYPE_DEF.aspectRatio === "4:5")
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
