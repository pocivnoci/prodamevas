-- ═══════════════════════════════════════════════════════════════
-- Migration: Seed subscription plans + credit tracking
-- Run: supabase db push or paste into Supabase SQL editor
-- ═══════════════════════════════════════════════════════════════

-- 1. Clear old plans (if any)
DELETE FROM subscription_plans;

-- 2. Insert new credit-based plans
INSERT INTO subscription_plans (id, name, description, price_czk, price_eur, interval, post_limit, features, is_active) VALUES
(
    'starter',
    'Starter',
    'Pro začínající tvůrce — generuj kvalitní příspěvky na Instagram.',
    49000,  -- 490 Kč in haléře
    NULL,
    'month',
    20,     -- credits_per_month (using post_limit column)
    '{
        "credits_per_month": 20,
        "max_projects": 1,
        "extra_credit_price": 500,
        "allowed_actions": ["post", "idea_generate"],
        "analytics": "basic",
        "priority": false,
        "label": "Starter",
        "highlight": false
    }'::jsonb,
    true
),
(
    'creator',
    'Creator',
    'Pro freelancery a kreativce — nápady, varianty, iterace.',
    99000,  -- 990 Kč
    NULL,
    'month',
    50,
    '{
        "credits_per_month": 50,
        "max_projects": 2,
        "extra_credit_price": 500,
        "allowed_actions": ["post", "post_variant", "idea_generate", "product_ideas"],
        "analytics": "basic",
        "priority": false,
        "label": "Creator",
        "highlight": false
    }'::jsonb,
    true
),
(
    'business',
    'Business',
    'Pro firmy — plný produktový pipeline, designy, mockupy, briefy.',
    189000,  -- 1 890 Kč
    NULL,
    'month',
    120,
    '{
        "credits_per_month": 120,
        "max_projects": 5,
        "extra_credit_price": 400,
        "allowed_actions": ["post", "post_variant", "idea_generate", "product_ideas", "product_visual", "product_design", "product_mockup", "product_brief"],
        "analytics": "full",
        "priority": false,
        "label": "Business",
        "highlight": true
    }'::jsonb,
    true
),
(
    'pro',
    'Pro',
    'Pro velké firmy — maximální objem, prioritní generování.',
    379000,  -- 3 790 Kč
    NULL,
    'month',
    260,
    '{
        "credits_per_month": 260,
        "max_projects": 10,
        "extra_credit_price": 350,
        "allowed_actions": ["post", "post_variant", "idea_generate", "product_ideas", "product_visual", "product_design", "product_mockup", "product_brief"],
        "analytics": "full",
        "priority": true,
        "label": "Pro",
        "highlight": false
    }'::jsonb,
    true
),
(
    'agency',
    'Agency',
    'Pro agentury — 25 klientů, nejvyšší objem, nejlevnější kredity.',
    799000,  -- 7 990 Kč
    NULL,
    'month',
    600,
    '{
        "credits_per_month": 600,
        "max_projects": 25,
        "extra_credit_price": 300,
        "allowed_actions": ["post", "post_variant", "idea_generate", "product_ideas", "product_visual", "product_design", "product_mockup", "product_brief"],
        "analytics": "full",
        "priority": true,
        "label": "Agency",
        "highlight": false
    }'::jsonb,
    true
);

-- 3. Credit transactions table (tracks every credit deduction)
CREATE TABLE IF NOT EXISTS credit_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id uuid REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
    action text NOT NULL,          -- 'post', 'product_brief', 'product_design', etc.
    credits integer NOT NULL,      -- positive = deduction, negative = refund/topup
    description text,              -- human-readable: "Post: Letní kolekce 2026"
    reference_id text,             -- optional: post ID, product idea ID, etc.
    created_at timestamptz DEFAULT now()
);

ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

-- Index for fast monthly usage queries
CREATE INDEX IF NOT EXISTS idx_credit_transactions_client_month
    ON credit_transactions (client_id, created_at DESC);

-- 4. Add trial_ends_at to subscriptions if not present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'subscriptions' AND column_name = 'trial_ends_at'
    ) THEN
        ALTER TABLE subscriptions ADD COLUMN trial_ends_at timestamptz;
    END IF;
END $$;
