/**
 * Živý smoke test Seedance přes BytePlus ModelArk — NENÍ součást `npm run guard`.
 *
 *   npx tsx scripts/smoke-seedance.ts --dry     # jen vypíše tělo požadavku (bez sítě)
 *   npx tsx scripts/smoke-seedance.ts           # zadá jednu 4s úlohu 9:16 @480p (~$0,40)
 *
 * Účel: potvrdit tvar API (`buildTaskBody` / `parseTaskStatus`) proti živému
 * endpointu a ověřit, že ffmpeg-static umí `ass` filtr (titulky). Výstup jde do
 * scratch adresáře / cwd jako smoke-seedance.mp4.
 */

import { writeFileSync } from "fs"
import { spawnSync } from "child_process"
import { getModel } from "../instagram/models"
import {
    buildTaskBody, submitVideoTask, pollVideoTask, downloadVideo, seedanceEnabled, arkBaseUrl,
    type VideoTaskRequest,
} from "../instagram/seedance-client"
import { costUsdForCall, videoUnitKey } from "../lib/model-pricing"
import { getFfmpegPath } from "../instagram/reel-compositor"

async function main() {
    const dry = process.argv.includes("--dry")
    const req: VideoTaskRequest = {
        model: getModel("video"),
        prompt: "Vertical 9:16 product reel: a ceramic coffee cup on a wooden table, morning light, slow dolly in, steam rising. No people, no speech, no dialogue, no on-screen text.",
        references: [],
        durationSeconds: 4,
        resolution: "480p",
        ratio: "9:16",
        generateAudio: true,
    }

    console.log("🎬 Model:", req.model, "| endpoint:", arkBaseUrl())
    console.log("📦 Tělo požadavku:\n" + JSON.stringify(buildTaskBody(req), null, 2))

    try {
        const ff = getFfmpegPath()
        const filters = spawnSync(ff, ["-hide_banner", "-filters"], { encoding: "utf-8" }).stdout || ""
        console.log(`🎞️ ffmpeg: ${ff} — ass filtr: ${/\bass\b/.test(filters) ? "✅" : "❌ CHYBÍ (titulky se nevypálí)"}`)
    } catch (err) {
        console.log("🎞️ ffmpeg:", (err as Error).message)
    }

    if (dry) return
    if (!seedanceEnabled()) {
        console.error("❌ ARK_API_KEY chybí — živý test nejde spustit")
        process.exit(1)
    }

    const t0 = Date.now()
    const { taskId } = await submitVideoTask(req)
    const polled = await pollVideoTask(taskId, {
        budgetMs: 6 * 60_000,
        onTick: (ms, st) => { console.log(`   ⏳ ${Math.round(ms / 1000)} s — ${st}`) },
    })
    if (polled.status !== "succeeded") {
        console.error("❌", polled)
        process.exit(1)
    }
    const buf = await downloadVideo(polled.videoUrl)
    const out = "smoke-seedance.mp4"
    writeFileSync(out, buf)
    const cost = costUsdForCall(videoUnitKey(req.model, req.resolution), {
        promptTokens: 0, outputTokens: 0, thoughtTokens: 0, cachedTokens: 0, units: { kind: "seconds", n: req.durationSeconds },
    })
    console.log(`✅ ${out} (${(buf.length / 1024 / 1024).toFixed(1)} MB) za ${Math.round((Date.now() - t0) / 1000)} s — odhad $${cost ?? "?"}`)
}

main().catch(err => { console.error("❌", err); process.exit(1) })
