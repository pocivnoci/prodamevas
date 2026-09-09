/**
 * Nové odvětví do ukázkové série — jeden příkaz, jeden kit.
 * ========================================================
 * Registr `instagram/showcase-kits.ts` má devět kitů psaných ručně, každý
 * o devíti polích. Oborů ale chceme desítky (vietnamská restaurace, tvorba
 * bazénů, investice do zlata, zahradník, cestovní kancelář, účetní, čištění
 * dlažeb…), a ruční psaní by dřív nebo později sklouzlo k šabloně — což je
 * přesně ta chyba, kterou série jednou udělala.
 *
 *   npx tsx scripts/add-showcase-kit.ts --obor="Vietnamská restaurace"
 *   npx tsx scripts/add-showcase-kit.ts --obor="Čištění dlažeb" --znacka="KÁMEN & VODA"
 *   npx tsx scripts/add-showcase-kit.ts --obor="Investice do zlata" --dry-run
 *
 * Co dělá: nechá model navrhnout vizuální a hlasovou DNA oboru, ověří ji proti
 * týmž pravidlům, jaká hlídá `npm run guard`, a připíše kit do registru.
 * Nikdy nepřepíše existující kit — když klíč sedí, skončí.
 *
 * ⚠️ Značka je VYMYŠLENÁ a skript to hlídá proti seznamu skutečných
 * portfoliových firem. Doporučení: nový návrh si přesto přečti — model může
 * náhodou trefit jméno skutečné malé firmy, kterou v seznamu nemáme.
 */

import { readFileSync, writeFileSync } from "fs"
import { generateTextQuality } from "../instagram/gemini-client"
import { getModel } from "../instagram/models"
import { isDeadShowcaseColor, isRegulatedShowcase, isTooCloseToOwnPalette, SHOWCASE_BENEFITS, type ShowcaseBenefit, type ShowcaseKit } from "../instagram/showcase-kit"
import { KITS } from "../instagram/showcase-kits"
import { PORTFOLIO_BRANDS } from "../lib/portfolio-data"
import type { VisualMode } from "../lib/feed-pattern"

const REGISTRY = "instagram/showcase-kits.ts"

/** Bezdiakritický snake_case klíč pro `--only=`. */
function keyFrom(industry: string): string {
    return industry.normalize("NFD").replace(/[̀-ͯ]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24)
}

/**
 * Rodina layoutů, které je v sérii nejmíň.
 *
 * Ručně by se to po dvacátém oboru rozjelo do jedné rodiny a mřížka by zase
 * vypadala jako složka prezentací — proto to nepatří modelu ani člověku.
 */
function leastUsedMode(): VisualMode {
    const modes: VisualMode[] = ["photo", "typography", "graphic"]
    const count = (m: VisualMode) => KITS.filter(k => k.visualMode === m).length
    return modes.sort((a, b) => count(a) - count(b))[0]
}

const SCHEMA = {
    type: "object",
    properties: {
        brandName: { type: "string" },
        colorPalette: { type: "string" },
        dominantColor: { type: "string" },
        accentColor: { type: "string" },
        typographyStyle: { type: "string" },
        feel: { type: "string" },
        persona: { type: "string" },
        voiceTraits: { type: "array", items: { type: "string" } },
        voiceBrief: { type: "string" },
        guardrails: { type: "string" },
    },
    required: ["brandName", "colorPalette", "dominantColor", "accentColor",
        "typographyStyle", "feel", "persona", "voiceTraits", "voiceBrief"],
}

