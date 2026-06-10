-- Idempotent credit charges/refunds
-- ==================================
-- A charge is inserted at job creation (action='post', reference_id=jobId)
-- and a refund on job failure (action='post_refund', reference_id=jobId).
-- This unique index makes both insert-once: a webhook replay or double
-- invocation cannot charge or refund the same reference twice.
--
-- NOTE: if this index fails to create due to existing duplicate rows,
-- deduplicate first:
--   DELETE FROM credit_transactions a USING credit_transactions b
--   WHERE a.id > b.id AND a.action = b.action AND a.reference_id = b.reference_id
--     AND a.reference_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_credit_transactions_action_ref
    ON credit_transactions (action, reference_id)
    WHERE reference_id IS NOT NULL;
