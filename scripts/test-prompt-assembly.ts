/**
 * Prompt assembly tests — čisté funkce, ŽÁDNÉ volání modelu.
 *
 * Vzor převzatý z scripts/test-post-edit-prompt.ts: mega prompt je čistá funkce,
 * takže se dá postavit nad fixture configem a tvrdit o něm fakta. Tohle je jediný
 * způsob, jak hlídat promptové regrese bez placení za generování.
 *
 * Spuštění: npx tsx scripts/test-prompt-assembly.ts
 */

import { buildMegaPrompt, buildVideoSchema, buildCaptionSchema, buildCarouselSchema, buildStorySchema, getPostTypeDef, buildSmartWeekPlan, PROMPT_LIMITS, CAROUSEL_MAX_TOTAL_SLIDES, sanitizeHashtags, assembleCaption, buildFactsSection } from "../instagram/caption-generator"
import { buildFactCheckPrompt, applyFactFixes } from "../instagram/fact-check"
import { readFileSync } from "fs"
import { resolve } from "path"
import { formatContextForPrompt, type ContextSignals } from "../instagram/context-agent"
import type { ClientConfig } from "../instagram/configs/types"
import { FORMAT_BRIEF_LIMITS } from "../instagram/configs/types"
import { findFinishedCopy, stripFinishedCopy } from "../instagram/configs/format-brief"
import { MECHANISMS, MECHANISM_IDS } from "../instagram/mechanisms"
import type { PostType } from "../instagram/types"
import type { PerformanceInsight } from "../instagram/performance"
import { resolveCtaPolicy, buildCtaPolicyJudgeBlock } from "../instagram/cta-policy"

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

test("prompt zakazuje vymyšlenou naléhavost", () => {
    const p = build(noPerf)
    assert(p.includes("Zákaz vymyšlené naléhavosti"),
        "pisatel nedostal zákaz vymyšlené urgence — audit ji našel v 8 z 16 slabých postů")
})

test("hard režim si neříká o vymyšlené omezení ani urgentní tón", () => {
    const policy = resolveCtaPolicy({
        pillarCtaStrategy: "hard",
        pillarKey: "sales",
        selectedProduct: { name: "Kurz", slug: "kurz" },
        personaCtaStyle: "hard",
        website: "https://example.cz",
    })
    // Dřív tu stálo „důvod jednat TEĎ — benefit, zvědavost nebo omezení" a tón
    // „přímý a urgentní". Pisatel to poslušně plnil a kritik ho za to srážel.
    assert(!/urgentní/i.test(policy.ctaInstruction),
        "tón CTA znovu žádá urgenci")
    assert(/NEVYMÝŠLEJ/.test(policy.ctaInstruction),
        "hard režim znovu zve k vymýšlení termínu nebo omezení")
})

test("soudce vymyšlenou naléhavost sráží", () => {
    const policy = resolveCtaPolicy({
        pillarCtaStrategy: "hard", pillarKey: "sales",
        selectedProduct: null, personaCtaStyle: "medium", website: "https://example.cz",
    })
    // Kdyby to hlídal jen soudce, prompt by dál vyráběl vady, které sám sráží —
    // a naopak. Obojí proto vzniká z jednoho modulu.
    assert(/naléhavost/i.test(buildCtaPolicyJudgeBlock(policy)),
        "soudce nedostal pravidlo o vymyšlené naléhavosti")
})

// ─── Délka hooku: strop se nesmí rozejít s plánovací vrstvou ──────────

console.log("\n✂️  Délka hooku")

test("plánovací vrstva slibuje tentýž strop hooku jako copywriter", () => {
    // Model čte „max N" jako zadání a vyplní si ho. Když plán slíbí 12 a
    // copywriter 8, hook z plánu projde plánem a spadne až u kritika.
    const files = ["instagram/plan-pipeline.ts", "app/actions/content-plan-actions.ts"]
    for (const f of files) {
        const src = readFileSync(resolve(process.cwd(), f), "utf-8")
        const promised = [...src.matchAll(/hook[^\n]{0,60}?max (\d+) slov/gi)].map(m => Number(m[1]))
        assert(promised.length > 0, `${f}: nenašel jsem žádný slib délky hooku`)
        for (const n of promised) {
            assert(n === PROMPT_LIMITS.hookWords,
                `${f} slibuje hook na ${n} slov, copywriter má strop ${PROMPT_LIMITS.hookWords}`)
        }
    }
})

