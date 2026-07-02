-- ═══════════════════════════════════════════════════════════════
-- Migration: Recurring billing (Comgate "opakované platby")
-- Month-2 fix: subscriptions used to silently expire after 30 days with no
-- renewal path. Now the initial payment stores a recurring token and the
-- daily billing-worker cron charges renewals + handles dunning.
-- Run: Supabase Management API / SQL editor
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE subscriptions
    -- transId of the INITIAL payment created with initRecurring=true; follow-up
    -- charges always reference this (never a renewal's transId)
    ADD COLUMN IF NOT EXISTS recurring_trans_id text,
    -- consecutive failed/missed renewal attempts (dunning counter);
    -- reset to 0 on every successful payment, sub expires after the cap
    ADD COLUMN IF NOT EXISTS billing_failures integer DEFAULT 0;

-- Billing worker scans for due renewals daily
CREATE INDEX IF NOT EXISTS idx_subscriptions_period_end
    ON subscriptions(status, current_period_end);
