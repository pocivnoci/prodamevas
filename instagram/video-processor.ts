/**
 * Video Post-Processor for Instagram Reels
 * =========================================
 * FFmpeg pipeline (ffmpeg-static binary, system ffmpeg fallback):
 * 1. Normalize 1–3 Veo clips (1080×1920, 30 fps) and concat them
 * 2. Mix TTS voiceover over the native Veo audio
 * 3. Burn in Czech subtitles via drawtext + a shipped font file
 *    (NOT the libass `subtitles=` filter — a bare lambda has no fontconfig,
 *    so `fontfile=` is the only deterministic path; line-wrapping happens
 *    in JS, one drawtext per rendered line)
 * 4. Emit a deterministic IG-spec MP4 (H.264 CRF 23 + AAC 128k + faststart)
 *
 * Pure helpers (subtitle math, clip planning, WAV handling) are exported
 * for scripts/test-reel-logic.ts.
 */

import { spawn } from "child_process"
import { writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { randomUUID } from "crypto"

// ============================================
// TYPES
// ============================================

export interface SubtitleEntry {
    startTime: number  // seconds (global reel timeline)
    endTime: number    // seconds
    text: string       // subtitle text (Czech)
}

export interface ProcessReelOptions {
    /** 1–3 raw Veo MP4s in concat order. */
    clipBuffers: Buffer[]
    /** Real WAV (RIFF) buffer — see pcmToWav for Gemini TTS raw PCM. */
    voiceoverWav?: Buffer
    /** Cues on the GLOBAL (post-concat) timeline. */
    subtitles?: SubtitleEntry[]
    /** Mix ratio: 0 = only video audio, 1 = only voiceover. Default: 0.7 (voiceover dominant) */
    voiceoverMix?: number
    /** Final reel length; output is trimmed to it. */
    targetDurationSec: number
}

// ============================================
// FFmpeg BINARY + FONT RESOLUTION
// ============================================

function getFfmpegPath(): string {
    try {
        // Try ffmpeg-static first (npm package provides static binary)
        const ffmpegStatic = require("ffmpeg-static") as string
        return ffmpegStatic
    } catch {
        // Fallback to system ffmpeg
        return "ffmpeg"
    }
}

/** Shipped subtitle font (full Czech diacritics). Traced via outputFileTracingIncludes. */
export function getSubtitleFontPath(): string {
    const fontPath = join(process.cwd(), "instagram", "assets", "fonts", "Inter-Bold.ttf")
    if (!existsSync(fontPath)) {
        throw new Error(
            `Subtitle font not found at ${fontPath} — check outputFileTracingIncludes in next.config.ts`
        )
    }
    return fontPath
}

// ============================================
// WAV HELPERS (Gemini TTS returns raw PCM L16)
// ============================================

/** Wrap raw PCM samples in a 44-byte RIFF/WAVE header so ffmpeg can probe them. */
export function pcmToWav(
    pcm: Buffer,
    opts: { sampleRate?: number; channels?: number; bitDepth?: number } = {}
): Buffer {
    const { sampleRate = 24000, channels = 1, bitDepth = 16 } = opts
    const byteRate = sampleRate * channels * (bitDepth / 8)
    const blockAlign = channels * (bitDepth / 8)
    const header = Buffer.alloc(44)
    header.write("RIFF", 0, "ascii")
    header.writeUInt32LE(36 + pcm.length, 4)
    header.write("WAVE", 8, "ascii")
    header.write("fmt ", 12, "ascii")
    header.writeUInt32LE(16, 16)          // fmt chunk size
    header.writeUInt16LE(1, 20)           // PCM
    header.writeUInt16LE(channels, 22)
    header.writeUInt32LE(sampleRate, 24)
    header.writeUInt32LE(byteRate, 28)
    header.writeUInt16LE(blockAlign, 32)
    header.writeUInt16LE(bitDepth, 34)
    header.write("data", 36, "ascii")
    header.writeUInt32LE(pcm.length, 40)
    return Buffer.concat([header, pcm])
}

/** Duration of a RIFF/WAVE buffer in seconds (chunk-walking, 0 on malformed input). */
export function wavDurationSec(wav: Buffer): number {
    if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF") return 0
    let byteRate = 0
    let dataLen = 0
    let offset = 12
    while (offset + 8 <= wav.length) {
        const id = wav.toString("ascii", offset, offset + 4)
        const size = wav.readUInt32LE(offset + 4)
        if (id === "fmt " && offset + 20 <= wav.length) {
            byteRate = wav.readUInt32LE(offset + 16)
        } else if (id === "data") {
            dataLen = Math.min(size, wav.length - offset - 8)
        }
        offset += 8 + size + (size % 2)
    }
    return byteRate > 0 ? dataLen / byteRate : 0
}

/** Extract raw PCM + format from a RIFF/WAVE buffer (assumes PCM/L16). */
function readWav(wav: Buffer): { pcm: Buffer; sampleRate: number; channels: number; bitDepth: number } {
    let sampleRate = 24000, channels = 1, bitDepth = 16
    let dataStart = 44, dataLen = Math.max(0, wav.length - 44)
    let offset = 12
    while (offset + 8 <= wav.length) {
        const id = wav.toString("ascii", offset, offset + 4)
        const size = wav.readUInt32LE(offset + 4)
        if (id === "fmt " && offset + 24 <= wav.length) {
            channels = wav.readUInt16LE(offset + 10)
            sampleRate = wav.readUInt32LE(offset + 12)
            bitDepth = wav.readUInt16LE(offset + 22)
        } else if (id === "data") {
            dataStart = offset + 8
            dataLen = Math.min(size, wav.length - dataStart)
            break
        }
        offset += 8 + size + (size % 2)
    }
    return { pcm: wav.subarray(dataStart, dataStart + dataLen), sampleRate, channels, bitDepth }
}

/**
 * Concatenate same-format WAVs (all from Gemini TTS) into one, with a short
 * silence gap between segments for natural pacing. Enables per-scene voiceover
 * whose measured durations give EXACT subtitle timing (no scripted-timeRange guess).
 */
export function concatWavs(buffers: Buffer[], gapMs = 120): Buffer {
    const real = buffers.filter(b => b && b.length > 44)
    if (real.length === 0) return pcmToWav(Buffer.alloc(0))
    const { sampleRate, channels, bitDepth } = readWav(real[0])
    const bytesPerSample = channels * (bitDepth / 8)
    const gapBytes = Math.max(0, Math.round((gapMs / 1000) * sampleRate) * bytesPerSample)
    const silence = Buffer.alloc(gapBytes)
    const parts: Buffer[] = []
    real.forEach((b, i) => {
        parts.push(readWav(b).pcm)
        if (i < real.length - 1 && gapBytes > 0) parts.push(silence)
    })
    return pcmToWav(Buffer.concat(parts), { sampleRate, channels, bitDepth })
}

// ============================================
// SUBTITLES
// ============================================

/** Parse "0-2s" / "2.5-5s" into seconds; null on malformed input. */
function parseTimeRange(timeRange: string): { start: number; end: number } | null {
    const match = timeRange.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/)
    if (!match) return null
    const start = parseFloat(match[1])
    const end = parseFloat(match[2])
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
    return { start, end }
}