function buildPrompt(industry: string, brandHint: string | undefined, mode: VisualMode, rejected: string[] = []): string {
    const taken = KITS.map(k => `${k.industryLabel}: ${k.dominantColor}, ${k.feedAesthetic.typographyStyle}`).join("\n")
    return `Navrhni vizuální a hlasovou DNA pro ČESKOU firmu z oboru „${industry}".

Vzniká z toho ukázkový instagramový příspěvek — důkaz, že umíme psát a navrhovat
pro jakýkoli obor, ne jen pro jeden. Vracíš JSON.

${brandHint ? `Značka se musí jmenovat „${brandHint}".` : `Vymysli VYMYŠLENÉ české jméno značky (1-3 slova, verzálky).
Nesmí to být jméno skutečné existující firmy — má znít věrohodně, ale být smyšlené.`}

## Co potřebuju

- colorPalette: 2-3 hex barvy s českým pojmenováním, jaké by taková firma reálně měla.
- dominantColor: JEDEN hex z té palety, který má snímku vládnout. MUSÍ mít barvu —
  ne černá, ne bílá, ne tmavá šeď. Tahle barva je dlaždice v mřížce profilu.
- accentColor: hex pro zvýrazněná slova v nadpisu.
- typographyStyle: česky, konkrétně (řez, velikost písmen, prostrk). NE „bold condensed
  grotesque, uppercase" ani nic jemu blízkého — to je náš vlastní styl a v ukázce pro
  cizí obor dokazuje pravý opak.
- feel: jedna věta, jak snímek působí — světlo, materiál, atmosféra.
- persona: jedna věta, KDO za značku mluví (řemeslník, hospodář, lékař…).
- voiceTraits: 3-5 českých přídavných jmen.
- voiceBrief: půl věty, jak ten člověk mluví ke svým zákazníkům.
- guardrails: vyplň JEN u regulovaných oborů (finance, investice, zdraví, léčba,
  úvěry, pojištění) — česky, co se v příspěvku NESMÍ tvrdit. Jinak vynech.

## Rodina layoutu

Tenhle obor dostane rodinu „${mode}" — ${mode === "photo" ? "fotka vede celé kompozici"
        : mode === "typography" ? "vede typografie, fotky málo" : "barevné bloky a split kompozice"}.
Vizuál i typografii navrhni tak, aby v téhle rodině fungovaly.

## Co už v sérii je — MUSÍŠ se od toho barevně i typograficky lišit

${taken}

${rejected.length ? `
## PŘEDCHOZÍ POKUS NEPROŠEL — oprav tohle a vrať nový návrh

${rejected.map(r => `• ${r}`).join("\n")}

Obor sám o sobě může mít barvu, která koliduje (vietnamská kuchyně je červená,
zlato je zlaté). Sáhni pak po DRUHÉ nebo TŘETÍ barvě té značky, ne po odstínu
té zakázané — posun o pár tónů problém neřeší.
` : ""}
Vracej jen JSON podle schématu.`
}

interface Draft {
    brandName: string; colorPalette: string; dominantColor: string; accentColor: string
    typographyStyle: string; feel: string; persona: string; voiceTraits: string[]
    voiceBrief: string; guardrails?: string
}

/** Táž pravidla, jaká nad registrem hlídá `npm run guard`. Sem patří proto, že
 *  vadný návrh se má zachytit PŘED zápisem, ne až v guardu po commitu. */
function validate(d: Draft, industry: string): string[] {
    const problems: string[] = []
    if (isDeadShowcaseColor(d.dominantColor)) problems.push(`dominantColor ${d.dominantColor} v mřížce neudělá barvu`)
    if (isTooCloseToOwnPalette(d.dominantColor)) {
        problems.push(`${d.dominantColor} je moc blízko naší vlastní paletě — dlaždice by splynula s domácím feedem`)
    }
    const taken = new Set(KITS.map(k => k.dominantColor.toLowerCase()))
    if (taken.has(d.dominantColor.toLowerCase())) problems.push(`barvu ${d.dominantColor} už v sérii má jiný obor`)
    const brand = d.brandName.toLowerCase().trim()
    const real = PORTFOLIO_BRANDS.map(b => b.company.toLowerCase())
        .find(c => c === brand || c.includes(brand) || brand.includes(c))
    if (real) problems.push(`„${d.brandName}" se kryje se skutečnou firmou „${real}"`)
    if (/grotesk|grotesque/i.test(d.typographyStyle) && /condensed|kondenzovan/i.test(d.typographyStyle)) {
        problems.push(`typografie „${d.typographyStyle}" je moc blízko našemu vlastnímu stylu`)
    }
    if (isRegulatedShowcase({ industryLabel: industry }) && !d.guardrails?.trim()) {
        problems.push("regulovaný obor musí mít guardrails (precedens commitu 2ba162e6)")
    }
    if (d.voiceTraits.length < 3) problems.push("voiceTraits musí mít aspoň tři rysy")
    return problems
}

function render(kit: ShowcaseKit): string {
    const q = (s: string) => JSON.stringify(s)
    return `    {
        key: ${q(kit.key)},
        visualMode: ${q(kit.visualMode)},
        dominantColor: ${q(kit.dominantColor)},
        persona: ${q(kit.persona)},
        voiceTraits: [${kit.voiceTraits.map(q).join(", ")}],
        industryLabel: ${q(kit.industryLabel)},
        brandName: ${q(kit.brandName)},
        feedAesthetic: {
            colorPalette: ${q(kit.feedAesthetic.colorPalette!)},
            accentColor: ${q(kit.feedAesthetic.accentColor!)},
            typographyStyle: ${q(kit.feedAesthetic.typographyStyle!)},
            feel: ${q(kit.feedAesthetic.feel!)},
        },
        benefit: ${q(kit.benefit)},
        voiceBrief: ${q(kit.voiceBrief)},${kit.guardrails ? `\n        guardrails: ${q(kit.guardrails)},` : ""}
    },
`
}

