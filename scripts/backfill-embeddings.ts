/**
 * Backfill embeddings for existing data (pipeline v2, Stage 3).
 * New writes are embedded lazily (embedPendingMemories self-heal + scoreConsistencyAndEmbed
 * per generated post); this catches everything created BEFORE the pgvector migration:
 *   - ig_brand_memory.embedding      (memory relevance retrieval)
 *   - ig_posts.caption_embedding     (gold-voice centroid for the consistency score)
 *
 *   npx tsx scripts/backfill-embeddings.ts            # every client
 *   npx tsx scripts/backfill-embeddings.ts <slug>     # one client
 *   npx tsx scripts/backfill-embeddings.ts --dry      # counts only, no API calls/writes
 *
 * Idempotent: only rows with a NULL embedding are touched. Requires the
 * 20260703_embeddings.sql migration and GEMINI_API_KEY.
 */
import supabaseAdmin from '../supabase/admin'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const BATCH = 20

async function main() {
    const args = process.argv.slice(2)
    const dry = args.includes('--dry')
    const slug = args.find(a => !a.startsWith('--'))

    let clientQuery = supabaseAdmin.from('clients').select('id, slug')
    if (slug) clientQuery = clientQuery.eq('slug', slug)
    const { data: clients, error } = await clientQuery
    if (error || !clients?.length) {
        console.error('No clients found', error?.message || '')
        process.exit(1)
    }

    const { embedTexts } = await import('../instagram/gemini-client')

    for (const client of clients) {
        console.log(`\n▶ ${client.slug}`)

        // 1. Brand memories
        const { data: memories } = await supabaseAdmin
            .from('ig_brand_memory')
            .select('id, content')
            .eq('client_id', client.id)
            .is('embedding', null)
        console.log(`   memories missing embedding: ${memories?.length ?? 0}`)
        if (!dry && memories?.length) {
            for (let i = 0; i < memories.length; i += BATCH) {
                const chunk = memories.slice(i, i + BATCH)
                const vectors = await embedTexts(chunk.map(m => m.content))
                await Promise.all(chunk.map((m, j) =>
                    supabaseAdmin.from('ig_brand_memory').update({ embedding: JSON.stringify(vectors[j]) }).eq('id', m.id)
                ))
                console.log(`   ✓ memories ${Math.min(i + BATCH, memories.length)}/${memories.length}`)
                await sleep(300)
            }
        }

        // 2. Post captions — gold-pool candidates: anything with a caption. Metrics
        // decide gold membership at scoring time, embeddings just need to exist.
        const { data: posts } = await supabaseAdmin
            .from('ig_posts')
            .select('id, caption')
            .eq('client_id', client.id)
            .is('caption_embedding', null)
            .not('caption', 'is', null)
            .neq('status', 'rejected')
        const withText = (posts || []).filter(p => (p.caption || '').trim().length > 20)
        console.log(`   captions missing embedding: ${withText.length}`)
        if (!dry && withText.length) {
            for (let i = 0; i < withText.length; i += BATCH) {
                const chunk = withText.slice(i, i + BATCH)
                const vectors = await embedTexts(chunk.map(p => (p.caption as string).substring(0, 2000)))
                await Promise.all(chunk.map((p, j) =>
                    supabaseAdmin.from('ig_posts').update({ caption_embedding: JSON.stringify(vectors[j]) }).eq('id', p.id)
                ))
                console.log(`   ✓ captions ${Math.min(i + BATCH, withText.length)}/${withText.length}`)
                await sleep(300)
            }
        }
    }

    console.log(`\n${dry ? '🔍 Dry run — no writes' : '✅ Backfill done'}`)
}

main().catch(err => { console.error(err); process.exit(1) })
