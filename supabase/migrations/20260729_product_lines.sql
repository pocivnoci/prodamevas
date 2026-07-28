-- Product lines + print-ready design + product feedback loop
--
-- THREE problems this migration fixes:
--
-- 1. A "product line" (řada) had no representation at all. ig_products.type is
--    free text with no FK, ig_product_categories are render templates that were
--    never joined to the catalog, and ig_products.variants is a write-only dead
--    column. A line that "makes sense" needs an ordered system of SKUs (wash →
--    decontamination → polish → protection → maintenance), so the ordering and
--    the role of each step have to be first-class, not encoded in a name string.
--
-- 2. Generated print designs were never persisted. The design URL lived in React
--    state plus a public bucket URL, so a refresh threw away a paid render, there
--    was no history to diff against for anti-repetition, and A/B variants had
--    nowhere to record a winner.
--
-- 3. Product ideas had no feedback signal. ig_product_ideas.status
--    (review/saved/rejected) influenced nothing — unlike ig_post_ideas, which
--    carries performance_score + cooldown and drives weighted selection. Column
--    names below deliberately mirror ig_post_ideas so getWeightedProductIdeas can
--    mirror getWeightedIdeas (instagram/service.ts) instead of inventing a second
--    scoring vocabulary.
--
-- Schema-drift note: ig_products.last_used_at / times_used already exist in prod
-- (added by hand) but appear in NO migration and NOT in database-schema.sql, even
-- though the product cooldown rotation in instagram/autopilot.ts depends on them.
-- A database provisioned from this repo has silently broken rotation. The IF NOT
-- EXISTS clauses below are a no-op in prod and repair a fresh DB.
--
-- Idempotent throughout — safe to re-run.


-- ═══════════════════════════════════════════════════════════
-- 1. PRODUCT LINES
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ig_product_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  name text NOT NULL,
  slug text NOT NULL,

  -- Strategy — what makes the set cohere as a line rather than a pile of SKUs
  positioning text,            -- for whom / against what
  target_audience text,
  price_tier text,             -- budget | mid | premium
  naming_convention text,      -- the rule every SKU name in the line obeys
  system_logic text,           -- the process the steps form, in prose

  -- The generation brief that produced it (replayable, auditable)
  brief jsonb DEFAULT '{}'::jsonb,
  -- Proposed SKUs live here until approval moves them into ig_products
  skus jsonb DEFAULT '[]'::jsonb,

  -- draft = proposal only. Same doctrine as ig_campaigns drafts: nothing
  -- downstream may act on a draft, and approval is a single-use conditional
  -- claim (UPDATE ... WHERE status='draft'), never an insert fallback.
  status text NOT NULL DEFAULT 'draft',

  -- Progress reporting for the ~1-2 min Pro-ladder run (mirrors plan_runs usage)
  progress text,

  performance_score numeric DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ig_product_lines DROP CONSTRAINT IF EXISTS ig_product_lines_status_check;
ALTER TABLE ig_product_lines ADD CONSTRAINT ig_product_lines_status_check
  CHECK (status IN ('draft', 'generating', 'active', 'archived', 'failed'));

-- Slug is only meaningful once the line is real; two abandoned drafts may
-- collide on an auto-slug, so uniqueness is scoped to non-draft rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ig_product_lines_slug
  ON ig_product_lines (client_id, slug) WHERE status <> 'draft';

CREATE INDEX IF NOT EXISTS idx_ig_product_lines_client
  ON ig_product_lines (client_id, status, updated_at DESC);

ALTER TABLE ig_product_lines ENABLE ROW LEVEL SECURITY;


-- ═══════════════════════════════════════════════════════════
-- 2. CATALOG: line membership + real specs
-- ═══════════════════════════════════════════════════════════

ALTER TABLE ig_products
  ADD COLUMN IF NOT EXISTS line_id uuid REFERENCES ig_product_lines(id) ON DELETE SET NULL,
  -- Position in the line's process. 1-based, contiguous within a line.
  ADD COLUMN IF NOT EXISTS line_step integer,
  -- What this step does ("dekontaminace"), so prompts can reason about the
  -- product's job instead of guessing from its name.
  ADD COLUMN IF NOT EXISTS line_role text,
  -- { volume, application, surface, claims[] } — grounds captions in facts
  ADD COLUMN IF NOT EXISTS specs jsonb,
  -- Schema drift repair (see header) — no-op in prod
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS times_used integer DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_ig_products_line
  ON ig_products (line_id, line_step) WHERE line_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════
