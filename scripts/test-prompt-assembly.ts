/**
 * Prompt assembly tests — čisté funkce, ŽÁDNÉ volání modelu.
 *
 * Vzor převzatý z scripts/test-post-edit-prompt.ts: mega prompt je čistá funkce,
 * takže se dá postavit nad fixture configem a tvrdit o něm fakta. Tohle je jediný
 * způsob, jak hlídat promptové regrese bez placení za generování.
 *
 * Spuštění: npx tsx scripts/test-prompt-assembly.ts
 */

import { buildMegaPrompt, buildVideoSchema, buildCaptionSchema, buildCarouselSchema, buildStorySchema, PROMPT_LIMITS, CAROUSEL_MAX_TOTAL_SLIDES } from "../instagram/caption-generator"
import { readFileSync } from "fs"
import { resolve } from "path"
import { formatContextForPrompt, type ContextSignals } from "../instagram/context-agent"
import type { ClientConfig } from "../instagram/configs/types"
import { FORMAT_BRIEF_LIMITS } from "../instagram/configs/types"
import { findFinishedCopy, stripFinishedCopy } from "../instagram/configs/format-brief"
import type { PostType } from "../instagram/types"
import type { PerformanceInsight } from "../instagram/performance"

let passed = 0
let failed = 0
const failures: string[] = []

function test(name: string, fn: () => void) {
    try {
        fn()
        passed++
        console.log(`  ✅ ${name}`)
    } catch (err: any) {
        failed++
        failures.push(`${name}: ${err.message}`)
        console.log(`  ❌ ${name}\n     └─ ${err.message}`)
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg)
}

// ─── Fixtures ───────────────────────────────────────────────

const config = {
    id: "test-brand",
    name: "Test Brand",
    website: "https://test.cz",
    instagram: "@test",
    industry: "test",
    contentFocus: "testovací obsah",
    brandVoice: {
        persona: "Jsi hlas značky Test Brand.",
        voiceTraits: ["přímý", "věcný"],
        antiPatterns: ["korporátní bláboly"],
        values: ["poctivost"],
        toneByPostType: {},
        hookTemplates: [],
        ctaVariations: ["Napiš nám"],
    },
    contentPillars: {
        dosah: { emoji: "🔥", label: "Dosah", ratio: 1, postTypes: ["meme"], ctaStrategy: "soft", description: "dosah" },
    },
    ctaStrategies: { soft: ["Ulož si to"], hard: [], medium: [], none: [] },
    feedAesthetic: {
        colorPalette: "modrá",
        overlayOpacity: "30%",
        textPosition: "BOTTOM",
        font: "Inter",
        feel: "čisté a moderní",
        phoneModel: "none",
    },
    postTypes: ["meme"],
    postTypeDefs: [{ name: "meme", displayName: "Meme", pillar: "dosah" }],
    weekPlan: ["meme"],
} as unknown as ClientConfig

const postType = { id: "1", name: "meme", display_name: "Meme", emoji: "😂", description: "vtipný post", frequency: "weekly" } as unknown as PostType

const noPerf: PerformanceInsight = {
    bestPostTypes: [], bestHooks: [], bestTimeSlots: [], avgEngagement: 0,
    topPatterns: [], conversionRate: 0, bestConvertingTypes: [],
}

/** Klient, který metriky nezadává: engagement je 0, ale hooky/patterns se stejně naplní. */
const fakePerf: PerformanceInsight = {
    ...noPerf,
    bestHooks: ["Tohle je jen poslední post, ne vítěz"],
    topPatterns: ["Questions in hook"],
}

const realPerf: PerformanceInsight = {
    ...noPerf,
    avgEngagement: 420,
    bestHooks: ["Skutečně nejlepší hook"],
    topPatterns: ["POV format"],
}

const build = (perf: PerformanceInsight) =>
    buildMegaPrompt(config, postType, null, null, ["Nějaký starý hook"], perf)

// ─── K4: nefabrikovat výkonnostní data ──────────────────────

console.log("\n📊 K4 — learning sekce jen se skutečnými metrikami")

test("bez metrik prompt NEobsahuje 'Zlaté Hooky'", () => {
    const p = build(fakePerf)
    assert(!p.includes("Zlaté Hooky"), "sekce se objevila i při avgEngagement = 0")
    assert(!p.includes("DATA Z REÁLNÉHO VÝKONU"), "learning sekce se objevila bez dat")
})

