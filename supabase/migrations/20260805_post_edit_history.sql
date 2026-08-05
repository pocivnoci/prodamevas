-- Post edit history (v8.6) — targeted edits instead of re-generation
--
-- editPost() overwrites the post IN PLACE (like editPrintDesign does for print
-- artwork) rather than minting a revision row, so iterating "and now move the
-- headline up" doesn't bury the Posts list under near-identical cards.
-- In-place only works if the previous state is recoverable — that's this column.

ALTER TABLE ig_posts ADD COLUMN IF NOT EXISTS edit_history jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN ig_posts.edit_history IS
  'Stack of PREVIOUS states, one pushed before each edit (newest last, capped at 10 in code). Source for "Vrátit zpět". Entry: {at, scope, instruction, preserve, region, slide_index, image_url, image_prompt, image_style, caption, hashtags}.';

-- The "post_edit" credit action must exist on EVERY plan that can generate a post.
-- Fixing a post you already paid to generate is table stakes, not an upsell — and
-- canPerformAction() rejects any action missing from allowed_actions with
-- featureBlocked, so without this backfill the button is dead on all tiers.
-- Matched on "post" (not on a tier name) because three migrations have renamed the
-- tiers since seed — same reasoning as the product_line backfill.

UPDATE subscription_plans
SET features = jsonb_set(
      features,
      '{allowed_actions}',
      (features->'allowed_actions') || '["post_edit"]'::jsonb
    )
WHERE features->'allowed_actions' @> '["post"]'::jsonb
  AND NOT (features->'allowed_actions' @> '["post_edit"]'::jsonb);