-- 3. PRODUCT IDEAS: feedback loop
-- ═══════════════════════════════════════════════════════════
-- Names mirror ig_post_ideas (used_count / last_used_at / cooldown_days /
-- is_active / performance_score) so the weighted-selection code is a mirror,
-- not a fork.

ALTER TABLE ig_product_ideas
  -- -1 = 👎, +1 = 👍, NULL = never rated (exploration candidate)
  ADD COLUMN IF NOT EXISTS rating smallint,
  ADD COLUMN IF NOT EXISTS performance_score numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS used_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS cooldown_days integer DEFAULT 30,
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS line_id uuid REFERENCES ig_product_lines(id) ON DELETE SET NULL;

ALTER TABLE ig_product_ideas DROP CONSTRAINT IF EXISTS ig_product_ideas_rating_check;
ALTER TABLE ig_product_ideas ADD CONSTRAINT ig_product_ideas_rating_check
  CHECK (rating IS NULL OR rating IN (-1, 1));

CREATE INDEX IF NOT EXISTS idx_ig_product_ideas_weighted
  ON ig_product_ideas (client_id, is_active, performance_score DESC);


-- ═══════════════════════════════════════════════════════════
-- 4. PRINT DESIGNS: history, QA record, A/B groups
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ig_product_designs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  product_id uuid REFERENCES ig_products(id) ON DELETE SET NULL,
  idea_id uuid REFERENCES ig_product_ideas(id) ON DELETE SET NULL,
  line_id uuid REFERENCES ig_product_lines(id) ON DELETE SET NULL,

  category_slug text,
  theme text,
  -- The PrintBrief that produced it. Also the anti-repetition corpus: recent
  -- briefs are fed back so the designer stops re-rolling the same composition.
  brief jsonb,

  artwork_url text,        -- flat artwork as rendered (RGB, model resolution)
  artwork_print_url text,  -- alpha + upscaled to print size @300 DPI
  dieline_url text,        -- preview with safe-margin / bleed guides
  mockup_url text,         -- optional photorealistic placement (separate step)
  print_spec jsonb,        -- dimensions, hex colors, material, technology

  -- A/B: variants of one decision share a group; exactly one may win.
  variant_group uuid,
  is_winner boolean DEFAULT false,
  rating smallint,

  qa_score numeric,
  qa_status text,          -- pass | retry_pass | native_forced | failed
  status text NOT NULL DEFAULT 'pending',
  progress text,
  error text,

  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ig_product_designs DROP CONSTRAINT IF EXISTS ig_product_designs_status_check;
ALTER TABLE ig_product_designs ADD CONSTRAINT ig_product_designs_status_check
  CHECK (status IN ('pending', 'running', 'done', 'failed'));

ALTER TABLE ig_product_designs DROP CONSTRAINT IF EXISTS ig_product_designs_rating_check;
ALTER TABLE ig_product_designs ADD CONSTRAINT ig_product_designs_rating_check
  CHECK (rating IS NULL OR rating IN (-1, 1));

