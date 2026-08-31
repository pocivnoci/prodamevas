-- ═══════════════════════════════════════════════════════════════
-- Migration: Pricing v6 — přecenění (Start 999 · Růst 2 999 · Dominance 4 999 · Impérium 8 999)
-- ═══════════════════════════════════════════════════════════════
-- Obchodní rozhodnutí majitele: ceny nahoru, kredity beze změny.
--
-- Ceny:    Start 999 · Růst 2 999 · Dominance 4 999 · Impérium 8 999 Kč
-- Kredity: 20 · 45 · 100 · 220 (proti v5 nezměněné)
--
-- ⚠️ Důsledek, který je vidět až po vydělení: cena za kredit přestala klesat
--    směrem nahoru žebříkem. Start 50,0 · Růst 66,6 · Dominance 50,0 ·
--    Impérium 40,9 Kč/kredit. Zákazník na Startu, kterému dojdou kredity, si je
--    teď dokoupí levněji (49 Kč/ks), než kdyby přešel na Růst — přesně obrácený
--    tah, než jaký žebřík chce. Narovnat to jde JEN kredity (Růst by potřeboval
--    ~70 místo 45), a to je další cenové rozhodnutí, ne technická oprava; do
--    doby, než padne, tenhle komentář drží pravdu na místě, kde ji uvidí každý,
--    kdo sáhne na ceník.
--
-- Extra kredit zůstává 4900 haléřů (49 Kč) ve features všech tarifů.
-- Interní unit-economics podklad je mimo repo (docs/pricing/, gitignored).
-- Run: Supabase Management API / SQL editor. Bezpečné re-run (ON CONFLICT).
-- ═══════════════════════════════════════════════════════════════

-- 1. Start — 999 Kč, 20 kreditů, image + carousel (bez reelů)
INSERT INTO subscription_plans (id, name, description, price_czk, interval, features, is_active)
VALUES ('chrlit_start', 'Start', 'Nakopni profil — 20 kreditů/měs, obrázky a carousely', 99900, 'month', '{
    "credits_per_month": 20,
    "max_projects": 1,
    "extra_credit_price": 4900,
    "allowed_actions": ["post", "idea_generate"],
    "allowed_media": ["image", "story", "carousel"],
    "growth_tracking": false,
    "analytics": "basic",
    "priority": 0,
    "label": "Start",
    "highlight": false,
    "plan_posts_limit": 30,
    "plan_posts_total": 30
}'::jsonb, true)
ON CONFLICT (id) DO UPDATE SET
    features = EXCLUDED.features,
    is_active = EXCLUDED.is_active,
    description = EXCLUDED.description,
    price_czk = EXCLUDED.price_czk;

-- 2. Růst — 2 999 Kč, 45 kreditů, + reels + A/B varianty + růstový dashboard
INSERT INTO subscription_plans (id, name, description, price_czk, interval, features, is_active)
VALUES ('chrlit_rust', 'Růst', 'Rosteme spolu — 45 kreditů/měs vč. reels, A/B varianty, růstový dashboard', 299900, 'month', '{
    "credits_per_month": 45,
    "max_projects": 1,
    "extra_credit_price": 4900,
    "allowed_actions": ["post", "post_variant", "idea_generate"],
    "allowed_media": ["image", "story", "carousel", "reel"],
    "growth_tracking": true,
    "analytics": "full",
    "priority": 0,
    "label": "Růst",
    "highlight": true,
    "plan_posts_limit": 30,
    "plan_posts_total": 30
}'::jsonb, true)
ON CONFLICT (id) DO UPDATE SET
    features = EXCLUDED.features,
    is_active = EXCLUDED.is_active,
    description = EXCLUDED.description,
    price_czk = EXCLUDED.price_czk;

-- 3. Dominance — 4 999 Kč, 100 kreditů, + product studio + priorita
INSERT INTO subscription_plans (id, name, description, price_czk, interval, features, is_active)
VALUES ('chrlit_dominance', 'Dominance', 'Ovládni svůj trh — 100 kreditů/měs vč. reels, product studio, přednost ve frontě', 499900, 'month', '{
    "credits_per_month": 100,
    "max_projects": 1,
    "extra_credit_price": 4900,
    "allowed_actions": ["post", "post_variant", "idea_generate", "product_ideas", "product_visual", "product_design", "product_mockup", "product_brief"],
    "allowed_media": ["image", "story", "carousel", "reel"],
    "growth_tracking": true,
    "analytics": "full",
    "priority": 10,
    "label": "Dominance",
    "highlight": false,
    "plan_posts_limit": 30,
    "plan_posts_total": 30
}'::jsonb, true)
ON CONFLICT (id) DO UPDATE SET
    features = EXCLUDED.features,
    is_active = EXCLUDED.is_active,
    description = EXCLUDED.description,
    price_czk = EXCLUDED.price_czk;

-- 4. Impérium — 8 999 Kč, 220 kreditů, nejvyšší úroveň pro jednu značku
INSERT INTO subscription_plans (id, name, description, price_czk, interval, features, is_active)
VALUES ('chrlit_imperium', 'Impérium', 'Postav impérium — 220 kreditů/měs pro jednu značku, product studio, nejvyšší přednost ve frontě', 899900, 'month', '{
    "credits_per_month": 220,
    "max_projects": 1,
    "extra_credit_price": 4900,
    "allowed_actions": ["post", "post_variant", "idea_generate", "product_ideas", "product_visual", "product_design", "product_mockup", "product_brief"],
    "allowed_media": ["image", "story", "carousel", "reel"],
    "growth_tracking": true,
    "analytics": "full",
    "priority": 20,
    "label": "Impérium",
    "highlight": false,
    "plan_posts_limit": 30,
    "plan_posts_total": 30
}'::jsonb, true)
ON CONFLICT (id) DO UPDATE SET
    features = EXCLUDED.features,
    is_active = EXCLUDED.is_active,
    description = EXCLUDED.description,
    price_czk = EXCLUDED.price_czk;
