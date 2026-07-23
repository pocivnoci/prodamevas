/**
 * Manual ops health check — read-only run against the live DB.
 *   npx tsx scripts/run-health-check.ts
 *
 * Same checks as the daily `health_check` agent task, but prints to the
 * terminal instead of e-mailing. Nothing is written; safe to run anytime.
 */

import fs from "fs"

// Load .env.local before any @/supabase import reads process.env.
for (const line of fs.readFileSync(".env.local", "utf-8").split("\n")) {
    const m = line.match(/^([^=#]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, "")
}

async function main() {
    const { buildHealthCheck } = await import("../lib/agents/health-check")
    const report = await buildHealthCheck()
    console.log(`Health check @ ${new Date(report.checkedAt).toLocaleString("cs-CZ")}\n`)
    if (report.healthy) {
        console.log("✅ Vše v pořádku — žádný problém nenalezen.")
        return
    }
    for (const p of report.problems) {
        console.log(`${p.icon} ${p.title}`)
        console.log(`   ${p.detail}\n`)
    }
    process.exitCode = 2
}

main().catch(err => {
    console.error("💥 Health check selhal:", err?.message || err)
    process.exit(1)
})
