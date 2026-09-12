/**
 * SPIKE — poslech hlasů ElevenLabs na stejném českém textu.
 * ========================================================
 * Živý experiment, NENÍ v `npm run guard` a nic z produkce neimportuje (hlídá to
 * aserce 17.12 v test-beta-e2e.ts). Stejné tři věty jako `smoke-reel-voice.ts`
 * (Gemini), aby šlo poslouchat vedle sebe, a stejný výstupní formát (`pcm_24000`),
 * jaký posílá produkční poskytovatel `instagram/tts/elevenlabs.ts`.
 *
 *   npx tsx scripts/smoke-elevenlabs-voice.ts                       # premade hlasy účtu × eleven_v3
 *   npx tsx scripts/smoke-elevenlabs-voice.ts --model=eleven_v3,eleven_multilingual_v2
 *   npx tsx scripts/smoke-elevenlabs-voice.ts --voice=Sarah,George   # jen vybrané (jméno nebo voice_id)
 *   npx tsx scripts/smoke-elevenlabs-voice.ts --shared               # + ukázky komunitních hlasů s jazykem „cs"
 *   npx tsx scripts/smoke-elevenlabs-voice.ts --force                # přegeneruje i to, co je na disku
 *
 * Klíč: `ELEVENLABS_API_KEY` v .env.local — skutečný klíč začíná `sk_` (ID klíče
 * z přehledu API odmítá: „API key ID used as API key"). Výstup:
 * audit-screenshots/spike/elevenlabs/<model>/<Jméno>.wav; ukázky komunity
 * audit-screenshots/spike/elevenlabs/shared-cs/*.mp3 (jen stažené, do účtu se nic
 * nepřidává — hlas vybírá člověk po poslechu). Co hodnotit:
 * docs/DESIGN_reels-v2_2026-09-12.md, sekce „Hlas".
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs"
import dotenv from "dotenv"

dotenv.config({ path: ".env.local" })

const OUT_DIR = "audit-screenshots/spike/elevenlabs"
const BASE_URL = (process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io").replace(/\/+$/, "")
const OUTPUT_FORMAT = "pcm_24000"
const RATE = 24_000

const SENTENCES = [
    "Dobrý den, vítejte u nás v kavárně.",
    "Kávu pražíme sami, každé pondělí čerstvou.",
    "Přijďte ochutnat, těšíme se na vás.",
]
const TEXT = SENTENCES.join(" ")
const WORDS = TEXT.split(/\s+/).length

/** PCM → WAV; spike si hlavičku lepí sám, aby nesahal do produkce. */
function wav(pcm: Buffer, rate = RATE, channels = 1, bits = 16): Buffer {
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

function flag(name: string): string[] {
    return (process.argv.find(a => a.startsWith(`--${name}=`))?.split("=")[1] || "")
        .split(",").map(s => s.trim()).filter(Boolean)
}

let KEY = ""
async function el(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(`${BASE_URL}${path}`, { ...init, headers: { "xi-api-key": KEY, ...(init.headers as Record<string, string> || {}) } })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${path.split("?")[0]}: ${(await res.text()).replace(/\s+/g, " ").slice(0, 300)}`)
    return res
}

type Voice = { voice_id: string; name: string; category?: string; labels?: Record<string, string>; preview_url?: string }
type Subscription = { tier?: string; status?: string; character_count?: number; character_limit?: number; voice_slots_used?: number; voice_limit?: number }
type Model = { model_id: string; languages?: { language_id: string }[] }
type SharedVoice = { voice_id: string; name?: string; gender?: string; age?: string; accent?: string; use_case?: string; preview_url?: string }

async function main() {
    KEY = process.env.ELEVENLABS_API_KEY || ""
    if (!KEY) { console.error("❌ ELEVENLABS_API_KEY chybí (skutečný klíč začíná sk_)"); process.exit(1) }
    if (!KEY.startsWith("sk_")) console.warn("⚠️ ELEVENLABS_API_KEY nezačíná sk_ — API ho nejspíš odmítne (ID klíče není klíč)")

    const models = flag("model").length ? flag("model") : ["eleven_v3"]
    const only = flag("voice").map(s => s.toLowerCase())
    const force = process.argv.includes("--force")
    const shared = process.argv.includes("--shared")

    // 1) Účet: tarif a zbylé znaky — ať je vidět, kolik poslech stojí.
    try {
        const sub = await (await el("/v1/user/subscription")).json() as Subscription
        console.log(`👤 Tarif ${sub.tier ?? "?"} (${sub.status ?? "?"}) — znaků ${sub.character_count ?? "?"}/${sub.character_limit ?? "?"}, hlasů ${sub.voice_slots_used ?? "?"}/${sub.voice_limit ?? "?"}`)
    } catch (err) { console.warn(`⚠️ Předplatné nejde přečíst: ${(err as Error).message}`) }

    // 2) Modely: umí požadované modely česky? (Dokumentace říká ano u v3 i Multilingual v2.)
    try {
        const all = await (await el("/v1/models")).json() as Model[]
        for (const m of models) {
            const found = all.find(x => x.model_id === m)
            const cs = found?.languages?.some(l => l.language_id === "cs")
            console.log(`🧠 ${m}: ${found ? (cs ? "čeština ✅" : "čeština ❌ — není v seznamu jazyků modelu") : "model v seznamu účtu NENÍ"}`)
        }
    } catch (err) { console.warn(`⚠️ Seznam modelů nejde přečíst: ${(err as Error).message}`) }

    // 3) Hlasy účtu — bez filtru jen „premade" (to, co má každý účet), jinak podle jména/ID.
    const { voices } = await (await el("/v1/voices")).json() as { voices: Voice[] }
    const pick = only.length
        ? voices.filter(v => only.includes(v.name.toLowerCase()) || only.includes(v.voice_id.toLowerCase()))
        : voices.filter(v => (v.category || "premade") === "premade")
    if (pick.length === 0) {
        console.error(`❌ Žádný hlas neodpovídá. V účtu: ${voices.map(v => `${v.name} (${v.category || "?"})`).join(", ")}`)
        process.exit(1)
    }
    console.log(`🎙️ ${pick.length} hlasů × ${models.length} model(ů), text ${TEXT.length} znaků / ${WORDS} slov\n`)

    const rows: { model: string; voice: string; gender: string; seconds: number; file: string }[] = []
    for (const model of models) {
        mkdirSync(`${OUT_DIR}/${model}`, { recursive: true })
        for (const v of pick) {
            const file = `${OUT_DIR}/${model}/${v.name.replace(/[^\w-]+/g, "_")}.wav`
            const gender = v.labels?.gender || "-"
            try {
                if (!force && existsSync(file)) {
                    rows.push({ model, voice: v.name, gender, seconds: seconds(readFileSync(file)), file })
                    console.log(`   ↺ ${model} · ${v.name} — už na disku`)
                    continue
                }
                // Stejné tělo jako produkční poskytovatel: text + model, žádné voice_settings
                // (v3 bere stability jen 0 / 0,5 / 1 — default je „natural"), žádný language_code.
                const res = await el(`/v1/text-to-speech/${v.voice_id}?output_format=${OUTPUT_FORMAT}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ text: TEXT, model_id: model }),
                })
                const buf = wav(Buffer.from(await res.arrayBuffer()))
                writeFileSync(file, buf)
                rows.push({ model, voice: v.name, gender, seconds: seconds(buf), file })
                console.log(`   ✅ ${model} · ${v.name} (${gender}) — ${seconds(buf)} s`)
            } catch (err) {
                console.log(`   ❌ ${model} · ${v.name} — ${(err as Error).message.slice(0, 160)}`)
            }
        }
    }

    console.log(`\n📊 ${rows.length} ukázek, stejný text (${WORDS} slov)\n`)
    console.log("MODEL".padEnd(24) + "HLAS".padEnd(14) + "POHL.".padEnd(8) + "DÉLKA".padEnd(9) + "SLOV/S".padEnd(8) + "SOUBOR")
    for (const r of rows.sort((a, b) => a.model.localeCompare(b.model) || a.seconds - b.seconds)) {
        console.log(r.model.padEnd(24) + r.voice.padEnd(14) + r.gender.padEnd(8) + `${r.seconds} s`.padEnd(9) + (WORDS / r.seconds).toFixed(2).padEnd(8) + r.file)
    }
    console.log("\nTempo řeči = slova / délka; srovnej s Gemini (audit-screenshots/spike/voices/, ~2,0 slova/s).")

    // 4) Komunitní hlasy označené „cs" — rodilí mluvčí. Jen tabulka + stažené ukázky;
    //    přidání do účtu (POST /v1/voices/add/{public_owner_id}/{voice_id}) je rozhodnutí člověka.
    if (shared) {
        mkdirSync(`${OUT_DIR}/shared-cs`, { recursive: true })
        const data = await (await el("/v1/shared-voices?language=cs&page_size=30")).json() as { voices?: SharedVoice[] }
        const found = data?.voices || []
        console.log(`\n🌍 Komunitní hlasy s jazykem cs: ${found.length}\n`)
        console.log("JMÉNO".padEnd(22) + "POHL.".padEnd(8) + "VĚK".padEnd(13) + "PŮVOD".padEnd(12) + "POUŽITÍ".padEnd(18) + "VOICE_ID".padEnd(22) + "UKÁZKA")
        for (const s of found) {
            const name = String(s.name || s.voice_id).replace(/[^\w-]+/g, "_")
            const file = `${OUT_DIR}/shared-cs/${name}__${s.voice_id}.mp3`
            try {
                if (s.preview_url && (force || !existsSync(file))) {
                    const r = await fetch(s.preview_url)
                    if (r.ok) writeFileSync(file, Buffer.from(await r.arrayBuffer()))
                }
            } catch { /* ukázka je bonus, tabulka má smysl i bez ní */ }
            console.log(String(s.name || "").slice(0, 21).padEnd(22) + String(s.gender || "-").padEnd(8) + String(s.age || "-").padEnd(13) + String(s.accent || "-").slice(0, 11).padEnd(12) + String(s.use_case || "-").slice(0, 17).padEnd(18) + String(s.voice_id).padEnd(22) + (existsSync(file) ? file : "(bez ukázky)"))
        }
    }
}

main().catch(err => { console.error("❌", err); process.exit(1) })
