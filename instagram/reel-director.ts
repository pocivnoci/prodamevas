/**
 * Reel director — storyboard mezi copywriterem a Seedance.
 * ========================================================
 * Copywriter (Gemini Pro) napsal hook, scény a českou narraci; ta prošla
 * kritikem, redakcí i faktickou bránou. TTS ji namluvilo a změřilo. Teprve TEĎ
 * přichází režisér: dostane přesnou časovou osu vět, brandové fotky, produkt a
 * logo (očíslované jako Image 1…N) a vrátí storyboard — záběry zarovnané na
 * věty, každý ukazující na konkrétní referenci, plus JEDEN anglický prompt pro
 * Seedance, který cituje „Image N".
 *
 * Běží na Claude Sonnet 5 (`directWithClaude`) — jiná rodina než copywriter,
 * stejný důvod jako u soudce. Bez klíče nebo při chybě Claude padá na Gemini
 * `textPro` Pro ladder se STEJNÝM JSON schématem; `QualityUnavailableError`
 * z ladderu prochází (job se zaparkuje). Flash sem nesmí.
 *
 * Režisér narraci NEPÍŠE ani neupravuje — text, který zazní a svítí v titulcích,
 * obešel by kritika i faktickou bránu. Smí ji jen zkrátit (`condenseNarration`),
 * když se nevejde do stropu délky, a i tak beze změny významu a bez nových tvrzení.
 */

import { Type } from "@google/genai"
import type { ClientConfig } from "./configs/types"
import { generateTextQuality } from "./gemini-client"
import { getModel, hasFallback, getTemperature } from "./models"
import { claudeDirectorEnabled, directWithClaude } from "./anthropic-client"
import { buildFactsSection } from "./caption-generator"
import { getVisualMemoriesSection } from "./image-pipeline"
import {
    buildReelDirectorPrompt, buildStoryboardSchema, parseStoryboard, validateStoryboard,
    type DirectReelInput, type ReelReference, type ReelStoryboard,
} from "./reel-storyboard"

export type { ReelReference, ReelShot, ReelStoryboard, DirectReelInput } from "./reel-storyboard"
export { buildReelDirectorPrompt, buildStoryboardSchema, parseStoryboard, validateStoryboard, finalizeVideoPrompt } from "./reel-storyboard"

async function callDirector(prompt: string, images: ReelReference[], label: string): Promise<{ text: string; via: "claude" | "gemini" }> {
    const imgs = images.filter(r => r.buffer).map(r => ({ buffer: r.buffer!, mimeType: r.mimeType, label: `Image ${r.index} (${r.kind}): ${r.description}` }))
    if (claudeDirectorEnabled()) {
        try {
            return { text: await directWithClaude(prompt, { images: imgs, label, maxTokens: 4096 }), via: "claude" }
        } catch (err) {
            console.warn(`   ⚠️ Claude director (${label}) selhal — padám na Gemini Pro ladder: ${String((err as Error)?.message || err).slice(0, 120)}`)
        }
    }
    const models = [getModel("textPro")]
    if (hasFallback("textPro")) models.push(getModel("textPro", "fallback"))
    const text = await generateTextQuality(prompt, {
        models,
        responseSchema: buildStoryboardSchema(),
        images: imgs,
        temperature: getTemperature("designer"),
        label,
    })
    return { text, via: "gemini" }
}

/**
 * Storyboard s jedním opravným kolem. Claude → (chyba) Gemini Pro ladder;
 * nevalidní storyboard i po opravě = tvrdá chyba (job selže a vrátí kredit),
 * `QualityUnavailableError` z ladderu prochází beze změny (job se zaparkuje).
 */
