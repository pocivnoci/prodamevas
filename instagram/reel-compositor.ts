/**
 * Reel compositor — jeden průchod ffmpeg: video + voiceover + titulky.
 * ====================================================================
 * Vstupy: MP4 od Seedance (s nativní atmosférou nebo němé), složená voiceover
 * stopa (`reel-audio.ts`, jeden WAV) a ASS titulky (`reel-subtitles.ts`).
 * Výstup: H.264 MP4 s AAC, loudnorm na −14 LUFS (cíl Instagramu), faststart.
 *
 *   - atmosféra z videa se pod řečí STLAČÍ (sidechaincompress), ne jen ztiší —
 *     mezi větami se vrátí, takže reel nezní jako telefonát,
 *   - němé video (bez audio stopy) dostane jen voiceover — `[0:a]` se nesmí
 *     mapovat naslepo, jinak celý ffmpeg spadne,
 *   - titulky jdou přes `ass` + `fontsdir` s bundlovaným fontem (Inter Bold),
 *     protože `drawtext` ve statické binárce není.
 *
 * Selhání je SELHÁNÍ: reel za 5–10 kreditů bez titulků a voiceoveru není
 * dodávka, takže se tady nic nepolyká — orchestrátor chybu nechá projít do
 * jobu (refund) a do Sentry.
 */

import { spawn } from "child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

/** Bundlovaný font pro titulky — připnutý v next.config.ts `outputFileTracingIncludes`. */
export function reelFontsDir(): string {
    return join(process.cwd(), "assets", "fonts")
}

/**
 * Cesta k ffmpeg. `ffmpeg-static` vrací cestu k binárce, která na Vercelu existuje
 * jen díky tracingu — proto se existence OVĚŘUJE a chybějící soubor je
 * diagnostikovatelná chyba, ne spawn nesmyslné cesty s tichým pádem.
 */
export function getFfmpegPath(): string {
    const override = process.env.FFMPEG_PATH
    if (override) return override
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const staticPath = require("ffmpeg-static") as string | null
    if (!staticPath) throw new Error("ffmpeg-static nevrátil cestu k binárce")
    if (!existsSync(staticPath)) {
        throw new Error(`ffmpeg-static resolved to ${staticPath} but the file does not exist — zkontroluj outputFileTracingIncludes v next.config.ts`)
    }
    return staticPath
}

function runFfmpeg(args: string[], label: string): Promise<{ stderr: string }> {
    return new Promise((resolve, reject) => {
        const proc = spawn(getFfmpegPath(), args, { stdio: ["ignore", "ignore", "pipe"] })
        let stderr = ""
        proc.stderr?.on("data", d => { stderr += d.toString() })
        proc.on("error", err => reject(new Error(`ffmpeg ${label}: spawn selhal — ${err.message}`)))
        proc.on("close", code => {
            if (code === 0) resolve({ stderr })
            else reject(new Error(`ffmpeg ${label}: exit ${code} — ${stderr.slice(-600)}`))
        })
    })
}

/** Má vstup zvukovou stopu? `ffmpeg -i` bez výstupu končí kódem 1, ale vypíše streamy. */
export async function probeHasAudio(inputPath: string): Promise<boolean> {
    const stderr = await new Promise<string>((resolve) => {
        const proc = spawn(getFfmpegPath(), ["-hide_banner", "-i", inputPath], { stdio: ["ignore", "ignore", "pipe"] })
        let out = ""
        proc.stderr?.on("data", d => { out += d.toString() })
        proc.on("close", () => resolve(out))
        proc.on("error", () => resolve(out))
    })
    return /Stream #\d+:\d+.*Audio:/.test(stderr)
}

/** Cesty ve filter grafu: dvojtečka, čárka a apostrof jsou oddělovače. */
export function escapeFilterPath(p: string): string {
    return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/,/g, "\\,").replace(/'/g, "\\'")
}

export interface ComposeReelOptions {
    videoBuffer: Buffer
    /** Složená voiceover stopa (WAV) — bez ní se zachová jen zvuk videa. */
    voiceoverWav?: Buffer
    /** Obsah ASS souboru; bez něj se titulky nevypalují. */
    ass?: string
    /** Zrychlení voiceoveru z časové osy (1 = žádné). */
    atempo?: number
    /** Délka výsledku v sekundách — ořízne dojezd videa i stopy. */
    durationSeconds: number
    fontsDir?: string
    /** Zisk voiceoveru v dB (řeč musí vést). */
    voiceoverGainDb?: number
    /** Hlasitost atmosféry mimo řeč (lineárně, 0–1). */
    ambientLevel?: number
}

