/**
 * Převod Evidence_klientu.xlsx do evidence v systému.
 *
 *   npx tsx scripts/import-evidence-klientu.ts --dry-run   # jen vypíše, co udělá
 *   npx tsx scripts/import-evidence-klientu.ts             # zapíše
 *
 * Jednorázový převod tabulky, kterou vedl Luděk ve svém Drive (stav k 8. 9. 2026).
 * Idempotentní podle názvu firmy: druhý běh nepřidá nic.
 *
 * **Nezařazuje nic do fronty obchodního agenta.** `scripts/import-leads.ts` po sobě
 * zařazuje `lead_qualify`, protože tam jde o studený seznam k proklepnutí. Tohle je
 * seznam firem, se kterými se už mluví — dvěma z nich je na zítřek domluvená schůzka.
 * Automatický mail „všiml jsem si, že váš profil spí" by je zastihl v nejhorší chvíli.
 *
 * Čísla K0001…K0005 se schválně nevypisují ručně: přiděluje je sekvence
 * `leads_ref_seq` z migrace `20260908_leads_crm.sql`, a protože je tabulka zatím
 * prázdná, vyjdou stejná jako v tabulce. Ruční číslo by se se sekvencí rozešlo
 * a příští lead by narazil na unikátní index.
 */

import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })

import supabaseAdmin from "../supabase/admin"

const DRY = process.argv.includes("--dry-run")

/** Stavy z listu „Číselníky" přeložené do trychtýře v `leads.status`. */
const ROWS = [
    { company: "Olympia Fitness", contact_person: "Kovalčíková", phone: "605 052 993", website: null, status: "negotiating", priority: "vysoka", meeting_at: "2026-09-09T12:00:00+02:00", offered: null },
    { company: "Hydroizolace", contact_person: "Michal Plicka", phone: "728 918 177", website: "www.hydroizolacemiva.cz", status: "new", priority: null, meeting_at: null, offered: "Růst — zdarma / referenční klient" },
    { company: "Agroslovakia/Agroinvest", contact_person: "Vladimir Zpěváček", phone: "723 812 289", website: "www.agroinvest.cz", status: "negotiating", priority: null, meeting_at: null, offered: null },
    { company: "Prosté krabičky", contact_person: "Jan Folta", phone: "775 368 937", website: "www.prostekrabicky.cz", status: "negotiating", priority: null, meeting_at: "2026-09-09T10:00:00+02:00", offered: null },
    { company: "Radago", contact_person: null, phone: null, website: null, status: "new", priority: null, meeting_at: null, offered: null },
]

async function main() {
    const { data: existing, error: readErr } = await supabaseAdmin
        .from("leads")
        .select("company")
        .in("company", ROWS.map(r => r.company))

    if (readErr) {
        console.error("❌ Čtení evidence selhalo:", readErr.message)
        process.exit(1)
    }

    const have = new Set((existing ?? []).map(r => (r.company ?? "").toLowerCase()))
    const todo = ROWS.filter(r => !have.has(r.company.toLowerCase()))

    console.log(`📋 ${ROWS.length} řádků z tabulky, ${todo.length} k zavedení${DRY ? "  (dry-run)" : ""}`)
    for (const row of todo) {
        const meeting = row.meeting_at ? `  · schůzka ${new Date(row.meeting_at).toLocaleString("cs-CZ")}` : ""
        console.log(`   ${row.company}${meeting}`)
    }

    if (DRY || todo.length === 0) return

    // Vloženo v pořadí tabulky, aby čísla vyšla stejně jako tam.
    for (const row of todo) {
        const { data, error } = await supabaseAdmin
            .from("leads")
            .insert({ ...row, source: "manual", source_ref: "evidence_klientu.xlsx", client_type: "firma" })
            .select("ref, company")
            .single()

        if (error) {
            console.error(`❌ ${row.company}: ${error.message}`)
            process.exit(1)
        }
        console.log(`   ✅ ${data.ref}  ${data.company}`)
    }

    console.log(`\n✅ Hotovo — ${todo.length} kontaktů v evidenci. Tabulku v Drive už nikdo nepotřebuje.`)
}

main().catch(err => { console.error(err); process.exit(1) })
