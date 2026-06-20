-- domain_events: append-only event log for the event seam (core hardening Fáze 4).
-- Named domain events ('metrics.updated', 'post.published', …) are recorded here
-- and dispatched in-process to subscribers, which react by enqueuing agent_tasks.
-- Decouples triggers from reactions (replaces ad-hoc waitUntil fire-and-forget)
-- and gives a durable trail for debugging/replay.
--
-- RLS deny-all (service-role only). Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS domain_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,                       -- e.g. 'metrics.updated'
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domain_events_name ON domain_events(name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_domain_events_client ON domain_events(client_id, created_at DESC);

ALTER TABLE domain_events ENABLE ROW LEVEL SECURITY;
-- No policies → deny-all; reachable only via service-role (supabase/admin.ts).
