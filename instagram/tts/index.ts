/**
 * Registr poskytovatelů TTS — jediné místo, kde se z `config.voice.provider`
 * stane kód, který mluví.
 */

import type { TtsProvider, TtsProviderId } from "./types"
import { geminiTts } from "./gemini"

export type { TtsProvider, TtsProviderId, TtsSynthesizeOptions } from "./types"
export { deliveryTags } from "./delivery"

const PROVIDERS: Record<string, TtsProvider> = {
    gemini: geminiTts,
    // TODO(ElevenLabs): `eleven_v3` / `eleven_multilingual_v2`, výstup `pcm_24000`
    // zabalený do WAV, ID modelu do `instagram/models.ts`, sazba za znak do
    // `lib/model-pricing.ts`, klíč `ELEVENLABS_API_KEY`. Návrh a podmínky
    // (nikdy tichý fallback na jiný hlas — radši zaparkovat) jsou v
    // `docs/DESIGN_reels-v2_2026-09-12.md`, fáze 1. Zapínat se smí až po
    // poslechovém testu spike skriptů, ne dřív.
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
