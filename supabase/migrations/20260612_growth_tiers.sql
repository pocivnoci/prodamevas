-- ═══════════════════════════════════════════════════════════════
-- Migration: Growth Tiers v3 — Start / Růst / Dominance
-- 3 balíčky postavené na růstu profilu + ig_growth_snapshots
-- Run: paste into Supabase SQL editor
-- ═══════════════════════════════════════════════════════════════

-- 1. Deactivate the single-plan model (existing subscribers stay grandfathered)
UPDATE subscription_plans SET is_active = false WHERE id = 'chrlit';

-- 2. Tier 1: Start — 490 Kč, 15 kreditů, image+carousel
INSERT INTO subscription_plans (id, name, description, price_czk, interval, features, is_active)
VALUES ('chrlit_start', 'Start', 'Nakopni profil — 15 kreditů/měs, obrázky a carousely', 49000, 'month', '{
    "credits_per_month": 15,
    "max_projects": 1,
    "extra_credit_price": 1500,
    "allowed_actions": ["post", "idea_generate"],
    "allowed_media": ["image", "carousel"],
    "growth_tracking": false,
    "analytics": "basic",
    "priority": false,
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

-- 3. Tier 2: Růst — 990 Kč, 40 kreditů, + A/B varianty + reels + growth dashboard
INSERT INTO subscription_plans (id, name, description, price_czk, interval, features, is_active)
VALUES ('chrlit_rust', 'Růst', 'Rosteme spolu — 40 kreditů/měs, A/B varianty, reels, růstový dashboard', 99000, 'month', '{
    "credits_per_month": 40,
    "max_projects": 1,
    "extra_credit_price": 1500,
    "allowed_actions": ["post", "post_variant", "idea_generate"],
    "allowed_media": ["image", "carousel", "reel"],
    "growth_tracking": true,
    "analytics": "full",
    "priority": false,
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

-- 4. Tier 3: Dominance — 1 990 Kč, 100 kreditů, + product studio + priorita
INSERT INTO subscription_plans (id, name, description, price_czk, interval, features, is_active)
VALUES ('chrlit_dominance', 'Dominance', 'Ovládni svůj trh — 100 kreditů/měs, product studio, priorita', 199000, 'month', '{
    "credits_per_month": 100,
    "max_projects": 1,
    "extra_credit_price": 1500,
    "allowed_actions": ["post", "post_variant", "idea_generate", "product_ideas", "product_visual", "product_design", "product_mockup", "product_brief"],
    "allowed_media": ["image", "carousel", "reel"],
    "growth_tracking": true,
    "analytics": "full",
    "priority": true,
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

-- 5. Follower growth tracking — weekly snapshots (cron) for growth_tracking plans
CREATE TABLE IF NOT EXISTS ig_growth_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id uuid REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
    follower_count integer NOT NULL,
    following_count integer,
    media_count integer,
    captured_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_growth_snapshots_client
    ON ig_growth_snapshots(client_id, captured_at);

ALTER TABLE ig_growth_snapshots ENABLE ROW LEVEL SECURITY;
-- Engine writes via service role (bypasses RLS); no anon access needed.
