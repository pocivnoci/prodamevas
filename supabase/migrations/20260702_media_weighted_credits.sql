-- ═══════════════════════════════════════════════════════════════
-- Migration: Media-weighted credits — plan re-budget (v4 pricing)
-- Credits now cost per medium (enforced in lib/subscription.ts):
--   image = 1 · carousel = 3 · reel = 5   (1 credit ≈ $0.30 COGS)
-- Plans re-budgeted so the marketing promise holds at ~55-65% margin
-- (docs/UNIT_ECONOMICS_AND_PRICING.md §4): Start 20 · Růst 45 · Dominance 110.
-- Expensive media drain the budget faster → worst case caps itself,
-- no plan can go net-negative.
-- Run: Supabase Management API / SQL editor
-- ═══════════════════════════════════════════════════════════════

-- 1. Start — 490 Kč, 20 kreditů, image + carousel (no reels)
UPDATE subscription_plans SET
    description = 'Nakopni profil — 20 kreditů/měs (obrázek 1 · carousel 3)',
    features = features || '{
        "credits_per_month": 20,
        "allowed_media": ["image", "carousel"]
    }'::jsonb
WHERE id = 'chrlit_start';

-- 2. Růst — 990 Kč, 45 kreditů, + reels (reel = 5 kreditů → max ~9 reels/měs)
UPDATE subscription_plans SET
    description = 'Rosteme spolu — 45 kreditů/měs vč. reels (obrázek 1 · carousel 3 · reel 5), A/B varianty, růstový dashboard',
    features = features || '{
        "credits_per_month": 45,
        "allowed_media": ["image", "carousel", "reel"]
    }'::jsonb
WHERE id = 'chrlit_rust';

-- 3. Dominance — 1 990 Kč, 110 kreditů, + product studio + priorita
UPDATE subscription_plans SET
    description = 'Ovládni svůj trh — 110 kreditů/měs vč. reels, product studio, priorita',
    features = features || '{
        "credits_per_month": 110,
        "allowed_media": ["image", "carousel", "reel"]
    }'::jsonb
WHERE id = 'chrlit_dominance';

-- 4. Trial: clamp media to image + carousel. Trial's 3 free plan posts previously
-- had no allowed_media (= everything) — a free reel costs us ~$1.50 a piece.
UPDATE subscription_plans SET
    features = features || '{
        "allowed_media": ["image", "carousel"]
    }'::jsonb
WHERE id = 'trial_v2';
