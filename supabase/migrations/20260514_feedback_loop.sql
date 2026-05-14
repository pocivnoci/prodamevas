-- Feedback loop: extend generation log with critic data, add performance scores to ideas/reviews
-- Run this in Supabase SQL Editor

-- 1. Extend generation log with critic feedback
ALTER TABLE ig_generation_log ADD COLUMN IF NOT EXISTS critic_score INTEGER;
ALTER TABLE ig_generation_log ADD COLUMN IF NOT EXISTS critic_keep TEXT[];
ALTER TABLE ig_generation_log ADD COLUMN IF NOT EXISTS critic_fix TEXT[];

-- 2. Add performance_score to ideas (Idea Ranker)
ALTER TABLE ig_post_ideas ADD COLUMN IF NOT EXISTS performance_score REAL DEFAULT 0;
ALTER TABLE ig_post_ideas ADD COLUMN IF NOT EXISTS times_used_with_metrics INTEGER DEFAULT 0;

-- 3. Add performance_score to reviews (Review Ranker)
ALTER TABLE ig_reviews ADD COLUMN IF NOT EXISTS performance_score REAL DEFAULT 0;
ALTER TABLE ig_reviews ADD COLUMN IF NOT EXISTS times_used_with_metrics INTEGER DEFAULT 0;

-- 4. Extend brand memory with 'visual' type
ALTER TABLE ig_brand_memory DROP CONSTRAINT IF EXISTS ig_brand_memory_memory_type_check;
ALTER TABLE ig_brand_memory ADD CONSTRAINT ig_brand_memory_memory_type_check
  CHECK (memory_type IN ('pattern', 'preference', 'avoid', 'visual'));

-- 5. Index for fast performance lookups
CREATE INDEX IF NOT EXISTS idx_ig_posts_metrics ON ig_posts(client_id, status)
  WHERE likes IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ig_post_ideas_performance ON ig_post_ideas(client_id, performance_score DESC)
  WHERE is_active = true;
