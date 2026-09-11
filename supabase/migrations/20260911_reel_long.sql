-- ═══════════════════════════════════════════════════════════════
-- Migration: dlouhý reel (`reel_long`) jako druhé reelové médium
-- ═══════════════════════════════════════════════════════════════
-- Reely mají dvě velikosti: `reel` (≤ 8 s, 5 kreditů) a `reel_long` (≤ 20 s,
-- 10 kreditů). Druhá velikost je samostatné médium v `allowed_media`, protože
-- `media_type` na příspěvku rozhoduje o zúčtování — jedno slovo, jedna cena.
--
--   PŘED   Dominance · Impérium: image story carousel reel
--   PO     Dominance · Impérium: + reel_long
--          Start · Růst: beze změny (reely nemají vůbec)
--
-- Ceny ani kredity tarifů se nemění. Reely zůstávají navíc za globálním
-- vypínačem `REELS_ENABLED`; tahle migrace říká jen KDO obě velikosti dostane.
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
    "human_support": false,
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

-- 2. Růst — 2 999 Kč, 70 kreditů, úprava příspěvků + A/B varianty + růstový dashboard
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
    "human_support": false,
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

-- 3. Dominance — 4 999 Kč, 130 kreditů, + reels (obě velikosti) + product studio + priorita
INSERT INTO subscription_plans (id, name, description, price_czk, interval, features, is_active)
VALUES ('chrlit_dominance', 'Dominance', 'Ovládni svůj trh — 130 kreditů/měs vč. reels, product studio, přednost ve frontě', 499900, 'month', '{
    "credits_per_month": 130,
    "max_projects": 1,
    "extra_credit_price": 4900,
    "allowed_actions": ["post", "post_edit", "post_variant", "idea_generate", "product_ideas", "product_visual", "product_design", "product_mockup", "product_brief", "product_line"],
    "allowed_media": ["image", "story", "carousel", "reel", "reel_long"],
    "growth_tracking": true,
    "analytics": "full",
    "priority": 10,
    "human_support": false,
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
VALUES ('chrlit_imperium', 'Impérium', 'Postav impérium — 260 kreditů/měs pro jednu značku, product studio, kontrola obsahu marketingovým specialistou', 899900, 'month', '{
    "credits_per_month": 260,
    "max_projects": 1,
    "extra_credit_price": 4900,
    "allowed_actions": ["post", "post_edit", "post_variant", "idea_generate", "product_ideas", "product_visual", "product_design", "product_mockup", "product_brief", "product_line"],
    "allowed_media": ["image", "story", "carousel", "reel", "reel_long"],
    "growth_tracking": true,
    "analytics": "full",
    "priority": 20,
    "human_support": true,
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

-- 5. Pojistka pro tarify mimo seed (legacy řádky): kdo umí `reel`, umí i `reel_long`.
--    `allowed_media` je WHITELIST — bez tohohle by legacy tarif s reely dlouhý reel
--    tiše srazil na carousel (viz 20260730_stories_media.sql, stejný vzor).
UPDATE subscription_plans
SET features = jsonb_set(
        features,
        '{allowed_media}',
        (features->'allowed_media') || '["reel_long"]'::jsonb
    )
WHERE features ? 'allowed_media'
  AND features->'allowed_media' @> '["reel"]'::jsonb
  AND NOT (features->'allowed_media' @> '["reel_long"]'::jsonb);

DO $$
DECLARE
    missing integer;
BEGIN
    SELECT count(*) INTO missing
    FROM subscription_plans
    WHERE features ? 'allowed_media'
      AND features->'allowed_media' @> '["reel"]'::jsonb
      AND NOT (features->'allowed_media' @> '["reel_long"]'::jsonb);
    IF missing > 0 THEN
        RAISE EXCEPTION 'Migrace reel_long selhala: % tarifů má "reel" bez "reel_long" v allowed_media', missing;
    END IF;
END $$;
