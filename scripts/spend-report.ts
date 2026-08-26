/**
 * Kam tečou peníze za modely.
 *   npx tsx scripts/spend-report.ts            posledních 7 dní
 *   npx tsx scripts/spend-report.ts 30         posledních 30 dní
 *
 * Read-only. Sčítá OBĚ místa, kde se spotřeba měří:
 *   - `ig_generation_log` — generování příspěvků
 *   - `ai_spend`          — všechno ostatní (nápady, onboarding, produkty, tisk,
 *                           plány, retuše, import produktů, ukázky pro prospekty…)
 *
 * Vzniklo 23. 8. 2026, když Google za týden ukázal 411,78 Kč a aplikace uměla
 * vysvětlit ~100 Kč. Chyběl přehled, ne data — největší položka týdne (400 nápadů
 * jedním hromadným během) se dala najít jen ručním porovnáním s fakturou.
 *
 * Čísla jsou ODHAD z tokenů × sazebník v lib/model-pricing.ts, ne faktura. Když se
 * rozcházejí s Googlem, chybí měření na nějaké cestě — ne peníze.
 */
import fs from "fs"

for (const line of fs.readFileSync(".env.local", "utf-8").split("\n")) {
    const m = line.match(/^([^=#]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, "")
}

const DAYS = Number(process.argv[2]) || 7

async function main() {
    const supabaseAdmin = (await import("../supabase/admin")).default
    const { USD_TO_CZK } = await import("../lib/model-pricing")
    const since = new Date(Date.now() - DAYS * 86400_000).toISOString()
    const czk = (usd: number) => (usd * USD_TO_CZK).toFixed(2)

    const { data: posts } = await supabaseAdmin
        .from("ig_generation_log")
        .select("cost_usd, model_calls, created_at, post_type, client_id")
        .gte("created_at", since)
    const { data: other } = await supabaseAdmin
        .from("ai_spend")
        .select("cost_usd, model_calls, created_at, operation, client_id, ref_id")
        .gte("created_at", since)

    const p = posts || []
    const o = other || []
    const sum = (rows: { cost_usd: number | null }[]) => rows.reduce((s, r) => s + (r.cost_usd || 0), 0)
    const unpriced = [...p, ...o].filter(r => r.cost_usd === null).length

    console.log(`\n💰 Útrata za modely — posledních ${DAYS} dní (odhad, kurz ${USD_TO_CZK} Kč/$)\n`)

    const byOp: Record<string, { usd: number; n: number; calls: number }> = {}
    const add = (key: string, usd: number | null, calls: number | null) => {
        byOp[key] ||= { usd: 0, n: 0, calls: 0 }
        byOp[key].usd += usd || 0
        byOp[key].n += 1
        byOp[key].calls += calls || 0
    }
    for (const r of p) add("příspěvky", r.cost_usd, r.model_calls)
    for (const r of o) add(r.operation, r.cost_usd, r.model_calls)

    const total = sum(p) + sum(o)
    console.log(`${"operace".padEnd(24)}${"běhů".padStart(6)}${"volání".padStart(8)}${"Kč".padStart(10)}${"podíl".padStart(8)}`)
    console.log("─".repeat(56))
    for (const [k, v] of Object.entries(byOp).sort((a, b) => b[1].usd - a[1].usd)) {
        const share = total > 0 ? `${Math.round(v.usd / total * 100)}%` : "-"
        console.log(`${k.padEnd(24)}${String(v.n).padStart(6)}${String(v.calls).padStart(8)}${czk(v.usd).padStart(10)}${share.padStart(8)}`)
    }
    console.log("─".repeat(56))
    console.log(`${"CELKEM".padEnd(24)}${String(p.length + o.length).padStart(6)}${"".padStart(8)}${czk(total).padStart(10)}\n`)

    // „other" je sběrný koš pro drobné cesty (návrh formátu, promo post, recenze…).
    // Bez rozpadu by z něj byla nová slepá skvrna — přesně to, co tenhle přehled ruší.
    const drobne = o.filter(r => r.operation === "other")
    if (drobne.length > 0) {
        const byRef: Record<string, { usd: number; n: number }> = {}
        for (const r of drobne) {
            const key = String(r.ref_id || "?").split(":")[0]
            byRef[key] ||= { usd: 0, n: 0 }
            byRef[key].usd += r.cost_usd || 0
            byRef[key].n += 1
        }
        console.log("z toho drobnosti (operace \"other\"):")
        for (const [k, v] of Object.entries(byRef).sort((x, y) => y[1].usd - x[1].usd)) {
            console.log(`  ${k.padEnd(22)}${String(v.n).padStart(6)}${czk(v.usd).padStart(10)} Kč`)
        }
        console.log("")
    }

    // Po dnech — jeden hromadný běh je v součtu neviditelný, ve dni trčí.
    const byDay: Record<string, number> = {}
    for (const r of [...p, ...o]) {
        const d = String(r.created_at).slice(0, 10)
        byDay[d] = (byDay[d] || 0) + (r.cost_usd || 0)
    }
    console.log("po dnech:")
    for (const [d, usd] of Object.entries(byDay).sort()) {
        const bar = "█".repeat(Math.round(usd / Math.max(...Object.values(byDay)) * 30))
        console.log(`  ${d}  ${czk(usd).padStart(9)} Kč  ${bar}`)
    }

    if (unpriced > 0) {
        console.log(`\n⚠️  ${unpriced} běhů bez ceny — některý model nemá sazbu v lib/model-pricing.ts.`)
        console.log("   Součet je proto NIŽŠÍ než skutečnost (raději null než vymyšlená nula).")
    }
    console.log("\nPorovnej s Googlem: aistudio.google.com → Spend. Když se to rozchází,")
    console.log("chybí měření na nějaké cestě — hledej volání modelu mimo trackSpend().\n")
}

main().catch(e => { console.error("PADLO:", e); process.exit(1) })
