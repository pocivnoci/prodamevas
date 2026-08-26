-- Priorita ve frontě: z popisku skutečné pořadí. A Impérium přestává slibovat agentury.
--
-- KONTEXT (audit ceníku 26. 8. 2026):
-- „Prioritní generování" se prodávalo na Dominanci a „Nejvyšší priorita ve frontě"
-- na Impériu, jenže `features.priority` nečetl žádný kód kromě řádku, který ten
-- popisek vykreslil. Kampaně se braly čistě FIFO podle `created_at`. Byl to placený
-- slib bez implementace.
--
-- Boolean by to nespravil ani po implementaci: Dominance i Impérium měly `true`,
-- takže by vyšly stejně — a Impérium přitom inzeruje „NEJVYŠŠÍ". Proto stupnice:
--   0  = Start, Růst      (bez přednosti)
--   10 = Dominance        („prioritní generování")
--   20 = Impérium         („nejvyšší priorita ve frontě")
--
-- `max_projects` u Impéria jde 3 → 1: víceprofilovost nikdy nebyla implementovaná
-- ani vynucovaná (to pole nečetl vůbec nikdo), takže „plný objem pro agentury"
-- prodával něco, co zákazník nedostal. Impérium je nejvyšší úroveň pro JEDNU
-- značku. Až bude víc profilů reálných, je to samostatná změna — předplatné dnes
-- visí na `client_id`, ne na účtu, takže je to přestavba fakturace, ne JSON.
--
-- Spustit v SQL Editoru. Idempotentní.

-- ─── 1. Fronta kampaní umí přednost ─────────────────────────────────────────
-- Denormalizovaně na řádku, ne joinem na tarif: PostgREST neumí řadit přes join
-- a worker běží každou minutu, takže dohledávat tarif ke každému kandidátovi by
-- z jednoho dotazu udělalo N+1. Stejný vzor jako `agent_tasks.priority`.
ALTER TABLE ig_campaigns
    ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0;

-- Řadicí index kopíruje ORDER BY workeru (priority DESC, created_at ASC) nad
-- řádky, které vůbec můžou být ve frontě.
CREATE INDEX IF NOT EXISTS idx_ig_campaigns_queue
    ON ig_campaigns(priority DESC, created_at ASC)
    WHERE status IN ('pending', 'running');

-- ─── 2. Tarify: priorita jako číslo ─────────────────────────────────────────
-- jsonb_set přepisuje JEN dotčený klíč — přepsat celý `features` by smazalo
-- cokoliv, co do něj mezitím přibylo.
UPDATE subscription_plans
SET features = jsonb_set(features, '{priority}', '0'::jsonb, true)
WHERE id IN ('chrlit_start', 'chrlit_rust');

UPDATE subscription_plans
SET features = jsonb_set(features, '{priority}', '10'::jsonb, true)
WHERE id = 'chrlit_dominance';

UPDATE subscription_plans
SET features = jsonb_set(features, '{priority}', '20'::jsonb, true)
WHERE id = 'chrlit_imperium';

-- Trial nemá přednost před nikým, kdo platí.
UPDATE subscription_plans
SET features = jsonb_set(features, '{priority}', '0'::jsonb, true)
WHERE id = 'trial_v2';

-- Legacy tarify (`pro`, `agency`, `business`, `chrlit`…) se schválně NEMĚNÍ:
-- jsou neaktivní a `planPriority()` v lib/pricing.ts jejich `true` přečte jako 10,
-- takže ani starý řádek nemůže shodit ORDER BY nad integer sloupcem.

-- ─── 3. Impérium přestává být agenturní ─────────────────────────────────────
UPDATE subscription_plans
SET features = jsonb_set(features, '{max_projects}', '1'::jsonb, true),
    description = 'Postav impérium — 220 kreditů/měs pro jednu značku, product studio, nejvyšší přednost ve frontě'
WHERE id = 'chrlit_imperium';

UPDATE subscription_plans
SET description = 'Ovládni svůj trh — 100 kreditů/měs vč. reels, product studio, přednost ve frontě'
WHERE id = 'chrlit_dominance';