test("strop hooku je blízko ideálu 3–7 slov", () => {
    // Strop daleko nad ideálem se chová jako cíl — to byla přesně vada s 12.
    assert(PROMPT_LIMITS.hookWords <= 8,
        `strop hooku ${PROMPT_LIMITS.hookWords} je zase daleko nad ideálem 3–7`)
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

test("mechanismus přebíjí per-klientský brief formátu", () => {
    // Invariant zaručený KONSTRUKCÍ, ne pravidlem v promptu. Dvakrát po sobě se
    // ukázalo, že model formátovací pravidlo nedodrží: do briefu propašoval téma
    // („Průvodce ideálním tarifem") i po přepsání promptu, stropech a sanitizaci.
    // Když má formát mechanismus, text pochází ze sdílené tabulky a model do něj
    // nemá jak sáhnout.
    const def = getPostTypeDef({
        ...config,
        postTypeDefs: [{
            name: "meme", display_name: "Meme", pillar: "dosah",
            description: "Průvodce ideálním tarifem pro fáze byznysu",
            structure: "Slide 1: náš tarif Start…",
            mechanism: "srovnani",
        }],
    } as any, "meme")
    assert(def?.description === MECHANISMS.srovnani.description,
        "description se nebere z mechanismu — per-klientské téma se propsalo do promptu")
    assert(def?.structure === MECHANISMS.srovnani.structure, "structure se nebere z mechanismu")
    assert(def?.visualStyle === MECHANISMS.srovnani.visualStyle, "visualStyle se nebere z mechanismu")
    // Vše ostatní MUSÍ zůstat per klient — na `name` visí ig_post_types,
    // weekPlan, členství v pilířích i post_type_id starých příspěvků.
    assert(def?.name === "meme" && def?.pillar === "dosah",
        "mechanismus přepsal i identitu formátu — to rozbije vazby v DB")
})

test("mechanismy samy projdou testem invariantu", () => {
    for (const id of MECHANISM_IDS) {
        const m = MECHANISMS[id]
        for (const [field, text] of [["description", m.description], ["structure", m.structure], ["visualStyle", m.visualStyle]] as const) {
            assert(findFinishedCopy(text).length === 0, `${id}.${field} obsahuje hotovou repliku`)
            assert(!/[A-ZÁ-Ž][a-zá-ž]+\s+(?:s\.r\.o|a\.s)/.test(text), `${id}.${field} vypadá jako konkrétní firma`)
        }
        assert(m.description.length <= FORMAT_BRIEF_LIMITS.description, `${id}.description překračuje strop`)
        assert(m.structure.length <= FORMAT_BRIEF_LIMITS.structure, `${id}.structure překračuje strop`)
        assert(m.visualStyle.length <= FORMAT_BRIEF_LIMITS.visualStyle, `${id}.visualStyle překračuje strop`)
    }
})

test("výběr formátu je deterministický, ne losovaný", () => {
    // Vážení podle paměti značky, naměřeného výkonu a svátků dřív jen naklánělo
    // kostku — rozhodoval `Math.random()`. Signály tak reálně nerozhodovaly a stejný
    // vstup dal pokaždé jiný výstup, takže výběr nešlo ani ladit, ani otestovat.
    // Pestrost nově zajišťuje odpor k nedávno použitému mechanismu, ne los.
    const a = buildSmartWeekPlan(config, noPerf, 10, 3)
    const b = buildSmartWeekPlan(config, noPerf, 10, 3)
    assert(JSON.stringify(a) === JSON.stringify(b),
        "stejný vstup dal jiný plán — ve výběru zůstala náhoda")
    // Posun se musí projevit, jinak by se plán otevíral pořád stejně.
    const wp = config.weekPlan || []
    if (wp.length > 1) {
        const shifted = buildSmartWeekPlan(config, noPerf, 10, 3 + 1)
        assert(JSON.stringify(shifted) !== JSON.stringify(a) || wp.length === 1,
            "posun podle počtu příspěvků se neprojevil — rotace je zamrzlá")
    }

    const src = readFileSync(resolve(__dirname, "../instagram/autopilot.ts"), "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1")
    const selection = src.slice(src.indexOf("const scoreOf"), src.indexOf("console.log(`   ✓"))
    assert(selection.length > 0, "blok výběru formátu se nenašel — asserce přestala hlídat, co má")
    assert(!selection.includes("Math.random"),
        "do výběru formátu se vrátila náhoda — signály pak zase jen naklánějí kostku")
})

test("existuje detekce formátů psaných jako storyboard", () => {
    const src = readFileSync(resolve(__dirname, "../instagram/configs/index.ts"), "utf-8")
    assert(src.includes("function warnOnScenicFormats"),
        "chybí warnOnScenicFormats — storyboardy by se do configu dostávaly tiše")
    assert(/postTypeDefs:\s*warnOnScenicFormats\(/.test(src),
        "warnOnScenicFormats existuje, ale validateConfig ho nevolá")
})

// ─── Skládání hotového popisku ──────────────────────────────
// Fixtures jsou doslova to, co vylezlo z ostrého běhu — ne vymyšlené případy.

test("hashtagy: osamocená mřížka a prázdný řetězec se zahodí", () => {
    // Přesně tenhle slepenec byl v ostrém reelu:
    // „#chrlitai # #bezagentury # #marketingprosalony #"
    const out = sanitizeHashtags(["#chrlitai", "", "#bezagentury", "#", "  ", "#marketingprosalony", "##"])
    assert(!out.includes("#"), "samotná mřížka není hashtag")
    assert(out.every(t => t.length > 1), `prázdný hashtag prošel: ${JSON.stringify(out)}`)
    assert(out.join(" ") === "#chrlitai #bezagentury #marketingprosalony", `nečekaný výstup: ${out.join(" ")}`)
})

test("hashtagy: sjednotí tvar, zachovají diakritiku, bez duplicit", () => {
    const out = sanitizeHashtags(["Kytky", "#kytky", "##KYTKY", "české kytky", "🌸"])
    assert(out.includes("#kytky"), "chybí základní tvar")
    assert(out.filter(t => t === "#kytky").length === 1, "duplicita prošla")
    assert(out.includes("#céskékytky") || out.includes("#českékytky"), `diakritika se ztratila: ${out.join(" ")}`)
    assert(!out.includes("#🌸"), "emoji není hashtag")
})

test("popisek: hook zopakovaný v těle se nevypíše dvakrát", () => {
    const caption = assembleCaption(
        "Zase bez agentury?",
        "Zase bez agentury? Máš výčitky, že neplatíš dvacet litrů měsíčně?",
        "Zkus to na https://chrlit.cz/",
        ["#chrlit"],
    )
    assert(caption.split("Zase bez agentury?").length - 1 === 1, `hook je v popisku dvakrát:\n${caption}`)
    assert(caption.startsWith("Zase bez agentury?"), "hook musí zůstat nahoře")
})

test("popisek: CTA na konci těla se nezopakuje", () => {
    const cta = "Chceš vidět, jak vypadá profi feed bez námahy? Zkus to na https://chrlit.cz/"
    const caption = assembleCaption("Hook", `Tělo postu.\n\n${cta}`, cta, ["#chrlit"])
    assert(caption.split(cta).length - 1 === 1, `CTA je v popisku dvakrát:\n${caption}`)
})

test("popisek: nic se neztratí, když se nic neopakuje", () => {
    const caption = assembleCaption("Hook", "Tělo.", "CTA.", ["#a", "#b"])
    assert(caption === "Hook\n\nTělo.\n\nCTA.\n\n#a #b", `nečekané složení:\n${caption}`)
})

test("popisek: prázdné tělo nevyrobí díru", () => {
    const caption = assembleCaption("Hook", "", "CTA.", ["#a"])
    assert(!caption.includes("\n\n\n"), "prázdné tělo nechalo v popisku díru")
    assert(caption === "Hook\n\nCTA.\n\n#a", `nečekané složení:\n${caption}`)
})

// ─── Hook šablony značky se MUSÍ dostat do promptu ──────────

console.log("\n🪝 Hook šablony a tón")

const tpl = (pattern: string, bestFor: string[]) =>
    ({ pattern, example: `Příklad: ${pattern}`, bestFor, trigger: "curiosity" })

/** Postaví prompt nad configem s upravenými hook šablonami / typy. */
const buildWith = (over: Record<string, any>) =>
    buildMegaPrompt({ ...config, ...over, brandVoice: { ...config.brandVoice, ...(over.brandVoice || {}) } } as any,
        postType, null, null, [], fakePerf)

test("mrtvé bestFor neznamená prázdnou sekci", () => {
    // Přesný stav produkce: šablony oklíčované zástupnými názvy, které
    // generateCustomFormats dávno přepsal. Dřív => 0 šablon a prázdný nadpis.
    const p = buildWith({
        postTypes: ["pribeh_jednoho_stonku", "sousedsky_pokec"],
        brandVoice: { hookTemplates: [tpl("Věděli jste, že {{t}}?", ["tip"]), tpl("Upřímně?", ["behind_scenes"])] },
    })
    assert(p.includes("INSPIRACE PRO HOOKY"), "sekce chybí, i když značka šablony má")
    assert(p.includes("Věděli jste"), "šablona se do promptu nedostala")
})

test("funkční bestFor neleaká do cizího formátu", () => {
    // Značka, která má cílení napsané správně (viz rebrand-hanzgarage), nesmí
    // dostat šablonu psanou pro jiný formát jen proto, že pro tenhle žádná není.
    const p = buildWith({
        postTypes: ["meme", "krok_za_krokem"],
        brandVoice: { hookTemplates: [tpl("Krok za krokem: {{t}}", ["krok_za_krokem"])] },
    })
    assert(!p.includes("Krok za krokem"), "šablona pro jiný formát prosákla do meme postu")
})

test("bez šablon se nadpis vůbec nevykreslí", () => {
    const p = buildWith({ brandVoice: { hookTemplates: [] } })
    assert(!p.includes("INSPIRACE PRO HOOKY"), "prázdný nadpis je pokyn, který si model musí vyložit")
})

test("prázdný tón se do promptu nedostane", () => {
    const p = buildWith({ brandVoice: { toneByPostType: {} } })
    assert(!/## TÓN:\s*\n/.test(p) && !p.includes("## TÓN: \n"), "vykreslil se holý nadpis TÓN bez hodnoty")
})

test("výběr šablon je deterministický, ne náhodný", () => {
    const code = readFileSync(resolve(__dirname, "../instagram/caption-generator.ts"), "utf-8")
    const from = code.indexOf("export function getHookTemplates")
    const body = code.slice(from, code.indexOf("\n}\n", from))
    assert(!/Math\.random/.test(body),
        "náhodný výběr střídá rytmus značky post od postu — stejný důvod, proč ho nemá ani výběr persony")
    assert(/pickStable\(/.test(body), "výběr musí jít přes deterministický pickStable")
})

// ─── Pravdivost: prompt nesmí dát modelu licenci vymýšlet ───

console.log("\n✅ Pravidlo pravdivosti a ověřená fakta")

test("pravidlo pravdivosti je v promptu i BEZ jediného zadaného faktu", () => {
    const p = buildWith({ brandFacts: [] })
    assert(p.includes("PRAVIDLO PRAVDIVOSTI"),
        "prázdný seznam faktů znamená „piš bez čísel“, ne „vymysli si je“ — pravidlo musí platit vždycky")
    assert(/PRIORITA 0/.test(p), "pravdivost musí přebíjet i hook a kreativitu, jinak prohraje s poutavostí")
    assert(/^0\. Pravdivost/m.test(p), "seznam PRIORIT musí pravdivost vypsat, jinak si model pořadí vyloží sám")
})

test("zadaná fakta se dostanou do promptu i se zdrojem", () => {
    const p = buildWith({ brandFacts: [{ text: "Pečeme od roku 1998", source: "test.cz/o-nas" }] })
    assert(p.includes("Pečeme od roku 1998"), "fakt se do promptu nedostal")
    assert(p.includes("test.cz/o-nas"), "zdroj faktu zmizel — pak se nedá dohledat, čím je tvrzení podložené")
})

test("buildFactsSection nevynechá výčet toho, co JE konkrétní tvrzení", () => {
    const section = buildFactsSection({ ...config, brandFacts: [] } as any)
    for (const kind of ["číslo", "rok", "cena", "superlativ", "záruky"]) {
        assert(section.includes(kind), `výčet konkrétních tvrzení neuvádí „${kind}“ — model si hranici vyloží sám`)
    }
})

test("faktická brána a copywriter čtou TENTÝŽ seznam faktů", () => {
    const facts = [{ text: "Dovážíme do 24 hodin" }]
    const p = buildWith({ brandFacts: facts })
    const gate = buildFactCheckPrompt({ ...config, brandFacts: facts } as any, [{ text: "Dovážíme do 24 hodin po Praze.", display: false }])
    assert(p.includes("Dovážíme do 24 hodin") && gate.includes("Dovážíme do 24 hodin"),
        "dva seznamy faktů by se rozešly a brána by trestala text za to, co si prompt sám dovolil")
})

test("brána bez faktů říká nahlas, že povolený zdroj neexistuje", () => {
    const gate = buildFactCheckPrompt({ ...config, brandFacts: [] } as any, [{ text: "Jsme jedničkou na trhu.", display: false }])
    assert(/žádn/i.test(gate) && gate.includes("nepodložené"),
        "prázdný seznam se musí přeložit na „všechno konkrétní je nepodložené“, ne na prázdný nadpis")
})

test("identita značky z configu platí jako ověřený zdroj", () => {
    // Naměřeno na produkčních postech: bez tohohle brána mazala z textu název města,
    // ve kterém klient sídlí („Naše apartmány v České Kamenici" → „Naše apartmány"),
    // a dělala obsah méně lokálním. Město si klient nastavil sám a engine z něj tahá
    // počasí i lokální kontext — je to fakt, ne tvrzení k prověření.
    const gate = buildFactCheckPrompt({ ...config, city: "Česká Kamenice", industry: "ubytování" } as any,
        [{ text: "Naše apartmány v České Kamenici jsou útočiště.", display: false }])
    assert(gate.includes("IDENTITA ZNAČKY"), "identita klienta musí být mezi povolenými zdroji")
    assert(gate.includes("Česká Kamenice"), "město z configu se do promptu nedostalo")
})

test("rétorika hooku a prožitek čtenáře nejsou tvrzení", () => {
    // Taky naměřeno: „3 věci, které děláte špatně" brána označovala jako nepodložené
    // tvrzení, protože „nesouvisí s žádným ověřeným faktem". To je slib obsahu, ne údaj.
    const gate = buildFactCheckPrompt(config as any, [{ text: "3 věci, které děláte špatně", display: true }])
    assert(/Rétorika hooku/.test(gate), "výčet ne-tvrzení musí rétoriku hooku výslovně vyjmout")
    assert(/o ČTENÁŘI, ne o značce/.test(gate), "věty o prožitku čtenáře nejsou tvrzení o značce")
    assert(/Jména a místa/.test(gate), "název místa ani produktu není tvrzení k ověření")
})

test("brána nesmí hodnotit styl — na to je kritik", () => {
    const gate = buildFactCheckPrompt(config as any, [{ text: "Nejlepší ráno začíná kávou.", display: false }])
    assert(gate.includes("Nehodnotíš styl"),
        "bez tohohle brána začne přepisovat hooky a pipeline dostane druhého kritika, ne korektora")
})

// ─── Oprava faktu je záměna podřetězce, ne prosba modelu ────

console.log("\n🔧 Deterministická oprava nepodložených tvrzení")

const draft = () => ({
    hook: "Pečeme už 25 let",
    body: "Pečeme už 25 let a chleba kynou přes noc.",
    cta: "Stavte se",
    imagePrompt: "bakery interior, 25 years old sign",
    slides: [{ headline: "Pečeme už 25 let", subtext: "Poctivě", imagePrompt: "EN" }],
    frames: [{ headline: "Pečeme už 25 let", subtext: "Poctivě" }],
    scenes: [{ narration: "Pečeme už 25 let.", visual: "EN" }],
})

test("oprava projde všechna čtená pole naráz", () => {
    const { data, applied, missed } = applyFactFixes(draft(), [{ find: "Pečeme už 25 let", replace: "Pečeme poctivě" }])
    assert(applied === 1 && missed.length === 0, "oprava se nezapočítala")
    assert(!JSON.stringify([data.hook, data.body, data.cta, data.slides, data.frames, data.scenes]).includes("25 let"),
        "tvrzení zůstalo v některém poli — nepravda v jednom slidu je pořád nepravda")
})

test("imagePrompt zůstává netknutý", () => {
    const { data } = applyFactFixes(draft(), [{ find: "25 years old sign", replace: "sign" }])
    assert(data.imagePrompt.includes("25 years old sign"),
        "brána sáhla do anglického popisu scény — tam nejsou tvrzení ke čtenáři, jen pokyny pro renderer")
})

test("netrefená citace se NESMÍ tvářit jako oprava", () => {
    const { data, applied, missed } = applyFactFixes(draft(), [{ find: "pečeme už 25 LET", replace: "pečeme poctivě" }])
    assert(applied === 0 && missed.length === 1, "judge si citaci upravil — to musí být poznat")
    assert(data.body.includes("25 let"), "text se nezměnil, ale výsledek by tvrdil opak")
})

test("prázdná náhrada tvrzení smaže", () => {
    const { data } = applyFactFixes(draft(), [{ find: " a chleba kynou přes noc", replace: "" }])
    assert(data.body === "Pečeme už 25 let.", `zbylo: ${data.body}`)
})

test("bez oprav se nemění nic", () => {
    const before = draft()
    const { data, applied } = applyFactFixes(before, [])
    assert(applied === 0 && JSON.stringify(data) === JSON.stringify(before), "brána šahá do textu i bez nálezu")
})

// ─── Brána nesmí rozbít tvar příspěvku ──────────────────────

console.log("\n🧱 Invarianty médií po zásahu brány")

test("story: hook a headline prvního snímku zůstanou shodné", () => {
    // Autopilot je srovnává natvrdo (frames[0] se opravuje na hook). Kdyby je brána
    // rozešla, snímek by tvrdil něco jiného než popisek — a všimne si toho až divák.
    const story = {
        hook: "Záruka 5 let na balení",
        frames: [
            { headline: "Záruka 5 let na balení", subtext: "Ověřeno" },
            { headline: "Objednej dnes", subtext: "Doprava zdarma nad 500 Kč" },
        ],
        body: "Shrnutí.", cta: "Napiš nám", hashtags: ["#x"],
    }
    const { data } = applyFactFixes(story, [{ find: "Záruka 5 let na balení", replace: "Záruka na balení" }])
    assert((data as any).hook === (data as any).frames[0].headline,
        `hook a snímek 1 se rozešly: "${(data as any).hook}" vs "${(data as any).frames[0].headline}"`)
})

test("žádné pole se nesmí vyprázdnit", () => {
    // Naměřeno: prázdná náhrada nad celým nadpisem sebrala hook — a ten je nosný dál
    // (caption, dedup, titulek karty, text vypálený do obrázku). Prázdný plakát je
    // horší závada než tvrzení, které zůstane a označí se.
    const post = {
        hook: "Vyrábíme od roku 1947",
        slides: [{ headline: "Vyrábíme od roku 1947", subtext: "Tradice", imagePrompt: "EN" }],
        body: "Text.", cta: "Mrkni", hashtags: ["#x"],
    }
    const { data } = applyFactFixes(post, [{ find: "Vyrábíme od roku 1947", replace: "" }])
    assert((data as any).hook.trim().length > 0, "hook se vyprázdnil")
    assert((data as any).slides[0].headline.trim().length > 0, "nadpis slidu se vyprázdnil")
})

test("reel: caption a body zůstanou v páru, scéna si nechá režii", () => {
    const reel = {
        hook: "Test", caption: "Vyrábíme od roku 1947.", body: "Vyrábíme od roku 1947.",
        scenes: [{ narration: "Vyrábíme od roku 1947.", visual: "EN", camera: "dolly", mood: "epic", soundEffect: "engine" }],
        cta: "x", hashtags: ["#x"],
    }
    const { data } = applyFactFixes(reel, [{ find: "Vyrábíme od roku 1947.", replace: "Vyrábíme poctivě." }])
    const d = data as any
    assert(d.caption === d.body, "caption a body se rozešly — renderer a popisek by tvrdily každý něco jiného")
    assert(d.scenes[0].visual === "EN" && d.scenes[0].camera === "dolly" && d.scenes[0].mood === "epic",
        "brána sáhla do režie scény; má se dotýkat jen mluveného slova")
})

test("počet slidů a snímků se nemění", () => {
    const post = {
        hook: "A",
        slides: [{ headline: "A", subtext: "1" }, { headline: "B", subtext: "2" }, { headline: "C", subtext: "3" }],
        frames: [{ headline: "A", subtext: "1" }, { headline: "B", subtext: "2" }],
        body: "x", cta: "y", hashtags: ["#x"],
    }
    const { data } = applyFactFixes(post, [{ find: "B", replace: "D" }])
    assert((data as any).slides.length === 3 && (data as any).frames.length === 2,
        "brána změnila počet slidů/snímků — formát je invariant, ne návrh")
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
