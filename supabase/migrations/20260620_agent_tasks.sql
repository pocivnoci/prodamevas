-- agent_tasks: generic durable task queue for the agent runner (core hardening Fáze 2).
-- Generalizes the proven ig_campaigns lease/heartbeat/resume pattern so ANY future
-- agent (content, and later ops agents like email/ads) is just a `type` with a
-- registered handler — no new cron per agent. The content pipeline keeps its own
-- ig_jobs/ig_campaigns path untouched; this runner is for new agent work.
--
-- RLS deny-all (service-role only) — workers use supabase/admin.ts. Run in SQL Editor.

CREATE TABLE IF NOT EXISTS agent_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Nullable: ops tasks can be system-level (not tied to a tenant).
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  -- Handler key (registerHandler(type, fn) in lib/agent-runner.ts).
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'failed')),
  -- Higher runs first; same priority drains oldest-scheduled first.
  priority INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  -- Earliest time the task may run (enables delays/backoff).
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Worker claim, heartbeated during long runs; stale lease = reclaimable.
  lease TIMESTAMPTZ,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Drain order: runnable tasks, highest priority then oldest schedule.
CREATE INDEX IF NOT EXISTS idx_agent_tasks_runnable
  ON agent_tasks(priority DESC, scheduled_for)
  WHERE status IN ('pending', 'running');

CREATE OR REPLACE FUNCTION update_agent_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_tasks_updated_at ON agent_tasks;
CREATE TRIGGER agent_tasks_updated_at
  BEFORE UPDATE ON agent_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_agent_tasks_updated_at();

ALTER TABLE agent_tasks ENABLE ROW LEVEL SECURITY;
-- No policies → deny-all; reachable only via service-role (supabase/admin.ts).
