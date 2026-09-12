/**
 * Druhý stupeň úklidu — po karanténě smazat, a kde nejde, anonymizovat.
 * =====================================================================
 *   npx tsx scripts/smazat-opustene-klienty.ts            # jen ukáže, nic nemění
 *   npx tsx scripts/smazat-opustene-klienty.ts --dny=60   # delší karanténa
 *   npx tsx scripts/smazat-opustene-klienty.ts --yes      # provede
 *
 * PROČ EXISTUJE
 * -------------
 * `scripts/neaktivni-klienti.ts` značku jen deaktivuje (`is_active = false`
 * + `deactivated_at`). To je první stupeň a je vratný. Zásady zpracování
 * (`app/privacy/page.tsx`) ale slibují, že údaje účtu a obsah se **30 dní po
 * zrušení účtu smažou nebo anonymizují** — a slib, který nemá kdo splnit, je
 * jen text na stránce. Tohle je ten druhý stupeň.
 *
 * CO DĚLÁ
 * -------
 * Kandidát = `is_active = false` ∧ `deactivated_at` starší než `--dny`
 * (výchozí 30) ∧ není výloha (`isPortfolio`) ani reference (`isReference`)
 * ∧ nemá žádné připojené `ig_connections`. Pak podle peněz:
 *
 *   • MÁ řádek v `invoices` NEBO `payments` → **ANONYMIZACE**. Smaže se obsah
 *     (`ig_*` tabulky) a bucket, ale řádek `clients` zůstane s neutrálními údaji.
 *     Důvod je tvrdý: `invoices.client_id` i `payments.client_id` mají
 *     ON DELETE CASCADE (`supabase/migrations/20260730_billing_invoices.sql`),
 *     takže DELETE klienta by smazal daňové doklady — a ty musíme podle zákona
 *     držet ~10 let (zásady to výslovně říkají a žádostí o výmaz se to nezkrátí).
 *   • NEMÁ ani jedno → **TVRDÉ SMAZÁNÍ**: bucket, profil u upload-postu, obsah
 *     a nakonec řádek `clients`.
 *
 * CO NEDĚLÁ
 * ---------
 *   • Nedeaktivuje. Kandidáty vyrábí první stupeň, tenhle skript jen dojíždí.
 *   • Nesahá na značku, která vypadla z karantény (mezitím `is_active = true`) —
 *     před každým mazáním je podmíněný claim na `is_active = false`.
 *   • Nesahá na `audit-screenshots` ani na jiný sdílený bucket (viz
 *     `lib/storage-cleanup.ts`): ten patří víc značkám naráz.
 *   • Nemaže doklady, platby ani předplatné. Nikdy, u nikoho.
 *   • Nemaže uživatele v `auth.users` — jeden člověk může mít víc značek a účet
 *     není majetek klienta. Vazba `user_clients` padá s klientem.
 */
import supabaseAdmin from '../supabase/admin'
import { isShowcaseConfig } from '../lib/audience'
import { emptyBucket, SDILENE_BUCKETY } from '../lib/storage-cleanup'
import { deleteProfile } from '../lib/channels/uploadpost-profiles'

/** Kolik dní karantény musí uplynout, než se data smažou. „30 dní po zrušení" ze zásad. */
const DEFAULT_DNY = 30

const DEN_MS = 24 * 60 * 60 * 1000

/**
 * Obsahové tabulky značky — mizí při smazání i při anonymizaci.
 *
 * Pořadí je od listů ke kořeni (`ig_posts` až nakonec), aby FK nevadily i tam,
 * kde kaskáda není. Chybějící tabulka se toleruje: schéma se vyvíjí a jeden
 * zapomenutý název nesmí zastavit úklid.
 *
 * Peníze v seznamu ZÁMĚRNĚ nejsou: `payments`, `invoices`, `subscriptions`,
 * `credit_transactions` ani `ig_billing_details` (subjekt dokladu) se nemažou.
 */
const OBSAHOVE_TABULKY = [
    'ig_generation_log', 'ig_reviews', 'ig_jobs', 'ig_metrics', 'ig_growth_snapshots',
    'ig_brand_memory', 'ig_campaigns', 'ig_post_ideas',
    'ig_product_designs', 'ig_product_ideas', 'ig_product_lines',
    'ig_products', 'ig_product_categories', 'ig_categories',
    'ig_post_types', 'ig_connections', 'ig_calendar', 'ig_content_calendar',
    'ig_scheduled_posts',
    'ig_posts',
    'client_handoffs', 'user_clients',
]

