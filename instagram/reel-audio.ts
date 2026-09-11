/**
 * Reel audio — audio-first voiceover.
 * ===================================
 * Reel se staví od ZVUKU: nejdřív se namluví každá věta narrace zvlášť, změří se
 * její skutečná délka (z hlavičky WAV, bez ffmpegu) a z toho vznikne časová osa.
 * Až podle ní se zadává video a kreslí titulky. Předchozí pipeline to dělala
 * naopak — video na 8 s, jeden slepený voiceover a titulky podle časů, které si
 * model vymyslel — a výsledek byl přesně tak rozhozený, jak to zní.
 *
 * Čisté funkce (`wavInfo`, `buildTimeline`, `assembleVoiceoverWav`) drží
 * `scripts/test-reel-pipeline.ts`; síť je jen v `synthesizeNarration`.
 */

import { generateVoiceover } from "./gemini-client"
import { QualityUnavailableError } from "../utils/retry"
import { REEL_TIMELINE } from "../lib/reel-media"

export interface WavInfo {
    sampleRate: number
    channels: number
    bitsPerSample: number
    dataOffset: number
    dataBytes: number
    durationSeconds: number
}

/** Přečte RIFF/WAVE hlavičku. Vyhazuje na cokoli, co WAV není — ticho by lhalo. */
export function wavInfo(buf: Buffer): WavInfo {
    if (buf.length < 12 || buf.toString("latin1", 0, 4) !== "RIFF" || buf.toString("latin1", 8, 12) !== "WAVE") {
        throw new Error("wavInfo: buffer není RIFF/WAVE")
    }
    let off = 12
    let fmt: { channels: number; sampleRate: number; bits: number } | undefined
    while (off + 8 <= buf.length) {
        const id = buf.toString("latin1", off, off + 4)
        const size = buf.readUInt32LE(off + 4)
        if (id === "fmt ") {
            fmt = { channels: buf.readUInt16LE(off + 10), sampleRate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) }
        } else if (id === "data") {
            if (!fmt) throw new Error("wavInfo: chunk data před fmt")
            const dataBytes = Math.min(size, buf.length - off - 8)
            const blockAlign = (fmt.channels * fmt.bits) / 8
            return {
                sampleRate: fmt.sampleRate,
                channels: fmt.channels,
                bitsPerSample: fmt.bits,
                dataOffset: off + 8,
                dataBytes,
                durationSeconds: dataBytes / (fmt.sampleRate * blockAlign),
            }
        }
        off += 8 + size + (size & 1)
    }
    throw new Error("wavInfo: WAV bez chunku data")
}

/** Holé PCM → přehratelný WAV (tatáž hlavička, jakou skládá gemini-client). */
export function pcmToWav(pcm: Buffer, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
    const blockAlign = (channels * bitsPerSample) / 8
    const header = Buffer.alloc(44)
    header.write("RIFF", 0, "latin1")
    header.writeUInt32LE(36 + pcm.length, 4)
    header.write("WAVE", 8, "latin1")
    header.write("fmt ", 12, "latin1")
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20)
    header.writeUInt16LE(channels, 22)
    header.writeUInt32LE(sampleRate, 24)
    header.writeUInt32LE(sampleRate * blockAlign, 28)
    header.writeUInt16LE(blockAlign, 32)
    header.writeUInt16LE(bitsPerSample, 34)
    header.write("data", 36, "latin1")
    header.writeUInt32LE(pcm.length, 40)
    return Buffer.concat([header, pcm])
}

/**
 * Ořízne ticho na začátku a konci TTS klipu. Gemini TTS vrací každou větu s ~0,3 s ticha
 * před a ~0,4 s za řečí — složený reel pak měl mezi větami přes sekundu mrtvého vzduchu
 * a „délka řeči" nesla i to ticho. Pauzy řídí časová osa (`REEL_TIMELINE`), ne TTS.
 * Nechává kousek dojezdu, aby se neusekly souhlásky; celý tichý klip nebo jiný formát
 * než 16bit PCM vrací beze změny (prázdný klip hlídá volající).
 */
