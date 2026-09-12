/**
 * Import úkolů z Google tabulky — ruční spuštění a dry-run.
 *
 *   npx tsx scripts/sync-ukoly.ts --dry-run   # jen přečte a vypíše, nic nezapíše
 *   npx tsx scripts/sync-ukoly.ts             # ostrý import (potřebuje .env.local)
 *
 * Zdroj pravdy o úkolech je databáze. Tohle je jednosměrný import: zakládá jen
 * to, co v databázi ještě není, a existujícího úkolu se nedotkne.
 *
 * Dry-run schválně nesahá do databáze, takže jde spustit i tam, kde `.env.local`
 * není — stačí `TASKS_SHEET_ID` a `GOOGLE_SHEETS_API_KEY`.
 */

import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })

import { fetchSheetTasks } from "../lib/tasks/sheet-parse"
import { suggestRole } from "../lib/team"

async function main() {
    const dryRun = process.argv.includes("--dry-run")

    if (!process.env.TASKS_SHEET_ID || !process.env.GOOGLE_SHEETS_API_KEY) {
        console.error("❌ Chybí TASKS_SHEET_ID nebo GOOGLE_SHEETS_API_KEY.")
        process.exit(1)
    }

    const tasks = await fetchSheetTasks()
    if (!tasks) {
        console.error("❌ Import není nakonfigurovaný.")
        process.exit(1)
    }

    console.log(`\n📋 List ÚKOLY — ${tasks.length} úkolů\n`)
    for (const t of tasks) {
        const role = suggestRole(t.title, t.note)
        console.log(
            `  ${t.priority ? `[prio ${t.priority}]` : "[  —   ]"} ` +
            `${(role ?? "nezadáno").padEnd(9)} ${t.title.slice(0, 70)}`
        )
        if (t.note) console.log(`            ↳ ${t.note.slice(0, 80)}`)
    }

    if (dryRun) {
        console.log("\n🔍 Dry-run — do databáze se nezapisovalo.\n")
        return
    }

    // Až tady, aby dry-run nepotřeboval databázi: import stahuje supabase klienta.
    const { syncTasksFromSheet } = await import("../lib/tasks/sheet-sync")
    const summary = await syncTasksFromSheet()
    console.log(`\n✅ Import: ${summary.novych} nových · ${summary.preskocenych} už v databázi bylo`)
    if (summary.chybiVTabulce.length > 0) {
        console.log(`⚠️  Už není v tabulce (nemaže se): ${summary.chybiVTabulce.join(", ")}`)
    }
    console.log()
}

main().catch(err => {
    console.error("❌", err?.message || err)
    process.exit(1)
})
