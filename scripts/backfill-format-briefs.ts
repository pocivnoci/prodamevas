/**
 * Backfill format creative briefs (PostTypeDef.structure + visualStyle) for EXISTING clients.
 * New onboardings and the Settings "✨ Vyplnit" flow generate these automatically (v8.0);
 * this script catches formats created before the fields existed — otherwise only new clients
 * benefit from format-driven structure (copywriter) and visual grounding (AI Designer).
 *
 *   npx tsx scripts/backfill-format-briefs.ts            # every client
 *   npx tsx scripts/backfill-format-briefs.ts <slug>     # one client
 *   npx tsx scripts/backfill-format-briefs.ts --dry      # preview only, no writes (still calls AI)
 *
 * One AI call per client (textPro ladder), grounded on brand + pillars + live product catalog.
 * Fills ONLY missing fields — an existing structure/visualStyle is never overwritten ("new data
 * wins, but never replace a real value with nothing" applies in both directions). Patches the
 * RAW config row (no validateConfig materialization). Idempotent: a re-run finds nothing to fill.
 */
import supabaseAdmin from '../supabase/admin'
import { invalidateConfigCache } from '../instagram/configs'
import { getCatalogProducts } from '../instagram/service'
import { generateText } from '../instagram/gemini-client'
import { getModel } from '../instagram/models'
import type { PostTypeDef } from '../instagram/configs/types'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

type Result = { slug: string; formats: number; filled: number; note: string }

async function fillClient(clientId: string, slug: string, config: any, dry: boolean): Promise<Result> {
    const defs: PostTypeDef[] = Array.isArray(config.postTypeDefs) ? config.postTypeDefs : []
    if (defs.length === 0) return { slug, formats: 0, filled: 0, note: 'no postTypeDefs (legacy generic client)' }

    const missing = defs.filter(d => !d.structure?.trim() || !d.visualStyle?.trim())
    if (missing.length === 0) return { slug, formats: defs.length, filled: 0, note: 'already complete' }

    const pillars: Record<string, any> = config.contentPillars || {}
    const pillarList = Object.entries(pillars)
        .map(([k, p]: [string, any]) => `- ${p?.label || k}${p?.description ? `: ${p.description}` : ''}`)
        .join('\n')
    let productNames = ''
    try {
        const products = await getCatalogProducts(clientId, config.products)
        productNames = products.map((p: any) => p?.name).filter(Boolean).slice(0, 8).join(', ')
    } catch { /* products are optional grounding */ }

    const formatList = missing.map(d =>
        `- name: "${d.name}" | ${d.display_name} (${d.medium}${d.uses_product ? ', s produktem' : ''}): ${d.description}`
    ).join('\n')

    const prompt = `Jsi Instagram stratég. Pro existující formáty příspěvků téhle značky doplň kreativní brief — strukturu obsahu a vizuální styl.

Firma: ${config.name || slug}${config.industry ? ` (${config.industry})` : ''}
${productNames ? `Produkty/služby: ${productNames}` : ''}
Pilíře obsahu:
${pillarList || '—'}

Formáty k doplnění:
${formatList}

Vrať POUZE JSON pole, jeden objekt pro KAŽDÝ formát výše (name musí přesně sedět):
[{
  "name": "přesný name formátu z výčtu",
  "structure": "kostra obsahu, česky. Pro carousel: osnova slide po slidu (Slide 1 COVER: ..., poslední: CTA). Pro reel: osnova scén. Pro image: stavba caption (hook → ... → CTA).",
  "visual_style": "1-2 věty česky: jak mají posty tohohle formátu VYPADAT — kompozice, nálada, rekvizity, práce s textem. Řídí se tím AI designer."
}]

Pravidla: konkrétní pro tuhle značku a daný formát, ne generické fráze. Struktura musí odpovídat médiu formátu.`

    // Same resilient pattern as generateCustomFormats: extract JSON, retry once.
    let parsed: any[] | null = null
    for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
        try {
            const raw = await generateText(prompt, {
                temperature: 0.7,
                model: getModel('textPro'),
                fallbackModel: getModel('textPro', 'fallback'),
            })
            const match = raw.match(/\[[\s\S]*\]/)
            const arr = match ? JSON.parse(match[0]) : null
            if (Array.isArray(arr) && arr.length > 0) parsed = arr
        } catch (e) {
            console.warn(`   ⚠️ ${slug}: AI/parse selhal (pokus ${attempt}/2): ${(e as Error).message}`)
        }
    }
    if (!parsed) return { slug, formats: defs.length, filled: 0, note: 'AI generation failed — skipped' }

    const byName = new Map(parsed.map((p: any) => [String(p?.name || ''), p]))
    let filled = 0
    for (const def of defs) {
        const gen = byName.get(def.name)
        if (!gen) continue
        // Fill ONLY what's missing — never overwrite a value someone already wrote.
        if (!def.structure?.trim() && gen.structure) {
            def.structure = String(gen.structure).slice(0, 600)
            filled++
        }
        if (!def.visualStyle?.trim() && gen.visual_style) {
            def.visualStyle = String(gen.visual_style).slice(0, 400)
            filled++
        }
    }
    if (filled === 0) return { slug, formats: defs.length, filled: 0, note: 'AI returned no usable fields' }

    if (dry) {
        for (const def of defs.filter(d => byName.has(d.name))) {
            console.log(`   · ${slug}/${def.name}: struktura="${def.structure?.substring(0, 70)}…" vizuál="${def.visualStyle?.substring(0, 50)}…"`)
        }
        return { slug, formats: defs.length, filled, note: 'would fill (dry)' }
    }

    const { error: upErr } = await supabaseAdmin
        .from('clients')
        .update({ config: { ...config, postTypeDefs: defs } })
        .eq('id', clientId)
    if (upErr) return { slug, formats: defs.length, filled: 0, note: `write failed: ${upErr.message}` }
    invalidateConfigCache(slug)
    return { slug, formats: defs.length, filled, note: 'updated' }
}

async function main() {
    const args = process.argv.slice(2)
    const dry = args.includes('--dry')
    const slugArg = args.find(a => !a.startsWith('--'))

    let query = supabaseAdmin.from('clients').select('id, slug, config').order('slug')
    if (slugArg) query = query.eq('slug', slugArg)
    const { data: clients, error } = await query
    if (error) { console.error('❌ Failed to list clients:', error.message); process.exit(1) }
    if (!clients?.length) { console.error(`❌ No clients found${slugArg ? ` for slug "${slugArg}"` : ''}`); process.exit(1) }

    console.log(`\n🧩 Format-brief backfill${dry ? ' (DRY RUN — no writes)' : ''} — ${clients.length} client(s)\n`)

    const results: Result[] = []
    for (const client of clients as { id: string; slug: string; config: any }[]) {
        results.push(await fillClient(client.id, client.slug, client.config || {}, dry))
        await sleep(1000) // be gentle on the Pro model
    }

    console.log('\n' + 'SLUG'.padEnd(26), 'FORMATS', 'FILLED', ' NOTE')
    console.log('─'.repeat(72))
    for (const r of results) {
        console.log(r.slug.padEnd(26), String(r.formats).padEnd(7), String(r.filled).padEnd(6), ' ' + r.note)
    }
    const changed = results.filter(r => r.note === 'updated' || r.note === 'would fill (dry)').length
    console.log('─'.repeat(72))
    console.log(`\n✅ ${dry ? 'Would update' : 'Updated'} ${changed}/${results.length} client(s).${dry ? ' Re-run without --dry to apply.' : ''}\n`)
}

main().catch(e => { console.error(e); process.exit(1) })
