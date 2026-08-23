-- ai_spend: kam teče útrata za modely MIMO generování příspěvků.
--
-- Naměřeno 23. 8. 2026: Google účtoval za týden 411,78 Kč, ale `ig_generation_log`
-- uměl vysvětlit jen ~100 Kč. Zbytek — tedy tři čtvrtiny — byl neviditelný, protože
-- měřič (`withUsageScope`) obaluje jedinou cestu: `generateOnePost` v autopilot.ts.
-- Největší položka celého týdne (400 nápadů za jeden hromadný běh, ~250 Kč) tak
-- v účetnictví nebyla vůbec a nešlo ji najít jinak než ručním porovnáním s Googlem.
--
-- PROČ VLASTNÍ TABULKA A NE ig_generation_log:
-- Ten je postavený kolem příspěvku — `post_id NOT NULL`, `critic_score`, `qa_status`,
-- `editorial_rounds`. Řádky bez příspěvku by rozbily každý dotaz, který nad ním počítá
-- kvalitu a průměry (health digest, plánovač, moje vlastní analýzy). Útrata bez postu
-- je jiná entita, ne chybějící post.
--
-- RLS deny-all (service-role only) — zapisuje engine přes supabase/admin.ts.
-- Spustit v SQL Editoru.

CREATE TABLE IF NOT EXISTS ai_spend (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Nullable: systémové operace (obchodní agent, crony bez tenanta) klienta nemají.
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  -- Co se dělalo: 'ideas', 'onboarding_analyze', 'onboarding_config',
  -- 'product_design', 'print', … Držet krátké a stabilní — seskupuje se podle toho.
  operation TEXT NOT NULL,
  -- Volitelný odkaz na zdroj (task id, produkt, slug) — kvůli dohledání konkrétního běhu.
  ref_id TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  thought_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  model_calls INTEGER NOT NULL DEFAULT 0,
  -- NULL = některý model nemá známou sazbu. Vymyšlená nula by vypadala jako levný
  -- běh — stejný důvod, proč critic_score loguje null místo ploché sedmičky.
  cost_usd DOUBLE PRECISION,
  -- Rozpad po krocích, ať jde odpovědět „který krok je drahý".
  breakdown JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dotazy jsou vždycky „kolik za období", případně po operaci nebo klientovi.
CREATE INDEX IF NOT EXISTS idx_ai_spend_created ON ai_spend(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_spend_operation ON ai_spend(operation, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_spend_client ON ai_spend(client_id, created_at DESC)
  WHERE client_id IS NOT NULL;

ALTER TABLE ai_spend ENABLE ROW LEVEL SECURITY;
-- Bez politik → deny-all; dostupné jen přes service-role (supabase/admin.ts).
