/**
 * Video Post-Processor for Instagram Reels
 * =========================================
 * Uses FFmpeg to:
 * 1. Merge Veo 3.1 video with TTS voiceover audio
 * 2. Optionally burn-in subtitles from narration text
 * 3. Normalize audio levels
 *
 * Uses fluent-ffmpeg with ffmpeg-static binary.
 */

import { spawn } from "child_process"
import { writeFileSync, readFileSync, unlinkSync, mkdirSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { randomUUID } from "crypto"

// ============================================
// TYPES
// ============================================

interface SubtitleEntry {
    startTime: number  // seconds
    endTime: number    // seconds
    text: string       // subtitle text (Czech)
}

interface ProcessVideoOptions {
    videoBuffer: Buffer
    voiceoverBuffer?: Buffer
    subtitles?: SubtitleEntry[]
    /** Mix ratio: 0 = only video audio, 1 = only voiceover. Default: 0.7 (voiceover dominant) */
    voiceoverMix?: number
}

// ============================================
// FFmpeg BINARY RESOLUTION
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

// ============================================
// SRT SUBTITLE GENERATION
// ============================================

function formatSrtTime(seconds: number): string {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    const ms = Math.round((seconds % 1) * 1000)
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`
}

function generateSrt(entries: SubtitleEntry[]): string {
    return entries.map((e, i) =>
        `${i + 1}\n${formatSrtTime(e.startTime)} --> ${formatSrtTime(e.endTime)}\n${e.text}\n`
    ).join("\n")
}

/**
 * Convert structured scenes to subtitle entries for burn-in.
 */
export function scenesToSubtitles(scenes: { timeRange: string; narration?: string }[]): SubtitleEntry[] {
    return scenes
        .filter(s => s.narration)
        .map(s => {
            // Parse "0-2s" or "2-5s" format
            const match = s.timeRange.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/)
            if (!match) return null
            return {
                startTime: parseFloat(match[1]),
                endTime: parseFloat(match[2]),
                text: s.narration!,
            }
        })
        .filter((s): s is SubtitleEntry => s !== null)
}

// ============================================
// FFmpeg PROCESSING
// ============================================

function runFfmpeg(args: string[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const ffmpegPath = getFfmpegPath()
        const proc = spawn(ffmpegPath, args, { stdio: ["pipe", "pipe", "pipe"] })

        let stderr = ""
        proc.stderr?.on("data", (data) => { stderr += data.toString() })

        const chunks: Buffer[] = []
        proc.stdout?.on("data", (data) => chunks.push(data))

        proc.on("close", (code) => {
            if (code !== 0) {
                reject(new Error(`FFmpeg exited with code ${code}: ${stderr.substring(0, 500)}`))
            } else {
                // Read output file instead of stdout for complex operations
                resolve(Buffer.concat(chunks))
            }
        })

        proc.on("error", (err) => {
            reject(new Error(`FFmpeg spawn error: ${err.message}`))
        })
    })
}

/**
 * Process a Reel video: merge voiceover, burn subtitles.
 * Returns the final MP4 buffer.
 */
export async function processReelVideo(options: ProcessVideoOptions): Promise<Buffer> {
    const { videoBuffer, voiceoverBuffer, subtitles, voiceoverMix = 0.7 } = options

    // Create temp directory for FFmpeg files
    const workDir = join(tmpdir(), `chrlit-reel-${randomUUID()}`)
    if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true })

    const inputVideoPath = join(workDir, "input.mp4")
    const outputPath = join(workDir, "output.mp4")

    try {
        // Write input video
        writeFileSync(inputVideoPath, videoBuffer)

        const ffmpegArgs: string[] = ["-y"]

        // Input 1: video
        ffmpegArgs.push("-i", inputVideoPath)

        // Input 2: voiceover audio (if provided)
        let voiceoverPath: string | undefined
        if (voiceoverBuffer) {
            voiceoverPath = join(workDir, "voiceover.wav")
            writeFileSync(voiceoverPath, voiceoverBuffer)
            ffmpegArgs.push("-i", voiceoverPath)
        }

        // Build filter complex
        const filters: string[] = []
        let audioOutput = ""

        if (voiceoverBuffer) {
            // Mix video audio (lower) with voiceover (higher)
            const videoVol = (1 - voiceoverMix).toFixed(2)
            const voVol = voiceoverMix.toFixed(2)
            filters.push(
                `[0:a]volume=${videoVol}[vid_audio]`,
                `[1:a]volume=${voVol}[vo_audio]`,
                `[vid_audio][vo_audio]amix=inputs=2:duration=shortest[mixed_audio]`
            )
            audioOutput = "[mixed_audio]"
        }

        // Subtitle filter (burn-in)
        let videoOutput = "0:v"
        let srtPath: string | undefined
        if (subtitles && subtitles.length > 0) {
            srtPath = join(workDir, "subs.srt")
            writeFileSync(srtPath, generateSrt(subtitles), "utf-8")

            // Escape path for FFmpeg filter (Windows backslashes, colons)
            const escapedPath = srtPath.replace(/\\/g, "/").replace(/:/g, "\\:")

            // Style: white text, black semi-transparent background, bottom center
            const subtitleStyle = "FontName=Arial,FontSize=16,PrimaryColour=&HFFFFFF,OutlineColour=&H40000000,BorderStyle=4,Outline=1,Shadow=0,MarginV=30"

            if (filters.length > 0) {
                // If we already have audio filters, add video filter to complex
                filters.push(`[0:v]subtitles='${escapedPath}':force_style='${subtitleStyle}'[subbed_video]`)
                videoOutput = "[subbed_video]"
            } else {
                // Simple case: only subtitles, no audio mixing
                ffmpegArgs.push("-vf", `subtitles='${escapedPath}':force_style='${subtitleStyle}'`)
            }
        }

        // Apply filter complex if we have filters
        if (filters.length > 0) {
            ffmpegArgs.push("-filter_complex", filters.join(";"))
            ffmpegArgs.push("-map", videoOutput)
            if (audioOutput) ffmpegArgs.push("-map", audioOutput)
        } else if (!voiceoverBuffer) {
            // No processing needed beyond subtitles (handled by -vf above)
            ffmpegArgs.push("-c:a", "copy")
        }

        // Output settings
        ffmpegArgs.push(
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-c:a", "aac",
            "-b:a", "128k",
            "-movflags", "+faststart",
            "-shortest",
            outputPath
        )

        // Run FFmpeg
        const ffmpegPath = getFfmpegPath()
        await new Promise<void>((resolve, reject) => {
            const proc = spawn(ffmpegPath, ffmpegArgs, {
                stdio: ["pipe", "pipe", "pipe"],
            })

            let stderr = ""
            proc.stderr?.on("data", (data) => { stderr += data.toString() })

            proc.on("close", (code) => {
                if (code !== 0) {
                    reject(new Error(`FFmpeg exited with code ${code}: ${stderr.substring(0, 500)}`))
                } else {
                    resolve()
                }
            })

            proc.on("error", (err) => {
                reject(new Error(`FFmpeg not available: ${err.message}. Install ffmpeg-static or system ffmpeg.`))
            })
        })

        // Read output
        return readFileSync(outputPath)
    } finally {
        // Cleanup temp files
        try {
            const files = ["input.mp4", "voiceover.wav", "subs.srt", "output.mp4"]
            for (const f of files) {
                const p = join(workDir, f)
                if (existsSync(p)) unlinkSync(p)
            }
        } catch {
            // Non-fatal cleanup error
        }
    }
}