test("se skutečnými metrikami prompt hooky obsahuje", () => {
    const p = build(realPerf)
    assert(p.includes("DATA Z REÁLNÉHO VÝKONU"), "learning sekce chybí i s naměřenými daty")
    assert(p.includes("Skutečně nejlepší hook"), "hook z reálných dat chybí")
})

// ─── V1: žádné zbytky Satori overlay enginu ─────────────────

console.log("\n🎨 V1 — mega prompt neslibuje zrušený overlay engine")

test("prompt nemluví o overlay gradientu, 1:1 ani pozici textu", () => {
    const p = build(noPerf)
    assert(!p.includes("OVERLAY:"), "zůstal popis overlay gradientu")
    assert(!p.includes("1:1 square"), "zůstal natvrdo poměr 1:1 (default je 4:5)")
    assert(!p.includes("TEXT DOLE"), "zůstalo předepsané umístění textu — o to se stará AI Designer")
})

test("prompt říká, že layout řeší AI Designer", () => {
    const p = build(noPerf)
    assert(p.includes("AI Designer"), "copywriter se nedozví, kdo rozhoduje o layoutu")
})

// ─── CTA politika: soft pilíř nikde nesmí zmínit web ────────

console.log("\n🎯 CTA politika")

test("soft pilíř nikde nenabízí web", () => {
    const p = build(noPerf)
    assert(p.includes("CTA POLITIKA"), "CTA politika v promptu chybí")
    assert(p.includes("NIKDE v postu"), "chybí explicitní zákaz webu u soft pilíře")
})

// ─── K1/K2: schéma musí unést všechna pole, o která si prompt řekne ──

console.log("\n🔑 K1 — schéma vs. JSON ukázka v promptu")

/**
 * Tahle asserce je celý smysl souboru. responseSchema je whitelist: pole, které prompt
 * vyžaduje a schéma nedeklaruje, model prostě nevrátí (ověřeno proti gemini-pro-latest).
 * Přesně takhle zmizel `narration` z každé scény reelu — voiceover i titulky byly roky
 * mrtvé a nic to nehlásilo.
 */
function schemaKeys(schema: any, path: string[] = []): Set<string> {
    const keys = new Set<string>()
    const walk = (node: any) => {
        if (!node || typeof node !== "object") return
        if (node.properties) {
            for (const [k, v] of Object.entries<any>(node.properties)) {
                keys.add(k)
                walk(v)
            }
        }
        if (node.items) walk(node.items)
    }
    walk(schema)
    return keys
}

/** Klíče z JSON ukázky v promptu — "klíč": kdekoli v bloku VÝSTUP. */
function promptJsonKeys(prompt: string): Set<string> {
    const start = prompt.indexOf("## VÝSTUP")
    const block = start >= 0 ? prompt.slice(start) : prompt
    const keys = new Set<string>()
    for (const m of block.matchAll(/"([a-zA-Z][a-zA-Z0-9_]*)"\s*:/g)) keys.add(m[1])
    return keys
}

const mediumCases: { label: string; schema: any; medium: string }[] = [
    { label: "reel", schema: buildVideoSchema(config), medium: "reel" },
    { label: "carousel", schema: buildCarouselSchema(config), medium: "carousel" },
    { label: "story", schema: buildStorySchema(config), medium: "story" },
    { label: "image", schema: buildCaptionSchema(config), medium: "image" },
]

for (const c of mediumCases) {
    test(`${c.label}: každý klíč z JSON ukázky je i ve schématu`, () => {
        const prompt = buildMegaPrompt(
            config, postType, null, null, [], noPerf, undefined, undefined,
            { aspectRatio: c.medium === "reel" || c.medium === "story" ? "9:16" : "4:5", medium: c.medium as any, overlayStyle: "default" },
        )
        const inSchema = schemaKeys(c.schema)
        const inPrompt = promptJsonKeys(prompt)
        const missing = [...inPrompt].filter(k => !inSchema.has(k))
        assert(
            missing.length === 0,
            `prompt si říká o pole, která schéma nedeklaruje (model je NEVRÁTÍ): ${missing.join(", ")}`,
        )
    })
}

test("reelové schéma explicitně obsahuje narration i soundEffect", () => {
    const keys = schemaKeys(buildVideoSchema(config))
    assert(keys.has("narration"), "narration chybí → generateVoiceover se nikdy nezavolá")
    assert(keys.has("soundEffect"), "soundEffect chybí → Veo nedostane zvukovou stopu")
})

// ─── V4: rotace kontextu napříč kampaní ─────────────────────

console.log("\n🌍 V4 — kontext se v kampani nesmí opakovat")

