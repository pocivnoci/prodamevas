/**
 * Backtest faktické brány nad SKUTEČNÝMI příspěvky, které už v produkci jsou.
 *
 * Otázka, na kterou odpovídá: kolik z toho, co klientům reálně vzniklo PŘED bránou,
 * by dnes neprošlo — a jak často by naopak brána sáhla na text, který je v pořádku.
 * Bez tohohle čísla je „brána funguje" jenom dojem ze tří ukázek.
 *
 * NIC NEZAPISUJE. Jen čte ig_posts, pouští nad nimi checkCaptionFacts a počítá.
 *
 *   npx tsx scripts/audit-fact-gate.ts                # reální klienti, 5 postů na klienta
 *   npx tsx scripts/audit-fact-gate.ts --per=10       # víc vzorků na klienta
 *   npx tsx scripts/audit-fact-gate.ts --slug=chrlit  # jeden klient
 *   npx tsx scripts/audit-fact-gate.ts --all          # včetně portfolia a referencí
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import supabaseAdmin from '../supabase/admin'
import { loadConfig } from '../instagram/configs'
import { checkCaptionFacts, type FactStatus } from '../instagram/fact-check'
import { withUsageScope, currentUsage } from '../instagram/usage-meter'
import { costUsdForBreakdown } from '../lib/model-pricing'

type Row = { slug: string; status: FactStatus | "chyba"; oprav: number; oznaceno: number; hook: string; flags: string[]; repairs: { from: string; to: string }[] }

async function main() {
    const args = process.argv.slice(2)
    const per = Number(args.find(a => a.startsWith('--per='))?.split('=')[1] || 5)
    const slugArg = args.find(a => a.startsWith('--slug='))?.split('=')[1]
    const includeAll = args.includes('--all')

    let q = supabaseAdmin.from('clients').select('id, slug, config').order('slug')
    if (slugArg) q = q.eq('slug', slugArg)
    const { data: clients, error } = await q
    if (error) { console.error('❌', error.message); process.exit(1) }

    const targets = (clients || []).filter((c: any) =>
        includeAll || (!c.config?.isPortfolio && !c.config?.isReference))

    console.log(`\n🔬 Backtest faktické brány — ${targets.length} klientů × až ${per} příspěvků\n`)

    const rows: Row[] = []
    let costTotal = 0

    for (const client of targets as any[]) {
        const { data: posts } = await supabaseAdmin
            .from('ig_posts')
            .select('id, caption, call_to_action')
            .eq('client_id', client.id)
            .not('caption', 'is', null)
            .order('created_at', { ascending: false })
            .limit(per)
        if (!posts?.length) continue

        let config
        try { config = await loadConfig(client.slug, true) }
        catch { continue }

        for (const post of posts) {
            // Caption v DB je složený text; brána ho vidí jako hook + tělo, tedy tak,
            // jak by ho viděla při generování.
            const lines = (post.caption || '').split('\n').filter(Boolean)
            const draft = {
                hook: lines[0] || '',
                body: lines.slice(1).join('\n').replace(/#\S+/g, '').trim(),
                cta: post.call_to_action || '',
                hashtags: [],
            }
            if (!draft.body && !draft.hook) continue

            try {
                await withUsageScope(async () => {
                    const out = await checkCaptionFacts(config, draft, {})
                    const u = currentUsage()
                    costTotal += (u ? costUsdForBreakdown(u.breakdown as never) : 0) || 0
                    rows.push({
                        slug: client.slug,
                        status: out.judged ? out.status : 'chyba',
                        oprav: out.repairs.length,
                        oznaceno: out.flags.length,
                        hook: draft.hook.slice(0, 46),
                        flags: out.flags,
                        repairs: out.repairs.map(r => ({ from: r.from, to: r.to })),
                    })
                })
            } catch (e) {
                rows.push({ slug: client.slug, status: 'chyba', oprav: 0, oznaceno: 0, hook: draft.hook.slice(0, 46), flags: [String(e).slice(0, 60)], repairs: [] })
            }
        }
        const mine = rows.filter(r => r.slug === client.slug)
        console.log(`  ${client.slug.padEnd(30)} ${mine.length} postů → ${mine.filter(r => r.status === 'clean').length} čistých, ${mine.filter(r => r.status === 'repaired').length} opraveno, ${mine.filter(r => r.status === 'flagged').length} označeno`)
    }

    const n = rows.length || 1
    const pct = (k: number) => `${((k / n) * 100).toFixed(0)} %`
    const clean = rows.filter(r => r.status === 'clean').length
    const repaired = rows.filter(r => r.status === 'repaired').length
    const flagged = rows.filter(r => r.status === 'flagged').length
    const err = rows.filter(r => r.status === 'chyba').length

    console.log('\n' + '─'.repeat(72))
    console.log(`  Příspěvků: ${rows.length}`)
    console.log(`  Čistých:   ${clean} (${pct(clean)})   ← brána by nesáhla`)
    console.log(`  Opraveno:  ${repaired} (${pct(repaired)})`)
    console.log(`  Označeno:  ${flagged} (${pct(flagged)})  ← zůstalo tvrzení k ověření`)
    if (err) console.log(`  Chyb:      ${err}`)
    console.log(`  Cena auditu: $${costTotal.toFixed(3)}`)
    console.log('─'.repeat(72))

    const problem = rows.filter(r => r.status !== 'clean').slice(0, 25)
    if (problem.length) {
        console.log('\nCO BY BRÁNA ŘEŠILA (vzorek):')
        for (const r of problem) {
            console.log(`  [${r.status}] ${r.slug} — "${r.hook}"`)
            for (const f of r.flags.slice(0, 3)) console.log(`        ⚠ ${f}`)
            for (const rep of r.repairs.slice(0, 3)) console.log(`        ✎ "${rep.from.slice(0, 60)}" → "${rep.to.slice(0, 60)}"`)
        }
    }
    console.log()
}

main().catch(e => { console.error(e); process.exit(1) })
