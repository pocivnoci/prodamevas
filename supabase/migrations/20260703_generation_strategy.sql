-- ═══════════════════════════════════════════════════════════════
-- Migration: Generation strategy attribution (pipeline v2, best-of-2)
-- ig_generation_log gains the fields needed to compare the legacy
-- repair-loop path vs. the best-of-2 ranking path (PIPELINE_BESTOF2):
--   strategy         'repair' | 'bestof2'
--   editorial_rounds how many editor⇄copywriter rounds actually ran
--   final_score      post-editorial score (critic_score = pre-editorial)
-- Run: Supabase Management API / SQL editor
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE ig_generation_log
    ADD COLUMN IF NOT EXISTS strategy text,
    ADD COLUMN IF NOT EXISTS editorial_rounds integer,
    ADD COLUMN IF NOT EXISTS final_score integer;
