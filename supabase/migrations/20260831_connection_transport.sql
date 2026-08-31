-- Transport axis: HOW a connection reaches Instagram, orthogonal to WHICH channel.
--
-- Publishing to a TENANT's Instagram through our own Meta app needs the
-- `instagram_business_content_publish` scope, gated behind a second App Review
-- (docs/META_APP_REVIEW_PLAN.md). upload-post.com already holds an approved app,
-- so a tenant can connect there and publish today. This migration lets one row
-- record which pipe it belongs to.
--
-- `provider` is NOT the place for this: it means "which network" (instagram,
-- linkedin, …). Reusing it would conflate the two axes and break the
-- (client_id, provider) uniqueness that keeps one connection per tenant.
--
-- Additive and safe. Existing rows are Graph connections, which is the default.
-- Run in Supabase SQL Editor / Management API query endpoint, not `db push`.

ALTER TABLE ig_connections
  ADD COLUMN IF NOT EXISTS transport TEXT NOT NULL DEFAULT 'meta'
    CHECK (transport IN ('meta', 'uploadpost'));

COMMENT ON COLUMN ig_connections.transport IS
  'How this connection publishes: meta = our Meta app via Graph API, uploadpost = upload-post.com bridge. Never inferred at runtime.';

-- The transport's own handle for a published post (upload-post `request_id`),
-- which is how its analytics endpoint addresses the post.
--
-- Deliberately SEPARATE from ig_media_id: that column holds the NATIVE Instagram
-- media id, which is transport-independent (upload-post reports it as
-- `platform_post_id`). Folding the two together would break metrics for a tenant's
-- older posts the moment they switch transport.
ALTER TABLE ig_posts
  ADD COLUMN IF NOT EXISTS publish_request_id TEXT;

COMMENT ON COLUMN ig_posts.publish_request_id IS
  'Transport-specific publish handle (upload-post request_id). ig_media_id stays the native IG media id.';

-- Metrics sync looks up posted rows that still need their native id backfilled,
-- and rows it can read analytics for. Partial index keeps it off the whole table.
CREATE INDEX IF NOT EXISTS idx_ig_posts_publish_request
  ON ig_posts (publish_request_id)
  WHERE publish_request_id IS NOT NULL AND status = 'posted';
