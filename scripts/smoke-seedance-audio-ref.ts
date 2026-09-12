/**
 * SPIKE — bere Seedance 2.5 náš hlas jako audio referenci?
 * ========================================================
 * Živý experiment, NENÍ v `npm run guard` a nic z produkce neimportuje.
 *
 *   npx tsx scripts/smoke-seedance-audio-ref.ts --dry   # jen vypíše tělo požadavku
 *   npx tsx scripts/smoke-seedance-audio-ref.ts         # namluví větu, nahraje ji a pošle úlohu
 *
 * Postup: Gemini TTS namluví jednu českou větu → WAV se nahraje do veřejného
 * bucketu (URL musí být dosažitelná zvenku) → ModelArk dostane úlohu, jejíž
 * `content` nese kromě textu i položku s tou nahrávkou, a prompt odkazuje na
 * „[Audio1]" kvůli lip-syncu.
 *
 * ⚠️ Tvar toho pole je NEJISTÝ: oficiální docs (docs.byteplus.com) jsou z našeho
 * prostředí blokované, takže výchozí `{ type: "audio_url", audio_url: { url } }`
 * je odhad podle tvaru obrázkové reference. Přepni ho bez editace kódu:
 *   ARK_AUDIO_TYPE=audio    npx tsx scripts/smoke-seedance-audio-ref.ts
 * Při 4xx se vypisuje CELÉ tělo chyby — právě v něm bývá seznam očekávaných polí,
 * podle kterého se správný tvar dohledá.
 *
 * Nic z tohohle skriptu nepatří do produkční cesty, dokud poslech nepotvrdí, že
 * to k něčemu je (kritéria v `docs/DESIGN_reels-v2_2026-09-12.md`, sekce „Hlas").
 */

import { writeFileSync, mkdirSync } from "fs"
import { GoogleGenAI } from "@google/genai"
import { createClient } from "@supabase/supabase-js"
import dotenv from "dotenv"

dotenv.config({ path: ".env.local" })

const OUT_DIR = "audit-screenshots/spike"
const BUCKET = process.env.SPIKE_BUCKET || "voice-samples"
const BASE_URL = (process.env.ARK_BASE_URL || "https://ark.ap-southeast.bytepluses.com/api/v3").replace(/\/+$/, "")
const MODEL = process.env.ARK_MODEL || "seedance-2-5-pro"
const TTS_MODEL = process.env.SPIKE_TTS_MODEL || "gemini-3.1-flash-tts-preview"
const VOICE = process.env.SPIKE_VOICE || "Sulafat"
const SENTENCE = "Kávu pražíme sami, každé pondělí čerstvou. Přijďte ochutnat."

/** PCM z Gemini TTS do WAV — spike si hlavičku lepí sám, aby nesahal do produkce. */
function wav(pcm: Buffer, rate = 24_000, channels = 1, bits = 16): Buffer {
    const blockAlign = (channels * bits) / 8
    const h = Buffer.alloc(44)
    h.write("RIFF", 0, "latin1"); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8, "latin1")
    h.write("fmt ", 12, "latin1"); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20)
    h.writeUInt16LE(channels, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * blockAlign, 28)
    h.writeUInt16LE(blockAlign, 32); h.writeUInt16LE(bits, 34)
    h.write("data", 36, "latin1"); h.writeUInt32LE(pcm.length, 40)
    return Buffer.concat([h, pcm])
}

async function synthesize(): Promise<Buffer> {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error("GEMINI_API_KEY chybí")
    const ai = new GoogleGenAI({ apiKey })
    const res: any = await ai.models.generateContent({
        model: TTS_MODEL,
        contents: SENTENCE,
        config: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
        } as any,
    })
    const inline = res?.candidates?.[0]?.content?.parts?.[0]?.inlineData
    if (!inline?.data) throw new Error("TTS nevrátilo audio")
    const raw = Buffer.from(inline.data, "base64")
    return raw.subarray(0, 4).toString("latin1") === "RIFF" ? raw : wav(raw)
}

