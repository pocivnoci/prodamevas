-- ig_posts.channel: channel discriminator for the channel adapter seam (Fáze 5).
-- Every post now declares which channel it targets. Existing posts default to
-- 'instagram', so a future LinkedIn/Facebook post is a new VALUE, not a new table.
-- Additive + safe. Run in Supabase SQL Editor.

ALTER TABLE ig_posts
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'instagram'
    CHECK (channel IN ('instagram', 'linkedin', 'facebook'));

CREATE INDEX IF NOT EXISTS idx_ig_posts_channel ON ig_posts(client_id, channel);