const ctx: ContextSignals = {
    season: "léto", holidays: [], nameday: "", isWeekend: false, monthPhase: "střed měsíce",
    pulse: ["bod A", "bod B", "bod C", "bod D"], date: "2026-08-05", mode: "single",
}

test("dva po sobě jdoucí posty dostanou jiné body kontextu", () => {
    const a = formatContextForPrompt(ctx, 0)
    const b = formatContextForPrompt(ctx, 2)
    assert(a !== b, "post 1 a post 3 dostaly identický kontext")
    assert(a.includes("bod A") && !a.includes("bod C"), "offset 0 má vzít první dva body")
    assert(b.includes("bod C"), "offset 2 má posunout výběr")
})

test("rotace je bezpečná i pro krátký/prázdný pulse", () => {
    const short: ContextSignals = { ...ctx, pulse: ["jediný bod"] }
    assert(formatContextForPrompt(short, 7).includes("jediný bod"), "jednoprvkový pulse se ztratil")
    const empty: ContextSignals = { ...ctx, pulse: [] }
    assert(typeof formatContextForPrompt(empty, 3) === "string", "prázdný pulse spadl")
})

// ─── Limity: prompt a schéma musí říkat TOTÉŽ číslo ─────────
// Tohle je ta pojistka, která dosud chyběla. Limity se psaly ručně dvakrát —
// jednou do textu promptu, jednou do `description` ve schématu — a rozešly se
// tiše: u `subtext` slidu říkal prompt „max 12 slov" a schéma „max 20 words"
// o tomtéž poli. Model dostal dvě čísla a musel si vybrat.

console.log("\n📐 Limity mají jediný zdroj pravdy")

const carouselSchema: any = buildCarouselSchema(config)
const carouselPrompt = buildMegaPrompt(
    { ...config, postFormats: { meme: { medium: "carousel", aspectRatio: "4:5" } } } as any,
    postType, null, null, [], noPerf,
)

test("žádný limit se nepíše natvrdo — všechny jdou z PROMPT_LIMITS", () => {
    // Komentáře pryč: vysvětlení, PROČ se 12 rozešlo s 20, by jinak spustilo přesně
    // tu asserci, kterou popisuje. Stejný důvod má `codeOnly` v test-beta-e2e.ts.
    const src = readFileSync(resolve(__dirname, "../instagram/caption-generator.ts"), "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1")
    // Literál „max <číslo> slov/words" smí zůstat jen tam, kde ho PROMPT_LIMITS
    // nepokrývá; nová čísla patří do konstanty, ne do řetězce.
    const covered = new Set(Object.values(PROMPT_LIMITS).map(String))
    const hardcoded = [...src.matchAll(/max (\d+) (?:slov|words)/g)]
        .map(m => m[1])
        .filter(n => covered.has(n))
    assert(hardcoded.length === 0,
        `limit(y) ${[...new Set(hardcoded)].join(", ")} se píšou natvrdo, přestože je PROMPT_LIMITS pokrývá`)
})

test("cover headline: prompt i schéma říkají totéž", () => {
    const n = PROMPT_LIMITS.coverHeadlineWords
    assert(carouselPrompt.includes(`Cover headline (max ${n} slov`), `prompt neříká max ${n}`)
    assert(carouselSchema.properties.hook.description.includes(`max ${n} words`), `schéma neříká max ${n}`)
})

test("subtext slidu: prompt i schéma říkají totéž", () => {
    const n = PROMPT_LIMITS.slideSubtextWords
    assert(carouselPrompt.includes(`subtext max ${n} slov`), `prompt neříká max ${n}`)
    assert(carouselSchema.properties.slides.items.properties.subtext.description.includes(`max ${n} words`),
        `schéma neříká max ${n} — přesně tady se dřív 12 rozešlo s 20`)
})

test("headline slidu: prompt i schéma říkají totéž", () => {
    const n = PROMPT_LIMITS.slideHeadlineWords
    assert(carouselPrompt.includes(`headline max ${n} slov`), `prompt neříká max ${n}`)
    assert(carouselSchema.properties.slides.items.properties.headline.description.includes(`max ${n} words`),
        `schéma neříká max ${n}`)
})

test("počet slidů je ve schématu STRUKTURÁLNÍ, ne jen popis", () => {
    const s = carouselSchema.properties.slides
    assert(s.minItems === String(PROMPT_LIMITS.carouselInnerMin), "chybí minItems")
    assert(s.maxItems === String(PROMPT_LIMITS.carouselInnerMax), "chybí maxItems")
    // Popis i text promptu musí sedět na tytéž hranice.
    assert(s.description.includes(`${PROMPT_LIMITS.carouselInnerMin} to ${PROMPT_LIMITS.carouselInnerMax}`),
        "popis schématu neodpovídá hranicím")
    assert(carouselPrompt.includes(`${PROMPT_LIMITS.carouselInnerMin}-${PROMPT_LIMITS.carouselInnerMax} vnitřních slidů`),
        "prompt neodpovídá hranicím")
})