async function main() {
    const args = process.argv.slice(2)
    const arg = (n: string) => args.find(a => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=")
    const industry = arg("obor")
    const brandHint = arg("znacka")
    const dryRun = args.includes("--dry-run")
    if (!industry) throw new Error('Chybí --obor="Název odvětví"')

    const key = keyFrom(industry)
    if (KITS.some(k => k.key === key)) throw new Error(`Kit „${key}" už v registru je — nic nepřepisuju.`)

    const mode = leastUsedMode()
    console.log(`\n🎨 Nový obor: ${industry}`)
    console.log(`   klíč:   ${key}`)
    console.log(`   layout: ${mode}  (v sérii zatím nejmíň zastoupený)\n`)

    // Obor si svou barvu často nese s sebou — vietnamská kuchyně je červená,
    // zlato zlaté — a ta pak koliduje s naší paletou. Nemá smysl to posílat
    // zpátky člověku: dostane návrh nazpět s výčtem, co bylo špatně.
    const MAX_TRIES = 3
    let d: Draft | null = null
    let problems: string[] = []
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
        const raw = await generateTextQuality(buildPrompt(industry, brandHint, mode, problems), {
            models: [getModel("textPro"), getModel("textPro", "fallback")].filter(Boolean),
            responseSchema: SCHEMA,
            label: "showcase-kit",
            temperature: 1,
        })
        const draft = JSON.parse(raw.replace(/```(?:json)?/g, "").trim()) as Draft
        problems = validate(draft, industry)
        if (problems.length === 0) { d = draft; break }
        console.log(`   ↻ pokus ${attempt}/${MAX_TRIES} neprošel:`)
        for (const p of problems) console.log(`      • ${p}`)
    }
    if (!d) {
        console.error(`\n❌ Ani po ${MAX_TRIES} pokusech nevznikl použitelný kit.`)
        console.error("   Poslední výtky jsou výš — dolaď ručně přes --znacka= nebo zvol jiný obor.")
        process.exit(1)
    }

    // Výhoda se nevymýšlí, jen pokračuje v rotaci — jinak by se série sesypala
    // na tu, která zní modelu nejlíp, a nabídka by se nikdy nevyložila celá.
    const benefits = Object.keys(SHOWCASE_BENEFITS) as ShowcaseBenefit[]
    const benefit = benefits[KITS.length % benefits.length]

    const kit: ShowcaseKit = {
        key, visualMode: mode, dominantColor: d.dominantColor, benefit,
        persona: d.persona, voiceTraits: d.voiceTraits,
        industryLabel: industry, brandName: d.brandName,
        feedAesthetic: {
            colorPalette: d.colorPalette, accentColor: d.accentColor,
            typographyStyle: d.typographyStyle, feel: d.feel,
        },
        voiceBrief: d.voiceBrief,
        ...(d.guardrails?.trim() ? { guardrails: d.guardrails } : {}),
    }

    console.log(`   značka: „${kit.brandName}" (vymyšlená)`)
    console.log(`   vládne: ${kit.dominantColor}`)
    console.log(`   paleta: ${d.colorPalette}`)
    console.log(`   typo:   ${d.typographyStyle}`)
    console.log(`   hlas:   ${d.persona}`)
    console.log(`   výhoda: ${benefit} — ${SHOWCASE_BENEFITS[benefit]}`)
    if (kit.guardrails) console.log(`   ⚖️  zákazy: ${kit.guardrails}`)

    if (dryRun) { console.log("\n🔍 Dry-run — do registru se nic nezapsalo.\n"); return }

    const src = readFileSync(REGISTRY, "utf-8")
    const marker = "\n]\n"
    const at = src.lastIndexOf(marker)
    if (at < 0) throw new Error(`${REGISTRY}: nenašel jsem konec pole KITS`)
    writeFileSync(REGISTRY, src.slice(0, at) + "\n" + render(kit) + src.slice(at + 1))

    console.log(`\n✅ Zapsáno do ${REGISTRY}.`)
    console.log(`   Zkontroluj:  npm run guard`)
    console.log(`   Vygeneruj:   npx tsx scripts/seed-chrlit-showcase.ts --only=${key}\n`)
}

main().catch(err => { console.error("\n💥", err?.message ?? err); process.exit(1) })
