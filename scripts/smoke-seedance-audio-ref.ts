/**
 * Živý smoke test: vezme Seedance NÁŠ voiceover jako audio referenci? (lip-sync)
 * NENÍ součást `npm run guard`.
 *
 *   npx tsx scripts/smoke-seedance-audio-ref.ts --dry   # postaví a vypíše kandidátní těla, nic nestojí
 *   npx tsx scripts/smoke-seedance-audio-ref.ts         # namluví WAV, nahraje ho a zkusí zadat úlohu
 *
 * Proč to existuje
 * ----------------
 * `smoke-seedance-dialogue.ts` zjišťuje, jestli model mluví česky SÁM. Tenhle jde druhou
 * cestou: hlas si necháme svůj (Gemini TTS je značkový hlas a v `instagram/reel-audio.ts`
 * navíc řídí celou časovou osu reelu) a po videomodelu chceme jen souhyb rtů na naši stopu.
 * Kdyby to fungovalo, spojí se obojí — jistá čeština a mluvící postava.
 *
 * POZOR: tvar API je NEOVĚŘENÝ
 * ----------------------------
 * `instagram/seedance-client.ts` audio referenci nezná — `buildTaskBody` umí jen text a
 * `image_url`. Dokumentace BytePlus je SPA, ze které WebFetch vytáhne jen menu, takže
 * tvar pole se nedá nastudovat, jen vyzkoušet. Proto tenhle script NESAHÁ na produkční
 * `buildTaskBody`: vezme si z něj hotový základ a audio do něj přimíchá LOKÁLNĚ, v několika
 * kandidátních tvarech. Odmítnutí (HTTP 400) je plnohodnotný výsledek a je ZDARMA — úloha
 * nevznikne, takže se nic neúčtuje. Účtuje se až tvar, který projde.
 *
 * Až nějaký tvar projde, patří do `seedance-client.ts` k ostatním polím — ne sem.
 */

import { writeFileSync } from "fs"
import { getModel } from "../instagram/models"
import {
    buildTaskBody, pollVideoTask, downloadVideo, seedanceEnabled, arkBaseUrl,
    type VideoTaskRequest,
} from "../instagram/seedance-client"
import { generateVoiceover } from "../instagram/gemini-client"
import { trimSilence, wavInfo } from "../instagram/reel-audio"
import { costUsdForCall, videoUnitKey } from "../lib/model-pricing"
import { CLIENT_BUCKET_MIME_TYPES, CLIENT_BUCKET_SIZE_LIMIT } from "../lib/storage-buckets"

/** Sdílený bucket se `smoke-reel-voice.ts` — vzorky hlasu patří na jedno místo. */
const BUCKET = "voice-samples"
const NARRATION = "Tříletá záruka, doprava zdarma a vrácení do třiceti dnů. Věříme kvalitě — přesvědčte se sami."

/**
 * Kandidátní tvary audio reference. Pořadí = od nejpravděpodobnějšího: ModelArk staví
 * multimodální vstup jako pole `content` s `type`, takže audio bude nejspíš další
 * položka vedle `image_url`. Top-level varianty jsou záložní domněnka pro případ,
 * že audio není „obsah", ale parametr úlohy.
 */
const CANDIDATES: { name: string; build: (base: Record<string, unknown>, url: string) => Record<string, unknown> }[] = [
    {
        name: "content[] { type: audio_url, role: reference_audio }",
        build: (base, url) => {
            const body = structuredClone(base)
            const content = body.content as Record<string, unknown>[]
            content.push({ type: "audio_url", audio_url: { url }, role: "reference_audio" })
            return body
        },
    },
    {
        name: "content[] { type: input_audio }",
        build: (base, url) => {
            const body = structuredClone(base)
            const content = body.content as Record<string, unknown>[]
            content.push({ type: "input_audio", input_audio: { url, format: "wav" } })
            return body
        },
    },
    {
        name: "top-level audio_url",
        build: (base, url) => ({ ...structuredClone(base), audio_url: url }),
    },
    {
        name: "top-level reference_audio",
        build: (base, url) => ({ ...structuredClone(base), reference_audio: { url, format: "wav" } }),
    },
]

function buildPrompt(): string {
    return [
        "Vertical 9:16 medium close-up of a friendly shop owner in their thirties,",
        "standing in a bright modern store, looking straight into the camera and speaking to the viewer.",
        "Their lip movement must follow the provided reference audio track exactly, word for word.",
        "Warm daylight, shallow depth of field, slow subtle push-in, single continuous shot.",
        "No on-screen text, no captions, no subtitles, no logos, no watermark.",
    ].join(" ")
}

