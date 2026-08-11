/**
 * Rozeslat pozvánky lidem z waitlistu.
 *
 *   npx tsx scripts/invite-waitlist.ts --dry-run        # ukáže, komu a co
 *   npx tsx scripts/invite-waitlist.ts --code=VIP100    # odešle
 *   npx tsx scripts/invite-waitlist.ts --code=VIP100 --limit=5
 *
 * Vyžádaná komunikace (člověk se zapsal sám), takže jde přes běžný kanál.
 * Studené oslovení firem má vlastní přepravu — viz lib/agents/sales/transport.ts.
 */

import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })

import supabaseAdmin from "../supabase/admin"
import { pendingInvites, renderInvite, sendWaitlistInvites } from "../lib/agents/waitlist-invite"

const args = process.argv.slice(2)
const DRY = args.includes("--dry-run")
const code = args.find(a => a.startsWith("--code="))?.split("=")[1]
const limit = Number(args.find(a => a.startsWith("--limit="))?.split("=")[1]) || 20

async function main() {
    const rows = await pendingInvites()
    console.log(`\n📨 POZVÁNKY Z WAITLISTU${DRY ? "  (nanečisto)" : ""}`)
    console.log(`   čeká na pozvánku: ${rows.length}\n`)
    if (rows.length === 0) return console.log("   Nikdo nečeká.\n")

    if (!code) {
        // Bez kódu nemá smysl nic posílat — pozvánka bez kódu je slepá ulička.
        const { data } = await supabaseAdmin
            .from("invite_codes").select("code, max_uses, used_count, is_active").eq("is_active", true)
        console.log("   Chybí --code=. Aktivní kódy:")
        for (const c of data ?? []) console.log(`     ${c.code}  (${c.used_count}/${c.max_uses})`)
        console.log()
        return
    }

    const preview = renderInvite(rows[0], code)
    console.log("   UKÁZKA ZPRÁVY")
    console.log("   " + "─".repeat(66))
    console.log(`   Předmět: ${preview.subject}`)
    console.log(preview.body.split("\n\n").map(p => "   " + p.replace(/<[^>]+>/g, "")).join("\n\n"))
    console.log("   " + "─".repeat(66))
    console.log(`\n   příjemci (${Math.min(rows.length, limit)}):`)
    for (const r of rows.slice(0, limit)) {
        const days = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86_400_000)
        console.log(`     ${r.email.padEnd(34)} čeká ${days} dní`)
    }

    if (DRY) return console.log("\n   Nic neodesláno. Spusť bez --dry-run.\n")

    const res = await sendWaitlistInvites({ code, limit })
    console.log(`\n   ✅ odesláno ${res.filter(r => r.sent).length}\n`)
}

void main().catch(err => { console.error("❌", err.message); process.exit(1) })
