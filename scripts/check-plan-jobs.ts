/**
 * Diagnostic: inspect content-plan generation runs.
 *
 * generateContentPlan() writes a durable breadcrumb row to ig_jobs
 * (config.kind = "content_plan") at entry and updates it through to done/failed.
 * This makes "did the plan even start? where did it stop? what was the error?"
 * answerable without Vercel logs.
 *
 *   npx tsx scripts/check-plan-jobs.ts            # last 25 plan runs
 *   npx tsx scripts/check-plan-jobs.ts running    # only non-terminal (stuck) runs
 */
import fs from "fs"
import { createClient } from "@supabase/supabase-js"

const env = fs.readFileSync(".env.local", "utf-8").split("\n").reduce((a, l) => {
    const m = l.match(/^([^=]+)=(.*)$/)
    if (m) a[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "")
    return a
}, {} as Record<string, string>)

const sb = createClient(env["NEXT_PUBLIC_SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])
const filter = process.argv[2] // optional: "running"

async function main() {
    let q = sb
        .from("ig_jobs")
        .select("id, client_id, status, progress, agent_message, error, config, created_at, updated_at")
        .eq("config->>kind", "content_plan")
        .order("created_at", { ascending: false })
        .limit(25)
    if (filter === "running") q = q.not("status", "in", "(done,failed)")

    const { data, error } = await q
    if (error) { console.error(error); process.exit(1) }
    if (!data?.length) { console.log("No content_plan runs found."); return }

    for (const j of data) {
        const dur = j.updated_at && j.created_at
            ? Math.round((+new Date(j.updated_at) - +new Date(j.created_at)) / 1000) + "s"
            : "?"
        const cfg = (j.config || {}) as any
        const stuck = !["done", "failed"].includes(j.status) && (Date.now() - +new Date(j.updated_at)) > 5 * 60 * 1000
        console.log(
            `${j.created_at?.substring(5, 16)} ${String(j.status).padEnd(8)} p${String(j.progress ?? "?").padEnd(3)} ${String(dur).padEnd(6)}` +
            ` cnt=${cfg.count} model=${cfg.model || "?"} ${stuck ? "⚠️STUCK " : ""}${j.error ? "ERR: " + String(j.error).substring(0, 90) : (j.agent_message || "")}`
        )
    }
}
main()
