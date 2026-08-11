/**
 * Import leadů + zařazení do fronty obchodního agenta.
 *
 *   npx tsx scripts/import-leads.ts leads.csv           # nahraje a zařadí ke kvalifikaci
 *   npx tsx scripts/import-leads.ts leads.csv --dry-run # jen vypíše, co by udělal
 *   npx tsx scripts/import-leads.ts --ig=kavarna1,kavarna2
 *
 * CSV se sloupci (hlavička povinná, pořadí volné):
 *   company,website,email,ig_handle,followers,last_post_at
 * Povinný je `website` NEBO `email` — bez jednoho z nich není odkud vzít kontakt.
 *
 * Kvalifikaci, ukázku i odeslání dělá fronta (`agent_tasks`), ne tenhle skript:
 * import jen zapíše řádky a zařadí `lead_qualify`. Cron `agent-worker` je pak
 * zpracuje sám, včetně retry a denního stropu.
 */

import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })

import { readFileSync } from "fs"
import supabaseAdmin from "../supabase/admin"
import { enqueueTask } from "../lib/agent-runner"

const args = process.argv.slice(2)
const DRY = args.includes("--dry-run")
const file = args.find(a => !a.startsWith("--"))
const igArg = args.find(a => a.startsWith("--ig="))?.split("=")[1]

interface Row {
    company?: string
    website?: string
    email?: string
    ig_handle?: string
    followers?: number
    last_post_at?: string
}

/** Minimální CSV parser — uvozovky, čárky uvnitř polí, CRLF. */
function parseCsv(text: string): Row[] {
    const lines = text.split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) return []
    const split = (line: string): string[] => {
        const out: string[] = []
        let cur = "", inQ = false
        for (let i = 0; i < line.length; i++) {
            const c = line[i]
            if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++ } else inQ = !inQ }
            else if (c === "," && !inQ) { out.push(cur); cur = "" }
            else cur += c
        }
        out.push(cur)
        return out.map(s => s.trim())
    }
    const head = split(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, "_"))
    return lines.slice(1).map(line => {
        const cells = split(line)
        const r: any = {}
        head.forEach((h, i) => { if (cells[i]) r[h] = cells[i] })
        if (r.followers) r.followers = Number(r.followers) || undefined
        return r as Row
    })
}

async function main() {
    let rows: Row[] = []
    if (file) rows = parseCsv(readFileSync(file, "utf-8"))
    else if (igArg) rows = igArg.split(",").map(h => ({ ig_handle: h.trim().replace(/^@/, "") }))
    else {
        console.error("Chybí vstup. Použij: npx tsx scripts/import-leads.ts leads.csv [--dry-run]")
        process.exit(1)
    }

    const usable = rows.filter(r => r.website || r.email)
    const skipped = rows.length - usable.length

    console.log(`\n📥 IMPORT LEADŮ${DRY ? "  (nanečisto)" : ""}`)
    console.log(`   načteno: ${rows.length}   použitelných: ${usable.length}` +
        (skipped ? `   přeskočeno bez webu i e-mailu: ${skipped}` : ""))

    if (DRY) {
        for (const r of usable.slice(0, 15)) {
            console.log(`   · ${(r.company || r.ig_handle || "?").slice(0, 30).padEnd(32)}` +
                `${(r.website || "—").slice(0, 34).padEnd(36)}${r.email || "—"}`)
        }
        if (usable.length > 15) console.log(`   … a dalších ${usable.length - 15}`)
        console.log(`\n   Nic nezapsáno. Spusť bez --dry-run.\n`)
        return
    }

    let inserted = 0, duplicate = 0, failed = 0
    for (const r of usable) {
        const { data, error } = await supabaseAdmin.from("leads").insert({
            source: "import",
            // Klíč pro deduplikaci — tentýž podnik se nesmí do fronty dostat dvakrát.
            source_ref: (r.email || r.website || r.ig_handle || "").toLowerCase(),
            company: r.company ?? null,
            website: r.website ?? null,
            email: r.email?.toLowerCase() ?? null,
            ig_handle: r.ig_handle ? `@${r.ig_handle.replace(/^@/, "")}` : null,
            followers: r.followers ?? null,
            last_post_at: r.last_post_at ?? null,
        }).select("id").single()

        if (error) {
            // 23505 = porušení unikátního indexu → lead už ve frontě je.
            if ((error as any).code === "23505") duplicate++
            else { failed++; console.warn(`   ⚠️ ${r.company || r.website}: ${error.message.slice(0, 80)}`) }
            continue
        }
        await enqueueTask({ type: "lead_qualify", payload: { leadId: data.id } })
        inserted++
    }

    console.log(`\n   ✅ zapsáno ${inserted}` +
        (duplicate ? `   ♻️ už ve frontě ${duplicate}` : "") +
        (failed ? `   ❌ chyb ${failed}` : ""))
    console.log(`   Kvalifikaci, ukázku i odeslání zpracuje cron agent-worker.\n`)
}

void main().catch(err => { console.error("❌", err.message); process.exit(1) })
