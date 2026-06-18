-- ig_campaigns: durable, server-side content-plan execution.
-- Replaces the fragile client-side batch loop (which died with the browser tab,
-- producing "asked for 7, got 4"). A worker cron drains pending campaigns
-- independent of the browser; progress is resumable across worker invocations.
-- Run this in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS ig_campaigns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'partial', 'failed')),
  -- Approved plan items (postType / topic / hookPreview / productId), in order.
  plan JSONB NOT NULL DEFAULT '[]',
  -- Shared generation options for every post (aspectRatio, medium, category, topic).
  options JSONB NOT NULL DEFAULT '{}',
  total INTEGER NOT NULL DEFAULT 0,
  -- Index of the next plan item to process. Advanced after each item completes,
  -- so a crashed worker resumes from here instead of restarting the batch.
  cursor INTEGER NOT NULL DEFAULT 0,
  successes INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  -- Lease for single-worker safety: a worker claims a campaign by stamping this,
  -- and heartbeats it on every progress tick. A stale lease (worker died) lets the
  -- next cron tick reclaim and resume. NULL = free to claim.
  worker_lease TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Drain order: oldest unfinished campaign first.
CREATE INDEX IF NOT EXISTS idx_ig_campaigns_active
  ON ig_campaigns(created_at) WHERE status IN ('pending', 'running');
CREATE INDEX IF NOT EXISTS idx_ig_campaigns_client
  ON ig_campaigns(client_id, created_at DESC);

CREATE OR REPLACE FUNCTION update_ig_campaigns_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ig_campaigns_updated_at ON ig_campaigns;
CREATE TRIGGER ig_campaigns_updated_at
  BEFORE UPDATE ON ig_campaigns
  FOR EACH ROW
  EXECUTE FUNCTION update_ig_campaigns_updated_at();

ALTER TABLE ig_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own campaigns" ON ig_campaigns
  FOR SELECT USING (true);

CREATE POLICY "Service role can manage campaigns" ON ig_campaigns
  FOR ALL USING (true);
