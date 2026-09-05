/**
 * Naplní ověřená fakta (ClientConfig.brandFacts) EXISTUJÍCÍM klientům z jejich webu.
 *
 * Nové onboardingy si fakta odnesou samy (extractFactsFromPages v analyzeWebsiteCore).
 * Tenhle skript dohání klienty onboardované dřív, než pole existovalo — bez něj jim
 * faktická brána nepovolí ani údaj, který mají černé na bílém na vlastním webu, a
 * příspěvky zbytečně zvágní.
 *
 *   npx tsx scripts/backfill-brand-facts.ts              # všichni bez faktů
 *   npx tsx scripts/backfill-brand-facts.ts <slug>       # jeden klient
 *   npx tsx scripts/backfill-brand-facts.ts --dry        # jen ukáže, co by zapsal
 *   npx tsx scripts/backfill-brand-facts.ts --force      # i klienti, co už fakta mají (slučuje)
 *
 * Nikdy nemaže: `mergeFacts` přidává jen to, co v seznamu ještě není, takže ručně
 * zadaný fakt sken nepřepíše. Idempotentní — druhý běh nic nezdvojí.
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import supabaseAdmin from '../supabase/admin'
import { loadConfig, invalidateConfigCache } from '../instagram/configs'
import { suggestFactsFromSite, mergeFacts } from '../lib/brand-facts'

type Result = { slug: string; before: number; added: number; note: string }

async function main() {
    const args = process.argv.slice(2)
    const dry = args.includes('--dry')
    const force = args.includes('--force')
    const slugArg = args.find(a => !a.startsWith('--'))

    let query = supabaseAdmin.from('clients').select('id, slug').order('slug')
    if (slugArg) query = query.eq('slug', slugArg)
    const { data: clients, error } = await query
    if (error) { console.error('❌ Nepodařilo se načíst klienty:', error.message); process.exit(1) }
    if (!clients?.length) { console.error(`❌ Žádný klient${slugArg ? ` pro slug "${slugArg}"` : ''}`); process.exit(1) }

    console.log(`\n🧾 Backfill ověřených faktů${dry ? ' (DRY RUN — nic se nezapisuje)' : ''} — ${clients.length} klient(ů)\n`)

    const results: Result[] = []
    for (const client of clients as { id: string; slug: string }[]) {
        const { id: clientId, slug } = client

        let config
        try { config = await loadConfig(slug) }
        catch (e) { results.push({ slug, before: 0, added: 0, note: `loadConfig selhal: ${(e as Error).message}` }); continue }

        const before = (config.brandFacts || []).length
        if (before > 0 && !force) { results.push({ slug, before, added: 0, note: 'už má fakta (přeskočeno, --force je slučuje)' }); continue }
        if (!config.website) { results.push({ slug, before, added: 0, note: 'bez adresy webu' }); continue }

        let merged
        try {
            const found = await suggestFactsFromSite(config.name || slug, config.website, { clientId })
            merged = mergeFacts(config.brandFacts || [], found)
        } catch (e) {
            results.push({ slug, before, added: 0, note: `sken selhal: ${(e as Error).message}` }); continue
        }

        const added = merged.length - before
        if (added === 0) { results.push({ slug, before, added: 0, note: 'web neuvádí žádný nový konkrétní údaj' }); continue }

        for (const f of merged.slice(before)) console.log(`   • ${slug}: ${f.text}  ⟵ ${f.source || '—'}`)

        if (!dry) {
            config.brandFacts = merged
            const { error: upErr } = await supabaseAdmin.from('clients').update({ config }).eq('id', clientId)
            if (upErr) { results.push({ slug, before, added, note: `zápis selhal: ${upErr.message}` }); continue }
            invalidateConfigCache(slug)
        }
        results.push({ slug, before, added, note: dry ? 'zapsal by' : 'zapsáno' })
    }

    console.log('\n' + 'SLUG'.padEnd(28), 'FAKTA'.padEnd(10), 'POZNÁMKA')
    console.log('─'.repeat(80))
    for (const r of results) console.log(r.slug.padEnd(28), `${r.before}→${r.before + r.added}`.padEnd(10), r.note)
    const changed = results.filter(r => r.added > 0).length
    console.log('─'.repeat(80))
    console.log(`\n✅ ${dry ? 'Zapsal by' : 'Zapsáno'} u ${changed}/${results.length} klientů.${dry ? ' Bez --dry se to provede.' : ''}\n`)
}

main().catch(e => { console.error(e); process.exit(1) })
