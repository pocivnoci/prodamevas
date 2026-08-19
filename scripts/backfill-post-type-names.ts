/**
 * Srovná názvy formátů v `ig_post_types` s configem — jednorázově, u všech klientů.
 *
 *   npx tsx scripts/backfill-post-type-names.ts                # read-only report
 *   npx tsx scripts/backfill-post-type-names.ts --slug=<slug>  # jen jeden klient
 *   npx tsx scripts/backfill-post-type-names.ts --fix          # zapíše
 *
 * PROČ
 * ────
 * `config.postTypeDefs` je zdroj pravdy, řádek v `ig_post_types` je kopie pro UI.
 * `ensurePostTypes()` ale uměla řádky jen ZAKLÁDAT, nikdy aktualizovat — takže
 * převod formátů ze storyboardů na invarianty (#12) přepsal config a řádky
 * zůstaly v minulém životě. Engine pak v logu i v UI vypisoval
 * „❓ ❓ Květinový kvíz z pavlače" místo „❓ Hádejte rostlinu".
 *
 * Dvojité emoji je tatáž nemoc: obě zapisovací místa cpala emoji do sloupce
 * `emoji` I do `display_name`, a konzumenti je pak skládali dohromady.
 *
 * Od téhle chvíle sladění dělá `ensurePostTypes()` sama při každém běhu; tenhle
 * skript je jednorázová dávka pro to, co se rozešlo dřív.
 */

import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })

import supabaseAdmin from "../supabase/admin"
import { reconcilePostTypeRows } from "../instagram/service"

const args = process.argv.slice(2)
const FIX = args.includes("--fix")
const SLUG = args.find(a => a.startsWith("--slug="))?.split("=")[1]

async function main() {
    let query = supabaseAdmin.from("clients").select("id, slug, name, config")
    if (SLUG) query = query.eq("slug", SLUG)
    const { data: clients, error } = await query
    if (error) throw new Error(error.message)

    console.log(`\n🔤 NÁZVY FORMÁTŮ → CONFIG${FIX ? "" : "   (read-only report)"}`)
    console.log(`   klientů: ${clients?.length ?? 0}\n`)

    let totalDrift = 0

    for (const c of clients ?? []) {
        const defs = ((c.config as any)?.postTypeDefs ?? []) as any[]
        if (defs.length === 0) continue

        const { data: rows } = await supabaseAdmin
            .from("ig_post_types")
            .select("name, display_name, emoji, description, uses_product")
            .eq("client_id", c.id)

        const defMap = new Map(defs.map(d => [d.name, d]))
        const drift: string[] = []

        for (const r of rows ?? []) {
            const def = defMap.get(r.name)
            const current = String(r.display_name ?? "")
            if (def) {
                if (current !== def.display_name) drift.push(`   „${current}" → „${def.display_name}"`)
                else if ((r.emoji ?? "") !== (def.emoji || "📝")) drift.push(`   ${r.name}: emoji ${r.emoji} → ${def.emoji}`)
            } else if (r.emoji && current.startsWith(r.emoji)) {
                drift.push(`   „${current}" → bez zdvojeného emoji`)
            }
        }

        if (drift.length === 0) {
            console.log(`✅ ${c.slug}: sedí`)
            continue
        }

        totalDrift += drift.length
        console.log(`⚠️  ${c.slug} (${c.name}) — ${drift.length} rozdílů`)
        for (const d of drift) console.log(d)

        if (FIX) {
            await reconcilePostTypeRows((rows ?? []) as any, defs as any, c.id)
            console.log(`   ✅ srovnáno`)
        }
        console.log()
    }

    console.log("─".repeat(60))
    if (totalDrift === 0) console.log("Nic k opravě.\n")
    else if (FIX) console.log(`Srovnáno ${totalDrift} rozdílů.\n`)
    else console.log(`Nalezeno ${totalDrift} rozdílů. Zápis: přidej --fix.\n`)
}

void main().catch(err => { console.error("❌", err.message); process.exit(1) })
