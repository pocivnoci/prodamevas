/**
 * Živý smoke test: umí Seedance 2.5 mluvit česky? — NENÍ součást `npm run guard`.
 *
 *   npx tsx scripts/smoke-seedance-dialogue.ts --dry        # jen ukáže tělo požadavku, nic nestojí
 *   npx tsx scripts/smoke-seedance-dialogue.ts              # čeština přímo ze Seedance, ~0,80 USD
 *   npx tsx scripts/smoke-seedance-dialogue.ts --lang=en    # totéž anglicky pro srovnání
 *
 * Proč to existuje
 * ----------------
 * Reelová pipeline dnes modelu řeč ZAKAZUJE — `instagram/reel-storyboard.ts` posílá
 * „no speech, dialogue, singing or lip movement" — a hlas dabuje Gemini TTS přes
 * `instagram/reel-audio.ts`. Ten zákaz je opatrnost, ne ověřený závěr: nikdy se
 * nezměřilo, jestli Seedance zvládne českou výslovnost a souhyb rtů. Tenhle test dělá
 * schválně OPAK produkce — řekne si o mluvící postavu a nechá si to na jedné úloze
 * potvrdit nebo vyvrátit.
 *
 * Anglická varianta není ozdoba: když čeština selže a angličtina projde, je to vada
 * jazyka (model neumí ř/ě/č), ne vada zadání. To je rozdíl mezi „nepoužitelné" a
 * „použitelné jinde".
 *
 * Co na výsledku hodnotit
 * -----------------------
 *   1. srozumitelnost češtiny — ř, ě, č, ů, š, ž jsou místa, kde to praská
 *   2. souhyb rtů se zvukem (lip-sync), hlavně na koncovkách
 *   3. přízvuk a tempo — čeština má přízvuk na první slabice, ne na druhé
 *
 * Když čeština nesedí, zůstává dabing přes TTS a nastupuje `smoke-seedance-audio-ref.ts`,
 * který zkouší dát modelu náš vlastní hlas jako audio referenci.
 */

import { writeFileSync } from "fs"
import { getModel } from "../instagram/models"
import {
    buildTaskBody, submitVideoTask, pollVideoTask, downloadVideo, seedanceEnabled, arkBaseUrl,
    type VideoTaskRequest, type VideoResolution,
} from "../instagram/seedance-client"
import { costUsdForCall, videoUnitKey } from "../lib/model-pricing"

/**
 * Věty jsou schválně nabité českými fonémy, které anglicky trénovaný model nezná:
 * „Tříletá" (ř + í), „vrácení" (á + í), „dnů" (ů), „Věříme" (ě + ř), „přesvědčte" (ř + ě + č).
 * Kdyby se testovalo na „Dobrý den, vítejte", projde skoro cokoli a nic se nedozvíme.
 */
const LINES: Record<string, { line: string; language: string }> = {
    cs: {
        line: "Tříletá záruka, doprava zdarma a vrácení do třiceti dnů. Věříme kvalitě — přesvědčte se sami.",
        language: "Czech",
    },
    en: {
        line: "A three-year warranty, free shipping and returns within thirty days. We stand behind our quality — see for yourself.",
        language: "English",
    },
}

function arg(name: string, fallback: string): string {
    const hit = process.argv.find(a => a.startsWith(`--${name}=`))
    return hit ? hit.slice(name.length + 3) : fallback
}

function buildPrompt(line: string, language: string): string {
    // Zadání je anglicky (stejně jako `reel-storyboard.ts`), ale VĚTA se cituje doslovně
    // v cílovém jazyce — model musí dostat přesné znění, ne jeho popis.
    return [
        "Vertical 9:16 medium close-up of a friendly shop owner in their thirties,",
        "standing in a bright modern store, looking straight into the camera and SPEAKING to the viewer.",
        `They speak in ${language} and say exactly these words, word for word: "${line}".`,
        "Natural lip movement precisely synchronized to the spoken words, warm daylight,",
        "shallow depth of field, slow subtle push-in, single continuous shot.",
        "Clear conversational delivery at a natural pace. Quiet room tone only, no music over the voice.",
        "No on-screen text, no captions, no subtitles, no logos, no watermark.",
    ].join(" ")
}

async function main() {
    const dry = process.argv.includes("--dry")
    const lang = arg("lang", "cs")
    const chosen = LINES[lang]
    if (!chosen) {
        console.error(`❌ Neznámý jazyk „${lang}" — použij --lang=cs nebo --lang=en`)
        process.exit(1)
    }

    const seconds = Number(arg("seconds", "8"))
    const resolution = arg("resolution", "480p") as VideoResolution

    const req: VideoTaskRequest = {
        model: getModel("video"),
        prompt: buildPrompt(chosen.line, chosen.language),
        references: [],
        durationSeconds: seconds,
        resolution,
        ratio: "9:16",
        // Bez nativního zvuku by nebylo co poslouchat — tady je řeč ÚČEL, ne vedlejšák.
        generateAudio: true,
    }

    const estimate = costUsdForCall(videoUnitKey(req.model, req.resolution), {
        promptTokens: 0, outputTokens: 0, thoughtTokens: 0, cachedTokens: 0,
        units: { kind: "seconds", n: req.durationSeconds },
    })

    console.log(`🎬 Model: ${req.model} | endpoint: ${arkBaseUrl()}`)
    console.log(`🗣️  Jazyk: ${chosen.language} | ${seconds} s @ ${resolution} | odhad $${estimate ?? "?"}`)
    console.log(`📝 Věta: „${chosen.line}"`)
    console.log("📦 Tělo požadavku:\n" + JSON.stringify(buildTaskBody(req), null, 2))

    if (dry) {
        console.log("\n🧪 --dry: nic se neodeslalo, nic nestálo.")
        return
    }
    if (!seedanceEnabled()) {
        console.error("❌ ARK_API_KEY chybí — živý test nejde spustit")
        process.exit(1)
    }

    const t0 = Date.now()
    const { taskId } = await submitVideoTask(req)
    const polled = await pollVideoTask(taskId, {
        budgetMs: 8 * 60_000,
        onTick: (ms, st) => { console.log(`   ⏳ ${Math.round(ms / 1000)} s — ${st}`) },
    })
    if (polled.status !== "succeeded") {
        console.error("❌", polled)
        process.exit(1)
    }

    const buf = await downloadVideo(polled.videoUrl)
    const out = `smoke-seedance-dialogue-${lang}.mp4`
    writeFileSync(out, buf)
    console.log(`\n✅ ${out} (${(buf.length / 1024 / 1024).toFixed(1)} MB) za ${Math.round((Date.now() - t0) / 1000)} s — odhad $${estimate ?? "?"}`)
    console.log("👂 Poslechni si: 1) srozumitelnost ř/ě/č/ů  2) souhyb rtů  3) přízvuk na první slabice")
}

main().catch(err => { console.error("❌", err); process.exit(1) })
