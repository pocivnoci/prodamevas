/**
 * Cleanup pro chybné user_clients vazby vytvořené starým fallbackem v
 * checkOnboardingStatus (přilepoval nové účty k prvnímu aktivnímu klientovi
 * jako role='member'). Role 'member' nevzniká nikde jinde, takže VŠECHNY
 * 'member' řádky jsou tyto chybné auto-linky.
 *
 *   npx tsx scripts/cleanup-orphan-links.ts            # dry-run: jen vypíše
 *   npx tsx scripts/cleanup-orphan-links.ts --fix      # smaže všechny 'member' vazby
 *   npx tsx scripts/cleanup-orphan-links.ts <email> --fix   # smaže jen pro daný účet
 */
import supabaseAdmin from '../supabase/admin'

async function main() {
    const args = process.argv.slice(2)
    const fix = args.includes('--fix')
    const email = args.find(a => !a.startsWith('--'))?.toLowerCase()

    let userId: string | undefined
    if (email) {
        for (let page = 1; !userId; page++) {
            const { data } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 })
            userId = data.users.find(u => u.email?.toLowerCase() === email)?.id
            if (data.users.length < 1000) break
        }
        if (!userId) { console.error(`❌ Žádný uživatel s e-mailem ${email}`); process.exit(1) }
    }

    let query = supabaseAdmin
        .from('user_clients')
        .select('user_id, client_id, role, clients(slug, name)')
        .eq('role', 'member')
    if (userId) query = query.eq('user_id', userId)

    const { data: rows, error } = await query
    if (error) { console.error('❌ Dotaz selhal:', error.message); process.exit(1) }
    if (!rows || rows.length === 0) { console.log('✅ Žádné chybné (member) vazby nenalezeny.'); return }

    console.log(`Nalezeno ${rows.length} chybných 'member' vazeb:`)
    for (const r of rows) {
        console.log(`  • user ${r.user_id} → ${(r.clients as any)?.name} (${(r.clients as any)?.slug})`)
    }

    if (!fix) {
        console.log('\n(dry-run) Spusť s --fix pro smazání.')
        return
    }

    let deleted = 0
    for (const r of rows) {
        const { error: delErr } = await supabaseAdmin
            .from('user_clients')
            .delete()
            .eq('user_id', r.user_id)
            .eq('client_id', r.client_id)
            .eq('role', 'member')
        if (delErr) console.error(`  ❌ ${r.user_id}:`, delErr.message)
        else deleted++
    }
    console.log(`\n✅ Smazáno ${deleted} vazeb. Dotčené účty teď půjdou do onboardingu.`)
}

main().catch(e => { console.error(e); process.exit(1) })
