/**
 * Opuštěné značky — najdi je, ukaž je, deaktivuj je.
 * ==================================================
 *   npx tsx scripts/neaktivni-klienti.ts              # jen ukáže, nic nemění
 *   npx tsx scripts/neaktivni-klienti.ts --dny=180    # přísnější/mírnější hranice
 *   npx tsx scripts/neaktivni-klienti.ts --deaktivuj  # is_active = false + deactivated_at
 *
 * DEAKTIVUJE, NIKDY NEMAŽE. „Promazat" je v zadání, ale mazání by tu bylo
 * horší řešení téhož problému:
 *
 *   • `is_active = false` značku vyřadí ze VŠECH pravidelných běhů — kontrola
 *     zdraví, obchodní e-maily, doplňování nápadů i automatické publikování
 *     filtrují právě tenhle sloupec. To je celý praktický užitek „promazání".
 *   • Smazání je nevratné a kaskáduje přes všechny `ig_*` tabulky. Kdyby se
 *     člověk vrátil, přijde o konfiguraci značky, hotové příspěvky i naučené
 *     preference — tedy přesně o to, co ho může přivést zpátky.
 *   • Doktrína repozitáře: podmíněný claim, nikdy destruktivní fallback.
 *
 * Deaktivace zapisuje i `deactivated_at` — razítko začátku karantény. Po 30 dnech
 * ticha v karanténě jde značka do druhého stupně (`scripts/smazat-opustene-klienty.ts`),
 * který maže nebo anonymizuje. Tenhle skript sám dál nemaže nic.
 *
 * Na skutečné smazání je `scripts/delete-reference-clients.ts` — ten ale maže
 * jen značky označené `isReference`, tedy naše vlastní výmysly.
 *
 * KRITÉRIUM (tři podmínky, musí platit všechny naráz)
 * --------------------------------------------------
 * Otázka „podle čeho poznáme neaktivního klienta" má u tohohle produktu jinou
 * odpověď než „kdy se naposledy přihlásil". Přihlášení bez obsahu není retence
 * a `auth.users.last_sign_in_at` se navíc přes PostgREST filtrovat nedá — stejná
 * úvaha jako v `lib/agents/client-health.ts`, kde se aktivita taky odvozuje
 * z obsahu.
 *
 *   1. ŽÁDNÝ NOVÝ OBSAH po `--dny` (výchozí 90). Zamčené atrapy měsíčního plánu
 *      (`plan_locked`) se nepočítají: vznikly jedním kliknutím a o životě značky
 *      neříkají nic.
 *   2. ŽÁDNÉ ŽIVÉ PŘEDPLATNÉ (`active` ani `trialing`). Kdo platí, není neaktivní,
 *      i kdyby měsíc negeneroval — to je práce pro obchod, ne pro tenhle skript.
 *   3. NIKDY NEZAPLATIL. Zákazník, který jednou zaplatil, se nedeaktivuje
 *      automaticky; jeho odchod je obchodní událost a patří k němu člověk.
 *
 * Značky z výlohy (`config.isPortfolio`) se přeskakují vždy — ty mají být tiché.
 */
import supabaseAdmin from '../supabase/admin'
import { isShowcaseConfig } from '../lib/audience'

/** Kolik dní ticha z opuštěné značky dělá kandidáta. Čtvrt roku, ne dva týdny. */
const DEFAULT_DNY = 90

/** Stavy předplatného, které znamenají „tenhle účet žije". */
const ZIVE = new Set(['active', 'trialing'])

const DEN_MS = 24 * 60 * 60 * 1000

interface Kandidat {
    id: string
    name: string
    slug: string
    dniTicha: number | null
    postu: number
    predplatne: string
    vlastnik: string
}

