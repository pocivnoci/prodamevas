-- RLS: zavřít dvě díry, které našel audit 2026-09-02
-- ═══════════════════════════════════════════════════════════════════════════
-- Doktrína projektu je „RLS zapnuté, ŽÁDNÉ policy" = deny-all pro anon
-- i authenticated, a všechno čte engine přes `supabase/admin.ts` (service role,
-- RLS obchází) s explicitním filtrem na `client_id`. Tak to má 29 tabulek.
-- Tahle migrace na tu doktrínu dorovnává zbylých pět.
--
-- Spustit v SQL editoru Supabase / přes Management API query endpoint,
-- NIKDY `db push`. Bezpečné opakovaně.

-- ── 1. leads + lead_events: RLS nebylo zapnuté vůbec ────────────────────────
--
-- `leads` drží e-maily, IČO-like údaje a IG handly CIZÍCH firem a osob, které
-- obchodní agent našel scrapingem. Je to nejcitlivější tabulka osobních údajů
-- po `ig_connections` — a jako jediná neměla ani deny-all.
--
-- Zapnutí RLS bez policy nic nerozbije: `lib/agents/sales/*` i cron chodí přes
-- service role, který RLS obchází.
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE leads IS
  'Fronta obchodního agenta. source+discovered_at je doklad o původu kontaktu. RLS deny-all — jen service role.';

-- ── 2. ig_jobs / ig_brand_memory / ig_campaigns: policy USING (true) ────────
--
-- Tyhle tři vznikly v 5–6/2026 s policy, které se jmenují „Users can read OWN
-- jobs", ale jejich tělo je `USING (true)` — tedy bez jakéhokoli omezení, pro
-- roli `public` (anon i authenticated), napříč všemi tenanty. `FOR ALL` navíc
-- bez `WITH CHECK` pouští i ZÁPIS: Postgres v takovém případě použije výraz
-- z `USING` i pro kontrolu zápisu.
--
-- `ig_brand_memory` je přitom naučený hlas značky zákazníka — jádro IP produktu.
--
-- Dnes to nebylo zvenčí zneužitelné (anon klíč se nedostane do klientského
-- bundlu a `supabase/client.ts` nikdo neimportuje), ale byla to mina: jediný
-- import prohlížečového klienta v komponentě a je to venku. Obrana do hloubky
-- v databázi je levnější než disciplína v aplikačním kódu.
--
-- Po smazání zůstane RLS zapnuté bez policy = deny-all, stejně jako u zbytku.
DROP POLICY IF EXISTS "Users can read own jobs" ON ig_jobs;
DROP POLICY IF EXISTS "Service role can manage jobs" ON ig_jobs;

DROP POLICY IF EXISTS "Users can read brand memory" ON ig_brand_memory;
DROP POLICY IF EXISTS "Service role can manage brand memory" ON ig_brand_memory;

DROP POLICY IF EXISTS "Users can read own campaigns" ON ig_campaigns;
DROP POLICY IF EXISTS "Service role can manage campaigns" ON ig_campaigns;

-- RLS musí zůstat zapnuté i po smazání policy (bez něj by tabulka byla otevřená
-- úplně). U všech tří už zapnuté je; `IF NOT EXISTS` varianta pro ALTER není,
-- takže se to prostě zopakuje — je to idempotentní.
ALTER TABLE ig_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_brand_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_campaigns ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE ig_brand_memory IS
  'Naučený hlas značky. RLS deny-all — jen service role; do 9/2026 tu byla policy USING (true).';
