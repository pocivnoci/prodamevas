/**
 * Delete the fictional seed/demo clients (config.isReference === true) and all their DB data.
 *
 *   npx tsx scripts/delete-reference-clients.ts --dry    # show plan, delete nothing
 *   npx tsx scripts/delete-reference-clients.ts --yes    # actually delete
 *
 * DB ONLY — does NOT touch storage. The marketing homepage post-wall (app/page.tsx → PostWall)
 * serves images straight from each demo's `ig-posts-<slug>` bucket and its text from the committed
 * `lib/reference-data.ts`; both are left intact so the case-study wall keeps working.
 *
 * Safety: only ever deletes rows whose client is flagged isReference. Children are removed before
 * parents to satisfy FKs; missing tables are tolerated.
 */
import supabaseAdmin from '../supabase/admin'

// Child tables (client_id scoped), ordered so FK-referencing rows go before what they reference.
// ig_posts is deleted near the end (logs/jobs/reviews point at it); clients row is deleted last.
const CHILD_TABLES = [
    'ig_generation_log', 'ig_reviews', 'ig_jobs',
    'ig_brand_memory', 'ig_campaigns', 'ig_post_ideas', 'ig_products',
    'ig_post_types', 'ig_connections', 'ig_categories', 'ig_metrics',
    'ig_calendar', 'ig_scheduled_posts',
    'ig_posts',
    'user_clients',
]

async function main() {
    const args = process.argv.slice(2)
    const dry = args.includes('--dry') || !args.includes('--yes')

    const { data: clients, error } = await supabaseAdmin
        .from('clients')
        .select('id, slug, config')
        .order('slug')
    if (error) { console.error('❌ list clients failed:', error.message); process.exit(1) }

    const demos = (clients || []).filter(c => (c.config as any)?.isReference === true)
    if (demos.length === 0) { console.log('No isReference clients found. Nothing to do.'); return }

    console.log(`\n🗑️  ${dry ? 'PLAN (dry run)' : 'DELETING'} — ${demos.length} reference client(s):`)
    for (const d of demos) console.log(`   • ${d.slug}  (${(d.config as any)?.instagram || '—'})`)
    console.log()

    for (const demo of demos) {
        const { id: clientId, slug } = demo
        // Re-assert the guard per row — never delete a non-reference client.
        if ((demo.config as any)?.isReference !== true) { console.warn(`   ⚠️  ${slug}: not isReference, skipping`); continue }

        const counts: string[] = []
        for (const table of CHILD_TABLES) {
            if (dry) {
                const { count, error: e } = await supabaseAdmin.from(table).select('client_id', { count: 'exact', head: true }).eq('client_id', clientId)
                if (!e && count) counts.push(`${table}:${count}`)
                continue
            }
            const { error: e } = await supabaseAdmin.from(table).delete().eq('client_id', clientId)
            if (e && !/does not exist|could not find/i.test(e.message)) console.warn(`   ⚠️  ${slug}/${table}: ${e.message}`)
        }

        if (dry) {
            console.log(`   ${slug}: ${counts.length ? counts.join('  ') : '(no child rows)'}  + clients row`)
        } else {
            const { error: e } = await supabaseAdmin.from('clients').delete().eq('id', clientId)
            if (e) { console.error(`   ❌ ${slug}: clients delete failed: ${e.message}`); continue }
            console.log(`   ✅ ${slug}: deleted`)
        }
    }

    if (dry) console.log('\nDry run — re-run with --yes to delete. Storage buckets are NOT touched.\n')
    else console.log('\n✅ Done. Storage (ig-posts-<slug>, logos) left intact — marketing wall unaffected.\n')
}

main().catch(e => { console.error(e); process.exit(1) })