interface Kandidat {
    id: string
    slug: string
    name: string
    config: any
    deactivatedAt: string
    dniKarantény: number
    /** Má platbu nebo doklad → jen anonymizace. */
    maPenize: boolean
}

/** Chybějící tabulka/sloupec není chyba úklidu — schéma se vyvíjí. */
const chybiTabulka = (msg: string) => /does not exist|could not find|schema cache/i.test(msg)

async function pocetRadku(table: string, clientId: string): Promise<number | null> {
    const { count, error } = await supabaseAdmin
        .from(table)
        .select('client_id', { count: 'exact', head: true })
        .eq('client_id', clientId)
    // Chybějící tabulka i jakákoli jiná chyba znamenají „nevím" — dry run
    // radši nezobrazí číslo, než aby ukázal nulu tam, kde řádky být můžou.
    if (error) {
        if (!chybiTabulka(error.message)) console.warn(`     ⚠️  ${table}: ${error.message}`)
        return null
    }
    return count ?? 0
}

async function smazObsah(clientId: string, slug: string): Promise<void> {
    for (const table of OBSAHOVE_TABULKY) {
        const { error } = await supabaseAdmin.from(table).delete().eq('client_id', clientId)
        if (error && !chybiTabulka(error.message)) {
            throw new Error(`${slug}/${table}: ${error.message}`)
        }
    }
}

/** Bucket značky. Sdílený default se nikdy nevyprazdňuje — patří i ostatním. */
async function vyprazdniBucket(config: any, dryRun: boolean): Promise<string> {
    const bucket = typeof config?.storageBucket === 'string' ? config.storageBucket : ''
    if (!bucket) return 'bez vlastního bucketu'
    if (SDILENE_BUCKETY.has(bucket)) return `${bucket} je sdílený — nechávám`
    try {
        const n = await emptyBucket(bucket, { dryRun })
        return `${bucket}: ${n} souborů${dryRun ? ' (jen počet)' : ' smazáno'}`
    } catch (err: any) {
        return `${bucket}: ⚠️ ${err?.message || err}`
    }
}

