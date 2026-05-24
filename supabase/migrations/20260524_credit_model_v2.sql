-- ═══════════════════════════════════════════════════════════════
-- Migration: Credit Model v2 — Monthly Plan + Credits for Extras
-- Run: paste into Supabase SQL editor
-- ═══════════════════════════════════════════════════════════════

-- 1. Deactivate old plans (keep for existing subscriptions)
UPDATE subscription_plans SET is_active = false 
WHERE id IN ('starter', 'creator', 'business', 'pro', 'agency');

-- 2. New trial plan (free, content-gated)
INSERT INTO subscription_plans (id, name, description, price_czk, interval, features, is_active)
VALUES ('trial_v2', 'Trial', 'Content-gated trial — 3 plné posty + 27 zamčených', 0, 'month', '{
    "credits_per_month": 0,
    "max_projects": 1,
    "extra_credit_price": 1500,
    "allowed_actions": ["post"],
    "analytics": "basic",
    "priority": false,
    "label": "Trial",
    "highlight": false,
    "plan_posts_limit": 3,
    "plan_posts_total": 30
}'::jsonb, true)
ON CONFLICT (id) DO UPDATE SET 
    features = EXCLUDED.features, 
    is_active = EXCLUDED.is_active,
    description = EXCLUDED.description;

-- 3. New paid plan
INSERT INTO subscription_plans (id, name, description, price_czk, interval, features, is_active)
VALUES ('chrlit', 'Chrlit', 'Měsíční plán (~30 postů) + 30 kreditů na extras', 49000, 'month', '{
    "credits_per_month": 30,
    "max_projects": 1,
    "extra_credit_price": 1500,
    "allowed_actions": ["post", "post_variant", "idea_generate", "product_ideas", "product_visual", "product_design", "product_mockup", "product_brief"],
    "analytics": "full",
    "priority": false,
    "label": "Chrlit",
    "highlight": true,
    "plan_posts_limit": 30,
    "plan_posts_total": 30
}'::jsonb, true)
ON CONFLICT (id) DO UPDATE SET 
    features = EXCLUDED.features, 
    is_active = EXCLUDED.is_active,
    description = EXCLUDED.description,
    price_czk = EXCLUDED.price_czk;

-- 4. Add plan tracking columns to subscriptions
ALTER TABLE subscriptions 
    ADD COLUMN IF NOT EXISTS plan_generated_at timestamptz,
    ADD COLUMN IF NOT EXISTS plan_posts_unlocked integer DEFAULT 0;

-- 5. Add source column to ig_posts for distinguishing plan vs extra posts
-- Using existing status field: plan_draft = unlocked plan post, plan_locked = locked plan post
-- No schema change needed — status is text and already flexible.
