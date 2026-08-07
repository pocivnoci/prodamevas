/**
 * Prompt assembly tests — čisté funkce, ŽÁDNÉ volání modelu.
 *
 * Vzor převzatý z scripts/test-post-edit-prompt.ts: mega prompt je čistá funkce,
 * takže se dá postavit nad fixture configem a tvrdit o něm fakta. Tohle je jediný
 * způsob, jak hlídat promptové regrese bez placení za generování.
 *
 * Spuštění: npx tsx scripts/test-prompt-assembly.ts
 */

import { buildMegaPrompt, buildVideoSchema, buildCaptionSchema, buildCarouselSchema, buildStorySchema } from "../instagram/caption-generator"
import { formatContextForPrompt, type ContextSignals } from "../instagram/context-agent"
import type { ClientConfig } from "../instagram/configs/types"
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
