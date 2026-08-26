-- ═══════════════════════════════════════════════════════════════
-- Migration: Pricing v5 — přecenění + kotva Impérium
-- ═══════════════════════════════════════════════════════════════
-- Po přidání funkcí (Claude judge, hlubší pipeline) vzrostly náklady na
-- generování → plány přeceněny tak, aby kreditové váhy (image 1 · carousel 3
-- · reel 5) seděly na náklad. Extra kredit 49 Kč (≈ nejvyšší plánový kredit,
-- takže dobíjení nikdy nebije předplatné).
--
-- Ceny:  Start 990 · Růst 1 990 · Dominance 3 990 · Impérium 7 990 Kč
-- Kredity: 20 · 45 · 100 · 220
-- Interní unit-economics podklad je mimo repo (docs/pricing/, gitignored).
-- Run: Supabase Management API / SQL editor. Bezpečné re-run (ON CONFLICT).
-- ═══════════════════════════════════════════════════════════════

-- 1. Start — 990 Kč, 20 kreditů, image + carousel (bez reelů)
INSERT INTO subscription_plans (id, name, description, price_czk, interval, features, is_active)
VALUES ('chrlit_start', 'Start', 'Nakopni profil — 20 kreditů/měs, obrázky a carousely', 99000, 'month', '{
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

-- 2. Růst — 1 990 Kč, 45 kreditů, + reels + A/B varianty + růstový dashboard
INSERT INTO subscription_plans (id, name, description, price_czk, interval, features, is_active)
VALUES ('chrlit_rust', 'Růst', 'Rosteme spolu — 45 kreditů/měs vč. reels, A/B varianty, růstový dashboard', 199000, 'month', '{
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

-- 3. Dominance — 3 990 Kč, 100 kreditů, + product studio + priorita
INSERT INTO subscription_plans (id, name, description, price_czk, interval, features, is_active)
VALUES ('chrlit_dominance', 'Dominance', 'Ovládni svůj trh — 100 kreditů/měs vč. reels, product studio, přednost ve frontě', 399000, 'month', '{
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

-- 4. Impérium — 7 990 Kč, 220 kreditů, kotva pro agentury a e-shopy (NOVÝ tier)
INSERT INTO subscription_plans (id, name, description, price_czk, interval, features, is_active)
VALUES ('chrlit_imperium', 'Impérium', 'Postav impérium — 220 kreditů/měs pro jednu značku, product studio, nejvyšší přednost ve frontě', 799000, 'month', '{
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