export function trimSilence(wav: Buffer, opts: { thresholdRms?: number; windowSeconds?: number; padSeconds?: number } = {}): Buffer {
    const { thresholdRms = 600, windowSeconds = 0.02, padSeconds = 0.06 } = opts
    const info = wavInfo(wav)
    if (info.bitsPerSample !== 16) return wav
    const frame = 2 * info.channels
    const frames = Math.floor(info.dataBytes / frame)
    const win = Math.max(1, Math.round(info.sampleRate * windowSeconds))
    const loud = (start: number): boolean => {
        const end = Math.min(frames, start + win)
        let sum = 0
        for (let f = start; f < end; f++) {
            for (let c = 0; c < info.channels; c++) {
                const v = wav.readInt16LE(info.dataOffset + f * frame + c * 2)
                sum += v * v
            }
        }
        return Math.sqrt(sum / Math.max(1, (end - start) * info.channels)) > thresholdRms
    }
    let first = 0
    while (first < frames && !loud(first)) first += win
    if (first >= frames) return wav
    let last = frames
    while (last > first && !loud(Math.max(first, last - win))) last -= win
    const pad = Math.round(info.sampleRate * padSeconds)
    const from = Math.max(0, first - pad)
    const to = Math.min(frames, last + pad)
    if (from === 0 && to === frames) return wav
    const pcm = Buffer.from(wav.subarray(info.dataOffset + from * frame, info.dataOffset + to * frame))
    return pcmToWav(pcm, info.sampleRate, info.channels, info.bitsPerSample)
}

export interface TimedLine {
    text: string
    /** Sekundy ve VÝSLEDNÉM videu (po případném zrychlení). */
    start: number
    end: number
}

export interface Timeline {
    /** Věty s časy, jak zazní ve videu — pro titulky i pro režiséra. */
    lines: TimedLine[]
    /** Počáteční čas každého klipu v PŮVODNÍM tempu (před atempo) — pro skládání stopy. */
    placements: number[]
    /** Délka videa v celých vteřinách, v mezích velikosti reelu. */
    durationSeconds: number
    /** Zrychlení voiceoveru, 1 = žádné. Aplikuje se na celou složenou stopu. */
    atempo: number
    /** Řeč se nevešla ani s povoleným zrychlením — text je nutné zkrátit. */
    tooLong: boolean
    /** Celkový čas (řeč + mezery + nájezd + dojezd) po zrychlení, v sekundách. */
    totalSeconds: number
}

export interface TimelineOptions {
    /** Ticho před první větou — hook potřebuje nádech, ne start na nule. */
    leadInSeconds: number
    /** Mezera mezi větami. */
    gapSeconds: number
    /** Dojezd po poslední větě — CTA nesmí useknout střih. */
    tailSeconds: number
    /** Nejvyšší zrychlení, které ještě zní jako řeč, ne jako reklama na léky. */
    maxTempo: number
}

/** Čísla žijí v `lib/reel-media.ts` — rozpočty slov z nich odečítají čas mimo řeč. */
export const TIMELINE_DEFAULTS: TimelineOptions = {
    leadInSeconds: REEL_TIMELINE.leadInSeconds,
    gapSeconds: REEL_TIMELINE.gapSeconds,
    tailSeconds: REEL_TIMELINE.tailSeconds,
    maxTempo: REEL_TIMELINE.maxTempo,
}

/**
 * Časová osa z naměřených délek. Když se řeč nevejde do stropu velikosti,
 * nejdřív se zkusí zrychlit (do `maxTempo`); když ani to nestačí, vrací
 * `tooLong` a volající text zkrátí — hard cut poslední věty (CTA) není řešení.
 */
export function buildTimeline(
    lines: string[],
    durations: number[],
    limits: { minSeconds: number; maxSeconds: number },
    opts: Partial<TimelineOptions> = {},
): Timeline {
    if (lines.length !== durations.length) throw new Error("buildTimeline: počet vět a délek nesedí")
    const o = { ...TIMELINE_DEFAULTS, ...opts }
    const n = lines.length
    const speech = durations.reduce((a, b) => a + b, 0)
    const fixed = o.leadInSeconds + o.gapSeconds * Math.max(0, n - 1) + o.tailSeconds
    const rawTotal = fixed + speech

    let atempo = 1
    let tooLong = false
    if (rawTotal > limits.maxSeconds) {
        atempo = rawTotal / limits.maxSeconds
        if (atempo > o.maxTempo) {
            tooLong = true
            atempo = o.maxTempo
        }
    }

    const placements: number[] = []
    const timed: TimedLine[] = []
    let t = o.leadInSeconds
    for (let i = 0; i < n; i++) {
        placements.push(t)
        timed.push({ text: lines[i], start: round3(t / atempo), end: round3((t + durations[i]) / atempo) })
        t += durations[i] + (i < n - 1 ? o.gapSeconds : 0)
    }
    const totalSeconds = round3((t + o.tailSeconds) / atempo)
    const durationSeconds = Math.min(limits.maxSeconds, Math.max(limits.minSeconds, Math.ceil(totalSeconds - 1e-6)))

    return { lines: timed, placements, durationSeconds, atempo: round3(atempo), tooLong, totalSeconds }
}

