-- Migration: Add editorial board support to ig_jobs
-- Adds editorial_log column and extends status enum for Chief Editor stages

-- Add editorial_log column (JSONB array of editorial messages)
ALTER TABLE ig_jobs ADD COLUMN IF NOT EXISTS editorial_log JSONB DEFAULT '[]';

-- Drop and recreate the status CHECK constraint to include editorial stages
ALTER TABLE ig_jobs DROP CONSTRAINT IF EXISTS ig_jobs_status_check;
ALTER TABLE ig_jobs ADD CONSTRAINT ig_jobs_status_check
  CHECK (status IN (
    'pending', 'researcher', 'copywriter', 'critic', 'art_director',
    'rendering', 'uploading', 'done', 'failed',
    -- Editorial board stages
    'chief_editor', 'strategist', 'video'
  ));
