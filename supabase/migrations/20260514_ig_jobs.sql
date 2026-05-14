-- ig_jobs: Async job queue for content generation pipeline
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS ig_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  config JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'researcher', 'copywriter', 'critic', 'art_director', 'rendering', 'uploading', 'done', 'failed')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  agent_message TEXT,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for polling pending jobs
CREATE INDEX IF NOT EXISTS idx_ig_jobs_status ON ig_jobs(status) WHERE status = 'pending';
-- Index for client-specific queries
CREATE INDEX IF NOT EXISTS idx_ig_jobs_client ON ig_jobs(client_id, created_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_ig_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ig_jobs_updated_at
  BEFORE UPDATE ON ig_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_ig_jobs_updated_at();

-- RLS: allow authenticated users to read their own jobs
ALTER TABLE ig_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own jobs" ON ig_jobs
  FOR SELECT USING (true);

CREATE POLICY "Service role can manage jobs" ON ig_jobs
  FOR ALL USING (true);