/**
 * Convert structured scenes to subtitle entries for burn-in.
 */
export function scenesToSubtitles(scenes: { timeRange: string; narration?: string }[]): SubtitleEntry[] {
    return scenes
        .filter(s => s.narration)
        .map(s => {
            const range = parseTimeRange(s.timeRange)
            if (!range) return null
            return { startTime: range.start, endTime: range.end, text: s.narration! }
        })
        .filter((s): s is SubtitleEntry => s !== null)
}

/** Greedy word-wrap; overflow past maxLines is merged into the last line. */
export function wrapSubtitleText(text: string, maxCharsPerLine = 22, maxLines = 2): string[] {
    const words = text.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) return []
    const lines: string[] = []
    let current = ""
    for (const word of words) {
        const candidate = current ? `${current} ${word}` : word
        if (current && candidate.length > maxCharsPerLine) {
            lines.push(current)
            current = word
        } else {
            current = candidate
        }
    }
    if (current) lines.push(current)
    if (lines.length > maxLines) {
        const merged = lines.slice(maxLines - 1).join(" ")
        lines.length = maxLines - 1
        lines.push(merged)
    }
    return lines
}

/**
 * Two-level ffmpeg escaping for drawtext option values embedded in a
 * filter_complex string: level 1 escapes the option-value specials (\ ' :),
 * level 2 escapes the filtergraph-parser specials (\ ' [ ] , ;).
 */