async function upload(buf: Buffer): Promise<string> {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY chybí")
    const supabase = createClient(url, key)
    await supabase.storage.createBucket(BUCKET, { public: true, allowedMimeTypes: ["audio/wav"], fileSizeLimit: 5 * 1024 * 1024 })
    const path = `spike-audioref-${VOICE}.wav`
    const { error } = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: "audio/wav", upsert: true })
    if (error) throw error
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

async function main() {
    const dry = process.argv.includes("--dry")
    const audioType = process.env.ARK_AUDIO_TYPE ?? "audio_url"

    const audioUrl = dry ? "https://example.invalid/spike.wav" : await upload(await synthesize())
    if (!dry) console.log(`🎙️ Hlas nahraný: ${audioUrl}`)

    const prompt = [
        "Vertical 9:16 shot inside a small specialty coffee shop, warm morning light.",
        "A friendly barista looks into the camera and speaks.",
        "[Audio1] lip-sync: the person's mouth must match the provided Czech voice track exactly.",
        "Natural room tone. No on-screen text.",
    ].join("\n")

    const body: Record<string, unknown> = {
        model: MODEL,
        content: [
            { type: "text", text: prompt },
            { type: audioType, [audioType]: { url: audioUrl } },
        ],
        ratio: "9:16",
        duration: 8,
        resolution: "480p",
        generate_audio: true,
        watermark: false,
    }

    console.log(`🎬 ${MODEL} @ ${BASE_URL} — audio položka typu „${audioType}"`)
    console.log("📦 Tělo požadavku:\n" + JSON.stringify(body, null, 2))
    if (dry) return

    const key = process.env.ARK_API_KEY
    if (!key) { console.error("❌ ARK_API_KEY chybí"); process.exit(1) }
    const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }

    const submit = await fetch(`${BASE_URL}/contents/generations/tasks`, { method: "POST", headers, body: JSON.stringify(body) })
    const submitText = await submit.text()
    // CELÉ tělo, i u chyby: hledáme v něm, jak se pole doopravdy jmenuje.
    console.log(`\n📨 Odpověď na zadání (${submit.status}):\n${submitText}\n`)
    if (!submit.ok) {
        console.error("❌ ModelArk audio referenci v tomhle tvaru nebere. Zkus jiný přes ARK_AUDIO_TYPE (audio, audio_url, input_audio…).")
        process.exit(1)
    }

    const taskId = JSON.parse(submitText)?.id
    let videoUrl = ""
    const startedAt = Date.now()
    while (taskId && Date.now() - startedAt < 10 * 60_000) {
        await new Promise(r => setTimeout(r, 10_000))
        const res = await fetch(`${BASE_URL}/contents/generations/tasks/${taskId}`, { headers })
        const text = await res.text()
        const json = JSON.parse(text)
        console.log(`   ⏳ ${Math.round((Date.now() - startedAt) / 1000)} s — ${json?.status}`)
        if (json?.status === "succeeded") { console.log(`\n📄 Surová odpověď:\n${text}\n`); videoUrl = json?.content?.video_url || json?.video_url; break }
        if (json?.status === "failed" || json?.status === "cancelled") { console.error(`❌ ${text}`); process.exit(1) }
    }
    if (!videoUrl) { console.error("❌ Úloha nedoběhla v rozpočtu"); process.exit(1) }

    const mp4 = Buffer.from(await (await fetch(videoUrl)).arrayBuffer())
    mkdirSync(OUT_DIR, { recursive: true })
    const out = `${OUT_DIR}/seedance-audioref-${Date.now()}.mp4`
    writeFileSync(out, mp4)
    console.log(`✅ ${out} (${(mp4.length / 1024 / 1024).toFixed(1)} MB) — sleduj, jestli je slyšet NÁŠ hlas a jestli sedí rty`)
}

main().catch(err => { console.error("❌", err); process.exit(1) })
