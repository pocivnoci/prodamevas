/**
 * Registr poskytovatelů TTS — jediné místo, kde se z `config.voice.provider`
 * stane kód, který mluví.
 */

import type { TtsProvider, TtsProviderId } from "./types"
import { geminiTts } from "./gemini"
import { elevenLabsTts } from "./elevenlabs"

export type { TtsProvider, TtsProviderId, TtsSynthesizeOptions } from "./types"
export { deliveryTags } from "./delivery"

const PROVIDERS: Record<string, TtsProvider> = {
    gemini: geminiTts,
    // ElevenLabs zapojený 12. 9. 2026 po poslechu (`scripts/smoke-elevenlabs-voice.ts`,
    // `audit-screenshots/spike/elevenlabs/`). KDO mluví za značku, neurčuje tenhle
    // registr, ale `config.voice.provider` a výchozí `DEFAULT_TTS_PROVIDER`
    // v `lib/voice-library.ts`. Fallback MEZI poskytovateli neexistuje — cizí hlas
    // není fallback (viz throw níže); uvnitř ElevenLabs padá v3 na Multilingual v2
    // se stejným hlasem.
    elevenlabs: elevenLabsTts,
}

/**
 * Neznámý poskytovatel VYHAZUJE. Tiché sjetí na Gemini by znamenalo, že klient,
 * který si vybral (a zaplatil) konkrétní hlas, dostane cizí — a nikdo se to
 * nedozví. Kvalita se nedegraduje potichu.
 */
export function getTtsProvider(provider: TtsProviderId | string | undefined): TtsProvider {
    const id = (provider || "gemini").trim()
    const found = PROVIDERS[id]
    if (!found) {
        throw new Error(`TTS poskytovatel „${id}" není zapojený — známe: ${Object.keys(PROVIDERS).join(", ")}`)
    }
    return found
}
