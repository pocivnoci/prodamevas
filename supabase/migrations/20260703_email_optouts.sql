-- ═══════════════════════════════════════════════════════════════
-- Migration: Email opt-outs (unsubscribe) for the admin Mailing panel
-- Global opt-out keyed by email — covers waitlist and client segments alike.
-- Broadcasts filter these out; the public /api/email/unsubscribe route upserts here.
-- Run: Supabase Management API / SQL editor
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS email_optouts (
    email text PRIMARY KEY,
    created_at timestamptz DEFAULT now()
);

-- Service-role only (engine/actions bypass RLS); no anon access.
ALTER TABLE email_optouts ENABLE ROW LEVEL SECURITY;
