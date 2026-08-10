/**
 * Sonda: chytá se implicitní cache na mega promptu?
 *   npx tsx scripts/probe-prompt-cache.ts <slug> [--live]
 *
 * Google má implicitní cachování zapnuté defaultně pro modely 2.5+ a dává 90 % slevu
 * na cachované tokeny (cached rate = 10 % vstupní sazby). Podmínky jsou dvě:
 *   1. prompt musí mít aspoň MIN_TOKENS (4 096 pro gemini-3.5-flash i 3.1-pro-preview)
 *   2. **záleží na pořadí** — velký a společný obsah patří na ZAČÁTEK promptu
 *
 * Bez `--live` je sonda zadarmo: postaví skutečný mega prompt nad skutečným configem,
 * spočítá tokeny přes countTokens a najde, kde končí stabilní prefix (první místo, kde
 * se do promptu vloží obsah konkrétního postu). To samo rozhodne, jestli má
 * přeuspořádání smysl.
 *
 * S `--live` pošle tentýž prompt dvakrát za sebou a přečte cachedContentTokenCount —
 * jediný způsob, jak ověřit, že cache reálně zabírá. Stojí dvě textová volání.
 */

import { GoogleGenAI } from "@google/genai"
import dotenv from "dotenv"
import { loadConfig } from "../instagram/configs"
import { buildMegaPrompt } from "../instagram/caption-generator"
import { getModel } from "../instagram/models"
import supabaseAdmin from "../supabase/admin"
import type { PostType } from "../instagram/types"
import type { PerformanceInsight } from "../instagram/performance"

dotenv.config({ path: ".env.local" })

/** Minimum pro cache hit — ai.google.dev/gemini-api/docs/caching (ověřeno 2026-08-10). */
const MIN_TOKENS: Record<string, number> = {
    "gemini-3.5-flash": 4096,
    "gemini-3.1-pro-preview": 4096,
    "gemini-2.5-flash": 2048,
    "gemini-2.5-pro": 2048,
}

const slug = process.argv[2]
const live = process.argv.includes("--live")

if (!slug) {
    console.error("Použití: npx tsx scripts/probe-prompt-cache.ts <slug> [--live]")
    process.exit(1)
}

const noPerf: PerformanceInsight = {
    bestPostTypes: [], bestHooks: [], bestTimeSlots: [], avgEngagement: 0,
    topPatterns: [], conversionRate: 0, bestConvertingTypes: [],
}

