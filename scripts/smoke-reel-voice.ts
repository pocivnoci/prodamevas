/**
 * SPIKE — poslech všech hlasů knihovny na stejném textu.
 * ======================================================
 * Živý experiment, NENÍ v `npm run guard`. Namluví tytéž tři české věty každým
 * hlasem, nahraje je do bucketu `voice-samples/` a vypíše tabulku URL + naměřených
 * délek. Slouží k tomu, aby casting v `lib/voice-library.ts` (temperament, tempo,
 * „hodí se pro") stál na POSLECHU, ne na anglických štítcích z dokumentace.
 *
 *   npx tsx scripts/smoke-reel-voice.ts                 # všech 30 hlasů (~30 volání TTS)
 *   npx tsx scripts/smoke-reel-voice.ts --voice=Sulafat,Kore
 *   npx tsx scripts/smoke-reel-voice.ts --force         # přegeneruje i to, co v bucketu je
 *
 * Seznam hlasů je tu SCHVÁLNĚ zkopírovaný a ne naimportovaný z `lib/voice-library.ts`:
 * spike skripty nesmí záviset na produkčním kódu (hlídá to aserce v `npm run guard`),
 * aby experiment nemohl potichu změnit to, co měří. Když do knihovny přibude hlas,
 * dopiš ho sem.
 */

import { GoogleGenAI } from "@google/genai"
import { createClient } from "@supabase/supabase-js"
import dotenv from "dotenv"

dotenv.config({ path: ".env.local" })

const BUCKET = process.env.SPIKE_BUCKET || "voice-samples"
const TTS_MODEL = process.env.SPIKE_TTS_MODEL || "gemini-3.1-flash-tts-preview"

const SENTENCES = [
    "Dobrý den, vítejte u nás v kavárně.",
    "Kávu pražíme sami, každé pondělí čerstvou.",
    "Přijďte ochutnat, těšíme se na vás.",
]

const VOICES = [
    "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe",
    "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi",
    "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird",
    "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
]

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

/** Délka z hlavičky — stejný princip jako `wavInfo()`, jen bez chunk walkeru. */
function seconds(buf: Buffer): number {
    const rate = buf.readUInt32LE(24)
    const byteRate = buf.readUInt32LE(28) || rate * 2
    return Math.round((buf.readUInt32LE(40) / byteRate) * 100) / 100
}

async function main() {
    const only = (process.argv.find(a => a.startsWith("--voice="))?.split("=")[1] || "")
        .split(",").map(s => s.trim()).filter(Boolean)
    const force = process.argv.includes("--force")
    const voices = only.length ? VOICES.filter(v => only.includes(v)) : VOICES
    if (voices.length === 0) { console.error(`❌ Žádný ze zadaných hlasů neznám: ${only.join(", ")}`); process.exit(1) }

    const apiKey = process.env.GEMINI_API_KEY
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!apiKey || !url || !key) { console.error("❌ Chybí GEMINI_API_KEY / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1) }

    const ai = new GoogleGenAI({ apiKey })
    const supabase = createClient(url, key)
    await supabase.storage.createBucket(BUCKET, { public: true, allowedMimeTypes: ["audio/wav"], fileSizeLimit: 5 * 1024 * 1024 })

    const rows: { voice: string; seconds: number; url: string }[] = []
    for (const voice of voices) {
        const path = `spike-${voice}.wav`
        try {
            if (!force) {
                const { data } = await supabase.storage.from(BUCKET).list("", { search: path })
                if (data?.some(f => f.name === path)) {
                    const dl = await supabase.storage.from(BUCKET).download(path)
                    const buf = Buffer.from(await dl.data!.arrayBuffer())
                    rows.push({ voice, seconds: seconds(buf), url: supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl })
                    console.log(`   ↺ ${voice} — už v bucketu`)
                    continue
                }
            }
            const res: any = await ai.models.generateContent({
                model: TTS_MODEL,
                contents: SENTENCES.join(" "),
                config: {
                    responseModalities: ["AUDIO"],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
                } as any,
            })
            const inline = res?.candidates?.[0]?.content?.parts?.[0]?.inlineData
            if (!inline?.data) throw new Error("TTS nevrátilo audio")
            const raw = Buffer.from(inline.data, "base64")
            const buf = raw.subarray(0, 4).toString("latin1") === "RIFF" ? raw : wav(raw)
            const { error } = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: "audio/wav", upsert: true })
            if (error) throw error
            rows.push({ voice, seconds: seconds(buf), url: supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl })
            console.log(`   ✅ ${voice} — ${seconds(buf)} s`)
        } catch (err) {
            console.log(`   ❌ ${voice} — ${(err as Error).message?.slice(0, 120)}`)
        }
    }

    console.log(`\n📊 ${rows.length}/${voices.length} hlasů, stejný text (${SENTENCES.join(" ").split(/\s+/).length} slov)\n`)
    console.log("HLAS".padEnd(16) + "DÉLKA".padEnd(9) + "URL")
    for (const r of rows.sort((a, b) => a.seconds - b.seconds)) {
        console.log(r.voice.padEnd(16) + `${r.seconds} s`.padEnd(9) + r.url)
    }
    console.log("\nTempo řeči = slova / délka; rozdíl mezi nejrychlejším a nejpomalejším hlasem")
    console.log("je rozpočet slov reelu (viz lib/reel-media.ts), ne kosmetika.")
}

main().catch(err => { console.error("❌", err); process.exit(1) })
