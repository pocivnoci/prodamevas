/**
 * Doplní `industry` a `city` do configu stávajících klientů.
 *
 *   npx tsx scripts/backfill-industry-city.ts               # read-only report
 *   npx tsx scripts/backfill-industry-city.ts --fix         # zapíše
 *   npx tsx scripts/backfill-industry-city.ts --fix --slug=x
 *
 * PROČ
 * ────
 * Obě pole existují v `ClientConfig` od začátku a čtou je `context-agent.ts` (svátky,
 * sezóna, oborový puls) a `signals/weather.ts`. Jenže je NIKDY NIKDO NEZAPISOVAL —
 * onboarding měl `analysis.industry` jen jako řetězec ve svých promptech a do configu
 * ho nepropsal. Důsledek: kontextový agent běžel u všech tenantů na `"business"`
 * a počasí vždycky na Prahu.
 *
 * Onboarding je opravený (core.ts + actions.ts), tohle dorovná už existující klienty.
 * Obor se odvozuje z toho, co v configu je; město jen když ho jde doložit z webu —
 * radši prázdné než vymyšlené, protože špatné město = špatné počasí v promptu.
 */

import supabaseAdmin from "../supabase/admin"
import { invalidateConfigCache } from "../instagram/configs"
import { generateText } from "../instagram/gemini-client"
import type { ClientConfig } from "../instagram/configs/types"

const FIX = process.argv.includes("--fix")
const ONLY_SLUG = process.argv.find(a => a.startsWith("--slug="))?.split("=")[1]

async function derive(config: ClientConfig): Promise<{ industry?: string; city?: string }> {
    const products = (config.products || []).map(p => p.name).filter(Boolean).slice(0, 6).join(", ")
    const prompt = `Urči obor a město firmy. Vrať POUZE JSON.

Firma: ${config.name}
Web: ${config.website}
O čem značka je: ${config.contentFocus}
${products ? `Produkty/služby: ${products}` : ""}
${Object.values(config.contentPillars || {}).map(p => p.description).filter(Boolean).slice(0, 4).join(" | ")}

{
  "industry": "obor 2-4 slovy, česky (např. 'Květinářství', 'Stěhovací služby', 'E-commerce — rybářské potřeby')",
  "city": "město, kde firma sídlí — POUZE když ho jde z uvedených informací doložit. Jinak prázdný řetězec. NEHÁDEJ podle názvu ani domény."
}`
    // Model sem tam přilepí za JSON další závorku nebo vrátí fenced blok. Greedy
    // `\{[\s\S]*\}` by ten přívěsek sebral, proto bereme první VYVÁŽENÝ objekt.
    // Dvakrát zkoušíme (stejný vzor jako generateCustomFormats a suggestPostFormat) —
    // rozbitá odpověď bývá transientní. Selhání je vždycky hlasité, nikdy tiché {}.
    for (let attempt = 1; attempt <= 2; attempt++) {
        const raw = await generateText(prompt, { temperature: 0.2 })
        const clean = raw.replace(/```json/gi, "").replace(/```/g, "").trim()
        const start = clean.indexOf("{")
        let json: string | null = null
        if (start >= 0) {
            let depth = 0
            for (let i = start; i < clean.length; i++) {
                if (clean[i] === "{") depth++
                else if (clean[i] === "}" && --depth === 0) { json = clean.slice(start, i + 1); break }
            }
        }
        try {
            if (!json) throw new Error("v odpovědi není vyvážený JSON objekt")
            const parsed = JSON.parse(json)
            return {
                industry: String(parsed.industry || "").trim().slice(0, 80) || undefined,
                city: String(parsed.city || "").trim().slice(0, 60) || undefined,
            }
        } catch (e) {
            console.warn(`   ⚠️ odvození (pokus ${attempt}/2): ${(e as Error).message} — "${clean.slice(0, 90)}…"`)
        }
    }
    return {}
}

async function main(): Promise<void> {
    let query = supabaseAdmin.from("clients").select("id, slug, config").order("slug")
    if (ONLY_SLUG) query = query.eq("slug", ONLY_SLUG)
    const { data: clients, error } = await query
    if (error) { console.error("❌", error.message); process.exit(1) }

    console.log(`\n${"═".repeat(62)}`)
    console.log(`  BACKFILL industry + city   ${FIX ? "(--fix: ZAPISUJE)" : "(read-only)"}`)
    console.log("═".repeat(62))

    for (const client of clients || []) {
        const config = (client.config || {}) as ClientConfig
        if (config.industry && config.city) {
            console.log(`⏭️  ${client.slug}: už má obojí (${config.industry} / ${config.city})`)
            continue
        }
        const derived = await derive(config)
        const industry = config.industry || derived.industry
        const city = config.city || derived.city
        console.log(`\n### ${client.slug}`)
        console.log(`   industry: ${config.industry || "—"}  →  ${industry || "—"}`)
        console.log(`   city:     ${config.city || "—"}  →  ${city || "— (web ho neuvádí)"}`)

        if (!FIX || (!industry && !city)) continue
        const next = { ...config, ...(industry ? { industry } : {}), ...(city ? { city } : {}) }
        const { error: upErr } = await supabaseAdmin.from("clients").update({ config: next }).eq("id", client.id)
        if (upErr) console.error(`   ❌ ${upErr.message}`)
        else { invalidateConfigCache(client.slug); console.log(`   ✅ zapsáno`) }
    }

    if (!FIX) console.log(`\nRead-only. Zápis: přidej --fix\n`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
