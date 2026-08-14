/**
 * Přiřadí každému formátu univerzální rétorický mechanismus.
 *
 *   npx tsx scripts/assign-mechanisms.ts              # read-only report
 *   npx tsx scripts/assign-mechanisms.ts --fix        # zapíše
 *   npx tsx scripts/assign-mechanisms.ts --fix --slug=x
 *
 * PROČ
 * ────
 * Formáty se generovaly per značku a měly být mechanismy. Nebyly — ani po přepsání
 * promptu, zavedení stropů (FORMAT_BRIEF_LIMITS) a strojové sanitizaci hotové copy
 * (stripFinishedCopy). Model do nich stejně propašoval téma: „Průvodce ideálním
 * tarifem", „Magická analýza webu". Půlka formátů neprošla testem invariantu
 * („vyrobím z tohohle 30 RŮZNÝCH příspěvků?").
 *
 * Spoléhat na to, že model dodrží formátovací pravidlo, selhalo dvakrát po sobě.
 * Tenhle skript proto formáty nepřepisuje — jen ke každému doplní `mechanism`,
 * a brief se od té chvíle čte ze sdílené tabulky (instagram/mechanisms.ts), kam
 * model nemá jak sáhnout.
 *
 * CO SE NEMĚNÍ
 * ────────────
 * `name`, `pillar`, `medium`, `aspectRatio`, `uses_product`, `manualOnly`. Na jméně
 * visí `ig_post_types`, `config.postTypes`, členství v pilířích, `weekPlan`
 * i `post_type_id` už vygenerovaných příspěvků — formáty se tedy NERUŠÍ.
 */

import supabaseAdmin from "../supabase/admin"
import { invalidateConfigCache } from "../instagram/configs"
import { reconcileFormats } from "../instagram/configs/reconcile"
import { generateText } from "../instagram/gemini-client"
import { MECHANISMS, MECHANISM_IDS, isMechanismId } from "../instagram/mechanisms"
import type { ClientConfig, PostTypeDef } from "../instagram/configs/types"

const FIX = process.argv.includes("--fix")
const ONLY_SLUG = process.argv.find(a => a.startsWith("--slug="))?.split("=")[1]

/** Poslední záchrana, když AI selže — ať formát nikdy nezůstane bez mechanismu.
 *  Klíčová slova jsou z názvů a briefů, které v produkci reálně vznikly. */
function guessMechanism(def: PostTypeDef): string {
    const t = `${def.name} ${def.display_name} ${def.description || ""}`.toLowerCase()
    if (/pred_po|před.?a.?po|glow.?up|promena|proměn|transformac/.test(t)) return "pred_po"
    if (/souboj|vs\.|versus|srovn|porovn|hlasov|duel/.test(t)) return "srovnani"
    if (/navod|návod|tip|tutorial|krok|jak\b|postup|uzel/.test(t)) return "navod"
    if (/mytus|mýt|omyl|pravda|nesmysl|chyb/.test(t)) return "mytus"
    if (/zakulis|zákulis|proces|behind|vyrob|tvorb|ritual|rituál/.test(t)) return "zakulisi"
    if (/kviz|kvíz|hadank|hádank|pozn[aá]|tipni|otazk|otázk/.test(t)) return "kviz"
    if (/recenz|pripadov|případov|dukaz|důkaz|vysledk|výsledk|uspech|úspěch|studie/.test(t)) return "dukaz"
    return def.uses_product ? "nabidka" : "zakulisi"
}

const catalogue = MECHANISM_IDS.map(id => `  ${id} — ${MECHANISMS[id].label}: ${MECHANISMS[id].description}`).join("\n")

async function assignViaAI(defs: PostTypeDef[]): Promise<Record<string, string>> {
    const list = defs.map(d => `- ${d.name} (${d.medium}): ${d.display_name} — ${d.description || "—"}`).join("\n")
    const prompt = `Ke každému formátu příspěvku vyber JEDEN rétorický mechanismus, kterému nejvíc odpovídá.

MECHANISMY (vyber přesně jeden klíč z tohohle seznamu):
${catalogue}

FORMÁTY:
${list}

Rozhoduj podle toho, JAK je příspěvek postavený, ne o čem je. „Průvodce ideálním tarifem"
není vlastní kategorie — je to nabídka. „Magická analýza webu" je zákulisí procesu.

Vrať POUZE JSON: { "<name formátu>": "<klíč mechanismu>", ... }`

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const raw = await generateText(prompt, { temperature: 0.2 })
            const m = raw.replace(/```json/gi, "").replace(/```/g, "").match(/\{[\s\S]*\}/)
            if (m) return JSON.parse(m[0])
        } catch (e) {
            console.warn(`   ⚠️ přiřazení (pokus ${attempt}/2): ${(e as Error).message}`)
        }
    }
    return {}
}

async function main(): Promise<void> {
    let q = supabaseAdmin.from("clients").select("id, slug, config").order("slug")
    if (ONLY_SLUG) q = q.eq("slug", ONLY_SLUG)
    const { data: clients, error } = await q
    if (error) { console.error("❌", error.message); process.exit(1) }

    console.log(`\n${"═".repeat(72)}`)
    console.log(`  FORMÁT → MECHANISMUS   ${FIX ? "(--fix: ZAPISUJE)" : "(read-only)"}`)
    console.log("═".repeat(72))

    for (const client of clients || []) {
        const raw = (client.config || {}) as ClientConfig
        const defs = raw.postTypeDefs || []
        if (defs.length === 0) { console.log(`\n⏭️  ${client.slug}: žádné formáty`); continue }

        console.log(`\n### ${client.slug} — ${defs.length} formátů`)
        const byAI = await assignViaAI(defs)
        const next = defs.map(d => {
            const picked = byAI[d.name]
            const mechanism = isMechanismId(picked) ? picked : guessMechanism(d)
            const how = isMechanismId(picked) ? "" : " (heuristika)"
            console.log(`   ${MECHANISMS[mechanism as keyof typeof MECHANISMS].emoji} ${String(d.display_name).padEnd(34)} → ${mechanism}${how}`)
            return { ...d, mechanism }
        })

        if (!FIX) continue
        const { error: upErr } = await supabaseAdmin.from("clients")
            .update({ config: reconcileFormats({ ...raw, postTypeDefs: next }) }).eq("id", client.id)
        if (upErr) console.error(`   ❌ ${upErr.message}`)
        else { invalidateConfigCache(client.slug); console.log(`   ✅ zapsáno`) }
    }

    if (!FIX) console.log(`\nRead-only. Zápis: přidej --fix\n`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