export function escapeDrawtext(text: string): string {
    const level1 = text.replace(/[\\':]/g, m => `\\${m}`)
    return level1.replace(/[\\'\[\],;]/g, m => `\\${m}`)
}

// Subtitle layout at the normalized 1080×1920 canvas.
const SUB_FONT_SIZE = 58
const SUB_LINE_STEP = 76   // font size + spacing
const SUB_BASE_Y = 1470    // ~76 % of height — clear of IG UI overlays

/**
 * One drawtext filter per rendered LINE (JS wrapping replaces libass line
 * breaking; per-line filters also avoid newline handling in filter strings).
 * Returned filters are meant to be joined with "," onto the video chain.
 */
export function buildSubtitleFilters(subtitles: SubtitleEntry[], fontFile: string): string[] {
    const font = escapeDrawtext(fontFile)
    const filters: string[] = []
    for (const cue of subtitles) {
        const lines = wrapSubtitleText(cue.text)
        const enable = `between(t\\,${cue.startTime.toFixed(2)}\\,${cue.endTime.toFixed(2)})`
        lines.forEach((line, i) => {
            filters.push(
                `drawtext=expansion=none:fontfile=${font}:text=${escapeDrawtext(line)}` +
                `:enable=${enable}:fontsize=${SUB_FONT_SIZE}:fontcolor=white` +
                `:borderw=2:bordercolor=black@0.85:box=1:boxcolor=black@0.45:boxborderw=14` +
                `:x=(w-text_w)/2:y=${SUB_BASE_Y + i * SUB_LINE_STEP}`
            )
        })
    }
    return filters
}

// ============================================
// CLIP PLANNING (multi-clip reels)
// ============================================

/**
 * Split a reel duration into Veo clip lengths (each 5–8 s):
 * 8→[8], 16→[8,8], 24→[8,8,8], 20→[7,7,6]. With REEL_ALLOWED_DURATIONS
 * the parts always sum exactly; odd inputs are clamped per-clip.
 */
export function planClips(durationSec: number): number[] {
    const total = Math.max(5, Math.round(durationSec || 8))
    const count = Math.ceil(total / 8)
    const base = Math.floor(total / count)
    const remainder = total - base * count
    return Array.from({ length: count }, (_, i) =>
        Math.min(8, Math.max(5, base + (i < remainder ? 1 : 0)))
    )
}

export interface ClipGroup<T> {
    scenes: T[]
    startSec: number
    durationSec: number
}

/**
 * Assign scenes to clips by the midpoint of their timeRange on the global
 * timeline. Every clip must end up with ≥1 scene (Veo needs content to render)
 * — empty clips steal the nearest scene from an adjacent clip that has ≥2.
 */
export function groupScenesIntoClips<T extends { timeRange: string }>(
    scenes: T[],
    clipPlan: number[]
): ClipGroup<T>[] {
    const groups: ClipGroup<T>[] = []
    let cursor = 0
    for (const dur of clipPlan) {
        groups.push({ scenes: [], startSec: cursor, durationSec: dur })
        cursor += dur
    }
    const total = cursor

    scenes.forEach((scene, index) => {
        const range = parseTimeRange(scene.timeRange)
        // Malformed timeRange → place proportionally by scene order.
        const midpoint = range
            ? (range.start + range.end) / 2
            : (total * (index + 0.5)) / scenes.length
        let target = groups.findIndex(g => midpoint >= g.startSec && midpoint < g.startSec + g.durationSec)
        if (target === -1) target = groups.length - 1
        groups[target].scenes.push(scene)
    })

    // Rebalance: no clip may stay empty.
    for (let pass = 0; pass < groups.length; pass++) {
        let changed = false
        for (let i = 0; i < groups.length; i++) {
            if (groups[i].scenes.length > 0) continue
            const prev = groups[i - 1]
            const next = groups[i + 1]
            if (prev && prev.scenes.length >= 2) {
                groups[i].scenes.unshift(prev.scenes.pop()!)
                changed = true
            } else if (next && next.scenes.length >= 2) {
                groups[i].scenes.push(next.scenes.shift()!)
                changed = true
            }
        }
        if (!changed) break
    }
    return groups
}

// ============================================
// FFmpeg EXECUTION
// ============================================

function execFfmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const proc = spawn(getFfmpegPath(), args, { stdio: ["ignore", "ignore", "pipe"] })
        let stderr = ""
        proc.stderr?.on("data", data => { stderr += data.toString() })
        proc.on("close", code => {
            if (code !== 0) {
                reject(new Error(`FFmpeg exited with code ${code}: ${stderr.substring(stderr.length - 800)}`))
            } else {
                resolve()
            }
        })
        proc.on("error", err => {
            reject(new Error(`FFmpeg not available: ${err.message}. Install ffmpeg-static or system ffmpeg.`))
        })
    })
}

/** Probe a clip for an audio stream + duration. A Veo clip without an audio track
 *  would break the concat (which requires a=1 per segment) — the caller synthesizes
 *  silence for any gap. Never throws (probe failure ⇒ assume no audio, 0s). */
function probeClip(path: string): Promise<{ hasAudio: boolean; durationSec: number }> {
    return new Promise(resolve => {
        const proc = spawn(getFfmpegPath(), ["-hide_banner", "-i", path], { stdio: ["ignore", "ignore", "pipe"] })
        let err = ""
        proc.stderr?.on("data", d => { err += d.toString() })
        const finish = () => {
            const hasAudio = /Stream #\d+:\d+.*: Audio:/.test(err)
            const m = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
            const durationSec = m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : 0
            resolve({ hasAudio, durationSec })
        }
        proc.on("close", finish)
        proc.on("error", () => resolve({ hasAudio: false, durationSec: 0 }))
    })
}

/**
 * Assemble the final reel: normalize + concat clips, mix voiceover, burn
 * subtitles, encode the deterministic IG-spec MP4. One ffmpeg invocation.
 */
export async function processReelVideo(options: ProcessReelOptions): Promise<Buffer> {
    const { clipBuffers, voiceoverWav, subtitles, voiceoverMix = 0.7, targetDurationSec } = options
    if (clipBuffers.length === 0) throw new Error("processReelVideo: no clip buffers")

    const workDir = join(tmpdir(), `chrlit-reel-${randomUUID()}`)
    mkdirSync(workDir, { recursive: true })
    const outputPath = join(workDir, "output.mp4")

    try {
        const args: string[] = ["-y"]
        const clipPaths: string[] = []
        clipBuffers.forEach((buf, i) => {
            const p = join(workDir, `clip${i}.mp4`)
            writeFileSync(p, buf)
            clipPaths.push(p)
            args.push("-i", p)
        })
        const voIndex = clipBuffers.length
        if (voiceoverWav) {
            const p = join(workDir, "voiceover.wav")
            writeFileSync(p, voiceoverWav)
            args.push("-i", p)
        }

        // Audio-presence guard: Veo *should* return native audio (generateAudio:true),
        // but a clip missing an audio stream would break the concat (a=1 per segment).
        // Add one bounded silent input per audio-less clip so assembly never hard-fails.
        const probes = await Promise.all(clipPaths.map(probeClip))
        const silenceInputFor: Record<number, number> = {}
        let nextInput = voIndex + (voiceoverWav ? 1 : 0)
        probes.forEach((pr, i) => {
            if (!pr.hasAudio) {
                args.push("-f", "lavfi", "-t", (pr.durationSec || targetDurationSec).toFixed(3), "-i", "anullsrc=r=48000:cl=stereo")
                silenceInputFor[i] = nextInput++
            }
        })
        if (Object.keys(silenceInputFor).length > 0) {
            console.log(`   🔇 ${Object.keys(silenceInputFor).length} klip(ů) bez audio stopy — doplňuji ticho`)
        }

        const filters: string[] = []

        // Normalize every clip — Veo output params are not guaranteed identical,
        // and the concat filter requires matching size/fps/sar. Crop-to-FILL
        // (scale up to cover, then centre-crop) so a clip Veo returned at a slightly
        // different aspect FILLS 1080×1920 — never letterboxed with black bars.
        clipBuffers.forEach((_, i) => {
            filters.push(
                `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,` +
                `crop=1080:1920,fps=30,setsar=1[v${i}]`
            )
            const audioSrc = probes[i].hasAudio ? `[${i}:a]` : `[${silenceInputFor[i]}:a]`
            filters.push(`${audioSrc}aresample=48000[a${i}]`)
        })

        if (clipBuffers.length > 1) {
            const inputs = clipBuffers.map((_, i) => `[v${i}][a${i}]`).join("")
            filters.push(`${inputs}concat=n=${clipBuffers.length}:v=1:a=1[cv][ca]`)
        } else {
            filters.push(`[v0]null[cv]`, `[a0]anull[ca]`)
        }

        // Voiceover mix + fit. The reel EXTENDS to hold its last frame until the
        // narration finishes (never chopped mid-word), bounded (+8s) against a runaway
        // script. We do NOT time-stretch the audio: the caller's subtitle cues are
        // aligned to the REAL voiceover timeline, so speeding it up would desync them.
        // amix uses duration=longest so the mix isn't clipped to the ambient length.
        let audioLabel = "[ca]"
        let finalDur = targetDurationSec
        if (voiceoverWav) {
            const voDur = wavDurationSec(voiceoverWav)
            finalDur = Math.min(targetDurationSec + 8, Math.max(targetDurationSec, voDur + 0.3))
            if (finalDur > targetDurationSec + 0.05) {
                console.log(`   ⏸️ Voiceover ${voDur.toFixed(1)}s > video ${targetDurationSec}s — držím poslední frame do ${finalDur.toFixed(1)}s`)
            }
            const bgVol = (1 - voiceoverMix).toFixed(2)
            const voVol = voiceoverMix.toFixed(2)
            filters.push(
                `[${voIndex}:a]volume=${voVol}[vo]`,
                `[ca]volume=${bgVol}[bg]`,
                `[bg][vo]amix=inputs=2:duration=longest:dropout_transition=0[aout]`
            )
            audioLabel = "[aout]"
        }

        // Hold the last video frame when the reel was extended to fit the narration,
        // so the extra tail isn't black. -t below trims to the exact finalDur.
        let videoBase = "[cv]"
        if (finalDur > targetDurationSec + 0.05) {
            const pad = (finalDur - targetDurationSec + 1).toFixed(2)
            filters.push(`[cv]tpad=stop_mode=clone:stop_duration=${pad}[cvpad]`)
            videoBase = "[cvpad]"
        }

        // Burn subtitles onto the (possibly extended) timeline.
        let videoLabel = videoBase
        if (subtitles && subtitles.length > 0) {
            const subFilters = buildSubtitleFilters(subtitles, getSubtitleFontPath())
            if (subFilters.length > 0) {
                filters.push(`${videoBase}${subFilters.join(",")}[vout]`)
                videoLabel = "[vout]"
            }
        }

        args.push(
            "-filter_complex", filters.join(";"),
            "-map", videoLabel,
            "-map", audioLabel,
            "-t", finalDur.toFixed(3),
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-pix_fmt", "yuv420p",
            "-r", "30",
            "-c:a", "aac",
            "-b:a", "128k",
            "-ar", "48000",
            "-movflags", "+faststart",
            outputPath
        )

        await execFfmpeg(args)
        return readFileSync(outputPath)
    } finally {
        try {
            rmSync(workDir, { recursive: true, force: true })
        } catch {
            // Non-fatal cleanup error
        }
    }
}

/**
 * Extract single frames (JPEG) at the given timestamps — input for video QA.
 * Timestamps past EOF are skipped, not fatal.
 */
export async function extractFrames(videoBuffer: Buffer, atSeconds: number[]): Promise<Buffer[]> {
    const workDir = join(tmpdir(), `chrlit-frames-${randomUUID()}`)
    mkdirSync(workDir, { recursive: true })
    const inputPath = join(workDir, "input.mp4")

    try {
        writeFileSync(inputPath, videoBuffer)
        const frames: Buffer[] = []
        for (let i = 0; i < atSeconds.length; i++) {
            const ts = Math.max(0, atSeconds[i])
            const framePath = join(workDir, `frame${i}.jpg`)
            try {
                await execFfmpeg([
                    "-y", "-ss", ts.toFixed(2), "-i", inputPath,
                    "-frames:v", "1", "-q:v", "3", framePath,
                ])
                if (existsSync(framePath)) frames.push(readFileSync(framePath))
            } catch {
                // Timestamp past EOF or decode hiccup — QA works with fewer frames.
            }
        }
        return frames
    } finally {
        try {
            rmSync(workDir, { recursive: true, force: true })
        } catch {
            // Non-fatal cleanup error
        }
    }
}