async function main() {
    const args = process.argv.slice(2)
    const dny = Number(args.find(a => a.startsWith('--dny='))?.split('=')[1] || DEFAULT_DNY)
    const ostry = args.includes('--yes')
    if (!Number.isFinite(dny) || dny < 1) {
        console.error('❌ --dny musí být kladné číslo')
        process.exit(1)
    }

    const hranice = new Date(Date.now() - dny * DEN_MS)

    const { data: clients, error } = await supabaseAdmin
        .from('clients')
        .select('id, slug, name, config, deactivated_at')
        .eq('is_active', false)
        .not('deactivated_at', 'is', null)
        .lt('deactivated_at', hranice.toISOString())
        .order('deactivated_at')
    if (error) { console.error('❌', error.message); process.exit(1) }

    // Dva dotazy nad celými tabulkami místo N na klienta — řádků jsou jednotky.
    const [{ data: invoices }, { data: pays }, { data: conns }] = await Promise.all([
        supabaseAdmin.from('invoices').select('client_id'),
        supabaseAdmin.from('payments').select('client_id'),
        supabaseAdmin.from('ig_connections').select('client_id, status'),
    ])
    const sDokladem = new Set((invoices || []).map(i => i.client_id))
    const sPlatbou = new Set((pays || []).map(p => p.client_id))
    const pripojeni = new Set((conns || []).filter(c => String(c.status).toLowerCase() === 'connected').map(c => c.client_id))

    const kandidati: Kandidat[] = []
    const preskoceni: string[] = []

    for (const c of clients || []) {
        const cfg = c.config as any
        // Výloha ani reference nejsou zákazníci — a jejich obsah drží marketing.
        if (isShowcaseConfig(cfg) || cfg?.isReference === true) {
            preskoceni.push(`${c.slug}: výloha/reference`)
            continue
        }
        // Připojený Instagram = někdo si účet dál drží, i když je vypnutý.
        if (pripojeni.has(c.id)) {
            preskoceni.push(`${c.slug}: má připojený Instagram`)
            continue
        }
        kandidati.push({
            id: c.id,
            slug: c.slug,
            name: c.name,
            config: cfg,
            deactivatedAt: c.deactivated_at,
            dniKarantény: Math.floor((Date.now() - new Date(c.deactivated_at).getTime()) / DEN_MS),
            maPenize: sDokladem.has(c.id) || sPlatbou.has(c.id),
        })
    }

    console.log(`\n🗑️  Opuštěné značky po karanténě — hranice ${dny} dní od deaktivace\n`)
    if (preskoceni.length) {
        console.log('PŘESKOČENO:')
        for (const p of preskoceni) console.log(`  ⏭️  ${p}`)
        console.log()
    }
    if (kandidati.length === 0) {
        console.log('✅ Nic k úklidu. Žádná značka není v karanténě dost dlouho.\n')
        return
    }

    console.log(`KANDIDÁTI (${kandidati.length}):`)
    for (const k of kandidati) {
        const rezim = k.maPenize ? 'ANONYMIZACE (má platbu/doklad)' : 'SMAZÁNÍ'
        console.log(`  ${k.slug.padEnd(28)} ${String(k.dniKarantény).padStart(4)} d karantény   ${rezim}`)
    }

    if (!ostry) {
        console.log('\nPOČTY ŘÁDKŮ (dry run — nic se nemaže):')
        for (const k of kandidati) {
            const casti: string[] = []
            for (const t of OBSAHOVE_TABULKY) {
                const n = await pocetRadku(t, k.id)
                if (n) casti.push(`${t}:${n}`)
            }
            const bucket = await vyprazdniBucket(k.config, true)
            console.log(`  ${k.slug}: ${casti.length ? casti.join('  ') : '(žádný obsah)'}`)
            console.log(`     storage → ${bucket}`)
            if (k.maPenize) console.log('     peníze → doklady, platby i předplatné ZŮSTÁVAJÍ, řádek clients se jen anonymizuje')
        }
        console.log(`\nNic se nezměnilo. Spustit doopravdy: npx tsx scripts/smazat-opustene-klienty.ts --dny=${dny} --yes\n`)
        return
    }

    let smazano = 0
    let anonymizovano = 0
    let chyb = 0

    for (const k of kandidati) {
        // Podmíněný claim: kdyby značku mezitím někdo oživil (is_active = true),
        // claim nevrátí řádek a u téhle značky je konec — ne důvod mazat naslepo.
        const { data: claim, error: claimErr } = await supabaseAdmin
            .from('clients')
            .update({ deactivated_at: k.deactivatedAt })
            .eq('id', k.id)
            .eq('is_active', false)
            .select('id')
            .maybeSingle()
        if (claimErr) { console.error(`  ❌ ${k.slug}: claim selhal — ${claimErr.message}`); chyb++; continue }
        if (!claim) { console.log(`  ⏭️  ${k.slug}: mezitím se oživil, přeskakuji`); continue }

        // Jeden klient nesmí shodit dávku: chyba u jedné značky je log a jedeme dál.
        try {
            const bucket = await vyprazdniBucket(k.config, false)
            await smazObsah(k.id, k.slug)

            if (k.maPenize) {
                // Anonymizace: řádek `clients` zůstává jako držák dokladů, ale
                // nesmí z něj jít poznat, čí značka to byla.
                const { error: anonErr } = await supabaseAdmin
                    .from('clients')
                    .update({
                        name: 'Smazaná značka',
                        website: null,
                        slug: `smazano-${k.id.slice(0, 8)}`,
                        config: { id: `smazano-${k.id.slice(0, 8)}`, name: 'Smazaná značka', anonymizedAt: new Date().toISOString() },
                    })
                    .eq('id', k.id)
                    .eq('is_active', false)
                if (anonErr) throw new Error(`anonymizace: ${anonErr.message}`)
                anonymizovano++
                console.log(`  🕶️  ${k.slug}: anonymizováno (doklady zůstávají) — ${bucket}`)
            } else {
                // Fail-soft: profil u upload-postu je cizí systém a jeho výpadek
                // nesmí zablokovat výmaz, o který si zákazník řekl. Zůstane v logu.
                try { await deleteProfile(k.id) }
                catch (err: any) { console.warn(`     ⚠️  ${k.slug}: profil u upload-postu se nepodařilo smazat — ${err?.message || err}`) }

                const { error: delErr } = await supabaseAdmin
                    .from('clients')
                    .delete()
                    .eq('id', k.id)
                    .eq('is_active', false)
                if (delErr) throw new Error(`clients delete: ${delErr.message}`)
                smazano++
                console.log(`  ✅ ${k.slug}: smazáno — ${bucket}`)
            }
        } catch (err: any) {
            chyb++
            console.error(`  ❌ ${k.slug}: ${err?.message || err}`)
        }
    }

    console.log(`\nHotovo. Smazáno: ${smazano}, anonymizováno: ${anonymizovano}, chyb: ${chyb}.`)
    console.log('Doklady, platby a předplatné zůstaly beze změny — daňová lhůta běží dál.\n')
}

main().catch(err => { console.error('❌', err); process.exit(1) })
