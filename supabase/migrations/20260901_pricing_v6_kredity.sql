-- ═══════════════════════════════════════════════════════════════
-- Migration: Pricing v6 — narovnání kreditů (Růst 70 · Dominance 130 · Impérium 260)
-- ═══════════════════════════════════════════════════════════════
-- Dokončení přecenění v6. Ceny se NEMĚNÍ (999 · 2 999 · 4 999 · 8 999 Kč);
-- mění se jen kredity, protože v6 nechal žebřík obrácený:
--
--            cena   kredity   Kč/kredit   krok proti nižšímu tarifu
--   PŘED     999      20        50,0            —
--            2 999    45        66,6          80,0   ← dražší než dobití (49)
--            4 999   100        50,0          36,4
--            8 999   220        40,9          33,3
--
--   PO       999      20        50,0            —
--            2 999    70        42,8          40,0
--            4 999   130        38,5          33,3
--            8 999   260        34,6          30,8
--
-- Dvě pravidla, která teď platí a hlídá je aserce 25.3c:
--   1. Kč/kredit KLESÁ celým žebříkem — vyšší tarif je vždy lepší nákup.
--   2. Každý krok nahoru vyjde levněji než dobití kreditu (49 Kč), takže
--      zákazníkovi se nikdy nevyplatí zůstat níž a dokupovat. Přesně tohle
--      v6 porušil: ze Startu na Růst stálo 80 Kč za kredit navíc.
--
-- Struktura je záměrně čitelná: Dominance = 2× Růst, Impérium = 2× Dominance.
-- Marže při plném vyčerpání 81–87 % (1 kredit ≈ $0,31 COGS, 21,2 Kč/$) —
-- Růst byl předtím outlier na 90 %, protože za trojnásobek ceny dával jen
-- o polovinu víc kreditů.
--
-- Nahrazuje `20260901_pricing_v6.sql` (ten zůstává jako historie).
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

-- 2. Růst — 2 999 Kč, 70 kreditů, + reels + A/B varianty + růstový dashboard
INSERT INTO subscription_plans (id, name, description, price_czk, interval, features, is_active)
VALUES ('chrlit_rust', 'Růst', 'Rosteme spolu — 70 kreditů/měs vč. reels, A/B varianty, růstový dashboard', 299900, 'month', '{
    "credits_per_month": 70,
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

-- 3. Dominance — 4 999 Kč, 130 kreditů, + product studio + priorita
INSERT INTO subscription_plans (id, name, description, price_czk, interval, features, is_active)
VALUES ('chrlit_dominance', 'Dominance', 'Ovládni svůj trh — 130 kreditů/měs vč. reels, product studio, přednost ve frontě', 499900, 'month', '{
    "credits_per_month": 130,
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

-- 4. Impérium — 8 999 Kč, 260 kreditů, nejvyšší úroveň pro jednu značku
INSERT INTO subscription_plans (id, name, description, price_czk, interval, features, is_active)
VALUES ('chrlit_imperium', 'Impérium', 'Postav impérium — 260 kreditů/měs pro jednu značku, product studio, nejvyšší přednost ve frontě', 899900, 'month', '{
    "credits_per_month": 260,
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
