-- Revision support for posts and products
-- Posts: new draft with revision_of reference + saved feedback
-- Products: feedback stored in-place, updated in ig_product_ideas

ALTER TABLE ig_posts
  ADD COLUMN IF NOT EXISTS feedback text,
  ADD COLUMN IF NOT EXISTS revision_of uuid REFERENCES ig_posts(id) ON DELETE SET NULL;

ALTER TABLE ig_product_ideas
  ADD COLUMN IF NOT EXISTS feedback text;

CREATE INDEX IF NOT EXISTS idx_ig_posts_revision_of ON ig_posts(revision_of);
