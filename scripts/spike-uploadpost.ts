/**
 * FÁZE 0 — STOP/GO sonda pro upload-post.com.
 * ===========================================
 * Ověřuje na FREE tieru (2 profily, 10 uploadů/měsíc), jestli most vůbec unese to,
 * co Chrlit potřebuje. Běží MIMO `npm run guard` — netestuje invariant, testuje
 * cizí API.
 *
 * Dvě branky, na kterých plán stojí nebo padá:
 *   1. CAROUSEL — engine na něm stojí; bez něj je most poloviční.
 *   2. PER-POST ANALYTIKA — bez ní se přetrhne učicí smyčka, což je půlka zadání.
 *
 * Potřebuje `UPLOADPOST_API_KEY` v .env.local a testovací Instagram Business účet.
 *
 * Použití (v tomhle pořadí):
 *   npx tsx scripts/spike-uploadpost.ts connect
 *       → vypíše access_url; otevři ji a připoj testovací IG
 *   npx tsx scripts/spike-uploadpost.ts status
 *   npx tsx scripts/spike-uploadpost.ts image  <url>
 *   npx tsx scripts/spike-uploadpost.ts carousel <url1> <url2> <url3>
 *   npx tsx scripts/spike-uploadpost.ts analytics <request_id>
 *   npx tsx scripts/spike-uploadpost.ts cleanup
 *
 * Použij REÁLNÉ veřejné Supabase URL (tedy .webp) — jestli most poradí s WebP je
 * jedna z věcí, kvůli kterým sonda existuje.
 */

import fs from "fs"

const BASE = "https://api.upload-post.com"
const PROFILE = "chrlit-spike"