test("se závaznou strukturou se počet slidů neurčuje 'podle obsahu'", () => {
    // Nalezeno až za běhu reálné generace: structure vyjmenovala 6 slidů jako
    // „závaznou", ale o dva řádky níž stálo „počet slidů podle obsahu, nikdy
    // nenatahuj". Model vzal druhou instrukci a vyrobil 5. Dvě pravidla pro tutéž
    // věc — jen měkčí varianta rozporu, který §21 řeší pro nemožná čísla.
    const withStructure = buildMegaPrompt(
        { ...config,
          postFormats: { meme: { medium: "carousel", aspectRatio: "4:5" } },
          postTypeDefs: [{ name: "meme", displayName: "Meme", pillar: "dosah",
                           structure: "Slide 1 COVER: x. Slide 2: y. Slide 3 CTA: z." }],
        } as any, postType, null, null, [], noPerf,
    )
    assert(!withStructure.includes("Počet slidů podle obsahu"),
        "se závaznou strukturou nesmí prompt zároveň říkat 'počet podle obsahu'")
    assert(withStructure.includes("Počet slidů urči podle STRUKTURY"),
        "struktura musí počet slidů řídit")
    // Bez struktury (dramaturgická větev) volba podle obsahu naopak platí dál.
    assert(carouselPrompt.includes("Počet slidů podle obsahu"),
        "bez struktury má model volit počet podle obsahu")
})

test("nadpis karuselu počítá cover do celkového počtu", () => {
    assert(carouselPrompt.includes(`CAROUSEL POST (${PROMPT_LIMITS.carouselInnerMin + 1}-${CAROUSEL_MAX_TOTAL_SLIDES} slidů)`),
        "nadpis neodpovídá stropu — cover se musí počítat")
})

test("prompt nemá hluchá místa po vynechaných sekcích", () => {
    assert(!/\n{3,}/.test(carouselPrompt), "tři a víc prázdných řádků za sebou")
})

// ─── CTA politika si nesmí odporovat se seznamem PRIORIT ────

console.log("\n🎯 Jedno pravidlo pro řešení konfliktů")

test("CTA politika je zdroj pravdy pro SVOU doménu, ne globálně", () => {
    const p = build(noPerf)
    assert(!p.includes("při rozporu s čímkoli jiným"),
        "CTA sekce si nárokuje globální přednost — to si odporuje se seznamem PRIORIT, kde je až druhá")
    assert(p.includes("ZDROJ PRAVDY PRO CTA"), "nárok CTA politiky ve své doméně zmizel úplně")
})

// ─── Formát je INVARIANT, ne hotový příspěvek ───────────────

console.log("\n🧩 Formát je šablona, ne jeden post")

test("popis formátu je mechanismus, ne zadání tématu", () => {
    // Formát se použije na desítky témat. Když ho prompt uvede jako zadání toho, o čem
    // post JE, model z něj pokaždé vyrobí tentýž příspěvek — z 8 formátů u `chrlit`
    // vzniklo 170 postů, tedy ~21× každý. Proto musí prompt oddělit formu od námětu.
    const p = buildMegaPrompt(
        { ...config, postTypeDefs: [{ name: "meme", displayName: "Meme", pillar: "dosah",
                                      description: "Postaví dvě možnosti proti sobě." }] } as any,
        postType, null, null, [], noPerf,
    )
    assert(p.includes("MECHANISMUS formátu, ne téma postu"),
        "prompt neodlišuje formu od námětu — formát zase diktuje téma")
})

