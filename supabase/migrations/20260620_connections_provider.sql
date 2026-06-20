-- Phase 1 (core hardening): generalize the credential vault toward multi-provider.
-- Adds a `provider` discriminator + supporting columns to ig_connections and moves
-- uniqueness from (client_id) → (client_id, provider) so one tenant can hold
-- connections for Instagram, LinkedIn, Facebook, email, etc.
--
-- Safe + additive: the table is new/unused in prod; existing rows default to
-- provider='instagram'. The IG connection module tags its rows 'instagram'; no
-- behaviour change for the live Instagram connect flow. Run in Supabase SQL Editor.

ALTER TABLE ig_connections
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'instagram'
    CHECK (provider IN ('instagram', 'linkedin', 'facebook', 'email')),
  -- Encrypted refresh token, for providers that issue one (IG long-lived tokens don't).
  ADD COLUMN IF NOT EXISTS refresh_token TEXT,
  -- Granted OAuth scopes, per provider.
  ADD COLUMN IF NOT EXISTS scopes TEXT[],
  -- Provider-specific extras (e.g. LinkedIn org id, email mailbox) without schema churn.
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';

-- One connection per (tenant, provider) — was one per tenant. Drop the old
-- single-column unique (auto-named ig_connections_client_id_key from the inline
-- UNIQUE (client_id)) and add the composite.
ALTER TABLE ig_connections DROP CONSTRAINT IF EXISTS ig_connections_client_id_key;
ALTER TABLE ig_connections
  ADD CONSTRAINT ig_connections_client_provider_key UNIQUE (client_id, provider);
