/**
 * SPIKE — mluví Seedance 2.5 česky?
 * =================================
 * Živý experiment, NENÍ součást `npm run guard` a **nesmí** se z něj nic importovat
 * do produkce (a on neimportuje nic z ní — schválně: spike má ověřit API, ne naši
 * pipeline; kdyby sdílel `seedance-client.ts`, testoval by naše zákazy řeči).
 *
 *   npx tsx scripts/smoke-seedance-dialogue.ts --dry        # jen vypíše tělo požadavku
 *   npx tsx scripts/smoke-seedance-dialogue.ts              # česky (~0,80 USD za 8 s)
 *   npx tsx scripts/smoke-seedance-dialogue.ts --lang=en    # totéž anglicky pro srovnání
 *
 * Z cloudové session Claude Code: klíč je jako „API credential" prostředí a proxy ho
 * připojí sama — v env je jen `ARK_API_KEY=proxy` a skript pak žádnou Authorization
 * hlavičku neposílá (dvě by se přetahovaly). Stažení videa jde z jiného hostu než API;
 * když ho síť nepustí, skript vypíše URL a skončí — video si stáhnete ručně.
 *
 * Otázka, na kterou odpovídá: Seedance 2.5 umí podle veřejných zdrojů nativní dialog
 * s lip-syncem (EN, ZH, JA, KO, ES, FR, DE, PT — čeština v seznamu NENÍ). Náš
 * produkční prompt řeč výslovně zakazuje, takže to nikdo nikdy nezkusil. Tenhle
 * skript pošle tři české věty jako repliky v uvozovkách, `generate_audio: true`,
 * 8 s / 480p — a uloží MP4 k poslechu.
 *
 * Co hodnotit, je v `docs/DESIGN_reels-v2_2026-09-12.md`, sekce „Hlas".
 */

import { writeFileSync, mkdirSync } from "fs"
import dotenv from "dotenv"

dotenv.config({ path: ".env.local" })

const OUT_DIR = "audit-screenshots/spike"
const BASE_URL = (process.env.ARK_BASE_URL || "https://ark.ap-southeast.bytepluses.com/api/v3").replace(/\/+$/, "")
// Stejné verzované ID jako produkce (instagram/models.ts `video`); spike nesmí importovat produkční modul.
const MODEL = process.env.ARK_MODEL || "dreamina-seedance-2-5-260628"

const CS = [
    "Dobrý den, vítejte u nás v kavárně.",
    "Kávu pražíme sami, každé pondělí čerstvou.",
    "Přijďte ochutnat, těšíme se na vás.",
]
const EN = [
    "Good morning, welcome to our coffee shop.",
    "We roast every batch ourselves, fresh each Monday.",
    "Come and taste it, we are looking forward to seeing you.",
]

function buildPrompt(lang: "cs" | "en"): string {
    const lines = lang === "cs" ? CS : EN
    // Žádný zákaz řeči (na rozdíl od `finalizeVideoPrompt`) — právě ten se testuje.
    // Repliky v uvozovkách + explicitní „speaks Czech", protože čeština není
    // v dokumentovaném seznamu jazyků a musí se vyžádat.
    const langName = lang === "cs" ? "Czech" : "English"
    return [
        `Vertical 9:16 shot inside a small specialty coffee shop, warm morning light.`,
        `A friendly barista (early 30s) looks straight into the camera and SPEAKS ${langName.toUpperCase()} with natural lip-sync.`,
        `Dialogue (${langName}, spoken exactly as written):`,
        ...lines.map(l => `"${l}"`),
        `Natural room tone, espresso machine in the background. No on-screen text, no subtitles.`,
    ].join("\n")
}

/**
 * `ARK_API_KEY=proxy` = klíč připojuje agent proxy cloudového prostředí (API credential);
 * vlastní hlavičku pak NEPOSÍLAT, jinak by se s tou od proxy přetahovala.
 */
function arkHeaders(key: string): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" }
    if (key !== "proxy") h.Authorization = `Bearer ${key}`
    return h
}

/** Výsledné video leží na jiném hostu než API; zavřená síť ho nemusí pustit. */
async function downloadVideo(url: string): Promise<Buffer | null> {
    try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return Buffer.from(await res.arrayBuffer())
    } catch (err) {
        console.error(`⚠️ Video se nepodařilo stáhnout (${(err as Error).message}). Otevři URL výše v prohlížeči — úloha proběhla, jen síť tady nepustí host s výsledkem.`)
        return null
    }
}

async function main() {
    const dry = process.argv.includes("--dry")
    const lang = (process.argv.find(a => a.startsWith("--lang="))?.split("=")[1] === "en" ? "en" : "cs") as "cs" | "en"

    const body: Record<string, unknown> = {
        model: MODEL,
        content: [{ type: "text", text: buildPrompt(lang) }],
        ratio: "9:16",
        duration: 8,
        resolution: "480p",
        generate_audio: true,
        watermark: false,
    }

    console.log(`🎬 ${MODEL} @ ${BASE_URL} — jazyk ${lang}`)
    console.log("📦 Tělo požadavku:\n" + JSON.stringify(body, null, 2))
    if (dry) return

    const key = process.env.ARK_API_KEY
    if (!key) { console.error("❌ ARK_API_KEY chybí"); process.exit(1) }
    const headers = arkHeaders(key)

    const submit = await fetch(`${BASE_URL}/contents/generations/tasks`, { method: "POST", headers, body: JSON.stringify(body) })
    const submitText = await submit.text()
    console.log(`\n📨 Odpověď na zadání (${submit.status}):\n${submitText}\n`)
    if (!submit.ok) process.exit(1)

    const taskId = JSON.parse(submitText)?.id
    if (!taskId) { console.error("❌ Odpověď neobsahuje id úlohy"); process.exit(1) }

    let videoUrl = ""
    const startedAt = Date.now()
    while (Date.now() - startedAt < 10 * 60_000) {
        await new Promise(r => setTimeout(r, 10_000))
        const res = await fetch(`${BASE_URL}/contents/generations/tasks/${taskId}`, { headers })
        const text = await res.text()
        const json = JSON.parse(text)
        const status = json?.status
        console.log(`   ⏳ ${Math.round((Date.now() - startedAt) / 1000)} s — ${status}`)
        if (status === "succeeded") { console.log(`\n📄 Surová odpověď:\n${text}\n`); videoUrl = json?.content?.video_url || json?.video_url; break }
        if (status === "failed" || status === "cancelled") { console.error(`❌ ${text}`); process.exit(1) }
    }
    if (!videoUrl) { console.error("❌ Úloha nedoběhla v rozpočtu"); process.exit(1) }

    console.log(`🔗 URL videa: ${videoUrl}`)
    const mp4 = await downloadVideo(videoUrl)
    if (!mp4) return
    mkdirSync(OUT_DIR, { recursive: true })
    const out = `${OUT_DIR}/seedance-dialogue-${lang}-${Date.now()}.mp4`
    writeFileSync(out, mp4)
    console.log(`✅ ${out} (${(mp4.length / 1024 / 1024).toFixed(1)} MB) — poslechni si, jestli je to čeština a jestli sedí rty`)
}

main().catch(err => { console.error("❌", err); process.exit(1) })
