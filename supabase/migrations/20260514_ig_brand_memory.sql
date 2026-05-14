-- ig_brand_memory: Long-term learning memory for each client
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS ig_brand_memory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('pattern', 'preference', 'avoid')),
  content TEXT NOT NULL,
  confidence FLOAT NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  source_post_ids UUID[] DEFAULT '{}',
  times_confirmed INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ig_brand_memory_client ON ig_brand_memory(client_id, confidence DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_ig_brand_memory_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ig_brand_memory_updated_at
  BEFORE UPDATE ON ig_brand_memory
  FOR EACH ROW
  EXECUTE FUNCTION update_ig_brand_memory_updated_at();

ALTER TABLE ig_brand_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read brand memory" ON ig_brand_memory
  FOR SELECT USING (true);

CREATE POLICY "Service role can manage brand memory" ON ig_brand_memory
  FOR ALL USING (true);
