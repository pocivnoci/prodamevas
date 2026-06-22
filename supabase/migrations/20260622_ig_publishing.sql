-- ig_posts publishing columns — Step 2 ("Publishing") of the IG go-live roadmap.
-- Lets the publisher cron (app/api/cron/ig-publisher) push an approved post to the
-- connected Instagram account via the Graph API and record the result.
--
-- Media URLs reuse the EXISTING convention on ig_posts.image_url:
--   image    → single public URL
--   carousel → child slide URLs pipe-joined ("url1|url2|url3") (see carousel-orchestrator)
--   reel     → video URL (publishing deferred — no reel support in v1)
-- so no separate carousel/video columns are introduced.
--
-- Run via the Management API query endpoint (CLI migration history is out of sync —
-- never `supabase db push`).

ALTER TABLE ig_posts
  ADD COLUMN IF NOT EXISTS ig_media_id      TEXT,      -- Graph API media object id (key for step 3 metrics sync)
  ADD COLUMN IF NOT EXISTS permalink        TEXT,      -- public IG URL of the published post
  ADD COLUMN IF NOT EXISTS media_type       TEXT,      -- 'image' | 'carousel' | 'reel' (persisted from generation)
  ADD COLUMN IF NOT EXISTS publish_error    TEXT,      -- last publish failure reason (UI surfacing)
  ADD COLUMN IF NOT EXISTS publish_attempts INTEGER NOT NULL DEFAULT 0;

-- Publisher scan: due posts awaiting publish, oldest first.
CREATE INDEX IF NOT EXISTS idx_ig_posts_publisher
  ON ig_posts(scheduled_for) WHERE status = 'scheduled';