async function main() {
    const { data: client } = await supabaseAdmin
        .from("clients").select("id, slug, name").eq("slug", slug).single()
    if (!client) throw new Error(`klient "${slug}" neexistuje`)

    const config = await loadConfig(client.slug)
    const { data: types } = await supabaseAdmin
        .from("ig_post_types").select("*").eq("client_id", client.id).limit(1)
    const firstType = config.postTypes?.[0] ?? "post"
    const postType = (types?.[0] ?? {
        id: "1", name: firstType, display_name: firstType,
        emoji: "📱", description: "", frequency: "weekly",
    }) as unknown as PostType

    // REALISTICKÝ prompt, ne minimální: skutečná generace nese nápad, historii captionů
    // i výkonnostní data. Měřit holý prompt by výsledek uměle zmenšilo.
    const idea = (n: number) => ({
        id: `idea-${n}`, title: `Nápad číslo ${n}`,
        content: `Delší popis nápadu ${n}, jak ho vrací zásobník témat — dvě věty kontextu.`,
        category: "tip", subcategory: null,
    }) as any
    const recent = [
        "Starý hook číslo jedna, aby sekce NEOPAKUJ SE nebyla prázdná.",
        "Starý hook číslo dvě s trochu jiným rytmem a délkou.",
        "Starý hook číslo tři, protože engine posílá posledních pět.",
    ]
    const perf: PerformanceInsight = {
        ...noPerf, avgEngagement: 420,
        bestHooks: ["Nejlepší hook podle metrik"], topPatterns: ["POV formát"],
    }

    const prompt = buildMegaPrompt(config, postType, idea(1), null, recent, perf)
    // Druhý post téže značky a téhož formátu — liší se jen nápadem. Přesně tenhle pár
    // se v kampani potkává, takže jejich SPOLEČNÝ PREFIX je strop toho, co implicitní
    // cache může kdy ušetřit.
    const promptB = buildMegaPrompt(config, postType, idea(2), null, recent, perf)

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })
    const model = getModel("textPro")

    const { totalTokens } = await ai.models.countTokens({ model, contents: prompt })
    const min = MIN_TOKENS[model] ?? 4096

    // Skutečný společný prefix dvou po sobě jdoucích generací.
    let common = 0
    while (common < prompt.length && common < promptB.length && prompt[common] === promptB[common]) common++
    const commonText = prompt.slice(0, common)
    const commonTokens = common > 0
        ? (await ai.models.countTokens({ model, contents: commonText })).totalTokens ?? 0
        : 0

    console.log(`\n📏 MEGA PROMPT — ${client.name} (${slug})\n`)
    console.log(`   model:            ${model}`)
    console.log(`   znaky:            ${prompt.length.toLocaleString("cs")}`)
    console.log(`   tokeny:           ${totalTokens?.toLocaleString("cs")}`)
    console.log(`   minimum pro cache: ${min.toLocaleString("cs")}`)
    console.log(`   → ${(totalTokens ?? 0) >= min
        ? "✅ prompt je nad minimem, cache se chytit MŮŽE"
        : "❌ prompt je POD minimem — implicitní cache se nechytne nikdy"}`)

    // Kde končí stabilní prefix? Hledáme první výskyt obsahu, který se mění post od
    // postu. Všechno před ním je společné pro každou generaci téhle značky.
    const variableMarkers: [string, string][] = [
        ["## TVŮJ ÚKOL", "název formátu + popis"],
        ["## 🎯 VYBRANÝ PRODUKT", "produkt"],
        ["## ZDROJOVÝ NÁPAD", "nápad ze zásobníku"],
        ["## 🎯 ZADANÉ TÉMA", "téma od uživatele"],
        ["## 📊 DATA Z REÁLNÉHO VÝKONU", "learning data"],
    ]
    const hits = variableMarkers
        .map(([m, label]) => [prompt.indexOf(m), m, label] as const)
        .filter(([i]) => i >= 0)
        .sort((a, b) => a[0] - b[0])

    console.log(`\n🔀 KDE SE PROMPT ZAČNE LIŠIT POST OD POSTU\n`)
    for (const [idx, marker, label] of hits) {
        const share = Math.round((idx / prompt.length) * 100)
        console.log(`   ${String(share).padStart(3)} %  ${marker}  — ${label}`)
    }

    console.log(`\n🧊 STROP ÚSPOR — společný prefix dvou po sobě jdoucích generací\n`)
    console.log(`   společné znaky:   ${common.toLocaleString("cs")} z ${prompt.length.toLocaleString("cs")}`)
    console.log(`   společné tokeny:  ${commonTokens.toLocaleString("cs")} (${Math.round((commonTokens / (totalTokens || 1)) * 100)} % promptu)`)
    console.log(`   → ${commonTokens >= min
        ? "✅ společný prefix je nad minimem — cache může zabrat"
        : `❌ společný prefix je pod minimem (${min.toLocaleString("cs")}) — implicitní cache se NIKDY nechytne, ani po přeuspořádání`}`)

    if (!live) {
        console.log(`\n💡 Přidej --live pro skutečné ověření cache (2 volání modelu).\n`)
        return
    }

    // Živé ověření: dvakrát tentýž prompt krátce po sobě. Implicitní cache se plní
    // prvním voláním, druhé by ji mělo trefit.
    console.log(`\n🔬 ŽIVÉ OVĚŘENÍ — 2× tentýž prompt na ${model}\n`)
    for (const pass of [1, 2]) {
        const res = await ai.models.generateContent({
            model,
            contents: prompt,
            config: { maxOutputTokens: 16 } as any,
        })
        const u: any = res.usageMetadata ?? {}
        console.log(`   běh ${pass}: prompt=${u.promptTokenCount ?? 0} ` +
            `cached=${u.cachedContentTokenCount ?? 0} ` +
            `output=${u.candidatesTokenCount ?? 0} ` +
            `thoughts=${u.thoughtsTokenCount ?? 0}`)
        if (pass === 1) await new Promise(r => setTimeout(r, 2000))
    }
    console.log(`\n   cached > 0 ve druhém běhu = implicitní cache zabírá.\n`)
}

void main().catch(err => { console.error("❌", err.message); process.exit(1) })
