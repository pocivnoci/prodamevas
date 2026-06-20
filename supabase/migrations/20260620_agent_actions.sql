-- agent_actions: audit log + approval gate for agent actions (core hardening Fáze 3).
-- Every action an agent wants to take is recorded here BEFORE it runs. Low-risk
-- (reversible/internal) actions auto-approve and dispatch immediately; high-risk
-- (outbound/spending/irreversible) actions land as 'proposed' and wait for a human
-- to approve in the dashboard. On approval the work runs as an agent_tasks task
-- (Fáze 2). Append-only audit trail; nothing money/customer-facing happens unseen.
--
-- RLS deny-all (service-role only). Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS agent_actions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Nullable: some agent actions are system-level (not tied to a tenant).
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  agent_type TEXT NOT NULL,          -- e.g. 'email', 'ads', 'content'
  action TEXT NOT NULL,              -- human-readable, e.g. 'send_welcome_email'
  risk_tier TEXT NOT NULL
    CHECK (risk_tier IN ('reversible', 'internal', 'outbound', 'spending', 'irreversible')),
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'approved', 'executed', 'rejected', 'failed')),
  -- agent_tasks handler to dispatch when approved/auto (null = pure log entry).
  task_type TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  result JSONB,
  error TEXT,
  -- Who decided: user email on manual approve/reject, 'auto' for low-risk, 'system'.
  actor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Approvals inbox: pending items first.
CREATE INDEX IF NOT EXISTS idx_agent_actions_pending
  ON agent_actions(created_at) WHERE status = 'proposed';
CREATE INDEX IF NOT EXISTS idx_agent_actions_client
  ON agent_actions(client_id, created_at DESC);

CREATE OR REPLACE FUNCTION update_agent_actions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_actions_updated_at ON agent_actions;
CREATE TRIGGER agent_actions_updated_at
  BEFORE UPDATE ON agent_actions
  FOR EACH ROW
  EXECUTE FUNCTION update_agent_actions_updated_at();

ALTER TABLE agent_actions ENABLE ROW LEVEL SECURITY;
-- No policies → deny-all; reachable only via service-role (supabase/admin.ts).
