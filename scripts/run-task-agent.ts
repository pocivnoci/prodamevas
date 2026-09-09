/**
 * Ruční spuštění agenta nad úkoly — proti živé databázi.
 *   npx tsx scripts/run-task-agent.ts              # roztřídí + navrhne
 *   npx tsx scripts/run-task-agent.ts --triage     # jen roztřídí
 *   npx tsx scripts/run-task-agent.ts --propose    # jen navrhne
 *
 * Totéž, co dělá denní `task_triage` / `task_propose`, jen s výpisem do terminálu.
 * **Zapisuje**: doplňuje zadání k úkolům a zakládá návrhy. Volá model, takže to
 * něco stojí — pár korun na běh.
 */

import fs from "fs"

// .env.local se musí načíst dřív, než si ho přečte první import ze @/supabase.
for (const line of fs.readFileSync(".env.local", "utf-8").split("\n")) {
    const m = line.match(/^([^=#]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, "")
}

async function main() {
    const args = process.argv.slice(2)
    const onlyTriage = args.includes("--triage")
    const onlyPropose = args.includes("--propose")

    if (!onlyPropose) {
        const { triageTasks } = await import("../lib/tasks/triage")
        const t = await triageTasks()
        console.log(`\n🗂️  Roztříděno: ${t.roztrideno} (z toho ${t.otazek} s otázkou), přeskočeno ${t.preskoceno}`)
    }

    if (!onlyTriage) {
        const { proposeTasks } = await import("../lib/tasks/propose")
        const p = await proposeTasks()
        console.log(`🧭 Navrženo: ${p.navrzeno}, přeskočeno ${p.preskoceno} (signálů: ${p.signalu})`)
    }

    const { default: supabaseAdmin } = await import("../supabase/admin")
    const { data } = await supabaseAdmin
        .from("tasks")
        .select("title, owner_email, effort, agent, next_step, blocked_on, status, created_by")
        .in("status", ["todo", "doing", "blocked"])
        .order("priority", { ascending: true, nullsFirst: false })

    console.log(`\n📋 Otevřených úkolů: ${data?.length ?? 0}\n`)
    for (const t of data || []) {
        const who = (t.owner_email || "—").split("@")[0]
        const tags = [t.effort, t.agent, t.created_by === "ai" ? "návrh AI" : null].filter(Boolean).join(" · ")
        console.log(`• [${who}] ${t.title}${tags ? `  (${tags})` : ""}`)
        if (t.next_step) console.log(`    → ${t.next_step}`)
        if (t.blocked_on) console.log(`    ⏸ ${t.blocked_on}`)
    }
}

main().catch(e => { console.error("❌", e); process.exit(1) })
