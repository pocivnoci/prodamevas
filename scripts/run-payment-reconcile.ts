/**
 * Zaseklé platby — přehled a ruční dohojení.
 *   npx tsx scripts/run-payment-reconcile.ts --dry   (jen vypsat, nic nedělat)
 *   npx tsx scripts/run-payment-reconcile.ts         (doptat se brány a dohojit)
 *
 * `--dry` se brány NEPTÁ a nic nemění — jen ukáže, co v `PENDING` visí a jak
 * dlouho. To je ta otázka, kterou chceš umět zodpovědět hned: „zaplatil někdo
 * a nedostal plán?"
 *
 * Ostrý běh jde stejnou cestou jako callback (`applyGatewayStatus`), takže se
 * souběhem s cronem nic nestane — podmíněný claim vrátí řádek jen jednomu.
 */

import fs from "fs"

for (const line of fs.readFileSync(".env.local", "utf-8").split("\n")) {
    const m = line.match(/^([^=#]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, "")
}

const DRY = process.argv.includes("--dry")

async function main() {
    const { default: supabaseAdmin } = await import("../supabase/admin")

    const { data: stuck } = await supabaseAdmin
        .from("payments")
        .select("id, comgate_trans_id, provider, amount, label, status, created_at, client_id")
        .eq("status", "PENDING")
        .order("created_at", { ascending: true })
        .limit(100)

    if (!stuck || stuck.length === 0) {
        console.log("✅ Žádná platba nevisí v PENDING.")
        return
    }

    console.log(`\n${stuck.length} platba/y v PENDING:\n`)
    for (const p of stuck) {
        const ageH = Math.floor((Date.now() - new Date(p.created_at).getTime()) / 3_600_000)
        const age = ageH < 48 ? `${ageH} h` : `${Math.floor(ageH / 24)} d`
        console.log(`  ${p.id.slice(0, 8)}  ${String(Math.round(p.amount / 100)).padStart(5)} Kč  ${age.padStart(5)}  ${p.provider}  ${p.label || ""}`)
    }

    if (DRY) {
        console.log("\n(--dry: brány jsem se neptal a nic jsem nezměnil)")
        process.exitCode = stuck.length > 0 ? 2 : 0
        return
    }

    console.log("\nDoptávám se brány…\n")
    const { reconcilePendingPayments } = await import("../lib/agents/payment-reconcile")
    const result = await reconcilePendingPayments({ limit: 100 })

    console.log(`Zkontrolováno: ${result.checked}`)
    console.log(`Dohojeno:      ${result.resolved.length}`)
    for (const r of result.resolved) console.log(`  ${r.paymentId.slice(0, 8)}  ${r.from} → ${r.to}`)
    console.log(`Brána nevěděla: ${result.unknown}`)
    console.log(`Beznadějně staré: ${result.zombies}`)
}

main().catch(err => {
    console.error("💥 Reconcile selhal:", err?.message || err)
    process.exit(1)
})
