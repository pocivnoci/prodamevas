-- ig_connections: per-tenant Instagram account connection (OAuth token storage).
-- Step 1 ("Keystone") of the IG go-live roadmap. Stores the long-lived (60-day)
-- access token for a tenant's Instagram Business account, obtained via
-- "Instagram API with Instagram Login" (scopes: instagram_business_basic +
-- instagram_business_manage_insights).
--
-- SECURITY: access_token is an AES-256-GCM ciphertext (see lib/ig-token-crypto.ts),
-- never plaintext. The table is RLS deny-all (no policies) — it is reachable ONLY
-- via the service-role client (supabase/admin.ts), never the browser/anon client.
-- Run this in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS ig_connections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- Instagram Business account id (from GET /me) — used for all Graph API calls.
  ig_user_id TEXT NOT NULL,
  -- @handle, stored for UI display only.
  ig_username TEXT,
  -- AES-256-GCM ciphertext (iv:authTag:ciphertext). NEVER store the raw token.
  access_token TEXT NOT NULL,
  -- 60-day long-lived token expiry; the refresh cron renews before this.
  token_expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'expired', 'revoked')),
  refreshed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One IG connection per tenant for now (upsert target).
  UNIQUE (client_id)
);

-- Refresh-cron scan: connections nearing expiry, oldest first.
CREATE INDEX IF NOT EXISTS idx_ig_connections_refresh
  ON ig_connections(token_expires_at) WHERE status = 'connected';

CREATE OR REPLACE FUNCTION update_ig_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ig_connections_updated_at ON ig_connections;
CREATE TRIGGER ig_connections_updated_at
  BEFORE UPDATE ON ig_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_ig_connections_updated_at();

-- RLS deny-all: enable RLS but add NO policies. The service-role client bypasses
-- RLS; every other client (anon/authenticated) is denied. Tokens never touch the
-- browser. This is intentionally stricter than the permissive ig_* tables.
ALTER TABLE ig_connections ENABLE ROW LEVEL SECURITY;