export async function directReel(input: DirectReelInput): Promise<{ storyboard: ReelStoryboard; via: "claude" | "gemini" }> {
    const [memorySection, factsSection] = await Promise.all([
        getVisualMemoriesSection(input.clientId).catch(() => ""),
        Promise.resolve(safeFacts(input.config)),
    ])
    const basePrompt = buildReelDirectorPrompt(input, memorySection, factsSection)
    const ctx = { durationSeconds: input.durationSeconds, referenceCount: input.references.length, allowWebsite: input.ctaPolicy?.allowWebsite ?? false }

    let attemptPrompt = basePrompt
    let lastProblems: string[] = []
    for (let round = 0; round < 2; round++) {
        const { text, via } = await callDirector(attemptPrompt, input.references, round === 0 ? "reel-director" : "reel-director:repair")
        let sb: ReelStoryboard
        try {
            sb = parseStoryboard(text)
        } catch (err) {
            lastProblems = [`invalid JSON: ${String((err as Error)?.message || err).slice(0, 100)}`]
            attemptPrompt = `${basePrompt}\n\n## YOUR PREVIOUS ANSWER WAS REJECTED\n- ${lastProblems.join("\n- ")}\nReturn ONLY the corrected JSON object.`
            continue
        }
        lastProblems = validateStoryboard(sb, ctx)
        if (lastProblems.length === 0) {
            console.log(`   🎬 Storyboard (${via}): ${sb.shots.length} záběrů, prompt ${sb.videoPrompt.length} znaků`)
            return { storyboard: sb, via }
        }
        console.log(`   ↩️ Storyboard neprošel (${lastProblems.length}): ${lastProblems.slice(0, 3).join("; ")} — opravné kolo`)
        attemptPrompt = `${basePrompt}\n\n## YOUR PREVIOUS ANSWER WAS REJECTED — fix these and return ONLY the corrected JSON\n- ${lastProblems.join("\n- ")}\n\nPrevious answer:\n${text.slice(0, 4000)}`
    }
    throw new Error(`Storyboard reelu neprošel validací ani po opravě: ${lastProblems.join("; ").slice(0, 300)}`)
}

function safeFacts(config: ClientConfig): string {
    try { return buildFactsSection(config) } catch { return "" }
}

/**
 * Zkrátí narraci, když se nevejde do stropu délky ani se zrychlením. Význam,
 * pořadí vět, hook i CTA zůstávají; žádná nová čísla, tvrzení ani jména —
 * zkrácený text jde rovnou do voiceoveru a titulků, kritik už ho neuvidí.
 */
export async function condenseNarration(lines: string[], maxWords: number): Promise<string[]> {
    const prompt = `Zkrať tuhle českou narraci Instagram reelu tak, aby měla celkem NEJVÝŠ ${maxWords} slov (teď má ${lines.join(" ").split(/\s+/).filter(Boolean).length}).
Pravidla: zachovej počet vět (${lines.length}) a jejich pořadí, význam každé věty, hook v první a výzvu v poslední. Piš mluvenou češtinou, krátké věty. NEPŘIDÁVEJ žádná nová čísla, ceny, procenta, jména ani tvrzení — jen ubírej slova.

Věty:
${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}

Vrať POUZE JSON: {"lines": ["věta 1", "věta 2", ...]}`

    let text: string
    if (claudeDirectorEnabled()) {
        try {
            text = await directWithClaude(prompt, { label: "reel-condense", maxTokens: 1024 })
        } catch {
            text = await condenseWithGemini(prompt)
        }
    } else {
        text = await condenseWithGemini(prompt)
    }
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    const body = (fence ? fence[1] : text).trim()
    const obj = JSON.parse(body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1)) as { lines?: unknown }
    const out = Array.isArray(obj.lines) ? obj.lines.map(l => String(l).trim()).filter(Boolean) : []
    if (out.length !== lines.length) throw new Error(`condenseNarration: čekal jsem ${lines.length} vět, přišlo ${out.length}`)
    // Nic nového: každé číslo ve zkrácené verzi musí existovat v původní.
    const digits = (s: string) => (s.match(/\d+[.,]?\d*/g) || [])
    const allowed = new Set(digits(lines.join(" ")))
    for (const d of digits(out.join(" "))) {
        if (!allowed.has(d)) throw new Error(`condenseNarration: zkrácený text přidal číslo „${d}", které v originále není`)
    }
    return out
}

async function condenseWithGemini(prompt: string): Promise<string> {
    const models = [getModel("textPro")]
    if (hasFallback("textPro")) models.push(getModel("textPro", "fallback"))
    return generateTextQuality(prompt, {
        models,
        responseSchema: { type: Type.OBJECT, properties: { lines: { type: Type.ARRAY, items: { type: Type.STRING } } }, required: ["lines"] },
        temperature: getTemperature("judge"),
        label: "reel-condense",
    })
}
