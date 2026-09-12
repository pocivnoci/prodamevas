/**
 * Živý smoke test: 30 hlasů Gemini TTS na stejných větách → bucket `voice-samples`.
 * NENÍ součást `npm run guard`.
 *
 *   npx tsx scripts/smoke-reel-voice.ts --dry              # jen vypíše hlasy a věty, nic nestojí
 *   npx tsx scripts/smoke-reel-voice.ts                    # namluví vzorky a nahraje je do bucketu
 *   npx tsx scripts/smoke-reel-voice.ts --voices=Kore,Puck # jen vybrané hlasy
 *
 * Proč to existuje
 * ----------------
 * `ttsVoice` v `ClientConfig` má default „Kore" (`instagram/gemini-client.ts` i
 * `orchestrators/reel-orchestrator.ts`), takže reely všech značek dnes mluví jedním
 * hlasem — ne proto, že by se vybíral, ale protože vybírat není z čeho. Hlas se nedá
 * zvolit z popisu, jen poslechem, a poslechnout se dá jen to, co existuje.
 *
 * Tenhle script vyrobí srovnávací sadu: stejný text, stejná nálada, jediná proměnná
 * je hlas. Výstup je veřejná URL na každý vzorek — dá se poslat člověku a nechat ho
 * ukázat prstem.
 *
 * Ticho na krajích ořezává `trimSilence` z `instagram/reel-audio.ts` — tedy přesně to,
 * co dělá produkce. Bez toho by se vzorky lišily délkou náběhu TTS, ne hlasem.
 *
 * Jeden hlas navíc nesmí shodit zbylých 29: každé selhání se zapíše a jede se dál.
 * Sazebník je tokenový (`lib/model-pricing.ts`), takže cenu hlásí až skutečné užití.
 */

import { getModel } from "../instagram/models"
import { generateVoiceover } from "../instagram/gemini-client"
import { trimSilence, wavInfo } from "../instagram/reel-audio"
import { withUsageScope, currentUsage } from "../instagram/usage-meter"
import { costUsdForCall } from "../lib/model-pricing"
import { withRetry } from "../utils/retry"
import { CLIENT_BUCKET_MIME_TYPES, CLIENT_BUCKET_SIZE_LIMIT } from "../lib/storage-buckets"

/** Sdílený bucket se `smoke-seedance-audio-ref.ts` — vzorky hlasu patří na jedno místo. */
const BUCKET = "voice-samples"

/**
 * Text je schválně TOTOŽNÝ se `smoke-seedance-dialogue.ts`. Díky tomu jde postavit
 * vedle sebe „jak to řekne Seedance sám" a „jak to řekne každý z našich hlasů" —
 * jinak by se porovnávaly dvě různé věty a nedalo by se z toho nic vyčíst.
 * Fonémy ř/ě/č/ů jsou tam kvůli tomu, že právě na nich anglicky trénované TTS klopýtá.
 */
const NARRATION = "Tříletá záruka, doprava zdarma a vrácení do třiceti dnů. Věříme kvalitě — přesvědčte se sami."

/**
 * Přednastavené hlasy Gemini TTS. Seznam je ručně udržovaný — API ho nevypisuje.
 * Když nějaký zmizí nebo přibude, projeví se to tady jako selhání jednoho řádku,
 * ne jako pád běhu; doplnit ho pak patří sem.
 */
const VOICES = [
    "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda",
    "Orus", "Aoede", "Callirrhoe", "Autonoe", "Enceladus", "Iapetus",
    "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi",
    "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima",
    "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
]

/** Souběh 3 — TTS je náchylné na rate limit a 30 najednou ho spolehlivě trefí. */
const CONCURRENCY = 3

function arg(name: string, fallback: string): string {
    const hit = process.argv.find(a => a.startsWith(`--${name}=`))
    return hit ? hit.slice(name.length + 3) : fallback
}

interface Sample {
    voice: string
    seconds?: number
    url?: string
    error?: string
}

async function main() {
    const dry = process.argv.includes("--dry")
    const only = arg("voices", "")
    const voices = only ? only.split(",").map(v => v.trim()).filter(Boolean) : VOICES

    console.log(`🎙️  Model: ${getModel("tts")} (fallback ${getModel("tts", "fallback")})`)
    console.log(`🗣️  Hlasů: ${voices.length} | bucket: ${BUCKET}`)
    console.log(`📝 Věta: „${NARRATION}"`)

    if (dry) {
        console.log("\n" + voices.join(", "))
        console.log("\n🧪 --dry: nenamluvilo se nic, nic se nenahrálo, nic nestálo.")
        return
    }

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

    const results: Sample[] = []
    const t0 = Date.now()

    const totals = await withUsageScope(async () => {
        let cursor = 0
        const worker = async () => {
            while (cursor < voices.length) {
                const voice = voices[cursor++]
                try {
                    const wav = trimSilence(await withRetry(
                        () => generateVoiceover(NARRATION, { voice, mood: "professional" }),
                        2, `tts:${voice}`,
                    ))
                    const info = wavInfo(wav)
                    const up = await supabaseAdmin.storage.from(BUCKET).upload(`${voice}.wav`, wav, {
                        contentType: "audio/wav", upsert: true,
                    })
                    if (up.error) throw new Error(up.error.message)
                    const url = supabaseAdmin.storage.from(BUCKET).getPublicUrl(`${voice}.wav`).data.publicUrl
                    results.push({ voice, seconds: info.durationSeconds, url })
                    console.log(`   ✅ ${voice.padEnd(14)} ${info.durationSeconds.toFixed(2)} s`)
                } catch (err) {
                    const error = String((err as Error)?.message || err).slice(0, 160)
                    results.push({ voice, error })
                    console.log(`   ❌ ${voice.padEnd(14)} ${error}`)
                }
            }
        }
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, voices.length) }, worker))
        return currentUsage()
    })

    const ok = results.filter(r => r.url)
    const failed = results.filter(r => r.error)
    const cost = (totals?.breakdown ?? []).reduce((sum, call) => sum + (costUsdForCall(call.model, call) ?? 0), 0)

    console.log(`\n✅ Hotovo: ${ok.length}/${voices.length} vzorků za ${Math.round((Date.now() - t0) / 1000)} s — $${cost.toFixed(4)}`)
    if (failed.length) console.log(`⚠️  Neprošlo: ${failed.map(f => f.voice).join(", ")}`)

    console.log("\n🔗 Vzorky:")
    for (const s of ok.sort((a, b) => a.voice.localeCompare(b.voice))) {
        console.log(`   ${s.voice.padEnd(14)} ${s.url}`)
    }
    console.log("\n👂 Vyber hlas a zapiš ho značce do `config.ttsVoice` (Nastavení → reely).")
}

main().catch(err => { console.error("❌", err); process.exit(1) })
