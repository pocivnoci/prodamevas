-- Distinguish revisions from A/B variants
-- ========================================
-- Both revisePost() and generatePostVariant() link the new post to the
-- original via revision_of. Without a discriminator, revisions show up in
-- the A/B comparison modal and pollute learnFromVariantSelection().

ALTER TABLE ig_posts
  ADD COLUMN IF NOT EXISTS link_type text CHECK (link_type IN ('revision', 'variant'));

-- Backfill: linked posts with stored feedback were user revisions,
-- the rest came from variant generation.
UPDATE ig_posts
SET link_type = CASE WHEN feedback IS NOT NULL THEN 'revision' ELSE 'variant' END
WHERE revision_of IS NOT NULL AND link_type IS NULL;