test("struktura formátu je rytmus, ne závazný obsah", () => {
    const withStructure = buildMegaPrompt(
        { ...config,
          postFormats: { meme: { medium: "carousel", aspectRatio: "4:5" } },
          postTypeDefs: [{ name: "meme", displayName: "Meme", pillar: "dosah",
                           structure: "Cover: protiklad. Beat 2-3: argumenty. Závěr: hlasování." }],
        } as any, postType, null, null, [], noPerf,
    )
    assert(!/STRUKTURA TOHOTO FORMÁTU \(závazná/.test(withStructure),
        "structure se pořád vkládá jako 'závazná' — pak přebije námět a post se opakuje")
    assert(withStructure.includes("NEZOPAKUJ ji, přenes na ni svůj námět"),
        "chybí instrukce, že konkrétní scéna v kostře je jen ukázka tempa")
})

test("contentFocus nesmí být v popisech výstupních polí", () => {
    // Byl doslova uvnitř definice pole `body` i `imagePrompt` (a v responseSchema),
    // takže ho model četl jako součást zadání, CO má napsat — u každého jednoho postu.
    // Jako kontext v hlavičce je v pořádku; jako popis výstupu je to opakovač.
    const src = readFileSync(resolve(__dirname, "../instagram/caption-generator.ts"), "utf-8")
    const occurrences = [...src.matchAll(/config\.contentFocus/g)].length
    assert(occurrences === 1,
        `config.contentFocus je v caption-generator.ts ${occurrences}× — smí být jen jednou, jako kontext v hlavičce promptu`)
})

test("brief formátu má stropy, které nepustí storyboard", () => {
    // 400/600/400 znaků si scénář vynutilo samo. Kategorie pilířů zůstávají zdravé
    // právě proto, že mají jednu větu — formát potřebuje stejnou disciplínu.
    assert(FORMAT_BRIEF_LIMITS.description <= 200 && FORMAT_BRIEF_LIMITS.visualStyle <= 200,
        "strop pro description/visualStyle je tak velký, že se do něj vejde scénář")
    assert(FORMAT_BRIEF_LIMITS.structure <= 260,
        "strop pro structure je tak velký, že se do něj vejde storyboard slide-po-slidu")
    // Sanitizace musí být na KAŽDÉ cestě, která brief zapisuje. Zákaz v promptu
    // nestačí — i s výslovným zákazem nechal model hotovou copy v 11 z 95 formátů.
    for (const [file, fn] of [
        ["../app/onboarding/core.ts", "generateCustomFormats"],
        ["../app/actions/config-actions.ts", "suggestPostFormat"],
        ["../scripts/degeneralize-formats.ts", "migrace formátů"],
    ] as const) {
        const src = readFileSync(resolve(__dirname, file), "utf-8")
        assert(src.includes("FORMAT_BRIEF_LIMITS"),
            `${fn} (${file}) neořezává brief přes FORMAT_BRIEF_LIMITS — stropy se rozejdou`)
        assert(src.includes("stripFinishedCopy"),
            `${fn} (${file}) nesanitizuje brief přes stripFinishedCopy — do formátu propadne hotová copy`)
    }
})

test("hotová copy se pozná a odstraní stejným predikátem", () => {
    // Detekce (warnOnScenicFormats) a odstranění (zápisové cesty) musí sdílet
    // jedno pravidlo, jinak validátor hlásí něco jiného, než sanitizace maže.
    const copy = "Slide 5: Vchod + CTA 'Dokonalá základna. Rezervujte'."
    assert(findFinishedCopy(copy).length === 1, "hotová replika v ASCII apostrofech se nepozná")
    assert(findFinishedCopy(stripFinishedCopy(copy)).length === 0,
        "po sanitizaci pořád zbývá hotová replika")
    assert(stripFinishedCopy(copy).includes("CTA"),
        "sanitizace ukrojila i ROLI beatu, nejen jeho znění")
    // Název estetiky není replika — do briefu patří a nesmí zmizet.
    const style = "Měkké světlo, 'romanticizing your life' estetika, plynulý pohyb."
    assert(findFinishedCopy(style).length === 0, "název stylu se hlásí jako hotová replika")
    assert(stripFinishedCopy(style) === style, "sanitizace smazala název stylu")
})

test("existuje detekce formátů psaných jako storyboard", () => {
    const src = readFileSync(resolve(__dirname, "../instagram/configs/index.ts"), "utf-8")
    assert(src.includes("function warnOnScenicFormats"),
        "chybí warnOnScenicFormats — storyboardy by se do configu dostávaly tiše")
    assert(/postTypeDefs:\s*warnOnScenicFormats\(/.test(src),
        "warnOnScenicFormats existuje, ale validateConfig ho nevolá")
})

// ─── Report ─────────────────────────────────────────────────

console.log("\n" + "─".repeat(60))
console.log(`  Total: ${passed + failed} | ✅ ${passed} | ❌ ${failed}`)
console.log("─".repeat(60))
if (failed > 0) {
    console.log("\n⚠️  FAILURES:")
    failures.forEach(f => console.log(`  - ${f}`))
    process.exit(1)
}
console.log("\n🎉 Prompt assembly OK\n")
process.exit(0)
