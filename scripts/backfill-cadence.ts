/**
 * Backfill real posting cadence (ClientConfig.postsPerWeek) for EXISTING clients from their
 * actual Instagram history. New onboardings seed this automatically (estimatePostsPerWeek over
 * the scraped feed); this script catches clients onboarded before the field existed — otherwise
 * they sit on validateConfig's default of 4 forever.
 *
 *   npx tsx scripts/backfill-cadence.ts            # every client
 *   npx tsx scripts/backfill-cadence.ts <slug>     # one client
 *   npx tsx scripts/backfill-cadence.ts --dry      # preview only, no writes (still scrapes)
 *
 * Reads config.instagram, scrapes recent posts, derives posts/week (clamped 2–7), writes it to
 * clients.config and invalidates the config cache. Clients with no IG handle or too little dated
 * history are left on the default 4. Idempotent: re-running re-derives from a fresh scrape.
 */
import supabaseAdmin from '../supabase/admin'
import { loadConfig, invalidateConfigCache } from '../instagram/configs'
import { fetchInstagramProfile, estimatePostsPerWeek } from '../lib/ig-scraper'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

type Result = { slug: string; handle: string; before: number; after: number | null; note: string }

async function main() {
    const args = process.argv.slice(2)
    const dry = args.includes('--dry')
    const slugArg = args.find(a => !a.startsWith('--'))

    let query = supabaseAdmin.from('clients').select('id, slug, config').order('slug')
    if (slugArg) query = query.eq('slug', slugArg)
    const { data: clients, error } = await query
    if (error) { console.error('❌ Failed to list clients:', error.message); process.exit(1) }
    if (!clients?.length) { console.error(`❌ No clients found${slugArg ? ` for slug "${slugArg}"` : ''}`); process.exit(1) }

    console.log(`\n📊 Cadence backfill${dry ? ' (DRY RUN — no writes)' : ''} — ${clients.length} client(s)\n`)

    const results: Result[] = []
    for (const client of clients as { id: string; slug: string }[]) {
        const { id: clientId, slug } = client

        let config
        try { config = await loadConfig(slug) }
        catch (e) { results.push({ slug, handle: '—', before: 4, after: null, note: `loadConfig failed: ${(e as Error).message}` }); continue }

        const before = config.postsPerWeek || 4
        const handle = (config.instagram || '').replace(/^@/, '').trim()
        if (!handle) { results.push({ slug, handle: '—', before, after: null, note: 'no IG handle' }); continue }

        let estimate: number | null = null
        try {
            const ig = await fetchInstagramProfile(handle)
            await sleep(1200) // be gentle on HikerAPI
            if (!ig) { results.push({ slug, handle, before, after: null, note: 'scrape returned nothing' }); continue }
            estimate = estimatePostsPerWeek(ig.recentPosts.map(p => p.timestamp))
        } catch (e) {
            results.push({ slug, handle, before, after: null, note: `scrape error: ${(e as Error).message}` }); continue
        }

        if (estimate == null) { results.push({ slug, handle, before, after: null, note: 'too little dated history → kept default' }); continue }

        if (!dry) {
            config.postsPerWeek = estimate
            const { error: upErr } = await supabaseAdmin.from('clients').update({ config }).eq('id', clientId)
            if (upErr) { results.push({ slug, handle, before, after: estimate, note: `write failed: ${upErr.message}` }); continue }
            invalidateConfigCache(slug)
        }
        results.push({ slug, handle, before, after: estimate, note: dry ? 'would set' : 'updated' })
    }

    // ── Report ──
    console.log('SLUG'.padEnd(26), 'IG'.padEnd(22), 'CADENCE', '  NOTE')
    console.log('─'.repeat(80))
    for (const r of results) {
        const change = (r.after == null ? `${r.before}→—` : `${r.before}→${r.after}`).padEnd(7)
        console.log(r.slug.padEnd(26), r.handle.padEnd(22), change, '  ' + r.note)
    }
    const changed = results.filter(r => r.note === 'updated' || r.note === 'would set').length
    console.log('─'.repeat(80))
    console.log(`\n✅ ${dry ? 'Would update' : 'Updated'} ${changed}/${results.length} client(s).${dry ? ' Re-run without --dry to apply.' : ''}\n`)
}

main().catch(e => { console.error(e); process.exit(1) })
