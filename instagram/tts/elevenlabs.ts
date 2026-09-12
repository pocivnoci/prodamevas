/**
 * TTS poskytovatel ElevenLabs.
 * ============================
 * Proč druhý poskytovatel: Gemini TTS má anglicky laděnou prozodii — česká věta
 * stoupá na konci po anglicku a „ř"/„ě" přežívají jen někdy (poslech 12. 9. 2026,
 * `audit-screenshots/spike/`). ElevenLabs v3 i Multilingual v2 mají češtinu
 * v podporovaných jazycích (elevenlabs.io/docs/models) a hlasy jdou castovat per
 * značka. Návrh a podmínky: docs/DESIGN_reels-v2_2026-09-12.md, fáze 1.
 *
 * Tři pravidla, která tenhle soubor drží:
 *
 * 1. **Vrací hotový WAV.** ElevenLabs umí `pcm_24000` (holé 16bit PCM), hlavičku
 *    dolepuje `pcmToWav` — stejná cesta jako u Gemini, takže `wavInfo()` ani
 *    `buildTimeline()` v `reel-audio.ts` rozdíl nepoznají. (`wav_*` formáty má API
 *    jen na 44,1 kHz a ty chtějí Pro tier.)
 * 2. **Fallback je stejný hlas, jiný model.** `eleven_v3` → `eleven_multilingual_v2`
 *    se STEJNÝM `voiceId`, nahlas v logu. Na Gemini se nepadá: klient si vybral
 *    konkrétní hlas a cizí hlas není fallback, je to jiný produkt. Když mlčí oba
 *    modely, vyhazujeme — `synthesizeNarration` to překlopí na
 *    `QualityUnavailableError` a reel se ZAPARKUJE, nedodá se s jiným hlasem.
 * 3. **Účtuje se za znak.** ElevenLabs nevrací tokeny, počítá znaky vstupu (včetně
 *    tagů přednesu v textu). `recordUnits(model, "characters", n)` → sazba v
 *    `lib/model-pricing.ts`. Bez toho by hlas reelu měřil nulu.
 *
 * Tagy přednesu (`deliveryTags`) čte jen v3 — Multilingual v2 by „[warmly]"
 * VYSLOVIL, proto se pro něj vynechají. `language_code` se neposílá: v3 ani v2 ho
 * neberou (jen Flash/Turbo 2.5), jazyk poznají z textu — pole `language`
 * v rozhraní je tu proto přiznaně nevyužité. `style` značky se zatím nepředává:
 * v3 bere anglické emoční tagy, ne českou větu; mapa přijde, až poslech ukáže,
 * co se stylem dělat.
 */

import { getModel, hasFallback } from "../models"
import { recordUnits } from "../usage-meter"
import { withQualityRetry } from "../../utils/retry"
import { pcmToWav } from "./wav"
import type { TtsProvider, TtsSynthesizeOptions } from "./types"
import dotenv from "dotenv"

dotenv.config({ path: ".env.local" })

const BASE_URL = (process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io").replace(/\/+$/, "")

/** Holé PCM 24 kHz — totéž, co vrací Gemini, takže časová osa reelu nemá dva režimy. */
export const ELEVENLABS_OUTPUT_FORMAT = "pcm_24000"
const SAMPLE_RATE = 24_000

/**
 * Tagy z `deliveryTags()` → slovník v3. Anglicky a příslovcem, tak je v3
 * dokumentuje (`[whispers]`, `[excited]`…). „clear" = neutrál, žádný tag.
 */
const V3_TAGS: Record<string, string> = {
    warm: "warmly",
    upbeat: "excited",
    calm: "calmly",
    serious: "serious",
    playful: "playfully",
    clear: "",
}

/** Jen rodina v3 čte tagy přednesu; ostatní modely by je vyslovily. */
export function supportsAudioTags(model: string): boolean {
    return /^eleven_v3/.test(model)
}

export interface ElevenLabsSpeechRequest {
    text: string
    model_id: string
}

/**
 * Čistá část: tělo požadavku pro daný model. Exportovaná kvůli
 * `scripts/test-reel-pipeline.ts` — tvar požadavku je to, co se rozbije potichu.
 */
export function buildSpeechRequest(text: string, model: string, opts: Pick<TtsSynthesizeOptions, "tags">): ElevenLabsSpeechRequest {
    const tags = supportsAudioTags(model)
        ? (opts.tags || []).map(t => V3_TAGS[t] ?? t).filter(Boolean)
        : []
    const spoken = tags.length ? `${tags.map(t => `[${t}]`).join(" ")} ${text}` : text
    return { text: spoken, model_id: model }
}

async function speak(text: string, model: string, opts: TtsSynthesizeOptions): Promise<Buffer> {
    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY není nastavený — hlas značky přes ElevenLabs nejde namluvit (skutečný klíč začíná sk_)")

    const body = buildSpeechRequest(text, model, opts)
    const url = `${BASE_URL}/v1/text-to-speech/${encodeURIComponent(opts.voiceId)}?output_format=${ELEVENLABS_OUTPUT_FORMAT}`
    const res = await fetch(url, {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
    })
    if (!res.ok) {
        // Tělo nese `detail.status` (quota_exceeded, voice_not_found, invalid_api_key…).
        // Status v hlášce rozhoduje o retry: 429/5xx je přechodné, „not_found" trvalé.
        const detail = (await res.text()).replace(/\s+/g, " ").slice(0, 300)
        throw new Error(`ElevenLabs ${model} HTTP ${res.status}: ${detail}`)
    }
    const pcm = Buffer.from(await res.arrayBuffer())
    // Pod desetinu vteřiny není řeč, je to prázdná odpověď; `trimSilence` by ji pak
    // vrátila jako hotový klip a reel by měl místo věty díru.
    if (pcm.length < SAMPLE_RATE * 2 * 0.1) throw new Error(`ElevenLabs ${model} vrátil prázdné audio (${pcm.length} B)`)

    recordUnits(model, "characters", body.text.length, "tts")
    return pcmToWav(pcm, SAMPLE_RATE, 1, 16)
}

/** Krátký retry na přetížení (429/5xx); trvalé chyby (hlas nebo klíč neexistuje) letí hned. */
function withShortRetry(fn: () => Promise<Buffer>, label: string): Promise<Buffer> {
    return withQualityRetry(fn, { maxRetries: 2, baseDelayMs: 2000, maxDelayMs: 8000, label })
}

export const elevenLabsTts: TtsProvider = {
    id: "elevenlabs",
    async synthesize(text: string, opts: TtsSynthesizeOptions): Promise<Buffer> {
        const primary = getModel("ttsElevenlabs")
        try {
            return await withShortRetry(() => speak(text, primary, opts), `elevenlabs ${primary}`)
        } catch (err) {
            if (!hasFallback("ttsElevenlabs")) throw err
            const fallback = getModel("ttsElevenlabs", "fallback")
            console.warn(`⚠️ ElevenLabs ${primary} selhal (${String((err as Error)?.message || err).slice(0, 160)}) — stejný hlas ${opts.voiceId} přes ${fallback}`)
            return withShortRetry(() => speak(text, fallback, opts), `elevenlabs ${fallback}`)
        }
    },
}
