-- Format feedback loop (v8.0)
-- ============================
-- Closes the CLAUDE.md hard rule for formats: every content source that feeds
-- generation needs a performance_score + weighted selection. Ideas and reviews
-- had it; formats (ig_post_types) did not — per-type engagement was computed in
-- performance.ts and thrown away.

-- Measured engagement per format, written by propagateMetricsToSources()
-- (same engagement formula and EMA-free averaging as ig_post_ideas/ig_reviews).
ALTER TABLE ig_post_types ADD COLUMN IF NOT EXISTS performance_score numeric;
ALTER TABLE ig_post_types ADD COLUMN IF NOT EXISTS times_used_with_metrics integer DEFAULT 0;

-- Format slug on every generation log row, so the critic-feedback loop can filter
-- history per format (a carousel's "fix" notes are noise for a meme). Historic
-- rows stay NULL — the autopilot falls back to client-wide history when a format
-- has fewer than 2 scored rows.
ALTER TABLE ig_generation_log ADD COLUMN IF NOT EXISTS post_type text;
