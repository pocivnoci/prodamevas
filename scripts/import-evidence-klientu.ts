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

    if (DRY) return

    // I když se nic nezavádí: čísla se mohla rozejít při dřívějším běhu.
    if (todo.length === 0) { await srovnatCisla(); return }

    // Vloženo v pořadí tabulky, aby čísla vyšla stejně jako tam.
    for (const row of todo) {
        const { data, error } = await supabaseAdmin
            .from("leads")
            .insert({
                ...row,
                source: "manual",
                // Musí být jedinečné na řádek: `leads_source_ref_uniq` je UNIQUE
                // (source, source_ref). Se společnou hodnotou „evidence_klientu.xlsx"
                // projde první řádek a zbytek narazí — a je to tak správně, `source_ref`
                // je podle schématu „id profilu / řádek importu", ne název souboru.
                source_ref: `evidence_klientu.xlsx#${row.company}`,
                client_type: "firma",
            })
            .select("ref, company")
            .single()

        if (error) {
            console.error(`❌ ${row.company}: ${error.message}`)
            process.exit(1)
        }
        console.log(`   ✅ ${data.ref}  ${data.company}`)
    }

    await srovnatCisla()
    console.log(`\n✅ Hotovo — ${todo.length} kontaktů v evidenci. Tabulku v Drive už nikdo nepotřebuje.`)
}

/**
 * Srovná čísla s tabulkou.
 *
 * Sekvence se posouvá i po neúspěšném INSERTu — Postgres ji zpátky nevrací, a je
 * to tak správně, jinak by dva souběžné zápisy dostaly totéž číslo. Jenže tady
 * kvůli tomu jedno zamítnutí posune celý zbytek evidence o jedničku a lidé se na
 * lead odkazují právě tím číslem („co je s K0004").
 *
 * Přejmenovává se odshora dolů, ať je cílové číslo v každém kroku volné, a jen
 * když se liší — druhý běh proto neudělá nic.
 */
async function srovnatCisla() {
    const { data: rows } = await supabaseAdmin
        .from("leads").select("id, ref, company").in("company", ROWS.map(r => r.company))

    const byCompany = new Map((rows ?? []).map(r => [(r.company ?? "").toLowerCase(), r]))

    for (const [i, row] of ROWS.entries()) {
        const want = `K${String(i + 1).padStart(4, "0")}`
        const have = byCompany.get(row.company.toLowerCase())
        if (!have || have.ref === want) continue

        const { error } = await supabaseAdmin.from("leads").update({ ref: want }).eq("id", have.id)
        if (error) {
            console.warn(`   ⚠️  ${row.company}: ${have.ref} → ${want} se nepovedlo (${error.message})`)
            continue
        }
        console.log(`   ↻ ${row.company}: ${have.ref} → ${want}`)
    }
}

main().catch(err => { console.error(err); process.exit(1) })
