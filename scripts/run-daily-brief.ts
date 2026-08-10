/**
 * Ruční ranní brief — read-only běh proti živé DB.
 *   npx tsx scripts/run-daily-brief.ts
 *
 * Tiskne do terminálu místo posílání e-mailu. Nic nezapisuje, nic neodesílá —
 * bezpečné kdykoli. Tohle je způsob, jak brief ladit; opakovaný curl na
 * /api/cron/daily-ops by narazil na pojistku „jeden brief denně".
 *
 * Exit 2 = brief by dnes odešel (je co hlásit), 0 = ticho.
 */

import fs from "fs"

// Načíst .env.local dřív, než jakýkoli @/supabase import sáhne na process.env.
for (const line of fs.readFileSync(".env.local", "utf-8").split("\n")) {
    const m = line.match(/^([^=#]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, "")
}

async function main() {
    const { buildDailyBrief, renderDailyBrief } = await import("../lib/agents/daily-brief")
    const brief = await buildDailyBrief()

    console.log(`Ranní brief @ ${new Date(brief.checkedAt).toLocaleString("cs-CZ")}\n`)
    if (brief.quiet) {
        console.log("✅ Ticho — dnes by nepřišel žádný e-mail.")
        if (brief.did.length > 0) {
            console.log("\nCO JSEM UDĚLAL SÁM")
            for (const l of brief.did) console.log(`  ${l.icon} ${l.text}`)
        }
        return
    }

    console.log(renderDailyBrief(brief).text)
    process.exitCode = 2
}

main().catch(err => {
    console.error("💥 Ranní brief selhal:", err?.message || err)
    process.exit(1)
})