async function main() {
    const args = process.argv.slice(2)
    const dny = Number(args.find(a => a.startsWith('--dny='))?.split('=')[1] || DEFAULT_DNY)
    const deaktivuj = args.includes('--deaktivuj')
    if (!Number.isFinite(dny) || dny < 1) {
        console.error('❌ --dny musí být kladné číslo')
        process.exit(1)
    }

    const { data: clients, error } = await supabaseAdmin
        .from('clients')
        .select('id, name, slug, config, created_at')
        .eq('is_active', true)
        .order('created_at')
    if (error) { console.error('❌', error.message); process.exit(1) }

    // Tři dotazy nad celými tabulkami místo N dotazů na klienta. Značek jsou
    // jednotky až desítky, příspěvků tisíce — párovat se to dá v paměti.
    const [{ data: posts }, { data: subs }, { data: pays }, { data: links }] = await Promise.all([
        supabaseAdmin.from('ig_posts').select('client_id, created_at, status').neq('status', 'plan_locked'),
        supabaseAdmin.from('subscriptions').select('client_id, status'),
        supabaseAdmin.from('payments').select('client_id, status'),
        supabaseAdmin.from('user_clients').select('client_id, user_id'),
    ])

    const posledni = new Map<string, string>()
    const pocet = new Map<string, number>()
    for (const p of posts || []) {
        pocet.set(p.client_id, (pocet.get(p.client_id) ?? 0) + 1)
        const cur = posledni.get(p.client_id)
        if (!cur || p.created_at > cur) posledni.set(p.client_id, p.created_at)
    }

    const zivePredplatne = new Set<string>()
    const stavPredplatneho = new Map<string, string>()
    for (const s of subs || []) {
        if (!stavPredplatneho.has(s.client_id)) stavPredplatneho.set(s.client_id, s.status)
        if (ZIVE.has(String(s.status).toLowerCase())) zivePredplatne.add(s.client_id)
    }

    const zaplatil = new Set<string>()
    for (const p of pays || []) if (String(p.status).toLowerCase() === 'paid') zaplatil.add(p.client_id)

    const { data: users } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
    const mail = new Map((users?.users || []).map(u => [u.id, (u.email || '').toLowerCase()]))
    const vlastnik = new Map<string, string>()
    for (const l of links || []) if (!vlastnik.has(l.client_id)) vlastnik.set(l.client_id, mail.get(l.user_id) ?? '—')

    const hranice = Date.now() - dny * DEN_MS
    const kandidati: Kandidat[] = []
    const ziji: Kandidat[] = []

    for (const c of clients || []) {
        if (isShowcaseConfig(c.config)) continue

        const last = posledni.get(c.id)
        // Značka bez jediného příspěvku se poměřuje datem založení — jinak by
        // účet, který nikdy nic neudělal, vypadal navždy jako čerstvý.
        const referencni = last ?? c.created_at
        const dniTicha = Math.floor((Date.now() - new Date(referencni).getTime()) / DEN_MS)

        const radek: Kandidat = {
            id: c.id,
            name: c.name,
            slug: c.slug,
            dniTicha,
            postu: pocet.get(c.id) ?? 0,
            predplatne: stavPredplatneho.get(c.id) ?? 'žádné',
            vlastnik: vlastnik.get(c.id) ?? '—',
        }

        const ticho = new Date(referencni).getTime() < hranice
        if (ticho && !zivePredplatne.has(c.id) && !zaplatil.has(c.id)) kandidati.push(radek)
        else ziji.push(radek)
    }

    const radek = (k: Kandidat) =>
        `  ${k.name.slice(0, 26).padEnd(27)}${String(k.dniTicha).padStart(4)} d ticha  ` +
        `${String(k.postu).padStart(3)} postů  ${k.predplatne.padEnd(11)} ${k.vlastnik}`

    console.log(`\n🧹 Opuštěné značky — hranice ${dny} dní bez obsahu, bez živého předplatného, nikdy nezaplatil\n`)
    console.log(`Aktivních značek (mimo výlohu): ${ziji.length + kandidati.length}`)
    console.log(`Z toho k deaktivaci: ${kandidati.length}\n`)

    if (kandidati.length === 0) {
        console.log('✅ Nic k deaktivaci. Všechny značky buď žijí, platí, nebo platily.\n')
        return
    }

    console.log('KANDIDÁTI:')
    for (const k of kandidati) console.log(radek(k))

    if (!deaktivuj) {
        console.log(`\nNic se nezměnilo. Spustit doopravdy: npx tsx scripts/neaktivni-klienti.ts --dny=${dny} --deaktivuj\n`)
        return
    }

    // Podmíněný claim, ne slepý update: kdyby značku mezitím někdo oživil,
    // `eq('is_active', true)` nevrátí řádek a deaktivace se u ní nestane.
    //
    // `deactivated_at` je razítko začátku karantény (migrace
    // 20260912_karantena_klientu.sql). Bez něj by druhý stupeň úklidu
    // (`scripts/smazat-opustene-klienty.ts`) neměl od čeho počítat 30 dní,
    // které zásady zpracování slibují mezi zrušením účtu a smazáním dat.
    let hotovo = 0
    for (const k of kandidati) {
        const { data, error: err } = await supabaseAdmin
            .from('clients')
            .update({ is_active: false, deactivated_at: new Date().toISOString() })
            .eq('id', k.id)
            .eq('is_active', true)
            .select('id')
            .maybeSingle()
        if (err) { console.error(`  ❌ ${k.slug}: ${err.message}`); continue }
        if (!data) { console.log(`  ⏭️  ${k.slug}: mezitím se změnil, přeskakuji`); continue }
        hotovo++
    }
    console.log(`\n✅ Deaktivováno: ${hotovo} z ${kandidati.length}. Zpět se to vrací nastavením is_active = true.`)
    console.log(`   Karanténa běží od teď; druhý stupeň: npx tsx scripts/smazat-opustene-klienty.ts\n`)
}

main().catch(err => { console.error('❌', err); process.exit(1) })
