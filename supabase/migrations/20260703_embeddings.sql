-- ═══════════════════════════════════════════════════════════════
-- Migration: Embeddings — memory relevance retrieval + consistency score
-- (pipeline v2, Stage 3). Greenfield pgvector: 768-dim (gemini-embedding-2
-- with outputDimensionality=768 — must match EMBEDDING_DIMS in models.ts).
-- Row counts are small → brute-force cosine, deliberately NO ANN index.
-- Run: Supabase Management API / SQL editor
-- ═══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS vector;

-- Brand memories: retrieved by topic relevance instead of top-N-by-confidence
ALTER TABLE ig_brand_memory ADD COLUMN IF NOT EXISTS embedding vector(768);

-- Captions: embedded at logGeneration time; feeds the gold-voice centroid
ALTER TABLE ig_posts ADD COLUMN IF NOT EXISTS caption_embedding vector(768);

-- Brand-voice drift signal per generated post: cosine(new caption, gold centroid)
ALTER TABLE ig_generation_log ADD COLUMN IF NOT EXISTS consistency_score real;

-- Relevance retrieval for brand memories (supabase-js can't express <=> directly).
-- Mirrors getBrandMemories filters: per-client, confidence >= 0.4, pillar-scoped
-- (global NULL-pillar memories always included).
CREATE OR REPLACE FUNCTION match_brand_memories(
    p_client_id uuid,
    p_embedding vector(768),
    p_match_count int DEFAULT 5,
    p_pillar text DEFAULT NULL
)
RETURNS SETOF ig_brand_memory
LANGUAGE sql STABLE AS $$
    SELECT m.*
    FROM ig_brand_memory m
    WHERE m.client_id = p_client_id
      AND m.confidence >= 0.4
      AND m.embedding IS NOT NULL
      AND (p_pillar IS NULL OR m.pillar IS NULL OR m.pillar = p_pillar)
    ORDER BY m.embedding <=> p_embedding
    LIMIT p_match_count;
$$;