function round3(x: number): number {
    return Math.round(x * 1000) / 1000
}

/**
 * Složí jednu WAV stopu z klipů položených na osu (v PŮVODNÍM tempu — zrychlení
 * dělá až ffmpeg nad celou stopou). Čisté PCM sčítání, žádný ffmpeg: formát
 * všech klipů musí být shodný (Gemini TTS vrací 24 kHz mono 16 bit) — jinak se
 * hází, protože tichý resample by rozladil zvuk.
 */
export function assembleVoiceoverWav(clips: Buffer[], placements: number[], totalSeconds: number): Buffer {
    if (clips.length === 0) throw new Error("assembleVoiceoverWav: žádné klipy")
    if (clips.length !== placements.length) throw new Error("assembleVoiceoverWav: počet klipů a pozic nesedí")
    const infos = clips.map(wavInfo)
    const ref = infos[0]
    for (const i of infos) {
        if (i.sampleRate !== ref.sampleRate || i.channels !== ref.channels || i.bitsPerSample !== ref.bitsPerSample) {
            throw new Error(`assembleVoiceoverWav: klipy mají různý formát (${i.sampleRate}/${i.channels}/${i.bitsPerSample} vs ${ref.sampleRate}/${ref.channels}/${ref.bitsPerSample})`)
        }
    }
    const blockAlign = (ref.channels * ref.bitsPerSample) / 8
    const totalFrames = Math.ceil(totalSeconds * ref.sampleRate)
    const pcm = Buffer.alloc(totalFrames * blockAlign)
    clips.forEach((clip, idx) => {
        const info = infos[idx]
        const offset = Math.round(placements[idx] * ref.sampleRate) * blockAlign
        if (offset >= pcm.length) return
        const bytes = Math.min(info.dataBytes, pcm.length - offset)
        clip.copy(pcm, offset, info.dataOffset, info.dataOffset + bytes)
    })
    return pcmToWav(pcm, ref.sampleRate, ref.channels, ref.bitsPerSample)
}

/** Rozpočty slov (kolik se vejde do reelu) počítá `lib/reel-media.ts` z času mimo řeč. */
export function wordCount(lines: string[]): number {
    return lines.join(" ").split(/\s+/).filter(Boolean).length
}

/**
 * Namluví každou větu zvlášť a změří ji. Běží PŘED zadáním videa, takže když
 * TTS nejde (ani s fallback modelem), job se zaparkuje bez jediné utracené
 * vteřiny videa — `QualityUnavailableError`, stejně jako u vyčerpaného Pro tieru.
 */
export async function synthesizeNarration(
    lines: string[],
    opts: { voice?: string; mood?: string; audioTags?: string[] },
): Promise<{ clips: Buffer[]; durations: number[] }> {
    const clips: Buffer[] = []
    const durations: number[] = []
    for (const [i, text] of lines.entries()) {
        try {
            // Ticho kolem věty ořezat DŘÍV, než se měří — pauzy dává osa, ne TTS.
            const clip = trimSilence(await generateVoiceover(text, { voice: opts.voice, mood: opts.mood, audioTags: opts.audioTags }))
            const info = wavInfo(clip)
            if (info.durationSeconds < 0.2) throw new Error(`TTS vrátilo prázdný klip (${info.durationSeconds}s)`)
            clips.push(clip)
            durations.push(round3(info.durationSeconds))
        } catch (err) {
            throw new QualityUnavailableError(`TTS nedostupné u věty ${i + 1}/${lines.length}: ${String((err as Error)?.message || err).slice(0, 160)}`)
        }
    }
    return { clips, durations }
}
