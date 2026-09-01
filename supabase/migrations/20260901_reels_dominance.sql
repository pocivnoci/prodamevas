-- ═══════════════════════════════════════════════════════════════
-- Migration: reels jen od Dominance výš
-- ═══════════════════════════════════════════════════════════════
-- Rozhodnutí majitele. Ceny ani kredity se nemění; mění se jediná věc —
-- Růst přichází o `reel` v allowed_media. Reels tím drží jen Dominance
-- a Impérium a stávají se skutečnou hranicí, ne odrážkou na třech kartách.
--
--   PŘED   Start: image story carousel
--          Růst · Dominance · Impérium: + reel
--   PO     Start · Růst: image story carousel
--          Dominance · Impérium: + reel
--
-- Kopie tarifu se MUSÍ změnit současně: aserce 13.9 padne, pokud odrážka
-- slibuje médium, které tarif v allowed_media nemá. Růstu proto mizí
-- „Reels — AI video" a na jeho místo jde „Úprava hotového příspěvku" —
-- funkce, kterou Růst od `20260901_odemknuti_funkci.sql` skutečně dostal
-- a kterou zatím neuváděl žádný text. Tarif tak o odrážku nepřijde a nová
-- slibuje něco, co se opravdu stane.
--
-- Pozn.: reels jsou navíc globálně vypnuté (`REELS_ENABLED`) — záměrně,
-- dokud nebude kvalita dost dobrá. Odznak „připravujeme" na kartě řídí ten
-- vypínač, ne tahle migrace; ta říká jen KDO je dostane, až se zapnou.
--
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
VALUES ('chrlit_rust', 'Růst', 'Rosteme spolu — 70 kreditů/měs, úprava hotových příspěvků, A/B varianty, růstový dashboard', 299900, 'month', '{
    "credits_per_month": 70,
    "max_projects": 1,
    "extra_credit_price": 4900,
    "allowed_actions": ["post", "post_edit", "post_variant", "idea_generate"],
    "allowed_media": ["image", "story", "carousel"],
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
    "allowed_actions": ["post", "post_edit", "post_variant", "idea_generate", "product_ideas", "product_visual", "product_design", "product_mockup", "product_brief", "product_line"],
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
    "allowed_actions": ["post", "post_edit", "post_variant", "idea_generate", "product_ideas", "product_visual", "product_design", "product_mockup", "product_brief", "product_line"],
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
