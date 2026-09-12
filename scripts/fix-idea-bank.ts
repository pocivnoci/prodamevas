/**
 * Úklid zásobníku nápadů — pro data, která vznikla před pravidly v idea-rules.ts.
 *
 *   npx tsx scripts/fix-idea-bank.ts                 # report, všichni aktivní klienti mimo výlohu
 *   npx tsx scripts/fix-idea-bank.ts --slug=<slug>   # jen jeden klient (i výloha)
 *   npx tsx scripts/fix-idea-bank.ts --fix           # zapíše
 *
 * Dva průchody na klienta:
 *  1. KATEGORIE — nápady bez platné kategorie (vklad z plánu ukládal null; přegenerované
 *     pilíře dostaly nová id) zařadí model do kategorií jejich pilíře
 *     (`classifyUncategorizedIdeas`, stejná cesta jako denní agent).
 *  2. FORMÁT — nápady, které předepisují formát („zábavné reels video…"), přepíše na
 *     téma (`neutralizeIdeaFormats`, stejný přepisovač jako generátor). Co formát
 *     předepisuje i po přepisu, zůstává a vypíše se — ruční rozhodnutí, ne mazání.
 *
 * Nic nemaže a nic negeneruje: mění jen `subcategory`, `title` a `content`.
 */

import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import supabaseAdmin from "../supabase/admin"
import { NOT_SHOWCASE } from "../lib/audience"
import { loadConfig } from "../instagram/configs"
import { findMiscategorized, prescribesFormat, formatWordsList, type PillarCategoryMap } from "../instagram/idea-rules"
import { classifyUncategorizedIdeas, neutralizeIdeaFormats } from "../instagram/idea-generator"

const args = process.argv.slice(2)
const FIX = args.includes("--fix")
const SLUG = args.find(a => a.startsWith("--slug="))?.split("=")[1]
/** Přepisovač dostává dávky — víc než tucet = dlouhé přemýšlení a `fetch failed`. */
const BATCH = 10

/** Záloha řádků před zápisem — přepis title/content jinak nejde vrátit. */
const BACKUP_PATH = path.join(os.homedir(), ".chrlit", "backups", `ig_post_ideas-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`)
const backup: Record<string, unknown>[] = []
function writeBackup() {
    if (!FIX || backup.length === 0) return
    fs.mkdirSync(path.dirname(BACKUP_PATH), { recursive: true })
    fs.writeFileSync(BACKUP_PATH, JSON.stringify(backup, null, 2))
}

interface IdeaRow { id: string; category: string; subcategory: string | null; title: string; content: string }

async function main() {
    let q = supabaseAdmin.from("clients").select("id, slug, config").eq("is_active", true)
    q = SLUG ? q.eq("slug", SLUG) : q.or(NOT_SHOWCASE)
    const { data: clients, error } = await q.order("slug")
    if (error) throw new Error(error.message)
    if (!clients?.length) { console.log("Žádný klient."); return }

    console.log(`${FIX ? "🔧 ZAPISUJI" : "👀 REPORT (bez --fix se nic nemění)"} — ${clients.length} klientů\n`)
    const totals = { miscategorized: 0, classified: 0, formatted: 0, rewritten: 0, stubborn: 0 }

    for (const client of clients) {
        const { data: rows, error: rErr } = await supabaseAdmin
            .from("ig_post_ideas")
            .select("id, category, subcategory, title, content")
            .eq("client_id", client.id)
            .eq("is_active", true)
            .order("created_at", { ascending: false })
        if (rErr) { console.warn(`  ⚠️ ${client.slug}: ${rErr.message}`); continue }
        const ideas = (rows || []) as IdeaRow[]
        if (ideas.length === 0) continue

        const pillars = ((client.config as { contentPillars?: PillarCategoryMap } | null)?.contentPillars || {}) as PillarCategoryMap
        const miscategorized = findMiscategorized(ideas, pillars)
        const formatted = ideas.filter(i => prescribesFormat(`${i.title} ${i.content}`))
        totals.miscategorized += miscategorized.length
        totals.formatted += formatted.length
        if (miscategorized.length === 0 && formatted.length === 0) continue

        console.log(`━━ ${client.slug} — ${ideas.length} nápadů · bez platné kategorie ${miscategorized.length} · předepisuje formát ${formatted.length}`)
        for (const i of formatted.slice(0, 3)) console.log(`     ✂︎ "${i.title.slice(0, 60)}" (${formatWordsList(`${i.title} ${i.content}`).join(", ")})`)
        if (!FIX) continue

        const config = await loadConfig(client.slug)
        backup.push(...[...miscategorized, ...formatted].map(i => ({ client: client.slug, ...i })))
        writeBackup()

        if (miscategorized.length > 0) {
            const res = await classifyUncategorizedIdeas(config, client.id)
            totals.classified += res.assigned
            console.log(`     🗂️ zařazeno ${res.assigned}/${res.checked}`)
        }

        for (let start = 0; start < formatted.length; start += BATCH) {
            const batch = formatted.slice(start, start + BATCH)
            const rewritten = await neutralizeIdeaFormats(config, batch)
            for (let k = 0; k < batch.length; k++) {
                const idea = batch[k]
                const next = rewritten[k]
                const changed = next.title !== idea.title || next.content !== idea.content
                if (!changed || prescribesFormat(`${next.title} ${next.content}`)) {
                    totals.stubborn++
                    console.log(`     ⚠️ zůstává: "${idea.title.slice(0, 60)}"`)
                    continue
                }
                const { error: uErr } = await supabaseAdmin
                    .from("ig_post_ideas")
                    .update({ title: next.title, content: next.content })
                    .eq("id", idea.id)
                    .eq("client_id", client.id)
                if (uErr) { console.warn(`     ⚠️ zápis ${idea.id}: ${uErr.message}`); continue }
                totals.rewritten++
                console.log(`     ✅ "${idea.title.slice(0, 50)}" → "${next.title.slice(0, 50)}"`)
            }
        }
    }

    if (FIX && backup.length > 0) console.log(`\n💾 Záloha původních řádků: ${BACKUP_PATH}`)
    console.log(`\n── Souhrn ──`)
    console.log(`   bez platné kategorie: ${totals.miscategorized}${FIX ? ` → zařazeno ${totals.classified}` : ""}`)
    console.log(`   předepisuje formát:   ${totals.formatted}${FIX ? ` → přepsáno ${totals.rewritten}, zůstává ${totals.stubborn}` : ""}`)
}

main().catch(err => { console.error("❌", err?.message || err); process.exit(1) })
