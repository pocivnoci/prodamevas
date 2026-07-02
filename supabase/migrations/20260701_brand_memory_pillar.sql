-- ═══════════════════════════════════════════════════════════════
-- Migration: ig_brand_memory pillar scoping (Phase 2c)
-- Adds a nullable `pillar` column so a learned memory can be scoped to the
-- content pillar it came from (e.g. a "short CTAs win" rule learned from product
-- posts stops bleeding into educational posts). NULL = global (applies to all
-- pillars) — every existing row stays global, so this is fully backward-compatible.
-- Retrieval: getBrandMemories(limit, clientId, pillar) returns `pillar IS NULL OR
-- pillar = <current>`. Write: upsertMemory / learnFromCriticInsights tag when known.
-- Additive + idempotent — safe to re-run. Run: paste into Supabase SQL editor
-- (or the Management API query endpoint). Already applied to prod 2026-07-01.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE ig_brand_memory ADD COLUMN IF NOT EXISTS pillar text;

COMMENT ON COLUMN ig_brand_memory.pillar IS
  'Content pillar this memory is scoped to; NULL = global (applies to all pillars). See getBrandMemories/upsertMemory.';