CREATE INDEX IF NOT EXISTS idx_ig_product_designs_client
  ON ig_product_designs (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ig_product_designs_variant
  ON ig_product_designs (variant_group) WHERE variant_group IS NOT NULL;

ALTER TABLE ig_product_designs ENABLE ROW LEVEL SECURITY;


-- ═══════════════════════════════════════════════════════════
-- 5. CATEGORIES: print parameters
-- ═══════════════════════════════════════════════════════════
-- The renderer hardcoded aspectRatio "1:1" four times regardless of product.
-- A bottle label is not square and a mug wrap is a ~2.5:1 strip, so the physical
-- shape has to be data, not a constant.

ALTER TABLE ig_product_categories
  -- flat  = artwork sits on the product (apparel, tote, poster)
  -- label = die-cut panel artwork (bottle label, jar, canister)
  -- wrap  = continuous 360° strip (mug, spray can)
  -- poster= standalone printed sheet
  ADD COLUMN IF NOT EXISTS artwork_kind text DEFAULT 'flat',
  ADD COLUMN IF NOT EXISTS aspect_ratio text DEFAULT '1:1',
  -- Printable area in millimetres, "WxH" — drives the 300 DPI upscale target
  ADD COLUMN IF NOT EXISTS print_size_mm text,
  -- For labels: [{ name, width_mm, height_mm, purpose }]
  ADD COLUMN IF NOT EXISTS panels jsonb,
  ADD COLUMN IF NOT EXISTS safe_margin_mm numeric DEFAULT 3,
  ADD COLUMN IF NOT EXISTS bleed_mm numeric DEFAULT 3;

ALTER TABLE ig_product_categories DROP CONSTRAINT IF EXISTS ig_product_categories_artwork_kind_check;
ALTER TABLE ig_product_categories ADD CONSTRAINT ig_product_categories_artwork_kind_check
  CHECK (artwork_kind IN ('flat', 'label', 'wrap', 'poster'));

-- Backfill the 11 seeded globals with real geometry. Without this every existing
-- category keeps the 1:1 default and labels stay square.
UPDATE ig_product_categories SET artwork_kind='flat',  aspect_ratio='1:1',  print_size_mm='280x350' WHERE client_id IS NULL AND slug='triko'   AND print_size_mm IS NULL;
UPDATE ig_product_categories SET artwork_kind='flat',  aspect_ratio='1:1',  print_size_mm='280x350' WHERE client_id IS NULL AND slug='mikina'  AND print_size_mm IS NULL;
UPDATE ig_product_categories SET artwork_kind='flat',  aspect_ratio='4:3',  print_size_mm='100x50'  WHERE client_id IS NULL AND slug='cepice'  AND print_size_mm IS NULL;
UPDATE ig_product_categories SET artwork_kind='wrap',  aspect_ratio='16:9', print_size_mm='200x120' WHERE client_id IS NULL AND slug='ponozky' AND print_size_mm IS NULL;
UPDATE ig_product_categories SET artwork_kind='flat',  aspect_ratio='1:1',  print_size_mm='250x250' WHERE client_id IS NULL AND slug='taska'   AND print_size_mm IS NULL;
UPDATE ig_product_categories SET artwork_kind='poster',aspect_ratio='3:4',  print_size_mm='297x420' WHERE client_id IS NULL AND slug='plakat'  AND print_size_mm IS NULL;
UPDATE ig_product_categories SET artwork_kind='flat',  aspect_ratio='1:1',  print_size_mm='400x400' WHERE client_id IS NULL AND slug='polstar' AND print_size_mm IS NULL;
UPDATE ig_product_categories SET artwork_kind='wrap',  aspect_ratio='16:9', print_size_mm='200x85'  WHERE client_id IS NULL AND slug='hrnek'   AND print_size_mm IS NULL;
UPDATE ig_product_categories SET artwork_kind='flat',  aspect_ratio='1:1',  print_size_mm='60x60'   WHERE client_id IS NULL AND slug='gadget'  AND print_size_mm IS NULL;
UPDATE ig_product_categories SET artwork_kind='flat',  aspect_ratio='1:1',  print_size_mm='50x50'   WHERE client_id IS NULL AND slug='accessory' AND print_size_mm IS NULL;
UPDATE ig_product_categories SET artwork_kind='flat',  aspect_ratio='16:9', print_size_mm='85x55'   WHERE client_id IS NULL AND slug='card'    AND print_size_mm IS NULL;


-- ═══════════════════════════════════════════════════════════
-- 6. SEED: packaging categories (autokosmetika and friends)
-- ═══════════════════════════════════════════════════════════
-- design_guide now describes FLAT ARTWORK, not a product photograph. The old
-- seeds said "ZOBRAZ CELÉ TRIČKO ... kvalitní produktová fotka", which is why
-- the print output was a photo and the mockup pasted a shirt onto a shirt.

INSERT INTO ig_product_categories
  (client_id, slug, label, icon, design_guide, mockup_prompt, material_hint, manufacturing_hint,
   artwork_kind, aspect_ratio, print_size_mm, panels, safe_margin_mm, bleed_mm, sort_order)
VALUES
(NULL, 'lahev-500', 'Lahev 500 ml', '🧴',
 'Plochá artwork etikety pro lahev 500 ml. Přední panel: název produktu, krok v řadě a hlavní benefit. Vertikální kompozice, čitelná z 1 metru na regálu. ŽÁDNÁ fotka lahve — pouze plochá grafika etikety.',
 'blank matte white HDPE cosmetic bottle 500ml with trigger-free cap, standing on dark studio background, product photography, no label, no text',
 'samolepicí PP fólie, matná laminace', 'digitální tisk, archový',
 'label', '3:4', '90x130',
 '[{"name":"front","width_mm":90,"height_mm":130,"purpose":"název, krok, benefit"},{"name":"back","width_mm":90,"height_mm":130,"purpose":"návod, složení, upozornění, EAN"}]'::jsonb,
 4, 3, 20),

(NULL, 'etiketa-ovin', 'Ovinová etiketa', '🏷️',
 'Plochá artwork ovinové etikety — souvislý pás kolem celého obalu. Kompozice musí fungovat i v místě švu (žádný důležitý prvek na okrajích). Pouze plochá grafika.',
 'blank cylindrical cosmetic container on dark studio background, product photography, no label, no text',
 'samolepicí PP fólie', 'digitální tisk',
 'wrap', '16:9', '220x100', NULL, 4, 3, 21),

(NULL, 'kanystr-5l', 'Kanystr 5 l', '🛢️',
 'Plochá artwork etikety pro kanystr 5 l — profi/dílenský formát. Velká typografie, jasné označení objemu a ředicího poměru. Pouze plochá grafika, žádná fotka kanystru.',
 'blank white 5 litre plastic jerrycan canister with handle, dark studio background, product photography, no label, no text',
 'samolepicí PE fólie, odolná chemikáliím', 'digitální tisk',
 'label', '1:1', '180x180',
 '[{"name":"front","width_mm":180,"height_mm":180,"purpose":"název, objem, ředění"},{"name":"back","width_mm":180,"height_mm":180,"purpose":"bezpečnost, složení, piktogramy"}]'::jsonb,
 5, 3, 22),

(NULL, 'sprej-750', 'Sprej 750 ml', '🧪',
 'Plochá artwork etikety pro rozprašovač 750 ml. Úzký vysoký formát, název čitelný shora. Pouze plochá grafika etikety.',
 'blank transparent spray bottle 750ml with black trigger sprayer, dark studio background, product photography, no label, no text',
 'samolepicí PP fólie', 'digitální tisk',
 'label', '9:16', '75x160',
 '[{"name":"front","width_mm":75,"height_mm":160,"purpose":"název, krok, benefit"},{"name":"back","width_mm":75,"height_mm":160,"purpose":"návod a bezpečnost"}]'::jsonb,
 3, 3, 23),

(NULL, 'set-box', 'Dárkový set', '📦',
 'Plochá artwork potisku krabice pro set produktů z jedné řady. Rozvinutý přední panel — musí komunikovat celou řadu jako systém, ne jeden produkt. Pouze plochá grafika.',
 'blank matte black rigid cardboard gift box, closed, dark studio background, product photography, no print, no text',
 'kašírovaná lepenka, matná laminace', 'ofsetový tisk',
 'flat', '4:3', '300x220', NULL, 5, 3, 24)
ON CONFLICT DO NOTHING;


-- ═══════════════════════════════════════════════════════════
-- 7. PLANS: unlock product_line on the Product Studio tiers
-- ═══════════════════════════════════════════════════════════
-- Keyed off product_design rather than a hardcoded plan id list, so this stays
-- correct across the several pricing migrations (seed_plans, growth_tiers,
-- pricing_v5) that each rewrote the tier names.

UPDATE subscription_plans
SET features = jsonb_set(
      features,
      '{allowed_actions}',
      (features->'allowed_actions') || '["product_line"]'::jsonb
    )
WHERE features->'allowed_actions' @> '["product_design"]'::jsonb
  AND NOT (features->'allowed_actions' @> '["product_line"]'::jsonb);
