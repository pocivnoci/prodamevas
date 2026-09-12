/**
 * TTS poskytovatel Gemini.
 * ========================
 * Kód sem přišel z `gemini-client.ts` beze změny chování — jen dostal rozhraní
 * (`TtsProvider`), aby šel vedle něj postavit druhý poskytovatel, aniž by o něm
 * musela vědět reelová pipeline. `gemini-client.ts` si nechal tenkou obálku
 * `generateVoiceover()` kvůli zpětné kompatibilitě.
 *
 * Vlastní klient `GoogleGenAI` (a ne import z `gemini-client.ts`) je schválně:
 * obálka tam ukazuje sem, a kruhový import mezi bránou k modelům a poskytovatelem
 * hlasu by se lišil podle toho, který modul se načte první.
 *
 * ID modelů dál přes `getModel("tts")` — registr v `instagram/models.ts` se
 * nemění.
 */

import { GoogleGenAI } from "@google/genai"
import { getModel } from "../models"
import { recordUsage } from "../usage-meter"
import type { TtsProvider, TtsSynthesizeOptions } from "./types"
import { pcmToWav } from "./wav"
import dotenv from "dotenv"

dotenv.config({ path: ".env.local" })

let _ai: GoogleGenAI | null = null
function getAI(): GoogleGenAI {
    if (!_ai) {
        const apiKey = process.env.GEMINI_API_KEY
        if (!apiKey) throw new Error("GEMINI_API_KEY is not set. Add it to Vercel Environment Variables.")
        _ai = new GoogleGenAI({ apiKey })
    }
    return _ai
}

/**
 * Gemini TTS vrací **holé PCM bez kontejneru** (`audio/L16;codec=pcm;rate=24000`),
 * ne WAV. Uložit ten buffer jako `.wav` znamená soubor, který ffmpeg odmítne
 * (`Invalid data found when processing input`) — a protože reel orchestrátor
 * chybu post-processingu polyká a pošle dál syrový klip, **každý reel dosud
 * odcházel bez českého voiceoveru a bez titulků**, jen s varováním v logu.
 *
 * Hlavička se proto dolepuje tady, u zdroje: volající pak drží buffer, který je
 * sám o sobě přehratelný soubor, a nemusí hádat vzorkovací frekvenci. Parametry
 * se čtou z `mimeType`, ne natvrdo — kdyby Gemini přepnul na 48 kHz nebo stereo,
 * hlavička se přizpůsobí místo aby tiše rozladila zvuk.
 */
export function toPlayableAudio(raw: Buffer, mimeType?: string): Buffer {
    // Už kontejner (RIFF/WAVE, MP3, OGG…) — nesahat na to.
    if (raw.subarray(0, 4).toString("latin1") === "RIFF") return raw
    if (!/L16|pcm/i.test(mimeType || "")) return raw

    const rate = Number(/rate=(\d+)/i.exec(mimeType || "")?.[1]) || 24_000
    const channels = Number(/channels=(\d+)/i.exec(mimeType || "")?.[1]) || 1
    return pcmToWav(raw, rate, channels, 16)
}

/**
 * Namluví jeden úsek textu. Tagy přednesu se předřazují textu v hranatých
 * závorkách — tak je Gemini TTS čte (200+ podporovaných tagů).
 */
export async function generateVoiceover(
    narrationText: string,
    options: {
        voice?: string        // Preset voice name (default: "Kore")
        mood?: string         // e.g. "professional", "excited", "calm"
        audioTags?: string[]  // expressive delivery tags, e.g. ["warm pace", "smiling"]
    } = {},
): Promise<Buffer> {
    const { voice = "Kore", mood, audioTags } = options

    const tags = [mood, ...(audioTags || [])].filter(Boolean)
    const textWithMood = tags.length
        ? `${tags.map(t => `[${t}]`).join("")} ${narrationText}`
        : narrationText

    const callModel = async (model: string): Promise<Buffer> => {
        const response = await getAI().models.generateContent({
            model,
            contents: textWithMood,
            config: {
                responseModalities: ["AUDIO"] as any,
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: {
                            voiceName: voice,
                        },
                    },
                },
            } as any,
        })

        recordUsage(model, response.usageMetadata, "tts")

        const audioPart = response.candidates?.[0]?.content?.parts?.[0]
        const inlineData = (audioPart as any)?.inlineData

        if (!inlineData?.data) {
            throw new Error("TTS returned no audio data")
        }

        return toPlayableAudio(Buffer.from(inlineData.data, "base64"), inlineData.mimeType)
    }

    try {
        return await callModel(getModel("tts"))
    } catch (err) {
        console.warn(`⚠️ ${getModel("tts")} failed — falling back to ${getModel("tts", "fallback")}...`, err)
        return callModel(getModel("tts", "fallback"))
    }
}

/**
 * Jazyk se Gemini nepředává — odvozuje si ho z textu a české věty čte česky.
 * Pole `language` v rozhraní přesto je, protože ElevenLabs (a další) ho vyžadují
 * jako parametr; poskytovatel, který ho ignoruje, to má přiznat tady, ne tím, že
 * rozhraní zúží.
 */
export const geminiTts: TtsProvider = {
    id: "gemini",
    synthesize(text: string, opts: TtsSynthesizeOptions): Promise<Buffer> {
        return generateVoiceover(text, {
            voice: opts.voiceId,
            mood: opts.style,
            audioTags: opts.tags,
        })
    },
}