async function submitRaw(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; detail: string; taskId?: string }> {
    const resp = await fetch(`${arkBaseUrl()}/contents/generations/tasks`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.ARK_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
    })
    const text = await resp.text()
    if (!resp.ok) return { ok: false, status: resp.status, detail: text.slice(0, 300) }
    const json = JSON.parse(text) as Record<string, unknown>
    const id = json.id ?? json.task_id ?? (json.data as Record<string, unknown> | undefined)?.id
    return { ok: true, status: resp.status, detail: text.slice(0, 200), taskId: id ? String(id) : undefined }
}

async function main() {
    const dry = process.argv.includes("--dry")

    const req: VideoTaskRequest = {
        model: getModel("video"),
        prompt: buildPrompt(),
        references: [],
        durationSeconds: 8,
        resolution: "480p",
        ratio: "9:16",
        // Nativní zvuk zůstává zapnutý: chceme slyšet, jestli model naši stopu použije,
        // nebo si k obrazu vyrobí vlastní.
        generateAudio: true,
    }
    const base = buildTaskBody(req)
    const estimate = costUsdForCall(videoUnitKey(req.model, req.resolution), {
        promptTokens: 0, outputTokens: 0, thoughtTokens: 0, cachedTokens: 0,
        units: { kind: "seconds", n: req.durationSeconds },
    })

    console.log(`🎬 Model: ${req.model} | endpoint: ${arkBaseUrl()}`)
    console.log(`🧪 Kandidátních tvarů audio reference: ${CANDIDATES.length} | odhad při úspěchu $${estimate ?? "?"}`)

    if (dry) {
        for (const c of CANDIDATES) {
            console.log(`\n──── ${c.name} ────`)
            console.log(JSON.stringify(c.build(base, "https://example.invalid/voiceover.wav"), null, 2))
        }
        console.log("\n🧪 --dry: neodeslalo se nic, nenamluvilo se nic, nic nestálo.")
        return
    }

    if (!seedanceEnabled()) {
        console.error("❌ ARK_API_KEY chybí — živý test nejde spustit")
        process.exit(1)
    }

    console.log("🗣️  Namlouvám voiceover (Gemini TTS)…")
    const wav = trimSilence(await generateVoiceover(NARRATION, { mood: "professional" }))
    const info = wavInfo(wav)
    console.log(`   ✅ ${(wav.length / 1024).toFixed(0)} kB, ${info.durationSeconds.toFixed(2)} s @ ${info.sampleRate} Hz`)

    const { default: supabaseAdmin } = await import("../supabase/admin")
    const created = await supabaseAdmin.storage.createBucket(BUCKET, {
        public: true,
        allowedMimeTypes: CLIENT_BUCKET_MIME_TYPES,
        fileSizeLimit: CLIENT_BUCKET_SIZE_LIMIT,
    })
    // „already exists" je v pořádku — bucket je cíl, ne událost.
    if (created.error && !/exist/i.test(created.error.message)) {
        console.error(`❌ bucket ${BUCKET}: ${created.error.message}`)
        process.exit(1)
    }

    const path = `audio-ref/${Date.now()}.wav`
    const up = await supabaseAdmin.storage.from(BUCKET).upload(path, wav, { contentType: "audio/wav", upsert: true })
    if (up.error) {
        console.error(`❌ upload: ${up.error.message}`)
        process.exit(1)
    }
    const audioUrl = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
    console.log(`   ☁️  ${audioUrl}`)

    for (const c of CANDIDATES) {
        const res = await submitRaw(c.build(base, audioUrl))
        if (!res.ok) {
            console.log(`   ❌ ${c.name} → HTTP ${res.status} ${res.detail}`)
            continue
        }
        console.log(`   ✅ ${c.name} → přijato, úloha ${res.taskId}`)
        if (!res.taskId) {
            console.log("      …ale bez id úlohy, nemám co pollovat")
            break
        }
        const polled = await pollVideoTask(res.taskId, {
            budgetMs: 8 * 60_000,
            onTick: (ms, st) => { console.log(`      ⏳ ${Math.round(ms / 1000)} s — ${st}`) },
        })
        if (polled.status !== "succeeded") {
            console.error("   ❌", polled)
            process.exit(1)
        }
        const buf = await downloadVideo(polled.videoUrl)
        const out = "smoke-seedance-audio-ref.mp4"
        writeFileSync(out, buf)
        console.log(`\n✅ ${out} (${(buf.length / 1024 / 1024).toFixed(1)} MB) — odhad $${estimate ?? "?"}`)
        console.log("👂 Hodnoť: sedí rty na NÁŠ hlas, nebo si model namluvil vlastní?")
        return
    }

    console.log("\n📕 Žádný kandidátní tvar neprošel — Seedance 2.5 přes ModelArk audio referenci nejspíš nebere.")
    console.log("   Zůstává dabing přes Gemini TTS (instagram/reel-audio.ts). Nic se nezaúčtovalo.")
}

main().catch(err => { console.error("❌", err); process.exit(1) })
