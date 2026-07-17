-- Content-plan drafts: a generated plan preview survives a refresh / tab close.
--
-- Before this, an approved plan was the ONLY persisted state — the preview lived in
-- GenerateTab's React state, so a refresh threw away a 1-2 min Pro-ladder pipeline run.
-- Drafts reuse ig_campaigns rather than a new table: the row is already shaped like a
-- plan (plan JSONB + options JSONB + total), and the campaign worker claims only
-- 'pending'/'running', so a 'draft' row is invisible to it and cannot be generated
-- (and therefore cannot be charged) until startCampaign flips it to 'pending'.
--
-- Constraint name verified against the live DB (pg_constraint) before the DROP.

ALTER TABLE ig_campaigns DROP CONSTRAINT IF EXISTS ig_campaigns_status_check;
ALTER TABLE ig_campaigns ADD CONSTRAINT ig_campaigns_status_check
  CHECK (status IN ('draft', 'pending', 'running', 'done', 'partial', 'failed'));

-- One active draft per client is the norm; the index serves getPlanDraft's
-- "latest draft for this client" lookup and the worker's 14-day draft GC.
CREATE INDEX IF NOT EXISTS idx_ig_campaigns_draft
  ON ig_campaigns(client_id, updated_at DESC) WHERE status = 'draft';