function loadEnv(): Record<string, string> {
    try {
        return fs.readFileSync(".env.local", "utf-8").split("\n").reduce((acc, line) => {
            const m = line.match(/^([^=#]+)=(.*)$/)
            if (m) acc[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, "")
            return acc
        }, {} as Record<string, string>)
    } catch {
        return {}
    }
}

const env = loadEnv()
const API_KEY = process.env.UPLOADPOST_API_KEY || env.UPLOADPOST_API_KEY

if (!API_KEY) {
    console.error("❌ Chybí UPLOADPOST_API_KEY (v prostředí nebo .env.local).")
    console.error("   Založ free účet na https://www.upload-post.com a vlož klíč.")
    process.exit(1)
}

async function call(path: string, init: RequestInit = {}): Promise<any> {
    const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: {
            Authorization: `Apikey ${API_KEY}`,
            ...(init.body ? { "Content-Type": "application/json" } : {}),
            ...(init.headers || {}),
        },
    })
    const text = await res.text()
    let json: any = null
    try { json = text ? JSON.parse(text) : {} } catch { /* keep raw */ }

    console.log(`\n── ${init.method || "GET"} ${path} → ${res.status} ──`)
    console.log(json ? JSON.stringify(json, null, 2) : text.slice(0, 2000))

    if (!res.ok) throw new Error(`${res.status}`)
    return json ?? {}
}

async function connect() {
    // Idempotent: an existing profile answers 4xx, which is fine on a re-run.
    try {
        await call("/api/uploadposts/users", { method: "POST", body: JSON.stringify({ username: PROFILE }) })
    } catch {
        console.log("   (profil už nejspíš existuje — pokračuji)")
    }
    const jwt = await call("/api/uploadposts/users/generate-jwt", {
        method: "POST",
        body: JSON.stringify({ username: PROFILE, platforms: ["instagram"] }),
    })
    const url = jwt?.access_url ?? jwt?.accessUrl ?? jwt?.url
    console.log("\n👉 OTEVŘI TUHLE ADRESU A PŘIPOJ TESTOVACÍ INSTAGRAM:\n")
    console.log(`   ${url}\n`)
    console.log("   Pak spusť: npx tsx scripts/spike-uploadpost.ts status")
}

async function status() {
    const json = await call(`/api/uploadposts/users/${encodeURIComponent(PROFILE)}`)
    const accounts = json?.profile?.social_accounts ?? json?.social_accounts ?? json?.user?.social_accounts
    const ig = accounts?.instagram
    console.log(`\n${ig ? "✅" : "❌"} Instagram ${ig ? "PŘIPOJEN" : "nepřipojen"}`)
    console.log("\n📋 BOD 6 — zapiš si, pod jakým klíčem sedí handle účtu (potřebuje ho readInstagram()).")
}

/** BOD 2/3 — obrázek a carousel. Carousel je hlavní branka celé fáze. */
async function publishPhotos(urls: string[]) {
    if (urls.length === 0) {
        console.error("❌ Zadej aspoň jedno URL obrázku.")
        process.exit(1)
    }
    console.log(`\n🚀 Publikuji ${urls.length} ${urls.length > 1 ? "obrázků (CAROUSEL)" : "obrázek"}…`)
    console.log("   URL:", urls.join("\n        "))

    const json = await call("/api/upload_photos", {
        method: "POST",
        body: JSON.stringify({
            user: PROFILE,
            platform: ["instagram"],
            caption: `Chrlit spike ${new Date().toISOString()}`,
            photos: urls,
        }),
    })

    console.log("\n📋 CO SI Z TÉHLE ODPOVĚDI ZAPSAT:")
    console.log("   • BOD 3: vznikl na profilu opravdu CAROUSEL, nebo jen první obrázek?")
    console.log("            → ZKONTROLUJ TO OČIMA NA INSTAGRAMU, ne jen podle odpovědi.")
    console.log("   • BOD 5: prošla vzdálená HTTPS URL (a .webp), nebo chce API upload souboru?")
    console.log("   • BOD 6: je `request_id` v odpovědi hned? A `platform_post_id`/`post_url`?")
    console.log("            → tohle rozhoduje, jestli publish vrací externalId, nebo ho")
    console.log("              musí dobackfillovat metrics-sync.")

    const requestId = json?.request_id ?? json?.requestId ?? json?.id
    if (requestId) {
        console.log(`\n   Za pár hodin spusť: npx tsx scripts/spike-uploadpost.ts analytics ${requestId}`)
    } else {
        console.log("\n   ⚠️ V odpovědi NENÍ request_id — bez něj se nedá číst analytika. Najdi, kde je.")
    }
}

/** BOD 7 — druhá STOP/GO branka: bez per-post metrik se přetrhne učicí smyčka. */
async function analytics(requestId: string) {
    if (!requestId) {
        console.error("❌ Zadej request_id z publikace.")
        process.exit(1)
    }
    const json = await call(`/api/uploadposts/post-analytics/${encodeURIComponent(requestId)}?platform=instagram`)

    const ig = json?.platforms?.instagram ?? json?.instagram ?? json
    const m = ig?.post_metrics ?? ig?.metrics ?? {}
    const want = ["likes", "comments", "reach", "saves", "shares", "views", "impressions"]

    console.log("\n📊 METRIKY, KTERÉ POTŘEBUJE UČICÍ SMYČKA:")
    for (const k of want) {
        const v = (m as any)[k]
        console.log(`   ${v === undefined ? "❌ chybí " : "✅ "}${k}: ${v ?? "—"}`)
    }
    console.log(`\n   platform_post_id: ${ig?.platform_post_id ?? "❌ chybí (nutné pro backfill ig_media_id)"}`)
    console.log(`   post_url:         ${ig?.post_url ?? "—"}`)
    console.log("\n📋 BOD 7: ZAPIŠ, JAK DLOUHO PO PUBLIKACI JSOU ČÍSLA NENULOVÁ.")
    console.log("   Pokud je zpoždění delší než den, denní cron /api/cron/ig-metrics-sync")
    console.log("   trefí prázdno a smyčka se nenakrmí — pak je potřeba druhý sběr po ~72 h.")
}

async function cleanup() {
    await call("/api/uploadposts/users", { method: "DELETE", body: JSON.stringify({ username: PROFILE }) })
    console.log("\n🧹 Profil smazán (uvolňuje slot v plánu).")
}

async function main() {
    const [cmd, ...args] = process.argv.slice(2)
    switch (cmd) {
        case "connect":   return connect()
        case "status":    return status()
        case "image":     return publishPhotos(args.slice(0, 1))
        case "carousel":  return publishPhotos(args)
        case "analytics": return analytics(args[0])
        case "cleanup":   return cleanup()
        default:
            console.log("Použití: npx tsx scripts/spike-uploadpost.ts <connect|status|image|carousel|analytics|cleanup> [args]")
            console.log("Detaily a checklist Fáze 0 najdeš v hlavičce tohohle souboru.")
    }
}

main().catch(err => {
    console.error("\n❌ Sonda selhala:", err?.message || err)
    process.exit(1)
})