/** Sestaví argumenty ffmpeg — čistá funkce kvůli testům. */
export function buildComposeArgs(o: {
    inputVideo: string; inputVoiceover?: string; assPath?: string; fontsDir: string; hasVideoAudio: boolean
    atempo: number; durationSeconds: number; output: string; voiceoverGainDb: number; ambientLevel: number
}): string[] {
    const args: string[] = ["-y", "-hide_banner", "-loglevel", "error", "-i", o.inputVideo]
    if (o.inputVoiceover) args.push("-i", o.inputVoiceover)

    const filters: string[] = []
    // Video: titulky, nebo jen průchod (re-encode kvůli faststart/yuv420p je stejně nutný).
    if (o.assPath) {
        filters.push(`[0:v]ass='${escapeFilterPath(o.assPath)}':fontsdir='${escapeFilterPath(o.fontsDir)}'[v]`)
    } else {
        filters.push("[0:v]null[v]")
    }

    let audioMap: string | null = null
    const tempo = o.atempo !== 1 ? `atempo=${o.atempo.toFixed(3)},` : ""
    const gain = `volume=${o.voiceoverGainDb.toFixed(1)}dB`
    if (o.inputVoiceover && o.hasVideoAudio) {
        filters.push(
            `[1:a]${tempo}aformat=sample_rates=48000:channel_layouts=stereo,${gain},asplit=2[vo][sc]`,
            `[0:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${o.ambientLevel.toFixed(2)}[amb]`,
            // Stlačení atmosféry pod řečí: klíčem je voiceover (sidechain), výstup je jen atmosféra.
            `[amb][sc]sidechaincompress=threshold=0.02:ratio=8:attack=25:release=350:makeup=1[duck]`,
            `[duck][vo]amix=inputs=2:duration=first:normalize=0[mix]`,
            `[mix]loudnorm=I=-14:TP=-1.5:LRA=11[a]`,
        )
        audioMap = "[a]"
    } else if (o.inputVoiceover) {
        filters.push(`[1:a]${tempo}aformat=sample_rates=48000:channel_layouts=stereo,${gain},loudnorm=I=-14:TP=-1.5:LRA=11[a]`)
        audioMap = "[a]"
    } else if (o.hasVideoAudio) {
        filters.push(`[0:a]loudnorm=I=-14:TP=-1.5:LRA=11[a]`)
        audioMap = "[a]"
    }

    args.push("-filter_complex", filters.join(";"), "-map", "[v]")
    if (audioMap) args.push("-map", audioMap, "-c:a", "aac", "-b:a", "128k", "-ar", "48000")
    else args.push("-an")
    args.push(
        "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-t", String(o.durationSeconds),
        o.output,
    )
    return args
}

export async function composeReel(opts: ComposeReelOptions): Promise<Buffer> {
    const workDir = mkdtempSync(join(tmpdir(), "chrlit-reel-"))
    try {
        const inputVideo = join(workDir, "input.mp4")
        writeFileSync(inputVideo, opts.videoBuffer)
        let inputVoiceover: string | undefined
        if (opts.voiceoverWav) {
            inputVoiceover = join(workDir, "voiceover.wav")
            writeFileSync(inputVoiceover, opts.voiceoverWav)
        }
        let assPath: string | undefined
        if (opts.ass) {
            assPath = join(workDir, "subs.ass")
            writeFileSync(assPath, opts.ass, "utf-8")
        }
        const output = join(workDir, "output.mp4")
        const hasVideoAudio = await probeHasAudio(inputVideo)
        const args = buildComposeArgs({
            inputVideo, inputVoiceover, assPath, output, hasVideoAudio,
            fontsDir: opts.fontsDir ?? reelFontsDir(),
            atempo: opts.atempo ?? 1,
            durationSeconds: opts.durationSeconds,
            voiceoverGainDb: opts.voiceoverGainDb ?? 2,
            ambientLevel: opts.ambientLevel ?? 0.6,
        })
        await runFfmpeg(args, "compose")
        const out = readFileSync(output)
        if (out.length < 10 * 1024) throw new Error(`ffmpeg compose: výstup je podezřele malý (${out.length} B)`)
        return out
    } finally {
        try { rmSync(workDir, { recursive: true, force: true }) } catch { /* úklid je best-effort */ }
    }
}
